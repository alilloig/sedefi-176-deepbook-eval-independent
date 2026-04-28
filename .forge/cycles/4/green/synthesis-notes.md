# Green-phase synthesis — cycle 4 (Slot 3 Keeper, TS sub-cycle 3b)

## Pick
worker-1 — single-candidate (best-of-N degraded per v0.2.0 spawn bug).

## What the implementation does

8 TS modules in `independent/03-tpsl-vault/keeper/src/` (~750 LOC). Pure functions where possible, side effects isolated to `index.ts`.

- `config.ts` — env validation; `KEEPER_POLL_INTERVAL_MS ∈ [5000, 10000]`; package/coin ID format checks.
- `logger.ts` — JSON line logger with secret redaction; 8 typed event emitters.
- `priceModel.ts` — pure `calculateBaseQuotePrice` mirroring sandbox market-maker formula; throws on zero / overflow.
- `pythReader.ts` — BCS decoder per `notes/pyth-shape.md` (DEEP/USD + SUI/USD captured live, 34-byte layout, sign-handling); `readPriceFromChain` uses raw fetch JSON-RPC + `bcs.TransactionKind.serialize()` (avoids SuiJsonRpcClient's `getNormalizedMoveFunction` round-trip).
- `triggerEvaluator.ts` — pure `evaluateTrigger(vault, currentPrice)`; TP-then-SL precedence matches Move's `tp_met || sl_met`.
- `vaultRegistry.ts` — `parseVaultCreatedEvent` + `VaultRegistry` class with on-chain `triggered`-flag re-seed (handles missing/malformed objects + non-boolean fields gracefully with structured warnings).
- `triggerSubmitter.ts` — `buildTriggerTransaction` builds SplitCoins + MoveCall PTB; `signAndSubmitTrigger` does the full sign-and-submit via raw fetch.
- `index.ts` — main poll loop: fetch manifest → seed triggered flags → poll Pyth → query VaultCreated events → evaluate → submit triggers. SIGINT/SIGTERM graceful shutdown.

## Cycle 1 + Cycle 3 lessons applied

- Stack: `@mysten/sui ^2.14.1` (matches dashboard pin); NO `@mysten/deepbook-v3` (per AC3.7 — keeper builds DeepBook calls via direct `tx.moveCall` against `tpsl_vault::execute_trigger`).
- Vitest with `node` env (not jsdom — this is Node code).
- Sui SDK 2.x stale-memory rule honored — used the bundled docs to confirm `Transaction`, `bcs`, `Ed25519Keypair` API shapes.
- `suix_queryEvents` filters on `transactionModule` (Cycle 1 lesson) — `eventType` filter used instead of `MoveModule` filter for `VaultCreated`.
- Pool-binding: keeper uses each vault's stored `pool_id` from the VaultCreated event (Cycle 3 lesson — never substitute pools).
- Pyth-trust-design: keeper supplies `current_price` after parsing on-chain `PriceInfoObject` (per spec; the Move contract trusts the keeper for this).

## Orchestrator amendments

1. **T-006 arithmetic mismatch** in `tests/triggerSubmitter.test.ts:46`: comment on line 88 says `32_404_071 = 0x01EE9967`, but `0x01EE9967 = 32_414_055`. Worker correctly computed bytes for `32_404_071n` per the input, but the test expected `0x01EE9967` per the comment. Fixed by changing input to `32_414_055n` to match the comment's hex.
2. **`index.ts:330` type bug** — call to `runOnePollCycle` was missing `pollIntervalMs` arg. Worker's tests stubbed runOnePollCycle directly with the right args; only the production wire-up was wrong. Fixed inline.

## Test result

After amendments: **63/63 vitest tests pass** (the 9 logical T-NNN cases expand into multiple it() assertions per file).

## Carry-forward concerns (for FEEDBACK)

- LSP from worktree-root doesn't index keeper's local node_modules cleanly — same Cycle 1 pattern.
- Pyth BCS layout (34 bytes, fixed offsets) is undocumented in `.sui-docs/` or `.move-book-docs/`; the empirical capture in `notes/pyth-shape.md` is now the canonical reference. Source: `[deepbook]` / `[sui-sdk]`.
- `Transaction#serialize()` deprecation warning on every PTB inspection — the alternative `tx.toJSON()` requires resolved object refs (RPC round-trip), so `serialize()` is the only structural-inspection path. Source: `[sui-sdk]`.
