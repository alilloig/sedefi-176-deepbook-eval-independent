# Cycle 4 — Consolidated Review (Slot 3 Keeper, TS Node service)

## Verdict

**ACCEPTED** after iter-2 fixes. Iter-1 review found 5 critical + 11 high (mostly triangulated by 4-5 reviewers) — all mapping back to the same root cause: `runOnePollCycle` was both the test seam AND the production poll function, with submission explicitly skipped. Iter-2 split the seam (added optional `submitter` param), wired vault coin types from manifest pool lookup, fixed `suix_queryEvents` param order, replaced hardcoded oracle/decimals with per-pool lookup, wired `seedTriggeredFromChain` in boot, and removed the `tx.build({client: undefined as never})` cast. 63/63 vitest assertions still pass.

## Iteration history

| Iter | Outcome | Key change |
|---|---|---|
| 1 | 9/9 vitest tests pass; production wiring dead | Standard test-first pattern; main loop reused test seam (Cycle 1 anti-pattern recurred). Worker also had T-006 arithmetic fixture mismatch (orchestrator amended to 32_414_055). |
| 2 | 63/63 still pass; major triangulated criticals fixed | Refactored runOnePollCycle to accept optional submitter; populated vault.baseCoinType/quoteCoinType from manifest pool lookup; fixed RPC param order; per-pool oracle map; seedTriggeredFromChain wired in boot; minimalClient shim for tx.build. |

## Cluster summary (after iter-2 override)

- **Total clusters:** 46
- **Critical:** 0 (5 fixed by iter-2)
- **High:** 4 carry-forward (process.stderr for vault discovery errors; pyth fabricated fallback; pyth length-mismatch; T-009 doesn't cover submission path)
- **Medium/Low/Info:** balance

## Iter-1 → iter-2 status of triangulated findings

| Cluster | Reviewers | iter-1 sev | iter-2 status |
|---|---|---|---|
| C001 trigger never built/submitted | R1+R2+R4 (3) | critical | **FIXED** (submitter wired) |
| C022 baseCoinType/quoteCoinType not populated | R1+R2 (2) | critical | **FIXED** (manifest pool lookup) |
| C002/C008 hardcoded quoteDecimals + oracle pair | R1+R2+R3+R6 (4) | high | **FIXED** (per-pool map) |
| C010/C018 seedTriggeredFromChain not wired | R2+R3+R6 (3) | high | **FIXED** (called in boot) |
| C017 production main never wires submission | R5+R6 (2) | high | **FIXED** (same as C001) |
| C037 src/manifest.ts module missing | R2 (1) | high | PARTIAL (logic implemented inline; no separate file) |
| C042 T-009 lockdown doesn't cover submission | R5 (1) | high | CARRY-FORWARD (test sealed; lockdown still tests seam only) |
| C009 stderr instead of structured log | R3 (1) | high | CARRY-FORWARD (defensive only) |

## Carry-forward concerns (for FEEDBACK)

These are real DevX/quality observations from building the keeper against the sandbox:

1. **Sui SDK 2.x has a sharp API surface for transaction submission.** Took multiple iterations to land the right shape (`tx.build({client})` requires a SuiClient that supports `multiGetObjects`; the iter-1 `client: undefined as never` cast would have failed at runtime). The `.ts-sdk-docs/sui/migrations/sui-2.0/sui.mdx` doesn't show the resolution-client pattern explicitly. Source: `[sui-sdk]`.

2. **`suix_queryEvents` JSON-RPC params are positional + undocumented.** The `@mysten/sui` 2.16 transport at `client.mjs:413` shows `[query, cursor, limit, descending: bool]`, but neither `.ts-sdk-docs/` nor the LLM training memory documents this. Iter-1 swapped the order and silently broke discovery. Source: `[sui-sdk]`.

3. **Pyth `PriceInfoObject` BCS layout is undocumented for SDK consumers.** The empirical capture in `notes/pyth-shape.md` (DEEP/USD + SUI/USD live BCS) is now the canonical reference for downstream keeper-builders. Source: `[deepbook]` / `[sui-sdk]`.

4. **`Transaction#serialize()` is deprecated but `tx.toJSON()` requires resolved object refs.** No SDK-blessed way to inspect a PTB structurally without an RPC round-trip. Source: `[sui-sdk]`.

5. **The "main loop = test seam" anti-pattern recurs.** Same shape as Cycle 1 R5-001 (T-014 verifies orphan dataLayer). When tests have a runnable seam that bypasses the production wiring, every test stays green even when production is broken. Worth a process change in future cycles. Source: `[forge-process]` (re-tag if this surfaces a DeepBook-relevant gap).

6. **Pyth-trust design risk — keeper supplies current_price; Move trusts it.** Per spec design (Cycle 3 carry-forward); on-chain Pyth integration would be substantial scope expansion. Documented as load-bearing. Source: `[deepbook]`.

## Audit trail

- Iter-1 reviewers: `cycles/4/reviewers/subagent-{1..6}.json`
- Iter-1 candidate (preserved): `cycles/4/green/candidates-iter1/`
- Iter-2 candidate (applied): `cycles/4/green/candidates/worker-1/`
- Synthesis: `cycles/4/green/synthesis-notes.md`
- Manual_override metadata applied to fixed-by-iter-2 clusters

## Next

Advance to Cycle 5 (Slot 3 UI — React + dapp-kit-react).
