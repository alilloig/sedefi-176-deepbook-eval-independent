/**
 * Slot 1 chain-shape derived types.
 *
 * Field names below are derived from the empirical capture in
 * `independent/01-market-stats/notes/chain-shape.md` (G-PoolShape artifact).
 * Do not rename fields from training memory; if the sandbox shape drifts,
 * re-capture chain-shape.md first and update these types from there.
 */

export interface PoolDescriptor {
  symbol: string;
  poolId: string;
  baseCoinType: string;
  quoteCoinType: string;
}

export interface ManifestPoolEntry {
  poolId: string;
  baseCoinType: string;
  quoteCoinType: string;
}

export interface DeploymentManifest {
  network?: { type?: string; rpcUrl?: string };
  packages?: { deepbook?: { packageId?: string } };
  pools?: Record<string, ManifestPoolEntry>;
}

export interface LoadedManifest {
  deepbookPackageId: string;
  pools: PoolDescriptor[];
}
