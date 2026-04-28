/**
 * Deployment manifest loader.
 *
 * Reads `sandbox/deployments/localnet.json` (or any structurally equivalent
 * file) and returns typed `PoolDescriptor[]` plus the deployed DeepBook
 * package id. Hard-coded ids are forbidden by the cycle contract.
 *
 * Field shapes mirror the captured layout documented in
 * `independent/01-market-stats/notes/chain-shape.md`.
 *
 * API:
 *   - `parseManifest(raw)` — pure JSON-object validator, shared by both
 *     the Node-side `loadManifest` (used in unit tests) and the browser
 *     fetch path in `main.tsx`.
 *   - `loadManifest(manifestPath)` — Node.js fs-based loader, used in
 *     unit tests and any CLI tooling. Cannot run in the browser bundle
 *     (imports node:fs).
 */

import { promises as fs } from 'node:fs';

export type { PoolDescriptor, LoadedManifest } from './types.js';
import type { LoadedManifest, PoolDescriptor } from './types.js';

const BOOTSTRAP_HINT =
  'Run `pnpm deploy-all` from the deepbook-sandbox repo to regenerate the manifest.';

type RawManifest = {
  packages?: { deepbook?: { packageId?: string } };
  pools?: Record<string, { poolId?: string; baseCoinType?: string; quoteCoinType?: string }>;
};

/**
 * Pure manifest validator. Accepts a parsed JSON object (from either fs.readFile
 * or fetch+JSON.parse) and returns a validated LoadedManifest. Throws an
 * actionable Error on any validation failure.
 */
export function parseManifest(
  parsed: unknown,
  sourcePath = '<manifest>',
): LoadedManifest {
  const m = parsed as RawManifest;

  if (!m || typeof m !== 'object') {
    throw new Error(`Deployment manifest at ${sourcePath} is not a valid JSON object.`);
  }

  if (!m.pools || typeof m.pools !== 'object') {
    throw new Error(
      `Deployment manifest at ${sourcePath} is missing the required \`pools\` key.`,
    );
  }

  const packageId = m.packages?.deepbook?.packageId;
  if (typeof packageId !== 'string' || packageId.length === 0) {
    throw new Error(
      `Deployment manifest at ${sourcePath} is missing packages.deepbook.packageId.`,
    );
  }

  const pools: PoolDescriptor[] = Object.entries(m.pools).map(
    ([symbol, entry]) => {
      if (!entry.poolId || typeof entry.poolId !== 'string' || entry.poolId.length === 0) {
        throw new Error(
          `Deployment manifest at ${sourcePath}: pool "${symbol}" is missing field "poolId".`,
        );
      }
      if (!entry.baseCoinType || typeof entry.baseCoinType !== 'string' || entry.baseCoinType.length === 0) {
        throw new Error(
          `Deployment manifest at ${sourcePath}: pool "${symbol}" is missing field "baseCoinType".`,
        );
      }
      if (!entry.quoteCoinType || typeof entry.quoteCoinType !== 'string' || entry.quoteCoinType.length === 0) {
        throw new Error(
          `Deployment manifest at ${sourcePath}: pool "${symbol}" is missing field "quoteCoinType".`,
        );
      }
      return {
        symbol,
        poolId: entry.poolId,
        baseCoinType: entry.baseCoinType,
        quoteCoinType: entry.quoteCoinType,
      };
    },
  );

  return { deepbookPackageId: packageId, pools };
}

/**
 * Node.js fs-based manifest loader. Reads the file at `manifestPath` and
 * delegates to `parseManifest`. Throws an actionable error if the file
 * is missing. Cannot run in the browser bundle (uses node:fs).
 */
export async function loadManifest(manifestPath: string): Promise<LoadedManifest> {
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Deployment manifest not found at ${manifestPath}. ${BOOTSTRAP_HINT}`,
    );
  }

  const parsed = JSON.parse(raw) as unknown;
  return parseManifest(parsed, manifestPath);
}
