# 03 · DCA Vault

A mini DeFi primitive split across **three coordinated pieces**, each one very
small on its own. This is the "complex" app of the trio — complexity comes from
the orchestration, not from any single file.

## The idea

A user deposits SUI into a shared `DcaVault`, specifies
`amount_per_execution` and `interval_ms`, and walks away. A **keeper** bot
watches the vault and calls `execute(vault, pool, clock)` whenever the
interval has elapsed — the contract atomically swaps the configured SUI
amount into DEEP via the DEEP/SUI DeepBook pool and accumulates it.
The owner can `withdraw_all` at any time.

## The three parts

```
contracts/    Move module — DcaVault, execute(), withdraw_all()
keeper/       TS bot — polls vaults, submits execute() transactions
ui/           React viewer — lists vaults and their DEEP accumulation
```

### contracts/

Public entries:

| Function                         | Caller     | What it does                                           |
| -------------------------------- | ---------- | ------------------------------------------------------ |
| `create(sui, amount, interval)`  | user       | Creates a shared `DcaVault`                            |
| `top_up_sui(vault, sui)`         | owner only | Adds more SUI to the vault                             |
| `execute(vault, pool, clock)`    | anyone     | Swaps one DCA slice (fails if interval not elapsed)    |
| `withdraw_all(vault)`            | owner only | Claims accumulated DEEP + unused SUI                   |

### keeper/

`src/keeper.ts` walks a list of vault IDs (from `vaults.json`) and, for each
one whose `next_exec_ms` is in the past, submits an `execute` transaction.
It uses the sandbox faucet to top up its own gas on first run.

### ui/

Read-only dashboard at `http://localhost:5175` that shows SUI balance, DEEP
accumulated, and last-exec time for each registered vault. Minimal styling,
no wallet connect — the sandbox's own dashboard at `:5173` is where you
sign `create_vault` / `withdraw_all` transactions.

## Why this exercises the sandbox

- Touches the live deepbook `pool::swap_exact_quote_for_base` (same as App 2)
- Exercises the **clock** object — many beginners trip on clock + shared object
- Has an **off-chain keeper** that must survive localnet regenesis (via the
  sandbox faucet auto-funding)
- Produces **events** that hit the indexer → REST API
- Has a **UI** that hits the RPC directly (CORS, gRPC-Web)

## Quick start

Sandbox must already be running (`cd ../../deepbook-sandbox/sandbox && pnpm deploy-all`).

```bash
cd apps/03-dca-vault

# 1. Publish the Move contract and record addresses:
bash contracts/scripts/deploy.sh

# 2. Create a vault (1 SUI per slice, every 30 seconds) — uses your sui CLI:
bash contracts/scripts/create-vault.sh 1000000000 30000

# 3. Start the keeper (leave running):
cd keeper && pnpm install && pnpm start

# 4. Start the viewer in another terminal:
cd ../ui && pnpm install && pnpm dev   # http://localhost:5175
```

See `../../RUNBOOK.md` for the full orchestration.
