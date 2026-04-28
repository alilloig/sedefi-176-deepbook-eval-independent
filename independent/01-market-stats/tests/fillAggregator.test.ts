/**
 * Tests for the pure event-stream aggregator (`aggregateFills`).
 *
 * The aggregator consumes a chronological array of `FillRecord`s
 * (constructed in the data layer from `OrderInfo` / `OrderInfo.fills[]`
 * payloads — see `notes/chain-shape.md`) and a fixed reference clock,
 * then returns:
 *
 *  - `volume24h`  : sum of base quantities whose timestamp falls within
 *                   the rolling 24h window relative to `nowMs`
 *  - `lastPrice`  : price of the chronologically newest fill
 *  - `sparkline`  : the most recent 50 fills (or fewer if input is sparse),
 *                   chronologically oldest-to-newest as documented in the
 *                   function's contract
 *
 * Tests are timestamp-explicit and never compare against `Date.now()` —
 * `nowMs` is always passed in.
 */

import { describe, it, expect } from 'vitest';

import {
  aggregateFills,
  type FillRecord,
} from '../src/fillAggregator.js';

const NOW = 2_000_000_000_000; // arbitrary fixed clock (ms)
const HOUR = 60 * 60 * 1000;

function fill(
  tsMs: number,
  baseQty: string | number,
  price: string | number,
  poolId = '0xpool',
): FillRecord {
  return {
    poolId,
    timestampMs: tsMs,
    baseQuantity: String(baseQty),
    price: String(price),
  };
}

describe('aggregateFills', () => {
  it('T-009 computes 24h volume from a captured event-page fixture spanning >24h', () => {
    const fills: FillRecord[] = [
      // Older than 24h — must be excluded.
      fill(NOW - 30 * HOUR, '100', '1000'),
      fill(NOW - 25 * HOUR, '50', '1000'),
      // Inside the 24h window — must be included.
      fill(NOW - 23 * HOUR, '7', '1000'),
      fill(NOW - 12 * HOUR, '11', '1000'),
      fill(NOW - 1 * HOUR, '13', '1000'),
      fill(NOW - 1000, '5', '1000'),
    ];

    const result = aggregateFills(fills, NOW);

    // 7 + 11 + 13 + 5 = 36. Old fills (100, 50) excluded.
    expect(result.volume24h).toBe(36);
    expect(result.volume24h).not.toBe(186); // tautology guard
  });

  it('T-010 returns the last 50 trades as the sparkline series, drawn from the most recent 50', () => {
    // 60 fills spaced 1 minute apart, oldest first.
    const fills: FillRecord[] = [];
    for (let i = 0; i < 60; i++) {
      const ts = NOW - (60 - i) * 60_000;
      fills.push(fill(ts, '1', String(1000 + i)));
    }

    const result = aggregateFills(fills, NOW);

    expect(result.sparkline).toHaveLength(50);

    // Sparkline must be drawn from the most recent 50 fills, never older.
    // The oldest 10 fills (prices 1000..1009) must NOT appear.
    const sparklinePrices = result.sparkline.map((p) => p.price);
    for (let i = 0; i < 10; i++) {
      expect(sparklinePrices).not.toContain(1000 + i);
    }
    // The newest 50 fill prices (1010..1059) must all appear.
    for (let i = 10; i < 60; i++) {
      expect(sparklinePrices).toContain(1000 + i);
    }

    // Chronological order: timestamps must be monotonically non-decreasing
    // (oldest-to-newest by the function's contract). We check this rather
    // than the reverse so the test pins a single direction; if the
    // implementer chooses newest-first they must update the function's
    // contract and this test will catch the divergence loudly.
    const timestamps = result.sparkline.map((p) => p.timestampMs);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it('T-011 returns a sparkline whose length equals input fill count when input is sparse', () => {
    const fills: FillRecord[] = [
      fill(NOW - 60_000, '1', '100'),
      fill(NOW - 30_000, '1', '101'),
      fill(NOW - 10_000, '1', '102'),
    ];

    const result = aggregateFills(fills, NOW);

    expect(result.sparkline).toHaveLength(fills.length);
    // No padding — the consumer must be able to render a 3-point sparkline
    // without a NaN, undefined, or zero-quantity placeholder slipping in.
    for (const p of result.sparkline) {
      expect(typeof p.price).toBe('number');
      expect(Number.isFinite(p.price)).toBe(true);
      expect(typeof p.timestampMs).toBe('number');
    }
  });

  it('T-012 derives last-price from the chronologically newest fill in the input', () => {
    // Provide deliberately-shuffled input to lock down ordering semantics:
    // last-price MUST come from the highest timestamp, not array index.
    const fills: FillRecord[] = [
      fill(NOW - 60_000, '1', '100'), // oldest
      fill(NOW - 1_000, '1', '999'), // newest -> last price = 999
      fill(NOW - 30_000, '1', '101'), // middle
    ];

    const result = aggregateFills(fills, NOW);

    expect(result.lastPrice).toBe(999);
    expect(result.lastPrice).not.toBe(100); // tautology guard
    expect(result.lastPrice).not.toBe(101);
  });
});
