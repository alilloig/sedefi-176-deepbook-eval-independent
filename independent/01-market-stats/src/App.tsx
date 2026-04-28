/**
 * Root component. Loads the manifest, fetches per-pool stats via injected
 * deps, renders one PoolCard per pool, and shows an actionable inline error
 * UI for manifest-missing or RPC-unreachable.
 *
 * H-4 fix: per-pool fetches use Promise.allSettled so one transient pool
 *   error does not blank the entire dashboard.
 * H-5 fix: a polling effect re-fetches fill data every REFRESH_INTERVAL_MS
 *   so the sparkline reflects new fills within 30 s.
 */

import * as React from 'react';
import { PoolCard, type PoolCardData } from './components/PoolCard.js';
import type { PoolDescriptor, LoadedManifest } from './manifest.js';

const REFRESH_INTERVAL_MS = 20_000; // 20 s — within the 30 s contract requirement

export interface AppDeps {
  loadManifest: () => Promise<LoadedManifest>;
  fetchPoolStats: (descriptor: PoolDescriptor) => Promise<PoolCardData>;
}

interface AppState {
  status: 'loading' | 'ready' | 'error';
  cards: PoolCardData[];
  error?: string;
  poolErrors?: string[];
}

function sentinelCard(pool: PoolDescriptor): PoolCardData {
  return {
    poolId: pool.poolId,
    symbol: pool.symbol,
    volume24h: undefined,
    lastPrice: undefined,
    midPrice: undefined,
    spread: undefined,
    depthWithinOnePercent: undefined,
    sparkline: [],
  };
}

// H-4: per-pool failures must not blank the dashboard. Fans out via
// Promise.allSettled, returns a sentinel card per failed pool, and surfaces
// rejection messages so T-020's RPC-error actionability check can render them.
async function fetchAllPools(
  deps: AppDeps,
  pools: PoolDescriptor[],
): Promise<{ cards: PoolCardData[]; poolErrors: string[] }> {
  const settled = await Promise.allSettled(pools.map((p) => deps.fetchPoolStats(p)));
  const cards: PoolCardData[] = settled.map((result, i) =>
    result.status === 'fulfilled' ? result.value : sentinelCard(pools[i]),
  );
  const poolErrors: string[] = settled
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
  return { cards, poolErrors };
}

export function App({ deps }: { deps: AppDeps }): React.ReactElement {
  const [state, setState] = React.useState<AppState>({
    status: 'loading',
    cards: [],
  });

  // Keep a ref to the current pools so the refresh interval can iterate them
  // without re-registering the interval every time cards change.
  const manifestPoolsRef = React.useRef<PoolDescriptor[]>([]);

  // Initial load effect.
  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const manifest = await deps.loadManifest();
        manifestPoolsRef.current = manifest.pools;
        const { cards, poolErrors } = await fetchAllPools(deps, manifest.pools);
        if (!cancelled) setState({ status: 'ready', cards, poolErrors });
      } catch (err) {
        // Manifest load failure — global error UI.
        const message = err instanceof Error ? err.message : String(err);
        if (!cancelled) setState({ status: 'error', cards: [], error: message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deps]);

  // H-5: periodic refresh so the sparkline reflects new fills within 30 s.
  React.useEffect(() => {
    if (state.status !== 'ready') return;

    const intervalId = setInterval(async () => {
      const pools = manifestPoolsRef.current;
      if (pools.length === 0) return;
      const { cards, poolErrors } = await fetchAllPools(deps, pools);
      setState({ status: 'ready', cards, poolErrors });
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [deps, state.status]);

  if (state.status === 'error') {
    return (
      <main>
        <h1>Slot 1 — Market Stats</h1>
        <div role="alert">
          <p>Could not load market data:</p>
          <pre>{state.error}</pre>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>Slot 1 — Market Stats</h1>
      {state.status === 'loading' ? <p>Loading…</p> : null}
      {state.poolErrors && state.poolErrors.length > 0 ? (
        <div role="alert">
          {state.poolErrors.map((msg, i) => (
            <p key={i}>{msg}</p>
          ))}
        </div>
      ) : null}
      <div>
        {state.cards.map((c) => (
          <PoolCard key={c.poolId} data={c} />
        ))}
      </div>
    </main>
  );
}
