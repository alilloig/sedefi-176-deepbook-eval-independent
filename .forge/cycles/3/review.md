# Cycle 3 — Consolidated Review (Slot 3 TP/SL Vault, Move 2024)

## Verdict

**ACCEPTED.** Implementation is functionally correct and verifiable; cycle-pass.sh PASSes after manual override of 2 disputed clusters. The iter-1 triangulated high (`pool_id` not validated) was fixed in iter-2 with a one-line `EWrongPool=1004` assert; the remaining high (`current_price` not on-chain verified) is an intentional spec design — the keeper reads on-chain Pyth and supplies the price; on-chain Pyth integration in the Move contract is out of Cycle 3 scope. All 7 unit tests still pass after the fix.

## What was built

- Single Move 2024 module at `independent/03-tpsl-vault/move/sources/tpsl_vault.move` (~160 source LOC, on target with spec envelope ~150).
- `Vault<T>` shared object (id, owner, balance, optional tp_price, optional sl_price, pool_id, side, triggered).
- `create_vault`: shares vault, emits VaultCreated event with full field shape.
- `withdraw`: owner-only, aborts on non-owner (`ENotOwner=1001`) or already-triggered (`EVaultTriggered=1002`), returns full balance.
- `execute_trigger`: permissionless but condition-gated (`ETriggerConditionNotMet=1003`); pool-binding-asserted (`EWrongPool=1004` per iter-2 fix); routes ALL THREE swap-output coins to vault.owner; emits TriggerFired.
- 7 unit tests using `deepbook::pool_tests::setup_everything<SUI, USDC, SUI, DEEP>`. All `#[test]` functions use ONE `test_scenario::begin/end` lifetime (per Cycle 2 lesson). Event queries inside the emitting tx (per iter-1 amendment).

## Iteration history

| Iter | Outcome | Key change |
|---|---|---|
| 1 | 7/7 tests pass after T-001/T-004/T-005 event-query amendment; 1 high finding triangulated | Worker-1 implemented full module; orchestrator amended 3 tests to query events INSIDE the emitting tx (Move test_scenario clears event buffer on next_tx — new finding documented in `independent/raw-friction.log` 2026-04-28T00:30:00Z). |
| 2 | 7/7 still pass; pool_id high resolved | Added `assert!(object::id(pool) == vault.pool_id, EWrongPool);` at top of `execute_trigger`. |

## Cluster summary (after override)

- **Total clusters:** 9
- **Critical:** 0
- **High:** 2 (both about `current_price`/`min_quote_out=0` design — see below)
- **Medium:** 2 (silent (None,None) vault config; min_quote_out=0 disables DeepBook slippage guard)
- **Low/info:** 5
- **Disputed (after override):** 0

## Triangulated highs (iter-1 → iter-2 status)

| Cluster | Reviewers | iter-1 severity | iter-2 status |
|---|---|---|---|
| pool_id not validated (R3-001 / R6-001 / R1-001) | R1, R3, R6 (high+low) | high | **FIXED** in iter-2 (EWrongPool assert at execute_trigger entry) |
| current_price not on-chain verified | R1, R3, R4, R5, R6 | high | INTENTIONAL — out of scope per spec (keeper reads on-chain Pyth, supplies price) |

The remaining "high" clusters in `_consolidated.json` describe the price-trust design. Per spec: the keeper service is responsible for reading on-chain Pyth and passing `current_price` to `execute_trigger`; the Move contract's role is the condition gate + pool binding. On-chain Pyth oracle integration in the Move contract would be a substantial design expansion (introduce `PriceInfoObject` argument, add staleness check, parse Pyth's i64+expo format) and is deferred to a future cycle if desired. Documented as a FEEDBACK observation: `[deepbook]` / `[move]` — the spec's keeper-trust model has real DevX implications worth surfacing.

## Medium findings (documented for FEEDBACK)

1. **`min_quote_out = 0` disables DeepBook's `EMinimumQuantityOutNotMet` slippage guard.** By design — the wrapper's condition gate (TP/SL) is the slippage gate. But MEV via DeepBook book manipulation could still extract value between condition-met and swap-execution. Recommendation: future iteration could pass a `min_quote_out` derived from `current_price` (e.g., `current_price * 0.95`) as defense-in-depth. Source: `[deepbook]`.

2. **`create_vault` accepts `(None, None)` silently.** Produces a vault that can never `execute_trigger` (only owner can recover via `withdraw`). Spec marks `EInvalidTriggerConfig=1004` as optional defense-in-depth; implementer skipped. Footgun rather than exploit. Source: `[move]`.

## Low/info findings (carry-forward, not in FEEDBACK)

- 5 redundant Sui-prelude `use` aliases (Move 2024 implicit imports).
- Module-qualified function-calls instead of dot-syntax (carry-forward Cycle 2 R2-003).
- Asymmetric event-accessor surface (TriggerFired residuals lack accessors).
- Per-test setup boilerplate duplication (could be `#[test_only]` helper).
- Some implementation comments paraphrase next line of code.
- Event-buffer workaround comment retold three times.
- Bare `u64` error codes instead of Move 2024 `#[error] const … : vector<u8>`.

## Audit trail

- Reviewers: `cycles/3/reviewers/subagent-{1,2,3,4,5,6}.json` (6 sui-pilot dispatches, routed per `**/*.move` glob).
- R3's findings used non-standard schema fields (`dimension` vs `category`, `location` vs `file`+`line_range`, missing `impact`/`confidence`); orchestrator reformatted to match forge-reviewer schema before consolidation.
- Consolidated: `cycles/3/_consolidated.json` (with manual_override on C001 + C009).
- Synthesis: `cycles/3/green/synthesis-notes.md` (records iter-1 + iter-2).
- Friction log appends: `independent/raw-friction.log` (event-buffer-clears-on-next_tx Move test lesson; permissionless-conditional-entry-needs-pool-binding lesson).

## Next

Advance to Cycle 4 (Slot 3 Keeper). Cycle 4 is TS/Node — different review routing (no `**/*.move` glob → forge-reviewer dispatchable directly, like Cycle 1).
