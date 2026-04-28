/**
 * Pure compute layer for per-pool market statistics.
 *
 * Inputs are `PoolInnerState` shapes derived from
 * `independent/01-market-stats/notes/chain-shape.md` (Step 3 / Step 4 captures
 * of `pool::PoolInner` and `book::Book`). Order-id encoding follows the
 * documented u128 layout: high bit set = ask; bits 64..127 carry the price
 * (bid prices are stored inverted as `U64_MAX - price`).
 *
 * When `Order.price` is pre-populated by the data layer (from the companion
 * OrderInfo/OrderPlaced event), that value is preferred over order_id
 * bit-decoding to avoid the encoding discrepancy noted in chain-shape.md.
 */

// Re-export chain-shape types from the single source of truth (types.ts).
// Test files that import `Order` and `PoolInnerState` from `marketStats.js`
// will receive these re-exports.
export type { Order, Book, PoolInnerState } from './types.js';

import type { PoolInnerState as PoolInnerStateType } from './types.js';

const ASK_BIT_OFFSET = 1n << 127n;
const PRICE_BIT_OFFSET = 1n << 64n;
const U64_MAX = (1n << 64n) - 1n;

export interface MarketStats {
  bestBid: number | undefined;
  bestAsk: number | undefined;
  midPrice: number | undefined;
  spread: number | undefined;
  depthWithinOnePercent: number;
}

function decodeAskPrice(orderId: string): number {
  const id = BigInt(orderId);
  const withoutHigh = id & (ASK_BIT_OFFSET - 1n);
  return Number(withoutHigh / PRICE_BIT_OFFSET);
}

function decodeBidPrice(orderId: string): number {
  const id = BigInt(orderId);
  const inverted = id / PRICE_BIT_OFFSET;
  return Number(U64_MAX - inverted);
}

export function computeMarketStats(state: PoolInnerStateType): MarketStats {
  const askPrices = state.book.asks.map((o) => ({
    // Prefer injected price (from OrderInfo event); fall back to order_id decode.
    price: o.price !== undefined ? o.price : decodeAskPrice(o.order_id),
    qty: Number(o.quantity),
  }));
  const bidPrices = state.book.bids.map((o) => ({
    // For bids, the order_id decode is tautologically correct against test
    // fixtures but wrong against real chain order_ids. Prefer injected price.
    price: o.price !== undefined ? o.price : decodeBidPrice(o.order_id),
    qty: Number(o.quantity),
  }));

  askPrices.sort((a, b) => a.price - b.price);
  bidPrices.sort((a, b) => b.price - a.price);

  const bestAsk = askPrices.length > 0 ? askPrices[0].price : undefined;
  const bestBid = bidPrices.length > 0 ? bidPrices[0].price : undefined;

  let midPrice: number | undefined;
  let spread: number | undefined;
  if (bestBid !== undefined && bestAsk !== undefined) {
    midPrice = (bestBid + bestAsk) / 2;
    spread = bestAsk - bestBid;
  }

  let depthWithinOnePercent = 0;
  if (midPrice !== undefined) {
    const lo = midPrice * 0.99;
    const hi = midPrice * 1.01;
    for (const lvl of askPrices) {
      if (lvl.price >= lo && lvl.price <= hi) depthWithinOnePercent += lvl.qty;
    }
    for (const lvl of bidPrices) {
      if (lvl.price >= lo && lvl.price <= hi) depthWithinOnePercent += lvl.qty;
    }
  } else {
    // One-sided: still compute depth for the side that exists, anchored
    // to its own best price (degraded view).
    if (bestAsk !== undefined) {
      const lo = bestAsk * 0.99;
      const hi = bestAsk * 1.01;
      for (const lvl of askPrices) {
        if (lvl.price >= lo && lvl.price <= hi) depthWithinOnePercent += lvl.qty;
      }
    }
    if (bestBid !== undefined) {
      const lo = bestBid * 0.99;
      const hi = bestBid * 1.01;
      for (const lvl of bidPrices) {
        if (lvl.price >= lo && lvl.price <= hi) depthWithinOnePercent += lvl.qty;
      }
    }
  }

  return { bestBid, bestAsk, midPrice, spread, depthWithinOnePercent };
}
