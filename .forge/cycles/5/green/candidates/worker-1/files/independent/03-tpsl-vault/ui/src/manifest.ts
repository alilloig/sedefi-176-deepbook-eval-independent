import { useQuery } from "@tanstack/react-query";

export interface Pool {
  poolId: string;
  baseCoinType: string;
  quoteCoinType: string;
  label?: string;
}

export interface ManifestData {
  rpcUrl: string;
  pools: Pool[];
  tpslVaultPackageId: string;
}

interface LocalnetJson {
  network?: { rpcUrl?: string };
  pools?: Array<{
    poolId: string;
    baseCoinType: string;
    quoteCoinType: string;
    label?: string;
  }>;
  packages?: {
    deepbook?: { packageId?: string };
    token?: { packageId?: string };
  };
}

const TPSL_VAULT_PACKAGE_ID =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string> }).env
      ?.VITE_TPSL_VAULT_PACKAGE_ID) ??
  "";

async function fetchManifest(): Promise<ManifestData> {
  const res = await fetch("/localnet.json");
  if (!res.ok) {
    let errMsg = "Failed to fetch /localnet.json";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errMsg = body.error;
    } catch {
      // ignore parse error
    }
    throw new Error(errMsg);
  }
  const json = (await res.json()) as LocalnetJson;
  const rpcUrl = json.network?.rpcUrl ?? "http://127.0.0.1:9000";
  const pools: Pool[] = (json.pools ?? []).map((p) => ({
    poolId: p.poolId,
    baseCoinType: p.baseCoinType,
    quoteCoinType: p.quoteCoinType,
    label: p.label,
  }));
  return {
    rpcUrl,
    pools,
    tpslVaultPackageId: TPSL_VAULT_PACKAGE_ID,
  };
}

export function useManifest(): {
  data: ManifestData | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const query = useQuery<ManifestData, Error>({
    queryKey: ["manifest"],
    queryFn: fetchManifest,
    staleTime: Infinity,
    retry: false,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}
