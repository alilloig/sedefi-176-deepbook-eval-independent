import { useState, useEffect, useCallback, useRef } from "react";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { useManifest } from "./manifest";

// --- Types -------------------------------------------------------------------

export interface VaultEntry {
  vaultId: string;
  owner: string;
  poolId: string;
  side: number;
  tpPrice: string | null;
  slPrice: string | null;
  depositAmount: string;
  /** Live from on-chain getObject */
  balance: string;
  triggered: boolean;
  baseCoinType: string;
}

// --- Hook --------------------------------------------------------------------

const REFRESH_MS_DEFAULT = 5000;
const REFRESH_MS_MIN = 1000;
const REFRESH_MS_MAX = 30000;

function getRefreshMs(): number {
  const raw =
    typeof import.meta !== "undefined"
      ? (import.meta as { env?: Record<string, string> }).env
          ?.VITE_VAULT_LIST_REFRESH_MS
      : undefined;
  if (!raw) return REFRESH_MS_DEFAULT;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < REFRESH_MS_MIN || parsed > REFRESH_MS_MAX) {
    console.warn(
      `[useVaultList] VITE_VAULT_LIST_REFRESH_MS=${raw} is out of range [${REFRESH_MS_MIN}, ${REFRESH_MS_MAX}]; using default ${REFRESH_MS_DEFAULT}ms`,
    );
    return REFRESH_MS_DEFAULT;
  }
  return parsed;
}

// Client shape returned by useCurrentClient() — matches both the real SDK
// client and the test mock.
interface SuiClientLike {
  queryEvents?: (args: {
    query: Record<string, unknown>;
    limit?: number;
  }) => Promise<{ data: unknown[]; hasNextPage: boolean; nextCursor: unknown }>;
  getObject?: (args: {
    id?: string;
    objectId?: string;
    options?: Record<string, boolean>;
  }) => Promise<unknown>;
  core?: {
    getObject?: (args: {
      id?: string;
      objectId?: string;
      options?: Record<string, boolean>;
    }) => Promise<unknown>;
  };
}

interface RawVaultObject {
  data: {
    objectId: string;
    content?: {
      dataType: string;
      type?: string;
      fields?: Record<string, unknown>;
    };
  } | null;
  error?: { code: string };
}

// Move's Option<u64> arrives in two shapes from the SDK depending on call path:
// `{ Some: "decimal" }` from event parsedJson, `{ fields: { vec: [decimal] } }`
// from getObject content. Returns null for None/missing/unknown shapes.
function parseOptionU64(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object" && "Some" in (raw as object)) {
    return String((raw as Record<string, unknown>)["Some"]);
  }
  if (typeof raw === "object" && "fields" in (raw as object)) {
    const fields = (raw as { fields: Record<string, unknown> }).fields;
    const vec = fields["vec"];
    if (Array.isArray(vec) && vec.length > 0) return String(vec[0]);
    return null;
  }
  return null;
}

export function useVaultList(): {
  vaults: VaultEntry[];
  refresh: () => void;
} {
  const account = useCurrentAccount();
  const client = useCurrentClient() as SuiClientLike;
  const { data: manifest } = useManifest();
  const [vaults, setVaults] = useState<VaultEntry[]>([]);
  // Keep a stable ref to the latest account address so the refresh function
  // doesn't go stale in the interval closure.
  const accountAddressRef = useRef<string | null>(null);
  accountAddressRef.current = account?.address ?? null;
  const manifestRef = useRef(manifest);
  manifestRef.current = manifest;
  const clientRef = useRef(client);
  clientRef.current = client;

  const refresh = useCallback(async () => {
    const address = accountAddressRef.current;
    const mf = manifestRef.current;
    const cl = clientRef.current;

    if (!address || !mf) {
      setVaults([]);
      return;
    }

    const tpslVaultPackageId = mf.tpslVaultPackageId;

    try {
      // Query VaultCreated events from the tpsl_vault package.
      const queryEventsFn = cl.queryEvents;
      if (!queryEventsFn) {
        setVaults([]);
        return;
      }

      const eventsResult = await queryEventsFn.call(cl, {
        query: {
          MoveEventType: `${tpslVaultPackageId}::tpsl_vault::VaultCreated`,
        },
        limit: 1000,
      });

      // Parse each event's parsedJson.
      type EventEnvelope = {
        parsedJson: {
          vault_id: string;
          owner: string;
          pool_id: string;
          side: number | string;
          tp_price: unknown;
          sl_price: unknown;
          deposit_amount: string;
        };
      };

      const events = eventsResult.data as EventEnvelope[];

      // Filter by owner.
      const ownerEvents = events.filter(
        (e) =>
          e.parsedJson.owner.toLowerCase() === address.toLowerCase(),
      );

      // Build pool lookup for baseCoinType resolution.
      const poolMap = new Map<string, string>();
      for (const pool of mf.pools) {
        poolMap.set(pool.poolId.toLowerCase(), pool.baseCoinType);
      }

      // For each owner-filtered vault, fetch on-chain object.
      const getObjectFn = cl.getObject ?? cl.core?.getObject;
      if (!getObjectFn) {
        setVaults([]);
        return;
      }

      const settled = await Promise.all(
        ownerEvents.map(async (e) => {
          const pj = e.parsedJson;
          const vaultId = pj.vault_id;
          let result: RawVaultObject;
          try {
            result = (await getObjectFn.call(cl, {
              id: vaultId,
              objectId: vaultId,
              options: { showContent: true },
            })) as RawVaultObject;
          } catch {
            return null;
          }

          // Treat deleted / not-found as withdrawn → omit.
          if (!result || !result.data) return null;

          const content = result.data.content;
          if (!content || content.dataType !== "moveObject" || !content.fields) {
            return null;
          }

          const fields = content.fields;
          const balance = String(fields["balance"] ?? "0");
          const triggered = Boolean(fields["triggered"]);

          // Post-withdraw filter: balance==0 && !triggered → omit.
          if (balance === "0" && !triggered) return null;

          const baseCoinType =
            poolMap.get(pj.pool_id.toLowerCase()) ??
            content.type?.match(/<(.+)>/)?.[1] ??
            "";

          return {
            vaultId,
            owner: pj.owner,
            poolId: pj.pool_id,
            side: Number(pj.side),
            tpPrice: parseOptionU64(pj.tp_price),
            slPrice: parseOptionU64(pj.sl_price),
            depositAmount: String(pj.deposit_amount),
            balance,
            triggered,
            baseCoinType,
          } satisfies VaultEntry;
        }),
      );

      const filtered = settled.filter((v): v is VaultEntry => v !== null);
      setVaults(filtered);
    } catch (err) {
      console.warn("[useVaultList] refresh failed:", err);
    }
  }, []);

  // Re-run when account address changes.
  useEffect(() => {
    void refresh();
  }, [account?.address, manifest?.tpslVaultPackageId, refresh]);

  // Polling interval.
  useEffect(() => {
    const ms = getRefreshMs();
    const id = setInterval(() => {
      void refresh();
    }, ms);
    return () => clearInterval(id);
  }, [refresh]);

  return { vaults, refresh };
}
