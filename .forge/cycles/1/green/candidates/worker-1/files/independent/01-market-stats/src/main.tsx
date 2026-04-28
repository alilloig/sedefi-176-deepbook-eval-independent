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

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { App, type AppDeps } from './App.js';
import { parseManifest } from './manifest.js';
import { fetchSinglePoolStats } from './dataLayer.js';

const RPC_URL =
  (import.meta as unknown as { env?: { VITE_SUI_RPC_URL?: string } }).env
    ?.VITE_SUI_RPC_URL ?? 'http://127.0.0.1:9000';

const MANIFEST_URL = '/localnet.json';

const deps: AppDeps = {
  loadManifest: async () => {
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
    return parseManifest(raw, MANIFEST_URL);
  },

  fetchPoolStats: async (descriptor) => {
    const nowMs = Date.now();
    // Use the real chain-direct data layer. Manifest packageId is looked up
    // per-call via the descriptor; the data layer fetches it from the manifest
    // loaded at boot via loadManifest above. We thread it through here by
    // re-fetching the manifest or caching it. For simplicity, the descriptor
    // carries poolId and the data layer receives the packageId from the
    // manifest. We pass it inline via a closure over a cached manifest.
    //
    // NOTE: packageId is threaded via a module-level cache populated during
    // loadManifest (see cachedPackageId below).
    return fetchSinglePoolStats(RPC_URL, cachedPackageId, descriptor, nowMs);
  },
};

// Cache the packageId after loadManifest resolves so fetchPoolStats can use it.
let cachedPackageId = '';
const _origLoadManifest = deps.loadManifest;
deps.loadManifest = async () => {
  const manifest = await _origLoadManifest();
  cachedPackageId = manifest.deepbookPackageId;
  return manifest;
};

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App deps={deps} />);
}
