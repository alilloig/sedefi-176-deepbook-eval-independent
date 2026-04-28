/**
 * Single-pool stats card.
 *
 * Renders the six labeled statistics required by AC1.3. Sentinel placeholder
 * is shown for any undefined numeric value so degraded one-sided book states
 * (e.g. empty bid book) render without crashing.
 */

import * as React from 'react';

export interface SparklinePoint {
  timestampMs: number;
  price: number;
}

export interface PoolCardData {
  poolId: string;
  symbol: string;
  volume24h: number | undefined;
  lastPrice: number | undefined;
  midPrice: number | undefined;
  spread: number | undefined;
  depthWithinOnePercent: number | undefined;
  sparkline: SparklinePoint[];
}

const SENTINEL = '—';

function fmt(value: number | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return SENTINEL;
  }
  return String(value);
}

export function PoolCard({ data }: { data: PoolCardData }): React.ReactElement {
  return (
    <section data-testid="pool-card" data-pool-id={data.poolId}>
      <h2>{data.symbol}</h2>
      <dl>
        <dt>24h Volume</dt>
        <dd>{fmt(data.volume24h)}</dd>
        <dt>Last Price</dt>
        <dd>{fmt(data.lastPrice)}</dd>
        <dt>Mid-Price</dt>
        <dd>{fmt(data.midPrice)}</dd>
        <dt>Bid/Ask Spread</dt>
        <dd>{fmt(data.spread)}</dd>
        <dt>Depth at +/-1% from mid</dt>
        <dd>{fmt(data.depthWithinOnePercent)}</dd>
        <dt>Sparkline (last 50 trades)</dt>
        <dd>
          {!data.sparkline || data.sparkline.length === 0
            ? SENTINEL
            : data.sparkline.map((p) => p.price.toFixed(4)).join(' ')}
        </dd>
      </dl>
    </section>
  );
}
