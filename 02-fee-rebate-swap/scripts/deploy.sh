#!/usr/bin/env bash
#
# Publishes fee_rebate_swap against the running DeepBook Sandbox localnet.
#
# Strategy:
#   1. Copy sources/ + a freshly-generated Move.toml into
#      deepbook-sandbox/sandbox/packages/fee_rebate_swap/.
#   2. Run `sui client test-publish` there so relative deps to
#      .external-packages/ and Pub.localnet.toml resolve cleanly.
#   3. Parse the publish output and write the package ID to ./deployment.json.
#
# Assumes you have already run `pnpm deploy-all` inside sandbox/.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$APP_DIR/.." && pwd)"
SANDBOX_DIR="$ROOT/deepbook-sandbox/sandbox"
TARGET_DIR="$SANDBOX_DIR/packages/fee_rebate_swap"

if [[ ! -f "$SANDBOX_DIR/Pub.localnet.toml" ]]; then
    echo "ERROR: $SANDBOX_DIR/Pub.localnet.toml not found."
    echo "       Run 'cd $SANDBOX_DIR && pnpm deploy-all' first."
    exit 1
fi

CHAIN_ID=$(grep -E '^chain-id' "$SANDBOX_DIR/Pub.localnet.toml" | head -1 | cut -d'"' -f2 || true)
if [[ -z "$CHAIN_ID" ]]; then
    # Fallback: the chain id also appears in example_contract/Move.toml after deploy-all.
    CHAIN_ID=$(grep -E '^localnet' "$SANDBOX_DIR/packages/example_contract/Move.toml" | head -1 | cut -d'"' -f2 || true)
fi
if [[ -z "$CHAIN_ID" ]]; then
    echo "ERROR: could not find the localnet chain-id in Pub.localnet.toml."
    exit 1
fi

echo "==> Staging fee_rebate_swap inside sandbox/packages"
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR/sources"
cp "$APP_DIR/sources/fee_rebate_swap.move" "$TARGET_DIR/sources/"

cat >"$TARGET_DIR/Move.toml" <<TOML
[package]
name = "fee_rebate_swap"
edition = "2024"

[dependencies]
token = { local = "../../.external-packages/token" }
deepbook = { local = "../../.external-packages/deepbook" }

[environments]
localnet = "$CHAIN_ID"
TOML

echo "==> Publishing fee_rebate_swap against localnet (chain-id=$CHAIN_ID)"
cd "$TARGET_DIR"
sui client test-publish \
    --build-env localnet \
    --pubfile-path "$SANDBOX_DIR/Pub.localnet.toml" \
    --json >"$APP_DIR/publish.json"

PACKAGE_ID=$(
    node -e "
const d = JSON.parse(require('fs').readFileSync(process.argv[1]));
const pkg = (d.objectChanges || []).find(c => c.type === 'published');
if (!pkg) { console.error('no published object found'); process.exit(1); }
console.log(pkg.packageId);
" "$APP_DIR/publish.json"
)

echo "==> Package published: $PACKAGE_ID"

# Create the RebateVault (10 bps = 0.10% rebate).
echo "==> Creating RebateVault (10 bps)"
sui client call \
    --package "$PACKAGE_ID" \
    --module fee_rebate_swap \
    --function create_vault \
    --args 10 \
    --json >"$APP_DIR/create_vault.json"

VAULT_ID=$(
    node -e "
const d = JSON.parse(require('fs').readFileSync(process.argv[1]));
const v = (d.objectChanges || []).find(c => c.type === 'created' && String(c.objectType).includes('RebateVault'));
if (!v) { console.error('no vault object found'); process.exit(1); }
console.log(v.objectId);
" "$APP_DIR/create_vault.json"
)

cat >"$APP_DIR/deployment.json" <<JSON
{
  "packageId": "$PACKAGE_ID",
  "vaultId": "$VAULT_ID"
}
JSON

echo
echo "Done."
echo "  packageId: $PACKAGE_ID"
echo "  vaultId:   $VAULT_ID"
echo
echo "Next: top up the vault so it can pay rebates. Example (1000 DEEP from your faucet):"
echo "  curl -X POST http://localhost:9009/faucet -H 'Content-Type: application/json' \\"
echo "       -d '{\"address\":\"'\$(sui client active-address)'\",\"token\":\"DEEP\",\"amount\":1000}'"
echo "  DEEP_COIN=\$(sui client gas --json | node -e '…pick a DEEP coin…')"
echo "  sui client call --package $PACKAGE_ID --module fee_rebate_swap --function top_up \\"
echo "      --args $VAULT_ID \$DEEP_COIN"
