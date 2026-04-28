/**
 * Deployment manifest loader.
 *
 * Reads `sandbox/deployments/localnet.json` (or any structurally equivalent
 * file) and returns typed `PoolDescriptor[]` plus the deployed DeepBook
 * package id. Hard-coded ids are forbidden by the cycle contract.
 *
 * Field shapes mirror the captured layout documented in
 * `independent/01-market-stats/notes/chain-shape.md`.
 */

import { promises as fs } from 'node:fs';

export interface PoolDescriptor {
  symbol: string;
  poolId: string;
  baseCoinType: string;
  quoteCoinType: string;
}

export interface LoadedManifest {
  deepbookPackageId: string;
  pools: PoolDescriptor[];
}

const BOOTSTRAP_HINT =
  'Run `pnpm deploy-all` from the deepbook-sandbox repo to regenerate the manifest.';

export async function loadManifest(manifestPath: string): Promise<LoadedManifest> {
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Deployment manifest not found at ${manifestPath}. ${BOOTSTRAP_HINT}`,
    );
  }

  const parsed = JSON.parse(raw) as {
    packages?: { deepbook?: { packageId?: string } };
    pools?: Record<string, { poolId: string; baseCoinType: string; quoteCoinType: string }>;
  };

  if (!parsed.pools || typeof parsed.pools !== 'object') {
    throw new Error(
      `Deployment manifest at ${manifestPath} is missing the required \`pools\` key.`,
    );
  }

  const packageId = parsed.packages?.deepbook?.packageId;
  if (typeof packageId !== 'string' || packageId.length === 0) {
    throw new Error(
      `Deployment manifest at ${manifestPath} is missing packages.deepbook.packageId.`,
    );
  }

  const pools: PoolDescriptor[] = Object.entries(parsed.pools).map(
    ([symbol, entry]) => ({
      symbol,
      poolId: entry.poolId,
      baseCoinType: entry.baseCoinType,
      quoteCoinType: entry.quoteCoinType,
    }),
  );

  return { deepbookPackageId: packageId, pools };
}
