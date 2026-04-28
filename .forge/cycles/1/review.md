# Cycle 1 — Final Consolidated Review (Slot 1 Market Stats)

## Verdict

**ACCEPTED — DELIVERED WITH CAVEATS.** Implementation is functionally correct and verifiable; cycle-pass.sh's strict gate (zero critical AND zero disputed) was not satisfied due to meta-severity disagreements among reviewers, but no triangulated correctness bugs remain after iter-4. Per user decision (auto-mode, after retry cap = 3 was reached at iter-4), advancing to Cycle 2 with all carry-forward concerns documented as DevX observations for `independent/FEEDBACK.md`.

## What was built

- React + Vite single-page app at `independent/01-market-stats/` (~1257 LOC TS).
- Reads `~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json` via a Vite dev-server middleware that serves it at `/localnet.json`.
- Enumerates pools dynamically; for each, fetches inner-state via `sui_getObject` + dynamic-field traversal of the BigVector slices, computes mid/spread/depth, and aggregates 24h volume + last-50-trade sparkline from `suix_queryEvents` over the DeepBook `pool` module.
- Bypasses the sandbox indexer REST entirely (the `/get_pools`, `/orderbook/...`, `/trades/...`, `/ticker` routes are non-functional out of the box per Phase-0 finding).
- 24/24 unit tests pass; chain-decode formula empirically verified against captured order_ids from `notes/chain-shape.md` (bid → 671000, ask → 948000, both exact matches).

## Iteration history

| Iter | Outcome | Key change |
|---|---|---|
| 1 | Tests pass, but production wiring is dead | Best-of-1 (coordinator lost Agent tool); `main.tsx` returned hardcoded zeros, `runDataLayer` discarded results, all compute pipeline reachable only from unit tests |
| 2 | CR-2 cosmetic, ASK-side broken | Real `fetchPoolStats` wiring + Vite middleware + Promise.allSettled + setInterval refresh + types.ts as source of truth + manifest split (browser vs node) |
| 3 | ASK formula wrong (bit 127 not stripped) | One-line `Order.price` injection in `dataLayer.traverseBigVector` using `>>64n` (bid-correct, ask-broken) |
| 4 | Functionally correct; quality concerns persist | Bit-127 mask `(id & ((1n<<127n)-1n)) >> 64n`; `buildDeps()` factory replaces `let cachedPackageId`; `console.warn` on BigInt parse failures; unused-import cleanups |

## Iter-4 cluster summary

- **Total clusters:** 45
- **Critical:** 0
- **High:** 10 (all carry-forward quality concerns or testability gaps; no triangulated correctness regressions)
- **Disputed:** 4 (meta-disagreements on severity, not on whether the issue exists)

## Headline carry-forward concerns (for FEEDBACK.md)

These are real DevX observations from building Slot 1 against the sandbox. They do NOT block the cycle but should appear in the final `FEEDBACK.md` distillation:

1. **Sandbox indexer pool-keyed REST surface is non-functional out of box.** Forced Slot 1 to chain-direct reads. Source: `[sandbox]` (Phase 0).
2. **DeepBook order_id encoding is undocumented for SDK consumers.** The bit-127 ask flag was not in `chain-shape.md`'s prose; iter-3 missed it; only iter-4's empirical decode against captured chain data resolved it. Source: `[deepbook]`.
3. **`suix_queryEvents` `MoveModule` filter selects on `transactionModule`, not declaring module.** Required filtering on `module: "pool"` for events whose struct symbol is `0x...::order_info::OrderInfo`. Not in @mysten/sui SDK 2.x event-fetching docs. Source: `[sui-sdk]`.
4. **No reference indexer-consuming dashboard in the sandbox.** Slot 1's chain-reads were greenfield against the sandbox; no proven dashboard pattern to mirror. Source: `[sandbox]`.
5. **Pyth oracle `:9010` is a status endpoint, not a price feed.** The faena.md brief and other docs imply it's queryable for prices; it's not — keeper/consumer must read on-chain `PriceInfoObject`. Source: `[sandbox]`.
6. **`pnpm deploy-all` swallows publish errors.** Phase 3 failures show only build warnings; the actual `sui client test-publish` error message is not surfaced. Required out-of-band debugging during G-Boot. Source: `[sandbox]`.
7. **`docker compose down -v` not run by `pnpm deploy-all`.** Indexer postgres state survives between deploys; FIRST_CHECKPOINT=0 is ignored when postgres cursor says "already past." Discovered as a red herring during the indexer-pools-empty diagnosis. Source: `[sandbox]`.
8. **TypeScript LSP from worktree root doesn't index sub-package node_modules.** Recurring stale-diagnostic noise across all iterations even though runtime tests pass cleanly. Source: `[forge-process]`/`[sui-sdk]` ambiguous; carry as `[forge-process]` unless the consolidator deems it broader.

## Carry-forward quality concerns (NOT in FEEDBACK; tracked here only)

- LOC overage: 1257 vs spec envelope 200-300 (~4-6x). Some justified by chain-traversal complexity; some real bloat (parallel APIs, untouched dead types).
- App.tsx polling effect lacks cancellation flag (initial-load effect has one).
- `fillFetcher` pagination unbounded across busy/sparse pool boundaries.
- `resolvePoolInnerFields` returns null on missing content; `buildPoolInnerState` then silently fabricates an empty book.
- `rpc()` doesn't check `response.ok`; non-2xx surfaces as confusing JSON-parse SyntaxError.
- `types.ts` exports 5 unused interfaces (R4 R5 R6 of types.ts).
- Doc/code drift in `marketStats.ts` and `types.ts` comments still describe a non-existent OrderInfo-event injection design (prose mismatch with iter-4's bit-127 decode).
- Three duplicate bit-decode formulae (`decodeAskPrice`, `decodeBidPrice`, inline ASK_FLAG_MASK).
- `buildDeps()` factory in `main.tsx` is exercised by zero tests (App.test stubs deps).

## Audit trail

- Iter-1 review: `cycles/1/review-iter1.md` + `_consolidated-iter1.json` + `reviewers-iter1/`
- Iter-2 reviewers/consolidated: `reviewers-iter2/`, `_consolidated-iter2.json`
- Iter-3 reviewers/consolidated: `reviewers-iter3/`, `_consolidated-iter3.json`
- Iter-4 reviewers/consolidated: `reviewers/`, `_consolidated.json` (current)
- Synthesis notes (full iteration record): `cycles/1/green/synthesis-notes.md`
- Friction log appends throughout: `independent/raw-friction.log`

## Next

Advance to Cycle 2 (Slot 2 Move slippage swap). Smaller scope (single Move module + tests), no off-chain TS, less iteration risk.
