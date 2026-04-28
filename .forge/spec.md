# SEDEFI-176 Independent Solution — Specification

## Vision

Deliver a second, fully independent solution to the DeepBook Sandbox evaluation
brief at `independent/faena.md`, alongside a clean, source-attributed friction
log and a distilled DevX feedback report. The deliverable doubles as a
DevX evaluation of the DeepBook Sandbox toolchain: the build itself produces
the evidence Mysten Labs needs to understand where DeepBook's developer
experience helps, hinders, or actively misleads a competent newcomer.

The work is staged so each app is buildable in isolation against a running
local sandbox, and the documentation pass (RUNBOOK + FEEDBACK) is performed
once at the end with the friction log as the single source of truth. This
keeps the DevX signal clean: every claim in `FEEDBACK.md` is traceable to a
timestamped observation in `independent/raw-friction.log`.

## Target Users

- **DeepBook protocol team and Mysten DevRel.** Primary readers of
  `FEEDBACK.md`; they need an honest, attributed view of where the Sandbox
  toolchain works and where it does not for a fresh developer.
- **DeepBook integrators (DEX builders, market makers, vault designers).**
  Secondary readers of the three apps and `RUNBOOK.md`; they need
  reproducible, minimal reference patterns for indexer reads, slippage-safe
  swaps, and event-driven triggers.
- **The author of this evaluation (an independent Sui developer).** Tertiary
  user; needs a clean, runnable artifact set on localnet that demonstrates
  end-to-end command of the DeepBook stack.

## Core Features

The deliverable is a fixed three-app set plus two non-cycle documents,
all under `independent/`. Each app is a self-contained sub-project that
boots, builds, and runs against a local sandbox started from
`~/workspace/deepbook-sandbox` (read-only dependency).

### Slot 1 — Market Stats (cross-pool aggregate dashboard)

**What it does (user-facing).** A read-only browser page that, with the
sandbox running, shows live market statistics for every DeepBook pool the
sandbox has published: 24-hour volume, last price, mid-price, bid/ask
spread, depth at ±1% from mid, and a sparkline of the last fifty trades.
No wallet connection is required.

**Why it matters.** Phase 0 discovered the sandbox's indexer REST surface
is non-functional for sandbox-created pools out of the box: the
deploy script creates pools on-chain (`pool_created` events ARE indexed)
but never inserts the metadata rows into the `pools` postgres table
that all pool-keyed REST endpoints (`/get_pools`, `/orderbook/...`,
`/trades/...`, `/ticker`) read from (see `independent/raw-friction.log`
2026-04-27T21:25Z entries for the full diagnosis). Slot 1 therefore
pivots to chain-direct reads: it loads the deployment manifest, reads
each pool's inner state via Sui RPC `sui_getObject`, and queries
historical fills via `suix_queryEvents` over the DeepBook order events.
This is a fully-supported chain integration pattern and surfaces a
different DevX layer (Sui SDK 2.x typed clients, BCS deserialization,
event pagination) than the existing solution's slot-1 viewer exercises.

**Key constraints.**
- Pool list is enumerated dynamically from the sandbox's deployment
  manifest. Hard-coded pool identifiers are forbidden.
- TypeScript types are derived from empirically-captured chain shapes
  (see Decision Gate G-PoolShape), not from training memory.
- Stack pins follow the sandbox dashboard (see Architecture Overview).
- Mid-price, spread, and depth are computed in-app from the pool
  object's inner order-book state (read via `sui_getObject` with
  `showContent: true` and any required dynamic-field traversals).
- 24-hour volume and the trade sparkline are derived from
  DeepBook's order-event stream, queried via `suix_queryEvents` on the
  sandbox-deployed DeepBook package, paginated as needed.
- The indexer REST surface is NOT consumed (pool-keyed routes are
  non-functional in the sandbox out of the box; see Out of Scope).
  Status-only routes like `/status` may be referenced but are not
  load-bearing.

**Acceptance criteria.**
- AC1.1: With a running sandbox, the page boots in development mode without
  runtime errors and renders in a modern browser.
- AC1.2: Pools are enumerated from the sandbox's deployment manifest at
  load time; the displayed pool set matches whatever the sandbox most
  recently published.
- AC1.3: For each enumerated pool, the page displays 24-hour volume,
  last price, mid-price, bid/ask spread, depth at ±1% from mid, and a
  sparkline of the last fifty trades.
- AC1.4: Mid-price, spread, and depth at ±1% from mid are computed
  in-app from the pool object's on-chain inner state, fetched via
  `sui_getObject` (with whatever showContent / dynamic-field traversal
  is needed to expose the bid/ask book). The displayed mid-price is
  consistent with the displayed bid/ask spread bounds.
- AC1.5: 24-hour volume and the trade sparkline (last fifty trades)
  are derived from the DeepBook order-event stream queried via
  `suix_queryEvents` against the deployed DeepBook package, with a
  sensible event-type filter (e.g., the per-pool fill event). No
  indexer REST endpoint is called for either series.
- AC1.6: Chain shapes (pool inner-state field layout + sample fill
  event payload) are captured empirically against the running sandbox
  before TypeScript types are written. Captured shapes live at
  `independent/01-market-stats/notes/chain-shape.md`.
- AC1.7: At least one observation per friction source category
  (`[deepbook]`, `[sandbox]`, `[sui-sdk]`) is appended to
  `independent/raw-friction.log` during the Slot-1 cycle. The pivot
  away from the indexer REST surface counts as a `[sandbox]`
  observation already filed in Phase 0.

### Slot 2 — Slippage-Safe Swap (Move wrapper)

**What it does.** A Move 2024 module that exposes a single public entry
function wrapping DeepBook's no-manager `swap_exact_*` family, asserting
that the realised output meets the caller's `min_out` floor and aborting
with a documented error code otherwise. The DEEP fee coin and any input
residual are routed back to the caller.

**Why it matters.** DeepBook ships five swap functions across two
families (with-manager and no-manager) returning different tuple shapes
and different `min_out` semantics. Slot 2 is the smallest possible
"correct slippage-safe swap" reference, and the implementation experience
itself is a natural probe of DeepBook's swap API ergonomics.

**Key constraints.**
- `Move.toml` mirrors the sandbox's `example_contract` declaration,
  pointing at the same `.external-packages/` path layout. Edition 2024.
- The implementation uses the no-manager swap path; `BalanceManager` is
  not required and must not be introduced.
- `min_out` is interpreted as the `u64` value (atomic units) of the
  output coin, matching DeepBook's own internal assertion.

**Acceptance criteria.**
- AC2.1: The package's Move dependency declaration is structurally
  identical to the sandbox's `example_contract` template (same external
  packages, same edition).
- AC2.2: The module exports a single public entry function for a
  base-to-quote slippage-safe swap, parameterized over base and quote
  coin types.
- AC2.3: The function calls DeepBook's `swap_exact_base_for_quote`
  (no-manager path), asserts the output coin's value meets `min_out`
  with a documented, named error code, and routes leftover input and
  the DEEP fee coin back to the sender.
- AC2.4: `sui move build` exits zero against the sandbox's bundled
  DeepBook package.
- AC2.5: `sui move test` includes at least one success-path test
  (output meets floor) and one failure-path test (output below floor
  triggers the documented error code), implemented with the
  test-scenario pattern.
- AC2.6: A Move 2024 quality pass (sui-pilot's `move-code-quality`)
  reports no issues.
- AC2.7: At least one `[deepbook]` and one `[move]` observation is
  appended to `independent/raw-friction.log` during the Slot-2 cycle.

### Slot 3 — Take-Profit / Stop-Loss Vault (Move + Keeper + UI)

**What it does.** A shared Move object that custodies a coin balance
under owner-defined take-profit and stop-loss prices, plus an off-chain
keeper that watches on-chain Pyth `PriceInfoObject`s and fires
`execute_trigger` when a vault's condition is met, plus a wallet-connected
UI for creating, listing, and withdrawing vaults.

**Why it matters.** This is the brief's highest-value evaluation
deliverable: it touches Move object design, on-chain price feeds, the
Sui SDK transaction-building surface, dapp-kit-react wallet integration,
and the no-manager swap path all in a single cohesive flow. It is also
the most likely to expose documentation gaps in the keeper / Pyth /
event-subscription corner of the stack.

**Key constraints.**
- The vault is a shared object holding `Balance<T>` directly. It uses
  the no-manager swap path on trigger (Decision Gate G-Vault below).
- The keeper reads price from on-chain `PriceInfoObject`s, NOT from the
  Pyth oracle service's `:9010` endpoint (which is a status surface only).
- All TypeScript pins for keeper and UI match the sandbox dashboard
  (see Architecture Overview).
- Keeper signing uses an ephemeral keypair generated at boot; localnet
  only.

**Acceptance criteria — Move package.**
- AC3.1: `Vault<T>` is a shared object whose state includes a `UID`,
  the owner address, the custodied `Balance<T>`, an optional
  take-profit price, an optional stop-loss price, the target pool's
  identifier, a side indicator, and a triggered lifecycle flag.
- AC3.2: A vault creation entry function accepts an input coin, target
  pool, side, and optional TP/SL prices, constructs a shared vault,
  and emits a creation event carrying the vault's identifier and key
  fields.
- AC3.3: A withdraw entry function is owner-only, refuses to operate on
  a triggered vault, and returns the entire custodied balance to the
  sender as a coin.
- AC3.4: The trigger entry function is permissionless but
  condition-gated: it aborts unless the supplied current price satisfies
  the vault's TP or SL condition. On success it drains the vault, calls
  DeepBook's `swap_exact_base_for_quote` (no-manager path), routes the
  output coin to the vault owner, marks the vault triggered, and emits
  a trigger event.
- AC3.5: At least four unit tests cover: TP fires, SL fires, neither
  condition fires (abort), withdraw before fire (success), withdraw
  after fire (abort).
- AC3.6: `sui move build && sui move test` both pass; a Move 2024
  quality pass reports no issues.

**Acceptance criteria — Keeper.**
- AC3.7: Keeper is a TypeScript Node.js service whose Sui and DeepBook
  SDK pins match the sandbox dashboard.
- AC3.8: The keeper discovers vaults by subscribing to creation events
  from the deployed package (with polling as an acceptable fallback).
- AC3.9: The keeper polls on-chain Pyth `PriceInfoObject`s on a
  configurable interval in the 5-10 second range and parses price and
  exponent.
- AC3.10: For each known vault, the keeper evaluates the trigger
  condition; on fire, it builds and submits a transaction calling the
  vault's trigger entry signed with an ephemeral keeper key.
- AC3.11: The keeper logs each poll cycle and each trigger fire to
  stdout in a structured, parseable format.
- AC3.12: An end-to-end demo path is documented and verified: sandbox
  boot → publish package → keeper running → user creates TP vault via
  UI → operator pushes the relevant on-chain price past the threshold
  → keeper detects, fires, and the UI reflects the triggered state with
  the output coin routed to the owner.

**Acceptance criteria — UI.**
- AC3.13: The UI is React + Vite with `@mysten/dapp-kit-react`; the
  connect-wallet flow works against the sandbox's auto-loaded dev
  wallet.
- AC3.14: The vault list filters to vaults owned by the connected
  account.
- AC3.15: A vault creation form captures coin type, amount, target
  pool, side, and optional TP/SL prices, and submits a transaction.
  On success, the new vault appears in the list within one keeper
  polling interval.
- AC3.16: A withdraw control on each non-triggered vault submits an
  owner-only transaction. On success, the vault disappears from the
  list.
- AC3.17: Triggered vaults render with a clear triggered badge and the
  output amount that was routed to the owner.

**Cross-component criterion.**
- AC3.18: By the end of the Slot-3 cycle, `independent/raw-friction.log`
  contains at least one entry from every relevant source category seen
  during Slot 3 work.

### Post-cycle deliverables (RUNBOOK + FEEDBACK)

These are not implementation cycles. They are produced as a single
consolidated documentation pass after the three app cycles complete,
with no red/green test loop and one consolidated review.

- **RUNBOOK.md**: copy-pasteable commands per app derived from the
  verified bootstrap and per-app run commands.
- **FEEDBACK.md**: distilled from `independent/raw-friction.log`, with
  the three required sections (working well / can be improved / not
  working). Every bullet cites a friction-log line by timestamp.

## Architecture Overview

**Tech stack and pinned versions.** All TypeScript apps pin to the same
`@mysten/*` versions the sandbox dashboard already proves out. Move
artifacts use the same external-package pattern the sandbox's example
contract uses.

| Surface | Pin |
|---|---|
| `@mysten/sui` | `^2.14.1` |
| `@mysten/deepbook-v3` | `^1.2.1` |
| `@mysten/dapp-kit-react` | `^2.0.1` |
| `@mysten/dapp-kit-core` | `^1.2.2` |
| React | `19.2.0` |
| Vite | `7.3.1` |
| TypeScript | `~5.9.3` |
| Move edition | `2024` (this work); `2024.beta` (DeepBook upstream) |

The Sui TypeScript SDK is on the 2.x line. Every agent that touches a
`@mysten/*` import must consult the bundled SDK 2.0 migration docs
before writing it; training memory is stale.

**Major components and responsibilities.**

- *Sandbox dependency (read-only).* `~/workspace/deepbook-sandbox`
  provides the full stack: Sui RPC, indexer REST, faucet, Pyth oracle
  service, market maker, deployment manifest. All `independent/` apps
  consume it but never modify it. Bootstrap is `pnpm deploy-all` from
  `sandbox/`.
- *Slot 1 frontend.* React + Vite single-page app. Loads the sandbox
  deployment manifest, enumerates pool object IDs, reads each pool's
  inner state via Sui RPC `sui_getObject`, and queries historical fills
  via `suix_queryEvents` over the DeepBook package's order events.
  Pure read; no wallet. The sandbox's indexer REST surface is bypassed
  (it is non-functional for pool-keyed routes out of the box —
  see Out of Scope).
- *Slot 2 Move package.* One module, one entry function, two unit
  tests. Wraps the no-manager swap.
- *Slot 3 Move package.* One module defining `Vault<T>` plus
  create/withdraw/trigger entries and creation/trigger events.
- *Slot 3 keeper.* Node.js TypeScript service. Subscribes to vault
  creation events, polls on-chain price objects, evaluates conditions,
  submits trigger transactions.
- *Slot 3 UI.* React + Vite + dapp-kit-react. Wallet-connected; lists,
  creates, and withdraws vaults.

**Data model concepts.**

- *Pool* (DeepBook): identified by an object reference plus base/quote
  coin types; Slot 1 reads its inner order-book state directly via
  Sui RPC `sui_getObject` and historical fills via
  `suix_queryEvents` (the sandbox indexer's pool-keyed REST surface is
  non-functional out of the box; see Out of Scope).
- *Vault* (Slot 3): a shared object owning a coin balance, with
  optional TP/SL price thresholds, target pool reference, side
  indicator, owner, and triggered flag. State transitions are
  one-way: untriggered → triggered.
- *PriceInfoObject* (Pyth, on-chain): the keeper's price source.
  Polled, parsed for price and exponent, compared to vault thresholds.
  Identifiers come from the sandbox's deployment manifest.

**Communication patterns.**

- Slot 1 frontend talks to Sui RPC over HTTP/JSON-RPC for both
  pool-state reads (`sui_getObject` with `showContent`) and historical
  fill queries (`suix_queryEvents` with the appropriate move-event
  module filter). The sandbox's indexer REST surface is bypassed.
- Slot 2 is invoked by callers via a single Move entry; it itself
  calls DeepBook directly in the same transaction.
- Slot 3 keeper talks to Sui RPC for both reads (price objects, vault
  events) and writes (trigger transactions). The UI talks to Sui RPC
  via dapp-kit-react and to the connected wallet via the wallet
  standard.

**Integration points.**

- Sandbox deployment manifest: every app loads it at runtime to
  discover pool identifiers, package identifiers, and Pyth price
  object identifiers. No app hard-codes these.
- DeepBook external Move packages: Slot 2 and Slot 3 declare them as
  Move dependencies via the same path pattern the sandbox's example
  contract uses.
- Pyth on-chain price objects: Slot 3 keeper reads them through Sui
  RPC; the Pyth oracle service's status endpoint is not consumed.

## UX Flows

### Slot 1 — viewing market stats

1. Sandbox is up; user opens the Slot 1 dev URL.
2. Page loads the deployment manifest, enumerates pool object IDs,
   issues one `sui_getObject` per pool plus one paginated
   `suix_queryEvents` per pool against Sui RPC.
3. Page renders one card per pool with the documented statistics.
4. Page updates the trade sparkline as fresh fill events arrive
   (acceptable to re-poll the event stream on a short interval).
5. *Error path.* If the manifest is missing or Sui RPC is unreachable,
   the page renders a clear, actionable error explaining which command
   to run from `RUNBOOK.md`.

### Slot 3 — creating, monitoring, and triggering a vault

1. Sandbox is up; package published; keeper running; user opens the
   Slot 3 UI and connects the dev wallet.
2. User opens the create-vault form, picks a coin type, amount, target
   pool, side, and at least one of TP/SL. Submits.
3. The new vault appears in the list within one keeper polling
   interval (the keeper subscribes to creation events).
4. *Trigger path.* An operator pushes the relevant on-chain price past
   the user's threshold. Within one keeper polling interval, the
   keeper detects the condition, builds and submits a trigger
   transaction. The vault renders as triggered in the UI; the output
   coin is delivered to the owner address.
5. *Withdraw path.* Before any trigger fires, the owner clicks
   withdraw on a vault row; the vault disappears from the list and
   the full balance is returned. Withdrawing a triggered vault is
   refused with a clear UI error.
6. *Error states.* Wallet not connected → connect-wallet CTA.
   Transaction rejection by the wallet → preserved form state plus a
   retry. Trigger evaluation failure (bad current price, vault already
   triggered) → keeper logs the abort, does not retry that vault until
   conditions change.

### Slot 2 — exercising the swap

Slot 2 has no UI of its own. It is exercised from the CLI via
`sui client call` against the published package, and from Move unit
tests that drive both the success and failure paths.

## Non-Functional Requirements

**Performance.**
- Slot 1: per-pool stats render within ten seconds of page load on
  localhost; the trade sparkline reflects new trades within thirty
  seconds of them landing in the indexer.
- Slot 3: keeper detects a satisfied trigger condition and submits the
  trigger transaction within one configured polling interval (5-10 s)
  of the on-chain price update.

**Security.**
- Slot 3 vault withdraw is owner-only and is enforced on-chain.
- Slot 3 trigger is permissionless but condition-gated on-chain.
- Slot 3 keeper key is ephemeral, generated at boot, used on localnet
  only, and never persisted.

**Scalability.** Out of scope. Localnet only; single keeper instance.
The vault design must not preclude future horizontal scaling, but no
specific scalability bar is set.

**Accessibility.** Not a target for this evaluation. Slot 1 and Slot 3
UIs should be readable and keyboard-operable but no formal a11y bar
applies.

**Reliability.**
- Sandbox restart wipes all state (`FORCE_REGENESIS=true`). No flow
  may assume durable sandbox state across restarts.
- Notes, friction logs, and source artifacts live outside the sandbox
  tree and survive restart.

## Cross-Cutting Invariants

These rules apply to every cycle and every dispatched agent.

**Workspace boundary.** All net-new work lives under `independent/`.
Nothing outside that directory is created or modified.

**Read-only sandbox.** `~/workspace/deepbook-sandbox` may be inspected
and run (including `pnpm deploy-all`); never modified.

**Localnet only.** No testnet, no mainnet, no devnet.

**Forbidden-read boundary.** The repository root contains a prior
solution at `01-orderbook-viewer/`, `02-fee-rebate-swap/`,
`03-dca-vault/`, `FEEDBACK.md`, and `RUNBOOK.md`.
- *Allowed:* directory names, manifest metadata (`package.json` and
  `Move.toml` keys), framework identification from imports.
- *Forbidden:* function bodies, README bodies, the bodies of
  `FEEDBACK.md` and `RUNBOOK.md`, commit message text beyond first-line
  subjects, PR/branch descriptions.
- *No subagent dispatch over those paths.* If accidentally crossed,
  stop and record the breach in `independent/FEEDBACK.md`.

**Sui SDK 2.x stale-memory rule.** Any agent touching `@mysten/*`
imports must read the bundled SDK 2.0 migration docs (auto-loaded by
sui-pilot) before writing the import. Training memory is stale.

**DevX source attribution.** During every cycle, append observations
to `independent/raw-friction.log` (append-only). Format:

```
YYYY-MM-DDTHH:MM:SSZ | [source] | <one-sentence observation>
```

Source is one of: `deepbook`, `sui-sdk`, `dapp-kit`, `move`, `sandbox`,
`sui-pilot`, `forge-process`. The `[forge-process]` filter applies in
the post-cycle docs pass: `[forge-process]` entries do not enter
`FEEDBACK.md` unless they reveal a DeepBook-relevant issue surfaced
through orchestration, in which case the consolidator re-tags them
to the relevant DeepBook source.

**Move dependency declaration.** Slot 2 and Slot 3 Move packages
mirror `~/workspace/deepbook-sandbox/sandbox/packages/example_contract/Move.toml`
exactly for their `[dependencies]` block, with paths adjusted to point
at the sandbox's `.external-packages/` directory.

## Decision Gates

These are pre-cycle (or in-cycle) checkpoints that must pass before
work proceeds. Each gate has a clear escalation path.

- **G-Boot** (before Cycle 1). The sandbox must boot cleanly via
  `pnpm deploy-all`, with the manifest written and the indexer, RPC,
  and oracle ports responsive. If not, halt and escalate to the user.
- **G-PoolShape** (before Slot-1 red phase, replaces the original
  G-Schema after the Phase-0 indexer-broken finding). The pool
  object's inner-state field layout (returned by `sui_getObject`
  with `showContent: true`) and a sample DeepBook fill-event payload
  (returned by `suix_queryEvents`) are captured against the running
  sandbox; both shapes are documented in
  `independent/01-market-stats/notes/chain-shape.md`. TypeScript types
  in Slot 1 are derived from that file. The path to the file is
  load-bearing — Phase 1 spec, Phase 2 cycle plan, and the Slot-1
  cycle's contract.md all reference it.
- **G-Pyth** (before Slot-3 red phase). One on-chain `PriceInfoObject`
  is fetched via the SDK; its field layout is documented in
  `independent/03-tpsl-vault/keeper/notes/pyth-shape.md`.
  The keeper's price-read code references that file.
- **G-Vault** (inside Slot-3 contract phase). Slot 3 uses the
  no-manager swap path. If, mid-build, that path proves insufficient
  (e.g., gas, missing return values, custodial mismatch), pause and
  escalate via `AskUserQuestion` before pivoting; do not switch to a
  manager-based path silently.

## Out of Scope

- Any modification to `~/workspace/deepbook-sandbox`.
- Any work outside `independent/`.
- Testnet or mainnet deployment.
- Reading the prior solution at `01-orderbook-viewer/`,
  `02-fee-rebate-swap/`, `03-dca-vault/`, the prior `FEEDBACK.md`, or
  the prior `RUNBOOK.md`.
- Manager-based DeepBook swap paths in Slot 2 or Slot 3 (default to
  the no-manager path; deviate only via G-Vault).
- Reading Pyth prices off the `:9010` status endpoint instead of
  on-chain `PriceInfoObject`s.
- The sandbox indexer's pool-keyed REST surface (`/get_pools`,
  `/orderbook/<name>`, `/trades/<name>`, `/ticker?pool_names=...`).
  These routes read from a curated `pools` postgres table that
  `pnpm deploy-all` does not populate (verified Phase 0 — see
  `independent/raw-friction.log` 2026-04-27T21:25Z entries). Slot 1
  bypasses them in favor of chain-direct reads.
- Production-grade keeper key management (ephemeral keys are required;
  no key persistence).
- Formal accessibility, internationalization, or scalability targets.
- Any docs work (`RUNBOOK.md`, `FEEDBACK.md`) before all three app
  cycles have completed.

## Open Questions

- *Move dependency path style.* Slot 2 and Slot 3 Move packages must
  point at the sandbox's `.external-packages/` directory; the choice
  between absolute paths, environment-variable paths, or a one-time
  symlink is left to implementers as long as the resulting `Move.toml`
  is structurally equivalent to `example_contract`'s and reproducible.
- *Slot 3 vault discovery cadence.* The keeper may use Sui event
  subscription, package transaction polling, or a hybrid. Pick what
  the SDK 2.x docs recommend at implementation time; document the
  choice in the cycle review. (Plan §7 Keeper AC8 leaves this open by
  design; G-Schema-style empirical confirmation against the SDK docs
  is the resolution path.)

## E2E Tests

These scenarios cover the spec's product-level acceptance criteria
end-to-end against a live sandbox. Per-cycle unit tests live in each
cycle's `tests.json`, not here. Each scenario traces back to spec
acceptance criteria via `covers_contract`.

All scenarios assume the sandbox is up (Decision Gate G-Boot has
passed) and the relevant `independent/` app has been built/published
into that running sandbox.

```yaml
- id: E-001
  name: slot 1 manifest-parity, per-pool field completeness, chain-direct sourcing, and sparkline freshness
  kind: ui
  preconditions:
    - sandbox running (sui rpc :9000 responsive)
    - sandbox/deployments/localnet.json present with at least one pool
    - slot 1 app built and dev server running on its configured local port
    - chrome-devtools-mcp network and console panels enabled and recording from before the page loads
  steps:
    - read sandbox/deployments/localnet.json to capture the authoritative set of pool object IDs the sandbox has currently published
    - navigate to the slot 1 dev url with the network panel recording
    - wait up to 10 seconds for all pool cards to render
    - assert exactly one pool card is rendered per pool present in the captured manifest pool set (no extras, no missing pools)
    - for each rendered pool card, assert all six required fields are present and non-empty - 24h volume, last price, mid-price, bid/ask spread, depth at +/-1% from mid, sparkline of last 50 trades
    - for each rendered pool card, assert the displayed mid-price falls between the displayed best bid and best ask (consistency with spread bounds)
    - inspect the recorded network requests - assert at least one POST to sui rpc port :9000 with method sui_getObject for each pool object id (sourcing AC1.4 inner-state read), assert at least one POST with method suix_queryEvents filtered to the deepbook package's order module for each pool (sourcing AC1.5 24h volume + sparkline)
    - assert no recorded network request was issued to indexer port :9008 with a pool-keyed path (/get_pools, /orderbook/<name>, /trades/<name>, /ticker) (sourcing AC1.5 no indexer reads)
    - cause a fresh fill to land on chain (e.g., run sandbox/examples/sandbox/place-market-order.ts or trigger market maker activity) and record the chain timestamp t_fill
    - wait up to 30 seconds from t_fill for the sparkline of the affected pool to extend with the new fill (page may need to re-poll suix_queryEvents on its configured cadence)
    - assert the sparkline reflects the new fill within 30 seconds of t_fill
  expected: the page renders one card per manifest pool with all six required fields per card, mid-price is bracketed by spread, sui_getObject + suix_queryEvents on :9000 are the only data sources used (no traffic to indexer pool-keyed routes on :9008), and the sparkline of the affected pool picks up a fresh fill within 30 seconds of it landing
  covers_contract: [AC1.1, AC1.2, AC1.3, AC1.4, AC1.5]
  tooling: chrome-devtools-mcp

- id: E-002
  name: slot 2 swap aborts with documented error code when min_out exceeds achievable output
  kind: cli
  preconditions:
    - sandbox running
    - slot 2 move package built (sui move build) and published against the running sandbox
    - caller has a funded base coin and a deep coin sufficient to cover the swap fee
    - target pool identifier and base/quote coin types known from the deployment manifest
  steps:
    - call the slot 2 entry function via `sui client call`, passing a min_out strictly greater than any achievable output for the supplied input (e.g., 100x the realistic quote)
    - capture the transaction effects and abort code
  expected: the call aborts with the slot 2 module's documented named error code (the slippage-floor assertion failure raised by the wrapper itself), not a generic deepbook abort
  covers_contract: [AC2.3]
  tooling: null

- id: E-005
  name: slot 2 swap success path delivers output coin meeting min_out and returns DEEP fee residual to sender
  kind: cli
  preconditions:
    - sandbox running
    - slot 2 move package built (sui move build) and published against the running sandbox
    - caller has a funded base coin (input) and a deep coin sufficient to cover the swap fee, both held at known pre-call balances
    - target pool identifier and base/quote coin types known from the deployment manifest
    - a realistic min_out chosen below current achievable output (queried from the indexer's per-pool orderbook depth)
  steps:
    - record the caller's pre-call balances of base coin (input asset), quote coin (output asset), and DEEP coin
    - call the slot 2 entry function via `sui client call` with the realistic min_out and the prepared base coin and DEEP coin inputs
    - capture the transaction effects, owned-objects diff, and post-call balances of base, quote, and DEEP for the caller address
  expected: the call succeeds, the caller receives a quote coin whose value is at least min_out, the caller's DEEP coin balance reflects only the actually-charged DeepBook fee (any residual DEEP returned), any unconsumed base coin residual is also returned to the caller, and no balance manager object remains owned or shared as a side effect
  covers_contract: [AC2.3]
  tooling: null

- id: E-003
  name: slot 3 end-to-end take-profit fire from ui through keeper through ui again, with creation and trigger events asserted
  kind: ui
  preconditions:
    - sandbox running
    - slot 3 move package published against the running sandbox; module address is known
    - slot 3 keeper service running and configured against the running sandbox with an ephemeral keeper key
    - slot 3 ui dev server running on its configured local port
    - dev wallet is loaded with sufficient base coin balance to fund a vault and sufficient deep coin balance to cover the trigger swap fee
    - a side channel for reading sui rpc events is available (e.g., a parallel `sui client` shell or a small `suix_queryEvents` script) so the test can independently verify Move events
  steps:
    - navigate to the slot 3 ui
    - click the connect-wallet control and approve in the dev wallet
    - open the create-vault form
    - select a coin type, amount, target pool, side, and a take-profit price reachable by a market-mover trade against the running sandbox
    - submit the create form, capture the resulting transaction digest from the ui or wallet, and wait for the new vault to appear in the connected account's vault list (within one keeper polling interval, i.e., up to 10 seconds)
    - assert the new vault is visible and shows untriggered
    - using the side channel, query the events of the create-vault transaction digest and assert at least one event of the slot 3 module's documented vault-creation event type is present, carrying the new vault's object id and the key fields (owner, target pool id, side, TP/SL settings)
    - manually push the relevant on-chain price past the take-profit threshold (e.g., run a sufficiently large market-mover trade via sandbox tooling against the same pool)
    - wait up to one keeper polling interval (10 seconds) for the keeper to detect and submit execute_trigger; capture the trigger transaction digest from the keeper logs
    - assert the vault row in the ui transitions to a triggered badge state
    - assert the ui shows the output amount routed to the owner for that vault
    - using the side channel, query the events of the trigger transaction digest and assert at least one event of the slot 3 module's documented trigger event type is present, referencing the same vault object id
  expected: a take-profit vault created via the ui transitions to triggered within one keeper polling interval after the on-chain price crosses the threshold; the ui shows the output amount routed to the owner; both the creation event (with vault id + key fields) and the trigger event (referencing the vault id) are emitted by the slot 3 module
  covers_contract: [AC3.2, AC3.4, AC3.9, AC3.10, AC3.12, AC3.13, AC3.15, AC3.17]
  tooling: chrome-devtools-mcp

- id: E-004
  name: slot 3 owner-only withdraw before trigger returns full balance and removes vault
  kind: ui
  preconditions:
    - sandbox running
    - slot 3 move package published
    - slot 3 ui dev server running
    - dev wallet loaded with sufficient base coin balance
  steps:
    - navigate to the slot 3 ui and connect the dev wallet
    - create a vault with both take-profit and stop-loss prices set far outside any reachable market range so no trigger will fire during the test
    - wait for the new vault to appear in the list
    - click the vault's withdraw control and approve the transaction in the dev wallet
    - wait up to one keeper polling interval for the ui to refresh
    - assert the vault row no longer appears in the connected account's vault list
    - assert the connected account's base coin balance reflects return of the full deposited amount (less gas)
  expected: a non-triggered vault can be withdrawn by its owner; the vault disappears from the list and the full deposited balance is returned to the owner
  covers_contract: [AC3.3, AC3.13, AC3.16]
  tooling: chrome-devtools-mcp

- id: E-006
  name: slot 3 vault list excludes vaults owned by other accounts
  kind: ui
  preconditions:
    - sandbox running
    - slot 3 move package published
    - slot 3 ui dev server running
    - two distinct dev addresses available (account A and account B), each loaded with sufficient base coin balance
  steps:
    - using sandbox tooling or a CLI script signed by account A, create a vault owned by account A with TP/SL set safely outside the market range so no trigger fires during the test
    - record the resulting vault object id
    - navigate to the slot 3 ui and connect the dev wallet as account B (NOT account A)
    - wait up to one keeper polling interval for the ui list to populate
    - assert the vault list rendered for account B does NOT contain the vault id created by account A
    - disconnect, reconnect the dev wallet as account A
    - wait up to one keeper polling interval for the list to populate
    - assert the vault list rendered for account A DOES contain the vault id created by account A
  expected: the ui's vault list strictly filters by connected account; a vault owned by account A is invisible to account B and visible to account A
  covers_contract: [AC3.14]
  tooling: chrome-devtools-mcp

- id: E-007
  name: slot 3 withdraw is rejected on triggered vaults and rejected for non-owner callers
  kind: cli
  preconditions:
    - sandbox running
    - slot 3 move package published; module address known
    - slot 3 keeper service running with an ephemeral keeper key
    - two distinct dev addresses available (account A and account B), each loaded with sufficient base coin balance and (for A) sufficient DEEP for the trigger swap fee
  steps:
    - using a CLI script signed by account A, create a vault V1 owned by A with a take-profit price that is reachable by a sandbox-side market-mover trade
    - wait for V1 to appear via `sui client object`
    - using a CLI script signed by account B (NOT the owner), call the slot 3 module's withdraw entry function on V1
    - capture the abort code from B's failed call
    - assert the call aborts with the slot 3 module's documented owner-only error code (not a generic move runtime abort)
    - using a sandbox-side market-mover trade, push the on-chain price past V1's take-profit threshold and wait up to one keeper polling interval for the keeper to fire execute_trigger on V1
    - using `sui client object`, confirm V1's triggered flag is now true
    - using a CLI script signed by account A (the owner), call the slot 3 module's withdraw entry function on V1
    - capture the abort code from A's failed call
    - assert the call aborts with the slot 3 module's documented "withdraw on triggered vault" error code (not a generic move runtime abort)
  expected: a non-owner withdraw attempt is rejected with the documented owner-only error code; an owner withdraw attempt against a triggered vault is rejected with the documented triggered-vault error code
  covers_contract: [AC3.3]
  tooling: null
```
