# Pyth `PriceInfoObject` shape and BCS layout

> Cycle 4 / Decision Gate G-Pyth deliverable. The keeper's `pythReader.ts`
> module comment MUST reference this file by relative path
> (`../notes/pyth-shape.md`). The BCS layout below is what the implementer
> decodes — NOT what training memory predicts.

## Source of truth

- Live sandbox at `http://127.0.0.1:9000` (G-Boot passing).
- Manifest: `~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json`.
- Pyth package id: `0x2aeae6eb8dbba4a235a91672130085e06a52e473ae5ddbad1f56ea5e0068fd34`.
- Reference TS code: `~/workspace/deepbook-sandbox/sandbox/scripts/market-maker/price-feed.ts`
  (`parsePriceFromBcs` and `calculateBaseQuotePrice`). The keeper mirrors
  these functions; the reference is the canonical source.

## On-chain `PriceInfoObject`s in the running sandbox

| Symbol | Object id |
| ------ | --------- |
| DEEP   | `0xddc6cbb7a203295d06ee94ad5c68fe59196fb1497e4d432eaf21e79e37b542a8` |
| SUI    | `0xec5cc6aecf447f72ab526c0303a1d6d7303245bde4296fb979190efa5906da28` |

Both have type
`0x2aeae6eb...::price_info::PriceInfoObject`.

## On-chain object content (captured via `sui_getObject` `showContent`)

The wrapper hierarchy looks like this (DEEP, abbreviated):

```
PriceInfoObject {
  id: ...,
  price_info: PriceInfo {
    arrival_time: u64,
    attestation_time: u64,
    price_feed: PriceFeed {
      price_identifier: PriceIdentifier { bytes: vector<u8> },
      price: Price {
        price: I64 { magnitude: u64, negative: bool },
        conf:  u64,
        expo:  I64 { magnitude: u64, negative: bool },
        timestamp: u64,
      },
      ema_price: Price { ... same shape as price ... },
    },
  },
}
```

A live sample from the DEEP object at the time of capture:

```json
{
  "price": { "magnitude": "3059012", "negative": false },
  "conf":  "10165",
  "expo":  { "magnitude": "8", "negative": true },
  "timestamp": "1777245324"
}
```

Interpretation: `actual_price = magnitude * 10^(negative ? -magnitude : +magnitude)`
on the `expo` field, applied to `price.magnitude`. So
`3059012 * 10^-8 = 0.03059012` USD per DEEP.

**Important:** The keeper does NOT consume this `showContent` JSON in the
hot path — it cannot derive the `price.price.magnitude` field consistently
from a Move-side getter that returns a `Price` struct because the Move
return path serializes via BCS. The keeper instead drives the price read
through `simulateTransaction` against `pyth::pyth::get_price_unsafe` and
decodes the BCS bytes returned by that move call. The on-chain
`getObject`-fetched JSON is documented here for cross-checking the BCS
parse against a known-good interpretation.

## `pyth::pyth::get_price_unsafe` BCS return layout

Calling `${pythPackageId}::pyth::get_price_unsafe(price_info)` returns a
single `Price` value (NOT a `PriceFeed`, NOT the wrapper). The on-wire BCS
serialization, total **34 bytes**, is:

| offset | bytes | field                  | type      |
| -----: | ----: | ---------------------- | --------- |
|      0 |     1 | `price.negative`       | `bool`    |
|      1 |     8 | `price.magnitude`      | `u64` LE  |
|      9 |     8 | `conf`                 | `u64` LE  |
|     17 |     1 | `expo.negative`        | `bool`    |
|     18 |     8 | `expo.magnitude`       | `u64` LE  |
|     26 |     8 | `timestamp`            | `u64` LE  |
|        |       |                        | total: 34 |

Notes:
- `bool` BCS is a single byte: `0x00` = `false`, `0x01` = `true` (any
  non-zero byte is treated as true by the keeper for forward-compat, but
  the Pyth contract only ever emits `0x00` / `0x01`).
- `u64` BCS is 8-byte little-endian. The keeper's helper:

  ```ts
  function readU64LE(bytes: Uint8Array | number[], offset: number): bigint {
    let v = 0n;
    for (let i = 0; i < 8; i++) v |= BigInt(bytes[offset + i]) << BigInt(i * 8);
    return v;
  }
  ```

- The exponent is reconstructed as
  `expoNegative ? -BigInt(expoMagnitude) : BigInt(expoMagnitude)`. For all
  USD-denominated Pyth feeds on this sandbox the exponent is **-8**
  (`expo.negative=1`, `expo.magnitude=8`).
- The price is reconstructed as `priceNegative ? throw : magnitude`. The
  keeper aborts the read with `Negative price from oracle` if
  `price.negative === 1` (mirrors the sandbox market-maker; a
  negative-price reading is a Pyth bug, not real data).

## Live captured BCS bytes (as of G-Pyth verification)

Run with `SuiJsonRpcClient.core.simulateTransaction({ checksEnabled: false,
include: { commandResults: true } })`. Both reads were made in the same
session against the live sandbox.

### DEEP

- Hex: `0066a92e00000000005f1d000000000000010800000000000000fa9cee6900000000`
- Bytes: `[0, 102,169,46,0,0,0,0,0, 95,29,0,0,0,0,0,0, 1, 8,0,0,0,0,0,0,0, 250,156,238,105,0,0,0,0]`
- Decoded:
  - `price.negative = 0` (false)
  - `price.magnitude = 0x0000000000_2ea966 = 3_058_022`
  - `conf = 0x0000000000_001d5f = 7_519`
  - `expo.negative = 1` (true)
  - `expo.magnitude = 8`  →  exponent = -8
  - `timestamp = 0x00000000_69ee9cfa = 1_777_249_018`
- Interpretation: DEEP/USD = `3_058_022 * 10^-8 = 0.03058022` USD.

### SUI

- Hex: `0014809f0500000000625f010000000000010800000000000000fa9cee6900000000`
- Bytes: `[0, 20,128,159,5,0,0,0,0, 98,95,1,0,0,0,0,0, 1, 8,0,0,0,0,0,0,0, 250,156,238,105,0,0,0,0]`
- Decoded:
  - `price.negative = 0`
  - `price.magnitude = 0x00000000_059f8014 = 94_371_860`
  - `conf = 0x00000000_00015f62 = 90_466`
  - `expo.negative = 1`, `expo.magnitude = 8`  →  -8
  - `timestamp = 1_777_249_018`
- Interpretation: SUI/USD = `0.94371860` USD.

## Derived TypeScript type

The keeper exposes the parsed value as:

```ts
export interface PythPrice {
  /** u64 magnitude of the I64 `price` field (always non-negative; a negative
   *  on-wire price aborts the read). */
  magnitude: bigint;
  /** Signed exponent reconstructed from `expo.{negative, magnitude}`. For
   *  USD-denominated Pyth feeds this is typically -8. */
  exponent: bigint;
  /** Confidence interval as a u64 (in the same scale as `magnitude`). */
  conf: bigint;
  /** Publish time in seconds since the Unix epoch. */
  publishTimeSeconds: bigint;
}
```

## Price formula the keeper applies

Mirrors the sandbox market-maker's `calculateBaseQuotePrice`:

```ts
function calculateBaseQuotePrice(args: {
  baseMagnitude: bigint;
  baseExponent: bigint;
  quoteMagnitude: bigint;
  quoteExponent: bigint;
  /** decimal count of the QUOTE coin (e.g. 9 for SUI, 6 for USDC). */
  quoteDecimals: number;
}): bigint {
  const { baseMagnitude, baseExponent, quoteMagnitude, quoteExponent, quoteDecimals } = args;
  if (baseMagnitude === 0n || quoteMagnitude === 0n) {
    throw new Error('zero magnitude');
  }
  const scaledExpo = BigInt(quoteDecimals) + baseExponent - quoteExponent;
  const result = scaledExpo >= 0n
    ? (baseMagnitude * 10n ** scaledExpo) / quoteMagnitude
    : baseMagnitude / (quoteMagnitude * 10n ** -scaledExpo);
  if (result > (1n << 64n) - 1n) throw new Error('price overflow u64');
  return result;
}
```

Worked example — DEEP/SUI pool (`Pool<DEEP, SUI>`, `quoteDecimals = 9`):

- DEEP/USD = `3_058_022 * 10^-8 ≈ 0.03058022`
- SUI/USD  = `94_371_860 * 10^-8 ≈ 0.94371860`
- DEEP/SUI = `0.03058022 / 0.94371860 ≈ 0.0324036` SUI per DEEP
- In atomic units (1 SUI = 10^9 mist):
  `(3_058_022 * 10^(9 + -8 - -8)) / 94_371_860 = (3_058_022 * 10^9) / 94_371_860`
  `= 3_058_022_000_000_000 / 94_371_860 ≈ 32_404_071`
  → `current_price = 32_404_071n` mist of SUI per atomic DEEP. The
  Move contract compares `current_price (u64) >= tp_price (u64)` directly,
  so the `tp_price` set at vault creation time MUST be in this same unit.

## Staleness

`publishTimeSeconds` is parsed and exposed but the keeper does NOT enforce
a max-age check this cycle (Cycle 4 contract "Out of scope" — defense-in-
depth checks are deferred). The sandbox's own oracle-service drives
publish times and the keeper trusts them on localnet.

## Escalation triggers (per spec G-Pyth)

If the `PriceInfoObject` IDs in the manifest do not correspond to live,
readable on-chain objects, OR if the BCS layout returned by the bundled
`pyth` package differs from the 34-byte layout above (e.g. upstream Pyth
bumped the `Price` struct shape), the keeper MUST escalate via
`AskUserQuestion` rather than silently adopt a different layout or
hard-code price values. This file is the load-bearing reference for
the `pythReader.ts` source comment per spec.
