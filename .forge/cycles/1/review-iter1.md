# Cycle 1 — Consolidated Review (Slot 1 Market Stats)

## Verdict

**BLOCK.** The cycle's green test gate is satisfied (24/24 unit tests pass) but
the production wiring that the contract's Behavior section promises does not
exist. A user running `pnpm dev` against a live sandbox would see one of two
failure modes: (a) a manifest-not-reachable error screen because no Vite
middleware or `public/localnet.json` symlink serves the manifest, or (b) if
the manifest were served, N empty cards rendering `0` / `—` for every metric
because `fetchPoolStats` is a hard-coded stub. The compute pipeline
(`runDataLayer` → `fetchFills` → `aggregateFills` + `computeMarketStats` →
`PoolCardData`) is reachable only from unit tests with mocked deps. In
addition, the bid-side price decoder is wrong against the captured chain shape;
unit tests pass tautologically because the fixture builders use the same
broken encoding the implementation decodes. `cycle-pass.sh` will exit non-zero
because `critical=3` and `disputed_severity=true` survives in 5 clusters.

## Headline finding

**The Slot 1 SPA does not actually integrate with the chain.** It is a
test-suite-shaped collection of pure modules glued together by a `main.tsx`
whose `void loadManifest; void RPC_URL;` lines admit, in code, that the
production wiring was never finished. The green log proves the parts work in
isolation; the dev server proves nothing of the sort. AC1.1, AC1.3, AC1.4,
and AC1.5 are unmet end-to-end. E-001 (the chrome-devtools-mcp scenario) is
not exercisable.

## Critical clusters (3)

### CR-1 — Production data path is a stub: `fetchPoolStats` returns hardcoded zeros and the entire compute pipeline is orphaned

**Files:** `independent/01-market-stats/src/main.tsx:47-65`,
`independent/01-market-stats/src/dataLayer.ts:51-80`,
`independent/01-market-stats/src/fillFetcher.ts:48-72`,
`independent/01-market-stats/src/types.ts:1-32`.

**Source consolidation:** Reviewers 1, 2, 3, 4, 5 each filed this dimension
under a different aspect — the cluster script split it into C001 (R1-001 +
R3-005), C003 (R2-001), C006 (R4-003), C015 (R1-004 + R3-012), C018 (R4-002 +
R4-006), C020 (R5-001), C022 (R2-004), C025 (R2-003), C026 (R4-001), C037
(R5-002 + R5-009). These are not 10 distinct findings; they are 10 framings of
one defect. Consolidating per the agent's "merge near-duplicates" rule.

**What's wrong (verified against source):**

- `main.tsx:47-56` defines `fetchPoolStats` as `async (descriptor) => ({
  volume24h: 0, lastPrice: undefined, midPrice: undefined, spread: undefined,
  depthWithinOnePercent: 0, sparkline: [] })`. No RPC call is made; no error
  is thrown.
- `main.tsx:59-60` reads `void loadManifest; void RPC_URL;`. These statements
  exist solely to silence unused-import warnings — `loadManifest` (the
  validated Node-side loader from `manifest.ts`) is never invoked, and
  `RPC_URL` is never threaded into anything.
- `main.tsx:20-46` re-implements manifest loading inline as a `fetch('/localnet.json')`
  → `JSON.parse` → manual object access. This duplicate loader silently coerces
  a missing `packages.deepbook.packageId` to `''` (line 38), where the
  validated loader at `manifest.ts:50-55` would throw an actionable error.
- `manifest.ts:12` imports `node:fs`, so it cannot run in the browser bundle
  at all — explaining (but not justifying) the inline reimplementation.
- `dataLayer.ts:51-80` defines `runDataLayer` returning `Promise<void>`. It
  issues `sui_getObject` and `suix_queryEvents` per pool (lines 67-78) and
  throws every response away. No parsing into `PoolInnerState`, no traversal
  of the `book.asks` / `book.bids` BigVector slices the `notes/chain-shape.md`
  Step 4 explicitly requires, no decoding into `RawFillEvent[]`, no return.
  `grep runDataLayer` shows exactly one consumer: `tests/networkShape.test.ts`.
- `fillFetcher.ts` defines `QueryEventsFn` with a fictional pre-decoded
  `RawFillEvent` shape (`{ poolId, timestampMs, baseQuantity, price }`) that
  is neither what `dataLayer.rpc()` returns nor what any consumer constructs.
  No production call site exists.
- `types.ts:10-32` declares `PoolDescriptor`, `ManifestPoolEntry`,
  `DeploymentManifest`, `LoadedManifest`. `grep -rn "from.*types"` across
  `src/` and `tests/` returns **zero matches** — the file is dead. The two
  types actually used at runtime (`PoolDescriptor`, `LoadedManifest`) are
  re-declared in `manifest.ts:14-24` and consumers import from there.

**Impact:** AC1.1 ("page boots in development mode without runtime errors and
renders in a modern browser" *with the sandbox up*) fails because every card
renders sentinels. AC1.3 ("each card displays the six required statistics")
fails for the same reason. AC1.4 (mid/spread/depth from `sui_getObject`) and
AC1.5 (24h volume + sparkline from `suix_queryEvents`, no indexer pool-keyed
routes) are satisfied only against `App.test.tsx`'s injected mock deps — the
deployed SPA has no chain-direct path. E-001 cannot pass. The unit suite is
**a tautology farm**: T-014 locks down URLs of an orphan function, App tests
use injected fakes, the connecting glue is missing.

**Severity = critical** (re-derived from the rubric): contract violation that
ships if merged. Adversary path is the user themselves: open the dev URL,
see structurally-valid empty cards, conclude "the sandbox is idle" — exactly
the silent-failure pattern the cycle-review rubric calls out as worst-case.

**Fix:** Build a real composer (either inline in `main.tsx` or in a new
`src/composeDataLayer.ts`) that, per descriptor: (1) calls `sui_getObject` +
`suix_getDynamicFields` to traverse Versioned → PoolInner → Book → BigVector
slices and assemble a `PoolInnerState`; (2) calls `fetchFills` against a
JSON-RPC `suix_queryEvents` adapter that returns the `RawFillEvent` shape
`fillFetcher` expects; (3) feeds them into `computeMarketStats` and
`aggregateFills`; (4) returns `PoolCardData`. Drop the dual manifest loader
by splitting `manifest.ts` into a pure `parseManifest(rawJson)` and two thin
sources (`loadFromFs` for tests, `loadFromFetch` for the browser). Delete
`types.ts` or migrate every consumer to import from it; one home, not three.

### CR-2 — `decodeBidPrice` cannot recover the captured chain price; tests pass because the fixture builder reuses the broken encoding

**File:** `independent/01-market-stats/src/marketStats.ts:49-53`. **Source:**
R1-002, currently filed under C008 (the consolidator merged it with two
unrelated `marketStats` concerns).

**What's wrong (verified against `notes/chain-shape.md:188-225`):** The
captured `OrderInfo` event for an `is_bid: true` order shows
`order_id: "12377783720203182843884075"` paired with `price: "671000"`.
Running the implementation:

```
id          = 12377783720203182843884075n
inverted    = id / 2^64                 ≈ 671088n
decoded     = U64_MAX - inverted        ≈ 18_446_744_073_708_880_527
```

The decoded value is ~1.84e19, not 671000. The implementation models bid
order_ids as `((U64_MAX - price) << 64) | counter`, but the captured bid
order_id is ~1.24e25, well below `U64_MAX << 64 ≈ 3.4e29`, so that model is
wrong for the live sandbox. The real bid encoding is something else (possibly
`(MAX_PRICE_RANGE - price) << bits | counter` with a smaller range, or — per
chain-shape `next_bid_order_id: "18446744073709548345"` (~U64_MAX − 3270) —
the encoding may be u64-sized rather than u128). The chain-shape notes
themselves recommend reading `price` directly off the companion `OrderPlaced`
event and using order_id decoding only as a fallback (lines 136-145).

The unit test `marketStats.test.ts` builds its bid fixtures with the same
inverted u128 formula the decoder undoes, so it's a tautology — the decoder
"recovers" the price the test inserted, and never sees a real on-chain
order_id.

**Impact:** Once the data path is wired (per CR-1), `bestBid`, `midPrice`,
`spread`, and `depthWithinOnePercent` will be wrong by many orders of
magnitude on every pool. AC1.4's invariant (`bestBid <= mid <= bestAsk`) will
likely fail against any live capture. Depth at ±1% from mid will collapse to
zero because real bid prices fall outside the band derived from a garbage mid.

**Severity = critical:** the AC1.4 numeric correctness invariant is
unsatisfiable. Adversary path is mechanical: any live sandbox bid order
produces visibly nonsense numbers.

**Fix:** Either (a) add a `price?: number` field to the `Order` interface in
`marketStats.ts` populated by joining each Order with its `OrderPlaced` event
in the data layer, and prefer it over decoding (chain-shape's stated
preference); or (b) re-derive the bid encoding empirically from the captured
sample (`order_id, price`) pair and add a regression test whose fixtures use
the captured order_id verbatim — not a builder-roundtrip.

### CR-3 — Manifest URL `/localnet.json` is not served by the dev server, so the SPA cannot boot against a real sandbox

**Files:** `independent/01-market-stats/src/main.tsx:17-28`,
`independent/01-market-stats/vite.config.ts:1-13`. **Source:** R1-005 (C002).

**What's wrong (verified against source):** `main.tsx:17` sets
`MANIFEST_URL = '/localnet.json'`. `vite.config.ts` is a 12-line file with
only `react()` plus a `vitest` block — no `fs.allow`, no proxy, no middleware,
no plugin that exposes the sandbox manifest to the dev server. There is no
`public/` directory in `independent/01-market-stats/`. There is no symlink to
`~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json`. The contract's
Integration / sandbox contract section explicitly required this choice be made
and documented; neither was done. Even the inline error message
(`main.tsx:24-27`) instructs the user to "re-symlink the manifest under
public/" — but the Vite default does not serve a `public/` that does not exist,
and no setup step creates one.

**Impact:** Every `pnpm dev` boot will 404 on `/localnet.json` and surface
the manifest-missing error UI. Combined with CR-1, the SPA is a static error
screen until an operator manually resolves a documentation gap that the cycle
contract specifically said to close. AC1.1 fails end-to-end.

**Severity = high → re-derived to critical** when paired with CR-1. A user
cannot reach the (broken) data path because they cannot pass the loader.

**Fix:** Pick one of (a) Vite middleware: `configureServer(server) { server.middlewares.use('/localnet.json', (req, res) => fs.readFile(resolve(homedir(), 'workspace/deepbook-sandbox/sandbox/deployments/localnet.json')).pipe(res)) }`; (b) a `public/localnet.json` symlink created by a `pnpm dev:setup` script; (c) a Vite `define`-injected manifest at build time. Document the choice in a `[forge-process]` friction-log entry as the contract requires.

## High clusters (10)

### H-1 — `fetchFills` never filters events by `poolId`, so per-pool stats mix events from all pools

**File:** `independent/01-market-stats/src/fillFetcher.ts:48-72`. **Source:**
R1-003, currently filed under C012.

Verified: `fetchFills` accepts `poolId`, forwards it to `queryEvents`
(line 55), then iterates `response.data` (line 57) appending every entry
without `ev.poolId === poolId` guard. The chain-direct filter in
`dataLayer.ts:74` uses `MoveModule { package, module: 'pool' }` only, which
per `chain-shape.md:264` returns `OrderInfo` events from **all** pools the
deployed package serves. Each `OrderInfo` payload carries `pool_id` (visible
at `chain-shape.md:217`), so demultiplexing is possible — but the code does
not do it. With the sandbox's two pools (`DEEP_SUI`, `SUI_USDC`), the
SUI/USDC card and the DEEP/SUI card would display the same volume figure,
and last-price would be whichever pool emitted the most recent event. AC1.5
violated. Masked today only by CR-1.

**Fix:** Filter inside `fetchFills` (`if (ev.poolId !== poolId) continue;`)
or restructure so the data layer fetches once per refresh and demultiplexes.

### H-2 — `runDataLayer` issues RPC calls but discards every result; failures-by-shape are invisible

**File:** `independent/01-market-stats/src/dataLayer.ts:51-80`. **Source:**
R1-004, R3-012 (C015). Subset of CR-1 but documented separately because the
fix is distinct: even if a composer is added, the calls inside `runDataLayer`
have no shape validation — `if (!result?.data?.content) throw ...` is missing.
A pool object that exists but lacks the expected `book` field would produce
zero error signal.

### H-3 — `loadManifest` does not validate per-pool entry shape; missing fields silently become `undefined`

**File:** `independent/01-market-stats/src/manifest.ts:57-66`. **Source:**
R1-007, R3-003 (C021). Re-derived from medium → high because the missing
fields propagate as the literal string `'undefined'` into `sui_getObject`
calls, producing cryptic RPC errors far from the root cause.

**Fix:** Validate each entry's `poolId`, `baseCoinType`, `quoteCoinType` are
non-empty strings; throw `Manifest pool <symbol> is missing field <name>`.

### H-4 — App's `Promise.all` aborts at first failure; one transient pool error blanks the whole dashboard

**File:** `independent/01-market-stats/src/App.tsx:30-40`. **Source:** R3-007,
R2-008 (C030, C031). Per `chain-shape.md:299-310`, the BigVector slice churn
on the live sandbox routinely returns `{ error: { code: "deleted" } }` on
naive read paths. Under that condition, `Promise.all` rejects the whole batch
and the user sees a global error UI even when N-1 of N pools are healthy.
AC1.3 ("one card per sandbox-published pool") violated under partial failure
— the realistic case, not an edge case.

**Fix:** `Promise.allSettled` + per-card error sentinel.

### H-5 — App has no periodic refresh; sparkline-freshness AC is not architecturally addressed

**File:** `independent/01-market-stats/src/App.tsx:28-46`. **Source:** R2-009
(C030). The contract's In-scope list explicitly requires "Periodic refresh of
the fill stream so the sparkline reflects new fills within 30 s." `App.tsx`
runs the fetch once on mount and never schedules a re-fetch. No
`setInterval`, no polling hook. AC1.5 freshness behavior is silently absent;
E-001 will fail when run.

**Fix:** Add a `useChainPolling(intervalMs, fetcher)` hook with cleanup, or
inline `setInterval` in the effect.

### H-6 — `manifest.ts` uses `node:fs` and cannot run in a browser; `main.tsx` forks the loader

**File:** `independent/01-market-stats/src/manifest.ts:12`,
`independent/01-market-stats/src/main.tsx:20-46`. **Source:** R2-004 (C022).
Subset of CR-1 but listed because the fix (split `parseManifest` from the
sources) is the structural prerequisite for unifying the two loaders. As-is,
the unit-tested validations live in the dead code path; the production loader
in `main.tsx` is untested.

### H-7 — `runDataLayer` cannot return data; design forecloses use as the production data layer

**File:** `independent/01-market-stats/src/dataLayer.ts:51`. **Source:**
R2-002 (C016). Signature is `Promise<void>`; cannot be plumbed to the UI
without changing the signature. Listed because the fix is non-cosmetic — the
return type and shape decision is load-bearing for CR-1's composer.

### H-8 — `T-014` verifies an orphan `runDataLayer`; production fetch path is uncovered

**File:** `independent/01-market-stats/tests/networkShape.test.ts:139`.
**Source:** R5-001 (C020). T-014 is the test the cycle relies on to enforce
AC1.5's no-indexer-pool-keyed-route invariant. It locks down the URL shape of
a function that ships dead. The shipped SPA could call `:9008/get_pools` with
no test catching it. **The cycle's most important integration test is a
tautology.**

**Fix:** Either wire `runDataLayer` (preferred — closes both this and CR-1),
or add a parallel network-shape test that drives `App` with the real
`fetchPoolStats` under a fetch spy.

### H-9 — `T-019/T-020` pass because App echoes the loader's own error message verbatim; no actionability is asserted

**File:** `independent/01-market-stats/tests/App.test.tsx:132-188`. **Source:**
R5-002 (C037). The contract requires "actionable inline error UI"; the tests
stub the loader to throw a message containing `deploy-all` and then assert
the rendered DOM contains `/deploy-all/i`. Replace the stubbed message with
`'whatever'` and the test would fail — proving it only checks string
passthrough, not that App contributes any recipe text. AC1.1's actionability
is unverified.

### H-10 — `types.ts` is dead; chain-shape-derived types duplicate across modules

**File:** `independent/01-market-stats/src/types.ts:1-32`. **Source:** R2-003,
R4-001 (C025, C026). Verified via `grep -rn "from.*types" src/ tests/` →
zero hits. The chain-shape file is the single source of truth in name only;
in practice five files own private copies of the same shapes. The doc-comment
that cites `notes/chain-shape.md` (the AC1.6 audit signal) lives in the file
nobody reads. T-022 (the chain-shape doc-comment test) passes because the
`/chain-shape\.md/` regex hits the dead file.

## Medium / Low / Info

| Severity | Count | Notable items |
|---|---|---|
| Medium | 8 | C004 (main.tsx loadManifest path uses unguarded `JSON.parse` and no validation); C006 (`void loadManifest; void RPC_URL;` dead-import suppression); C009 (Order type omits `price`; doc says event-source preferred); C010 (`BigInt(orderId)` no try/catch); C013 (`fillFetcher.QueryEventsFn` invents a custom shape); C017 (`rpc()` does not check `response.ok`); C023 (loadManifest swallows fs error cause); C024 (PoolDescriptor declared in 3 places); C033 (no test exercises 30-s refresh); C038 (PoolCard tests check labels not values) |
| Low | 7 | C005 (#root null silent skip); C007 (`as unknown as` env cast); C011 (depth loop duplication); C014 (`while (true)` no iteration cap); C019 (RunDataLayerArgs duplicates manifest type inline); C027 (PoolCardData widens always-defined fields); C029 (PoolCard fmt guards null on number\|undefined); C034 (aggregateFills NaN poisoning); C035 (DAY_MS duplicated); C039 (T-022 sentinel marker test); C040 (T-013 `>=50` instead of `===50`); C041 (T-011 sparse sparkline value-blind) |
| Info | 3 | C028 (`fmt` uses `String(value)` → scientific notation); C032 (App state machine could be derived); C036 (~600 LOC vs ~200-300 envelope) |

The medium block clusters around the same root cause as the criticals: dual
loaders, unvalidated coercions, types-without-source-of-truth. Fixing CR-1
naturally absorbs C004, C006, C013, C019, C024, C027 because the composer
forces a single type home and exercises the validated loader.

## Triangulation notes (≥2 reviewers, high-confidence)

- **CR-1 family** — flagged independently by R1 (R1-001), R2 (R2-001, R2-002,
  R2-003, R2-004), R3 (R3-005, R3-012), R4 (R4-001, R4-002, R4-003, R4-006),
  R5 (R5-001, R5-002). Five of six reviewers converged on "the production
  wiring is dead." The sole non-flagger (R6) returned no findings (file is
  1 line — see `.forge/cycles/1/reviewers/subagent-6.json`). High confidence.
- **H-3** (per-pool entry shape validation) — flagged by R1 (R1-007) and R3
  (R3-003). High confidence.
- **CR-2** (bid-decode mismatch) — flagged by R1 only (R1-002). Singleton
  high promoted to **critical** per agent rubric only after re-derivation
  against `chain-shape.md` confirmed the captured order_id does not roundtrip
  through the implementation. Adversary path is concrete: any live bid order
  on the sandbox.
- **CR-3** (manifest URL not served) — flagged by R1 only (R1-005). Singleton
  promoted from high to critical after verification (no `public/`, no Vite
  middleware, no setup script).

## False positives demoted

None outright rejected. All clusters at high+ survived source verification.
Two were re-scoped:

- **C008** as filed conflated three concerns (R1-002 bid-decode, R1-006 status
  filter, R1-009 BigInt → Number safety). Per the agent's mega-cluster split
  rule: R1-002 is now CR-2 (critical, verified against chain-shape); R1-006
  (status filter) stays as a medium because the chain-shape note about
  BigVector churn makes the race plausible but not load-bearing on a quiet
  sandbox; R1-009 (Number cast overflow) is low because sandbox quantities
  fit in Number.MAX_SAFE_INTEGER.
- **C016** (rpcId module-mutable counter) is correctly disputed and stays
  low — JSON-RPC ids only need uniqueness within a connection, and the
  current code never asserts on the id. The C016 description bundle (R2-002,
  R2-010) actually contains the bigger H-7 finding (runDataLayer signature is
  Promise<void>); H-7 is broken out above to sit at high.

## Recommended next action

**Re-dispatch green with feedback.** The cycle's pure modules are sound;
the test suite's coverage of those modules is sound; what is missing is the
~80-150 LOC of integration code that turns the modules into an SPA. Concretely,
the next implementer pass should:

1. (CR-1 / CR-3) Pick a manifest delivery mechanism, configure `vite.config.ts`,
   and split `manifest.ts` into `parseManifest` + thin sources. Land a
   `composeDataLayer.ts` that returns `Promise<PoolCardData[]>` and is called
   from `main.tsx`'s `fetchPoolStats`. Drop `void loadManifest; void RPC_URL;`.
2. (CR-2) Add `OrderPlaced.price` joining to the data layer; expose `price` on
   `Order`; prefer it in `computeMarketStats`. Add a regression test using the
   verbatim `order_id`/`price` pair from `notes/chain-shape.md`.
3. (H-1) Filter `fetchFills` by `ev.poolId` or demultiplex at a higher layer.
4. (H-4 / H-5) Switch `App.tsx` to `Promise.allSettled` and add a
   `useChainPolling(20_000, refresh)` hook with cleanup.
5. (H-8 / H-9) Re-target `T-014` (network-shape) and `T-019/T-020`
   (error-actionability) at the wired path so they enforce AC1.5 / AC1.1
   against the code users hit.
6. (H-10) Delete `types.ts` or migrate every consumer to import from it;
   pick one home for chain-shape-derived types.

`cycle-pass.sh` will exit non-zero on this review (`critical>0`,
`disputed_severity>0`); do not silently advance to Cycle 2. The deliverable as
shipped is a defective SPA that looks healthy because the test suite is
testing its own fixtures.

## Methodology

- 6 reviewers dispatched (R1 correctness, R2 design, R3 error-handling,
  R4 simplicity, R5 tests-vs-impl, R6 security). R6 returned an empty findings
  array — appropriate for a read-only, wallet-free, in-memory SPA.
- Coverage: 9 source files × 5 active reviewers; 57 raw findings; flag rate
  ~1.27 findings per file-reviewer pair (typical for first-cycle work).
- Clusters from script: 41. After consolidation: 3 critical, 10 high,
  10 medium, 9 low, 3 info — and 8 of the original critical/high clusters
  merged into CR-1 (per the mega-cluster-split rule applied in reverse to
  re-cluster cross-file framings of one root defect).
- Verification: 13 critical/high clusters opened against source. Files read:
  `main.tsx`, `dataLayer.ts`, `manifest.ts`, `marketStats.ts`,
  `fillFetcher.ts`, `fillAggregator.ts`, `App.tsx`, `components/PoolCard.tsx`,
  `types.ts`, `vite.config.ts`, `index.html`, `notes/chain-shape.md`. Plus
  `grep` checks on `runDataLayer` consumers (1 hit, in `networkShape.test.ts`)
  and `from.*types` consumers (0 hits).
- `cycle-pass.sh` projected result: **FAIL** (critical=3, disputed=present).
