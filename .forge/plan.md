# SEDEFI-176 Independent Solution — Phase 0 Plan

This document is the output of Code Forge v2 Phase 0 for SEDEFI-176. It will be consumed by Phase 1 (planner in spec-and-e2e mode), which writes `.forge/spec.md` and `.forge/agent-config.md`.

Findings are marked `[verified]` (read from a file or curled an endpoint), `[inferred]` (reasoned from related evidence), or `[blocked]` (cannot be confirmed in Phase 0; carried as a Phase 1 validation gate).

---

## 1. Problem Summary

Build three independent DeepBook apps under `independent/` of `~/workspace/deepbook-sandbox-evaluation-apps`, plus `RUNBOOK.md` and `FEEDBACK.md`, as a second-pass DevX evaluation of the DeepBook Sandbox toolchain. The brief at `independent/faena.md` is mature; sections 1-12 already define scope, app picks (Slot 1 Market Stats, Slot 2 Slippage Swap, Slot 3 TP/SL Vault), execution order, validation, risks, and four open questions.

Phase 1 must turn this plan into a `spec.md` with concrete acceptance criteria + an `## E2E Tests` section (one scenario per app), an `agent-config.md` declaring `project_domains: [sui-dapp]` for sui-pilot routing on Move artifacts, and tee up Phase 2's cycle plan (likely 3 cycles + 1 docs cycle, see §2).

---

## 2. DevX Signal Position

**Resolution: Option A (Phase-F-style for documentation, source-attributed friction log).** The user has chosen "drive forge inline" (full pipeline) — that decision is upstream and not re-litigated here. The remaining contamination question is *how to keep the FEEDBACK signal clean within full-forge mode*.

**Operational rules for Phase 1 to encode:**

- Forge cycles cover **only the three buildable apps** (Slot 1 → Slot 2 → Slot 3). Three cycles, each with its own `contract.md → tests.json → red → green → consolidated-review`.
- `RUNBOOK.md` and `FEEDBACK.md` are **non-cycle deliverables** produced after the last app cycle passes. Treat them like Phase F artifacts (one consolidated review pass, no red/green).
- During every cycle, maintain `independent/raw-friction.log` — append-only, one observation per line, format:
  ```
  YYYY-MM-DDTHH:MM:SSZ | [source] | <one-sentence observation>
  ```
  where `[source]` is one of: `deepbook`, `sui-sdk`, `dapp-kit`, `move`, `sandbox`, `sui-pilot`, `forge-process`.
- The final `independent/FEEDBACK.md` is distilled from `raw-friction.log` and the post-cycle review notes. **Bullets tagged `[forge-process]` do NOT enter `FEEDBACK.md`** unless they reveal a DeepBook-relevant issue surfaced *through* orchestration (in which case re-tag to the DeepBook-relevant source).
- `independent/raw-friction.log` is committed alongside `FEEDBACK.md` as the audit trail.

This keeps DeepBook DevX signal separate from forge orchestration noise and gives downstream readers (Mysten Labs) a citation chain for every claim in `FEEDBACK.md`.

---

## 3. Relevant Findings

### Sandbox bootstrap [verified]

- Canonical command: `cd ~/workspace/deepbook-sandbox/sandbox && pnpm install && pnpm deploy-all`. Implemented in `sandbox/scripts/deploy-all.ts` (entry `tsx scripts/deploy-all.ts`).
- Deployment phases (per `deploy-all.ts:83-298`): client+keypair → faucet fund → publish Move packages (via `MoveDeployer`) → start indexer + REST server (docker compose) → create DEEP/SUI + SUI/USDC pools, set up Pyth oracles → start market maker.
- Required env vars (`sandbox/.env.example`): `PRIVATE_KEY`, `SUI_TOOLS_IMAGE` (default `mysten/sui-tools:compat-arm64`), `FORCE_REGENESIS` (default `"true"` — wipes state on every restart), `RUST_LOG`, optional `ORACLE_PRIVATE_KEY` and `MM_*` market-maker config.

### Service ports [verified]

| Service | Port | Notes |
|---|---|---|
| Sui RPC | 9000 | Localnet |
| Indexer REST | 9008 | Routes per §"Indexer REST" below |
| Sandbox faucet wrapper | 9009 | Sandbox's own; Sui's faucet sits at 9123 (per manifest `network.faucetUrl`) |
| Pyth oracle service | 9010 | **STATUS endpoint only** — see §"Pyth oracle" |
| Market maker | 3001 | Health |
| Dashboard | 5173 | Vite dev |

### Deployment manifest [verified]

Path: `sandbox/deployments/localnet.json`. Schema:

```json
{
  "network": {
    "type": "localnet",
    "rpcUrl": "http://127.0.0.1:9000",
    "faucetUrl": "http://127.0.0.1:9123"
  },
  "packages": {
    "<name>": {
      "packageId": "0x...",
      "objects": [{ "objectId": "0x...", "objectType": "0x...::module::Type" }],
      "transactionDigest": "..."
    }
  },
  "pools": {
    "<POOL_NAME>": { "poolId": "0x...", "baseCoinType": "0x...", "quoteCoinType": "0x..." }
  },
  "marginPools": { "<ASSET>": "0x..." },
  "pythOracles": {
    "deepPriceInfoObjectId": "0x...",
    "suiPriceInfoObjectId": "0x..."
  },
  "supplierCapId": "0x...",
  "deploymentTime": "ISO-8601",
  "deployerAddress": "0x..."
}
```

Packages published: `token`, `deepbook`, `pyth`, `usdc`, `deepbook_margin`, `margin_liquidation`.

Pools published: `DEEP_SUI`, `SUI_USDC` (per current local manifest; Phase 1 should enumerate dynamically).

Consumed in `dashboard/src/hooks/use-deepbook-client.ts:28-43` and `examples/sandbox/setup.ts:30-44`.

### Move dependency declaration pattern [verified]

`sandbox/packages/example_contract/Move.toml` (verbatim):

```toml
[package]
name = "example_contract"
edition = "2024"

[dependencies]
# Deepbook dependencies
token = { local = "../../.external-packages/token" }
deepbook = { local = "../../.external-packages/deepbook" }
deepbook_margin = { local = "../../.external-packages/deepbook_margin" }

# Pyth and USDC dependencies
pyth = { local = "../pyth" }
usdc = { local = "../usdc" }

[environments]
localnet = "a62c4e17"
```

Important: `edition = "2024"` for the example contract; the upstream DeepBook package itself uses `2024.beta`. Both work in the same build.

For `independent/02-slippage-swap` and `independent/03-tpsl-vault/move`, the dependency declaration must point at the same `.external-packages/` paths from the sandbox repo. **Phase 1 must decide whether to use absolute paths or symlinks** (relative paths from `independent/02-slippage-swap` to `~/workspace/deepbook-sandbox/sandbox/.external-packages/deepbook` work but are long).

### DeepBook Move-side swap signatures [verified]

Located at `~/workspace/deepbook-sandbox/sandbox/.external-packages/deepbook/sources/pool.move:248-430` (per explorer; line numbers approximate, family confirmed):

| Function | Signature | Returns | `min_out` semantics |
|---|---|---|---|
| `swap_exact_base_for_quote<Base, Quote>` | `(pool, base_in, deep_in, min_quote_out, clock, ctx)` | `(Coin<Base>, Coin<Quote>, Coin<DEEP>)` | `min_quote_out: u64` checks `quote_out.value() >= min_quote_out` |
| `swap_exact_base_for_quote_with_manager<Base, Quote>` | `(pool, &mut bm, &TradeCap, &DepositCap, &WithdrawCap, base_in, min_quote_out, clock, ctx)` | `(Coin<Base>, Coin<Quote>)` | same |
| `swap_exact_quote_for_base<Base, Quote>` | symmetric | `(Coin<Base>, Coin<Quote>, Coin<DEEP>)` | `min_base_out: u64` |
| `swap_exact_quote_for_base_with_manager<Base, Quote>` | symmetric | `(Coin<Base>, Coin<Quote>)` | same |
| `swap_exact_quantity<Base, Quote>` | bidirectional | `(Coin<Base>, Coin<Quote>, Coin<DEEP>)` | `min_out: u64` |

**Resolution of faena §11.4** (`min_out` units for Slot 2): `min_out` is the `u64` *value* (atomic units) of the output `Coin<Quote>` (or `Coin<Base>`, depending on direction). The DeepBook helper itself asserts `output_coin.value() >= min_out` internally — Slot 2's wrapper can reuse this guarantee, OR (preferred) it can re-assert post-call to surface a documented error code from our own module.

**Resolution of faena §11 BalanceManager risk for Slot 2:** the no-manager swap path (`swap_exact_base_for_quote`) creates an ephemeral `BalanceManager` internally (per `pool.move:389`) and deletes it (line 417). **Slot 2 does NOT need a `BalanceManager`.**

### Indexer REST endpoints [verified routes; blocked schemas]

Routes (from `external/deepbook/crates/server/src/server.rs:66-125`; not curled because sandbox is down at probe time):

```
GET /get_pools
GET /trades/:pool_name
GET /ticker
GET /orderbook/:pool_name
GET /ohclv/:pool_name
GET /orders/:pool_name/:balance_manager_id
GET /order_updates/:pool_name
GET /portfolio/:wallet_address
GET /assets
GET /summary
GET /fees
GET /deep_supply
GET /status
(+ margin endpoints: /margin_manager_created, /loan_borrowed, /liquidation, etc.)
```

Underlying store: PostgreSQL (`DATABASE_URL` defaults to `postgres://postgres:postgrespw@localhost:5432/deepbook`).

**[blocked]** Response shapes per route. Phase 1 must hit a running sandbox and capture verbatim payloads before writing TS types for Slot 1. Carry "indexer schema confirmed empirically against `:9008`" as an AC for Slot 1 in `spec.md`.

### Pyth oracle [verified]

Service at `:9010` is a **status endpoint only** (`oracle-service/index.ts:23` — `STATUS_PORT = 9010`).

Behavior:
- Fetches prices from the Pyth Benchmarks API (`https://benchmarks.pyth.network`).
- Calls `pythClient.fetchPriceUpdates()` (line 86) and submits on-chain updates to `PriceInfoObject`s every **10 seconds**.
- Required env: `PYTH_PACKAGE_ID`, `DEEP_PRICE_INFO_OBJECT_ID`, `SUI_PRICE_INFO_OBJECT_ID`, `USDC_PRICE_INFO_OBJECT_ID`, `ORACLE_PRIVATE_KEY`.

**Critical correction to faena §6 (Slot 3) and §10 (risks):** the keeper does NOT poll `:9010` for prices. It reads on-chain `PriceInfoObject`s (`deepPriceInfoObjectId` / `suiPriceInfoObjectId` from the manifest). The faena's "polls Pyth oracle service at :9010" assumption is wrong.

The keeper's price-read loop should be: poll `SuiClient.getObject(priceInfoObjectId)` → parse the Pyth `PriceInfoObject` BCS → extract price + exponent → compare to vault thresholds.

[inferred] Pyth's standard format applies: `price` (i64) + `expo` (i32) + `conf` (u64) + `publish_time` (u64). Confirm during Phase 1 by reading the on-chain object once.

### BalanceManager ownership [verified struct; partially inferred wrapping]

`balance_manager.move:42-47` (verbatim):

```move
public struct BalanceManager has key, store {
    id: UID,
    owner: address,
    balances: Bag,
    allow_listed: VecSet<ID>,
}
```

- `key + store` makes the struct technically wrappable inside another Move struct.
- However, the dashboard pattern (`balance-manager-setup.tsx`) and the market-maker (`market-maker/market-maker.ts:88-92`) both create a BM and **reference it by ObjectID**, not by wrapping. The PTB construction passes `&mut BalanceManager` by reference to swap-with-manager calls, which means the BM exists as a separate (typically shared or user-owned) object.
- Trading requires three caps: `TradeCap`, `DepositCap`, `WithdrawCap`. These are owned objects produced at BM creation.

**Resolution of faena §11.1 (Slot 3 Vault<T> shape):**

Two viable architectures, both shared-vault-compatible:

- **A. Vault holds funds; uses no-manager swap path.** `Vault<T>` is shared, holds `Balance<T>`, optional TP/SL prices, target pool ID, side, owner address. `execute_trigger` extracts a `Coin<T>` from `Balance<T>`, calls `swap_exact_base_for_quote` (no BM, ephemeral BM created internally), routes the output Coin back to the vault owner. **Simpler.** Pays ephemeral-BM gas overhead per trigger.

- **B. Vault holds funds + cap IDs; uses manager swap path.** Vault stores ObjectIDs of an external BM + caps. `execute_trigger` is a PTB built off-chain by the keeper that fetches the BM + caps, deposits funds, calls `swap_*_with_manager`, and emits an event. **More efficient at scale, but requires the keeper to manage cap delegation** and is meaningfully more complex.

**Phase 1 default: A.** Phase 1 should encode A unless evidence emerges during the Slot 3 contract phase that the no-manager path is unsuitable (e.g., excessive gas, missing return values). The shared-vault + ephemeral-BM combination removes the "can a shared object own a BM" question entirely.

### Sandbox stack pins [verified]

| Package | Sandbox | Dashboard | API |
|---|---|---|---|
| `@mysten/sui` | `^2.5.0` | `^2.14.1` | `^2.5.0` |
| `@mysten/deepbook-v3` | — | `^1.2.1` | `^1.1.5` |
| `@mysten/dapp-kit-react` | — | `^2.0.1` | — |
| `@mysten/dapp-kit-core` | — | `^1.2.2` | — |
| React | — | `19.2.0` | — |
| Vite | — | `7.3.1` | — |
| React Router | — | `7.13.1` | — |
| TypeScript | `^5.9.3` | `~5.9.3` | `^5.9.3` |
| Move edition | — | — | `2024` (example_contract); `2024.beta` (DeepBook) |

Slot 1 + Slot 3 UI should pin to the dashboard versions.

### Reference codepaths [verified]

- Slot 1 (no wallet, indexer reads): **No prior dashboard examples.** Dashboard reads the chain directly via SDK; it doesn't consume the indexer REST. Slot 1 is greenfield against the indexer.
- Slot 2 (Move + DeepBook): template = `sandbox/packages/example_contract/`. Mirror its `Move.toml` layout.
- Slot 3 keeper: closest analog = `sandbox/market-maker/market-maker.ts:45-124`. Patterns to lift:
  - `BalanceManagerService` wrapping (line 79).
  - `OrderManager` for pool-specific PTB construction (line 114-123).
  - 10s polling cadence (configurable via `MM_REBALANCE_INTERVAL_MS`).
- Slot 3 UI: `sandbox/dashboard/src/dapp-kit.ts:1-49` shows `dapp-kit-react ^2.0.1` setup; `useCurrentAccount()` + `useSignTransaction()` hooks are the entry points.
- Example CLI scripts at `sandbox/examples/sandbox/*.ts`: `setup.ts`, `place-market-order.ts`, `place-limit-order.ts`, `check-order-book.ts`, `query-user-orders.ts`, `swap-tokens.ts`. These are good Phase-1 reference for the SDK call shapes.

### Friction items already visible (pre-build) [verified]

- No indexer-read examples in dashboard ⇒ Slot 1 is from scratch (`[sandbox]`).
- `FORCE_REGENESIS=true` wipes state every restart ⇒ Slot 3 keeper iteration is painful (`[sandbox]`).
- Three swap return shapes (3-tuple no-manager, 2-tuple with-manager, plus `swap_exact_quantity` bidirectional) ⇒ developer must pick the right one (`[deepbook]`).
- Pyth oracle at `:9010` is a status endpoint, not a price feed — the faena brief itself is misleading on this point (`[sandbox]`, `[deepbook]`).
- `BalanceManager` documentation is implicit; the wrap-vs-reference pattern requires reading the dashboard source to discover (`[deepbook]`).

These should anchor the first round of `independent/raw-friction.log` entries before any code is written.

---

## 4. Constraints

Carry these into every Phase 1 prompt and every subagent prompt:

- **Independent work belongs under `independent/` only.** Nothing outside that directory.
- **Read-only sandbox dependency.** `~/workspace/deepbook-sandbox` may be inspected and run (e.g., `pnpm deploy-all`); **never modify**.
- **Localnet only.** No testnet/mainnet.
- **Forbidden-read boundary.** The repo root contains `01-orderbook-viewer/`, `02-fee-rebate-swap/`, `03-dca-vault/`, `FEEDBACK.md`, `RUNBOOK.md` from a prior solution.
  - Allowed: directory names, manifest metadata (`package.json` keys, `Move.toml` keys), framework identification from imports.
  - Forbidden: function bodies, README bodies, `FEEDBACK.md` body, `RUNBOOK.md` body, commit messages beyond first-line subjects, PR/branch descriptions.
  - **Do not dispatch any subagent or exploration pass over those existing-solution paths.** If accidentally crossed: stop, record the breach in `independent/FEEDBACK.md`.
- **Sui SDK 2.x stale-memory rule.** Any agent touching `@mysten/*` imports MUST read `.ts-sdk-docs/sui/migrations/sui-2.0/*.mdx` (auto-loaded by sui-pilot) before writing the import. Training memory is stale.
- **Stack pins** match the sandbox dashboard (see §3 "Sandbox stack pins").
- **Move dep on DeepBook** mirrors `sandbox/packages/example_contract/Move.toml` exactly.
- **sui-pilot routing.** `agent-config.md` must declare `project_domains: [sui-dapp]`. Move artifacts route to `sui-pilot:sui-pilot-agent`. Off-chain TS work is NOT sui-pilot-routed.

---

## 5. Assumptions, Unknowns, and Blockers

| Item | Status | Notes |
|---|---|---|
| Sandbox boots cleanly with `pnpm deploy-all` | resolved-from-evidence | Bootstrap script verified; localnet manifest exists and is well-formed. Latest deploy: 2026-04-27T16:15:19Z. |
| Indexer REST routes | resolved-from-evidence | Routes enumerated from `server.rs:66-125`. |
| Indexer REST response shapes | blocked-by-environment | Sandbox not running at Phase 0 probe time (Sui RPC down, indexer down). **Phase 1 gate:** spin sandbox, curl every Slot-1-relevant endpoint, capture verbatim payloads, then write TS types. |
| Pyth oracle output mechanism | resolved-from-evidence | On-chain `PriceInfoObject` updates every 10s; `:9010` is status only. Keeper reads chain. |
| Pyth `PriceInfoObject` field layout | deferred-with-rationale | Pyth standard format (price/expo/conf/publish_time) is well-documented in `.sui-docs/` and Pyth's published BCS schema. Confirm by reading one such object during Phase 1's Slot 3 red phase. |
| DeepBook swap signatures | resolved-from-evidence | Five-function family confirmed; return tuples + min_out semantics documented in §3. |
| Slot 2 `min_out` units | resolved-from-evidence | `u64` value of output Coin (`output_coin.value() >= min_out`). |
| Slot 3 Vault shape | resolved-from-evidence (default to A) | No-manager swap path sidesteps the BM-ownership question. Default A; revisit only if Slot 3 contract phase finds A insufficient. |
| Slot 1 pool selection | resolved-from-evidence | Enumerate from `sandbox/deployments/localnet.json` (default per faena §11.2). Manifest schema documented in §3. |
| Sandbox stack pins | resolved-from-evidence | Confirmed against `sandbox/{,dashboard/,api/}package.json`. |
| Move dep declaration | resolved-from-evidence | Exact pattern in §3; absolute paths `~/workspace/deepbook-sandbox/sandbox/.external-packages/...` work, but Phase 1 should pick a clean form (env var? symlink? absolute?). |
| BalanceManager wrappability | deferred-with-rationale | Has `key + store` so technically wrappable, but no precedent in the codebase. Slot 3 default A avoids the question. If B becomes necessary, this becomes a Phase 2 cycle deliverable. |
| BalanceManager + 3 caps relationship | resolved-from-evidence | Trade requires `&mut BM, &TradeCap, &DepositCap, &WithdrawCap`. Caps are produced at BM creation. |

---

## 6. Clarifications Needed

**None.** The DevX-eval contamination resolution defaults to Option A (§2). The four faena §11 questions resolve from evidence (§3, §5). If Phase 1's Slot 3 contract phase later finds Option A insufficient (e.g., the no-manager swap path doesn't work for a TP/SL flow because the keeper needs a custodial pattern), Phase 1 escalates back to the user via `AskUserQuestion`.

---

## 7. App-by-App Acceptance Criteria

Phase 1 may expand these into numerically-thresholded ACs in `spec.md`. Below are the minimum themes that must survive into the spec.

### Slot 1 — `independent/01-market-stats/`

- AC1: With sandbox up (`pnpm deploy-all` complete; indexer at `:9008`), `pnpm dev` boots Vite without runtime errors. Page renders in a browser.
- AC2: Page enumerates pools dynamically from `sandbox/deployments/localnet.json` (or a fetch-equivalent). Hard-coded pool IDs are a build failure.
- AC3: For each enumerated pool, the page shows: 24h volume, last price, mid-price, bid-ask spread, depth at ±1% from mid, sparkline of last 50 trades.
- AC4: The mid/spread/depth values are computed from L2 depth fetched from the indexer's `/orderbook/:pool_name` endpoint (or computed in-app from raw depth — Phase 1 picks one approach).
- AC5: The 24h volume is read from the indexer's `/ticker` or equivalent; the trade sparkline reads from `/trades/:pool_name`.
- AC6: TS types for indexer responses are derived from **empirically-captured payloads** (Phase 1 gate), not training memory or guesswork. Captured payloads (or links to them) live in `independent/01-market-stats/notes/indexer-schema.md`.
- AC7: At least one observation per source (`[deepbook]`, `[sandbox]`, `[sui-sdk]`) is logged to `independent/raw-friction.log` during the Slot-1 cycle.

### Slot 2 — `independent/02-slippage-swap/`

- AC1: `Move.toml` mirrors `sandbox/packages/example_contract/Move.toml`'s `[dependencies]` block (paths adjusted to point at the sandbox's `.external-packages/`). Edition `2024`.
- AC2: Module exports a single public entry function `swap_exact_in<Base, Quote>(pool: &mut Pool<Base, Quote>, coin_in: Coin<Base>, deep_in: Coin<DEEP>, min_out: u64, clock: &Clock, ctx: &mut TxContext): Coin<Quote>` (signature shape; Phase 1 may refine).
- AC3: Implementation calls `deepbook::pool::swap_exact_base_for_quote` (no-manager path, returns 3-tuple), asserts `output.value() >= min_out` post-call with a documented error code (e.g., `EInsufficientOutput`), returns the output `Coin<Quote>`. Drains/transfers leftovers (input residual, DEEP coin) to sender appropriately.
- AC4: `sui move build` exits 0 against the sandbox-bundled DeepBook package.
- AC5: `sui move test` passes at least two unit tests: one success path (output ≥ `min_out`), one assertion-failure path (output < `min_out` triggers the documented error code). Tests use the test-scenario pattern from `.move-book-docs/book/testing/test-scenario.md`.
- AC6: `sui-pilot:move-code-quality` reports no Move 2024 issues.
- AC7: At least one `[deepbook]` observation and one `[move]` observation logged to `raw-friction.log`.

### Slot 3 — `independent/03-tpsl-vault/`

**Move package** (`independent/03-tpsl-vault/move/`):

- AC1: `Vault<T>` is a shared object with fields: `id: UID`, `owner: address`, `balance: Balance<T>`, `tp_price: Option<u64>`, `sl_price: Option<u64>`, `pool_id: ID`, `side: u8`, plus a `triggered: bool` lifecycle flag.
- AC2: `create_vault<T>(coin: Coin<T>, pool_id: ID, side: u8, tp: Option<u64>, sl: Option<u64>, ctx)` constructs a shared `Vault<T>` from a deposited coin. Emits a `VaultCreated` event with the vault ID + key fields (so the keeper can subscribe).
- AC3: `withdraw<T>(vault: &mut Vault<T>, ctx)` is owner-only (asserts `tx_context::sender(ctx) == vault.owner`), aborts if `vault.triggered`, returns the full `Coin<T>` to sender.
- AC4: `execute_trigger<Base, Quote>(vault: &mut Vault<Base>, pool: &mut Pool<Base, Quote>, current_price: u64, deep_in: Coin<DEEP>, clock: &Clock, ctx: &mut TxContext)` is permissionless but condition-gated: aborts unless `(tp.is_some() && current_price >= tp) || (sl.is_some() && current_price <= sl)`. On success: drains `vault.balance`, calls `swap_exact_base_for_quote` (no-manager path), routes output `Coin<Quote>` to `vault.owner`, sets `vault.triggered = true`, emits `TriggerFired` event.
- AC5: At least four unit tests: TP fires, SL fires, neither fires (abort), withdraw before fire (success), withdraw after fire (abort).
- AC6: `sui move build && sui move test` pass; `sui-pilot:move-code-quality` reports no issues.

**Keeper** (`independent/03-tpsl-vault/keeper/`):

- AC7: TS + Node.js. Imports `@mysten/sui ^2.14.1` and `@mysten/deepbook-v3 ^1.2.1` (matching sandbox dashboard pins).
- AC8: Maintains a list of known `Vault<T>` object IDs by subscribing to `VaultCreated` events on the deployed package (or by polling the package's transactions).
- AC9: Polls Pyth `PriceInfoObject`s on-chain (manifest's `pythOracles.deepPriceInfoObjectId` / `suiPriceInfoObjectId`) every 5-10 seconds, parses price + expo.
- AC10: For each known vault, evaluates trigger condition. On fire: builds a PTB calling `execute_trigger`, signs with an ephemeral keeper key, submits.
- AC11: Logs every poll cycle and every fire to stdout in a structured format.
- AC12: One end-to-end demo: start sandbox → publish `tp_sl_vault` package → keeper running → user creates vault with TP via UI → manually push price past TP (e.g., direct on-chain Pyth update or a market-mover trade) → observe keeper detect, fire, and UI update.

**UI** (`independent/03-tpsl-vault/ui/`):

- AC13: React + Vite + `@mysten/dapp-kit-react ^2.0.1`. Connect-wallet button works against the sandbox's auto-loaded dev wallet.
- AC14: Lists user's vaults (filter by `owner == currentAccount.address`).
- AC15: "Create vault" form: coin type, amount, target pool, side, TP price (optional), SL price (optional). Submits a PTB. On success, the new vault appears in the list within one polling interval.
- AC16: "Withdraw" button on each non-triggered vault. Posts an owner-only PTB. On success, the vault disappears from the list.
- AC17: Triggered vaults render with a clear "Triggered" badge + the output amount routed to the owner.

**Cross-component AC18:** `independent/raw-friction.log` accumulates ≥1 entry per source category by the end of the Slot 3 cycle.

---

## 8. Ordered Implementation Plan

Phase 1's `cycle-plan.md` should reflect this ordering.

1. **Pre-cycle setup.** Verify sandbox can boot. Run `pnpm deploy-all` once; capture the resulting `sandbox/deployments/localnet.json` for reference. Record any bootstrap friction in `raw-friction.log`. **Decision gate:** if sandbox doesn't boot cleanly, escalate to user before starting cycles.
2. **Cycle 1 — Slot 1 (Market Stats).** Phase-1-required empirical sub-step: curl every relevant indexer endpoint with sandbox up; save payloads to `01-market-stats/notes/indexer-schema.md`. THEN write TS types. Cycle ordering follows forge defaults (contract → tests → red → green → review).
3. **Cycle 2 — Slot 2 (Slippage Swap).** Mirror `example_contract/Move.toml` exactly. Implement single entry, two unit tests. Run `sui move build && sui move test` + `sui-pilot:move-code-quality`.
4. **Cycle 3 — Slot 3 (TP/SL Vault).** Sub-order: Move package → keeper → UI. Each layer must end-to-end against the running sandbox before the next is wired up. **Decision gate:** if Slot 3 contract phase finds Option A (no-manager) insufficient, escalate via `AskUserQuestion` before pivoting to Option B.
5. **Post-cycle — RUNBOOK.** Treat as a single review-only pass. Write `independent/RUNBOOK.md` with copy-pasteable commands per app, derived from the verified bootstrap + per-app commands in §10.
6. **Post-cycle — FEEDBACK.** Distill `independent/raw-friction.log` into the three required sections (working well / can be improved / not working). Drop `[forge-process]` entries unless they reveal a DeepBook-relevant issue. One review pass.

Decision gates (carry into Phase 2):

- G-Boot: sandbox boots cleanly. If not, halt.
- G-Schema: indexer schema captured empirically before Slot 1 TS types are written.
- G-Vault: Slot 3 contract uses no-manager swap path; abandon only with `AskUserQuestion` user-confirm.

---

## 9. Impacted Files and Modules

Expected `independent/` tree after all cycles + post-cycle docs complete:

```
independent/
├── faena.md                                   (already exists)
├── raw-friction.log                           (new — append-only during build)
├── 01-market-stats/
│   ├── package.json                           (pnpm, vite, react, @mysten/sui)
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── notes/
│   │   └── indexer-schema.md                  (empirical payloads, captured Phase 1)
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── manifest.ts                        (loads sandbox/deployments/localnet.json)
│       ├── indexer.ts                         (typed REST client)
│       └── pool-card.tsx
├── 02-slippage-swap/
│   ├── Move.toml
│   ├── sources/
│   │   └── slippage_swap.move
│   └── tests/
│       └── slippage_swap_tests.move
├── 03-tpsl-vault/
│   ├── move/
│   │   ├── Move.toml
│   │   ├── sources/
│   │   │   └── tp_sl_vault.move
│   │   └── tests/
│   │       └── tp_sl_vault_tests.move
│   ├── keeper/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                       (entry)
│   │       ├── price-poller.ts                (reads on-chain PriceInfoObjects)
│   │       └── vault-watcher.ts               (subscribes to VaultCreated events)
│   └── ui/
│       ├── package.json                       (vite, react, @mysten/dapp-kit-react)
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── dapp-kit.ts                    (mirrors sandbox/dashboard/src/dapp-kit.ts)
│           └── vault-list.tsx
├── RUNBOOK.md
└── FEEDBACK.md
```

External reference points (read-only; Phase 1 will inspect or mirror):

- `~/workspace/deepbook-sandbox/sandbox/scripts/deploy-all.ts` — bootstrap order
- `~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json` — manifest shape
- `~/workspace/deepbook-sandbox/sandbox/packages/example_contract/Move.toml` + `sources/example_contract.move` — Slot 2 template
- `~/workspace/deepbook-sandbox/sandbox/.external-packages/deepbook/sources/pool.move` — DeepBook swap signatures (read for Slot 2 + Slot 3)
- `~/workspace/deepbook-sandbox/sandbox/.external-packages/deepbook/sources/balance_manager.move` — BalanceManager type
- `~/workspace/deepbook-sandbox/external/deepbook/crates/server/src/server.rs` — indexer routes
- `~/workspace/deepbook-sandbox/sandbox/oracle-service/index.ts` — oracle service shape
- `~/workspace/deepbook-sandbox/sandbox/market-maker/market-maker.ts` — keeper analog for Slot 3
- `~/workspace/deepbook-sandbox/sandbox/dashboard/src/dapp-kit.ts` — dapp-kit-react setup template for Slot 3 UI
- `~/workspace/deepbook-sandbox/sandbox/dashboard/src/hooks/use-deepbook-client.ts` — manifest consumption pattern
- `~/workspace/deepbook-sandbox/sandbox/examples/sandbox/*.ts` — SDK call shapes (`setup.ts`, `place-market-order.ts`, `swap-tokens.ts`, etc.)

NOT to be inspected (forbidden-read boundary): `~/workspace/deepbook-sandbox-evaluation-apps/{01-orderbook-viewer,02-fee-rebate-swap,03-dca-vault,FEEDBACK.md,RUNBOOK.md}`.

---

## 10. Testing and Validation

### Sandbox bootstrap (one-shot, before Cycle 1)

```sh
cd ~/workspace/deepbook-sandbox/sandbox
pnpm install
pnpm deploy-all
# Verify after completion:
curl -s http://127.0.0.1:9000     # Sui RPC
curl -s http://localhost:9008/get_pools | head -c 500
curl -s http://localhost:9010/    # Oracle status
ls -la sandbox/deployments/localnet.json
```

### Per-app commands

| App | Install | Dev | Build | Test |
|---|---|---|---|---|
| Slot 1 (`independent/01-market-stats/`) | `pnpm install` | `pnpm dev` | `pnpm build` | n/a (manual browser check) |
| Slot 2 (`independent/02-slippage-swap/`) | n/a | n/a | `sui move build` | `sui move test` |
| Slot 3 Move (`independent/03-tpsl-vault/move/`) | n/a | n/a | `sui move build` | `sui move test` |
| Slot 3 Move publish | n/a | `sui client publish --gas-budget 200000000` | n/a | n/a |
| Slot 3 keeper (`independent/03-tpsl-vault/keeper/`) | `pnpm install` | `pnpm dev` (or `pnpm tsx src/index.ts`) | `pnpm build` | n/a |
| Slot 3 UI (`independent/03-tpsl-vault/ui/`) | `pnpm install` | `pnpm dev` | `pnpm build` | n/a (manual browser check) |

### Empirical-confirmation gates (Phase 1 must pass these before sealing Slot-1/Slot-3 specs)

- **G-Schema (Slot 1):** With sandbox up, curl every Slot-1-relevant indexer endpoint and capture verbatim payloads to `independent/01-market-stats/notes/indexer-schema.md`. TS types in Slot 1 derive from this file.
- **G-Pyth (Slot 3):** With sandbox up, fetch the on-chain `PriceInfoObject` (`sandbox/deployments/localnet.json` → `pythOracles.suiPriceInfoObjectId`) once via `SuiClient.getObject(id, { showContent: true })`; document the field layout in `independent/03-tpsl-vault/keeper/notes/pyth-shape.md`.
- **G-Swap (Slot 2):** Confirm the no-manager swap signature with a one-liner unit test that calls it against a test pool. Asserts `min_out` semantics by deliberately failing once.

---

## 11. Risks and Rollout Concerns

| Risk | Mitigation |
|---|---|
| `FORCE_REGENESIS=true` wipes state on every sandbox restart | All notes / friction logs live OUTSIDE the sandbox. Vault objects + keeper state are ephemeral by design. Phase 1 should NOT design any flow that assumes durable sandbox state across restarts. |
| Pyth oracle service downtime | Keeper logs + retries; mark `[sandbox]` in raw-friction.log. Not a build blocker — the keeper handles missing prices by skipping that poll cycle. |
| Off-chain keeper key management | Generate ephemeral keypair on keeper boot. Never reuse. Localnet only. |
| Sui SDK 2.x breaking changes vs. training memory | sui-pilot bundled docs MUST be read before any `@mysten/*` import. Hard rule. |
| DeepBook SDK API drift (sandbox: `^1.1.5` vs dashboard `^1.2.1`) | Pin all UI/keeper to `^1.2.1`. Justification: dashboard is already proven against the sandbox. |
| Indexer REST schema doesn't match our assumptions | G-Schema (§10) catches this before TS types are written. |
| Slot 3 no-manager swap turns out unsuitable mid-build | G-Vault decision gate (§8) — pause and escalate via `AskUserQuestion` before pivoting to Option B. |
| Move dep declaration breaks when paths change | Use absolute paths (`~/workspace/deepbook-sandbox/sandbox/.external-packages/...`) to make the dependency explicit; document in each `Move.toml` comment. |
| FEEDBACK signal contamination by forge-process noise | Source-attribution scheme (§2). `[forge-process]` entries are filtered out unless DeepBook-relevant. |
| Bias risk: temptation to peek at existing solution mid-build | Re-read §4 forbidden-read boundary at the start of every cycle. |
| Sandbox not currently running when Phase 1 begins | Phase 1's first action: probe `:9000`, `:9008`, `:9010`. If down, run `pnpm deploy-all` (allowed; not a sandbox modification). |

---

## 12. Notes for Phase 1

Pre-flags Phase 1 must respect when writing `spec.md` and `agent-config.md`:

- **`agent-config.md`:**
  - `project_domains: [sui-dapp]` (forge-guard rule 6 routes Move-related dispatches to `sui-pilot:sui-pilot-agent`).
  - `required_subagents`:
    - All `*.move` and `Move.toml` artifacts → `sui-pilot:sui-pilot-agent`.
    - All TS/TSX under `independent/` → general implementer/reviewer (not sui-pilot — these are off-chain).
  - `recommended_agents`: standard forge roster (planner, test-author, implementer, implementer-worker, reviewer, consolidator) plus `Explore` for any cross-cycle investigation.

- **`spec.md` structure:**
  - Restate the three apps as three implementation cycle units.
  - Lift the AC1-AC18 from §7 into per-cycle sections.
  - Include an `## E2E Tests` section with at least one scenario per app:
    - **Slot 1 e2e:** "With sandbox up, navigating to slot 1's `/` shows mid-price for at least one pool within 10 seconds and the sparkline updates within 30 seconds of a fresh trade." (Chrome MCP-driven.)
    - **Slot 2 e2e:** "After publishing the slot 2 package against the sandbox, calling its entry function via `sui client call` with `min_out` greater than achievable output aborts with the documented error code." (CLI-driven.)
    - **Slot 3 e2e (highest value):** "Create a vault with TP=X via UI; manually push price past X (via direct sandbox tooling); observe keeper fire trigger within one polling interval; UI shows triggered state with output coin routed." (Chrome MCP + harness.)
  - Encode the source-attribution scheme + `independent/raw-friction.log` requirement as part of the cross-cycle invariants.

- **Cycle plan tee-up (for Phase 2):**
  - 3 cycles (one per slot) + 1 docs-pass cycle (RUNBOOK + FEEDBACK), or treat docs as a Phase F-shaped post-cycle pass. Recommend: keep docs as a post-cycle pass (no red/green; one consolidated review).
  - Cycle 3 (Slot 3) is the largest; consider splitting into sub-cycles (3a Move → 3b Keeper → 3c UI) if the planner thinks one cycle is too coarse.

- **Decision gates** (encode in spec.md as pre-cycle checkpoints):
  - G-Boot before Cycle 1.
  - G-Schema before Cycle 1's red phase.
  - G-Pyth before Cycle 3's red phase.
  - G-Vault inside Cycle 3's contract phase (only if no-manager path proves insufficient).

- **Source attribution:** `FEEDBACK.md` bullets must cite a `raw-friction.log` line by timestamp. The `[forge-process]` filter rule is a *consolidator* responsibility during the post-cycle docs pass.
