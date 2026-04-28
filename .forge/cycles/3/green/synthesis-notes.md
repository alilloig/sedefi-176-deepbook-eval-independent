# Green-phase synthesis — cycle 3 (Slot 3 TP/SL Vault, Move 2024)

## Pick
worker-1 — single-candidate (best-of-N degraded per v0.2.0 spawn bug).

## What the implementation does

Single Move 2024 module at `independent/03-tpsl-vault/move/sources/tpsl_vault.move` (~190 LOC).

- `Vault<T>` shared object holding owner balance, optional TP/SL price thresholds, target pool ID, side, triggered flag.
- `create_vault<T>` constructor: shares the Vault, emits `VaultCreated` event with full field shape.
- `withdraw<T>` owner-only: aborts on non-owner (`ENotOwner=1001`) or already-triggered (`EVaultTriggered=1002`); returns the full balance as a Coin to the owner.
- `execute_trigger<Base, Quote>` permissionless but condition-gated: aborts unless `(tp.is_some() && current_price >= tp) || (sl.is_some() && current_price <= sl)` with `ETriggerConditionNotMet=1003`. On fire: extracts vault balance into `Coin<Base>`, calls DeepBook's no-manager `swap_exact_base_for_quote(pool, base_in, deep_in, 0, clock, ctx)`, transfers ALL THREE coins (base residual, quote_out, deep residual) to `vault.owner` (per contract decision #3 — no value-skim side-channel for keeper callers), sets `triggered = true`, emits `TriggerFired` with the realised `quote_out_amount`.

## Key Cycle 2 lessons applied

- **Move.toml** drops `deepbook_margin` (same pyth-helper gap).
- **Error codes** are non-zero (1001/1002/1003) to avoid the EInsufficientOutput=0 collision with 7+ DeepBook codes.
- **Move 2024 single-block syntax** (`module x::y;`).
- **Tests reuse** `deepbook::pool_tests::setup_everything<SUI, USDC, SUI, DEEP>`.
- **`sui move test -e localnet`** flag required (sandbox regenerates chain ID per deploy).

## Orchestrator amendment to tests (T-001/T-004/T-005 events queries)

Test-author's first draft queried `event::events_by_type<>()` AFTER `next_tx` — but Move's test_scenario CLEARS the event buffer on every `next_tx`. Confirmed by `test_scenario_tests.move:1092` and empirically. Worker-1 reported BLOCKED on 4/7 pass (the 3 event-queries failed); orchestrator amended T-001/T-004/T-005 to query the event INSIDE the same `next_tx` block where it was emitted, capturing values into locals (locals persist across `next_tx`) for cross-tx checks like `vault_id == event_vault_id` and `coin::value(&quote_out) == event_quote_out_amount`. Tests sealed again after amendment; 7/7 PASS.

## Test result

`sui move test -e localnet`: 7/7 PASS. 3 linter warnings suppressed (unused-alias for `sui::transfer` and `sui::tx_context::TxContext` aliases that are now default in Sui 1.69 — quality nit).

---

## Iter-2 (orchestrator-applied pool_id assertion)

Iter-1 review surfaced a triangulated high finding (R3-001 / R6-001) with low-confirmation from R1-001: `execute_trigger` never asserted that the supplied `pool` matches `vault.pool_id`. With `min_quote_out=0`, a permissionless caller could substitute any same-typed pool (including a poisoned one) and drain the vault.

iter-2 fix (applied directly from main session, single-line patch):

```diff
+ const EWrongPool: u64 = 1004;
  
  public entry fun execute_trigger<Base, Quote>(
      vault: &mut Vault<Base>,
      pool: &mut Pool<Base, Quote>,
      ...
  ) {
      assert!(!vault.triggered, EVaultTriggered);
+     assert!(object::id(pool) == vault.pool_id, EWrongPool);
      ...
  }
```

Verified: 7/7 tests still pass (existing tests supply the correct pool from setup_everything; the new assert is satisfied silently). Coverage gap: no test exercises the wrong-pool case explicitly — flagged in iter-1 R5-002 simplicity-of-coverage observation, deferred to FEEDBACK as carry-forward.

Iter-1 reviewer outputs preserved; the high cluster is overridden in `_consolidated.json` with `manual_override` noting the iter-2 fix.
