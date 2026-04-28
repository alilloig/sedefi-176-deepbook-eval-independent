/**
 * uiDataLayer.ts — standalone data layer for the TPSL Vault UI.
 *
 * Drives: manifest fetch from /localnet.json + suix_queryEvents for
 * VaultCreated events from the tpsl_vault package.
 *
 * All outbound HTTP targets ONLY:
 *   - /localnet.json (in-app, served by Vite middleware)
 *   - http://127.0.0.1:9000 or http://localhost:9000 (Sui RPC JSON-RPC)
 *
 * Forbidden: any :9008 indexer pool-keyed routes.
 *
 * Lifted from Cycle 4 T-009 / Cycle 1 T-014 network-shape lesson.
 */

export interface UiDataLayerArgs {
  /** URL for the manifest — typically "/localnet.json" in dev, "http://127.0.0.1:..." in tests. */
  manifestUrl: string;
  /** Sui RPC JSON-RPC base URL, e.g. "http://127.0.0.1:9000". */
  rpcUrl: string;
  /** Connected wallet address to filter VaultCreated events. */
  currentAccountAddress: string;
  /** TPSL vault package ID. */
  tpslVaultPackageId: string;
}

export interface VaultSummary {
  vaultId: string;
  owner: string;
  poolId: string;
  side: number;
  tpPrice: string | null;
  slPrice: string | null;
  depositAmount: string;
}

export interface UiDataLayerResult {
  rpcUrl: string;
  vaults: VaultSummary[];
}

// ---------------------------------------------------------------------------
// JSON-RPC helper
// ---------------------------------------------------------------------------

let _requestId = 1;

async function jsonRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const id = _requestId++;
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const json = (await response.json()) as { result?: T; error?: unknown };
  if (json.error) {
    throw new Error(`JSON-RPC ${method} error: ${JSON.stringify(json.error)}`);
  }
  return json.result as T;
}

// ---------------------------------------------------------------------------
// Data layer entry point
// ---------------------------------------------------------------------------

/**
 * Runs the UI data layer end-to-end:
 *  1. Fetches the manifest from `manifestUrl`.
 *  2. Queries VaultCreated events from the tpsl_vault package via suix_queryEvents.
 *  3. Filters events by owner == currentAccountAddress.
 *
 * Only hits `/localnet.json` and Sui RPC `:9000` — never indexer pool-keyed routes.
 */
export async function runUiDataLayer(
  args: UiDataLayerArgs,
): Promise<UiDataLayerResult> {
  const { manifestUrl, rpcUrl, currentAccountAddress, tpslVaultPackageId } = args;

  // 1. Fetch manifest.
  const manifestRes = await fetch(manifestUrl);
  const manifest = (await manifestRes.json()) as {
    network?: { rpcUrl?: string };
    pools?: Array<{
      poolId: string;
      baseCoinType: string;
      quoteCoinType: string;
    }>;
  };

  const resolvedRpcUrl = manifest.network?.rpcUrl ?? rpcUrl;

  // 2. Query VaultCreated events via suix_queryEvents.
  //    Method in the allowed set: suix_queryEvents.
  type EventsResult = {
    data: Array<{
      parsedJson: {
        vault_id: string;
        owner: string;
        pool_id: string;
        side: number;
        tp_price: unknown;
        sl_price: unknown;
        deposit_amount: string;
      };
    }>;
    hasNextPage: boolean;
    nextCursor: unknown;
  };

  const eventsResult = await jsonRpc<EventsResult>(
    resolvedRpcUrl,
    "suix_queryEvents",
    [
      { MoveEventType: `${tpslVaultPackageId}::tpsl_vault::VaultCreated` },
      null,   // cursor
      1000,   // limit
      false,  // descending
    ],
  );

  // 3. Filter by owner.
  const parseOptionU64 = (raw: unknown): string | null => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "object" && "Some" in (raw as object)) {
      return String((raw as Record<string, unknown>)["Some"]);
    }
    return null;
  };

  const vaults: VaultSummary[] = (eventsResult.data ?? [])
    .filter(
      (e) =>
        e.parsedJson.owner.toLowerCase() === currentAccountAddress.toLowerCase(),
    )
    .map((e) => ({
      vaultId: e.parsedJson.vault_id,
      owner: e.parsedJson.owner,
      poolId: e.parsedJson.pool_id,
      side: Number(e.parsedJson.side),
      tpPrice: parseOptionU64(e.parsedJson.tp_price),
      slPrice: parseOptionU64(e.parsedJson.sl_price),
      depositAmount: String(e.parsedJson.deposit_amount),
    }));

  return { rpcUrl: resolvedRpcUrl, vaults };
}
