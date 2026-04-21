#!/usr/bin/env bash
# Creates a DcaVault using the current sui CLI active address.
#   Usage: create-vault.sh <amount_per_exec_mist> <interval_ms> [initial_sui_mist]
#
#   Default initial deposit: 10× amount_per_exec.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEP="$APP_DIR/deployment.json"
[[ -f "$DEP" ]] || { echo "Run contracts/scripts/deploy.sh first."; exit 1; }

PKG=$(node -e "console.log(require('$DEP').packageId)")

AMOUNT_PER_EXEC="${1:-1000000000}"         # 1 SUI
INTERVAL_MS="${2:-30000}"                  # 30s
INITIAL_SUI="${3:-$((AMOUNT_PER_EXEC * 10))}"

# Split off a coin of exactly INITIAL_SUI MIST from our gas coin.
echo "==> Splitting $INITIAL_SUI MIST coin for the initial deposit"
SPLIT_JSON=$(sui client split-coin --coin-id $(sui client gas --json | node -e "
const g = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log(g[0].gasCoinId);") --amounts $INITIAL_SUI --json)

NEW_COIN=$(node -e "
const d = JSON.parse(process.argv[1]);
const c = (d.objectChanges || []).find(x => x.type === 'created' && String(x.objectType).includes('0x2::coin::Coin<0x2::sui::SUI>'));
console.log(c.objectId);
" "$SPLIT_JSON")

echo "==> Creating vault with $AMOUNT_PER_EXEC MIST/slice, ${INTERVAL_MS}ms cadence"
sui client call \
    --package "$PKG" \
    --module dca_vault \
    --function create \
    --args "$NEW_COIN" "$AMOUNT_PER_EXEC" "$INTERVAL_MS" \
    --json >"$APP_DIR/create_vault.json"

VAULT=$(node -e "
const d = JSON.parse(require('fs').readFileSync(process.argv[1]));
const v = (d.objectChanges || []).find(c => c.type === 'created' && String(c.objectType).includes('DcaVault'));
console.log(v.objectId);" "$APP_DIR/create_vault.json")

echo "==> Vault created: $VAULT"

# Append to vaults.json registry used by the keeper + UI.
REGISTRY="$APP_DIR/vaults.json"
if [[ ! -f "$REGISTRY" ]]; then echo "[]" >"$REGISTRY"; fi
node -e "
const fs = require('fs');
const p = process.argv[1];
const arr = JSON.parse(fs.readFileSync(p,'utf8'));
arr.push({ vaultId: '$VAULT', createdAt: Date.now() });
fs.writeFileSync(p, JSON.stringify(arr, null, 2));" "$REGISTRY"

echo "Done. Appended to $REGISTRY"
