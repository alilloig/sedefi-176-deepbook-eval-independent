# RUNBOOK — SEDEFI-176 Independent Solution

Clone-to-test instructions for the three apps under `independent/`:

1. **`01-market-stats/`** — React + Vite SPA reading aggregate DeepBook pool stats chain-direct (no wallet, no indexer).
2. **`02-slippage-swap/`** — Move 2024 module wrapping DeepBook v3's no-manager `swap_exact_base_for_quote` with a slippage assertion.
3. **`03-tpsl-vault/`** — TP/SL vault: a Move package + a Node.js keeper that watches Pyth + a React UI built on `@mysten/dapp-kit-react ^2.0.1`.

All commands assume `~/workspace/deepbook-sandbox-evaluation-apps` is the repository root and that the DeepBook sandbox lives at `~/workspace/deepbook-sandbox`.

---

## Prerequisites

| Tool | Version (verified) | Why |
|---|---|---|
| **pnpm** | 9.x or later | Required by every JS workspace (sandbox + all three apps). Never use npm/yarn. |
| **Node.js** | 20.x or later (ESM-native) | All TS apps are `"type": "module"`. |
| **sui CLI** | 1.69.x with `sui move` 2024 support | Required for Slot 2 + Slot 3 Move builds and for `sui client publish`. |
| **Docker + Docker Compose** | recent | Required by the sandbox's `pnpm deploy-all` (8 containers). |
| **git** | any | For cloning + worktree usage. |

Check with:

```sh
pnpm --version
node --version
sui --version
docker compose version
```

---

## Step 1 — Sandbox bootstrap

The sandbox at `~/workspace/deepbook-sandbox` must be running and freshly seeded **before** any of the three apps can be exercised end-to-end.

### Critical: full reset every time

```sh
cd ~/workspace/deepbook-sandbox/sandbox
docker compose down -v   # the -v flag wipes postgres volumes — REQUIRED
pnpm install
pnpm deploy-all
```

**Why `-v` is non-negotiable.** `pnpm deploy-all` does NOT itself do `down -v`. The indexer's postgres state survives between deploys, and on the second-and-later runs the indexer's pruning cursor has already advanced past the checkpoint at which pools are about to be created — so `pool_created` events are silently missed and the indexer's `pools` table stays empty. See FEEDBACK.md §3 for the full root-cause analysis.

This took ~1 hour of out-of-band debugging during the build. **Always start from `down -v`.**

### What "successful bootstrap" looks like

`pnpm deploy-all` should print, near the end:

```
SUI_USDC pool created: 0x7b8e...
DEEP_SUI pool created: 0x93b9...
```

…and the dashboard should auto-open at `http://localhost:5173`.

### Verify sandbox is up

```sh
# Sui RPC — should return a chain identifier
curl -s -X POST http://127.0.0.1:9000 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getChainIdentifier","params":[]}'

# Indexer health (port 9008) — should return JSON, not connection refused
curl -s http://127.0.0.1:9008/get_pools

# Pyth oracle status (port 9010) — STATUS endpoint, not a price feed
curl -s http://127.0.0.1:9010/health 2>&1 || curl -s http://127.0.0.1:9010/

# Faucet (port 9009)
curl -s http://127.0.0.1:9009/health 2>&1 || true
```

**Expected gotcha.** `GET /get_pools` will likely return `[]` even after a clean bootstrap. This is a sandbox bug (see FEEDBACK.md §3). All three apps are built to **bypass the indexer's pool-keyed REST surface entirely** and read on-chain directly via Sui RPC, so this does not block the runbook.

### Manifest

`pnpm deploy-all` writes `~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json` with all package IDs, pool object IDs, and Pyth oracle object IDs. Slots 1 and 3-UI both read this file at runtime via a Vite dev-server middleware (no symlink, no copy).

### If `pnpm deploy-all` fails

The script swallows `sui client test-publish` errors at Phase 3 — you'll see `Failed to publish token` followed by build warnings, but no transaction error. Inspect:

```sh
cd ~/workspace/deepbook-sandbox/sandbox/.external-packages/token
sui move build -e localnet 2>&1 | tail -50
sui client test-publish 2>&1 | tail -50
```

Common causes (all sandbox-side, see FEEDBACK.md §3):

- The bundled `token/sources/deep.move` uses `sui::coin::create_currency` (deprecated) — may become a hard error against newer `sui-tools` images.
- `deep.move:68` uses `#[allow(lint(share_owned))]` filter — unknown warning category in newer Move toolchains.

If hit, the practical fix is for the user to repair the sandbox out of band. The independent solution does not modify the sandbox.

---

## Step 2 — Slot 1: Market Stats (React + Vite)

```sh
cd ~/workspace/deepbook-sandbox-evaluation-apps/independent/01-market-stats
pnpm install
pnpm dev
```

Open `http://localhost:5173`.

### What you should see

A single-page dashboard listing every pool from `localnet.json` with:

- Pool name + base/quote symbols.
- Live mid-price, bid-ask spread, and depth at ±1% from mid (computed from on-chain BigVector slices).
- 24-hour volume + last-50-trade sparkline (computed from `suix_queryEvents` over the DeepBook `pool` module).

### How it reads data

- **Manifest**: served at `/localnet.json` by a Vite dev-server middleware (`vite.config.ts`) that streams the live file from `~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json`. No symlink. No copy. The middleware logs a 404 with an explicit instruction if the file is missing.
- **Pool objects**: raw `sui_getObject` JSON-RPC calls + dynamic-field traversal of the `BigVector<Order>` slice tree (deepbook's `book::Book` stores asks/bids in a custom container).
- **Trades**: `suix_queryEvents` filtering on `MoveModule { module: "pool" }` (NOT `"order_info"` — the filter selects on `transactionModule`, not on the event struct's declaring module — see FEEDBACK.md §2).
- **Order ID decode**: `(BigInt(orderId) & ((1n << 127n) - 1n)) >> 64n` for both bids AND asks. The DeepBook `chain-shape.md` prose ("inverted for bids") was misleading — see FEEDBACK.md §3.

### Tests

```sh
pnpm test
```

24 unit tests; chain-decode formulas are pinned against captured fixtures.

### Known issue

The page may render with empty pool rows for a few seconds while the parallel `Promise.allSettled` fetches resolve. BigVector slice reads can race and return `{ error: { code: "deleted" } }` when the market-maker is actively churning grid orders — the page will retry on the next 5-second polling tick.

---

## Step 3 — Slot 2: Slippage Swap (Move 2024)

```sh
cd ~/workspace/deepbook-sandbox-evaluation-apps/independent/02-slippage-swap
sui move test -e localnet
```

Expected: 4/4 tests pass.

### Build

```sh
sui move build -e localnet
```

### Why `-e localnet` is required

`Move.toml` declares an `[environments]` block:

```toml
[environments]
localnet = "a62c4e17"
```

Sui 1.69.x's package manager refuses to build any package whose dependencies declare `[environments]` (the bundled `deepbook` and `token` packages do) unless the consuming package also declares an `[environments]` block AND the build is invoked with `--build-env <name>` (or the `-e <name>` shortcut). Without `-e localnet`, you'll see:

```
Could not determine the correct dependencies to use for `localnet`;
pass one of `--build-env testnet` or `--build-env mainnet`.
```

The chain-id value `"a62c4e17"` is a **stale** localnet identifier — `sui move build/test` does not contact a node, so the value need not match the running sandbox's actual chain ID. **Only `sui client publish` requires it to match**, and the sandbox regenerates the chain ID on every `pnpm deploy-all`. See FEEDBACK.md §2.

### Publish (optional — only if you want to call from a CLI script)

```sh
# Get the current chain ID first
sui client active-env
sui client chain-identifier

# Update Move.toml's [environments] localnet = "<the chain id>" if needed
sui client publish -e localnet --gas-budget 200000000
```

### Module API

```move
public entry fun swap_exact_base_for_quote<BaseAsset, QuoteAsset>(
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    base_in: Coin<BaseAsset>,
    deep_in: Coin<DEEP>,
    min_quote_out: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): (Coin<BaseAsset>, Coin<QuoteAsset>, Coin<DEEP>)
```

Returns the three-coin tuple unchanged from DeepBook; aborts with `EInsufficientOutput` (currently `0`) if `coin::value(&quote_out) < min_quote_out`. Min_out is denominated in raw atomic units of `Coin<QuoteAsset>`.

---

## Step 4 — Slot 3 Move package (TP/SL Vault)

```sh
cd ~/workspace/deepbook-sandbox-evaluation-apps/independent/03-tpsl-vault/move
sui move test -e localnet
```

Expected: 7/7 tests pass.

### Publish

The keeper and the UI both need the published package ID. **Update the `[environments]` chain ID in `Move.toml` to match the live sandbox** before publishing:

```sh
sui client active-env             # should be 'localnet' pointing at 127.0.0.1:9000
sui client chain-identifier       # the value to write into Move.toml
# Edit Move.toml: [environments] localnet = "<chain id>"

sui client publish -e localnet --gas-budget 200000000
```

Capture the **package ID** from the publish output — both the keeper and the UI need it.

### Vault API summary

```move
public entry fun create_vault<T>(
    coin_in: Coin<T>,
    pool_id: ID,
    side: u8,                  // 0 = BID, 1 = ASK
    tp_price: Option<u64>,
    sl_price: Option<u64>,
    ctx: &mut TxContext,
)

public entry fun withdraw<T>(vault: &mut Vault<T>, ctx: &mut TxContext)
    // owner-only; aborts if already triggered

public entry fun execute_trigger<BaseAsset, QuoteAsset>(
    vault: &mut Vault<BaseAsset>,
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    deep_in: Coin<DEEP>,
    current_price: u64,
    clock: &Clock,
    ctx: &mut TxContext,
)
    // permissionless but condition-gated; pool-id-bound;
    // routes ALL THREE swap-output coins to vault.owner
```

Events: `VaultCreated`, `TriggerFired`. The keeper subscribes to `VaultCreated` and submits `execute_trigger` PTBs.

---

## Step 5 — Slot 3 Keeper (Node.js + TypeScript)

```sh
cd ~/workspace/deepbook-sandbox-evaluation-apps/independent/03-tpsl-vault/keeper
pnpm install
```

### Required env

```sh
# 0x-prefixed 66-char hex from Step 4's `sui client publish` output
export TPSL_VAULT_PACKAGE_ID=0x...

# 0x-prefixed 66-char hex of a Coin<DEEP> object owned by the keeper key
# (split one off from the deployer's faucet-distributed DEEP balance)
export KEEPER_DEEP_COIN_ID=0x...

# Optional knobs (defaults shown):
# export KEEPER_POLL_INTERVAL_MS=5000        # must be in [5000, 10000]
# export KEEPER_DEEP_PER_TRIGGER=100000000   # 1 DEEP = 1e8 atomic
# export KEEPER_LOG_LEVEL=info
# export SANDBOX_MANIFEST_PATH=$HOME/workspace/deepbook-sandbox/sandbox/deployments/localnet.json
```

### Run

```sh
pnpm dev
```

The keeper:

1. Generates an ephemeral Ed25519 keypair (localnet only — never reuse).
2. Reads `localnet.json` from the sandbox.
3. Subscribes to `VaultCreated` events from `TPSL_VAULT_PACKAGE_ID::tpsl_vault`.
4. Polls Pyth `PriceInfoObject`s on chain via `sui_getObject` + BCS decode (NOT the `:9010` HTTP endpoint — that's a status endpoint, not a price feed; see FEEDBACK.md §3).
5. Builds + signs + submits `execute_trigger` PTBs when TP or SL conditions are met for any known vault.

### Tests

```sh
pnpm test
```

63 vitest assertions; the production submission path is exercised via T-009 with an explicit `submitter` argument injected. The keeper module exposes `runOnePollCycle({ submitter })` as a single seam used by both the test and the production main loop — so T-009 cannot accidentally pass while production is dead code (this was a Cycle 4 lesson; see FEEDBACK.md §2).

---

## Step 6 — Slot 3 UI (React + dapp-kit-react)

```sh
cd ~/workspace/deepbook-sandbox-evaluation-apps/independent/03-tpsl-vault/ui
pnpm install
```

### Required env

```sh
# Same TPSL_VAULT_PACKAGE_ID as Step 5, but VITE_-prefixed for browser exposure
export VITE_TPSL_VAULT_PACKAGE_ID=0x...
```

### Run

```sh
pnpm dev
```

Open `http://localhost:5173`.

### Wallet

The UI mirrors the sandbox dashboard's `dapp-kit.ts` setup: it auto-connects to the deployer key via `@mysten-incubation/dev-wallet`'s `InMemorySignerAdapter`. **Localnet only** — never replicate this for testnet/mainnet.

### Flow

1. The page lists all vaults whose `owner` matches the connected address (one `suix_queryEvents` call to `tpsl_vault::VaultCreated`, filtered client-side by owner).
2. The "Create vault" form lets you deposit `Coin<T>`, set TP/SL prices, choose pool + side, and submits a PTB via `useDAppKit().signAndExecuteTransaction`.
3. Each vault row shows its TP/SL config; non-triggered vaults expose a `Withdraw` button (owner-only); triggered vaults show a green "Triggered" badge + the realised quote-out amount (read from on-chain).

### Tests

```sh
pnpm test
```

10 vitest assertions across 6 test files. T-001 and T-007/T-008 explicitly verify that the test-injected `refresh` callback is the same function the production submit handler calls — closing the Cycle-4 anti-pattern hole (see FEEDBACK.md §2).

---

## Step 7 — End-to-end smoke

The minimum sequence to demonstrate the whole independent solution against a fresh sandbox:

```sh
# (1) Bootstrap
cd ~/workspace/deepbook-sandbox/sandbox
docker compose down -v
pnpm install && pnpm deploy-all

# (2) Slot 1 — visual smoke
cd ~/workspace/deepbook-sandbox-evaluation-apps/independent/01-market-stats
pnpm install && pnpm dev &
# open http://localhost:5173, expect pool rows with non-zero mid prices

# (3) Slot 2 — Move test
cd ~/workspace/deepbook-sandbox-evaluation-apps/independent/02-slippage-swap
sui move test -e localnet

# (4) Slot 3 Move — test + publish
cd ~/workspace/deepbook-sandbox-evaluation-apps/independent/03-tpsl-vault/move
sui move test -e localnet
# update Move.toml chain id, then:
sui client publish -e localnet --gas-budget 200000000
export TPSL_VAULT_PACKAGE_ID=<from publish output>

# (5) Split a Coin<DEEP> for the keeper, set KEEPER_DEEP_COIN_ID to its objectId
# (use sui client split-coin or read the deployer wallet via the dashboard)

# (6) Slot 3 Keeper
cd ~/workspace/deepbook-sandbox-evaluation-apps/independent/03-tpsl-vault/keeper
pnpm install && KEEPER_DEEP_COIN_ID=0x... pnpm dev &

# (7) Slot 3 UI
cd ~/workspace/deepbook-sandbox-evaluation-apps/independent/03-tpsl-vault/ui
VITE_TPSL_VAULT_PACKAGE_ID=$TPSL_VAULT_PACKAGE_ID pnpm install && pnpm dev
# open http://localhost:5173, create a vault with a tight TP/SL price
```

To **observe a trigger fire**, the live Pyth price has to cross the TP or SL threshold while the keeper is running. Two practical options:

1. **Wait** for the bundled oracle service's natural price drift to cross the threshold (slow on a sandbox).
2. **Set the threshold deliberately close to the current price** and wait one or two oracle ticks. Read `localnet.json`'s `pythOracles.suiPriceInfoObjectId`, `sui_getObject` it, decode the BCS via the keeper's `parsePriceFromBcs` helper, and pick a TP within ~0.1% of the current price.

A direct manual price push is not exposed by the sandbox's oracle endpoint (`:9010` is status-only — see FEEDBACK.md §3). To unblock testing, write a small script that uses the Pyth Move package's `update_price_feeds` against a hand-rolled `PriceInfoUpdate` struct, OR adjust the on-chain Pyth price by submitting an oracle-key-signed tx — both are out of scope for this runbook.

---

## Known issues affecting testing

- **Indexer `pools` table empty out of the box.** All `/get_pools`, `/orderbook/...`, `/trades/...`, `/ticker` routes return errors (in three different shapes). Drove Slot 1's chain-direct architectural pivot. See FEEDBACK.md §3 finding #1.
- **`pnpm deploy-all` does not `down -v` first.** Ran into this twice during cycle 1; the error mode is "indexer healthy, no pools visible". Always start from `docker compose down -v`. See FEEDBACK.md §3 finding #2.
- **`pnpm deploy-all` Phase 3 swallows publish errors.** When the bundled `token` package fails to publish, only build warnings are surfaced. See FEEDBACK.md §3 finding #3.
- **Pyth `:9010` is a status endpoint, not a price feed.** The keeper reads on-chain `PriceInfoObject`s and BCS-decodes them. See FEEDBACK.md §3 finding #4.
- **`deepbook_margin/tests/helper/test_helpers.move` references an undefined symbol.** Both Slot 2 and Slot 3 Move packages explicitly drop the `deepbook_margin` dependency to unblock `sui move test`. See FEEDBACK.md §3 finding #5.
- **TS LSP from worktree-root doesn't index sub-package node_modules.** Stale `Cannot find module 'react'/'vitest'` diagnostics throughout the build, even though `pnpm test` resolves cleanly. Trust the test runner, not the LSP. See FEEDBACK.md §2 finding #5.

For the full DevX evaluation see `FEEDBACK.md`.
