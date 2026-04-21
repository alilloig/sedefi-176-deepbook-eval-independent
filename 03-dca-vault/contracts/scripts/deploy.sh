#!/usr/bin/env bash
# Publishes the dca_vault Move package against the running DeepBook Sandbox
# and writes the package ID to apps/03-dca-vault/deployment.json.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="$(cd "$APP_DIR/.." && pwd)"
SANDBOX_DIR="$ROOT/deepbook-sandbox/sandbox"
TARGET_DIR="$SANDBOX_DIR/packages/dca_vault"

if [[ ! -f "$SANDBOX_DIR/Pub.localnet.toml" ]]; then
    echo "ERROR: $SANDBOX_DIR/Pub.localnet.toml not found. Run 'pnpm deploy-all' first."
    exit 1
fi

CHAIN_ID=$(grep -E '^chain-id' "$SANDBOX_DIR/Pub.localnet.toml" | head -1 | cut -d'"' -f2 || true)
[[ -z "$CHAIN_ID" ]] && CHAIN_ID=$(grep -E '^localnet' "$SANDBOX_DIR/packages/example_contract/Move.toml" | head -1 | cut -d'"' -f2 || true)
if [[ -z "$CHAIN_ID" ]]; then
    echo "ERROR: could not resolve chain-id."
    exit 1
fi

echo "==> Staging dca_vault inside sandbox/packages"
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR/sources"
cp "$APP_DIR/contracts/sources/dca_vault.move" "$TARGET_DIR/sources/"

cat >"$TARGET_DIR/Move.toml" <<TOML
[package]
name = "dca_vault"
edition = "2024"

[dependencies]
token = { local = "../../.external-packages/token" }
deepbook = { local = "../../.external-packages/deepbook" }

[environments]
localnet = "$CHAIN_ID"
TOML

echo "==> Publishing dca_vault (chain-id=$CHAIN_ID)"
cd "$TARGET_DIR"
sui client test-publish \
    --build-env localnet \
    --pubfile-path "$SANDBOX_DIR/Pub.localnet.toml" \
    --json >"$APP_DIR/publish.json"

PACKAGE_ID=$(
    node -e "
const d = JSON.parse(require('fs').readFileSync(process.argv[1]));
const pkg = (d.objectChanges || []).find(c => c.type === 'published');
if (!pkg) { console.error('no published object'); process.exit(1); }
console.log(pkg.packageId);" "$APP_DIR/publish.json"
)

# Pull the DEEP/SUI pool id from the sandbox deployment manifest.
POOL_ID=$(
    node -e "
const m = JSON.parse(require('fs').readFileSync(process.argv[1]));
console.log(m.pools.DEEP_SUI.poolId);" "$SANDBOX_DIR/deployments/localnet.json"
)
SUI_CLOCK="0x6"  # Sui's singleton Clock object

cat >"$APP_DIR/deployment.json" <<JSON
{
  "packageId": "$PACKAGE_ID",
  "poolId": "$POOL_ID",
  "clockId": "$SUI_CLOCK"
}
JSON

echo
echo "Done. $APP_DIR/deployment.json written."
echo "  packageId: $PACKAGE_ID"
echo "  poolId:    $POOL_ID"
