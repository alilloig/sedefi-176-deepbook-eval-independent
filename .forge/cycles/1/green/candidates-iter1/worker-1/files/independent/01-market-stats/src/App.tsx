/**
 * Root component. Loads the manifest, fetches per-pool stats via injected
 * deps, renders one PoolCard per pool, and shows an actionable inline error
 * UI for manifest-missing or RPC-unreachable.
 */

import * as React from 'react';
import { PoolCard, type PoolCardData } from './components/PoolCard.js';
import type { PoolDescriptor, LoadedManifest } from './manifest.js';

export interface AppDeps {
  loadManifest: () => Promise<LoadedManifest>;
  fetchPoolStats: (descriptor: PoolDescriptor) => Promise<PoolCardData>;
}

interface AppState {
  status: 'loading' | 'ready' | 'error';
  cards: PoolCardData[];
  error?: string;
}

export function App({ deps }: { deps: AppDeps }): React.ReactElement {
  const [state, setState] = React.useState<AppState>({
    status: 'loading',
    cards: [],
  });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const manifest = await deps.loadManifest();
        const cards = await Promise.all(
          manifest.pools.map((p) => deps.fetchPoolStats(p)),
        );
        if (!cancelled) setState({ status: 'ready', cards });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!cancelled) setState({ status: 'error', cards: [], error: message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deps]);

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
      <div>
        {state.cards.map((c) => (
          <PoolCard key={c.poolId} data={c} />
        ))}
      </div>
    </main>
  );
}
