/**
 * Pure event-stream aggregator. Consumes chronological FillRecords plus a
 * fixed `nowMs` and returns 24h volume, last price, and a 50-point sparkline.
 *
 * FillRecord shape mirrors the OrderInfo / OrderInfo.fills payload documented
 * in `independent/01-market-stats/notes/chain-shape.md`.
 */

export interface FillRecord {
  poolId: string;
  timestampMs: number;
  baseQuantity: string;
  price: string;
}

export interface SparklinePoint {
  timestampMs: number;
  price: number;
}

export interface FillAggregate {
  volume24h: number;
  lastPrice: number | undefined;
  sparkline: SparklinePoint[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function aggregateFills(fills: FillRecord[], nowMs: number): FillAggregate {
  const sorted = [...fills].sort((a, b) => a.timestampMs - b.timestampMs);

  let volume24h = 0;
  for (const f of sorted) {
    if (nowMs - f.timestampMs <= DAY_MS) {
      volume24h += Number(f.baseQuantity);
    }
  }

  const lastPrice =
    sorted.length > 0 ? Number(sorted[sorted.length - 1].price) : undefined;

  const tail = sorted.slice(-50);
  const sparkline: SparklinePoint[] = tail.map((f) => ({
    timestampMs: f.timestampMs,
    price: Number(f.price),
  }));

  return { volume24h, lastPrice, sparkline };
}
