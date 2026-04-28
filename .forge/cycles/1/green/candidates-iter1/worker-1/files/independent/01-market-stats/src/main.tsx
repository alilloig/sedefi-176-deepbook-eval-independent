/**
 * Vite entry. Mounts the App with default deps wired against the manifest
 * loader and a thin chain-direct fetch path. The sandbox manifest is served
 * to the browser via a Vite dev-time small fetch (see vite.config.ts).
 */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { App, type AppDeps } from './App.js';
import { loadManifest } from './manifest.js';
import type { PoolCardData } from './components/PoolCard.js';

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
          'Run `pnpm deploy-all` from the deepbook-sandbox repo and re-symlink ' +
          'the manifest under public/.',
      );
    }
    const text = await response.text();
    const parsed = JSON.parse(text) as {
      packages?: { deepbook?: { packageId?: string } };
      pools?: Record<string, { poolId: string; baseCoinType: string; quoteCoinType: string }>;
    };
    if (!parsed.pools) {
      throw new Error('Manifest is missing the pools key.');
    }
    return {
      deepbookPackageId: parsed.packages?.deepbook?.packageId ?? '',
      pools: Object.entries(parsed.pools).map(([symbol, entry]) => ({
        symbol,
        poolId: entry.poolId,
        baseCoinType: entry.baseCoinType,
        quoteCoinType: entry.quoteCoinType,
      })),
    };
  },
  fetchPoolStats: async (descriptor): Promise<PoolCardData> => ({
    poolId: descriptor.poolId,
    symbol: descriptor.symbol,
    volume24h: 0,
    lastPrice: undefined,
    midPrice: undefined,
    spread: undefined,
    depthWithinOnePercent: 0,
    sparkline: [],
  }),
};

void loadManifest;
void RPC_URL;

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App deps={deps} />);
}
