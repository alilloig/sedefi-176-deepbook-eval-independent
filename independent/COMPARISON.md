# COMPARISON — Existing vs Independent FEEDBACK

## §0 — Reading guide

Two evaluations of the DeepBook sandbox DevX exist in this repo:

- **Existing**: `FEEDBACK.md` at the repo root. Built earlier by another evaluator; uses the `@mysten/deepbook-v3` SDK in App 1, classifies findings with `[blocker]/[friction]/[papercut]/[polish]` tags, and validated end-to-end via `pnpm deploy-all --quick`.
- **Independent**: `independent/FEEDBACK.md`. Built by this session across 6 build cycles per `independent/faena.md`, deliberately without reading the existing eval (forbidden-read boundary). Sources every bullet from `independent/raw-friction.log` with ISO timestamps.

This comparison is structured for two-evaluator agreement signal: §2 is where both converge (highest confidence), §3 / §4 are unique to one eval each (each with a verdict tag), §5 is where they actively disagree, §6 distills the net signal for MystenLabs.

The verdict tags in §3 / §4 are:

- **Real, scope-specific** — the other eval's apps wouldn't have hit it. Both findings stand; the gap is in evaluator coverage, not finding accuracy.
- **Real miss** — the other eval should have seen it given their app surface but didn't catalog it.
- **False positive / over-flagged** — checked against current source; not actually broken.

Verdicts came from cross-referencing the FEEDBACK claims, spot-checking the existing apps' implementations (`01-orderbook-viewer/`, `02-fee-rebate-swap/`, `03-dca-vault/`) for what surface they actually exercised, and consulting `independent/raw-friction.log` for the same on the independent side.

---

## §1 — Methodology snapshot

| Dimension | Existing | Independent |
|---|---|---|
| App 1 | Order-book viewer (uses `@mysten/deepbook-v3` SDK) | Public market-stats SPA (chain-direct via raw fetch JSON-RPC; SDK avoided) |
| App 2 | Fee-rebate swap (Move 2024, no-manager `swap_exact_quote_for_base`) | Slippage-protected swap (Move 2024, no-manager `swap_exact_base_for_quote`) |
| App 3 | DCA vault (Move + TS keeper + React UI; **time-triggered**) | TP/SL vault (Move + TS keeper + React UI; **price-triggered**) |
| Wallet layer | dapp-kit-react + dev-wallet in App 3 UI | dapp-kit-react + dev-wallet in App 3 UI |
| Keeper trigger | Time (clock-based, deterministic) | Price (Pyth `PriceInfoObject` BCS reads) |
| SDK posture | Tried `@mysten/deepbook-v3`, hit gRPC `SimulateTransaction` crash on most reads | Deliberately did not use the SDK in any of the three apps |
| Indexer posture | Dashboard's `/health` only; no indexer integration in apps | Tried for App 1, abandoned after discovering `pools` table never populated → pivoted to chain-direct |
| Move package layout | Apps under repo root, `Move.toml` uses local relative paths | Apps under `independent/`, `Move.toml` uses absolute `/Users/alilloig/...` paths |
| Eval phases | Phase 1 read-only static review + Phase 2 full E2E live run | Continuous friction log across 6 build cycles (Cycle 1–5 apps, Cycle 6 docs) |
| Output severity model | `[blocker] [friction] [papercut] [polish]` inline tags | Three required ticket sections + TL;DR + source-attributed bullets |

The scope deltas explain a number of one-sided findings: independent's price-triggered keeper exposed Pyth-read friction that a time-triggered keeper would never see; existing's SDK use exposed gRPC bugs the no-SDK path could not see; independent's no-SDK + no-indexer path forced contact with `order_id` encoding that the SDK would have hidden.

---

## §2 — Common findings (both evaluators converge)

These are the highest-confidence findings: two evaluators independently reached the same place. MystenLabs should weight these accordingly.

1. **`pnpm deploy-all` is high-leverage and the right architectural primitive.** Both praise the one-command bring-up of the full stack (RPC + indexer + oracle + market-maker + dashboard).
   - Existing: §3.1 "complete stack in ~2 minutes."
   - Independent: §1 "architecturally the right primitive — high-leverage when working" + TL;DR.

2. **The fresh-boot flow has real bugs that the deploy script reports as success.** Different layers, same theme.
   - Existing: §4.4 — DEEP/SUI on-chain pool permanently empty after deploy because the shared BalanceManager runs out of funds rebalancing SUI/USDC first. `pool state shows asks.length=0, bids.length=0`. Health endpoint still says `healthy`.
   - Independent: §3 (lines 75–79) — the indexer's `pools` postgres table is never populated by any sandbox script (`grep -rn "INSERT INTO pools"` returns nothing); `pnpm deploy-all` doesn't `docker compose down -v` first, so postgres state survives across runs and the indexer cursor desyncs from the regenerated chain.
   - **Agreement signal**: deploy-all reports success while leaving observable downstream surface broken. Existing caught the on-chain symptom; independent caught the indexer symptom. Both are real, both are silent.

3. **`@mysten/deepbook-v3` SDK has structural problems for actual DeepBook integrators.** Different paths to the same conclusion.
   - Existing: §4.3 (lines 240–342) — `SimulateTransaction` crash with `Cannot read properties of undefined (reading 'returnValues')` affecting `midPrice`, `getLevel2TicksFromMid`, `poolBookParams`, `vaultBalances`. Root-caused to TypeScript non-null assertions on gRPC field-mask edge cases. Only `balanceManagerQueries.ts` has guards.
   - Independent: §3 (line 101) — SDK was deliberately not used by *any* of the three apps. App 1 dropped it because the indexer surface it wraps is broken; App 3 dropped it because it wraps the wrong layer for keeper-via-Move-wrapper patterns.
   - **Agreement signal**: existing tried it and hit specific bugs; independent never adopted it because the natural integration shapes didn't fit. Combined: the SDK has both implementation bugs AND product-fit gaps.

4. **Move package authoring against the bundled DeepBook is friction-laden.** Different specific footguns, same broad theme.
   - Existing: §4.2 — custom Move contracts must live inside `sandbox/packages/` (relative-path lock-in); `.external-packages/` only exists after first deploy so IDE shows red on fresh clone; `sui move build` chicken-and-egg with deploy.
   - Independent: §3 (lines 83, 93) — bundled `deepbook_margin/tests/helper/test_helpers.move:435` references undefined `pyth::price_info::new_price_info_object_for_test` so any package depending on `deepbook_margin` can't `sui move test`; Move 2024 `[environments]` requirement with stale-by-design chain-id (regenerated on every `pnpm deploy-all`).
   - **Agreement signal**: integrating a custom Move contract that depends on bundled DeepBook is harder than it should be at multiple distinct layers.

5. **`@mysten-incubation/dev-wallet` namespace is a UX red flag for a default wallet.**
   - Existing: §4.3 — "the `@mysten-incubation/...` name is a red flag for the default wallet in a prod-facing tool."
   - Independent: §2 (line 63) — `InMemorySignerAdapter` lives at `@mysten-incubation/dev-wallet/adapters` (unexpected, rest of dapp-kit is under `@mysten/`), no doc page indexes it, developers have to mirror `sandbox/dashboard/src/dapp-kit.ts` to find it.
   - **Agreement signal**: both evaluators independently tagged this as a smell at the package-name level.

6. **Event subscription / event filtering is undocumented or wrong.**
   - Existing: §4.6 — no event subscription example anywhere in `examples/sandbox/`; needed for any off-chain keeper.
   - Independent: §3 (line 87) — `suix_queryEvents` `MoveModule` filter selects on emitter module, not the event struct's declaring module. Filtering `module: "order_info"` returns zero events even though the type symbol contains `::order_info::`. Took 4 cycle iterations to land empirically.
   - **Agreement signal**: existing flagged the absence; independent flagged the specific footgun when you try to fill the absence.

7. **Pool/swap edge-case semantics need explicit documentation.**
   - Existing: §4.3 — whitelisted pools (`payWithDeep: false`) vs fee-bearing pools is only documented in comments; forgotten DEEP fee causes silent "insufficient DEEP" aborts.
   - Independent: §3 (lines 95, 99) — DeepBook silently no-ops when `base_quantity < min_size` (returns input coins unchanged with `quote_out.value() == 0` rather than aborting); `min_quote_out = 0` correctly disables `EMinimumQuantityOutNotMet` but creates an MEV gap that consumers must defend against, undocumented.
   - **Agreement signal**: the swap surface has multiple silent-failure modes that integrators discover the hard way.

8. **Sui SDK 2.x migration is incompletely documented.**
   - Existing: §4.3 — `SuiClient` → `SuiJsonRpcClient` rename is breaking with cryptic error messages; sandbox itself has v1/v2 pin skew (`sandbox/` pins `^2.5.0`, `examples/sandbox/` pins `^2.5.1`).
   - Independent: §2 (lines 55, 57, 59, 61) — `Transaction#serialize()` deprecated but `tx.toJSON()` requires RPC round-trip; `keypair.sign(bytes)` raw return shape changed; `DAppKitProvider` prop renamed `client` → `dAppKit` with generic React error message; `suix_queryEvents` positional params undocumented.
   - **Agreement signal**: SDK 2.x migration cost is real, distributed across many small breaks rather than one big one. Both evaluators landed correct working code only with non-trivial effort.

---

## §3 — Existing-only findings (with verdicts)

### Real, scope-specific

These are real findings the independent eval would not have hit because of evaluator-specific scope choices.

- **Scaffolder package `@mysten-incubation/deepbook-sandbox` is undiscoverable; natural attempts (`npx deepbook-sandbox`) all 404.** *Why independent missed:* faena.md scoped the build to start from a clean `independent/` directory, not via the scaffolder; independent never invoked it.
- **`sui client objects --json` BCS format unusable for jq scripting.** *Why independent missed:* independent did all object lookups via raw `suix_getCoins` JSON-RPC, never used the `sui client` CLI for object listing.
- **gRPC `SimulateTransaction` crash on SDK reads.** *Why independent missed:* independent never adopted the SDK in any app, so couldn't trigger SDK-internal codepaths. Existing correctly identified a real bug independent missed by avoidance.
- **Pool `tick_size` undocumented; `place-limit-order.ts` hard-codes `TICK_SIZE = 0.000001`; off-tick prices fail silently.** *Why independent missed:* independent's Slot 2 wraps a market swap and Slot 3 fires a market trigger; no limit-order path exercised.
- **`extractObjectId(objs, "Registry", "MarginRegistry")` uses string-prefix matching by convention; typo silently binds wrong object.** *Why independent missed:* independent built helpers but didn't use the existing `setup.ts` pattern at all, so didn't encounter the convention.
- **Pyth historical prices (24h-old) being non-zero and deterministic is a smart dev affordance.** *Why independent missed:* independent reads on-chain `PriceInfoObject` BCS directly, bypasses the historical-price path entirely.
- **Faucet HTTP API has no schema.** *Why independent missed:* independent's Slot 1 has no wallet so didn't faucet; Slot 3 keeper reads chain only.
- **Dashboard "Create Balance Manager" lazy init suggests Registry should enforce the BM invariant.** *Why independent missed:* independent's Slot 3 deliberately uses the no-manager swap path, never created a BM.
- **`Pub.localnet.toml` regenerated/wiped on `pnpm down`.** *Why independent missed:* independent never invoked `pnpm down` mid-cycle.
- **`pnpm down` destructive by default with no `--keep-state` escape hatch.** *Why independent missed:* same as above.
- **8 GB Docker RAM is steep for entry-level M1 machines.** *Why independent missed:* operational concern; independent ran on a workstation with sufficient RAM and didn't probe minimum-spec.

### Real miss by independent

These are findings independent's apps did exercise the surface for and should have cataloged.

- **Sui CLI version pinning is soft (1.63.2–1.64.1 recommended); a `sandbox doctor` should reject out-of-range versions.** Independent ran every cycle through `sui` CLI for `move test` / `move build` and would have benefited from a doctor check, but never audited CLI compatibility as a finding.
- **Boilerplate `buildPackageIds` / `buildCoinMap` / `buildPoolMap` / `extractObjectId` (~70 LOC) every integrator re-derives from `examples/sandbox/setup.ts`.** Independent built equivalent helpers in keeper code but didn't generalize the observation to a pattern. Existing's framing as "the SDK should ship this" is the more actionable form.
- **`SuiClient` → `SuiJsonRpcClient` rename specifically.** Independent's bundled docs (`sui-pilot`) caught the broader 2.0 migration cost so independent landed correct code, but didn't flag the rename as a discrete papercut. Real friction independent absorbed silently.
- **Sandbox's own internal v1/v2 SDK version pin skew (`sandbox/` `^2.5.0` vs `examples/sandbox/` `^2.5.1`).** Independent didn't audit the sandbox's package.json files for version drift across subpackages.
- **No CI for `examples/sandbox/*.ts` scripts.** Meta finding; independent never probed sandbox CI posture.
- **No Move formatting CI gate.** Same meta layer.
- **Market maker has no Prometheus/Grafana preset.** Independent only probed MM through `/health` JSON; didn't check observability surface.
- **`FORCE_REGENESIS=true` wipes state on every restart.** Independent suffered this directly during cycles but didn't catalog as a finding (treated as a known workflow constraint instead of a friction point).
- **Three independent manifest paths (env, JSON file, HTTP endpoint).** Independent only used the JSON file at `sandbox/deployments/localnet.json`; didn't observe and praise the three-path optionality.
- **README is unusually thorough with data-flow diagram and appendices.** Independent made no remarks about the sandbox README quality.
- **Health endpoints on every service.** Independent used `/health` once for keeper liveness and didn't praise the pattern as a developer affordance.

### False positive / over-flagged

After spot-checking the implementation, none of existing's findings are false positives. The eval is well-grounded.

---

## §4 — Independent-only findings (with verdicts)

### Real, scope-specific

- **Pyth `:9010` is a status endpoint, not a price feed.** *Why existing missed:* existing's DCA is time-triggered, never read prices, never touched `:9010` for anything other than the brief health probe.
- **`PriceInfoObject` BCS layout (34 bytes: `magnitude: i64` + `exponent: i32` + `timestamp_secs: u64`) is undocumented anywhere.** *Why existing missed:* same Pyth exposure delta. Independent had to capture the layout empirically (`independent/03-tpsl-vault/keeper/notes/pyth-shape.md`).
- **DeepBook v3 `order_id` encoding is undocumented and bundled `chain-shape.md` prose is actively wrong about bid inversion.** *Why existing missed:* existing's `01-orderbook-viewer` uses `@mysten/deepbook-v3` SDK directly (verified in `01-orderbook-viewer/package.json` and `App.tsx`), which decodes `order_id` opaquely. Independent avoided the SDK and had to decode by hand, exposing the gap. The underlying docs bug is real for anyone who leaves the SDK path.
- **TypeScript LSP doesn't index sub-package `node_modules` cleanly in worktree layouts.** *Why existing missed:* existing didn't use a worktree; this friction is worktree-specific.
- **`@mysten/deepbook-v3` SDK doesn't fit the keeper-via-Move-wrapper pattern.** *Why existing missed:* existing's DCA keeper presumably submits PTBs with different shape; independent's TP/SL keeper builds an `execute_trigger` PTB that wraps DeepBook through a custom Move contract, where the SDK's swap helper would wrap the wrong layer.

### Real miss by existing

- **Indexer's `pools` postgres table never populated by `pnpm deploy-all`.** Existing engaged with the indexer only through the dashboard's `/health` probe and never tried any pool-keyed REST route (`/get_pools`, `/orderbook/<name>`, `/trades/<name>`, `/ticker?pool_names=...`). Independent's Slot 1 attempted the indexer integration directly and discovered the gap. This is the clearest case of independent catching something existing never put under load.
- **`pnpm deploy-all` doesn't `docker compose down -v` first; postgres state survives runs.** Direct corollary of the above. Existing accepted `pnpm deploy-all`'s success report; independent went down to postgres direct inspection.
- **Bundled `deepbook_margin/tests/helper/test_helpers.move:435` references undefined `pyth::price_info::new_price_info_object_for_test`.** Real bundled-package bug. Existing's apps don't depend on `deepbook_margin` (verified via grep — both `02-fee-rebate-swap` and `03-dca-vault` only depend on `deepbook` core), so they didn't hit it. Independent's Slot 2 attempted the dependency and surfaced it.
- **`suix_queryEvents` `MoveModule` filter selects on emitter module, not declaring module.** Existing flagged "no event example" generally; independent flagged the specific footgun. Existing's keeper presumably worked around or sidestepped it without articulating the underlying confusion.
- **Move `test_scenario` clears event buffer on every `next_tx`.** Real testing footgun. Existing's apps either didn't write event-asserting Move tests or hit and absorbed the friction silently. Independent's Cycle 3 had 4 of 7 tests fail before the orchestrator amended them to assert events inside the emitting tx.
- **Move `test_scenario` shared-object store doesn't reset across two `begin/end` pairs in one test function.** Same testing-layer friction. Independent's Slot 2 boundary test had to be amended out, leaving the `>=` → `>` mutation regression silently uncovered. Existing's tests apparently used single `begin/end` pairs.
- **Move 2024 `[environments]` requirement with stale-by-design chain-id (regenerated on every `pnpm deploy-all`).** Existing's contracts likely worked around with `--build-env testnet` or hadn't yet hit the requirement. Independent ran into it on every cycle.
- **DeepBook silent no-op when `base_quantity < min_size` (returns input coins, no abort, `quote_out.value() == 0`).** Independent's Slot 2 wrapper exposed this when boundary tests probed the threshold. Existing's `02-fee-rebate-swap` uses the same swap function (verified — line 74 of `fee_rebate_swap.move`) but apparently didn't probe below `min_size`.
- **`min_quote_out = 0` MEV gap when used as a slippage delegation pattern.** Independent's TP/SL keeper deliberately passes `min_quote_out = 0` (the condition gate is the slippage gate) and called out the resulting MEV exposure as needing defense-in-depth and explicit docs. Existing's apps don't have a keeper-trigger pattern with this profile.
- **No reference indexer-consuming dashboard exists in sandbox.** Sandbox's own dashboard uses indexer only for `/health`; nothing models the indexer's pool-keyed REST surface. Existing didn't flag this absence as a problem; independent identified it as a gap that would have surfaced (and forced a fix to) the `pools`-table-empty bug if it existed.
- **`Transaction#serialize()` deprecated, but `tx.toJSON()` requires an RPC round-trip; no in-memory inspection alternative for unit tests.** Independent's keeper tests work around by spying on `fetch`, coupling tests to JSON-RPC wire format. Real SDK 2.x friction existing didn't flag.
- **`DAppKitProvider` prop renamed `client` → `dAppKit` in v2.0; error message is generic React render error.** Independent caught this only because of bundled docs; existing's UI uses dapp-kit but didn't flag the rename as a discrete migration cost.
- **Lint `W99010` (`unnecessary 'entry' on a 'public' function`) is ambiguous when spec mandates "entry function" for PTB-callability.** Independent meta-finding from the Move lint surface. Existing didn't address Move linter behavior.

### False positive / over-flagged

After cross-checking, none of independent's findings are false positives. One needs a caveat:

- **"`suix_queryEvents` `MoveModule` filter selects on emitter module"** is correct but the SDK docs do say so in passing — independent's framing as "not documented in `@mysten/sui` 2.x event-fetching docs consulted" is accurate to what they consulted but a deeper search would have found the note. **Real, just slightly less hidden than framed.**

---

## §5 — Hard divergences (where the two evals contradict)

Three places where both evaluators put eyes on the same primitive but reached different conclusions. These deserve explicit articulation:

1. **The three-return-coin swap pattern.**
   - **Existing**: §4.3 calls it a footgun — "all three must be transferred or destroyed or transaction aborts."
   - **Independent**: §1 (line 39) praises it as a clean composition primitive, ~54 LOC to wrap including doc comments and assertion logic.
   - **Verdict**: both are right at different distances. For an integrator who hasn't internalized Move's hot-potato discipline, three coins out is a footgun (you have to consciously route each); for an integrator fluent in the resource model, it is the canonical pattern. The disagreement collapses with one sentence of inline `///` doc comment on the Move function explaining "consumer must transfer/destroy all three returned coins."

2. **`@mysten/deepbook-v3` SDK posture.**
   - **Existing**: tried it, hit specific gRPC bugs, recommends fixing them with concrete patch suggestions.
   - **Independent**: skipped it entirely across all three apps, frames the no-fit as the product signal.
   - **Verdict**: not actually contradictory once stacked. Existing's "fix the bugs" is the actionable engineering recommendation; independent's "doesn't fit either natural use case" is the strategic-positioning observation. Both belong in the same conversation: fix the gRPC bugs *and* re-examine whether the SDK's abstraction level matches what consumers reach for.

3. **The DEEP/SUI pool's actual state.**
   - **Existing** (§4.4): `pool state shows asks.length=0, bids.length=0, vault balances=0` — pool is permanently empty after deploy due to BalanceManager rebalance failure.
   - **Independent** (`raw-friction.log` 2026-04-27T21:47Z): "the bundled sandbox market-maker places + cancels grid orders but never matches its own orders, so `OrderInfo.fills[]` is always empty against an idle sandbox" — orders exist on the book, but no fills.
   - **Verdict**: timeline ambiguity. Both observations were captured the same week; existing's may reflect the pool state before user repair, independent's may reflect a partially-fixed state where the BalanceManager rebalance landed but the MM still doesn't self-match. **For a fresh evaluator hitting this, the existing eval's deeper symptom (pool truly empty) is the higher-severity finding**; independent's observation is consistent with a downstream symptom of the same root cause family.

---

## §6 — Net signal for MystenLabs

What to act on first, informed by both data points:

1. **Fix the bootstrap silent-failures (highest agreement, both evals).** Concretely: (a) `INSERT INTO pools` after pool creation in `scripts/utils/pool.ts` (independent's 30–50 LOC fix), (b) `docker compose down -v` at the start of `pnpm deploy-all` (independent), (c) per-pool BalanceManager so DEEP/SUI rebalance doesn't starve (existing's recommended fix), (d) post-deploy validation gate that fails loud when `SELECT count(*) FROM pools = 2` doesn't hold (independent). Combined: a fresh `pnpm deploy-all` would actually produce a usable sandbox.

2. **Fix `@mysten/deepbook-v3` gRPC bugs AND re-examine the abstraction level (both evals, two angles).** Existing's null-guard fixes for `poolQueries.ts`, `orderQueries.ts`, `quantityQueries.ts` matching the `balanceManagerQueries.ts` pattern will unblock SDK adopters. Independent's "doesn't fit either natural use case" is a separate question: should the SDK ship a Move-wrapping adapter for keeper-via-contract patterns, alongside the direct-swap helper?

3. **Document order_id encoding and ship a `decodeOrderId(orderId)` helper (independent only, real miss by existing).** The bundled `chain-shape.md` is actively misleading and cost independent 4 cycle iterations to land an empirically-correct decoder. SDK adopters get this for free; non-SDK adopters are stranded.

4. **Document Pyth integration end-to-end for keepers (independent only, scope-specific).** `:9010` semantics, `PriceInfoObject` BCS layout, recommended decode pattern. The undocumented BCS layout is the highest-friction surface for any price-triggered keeper.

5. **Tighten the testing-layer footguns (independent only, scope-specific but generalizable).** `test_scenario` clearing event buffers per `next_tx` and not resetting shared-object store across two `begin/end` pairs are both undocumented; one documentation pass on `.move-book-docs/book/testing/test-scenario.md` collapses two blockers.

6. **Adopt the inline `[blocker]/[friction]/[papercut]/[polish]` severity tagging (existing's pattern).** Independent's three-section structure (working / improve / not-working) is the ticket-required form, but mixing in inline severity keeps the most actionable items legible at a glance.

The findings with two-evaluator agreement (§2) are the highest-confidence list to act on. The findings unique to one eval that I judged "real miss by the other" (§3 / §4) are next: they're real DevX issues that one evaluator just didn't get the surface to see. Scope-specific findings are still real, just bounded — ship them as docs improvements anchored to the use case that surfaced them.
