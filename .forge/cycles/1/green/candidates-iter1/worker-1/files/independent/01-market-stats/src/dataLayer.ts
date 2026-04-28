/**
 * Slot 1 data layer.
 *
 * Drives the chain-direct read path: per-pool inner-state via `sui_getObject`
 * and per-pool fill events via `suix_queryEvents`. Implemented with bare
 * `fetch` JSON-RPC calls so the network-shape test (T-014) can lock down
 * the outbound URL set with a single `globalThis.fetch` spy.
 *
 * Field shapes derived from `independent/01-market-stats/notes/chain-shape.md`.
 */

import type { PoolDescriptor } from './manifest.js';

export interface RunDataLayerArgs {
  manifest: {
    network?: { rpcUrl?: string };
    packages?: { deepbook?: { packageId?: string } };
    pools?: Record<string, { poolId: string; baseCoinType: string; quoteCoinType: string }>;
  };
  rpcUrl: string;
  nowMs: number;
}

interface JsonRpcEnvelope<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

let rpcId = 0;

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method,
      params,
    }),
  });
  const env = (await response.json()) as JsonRpcEnvelope<T>;
  if (env.error) {
    throw new Error(`${method} failed: ${env.error.message}`);
  }
  return env.result as T;
}

export async function runDataLayer(args: RunDataLayerArgs): Promise<void> {
  const { manifest, rpcUrl } = args;
  const pools = manifest.pools ?? {};
  const packageId = manifest.packages?.deepbook?.packageId ?? '';

  const descriptors: PoolDescriptor[] = Object.entries(pools).map(
    ([symbol, entry]) => ({
      symbol,
      poolId: entry.poolId,
      baseCoinType: entry.baseCoinType,
      quoteCoinType: entry.quoteCoinType,
    }),
  );

  for (const d of descriptors) {
    // sui_getObject for the pool inner state.
    await rpc(rpcUrl, 'sui_getObject', [
      d.poolId,
      { showContent: true, showType: true },
    ]);

    // suix_queryEvents for the per-pool fill stream.
    await rpc(rpcUrl, 'suix_queryEvents', [
      { MoveModule: { package: packageId, module: 'pool' } },
      null,
      50,
      true,
    ]);
  }
}
