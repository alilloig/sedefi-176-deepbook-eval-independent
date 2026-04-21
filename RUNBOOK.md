# Runbook: exercising the three apps against DeepBook Sandbox

Every step assumes you're at this repo's root (`deepbook-sandbox-evaluation-apps/`).

## 0. Prerequisites

Verify you have:

```bash
docker --version        # Docker Desktop running, ≥8 GB allocated
sui --version           # 1.63 – 1.64 per sandbox README
node --version          # ≥18
pnpm --version          # install with `npm i -g pnpm` if missing
```

> **Alternative install:** If you don't already have the sandbox repo cloned,
> you can scaffold it via:
> ```bash
> pnpm create @mysten-incubation/deepbook-sandbox
> ```
> This validates Docker + Sui CLI and sets up the project. Note: the package
> is under the `@mysten-incubation` scope — `npx deepbook-sandbox` won't work.

## 1. Bring up the sandbox

```bash
cd deepbook-sandbox/sandbox
git submodule update --init --recursive   # if you didn't clone with --recurse-submodules (run from deepbook-sandbox/)
cp .env.example .env                      # (optional — deploy-all auto-detects)
pnpm install
# pnpm deploy-all                           # first run takes a few min — Rust build
# or
pnpm deploy-all --quick             # pre-built Docker images instead
```

Wait for the line **"DeepBook Sandbox Ready!"** before touching anything.

Sanity checks:

```bash
curl http://localhost:9010/ | head                     # oracle alive
curl http://localhost:9009/manifest | head             # manifest available
curl http://localhost:3001/health                      # market maker healthy
docker ps                                      # all services up
```

---

## 2. App 1 — Order Book Viewer

Pure read-only. Nothing to publish, no wallet.

```bash
cd ../../01-orderbook-viewer
pnpm install
pnpm dev     # → http://localhost:5174
```

Open the browser. You should see bids (green) and asks (red) updating every 3 s
for DEEP/SUI. Flip the pool button to watch SUI/USDC.

**Expected quick pass/fail:**

- Mid price > 0 and asks/bids list is populated → working end to end.
- "Is the sandbox running?" banner → faucet `/manifest` not responding, check
  `docker logs deepbook-faucet`.
- Mid price 0, empty levels → market maker hasn't placed its grid yet, wait
  10–15 s and reload.

---

## 3. App 2 — Fee-Rebate Swap (Move)

```bash
cd ../02-fee-rebate-swap    # from 01-orderbook-viewer, or cd 02-fee-rebate-swap from repo root
bash scripts/deploy.sh
```

That script:

1. Stages `sources/fee_rebate_swap.move` into
   `deepbook-sandbox/sandbox/packages/fee_rebate_swap/` with a Move.toml that
   references `.external-packages/` the same way `example_contract` does.
2. Runs `sui client test-publish --build-env localnet --pubfile-path ../../Pub.localnet.toml`.
3. Writes `deployment.json` with the resulting package ID.
4. Calls `create_vault(rebate_bps=10)` and writes the vault ID too.

Seed the vault with DEEP so it can pay rebates, then swap:

```bash
# Fund the deployer with DEEP:
curl -X POST http://localhost:9009/faucet \
     -H 'Content-Type: application/json' \
     -d "{\"address\":\"$(sui client active-address)\",\"token\":\"DEEP\",\"amount\":5000}"

# Get the DEEP coin type from the deployment manifest:
DEEP_TYPE=$(jq -r .pools.DEEP_SUI.baseCoinType ../deepbook-sandbox/sandbox/deployments/localnet.json)

# Top up the vault with a DEEP coin:
PKG=$(jq -r .packageId deployment.json)
VAULT=$(jq -r .vaultId deployment.json)
DEEP_COIN=$(curl -s http://localhost:9000 -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"suix_getCoins",
  "params":["'"$(sui client active-address)"'","'"$DEEP_TYPE"'"]
}' | jq -r '.result.data[0].coinObjectId')
sui client call --package $PKG --module fee_rebate_swap --function top_up \
   --args $VAULT $DEEP_COIN

# Get pool and type info for the swap:
POOL=$(jq -r .pools.DEEP_SUI.poolId ../deepbook-sandbox/sandbox/deployments/localnet.json)
SUI_TYPE=$(jq -r .pools.DEEP_SUI.quoteCoinType ../deepbook-sandbox/sandbox/deployments/localnet.json)
DEEPBOOK_PKG=$(jq -r .packages.deepbook.packageId ../deepbook-sandbox/sandbox/deployments/localnet.json)

# Swap 0.1 SUI for DEEP via our fee-rebate wrapper:
sui client ptb \
   --split-coins gas "[100000000]" \
   --assign sui_in \
   --move-call $PKG::fee_rebate_swap::swap_sui_for_deep_with_rebate \
      "@$VAULT" "@$POOL" sui_in 0 "@0x6" \
   --assign deep_out \
   --transfer-objects "[deep_out]" @"$(sui client active-address)"
```

> **Note:** `sui client objects --json` returns gRPC/BCS format where
> object IDs are embedded as raw byte arrays — not usable with jq.
> Use the JSON-RPC `suix_getCoins` method via curl to look up coin object IDs:
> ```bash
> curl -s http://localhost:9000 -H 'Content-Type: application/json' -d '{
>   "jsonrpc":"2.0","id":1,"method":"suix_getCoins",
>   "params":["<ADDRESS>","<COIN_TYPE>"]
> }' | jq -r '.result.data[0].coinObjectId'
> ```

**Expected pass/fail:**

- `RebateClaimed` event in the transaction effects with a non-zero `rebate`
  → working end to end, indexer should pick it up.
- "EInsufficientReserve" abort → you didn't top up the vault enough.

---

## 4. App 3 — DCA Vault

### 4.1 Publish contract + create a vault

```bash
cd ../03-dca-vault
bash contracts/scripts/deploy.sh
bash contracts/scripts/create-vault.sh 1000000000 30000
#                                         ↑slice    ↑interval (30 s)
```

That writes:

- `deployment.json` — package ID, pool ID, clock ID
- `vaults.json` — append-only registry used by keeper + UI

### 4.2 Start the keeper

```bash
cd keeper && pnpm install && pnpm start
```

You should see it funding itself from the faucet, then looping:

```
[keeper] address:  0xabc…
[keeper] watching: 0xdef…
[keeper] executing 0xdef… (sui=10000000000, deep=0)
[keeper] ✔ digest=5C8…
```

Every 30 s the keeper calls `execute(vault, pool, clock)`. The keeper
silently skips two expected abort codes:

- **abort code 1** (`EIntervalNotElapsed`) — keeper polled too soon, harmless.
- **abort code 3** (`EInsufficientSui`) — vault has been drained, nothing to swap.

The default vault (slice = 1 SUI, deposit = 10 SUI) will drain after ~10
successful swaps. Once drained, the keeper idles silently.

### 4.3 Top up a drained vault (optional)

If the vault runs out of SUI and you want to keep it running:

```bash
cd ..   # back to 03-dca-vault
PKG=$(jq -r .packageId deployment.json)
VAULT=$(jq -r '.[-1].vaultId' vaults.json)
sui client ptb \
   --split-coins gas "[10000000000]" \
   --assign sui_coin \
   --move-call $PKG::dca_vault::top_up_sui "@$VAULT" sui_coin
```

Or create a fresh vault: `bash contracts/scripts/create-vault.sh 1000000000 30000`

### 4.4 Start the UI

```bash
cd ui && pnpm install && pnpm dev    # → http://localhost:5175
```

You'll see each registered vault's SUI balance shrinking and its DEEP balance
growing after every keeper tick.

### 4.5 Withdraw

```bash
cd ..
VAULT=$(jq -r '.[-1].vaultId' vaults.json)
PKG=$(jq -r .packageId deployment.json)
sui client call --package $PKG --module dca_vault --function withdraw_all \
   --args $VAULT
```

---

## 5. Teardown

```bash
cd ../deepbook-sandbox/sandbox
pnpm down                                # wipes containers, volumes, generated env keys
```

This **destroys the chain state**, which means all published packages (apps 2
and 3) and every vault are gone. The app source stays. Re-run section 1 and
re-publish to exercise again.
