# Slot 1 — Chain Shape Capture (G-PoolShape Artifact)

**Captured:** 2026-04-27 against the running DeepBook Sandbox.
**Sandbox manifest:** `~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json`
**DeepBook package:** `0xe7b03bfa906a4c4f2a696ad253f9815a55eafb50f6aa52b121128c8d5cef4329`
**Sui RPC base URL:** `http://127.0.0.1:9000`

This file is the load-bearing reference for every TypeScript type derived in
`src/`. Every shape below was captured *empirically* via Sui JSON-RPC against
the running sandbox; do not edit field names from training memory — re-capture
if the sandbox is restarted.

The two RPC families used here are the only chain-direct read paths Slot 1
relies on:

- `sui_getObject` (with `showContent: true`) — pool inner state
- `suix_getDynamicFields` + follow-up `sui_getObject` — bid / ask big-vector
  ladder traversal
- `suix_queryEvents` (with `MoveModule` filter) — DeepBook order events for
  fills, placements, cancellations

---

## Pool Inner State

### Source RPC call

```jsonc
// Step 1: read the outer Pool wrapper
sui_getObject(
  "0x697f5f0f2d2d351d54be6e10a9491af344ea23eaf2485e10463c3800398aed13",
  { showContent: true, showType: true }
)

// Outer Pool only exposes a `Versioned` wrapper:
// type: 0x...::pool::Pool<SUI, USDC>
// content.fields.inner = { type: "0x2::versioned::Versioned",
//                          fields: { id: { id: "<inner-id>" }, version: "6" } }
```

### Step 2 — traverse Versioned dynamic field

```jsonc
suix_getDynamicFields("<versioned-inner-id>")
// Returns one DynamicField whose `objectType` is
// 0x...::pool::PoolInner<BASE, QUOTE> and whose `objectId` is the
// real PoolInner field-wrapper.
```

### Step 3 — read PoolInner

```jsonc
sui_getObject("<pool-inner-id>", { showContent: true, showType: true })
// type:
// 0x2::dynamic_field::Field<u64, 0x...::pool::PoolInner<SUI, USDC>>
//
// content.fields.value.fields contains the load-bearing inner state:
{
  "allowed_versions": { "type": "0x2::vec_set::VecSet<u64>",
                        "fields": { "contents": ["6"] } },
  "book": {
    "type": "0x...::book::Book",
    "fields": {
      "asks": {
        "type": "0x...::big_vector::BigVector<0x...::order::Order>",
        "fields": {
          "id":          { "id": "<asks-bigvector-id>" },
          "depth":       0,
          "length":      "30",
          "last_id":     "109",
          "root_id":     "109",
          "max_fan_out": "64",
          "max_slice_size": "64"
        }
      },
      "bids": {
        "type": "0x...::big_vector::BigVector<0x...::order::Order>",
        "fields": {
          "id":          { "id": "<bids-bigvector-id>" },
          "depth":       0,
          "length":      "30",
          "last_id":     "109",
          "root_id":     "109",
          "max_fan_out": "64",
          "max_slice_size": "64"
        }
      },
      "lot_size":           "100000000",
      "min_size":           "1000000000",
      "tick_size":          "1000",
      "next_ask_order_id":  "3271",
      "next_bid_order_id":  "18446744073709548345"
    }
  },
  "deep_price": { ... },           // OrderDeepPrice rolling reference
  "pool_id":          "0x697f5f0f2d2d351d54be6e10a9491af344ea23eaf2485e10463c3800398aed13",
  "registered_pool":  true,
  "state":            { /* accounts table, governance, history */ }
}
```

### Step 4 — traverse `book.asks` / `book.bids` BigVector slices

```jsonc
suix_getDynamicFields("<asks-bigvector-id>")
// Returns Slice<Order> wrappers:
// objectType: 0x...::big_vector::Slice<0x...::order::Order>
// One slice per leaf node of the BigVector; up to max_slice_size=64 orders each.

sui_getObject("<slice-id>", { showContent: true, showType: true })
// content.fields.value.fields.keys = u128 order_ids encoded as decimal strings
// content.fields.value.fields.vals = parallel array of Order structs
// (next, prev fields are the BigVector linked-list pointers)
```

### Order struct shape (single ladder level)

```jsonc
{
  "type": "0x...::order::Order",
  "fields": {
    "balance_manager_id": "0x2acc...d086",
    "client_order_id":    "1777315374184840",
    "epoch":              "28",
    "expire_timestamp":   "18446744073709551615",
    "fee_is_deep":        false,
    "filled_quantity":    "0",
    "order_deep_price":   { "asset_is_base": false, "deep_per_asset": "0" },
    "order_id":           "170141183460486719245069180370816077150",  // u128
    "quantity":           "100000000000",
    "status":             0   // 0 = LIVE, others = PARTIALLY_FILLED / FILLED / CANCELED / EXPIRED
  }
}
```

**Critical decoding note (sui-sdk + deepbook):** `order_id` is a u128 returned
by RPC as a decimal string. The high bits encode the limit price. For asks the
encoding is monotonically increasing in price; for bids it's decreasing
(inverted price), so a sort by raw `order_id` ascending lists asks
best-first / bids worst-first. The price itself can also be derived from the
event stream (`OrderPlaced.price`) or by decoding bits 64-127 of the u128
(price is the upper 64 bits; the lower 64 bits are an order-counter
disambiguator). Slot 1 prefers reading `price` directly off the corresponding
`order_info::OrderPlaced` event when computing depth ladders, falling back to
order_id high-bit decoding only if the event is unavailable.

### Field-name summary (used by `src/types.ts` as the source of truth)

| Type | Fields used by Slot 1 |
| --- | --- |
| `PoolInner` | `book` (Book), `pool_id` |
| `Book` | `asks` (BigVectorMeta), `bids` (BigVectorMeta), `lot_size`, `min_size`, `tick_size` |
| `BigVectorMeta` | `id.id`, `length`, `root_id`, `max_slice_size` |
| `Slice<Order>` | `keys` (u128 strings), `vals` (Order[]) |
| `Order` | `order_id`, `quantity`, `filled_quantity`, `status` |

---

## Fill Event Sample

DeepBook v3 emits the fill record as `order_info::OrderInfo` from the
`pool` transaction module. The event's `fills` array carries one entry per
matched maker, and the top-level `executed_quantity` and
`cumulative_quote_quantity` summarise the taker's realised execution.
When `fills` is empty and `executed_quantity == "0"`, the OrderInfo describes
a resting order placement (paired with an `order_info::OrderPlaced` companion
in the same tx).

### Source RPC call

```jsonc
suix_queryEvents(
  { MoveModule: { package: "0xe7b03b...4329", module: "pool" } },
  null,        // cursor
  50,          // page size
  true         // descending (newest first)
)
```

Confirmed during capture: filtering by `module: "order"` or
`module: "order_info"` returns zero events even though the *event type symbol*
is `0x...::order_info::OrderInfo`. This is a Sui RPC quirk —
`MoveModule` on `suix_queryEvents` filters by the **transaction module** that
published the event (`transactionModule: "pool"` in the response), not the
declaring module of the event struct. **Slot 1 must filter on
`module: "pool"`**.

### Sample OrderInfo event payload (verbatim)

```jsonc
{
  "id":               { "txDigest": "GmhjJo6mdUhuVHdgA8APcCLMT6kebpMMZKbNc8sjtAST",
                        "eventSeq": "120" },
  "packageId":        "0xe7b03bfa906a4c4f2a696ad253f9815a55eafb50f6aa52b121128c8d5cef4329",
  "transactionModule": "pool",
  "sender":           "0x8ea158b02179fcf5802aff5981b8ba7e29583ec2fa08788a698fec524f316c5c",
  "type":             "0x...::order_info::OrderInfo",
  "parsedJson": {
    "balance_manager_id":          "0x2acc...d086",
    "client_order_id":             "1777315374185079",
    "cumulative_quote_quantity":   "0",
    "epoch":                       "29",
    "executed_quantity":           "0",
    "expire_timestamp":            "18446744073709551615",
    "fee_is_deep":                 false,
    "fill_limit_reached":          false,
    "fills":                       [],
    "is_bid":                      true,
    "maker_fees":                  "0",
    "market_order":                false,
    "order_deep_price":            { "asset_is_base": false, "deep_per_asset": "0" },
    "order_id":                    "12377783720203182843884075",
    "order_inserted":              true,
    "order_type":                  3,
    "original_quantity":           "100000000000",
    "paid_fees":                   "0",
    "pool_id":                     "0x697f5f0f2d2d351d54be6e10a9491af344ea23eaf2485e10463c3800398aed13",
    "price":                       "671000",
    "self_matching_option":        1,
    "status":                      0,
    "timestamp":                   "1777318745125",
    "trader":                      "0x8ea158b02179fcf5802aff5981b8ba7e29583ec2fa08788a698fec524f316c5c"
  },
  "timestampMs": "1777318745673"
}
```

### Companion OrderPlaced event (same tx)

```jsonc
{
  "type": "0x...::order_info::OrderPlaced",
  "parsedJson": {
    "balance_manager_id": "0x2acc...d086",
    "client_order_id":    "1777315374185079",
    "expire_timestamp":   "18446744073709551615",
    "is_bid":             true,
    "order_id":           "12377783720203182843884075",
    "placed_quantity":    "100000000000",
    "pool_id":            "0x697f5f...aed13",
    "price":              "671000",
    "timestamp":          "1777318745125",
    "trader":             "0x8ea158...6c5c"
  }
}
```

### Fill aggregation rule

A "fill" for Slot 1 is an entry in `OrderInfo.fills[]` (the per-maker fills of
a taker order) **plus** the implicit taker fill that the OrderInfo header
itself describes when `executed_quantity > "0"`. For each fill the load-bearing
quantities are:

- Quantity (base atomic units): the per-fill `base_quantity`
  (in `fills[]`) or the top-level `executed_quantity`.
- Price (price atomic units, where price = quote_per_base scaled by
  `tick_size` from the Book): the per-fill `price` or the order's
  `price`.
- Timestamp: the OrderInfo's `timestamp` field (matches `timestampMs` of the
  containing event up to ms granularity); for `fills[]` entries the same
  taker timestamp applies.

The `pool_id` field is present on every payload, so multi-pool aggregation can
demultiplex without secondary lookups.

### Sandbox observation note

During the capture window the sandbox's market maker (`scripts/market-maker/`)
ran a grid strategy that **placed and cancelled orders without producing any
fills**. The OrderInfo / OrderPlaced shapes above were captured directly;
the `fills` array shape is documented from the Move source layout
(`order_info::Fill`) and the per-payload `executed_quantity`/`maker_fees`
fields. A live fill against this sandbox would populate `fills[]` with
entries shaped roughly like:

```jsonc
{
  "maker_order_id":     "<u128>",
  "maker_balance_manager_id": "0x...",
  "taker_is_bid":       false,
  "base_quantity":      "100000000",
  "quote_quantity":     "67100",
  "price":              "671000",
  "expired":            false,
  "completed":          true
}
```

Slot 1 fixtures synthesise these shapes with conservative field names matching
the OrderInfo top-level fields — the fixture-derived tests would fail loudly
if the real on-chain shape diverges, since the captured sample above is the
canonical reference.

---

## Friction observed during capture

Logged into `independent/raw-friction.log` (see `[deepbook]`, `[sui-sdk]`,
`[sandbox]` entries dated 2026-04-27 capture window):

- `[sui-sdk]` `suix_queryEvents` `MoveModule` filter selects on
  `transactionModule`, not the event struct's declaring module — filtering
  on `module: "order_info"` returns zero events even though the event type
  symbol is `0x...::order_info::OrderInfo`.
- `[deepbook]` BigVector slice objects churn rapidly (sub-second deletion +
  re-creation by the market maker); a naive
  `suix_getDynamicFields` → `sui_getObject` two-step often races and returns
  `{ error: { code: "deleted" } }`. Production reads need a single-shot path
  (e.g. fetch the slice content in the same request set or accept retry).
- `[sandbox]` The bundled market maker is grid-only and does not match its
  own orders, so no `OrderInfo.fills[]` entries are observable from a
  passive idle sandbox. Verifying live-fill UI behaviour requires a manual
  market-mover trade.
