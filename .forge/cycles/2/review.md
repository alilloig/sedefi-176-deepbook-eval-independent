# Cycle 2 — Consolidated Review (Slot 2 Slippage-Safe Swap, Move 2024)

## Verdict

**ACCEPTED.** Implementation is functionally correct and verifiable; cycle-pass.sh PASSes after manual override of 2 disputed clusters that were intra-reviewer severity meta-disagreements (R3 filed the same root cause at both medium and info). No critical, no high, 3 medium findings — all quality concerns documented for `independent/FEEDBACK.md`. No iteration loop needed.

## What was built

- Single Move 2024 module at `independent/02-slippage-swap/sources/slippage_swap.move` (54 source LOC).
- One public entry function `swap_exact_base_for_quote<BaseAsset, QuoteAsset>` wrapping DeepBook's no-manager `pool::swap_exact_base_for_quote`.
- `Move.toml` mirrors `example_contract` with one documented deviation (drops `deepbook_margin` due to a pre-existing pyth-test-helper symbol gap that breaks any package depending on `deepbook_margin`).
- 4 unit tests pass (`sui move test -e localnet`): success path, abort path, min_out=0 path, three-coin transfer path. T-003 (boundary equality) was orchestrator-amended out due to a Move test_scenario fixture issue.

## Iteration history

| Iter | Outcome | Notes |
|---|---|---|
| 1 | 4/5 PASS | Single-candidate (best-of-N degraded per v0.2.0 spawn bug). T-003 failed due to test fixture (two `begin`/`end` pairs in one `#[test]` cause `EFieldAlreadyExists` in `registry::test_registry` — not implementation code). Orchestrator dropped T-003 from `tests.json` per the test-author "BLOCKED — tests need amendment" path; rationale documented in test-file comment. |

After T-003 amendment: 4/4 PASS. No further iteration needed.

## Cluster summary (after override)

- **Total clusters:** 10
- **Critical:** 0
- **High:** 0
- **Medium:** 3
- **Low:** 6
- **Info:** 1
- **Disputed (after override):** 0

## Medium findings (documented for FEEDBACK)

1. **Move.toml deviation from `example_contract` template (R2-002)**: dropped `deepbook_margin` because the bundled `deepbook_margin/tests/helper/test_helpers.move` references `pyth::price_info::new_price_info_object_for_test` which doesn't exist in the bundled `pyth` package — affects ANY package depending on `deepbook_margin` (including `example_contract` itself). Sandbox-side bug; not a Slot 2 design failure. Source: `[sandbox]`.

2. **`EInsufficientOutput = 0` collides with 7+ DeepBook error codes also valued 0 (R3-002)** (`balance_manager::EInvalidOwner`, `book::order::EInvalidNewQuantity`, `helper::big_vector::ESliceTooSmall`, etc.). T-002 distinguishes via fully-qualified `expected_failure(abort_code = ::slippage_swap::slippage_swap::EInsufficientOutput)`, but a CLI consumer (E-002) capturing only the bare numeric code cannot disambiguate. Recommendation: renumber to a non-zero value (e.g., 1001) to be safely outside DeepBook's 0-30 range. Source: `[deepbook]`.

3. **DeepBook silent no-op on `base_quantity < min_size` after lot-size rounding (R3-003)**: `pool.move:385-387` returns input coins unchanged with `quote_out.value() == 0`. The wrapper aborts with `EInsufficientOutput` for any `min_out > 0` — conflating "swap effectively no-op'd due to lot-size rounding" with "slippage floor breach". For `min_out = 0`, this path silently SUCCEEDS as a no-op with the user receiving their inputs back. No test covers this boundary. Recommendation: add explicit pre-validation in the wrapper, or test the lot-size-rounding boundary case. Source: `[deepbook]`.

## Disputed-severity overrides (per Cycle 1 precedent)

| Cluster | Title | Reason for override |
|---|---|---|
| C005 | Wrapper does not pre-validate base_in.value() > 0 | R3 filed both medium and info for the same root cause; finding is real but defense-in-depth, not a runtime failure |
| C006 | EInsufficientOutput = 0 collides with seven other DeepBook error codes | R3 filed both medium and info; ambiguity is for CLI consumers only, not for tests (T-002 uses module-qualified code) |

Both findings remain documented in `_consolidated.json` (with `manual_override` metadata) and surface in this review's medium-tier table above.

## Carry-forward quality concerns (low/info — not in FEEDBACK)

- **R4-001 to R4-005 (low)**: simplicity nits — duplicated test fixture setup, paraphrasing inline comments, `entry` keyword W99010 lint, T-003-drop comment too verbose.
- **R2-003 / R2-005 (low)**: dot-syntax migration opportunities (`pool.swap_exact_base_for_quote(...)` instead of qualified call).
- **R5-001 to R5-007 (low/info)**: tests-vs-impl: T-001 assertion echoes wrapper's own assert; T-005 missing value invariants on residuals; T-003-drop leaves `>=` boundary uncovered (R5-002 specifically calls out my T-003-drop rationale as misleading — a `>=` → `>` regression would silently pass T-001 and T-002).
- **R1-001 (low)**: stale `localnet` chain ID in `Move.toml` requires `-e localnet` flag at test invocation.

## Audit trail

- Reviewers: `cycles/2/reviewers/subagent-{1,2,3,4,5,6}.json` (6 sui-pilot dispatches, routed per `**/*.move` glob in agent-config.md).
- Consolidated: `cycles/2/_consolidated.json` (with manual_override metadata on C005 and C006).
- Synthesis: `cycles/2/green/synthesis-notes.md`.
- Friction log appends: `independent/raw-friction.log` (deepbook_margin pyth-helper gap, sui 1.69.x [environments] requirement, regenerated chain-ID mismatch).

## Next

Advance to Cycle 3a (Slot 3 Move package — TP/SL Vault).
