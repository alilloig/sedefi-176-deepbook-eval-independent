# Cycle 1 Contract — Slot 1 Market Stats

## Goal

Build the read-only Slot 1 dashboard at `independent/01-market-stats/` that
boots in dev mode against a running sandbox, enumerates every pool the
sandbox has currently published from its deployment manifest, and renders one
card per pool showing 24-hour volume, last price, mid-price, bid/ask spread,
depth at +/-1% from mid, and a sparkline of the last fifty trades. All data
is sourced chain-direct from Sui RPC (`sui_getObject` for inner pool state,
`suix_queryEvents` for fills); the sandbox indexer's pool-keyed REST surface
is bypassed.

## Behavior

With Decision Gates G-Boot and G-PoolShape passed, the user runs the Slot 1
dev server, opens its local URL, and within ten seconds sees one card per
sandbox-published pool. Each card displays the six required statistics, the
mid-price falls between the displayed best bid and best ask, and the
sparkline updates within thirty seconds whenever a new fill lands on chain.
On manifest-missing or RPC-unreachable, the page renders an actionable error
pointing at the bootstrap recipe (deferred to RUNBOOK in Cycle 4; for now an
inline message naming the sandbox boot command suffices). No wallet
connection is required at any point. No indexer pool-keyed route
(`/get_pools`, `/orderbook/<name>`, `/trades/<name>`, `/ticker`) is
contacted.

## In scope

- A new TypeScript SPA rooted at `independent/01-market-stats/` using the
  pinned stack (see "Stack pins" below).
- Runtime load of the sandbox deployment manifest at
  `~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json` (or its
  resolved equivalent), with pool object IDs and the deployed DeepBook
  package ID extracted dynamically. Hard-coded pool IDs or package IDs are
  forbidden.
- Per-pool inner-state read via Sui RPC `sui_getObject` with
  `showContent: true` and any necessary dynamic-field traversal to expose
  the bid/ask book.
- Per-pool fill-event read via `suix_queryEvents` filtered to the deployed
  DeepBook package's order module, paginated as needed to cover the rolling
  24-hour window AND surface the last fifty trades.
- In-app computation of mid-price, bid/ask spread, and depth at +/-1% from
  mid from the inner-state payload.
- In-app derivation of 24-hour volume and the trade sparkline from the
  fill-event stream.
- Empirically-captured chain-shape notes at
  `independent/01-market-stats/notes/chain-shape.md` (G-PoolShape
  artifact). TypeScript types in `src/` are derived from that file.
- Periodic refresh of the fill stream so the sparkline reflects new fills
  within 30 s of them landing.
- An inline error UI for manifest-missing / RPC-unreachable.
- Friction-log appends to `independent/raw-friction.log` covering at least
  one observation per category seen during this cycle's work
  (`[deepbook]`, `[sandbox]`, `[sui-sdk]` are all in play).

## Out of scope

- Any modification to `~/workspace/deepbook-sandbox/`. The sandbox is a
  read-only dependency.
- Any work outside `independent/01-market-stats/` (the friction log at
  `independent/raw-friction.log` is the sole shared file, append-only).
- Reading or referencing `01-orderbook-viewer/`, `02-fee-rebate-swap/`,
  `03-dca-vault/`, `FEEDBACK.md`, or `RUNBOOK.md` at the repo root
  (forbidden-read boundary, spec Cross-Cutting Invariants).
- Wallet connection of any kind. Slot 1 is read-only.
- Any call to the sandbox indexer REST surface for pool-keyed routes
  (`/get_pools`, `/orderbook/<name>`, `/trades/<name>`,
  `/ticker?pool_names=...`). The `:9008/status` route MAY be referenced
  for liveness but is not load-bearing.
- Routing / multi-page navigation. Slot 1 is single-route; React Router
  is NOT pulled in.
- Production-grade caching, retry/backoff, or a service worker.
- Slot 2 (Move swap wrapper) and Slot 3 (vault + keeper + UI) work; they
  belong to Cycles 2, 3a, 3b, 3c.
- RUNBOOK / FEEDBACK authorship; that is Cycle 4.
- AC1.7 cross-cycle aggregate verification. AC1.7 reads "at least one
  observation per friction source category is appended ... during the
  Slot-1 cycle." This cycle DOES append at least one entry per relevant
  category seen here, and the spec already credits the Phase-0 indexer
  diagnosis as a `[sandbox]` entry. Final AC1.7 sign-off is by
  inspection at the end of this cycle's review, not by a unit test.

## Files

- `independent/01-market-stats/package.json`
- `independent/01-market-stats/tsconfig.json`
- `independent/01-market-stats/vite.config.ts`
- `independent/01-market-stats/index.html`
- `independent/01-market-stats/notes/chain-shape.md`
- `independent/01-market-stats/src/**/*.ts`
- `independent/01-market-stats/src/**/*.tsx`
- `independent/raw-friction.log`

## Acceptance

(See Acceptance criteria — this section exists so the structural validator
finds its required heading.)

## Acceptance criteria

Lifted verbatim from `spec.md` Slot 1 with the following per-cycle notes.
Every AC traces back to a spec AC ID. Test IDs (`T-NNN`) for the unit /
integration suite will be assigned by the test-author phase against
`tests.json`; this contract names the behavior, not the test files.

- **AC1.1** — With a running sandbox, the page boots in development mode
  without runtime errors and renders in a modern browser. (Cycle test:
  the dev server starts cleanly and the root component mounts without
  console errors when the manifest is reachable.)

- **AC1.2** — Pools are enumerated from the sandbox's deployment manifest
  at load time; the displayed pool set matches whatever the sandbox most
  recently published. (Cycle test: with a fixture manifest containing N
  pool entries, exactly N pool cards render.)

- **AC1.3** — For each enumerated pool, the page displays 24-hour volume,
  last price, mid-price, bid/ask spread, depth at +/-1% from mid, and a
  sparkline of the last fifty trades. (Cycle test: each card renders the
  six labeled fields against fixture inputs.)

- **AC1.4** — Mid-price, spread, and depth at +/-1% from mid are computed
  in-app from the pool object's on-chain inner state, fetched via
  `sui_getObject` (with whatever `showContent` / dynamic-field traversal
  is needed to expose the bid/ask book). The displayed mid-price is
  consistent with the displayed bid/ask spread bounds (mid lies between
  best bid and best ask).
  (Cycle test: a pure compute function fed a captured inner-state fixture
  produces mid, spread, and depth values, and an invariant test asserts
  `bestBid <= mid <= bestAsk` for every fixture row.)

- **AC1.5** — 24-hour volume and the trade sparkline (last fifty trades)
  are derived from the DeepBook order-event stream queried via
  `suix_queryEvents` against the deployed DeepBook package, with a
  sensible event-type filter (e.g., the per-pool fill event). No
  indexer REST endpoint is called for either series. (Cycle test: a
  pure aggregation function fed a captured event-page fixture produces
  the 24h volume and sparkline series; a network-shape test asserts
  the SPA's outbound HTTP only targets Sui RPC `:9000` JSON-RPC
  methods, never `:9008/get_pools|/orderbook|/trades|/ticker`.)

- **AC1.6** — Chain shapes (pool inner-state field layout + sample fill
  event payload) are captured empirically against the running sandbox
  before TypeScript types are written. Captured shapes live at
  `independent/01-market-stats/notes/chain-shape.md`. (Gate: G-PoolShape
  produces this file before any `src/` type is written. Cycle check:
  this file exists, contains both a pool inner-state capture and a fill
  event capture, and is referenced from the source TypeScript types
  via doc comment or import-adjacent comment.)

- **AC1.7** — At least one observation per friction source category seen
  during Slot-1 work is appended to `independent/raw-friction.log`.
  Categories explicitly in play this cycle: `[sandbox]` (already
  satisfied by Phase 0 entries dated 2026-04-27T19:35Z, 19:42Z, 20:55Z,
  21:25Z), `[deepbook]` (e.g. event payload field nuances surfaced by
  G-PoolShape), `[sui-sdk]` (e.g. SDK 2.x typed-client / pagination /
  BCS observations). The `[forge-process]` category is NOT a target
  here — entries with that source are filtered from `FEEDBACK.md`
  unless they reveal a DeepBook-relevant issue. Verified at end-of-cycle
  review by inspection.

## E2E coverage

- **E-001** — *slot 1 manifest-parity, per-pool field completeness,
  chain-direct sourcing, and sparkline freshness.* Status: **real**.
  This cycle brings E-001 fully online; with Slot 1 built and the
  sandbox up, the chrome-devtools-mcp scenario in `spec.md` ("## E2E
  Tests") is exercisable end-to-end. Note that E-001 execution requires
  the sandbox running (G-Boot still passing) and a sandbox-side fill
  event during the freshness window; it is not a per-cycle red/green
  gate but a Phase-F sign-off scenario. The cycle's own red/green loop
  uses the unit / integration tests covering AC1.1-AC1.6 above; E-001
  is verified at consolidated review and again at the end-of-run E2E
  pass.

## Decision Gates

- **G-Boot** (already passed; carried forward). Sandbox boots cleanly via
  `cd ~/workspace/deepbook-sandbox/sandbox && pnpm deploy-all`; manifest
  `sandbox/deployments/localnet.json` is written; ports `:9000` (Sui RPC),
  `:9008` (indexer REST status), and `:9010` (oracle status) all respond.
  This cycle does NOT re-verify G-Boot but DOES depend on it remaining
  green throughout (a sandbox restart mid-cycle requires re-checking).

- **G-PoolShape** (must pass before this cycle's red phase, replaces the
  original G-Schema after the Phase-0 indexer-broken finding documented
  in `independent/raw-friction.log` 2026-04-27T21:25Z). Recipe:

  1. With the sandbox running, pick one poolId from
     `~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json`
     (the `pools` block; either DEEP/SUI or SUI/USDC).
  2. Run `sui_getObject` against `:9000` with that poolId and
     `showContent: true`. If the returned content references dynamic
     fields for the bid/ask book, traverse them with follow-up
     `sui_getDynamicFields` / `sui_getObject` calls until the order-book
     ladder shape is fully captured.
  3. Run `suix_queryEvents` against `:9000` filtered to the deployed
     DeepBook package's order module (the package ID is in the same
     manifest under `deepbook.packageId` or equivalent; the exact event
     type symbol must be empirically confirmed against the running
     sandbox, not guessed from training memory). Capture at least one
     fill event payload verbatim.
  4. Paste both captures into
     `independent/01-market-stats/notes/chain-shape.md` with a brief
     header naming each capture's source RPC call, the date/time, and
     the sandbox commit (if available). This file is the load-bearing
     reference: TypeScript types in `src/` MUST be derived from it.
  5. Append one `[sandbox]` and at least one of
     `[deepbook]` / `[sui-sdk]` friction-log entry summarizing what
     was learned (or what was unexpectedly painful) during the capture.

  Until this gate passes, no TypeScript types in `src/` are written and
  no test in `tests.json` that depends on payload shape is authored.

## Stack pins

These mirror the sandbox dashboard exactly. Every `@mysten/*` import must
be checked against the bundled SDK 2.0 migration docs (auto-loaded by
sui-pilot) before being written; training memory for this SDK family is
stale.

| Surface | Pin | Notes |
|---|---|---|
| `@mysten/sui` | `^2.14.1` | SDK 2.x; use `SuiJsonRpcClient` from `@mysten/sui/jsonRpc` (or the GraphQL/gRPC client variant if a Slot-1 design choice favors it). Constructor MUST pass `network: 'localnet'`. |
| React | `19.2.0` | |
| Vite | `7.3.1` | |
| TypeScript | `~5.9.3` | |
| `react-router` | not used | Slot 1 is single-route. |
| `@mysten/dapp-kit-react` / `@mysten/dapp-kit-core` | not used | Slot 1 is read-only and wallet-free. |

`package.json` MUST declare `"type": "module"` (SDK 2.x is ESM-only) and
`tsconfig.json` MUST set `"moduleResolution": "NodeNext"` or `"Bundler"`.

## Integration / sandbox contract

- Sui RPC base URL: `http://127.0.0.1:9000` (the sandbox's Sui RPC port).
- Manifest path: `~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json`.
  How the SPA reaches it (Vite `fs.allow` config, a small dev-only
  fetch endpoint, copy-on-build, or symlink under `public/`) is left to
  the implementer; record the choice in the cycle review and append a
  `[forge-process]` or `[sandbox]` friction-log entry if the integration
  is non-obvious.
- Forbidden network targets: any URL on `:9008` ending in `/get_pools`,
  `/orderbook/<name>`, `/trades/<name>`, or `/ticker`. The
  `:9008/status` route is allowed for liveness checks but is not
  load-bearing for any AC.
