# 02 · Fee-Rebate Swap (Move)

A tiny Move package that wraps DeepBook's `pool::swap_exact_quote_for_base`
and hands the caller a small DEEP **rebate** out of a pre-funded vault —
a common loyalty/marketing primitive.

## Flow

1. Admin calls `create_vault(rebate_bps)` → a shared `RebateVault` is created.
2. Admin calls `top_up(vault, deep_coin)` to seed the vault's DEEP reserve.
3. Anyone calls `swap_sui_for_deep_with_rebate(vault, pool, sui_coin, …)`:
   - Swaps SUI → DEEP via the DEEP/SUI pool (whitelisted, zero DEEP fee).
   - Reads `deep_out`, computes `rebate = deep_out * bps / 10_000`.
   - Moves `rebate` from vault reserve into the caller's DEEP coin.
   - Emits `RebateClaimed { user, deep_out, rebate }`.

That's the whole contract (~80 lines of Move). No admin cap — the admin
address is stored in the vault so anyone can read it and the admin alone
can top up / re-price.

## Files

```
sources/fee_rebate_swap.move   ← the module
Move.toml                      ← wired against the sandbox's local deepbook deps
scripts/deploy.sh              ← one-shot publish + vault init helper
```

## Why this is a good sandbox test

- Exercises the Move compiler against the **live localnet `deepbook` package**
  (via `Pub.localnet.toml`).
- Touches the real `pool::swap_exact_quote_for_base` on-chain.
- Relies on the sandbox faucet + market-maker to have liquidity to swap against.
- Uses events → indexer path.

## Quick start

Sandbox must already be running (`cd ../../deepbook-sandbox/sandbox && pnpm deploy-all`).

```bash
cd apps/02-fee-rebate-swap
bash scripts/deploy.sh          # publishes the package, creates a vault, tops it up
```

See `../../RUNBOOK.md` for the full orchestration.

## Notes on packaging

Because the sandbox's `Move.toml` conventions expect custom contracts to live
inside `sandbox/packages/` (so that relative paths to `.external-packages/`
resolve cleanly), the deploy script **copies** `sources/` + a templated
`Move.toml` into `sandbox/packages/fee_rebate_swap/` before calling
`sui client test-publish`. That keeps the authoring source co-located with
this app but avoids the "duplicate dependency" issue documented in the
sandbox's own troubleshooting section.
