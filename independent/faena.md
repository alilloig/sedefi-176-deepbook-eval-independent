# faena.md — SEDEFI-176 Independent Solution

## Title & purpose

This document is a self-contained handoff brief for the next session (Claude Code or human) that will execute Linear ticket **SEDEFI-176 — Deepbook Sandbox UX/DevX evaluation with Claude** as an *independent* solution. It is intended to be readable cold, with no access to the conversation in which it was written. The repository at `~/workspace/deepbook-sandbox-evaluation-apps` already contains a previously-built solution at the repo root (`01-orderbook-viewer/`, `02-fee-rebate-swap/`, `03-dca-vault/`, `FEEDBACK.md`, `RUNBOOK.md`). That existing work has been intentionally **left untouched and unread** so that this independent solution can be evaluated on its own merits and then compared.

Everything for the independent solution lives under `independent/` (this directory).

## 1. Context

[verified] Linear ticket: <https://linear.app/mysten-labs/issue/SEDEFI-176/deepbook-sandbox-uxdevx-evaluation-with-claude>

**Ticket summary** (verbatim from Linear):

> Give Claude context regarding the Sandbox project. Ask it to create 3 apps of scaling complexity:
> 1. Simple view frontend client
> 2. Simple Move Contract with deepbook dependency
> 3. More complex use case including both Move Contract and frontend client
>
> Then ask from Claude to test the 3 apps or provide a runbook for testing them, using Sandbox.
>
> **Acceptance Criteria** — Provide a detailed feedback document about the DevX from the above testing sessions:
> - A section about what is working well
> - A section about what can be improved
> - A section about what is not working / needs fix or refactoring

[verified] Ticket metadata: assignee Álvaro Lillo Igualada, project "Deepbook Sandbox", team "SolEng - DeFi Pod", estimate 3 points, status "Design & Preparation", started 2026-04-23.

**What is being measured.** Claude Code's developer experience while building real DeepBook applications. We are *not* shipping production apps; we are exercising the toolchain (Sui SDK 2.x, DeepBook v3 SDK, dapp-kit, Move 2024, sui-pilot bundled docs, the sandbox itself) and capturing concrete friction.

**Why an "independent" take?** The repo already contains one set of conclusions (`FEEDBACK.md`, `RUNBOOK.md`). A second, independently-built solution gives Mysten Labs two data points instead of one — and lets the team see where two evaluators converge or disagree on DevX problems. The independent solution must therefore avoid being colored by the existing one.

## 2. Scope

[verified] Three apps, scaling in complexity, plus a runbook and a structured FEEDBACK doc.

**Output structure under `independent/`:**

```
independent/
├── faena.md                       (this document)
├── 01-market-stats/               (slot 1: simple view frontend)
├── 02-slippage-swap/              (slot 2: simple Move contract)
├── 03-tpsl-vault/                 (slot 3: Move + keeper + UI)
├── RUNBOOK.md                     (how to test all three apps)
└── FEEDBACK.md                    (DevX evaluation, three required sections)
```

**Complexity bracket per slot:**

- **Slot 1** — single-route React + Vite app, no wallet, ~200-300 LOC TypeScript.
- **Slot 2** — single Move 2024 module, one entry function + one unit test, ~100-150 LOC Move.
- **Slot 3** — Move package + Node.js keeper + React UI, ~400-500 LOC combined.

These brackets match the existing solution's footprint (see §5).

## 3. Operating rules

1. **Do not read** the existing solution's substantive content. Allowed: directory names, manifest metadata, framework identification from imports. Forbidden: README bodies, source function bodies, `FEEDBACK.md` body, `RUNBOOK.md` body, commit messages beyond first-line subjects, PR descriptions, branch descriptions.
2. If forbidden content is accidentally encountered, stop reading and note the boundary.
3. The DeepBook sandbox at `~/workspace/deepbook-sandbox` is **fully in scope** to inspect and run.
4. The sui-pilot plugin auto-loads bundled docs (`.sui-docs/`, `.move-book-docs/`, `.ts-sdk-docs/`, `.seal-docs/`, `.walrus-docs/`). Use them. Don't rely on training memory for Sui/Move APIs.
5. Localnet only. Do not deploy to testnet/mainnet.
6. Do not modify the sandbox repo (`~/workspace/deepbook-sandbox`). Treat it as a read-only dependency.
7. When a question arises that materially affects the build, use `AskUserQuestion`. Don't improvise around ambiguity in scope.

## 4. DeepBook sandbox findings

[verified] Location: `~/workspace/deepbook-sandbox`. Monorepo with `sandbox/` (main app), `external/deepbook/` (git submodule), `examples/`, `packages/`. No root `package.json`; `sandbox/` is the workspace root.

### Stack

| Concern | Value | Source |
|---|---|---|
| Package manager | pnpm | Dockerfiles use `corepack enable` |
| Frontend | React 19.2.0 + React Router 7.13.1 + Vite 7.3.1 | `sandbox/dashboard/package.json` |
| Sui SDK | `@mysten/sui` `^2.5.0` (sandbox) / `^2.14.1` (dashboard) | sandbox + dashboard `package.json` |
| DeepBook SDK | `@mysten/deepbook-v3` `^1.2.1` (dashboard), `^1.1.5` (api/examples) | per-workspace `package.json` |
| Wallet kit | `@mysten/dapp-kit-react ^2.0.1`, `@mysten/dapp-kit-core ^1.2.2` | dashboard `package.json` |
| Other Mysten | `@mysten/signers ^1.0.2`, `@mysten/wallet-standard ^0.20.1` | dashboard `package.json` |
| Move edition | 2024.beta (primary), 2024.alpha (margin) | `Move.toml` files in `sandbox/.external-packages/` |
| Indexer | Rust + PostgreSQL 16 | `external/deepbook/crates/indexer/` |
| API server | Rust | `external/deepbook/crates/server/` |
| Faucet | Node.js + Hono, port 9009 | `sandbox/api/` |
| Market maker | Node.js grid strategy, port 3001 | `sandbox/` (script: `pnpm market-maker`) |
| Oracle | Node.js Pyth price updater, port 9010 | `sandbox/` (script: `pnpm oracle-service`) |
| Orchestration | docker-compose.yml | `sandbox/docker-compose.yml` |

### Bootstrap sequence

[verified] Single command: `cd ~/workspace/deepbook-sandbox/sandbox && pnpm install && pnpm deploy-all`.

`pnpm deploy-all` (per `sandbox/scripts/deploy-all.ts`):
1. Starts a fresh Sui localnet at `http://127.0.0.1:9000`.
2. Publishes Move packages (`deepbook`, `token`, `deepbook_margin`, `margin_liquidation`, `pyth`, `usdc`, `example_contract`).
3. Creates pools (DEEP/SUI, SUI/USDC).
4. Starts the indexer, API server, faucet, oracle, market maker.
5. Auto-opens the dashboard at `http://localhost:5173`.

[verified] Required env (`sandbox/.env.example`): `PRIVATE_KEY`, `SUI_TOOLS_IMAGE`, `FORCE_REGENESIS` (default true), `RPC_URL` (default `http://127.0.0.1:9000`). The deploy script auto-populates `DEEPBOOK_PACKAGE_ID`, `DEEP_TOKEN_PACKAGE_ID`, `DEEP_TREASURY_ID`, `MARGIN_PACKAGE_ID`, `ORACLE_PRIVATE_KEY`, `FIRST_CHECKPOINT`.

[verified] Manifest discovery hook: `sandbox/dashboard/src/hooks/use-deepbook-client.ts` reads the auto-generated deployment manifest at `sandbox/deployments/localnet.json`.

### Service endpoints

| Service | Port | Notes |
|---|---|---|
| Sui RPC | 9000 | localnet |
| Indexer REST | 9008 | proxied via dashboard nginx at `/api/deepbook` |
| Faucet | 9009 | distributes SUI, DEEP, USDC |
| Oracle | 9010 | Pyth price updater |
| Market maker health | 3001 | grid strategy |
| Dashboard | 5173 | Vite dev server |

### DeepBook v3 surface area exposed in the sandbox

[verified] from sandbox source paths:

- **Pool ops** — creation `sandbox/.../pool.ts:90-150`; queries `sandbox/.../pool.ts:160-200`.
- **Order placement** — limit `order-manager.ts:20-80`, market `examples/sandbox/place-market-order.ts:35-60`.
- **Balance manager** — creation in `dashboard/src/components/trading/action-cards.tsx:15-40` (PTB bundles `balance_manager::new` + `register_balance_manager`); deposit/withdraw via SDK helper in `dashboard/src/components/trading/hooks.ts`.
- **Direct swaps** — `examples/sandbox/swap-tokens.ts:20-50` (wallet → pool, no BalanceManager).
- **Indexer queries** — REST at `:9008`, server at `external/deepbook/crates/server/`.
- **Reference Move package depending on DeepBook** — `sandbox/packages/example_contract/sources/`.

[inferred] Not surfaced as examples (need to confirm in build session):
- Flash loans
- Staking & governance

### Existing dashboard reference flows

[verified]:
- `/` — health monitor (RPC, indexer, oracle, market maker, faucet).
- `/market-maker` — order book viz (recharts) + active bid/ask levels + grid config.
- `/trading` — wallet connect, BalanceManager creation, deposit/withdraw, market/limit orders, open orders list.
- `/faucet` — distribute SUI/DEEP/USDC to connected wallet.
- `/deployment` — package IDs, pool addresses, Pyth oracle objects.

### Example CLI scripts (`examples/sandbox/`)

- `check-order-book.ts` — read-only L2 depth + mid price.
- `swap-tokens.ts` — direct SUI→DEEP swap.
- `place-limit-order.ts` — BID order lifecycle.
- `place-market-order.ts` — market BUY/SELL.
- `query-user-orders.ts` — full lifecycle (place / query / cancel).

### Constraints & quirks

- **Localnet only.** Hardcoded to `127.0.0.1:9000`. No testnet/mainnet toggle.
- **Wallet required** for any trading flow on the dashboard.
- **BalanceManager mandatory** for orders. Direct swaps don't need one.
- **`FORCE_REGENESIS=true`** by default — restarting the sandbox wipes all state. Keep notes outside the sandbox.
- **Dev wallet auto-loads** the deployer key in dashboard via `dapp-kit.ts` for convenience — fine for localnet, never replicate for real networks.
- **No AI tooling wired into the sandbox itself** — sui-pilot lives in this repo's Claude environment, not in the sandbox.

## 5. Existing-solution category map

[verified] from manifest inspection only. **Source bodies, READMEs, FEEDBACK.md, and RUNBOOK.md were intentionally not read.**

| Slot | Path | Category | Stack | Rough size | Confidence |
|---|---|---|---|---|---|
| 1 | `01-orderbook-viewer/` | Frontend orderbook viewer | React 18 + TypeScript + Vite | ~228 LOC TS/TSX | High |
| 2 | `02-fee-rebate-swap/` | Move contract: fee/rebate swap | Move 2024 | ~124 LOC Move | High |
| 3 | `03-dca-vault/` | DCA vault: Move + TS keeper + React UI | Move 2024 + Node.js + React | ~124 Move + ~171 keeper TS + ~167 UI TS/TSX | High |

**Repo-root non-app artifacts** (existence noted only):
- `FEEDBACK.md` — existing DevX evaluation document. **Not read.**
- `RUNBOOK.md` — existing operational/test runbook. **Not read.**
- `.gitignore` — standard.

**Intentionally not inspected** during preparation:
- `FEEDBACK.md` body, `RUNBOOK.md` body, README bodies of any of the three apps.
- Source function bodies in any existing app.
- Commit messages beyond the first-line subject (`first commit`).
- Any PR/branch descriptions.

## 6. Locked-in app picks

Each pick is comparably complex to its corresponding existing slot, and exercises a **different DeepBook surface** so the eventual feedback is additive rather than duplicative.

### Slot 1 — Public Market Stats page

**Goal.** Single-route React + Vite app showing aggregate stats across DeepBook pools on the running sandbox: 24h volume per pool, last price, mid-price, bid-ask spread, depth at ±1% from mid, and a small sparkline of the last 50 trades.

**Components:**
- One Vite + React app under `independent/01-market-stats/`.
- Polls the indexer REST API (`http://localhost:9008`) for trade history and 24h aggregates.
- Polls Sui RPC (`http://127.0.0.1:9000`) — or the indexer — for live order book snapshots to compute mid/spread/depth.
- No wallet connection. No `dapp-kit-react`. Plain `@mysten/sui/jsonRpc` client + `fetch`.

**Why this differs from `01-orderbook-viewer`.** The existing slot-1 app is a single-pool live order book viewer. This one is a **cross-pool aggregate** view that exercises the **indexer integration** path (REST queries, JSON parsing, time-series rendering) instead of pure live-RPC reads. Different DevX surface, same complexity envelope.

**DeepBook surface exercised:**
- DeepBook indexer REST: trade history, 24h aggregates.
- Sui RPC: pool object reads for L2 depth.
- Multi-pool iteration (read manifest from `sandbox/deployments/localnet.json` to discover pool object IDs).
- Mid-price + spread calculation from L2 depth.

### Slot 2 — Slippage-protected single-hop swap module

**Goal.** A Move 2024 package with one module and one entry function that wraps DeepBook v3's swap with a slippage check.

**Approximate signature:**

```move
public entry fun swap_exact_in<Base, Quote>(
    pool: &mut Pool<Base, Quote>,
    coin_in: Coin<Base>,
    min_out: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<Quote>
```

Calls DeepBook's `swap_exact_*` helper, asserts `coin::value(&coin_out) >= min_out`, returns the output coin (or transfers to sender — pick the simpler form per current SDK).

**Components:**
- `independent/02-slippage-swap/Move.toml` (edition `2024`, depends on the DeepBook Move package via local path or git, mirroring how `sandbox/packages/example_contract/Move.toml` declares its dependency).
- `independent/02-slippage-swap/sources/slippage_swap.move` (the module).
- `independent/02-slippage-swap/tests/slippage_swap_tests.move` — one test that exercises the success path against a fake pool, one that exercises the assertion failure.

**Why this differs from `02-fee-rebate-swap`.** Rebate logic is an *economic* layer over swaps (state, accounting). Slippage protection is a *safety* wrapper (one assert, no state). Same scaffold, different developer concern, identical complexity envelope. Both depend on the same DeepBook Move package.

**DeepBook surface exercised:**
- Move-side dependency on `@mysten/deepbook-v3` Move package.
- `swap_exact_*` entry call from a custom module.
- Hot-potato `Coin` flow.
- `Move.toml` dependency declaration patterns.

### Slot 3 — Stop-Loss / Take-Profit (TP/SL) order vault

**Goal.** A composed system: users deposit a coin into a vault, set TP and/or SL trigger prices, and a keeper service auto-executes a market order on a designated DeepBook pool when triggers fire.

**Components:**

**Move contract** (`independent/03-tpsl-vault/move/`):
- `tp_sl_vault::Vault<T>` — shared (or owned, design choice — see open question 1) object holding the user's `Balance<T>`, an optional `tp_price: u64`, an optional `sl_price: u64`, the target `pool_id`, the side (`BID`/`ASK`), and the owner address.
- `create_vault<T>(coin: Coin<T>, pool_id: ID, side: u8, tp: Option<u64>, sl: Option<u64>, ctx)` — constructor.
- `withdraw<T>(vault: &mut Vault<T>, ctx)` — owner-only, returns the coin if not yet triggered.
- `execute_trigger<Base, Quote>(vault, pool, current_price, ...)` — permissioned (or public-with-condition); requires `(tp.is_some() && current_price >= tp) || (sl.is_some() && current_price <= sl)`; atomically calls DeepBook market order.
- One unit test for each path (deposit/withdraw, TP fires, SL fires, neither fires).

**Keeper** (`independent/03-tpsl-vault/keeper/`):
- Node.js + TypeScript + `@mysten/sui/jsonRpc`.
- Polls the sandbox Pyth oracle service at `http://localhost:9010` for current price (or DeepBook indexer mid-price as fallback).
- Maintains a list of vault object IDs (subscribed via dynamic field iteration or via an event-emitting registry — pick one).
- Submits `execute_trigger` PTBs when conditions meet.

**UI** (`independent/03-tpsl-vault/ui/`):
- React + Vite + `@mysten/dapp-kit-react ^2.0.1`.
- Connect wallet, list user's vaults, create new vault (deposit + set TP/SL), cancel/withdraw, see fired triggers.

**Why this differs from `03-dca-vault`.** DCA is **time-triggered** and predictable; the keeper just watches the clock. TP/SL is **price-triggered** and reactive; the keeper must integrate with the **Pyth oracle** (which the sandbox already runs at `:9010`). Same architectural shape (Move + keeper + UI), but different external integration and different on-chain trigger logic. Surfaces a different DevX layer.

**DeepBook surface exercised:**
- Market order placement from a contract context.
- Likely BalanceManager required — confirm in build (see §10 risk).
- Oracle integration (Pyth via the sandbox's running service).
- Escrow + permissioned trigger pattern.
- Multi-component coordination (on-chain ↔ keeper ↔ UI).

## 7. Suggested execution sequence

1. **Bootstrap the sandbox** — `cd ~/workspace/deepbook-sandbox/sandbox && pnpm install && pnpm deploy-all`. Confirm:
   - Dashboard at `http://localhost:5173`.
   - Indexer REST at `http://localhost:9008`.
   - Oracle at `http://localhost:9010`.
   - `sandbox/deployments/localnet.json` exists with `DEEPBOOK_PACKAGE_ID` and pool object IDs.
2. **Slot 1 first** (Market Stats) — fastest feedback loop, no wallet, validates the indexer integration path, single Vite app.
3. **Slot 2 second** (Slippage Swap) — `sui move new`, set `edition = "2024"`, depend on DeepBook Move package (mirror `sandbox/packages/example_contract/Move.toml`), write entry + tests, `sui move build && sui move test`.
4. **Slot 3 last**, in this order: Move contract → keeper → UI. Each layer should run end-to-end before the next is wired up.
5. **`independent/RUNBOOK.md`** — clone-to-test instructions for all three apps. Aim for a copy-pasteable command sequence per app.
6. **`independent/FEEDBACK.md`** — three required sections (working well / can be improved / not working — needs fix or refactoring) with ≥3 concrete bullets each, sourced from a friction log kept during the build.
7. **Stop and ask** if any of these emerges:
   - DeepBook v3 Move-side API doesn't expose what slot 2 needs.
   - BalanceManager is mandatory for slot 3's market order *and* can't be owned by a shared object.
   - Pyth oracle output format isn't usable from the keeper without significant adaptation.

## 8. Constraints & non-goals

**Constraints:**
- Localnet only.
- Don't modify `~/workspace/deepbook-sandbox`. Read-only dependency.
- Don't read the existing solution's substantive content (see §5).
- pnpm. TypeScript. Move 2024.
- Each app must run end-to-end against the running sandbox; otherwise it doesn't count.

**Non-goals:**
- Production hardening (auth, error UX, retries beyond minimal, observability).
- Mainnet/testnet deployment.
- Optimizing gas, indexer load, or keeper latency.
- Beating or being "better than" the existing solution. Independence ≠ competition.
- Building anything outside `independent/`.

## 9. Validation plan

The work is "meaningfully evaluated" if all of the following hold:

1. All three apps run end-to-end per `independent/RUNBOOK.md` against a fresh `pnpm deploy-all` sandbox.
2. `independent/FEEDBACK.md` has the three ticket-required sections, each with ≥3 concrete bullets each grounded in real friction encountered (not generic platitudes).
3. Across the bullets, at least one observation per layer:
   - Sui SDK 2.x (`@mysten/sui`).
   - DeepBook SDK (`@mysten/deepbook-v3`).
   - dapp-kit-react.
   - Move 2024 + DeepBook Move package dependency.
   - Sandbox bootstrap (`pnpm deploy-all`, manifest discovery, env handling).
   - sui-pilot bundled docs (did they help? where did they fall short?).
4. Each Move module has at least one passing `sui move test`.
5. The slot 1 frontend renders without runtime errors against a freshly bootstrapped sandbox with default pools.

## 10. Risks & rollout concerns

| Risk | Mitigation |
|---|---|
| `FORCE_REGENESIS=true` wipes state on sandbox restart | Keep all friction notes in `independent/FEEDBACK.md` continuously, not in the running sandbox. |
| BalanceManager required for market orders, but vault must own it (slot 3) | Test contract-owned BalanceManager early in slot 3; if it's a hard blocker, fall back to "vault holds funds, user signs the BM withdraw + market order in one PTB" pattern. |
| Pyth oracle service downtime in keeper | Add a clear timeout + log in the keeper; treat as a friction item for FEEDBACK rather than a blocker. |
| Off-chain keeper key management | Localnet only — generate an ephemeral key, never reuse. |
| Sui SDK 2.x has known breaking changes vs. training memory | Always read `.ts-sdk-docs/sui/migrations/sui-2.0/*.mdx` before touching `@mysten/sui` imports. |
| DeepBook SDK API drift between v1.1.5 and v1.2.1 | Pin the version that matches the dashboard (`^1.2.1`) in slot 1 / slot 3 UI to match what's already proven against the sandbox. |
| Indexer REST API shape may not match training assumptions | Hit `/api/deepbook` endpoints empirically before building slot 1's data layer; adjust types based on real responses. |
| Move package dependency on DeepBook Move | Mirror `sandbox/packages/example_contract/Move.toml` exactly. Don't reinvent the dep declaration. |
| Bias risk: temptation to peek at existing solution mid-build | Re-read §5 before each slot. If something looks suspiciously like a hint, treat it as forbidden content and stop. |

## 11. Open questions for the build session

These are not blocking right now but should be resolved during build, ideally via repo evidence first and `AskUserQuestion` only if needed:

1. **Should `Vault<T>` (slot 3) be shared or owned?** Shared makes the keeper trigger trivially permissionless; owned keeps the user in control of trigger transactions. Default: shared, with `execute_trigger` requiring the price condition rather than caller identity.
2. **Pool selection in slot 1.** Should the Market Stats page enumerate all pools from the manifest, or hard-code the two known sandbox pools (DEEP/SUI, SUI/USDC)? Default: enumerate.
3. **Indexer REST schema** — confirm endpoint paths and response shapes against a running sandbox before writing TypeScript types. Don't trust training memory.
4. **Slippage check unit (slot 2)** — should `min_out` be denominated in `Quote` units strictly, or in raw atomic units of `Coin<Quote>`? Match whatever DeepBook's swap helper returns.

## 12. Evidence notes

**Verified during preparation** — these claims are sourced from direct file inspection or the Linear MCP fetch:

- Linear ticket text, metadata, acceptance criteria. [§1]
- Existing repo layout: `01-orderbook-viewer/`, `02-fee-rebate-swap/`, `03-dca-vault/`, `FEEDBACK.md`, `RUNBOOK.md`. [§5]
- DeepBook sandbox monorepo structure, port assignments, bootstrap command. [§4]
- SDK versions: `@mysten/sui ^2.5.0`/`^2.14.1`, `@mysten/deepbook-v3 ^1.2.1`/`^1.1.5`, `@mysten/dapp-kit-react ^2.0.1`. [§4]
- React 19.2.0 + Vite 7.3.1 + React Router 7.13.1. [§4]
- Move 2024.beta primary edition. [§4]
- Existing dashboard routes (`/`, `/market-maker`, `/trading`, `/faucet`, `/deployment`). [§4]
- Existing example CLI scripts under `examples/sandbox/`. [§4]

**Inferred** — to confirm during build:

- Exact DeepBook v3 Move-side swap signature (depends on the version pinned in `sandbox/.external-packages/deepbook/Move.toml`).
- Indexer REST endpoint paths and response shapes.
- Whether market orders from a shared-object context can use a contract-owned BalanceManager directly.
- Whether the Pyth oracle output format is directly consumable in a PTB via the existing `pyth` Move package.

**Investigation commands run** (all read-only):

```sh
git -C ~/workspace/deepbook-sandbox-evaluation-apps branch -a
git -C ~/workspace/deepbook-sandbox-evaluation-apps worktree list
ls -la ~/workspace/deepbook-sandbox-evaluation-apps/
git -C ~/workspace/deepbook-sandbox-evaluation-apps log --all --oneline -20
# Linear MCP fetch:
mcp__claude_ai_Linear__get_issue(id="SEDEFI-176", includeRelations=true)
# Two parallel Explore subagents over deepbook-sandbox-evaluation-apps and deepbook-sandbox.
```

**Files intentionally not read:**
- `~/workspace/deepbook-sandbox-evaluation-apps/FEEDBACK.md` (body)
- `~/workspace/deepbook-sandbox-evaluation-apps/RUNBOOK.md` (body)
- READMEs and source function bodies under `01-orderbook-viewer/`, `02-fee-rebate-swap/`, `03-dca-vault/`
- Commit messages beyond first-line subjects (only `first commit` is on the log).

If, during the build, these files are accidentally opened: stop, close, and note the breach in `FEEDBACK.md` so the evaluation result remains honest.
