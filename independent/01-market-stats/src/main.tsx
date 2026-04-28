/**
 * Vite entry point. Mounts the App with real deps wired against the manifest
 * loader and the chain-direct fetch data layer.
 *
 * CR-1 fix: `fetchPoolStats` is now a real implementation that:
 *   (1) reads per-pool inner state via sui_getObject + BigVector traversal
 *   (2) fetches fill events via suix_queryEvents
 *   (3) feeds results into computeMarketStats + aggregateFills
 *   (4) returns a fully-populated PoolCardData
 *
 * CR-3 fix: the manifest is served to the browser by a Vite dev-server
 *   middleware configured in vite.config.ts. The browser fetches it from
 *   /localnet.json; no node:fs import is needed here.
 *
 * The manifest is parsed by `parseManifest` (the pure validator shared
 * with the Node-side `loadManifest`), so all validation errors are
 * actionable.
 */

import { createRoot } from 'react-dom/client';
import { App, type AppDeps } from './App.js';
import { parseManifest, type PoolDescriptor } from './manifest.js';
import { fetchSinglePoolStats } from './dataLayer.js';

const RPC_URL =
  (import.meta as unknown as { env?: { VITE_SUI_RPC_URL?: string } }).env
    ?.VITE_SUI_RPC_URL ?? 'http://127.0.0.1:9000';

const MANIFEST_URL = '/localnet.json';

// Build deps as a closure-bound pair so loadManifest's resolved packageId is
// captured by fetchPoolStats without module-level mutable state.
// (Refactor of the iter-2/iter-3 `let cachedPackageId; deps.loadManifest = …`
// trick that 3 reviewers flagged as a closure-over-let smell.)
function buildDeps(): AppDeps {
  let packageId: string | undefined;

  const loadManifest = async () => {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) {
      throw new Error(
        `Deployment manifest not reachable at ${MANIFEST_URL}. ` +
          'Run `pnpm deploy-all` from the deepbook-sandbox repo to regenerate, ' +
          'then restart the dev server.',
      );
    }
    const raw = await response.json() as unknown;
    // parseManifest validates all required fields and throws actionable errors.
    const manifest = parseManifest(raw, MANIFEST_URL);
    packageId = manifest.deepbookPackageId;
    return manifest;
  };

  const fetchPoolStats = async (descriptor: PoolDescriptor) => {
    if (packageId === undefined) {
      throw new Error(
        'fetchPoolStats called before loadManifest resolved — this is a wiring ' +
          'bug; ensure App.useEffect awaits the manifest before any per-pool fetch.',
      );
    }
    return fetchSinglePoolStats(RPC_URL, packageId, descriptor, Date.now());
  };

  return { loadManifest, fetchPoolStats };
}

const deps = buildDeps();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App deps={deps} />);
}
