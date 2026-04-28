/**
 * Tests for the pure compute layer (`computeMarketStats`).
 *
 * Inputs are PoolInnerState fixtures whose field names are derived from
 * `notes/chain-shape.md` (Step 3 / Step 4 captures). The compute layer
 * never touches the network — it consumes a fully-traversed
 * `PoolInnerState` and returns mid-price, spread, and depth at +/-1% from
 * mid as plain numeric values.
 *
 * Order-id encoding (per chain-shape.md): the upper 64 bits of the u128
 * `order_id` carry the price (with bid prices inverted). The fixture
 * helpers below construct ladders by computing the encoded order_id from
 * a chosen price; this matches the on-chain ordering and lets the tests
 * assert that `computeMarketStats` reads the price from order_id directly.
 *
 * Conventions for fixtures: prices are unitless integers in the same
 * tick-units the chain reports. Quantities are unitless integers in the
 * same lot-units the chain reports. The compute function should return
 * mid-price as `(bestBid + bestAsk) / 2`, spread as `bestAsk - bestBid`,
 * and depth as the sum of `quantity` over levels strictly within +/-1%
 * of mid (price, ignoring `filled_quantity` for the resting depth view).
 */

import { describe, it, expect } from 'vitest';

import {
  computeMarketStats,
  type PoolInnerState,
  type Order,
} from '../src/marketStats.js';

// ---------------------------------------------------------------------
// Fixture helpers — derived from notes/chain-shape.md
// ---------------------------------------------------------------------

const ASK_BIT_OFFSET = 1n << 127n; // asks have the high bit set so they sort
                                   // above bids in a single u128 universe
const PRICE_BIT_OFFSET = 1n << 64n;

function makeAskOrderId(price: bigint, counter: bigint): string {
  // Asks: high bit set, price ascending. Encoding: (1 << 127) | (price << 64) | counter.
  return (ASK_BIT_OFFSET | (price * PRICE_BIT_OFFSET) | counter).toString();
}

function makeBidOrderId(price: bigint, counter: bigint): string {
  // Bids: high bit clear, price *inverted* so the best (highest) bid sorts first.
  // Encoding: ((U64_MAX - price) << 64) | counter.
  const U64_MAX = (1n << 64n) - 1n;
  return (((U64_MAX - price) * PRICE_BIT_OFFSET) | counter).toString();
}

function order(
  orderId: string,
  quantity: string,
  filled = '0',
  status = 0,
): Order {
  return {
    order_id: orderId,
    quantity,
    filled_quantity: filled,
    status,
  };
}

function poolFixture(
  asks: Order[],
  bids: Order[],
  overrides: Partial<PoolInnerState> = {},
): PoolInnerState {
  return {
    pool_id: '0xpool',
    book: {
      asks,
      bids,
      lot_size: '1',
      min_size: '1',
      tick_size: '1',
      ...(overrides.book ?? {}),
    },
    ...overrides,
  };
}

// A populated, balanced ladder around mid = 1000.
const populated = poolFixture(
  [
    // best ask at price 1010, then 1020, 1100 (1100 = +10% from mid, outside band)
    order(makeAskOrderId(1010n, 1n), '50'),
    order(makeAskOrderId(1020n, 2n), '30'),
    order(makeAskOrderId(1100n, 3n), '999'),
  ],
  [
    // best bid at price 990, then 985, 900 (900 = -10% from mid, outside band)
    order(makeBidOrderId(990n, 1n), '40'),
    order(makeBidOrderId(985n, 2n), '20'),
    order(makeBidOrderId(900n, 3n), '999'),
  ],
);

describe('computeMarketStats', () => {
  it('T-005 returns finite mid, spread, and depth for a populated inner-state fixture', () => {
    const stats = computeMarketStats(populated);

    expect(stats.bestBid).toBe(990);
    expect(stats.bestAsk).toBe(1010);
    expect(stats.midPrice).toBe(1000);
    expect(stats.spread).toBe(20);

    expect(Number.isFinite(stats.midPrice as number)).toBe(true);
    expect(Number.isFinite(stats.spread as number)).toBe(true);
    expect(Number.isFinite(stats.depthWithinOnePercent as number)).toBe(true);

    // Depth at +/-1% of mid=1000 is the band [990, 1010]. Levels at
    // bid 990, ask 1010 are inside (boundary inclusive), bid 985 and
    // ask 1020 are just outside, bid 900 and ask 1100 are far outside.
    // Quantities inside the band: 40 (bid@990) + 50 (ask@1010) = 90.
    expect(stats.depthWithinOnePercent).toBe(90);
  });

  it('T-006 invariant bestBid <= mid <= bestAsk holds across every fixture row', () => {
    const rows: PoolInnerState[] = [
      populated,
      // tight book
      poolFixture(
        [order(makeAskOrderId(1001n, 1n), '5')],
        [order(makeBidOrderId(999n, 1n), '5')],
      ),
      // wide book
      poolFixture(
        [
          order(makeAskOrderId(2000n, 1n), '5'),
          order(makeAskOrderId(2200n, 2n), '5'),
        ],
        [
          order(makeBidOrderId(500n, 1n), '5'),
          order(makeBidOrderId(450n, 2n), '5'),
        ],
      ),
      // single-level books
      poolFixture(
        [order(makeAskOrderId(123n, 1n), '1')],
        [order(makeBidOrderId(120n, 1n), '1')],
      ),
    ];

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const s = computeMarketStats(row);
      expect(s.bestBid, `bestBid for row ${JSON.stringify(row.book)}`).toBeDefined();
      expect(s.bestAsk).toBeDefined();
      expect(s.midPrice).toBeDefined();

      // The invariant. Two-sided check, no weakening allowed.
      expect(s.bestBid as number).toBeLessThanOrEqual(s.midPrice as number);
      expect(s.midPrice as number).toBeLessThanOrEqual(s.bestAsk as number);
    }
  });

  it('T-007 handles an empty bid book gracefully (no throw, sentinels for mid/spread)', () => {
    const askOnly = poolFixture(
      [order(makeAskOrderId(1000n, 1n), '10')],
      [], // empty bids
    );

    let stats: ReturnType<typeof computeMarketStats> | undefined;
    expect(() => {
      stats = computeMarketStats(askOnly);
    }).not.toThrow();

    expect(stats).toBeDefined();
    expect(stats!.bestAsk).toBe(1000);
    // Mid-price and spread are undefined or null (sentinel) when the book
    // is one-sided — never NaN, never 0, never Infinity (those would
    // misrender as a real numeric result).
    expect(
      stats!.midPrice === undefined || stats!.midPrice === null,
      `midPrice should be sentinel, got ${stats!.midPrice}`,
    ).toBe(true);
    expect(
      stats!.spread === undefined || stats!.spread === null,
    ).toBe(true);

    // Ask-side depth still computes — it does not depend on mid.
    expect(typeof stats!.depthWithinOnePercent).toBe('number');
    expect(Number.isFinite(stats!.depthWithinOnePercent as number)).toBe(true);
  });

  it('T-008 depth-at-+/-1% sums only levels strictly inside the +/-1% window of mid', () => {
    // Mid will be 1000. Band is [990, 1010] inclusive at the boundary.
    const fixture = poolFixture(
      [
        order(makeAskOrderId(1010n, 1n), '7'), // boundary, inside
        order(makeAskOrderId(1011n, 2n), '500'), // 0.1% outside upper bound -> excluded
        order(makeAskOrderId(2000n, 3n), '999'), // far outside -> excluded
      ],
      [
        order(makeBidOrderId(990n, 1n), '11'), // boundary, inside
        order(makeBidOrderId(989n, 2n), '500'), // 0.1% outside lower bound -> excluded
        order(makeBidOrderId(100n, 3n), '999'), // far outside -> excluded
      ],
    );

    const stats = computeMarketStats(fixture);
    expect(stats.midPrice).toBe(1000);

    // Only the two boundary levels count. Nothing else.
    expect(stats.depthWithinOnePercent).toBe(7 + 11);

    // Sanity: the excluded-level quantities (each 500 and 999) do NOT
    // contribute. If depth ever silently summed everything it would land
    // at 7 + 11 + 500 + 500 + 999 + 999 = 3016. Lock that out.
    expect(stats.depthWithinOnePercent).not.toBe(3016);
    expect(stats.depthWithinOnePercent).toBeLessThan(100);
  });
});
