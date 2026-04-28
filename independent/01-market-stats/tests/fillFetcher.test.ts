/**
 * Tests for the paginated event fetcher (`fetchFills`).
 *
 * The fetcher wraps `SuiClient.queryEvents` (or our typed equivalent)
 * with two stop conditions:
 *
 *   1. The most recent 50 fills have been collected, OR
 *   2. The rolling 24h window relative to `nowMs` is fully covered.
 *
 * Whichever fires first stops pagination. The fetcher must NEVER issue
 * a follow-up call after either condition is met.
 *
 * We don't import `@mysten/sui` here. The fetcher accepts a typed
 * `queryEvents`-shaped function which we provide as a Vitest spy.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  fetchFills,
  type RawFillEvent,
  type QueryEventsFn,
  type QueryEventsResponse,
} from '../src/fillFetcher.js';

const NOW = 2_000_000_000_000;
const HOUR = 60 * 60 * 1000;
const POOL_ID = '0xpool';

function rawEvent(timestampMs: number, baseQty: string, price: string): RawFillEvent {
  return {
    poolId: POOL_ID,
    timestampMs,
    baseQuantity: baseQty,
    price,
  };
}

function makePagedResponder(pages: RawFillEvent[][]): QueryEventsFn {
  let pageIdx = 0;
  return vi.fn(async (): Promise<QueryEventsResponse> => {
    const data = pages[pageIdx] ?? [];
    const hasNext = pageIdx < pages.length - 1;
    const cursor = hasNext ? { txDigest: `cursor-${pageIdx}`, eventSeq: '0' } : null;
    pageIdx += 1;
    return {
      data,
      hasNextPage: hasNext,
      nextCursor: cursor,
    };
  });
}

describe('fetchFills (T-013 paginates until 24h window or 50-fill cap)', () => {
  it('T-013 paginates until the 50-fill cap is satisfied, then stops', async () => {
    // Three pages of 25 fills each, all within the last hour, newest first.
    const mkPage = (start: number): RawFillEvent[] =>
      Array.from({ length: 25 }, (_, i) =>
        rawEvent(NOW - (start + i) * 1000, '1', '100'),
      );

    const pages = [
      mkPage(0),  // 25 newest
      mkPage(25), // 25 next
      mkPage(50), // 25 oldest (should never be fetched)
    ];
    const responder = makePagedResponder(pages);

    const result = await fetchFills({
      packageId: '0xpkg',
      poolId: POOL_ID,
      queryEvents: responder,
      nowMs: NOW,
    });

    expect(result.length).toBe(50);

    // Critical: after the 50-fill cap is met, NO further query should fire.
    // Two pages were enough (25 + 25 = 50). The third page must not be
    // requested.
    expect(responder).toHaveBeenCalledTimes(2);
  });

  it('T-013 stops paginating once the 24h window is covered (no over-query)', async () => {
    // Newest-first: first page has fills inside the window, second page
    // contains a fill *older* than 24h. Once the fetcher sees a
    // beyond-window fill it must stop.
    const insideWindow = Array.from({ length: 5 }, (_, i) =>
      rawEvent(NOW - (i + 1) * HOUR, '1', '100'),
    );
    const crossingBoundary = [
      rawEvent(NOW - 23 * HOUR, '1', '100'), // still inside
      rawEvent(NOW - 25 * HOUR, '1', '100'), // beyond -> stop
    ];
    const beyondPage = [rawEvent(NOW - 50 * HOUR, '1', '100')]; // must not fetch

    const responder = makePagedResponder([
      insideWindow,
      crossingBoundary,
      beyondPage,
    ]);

    const result = await fetchFills({
      packageId: '0xpkg',
      poolId: POOL_ID,
      queryEvents: responder,
      nowMs: NOW,
    });

    // Result must include the in-window fills only.
    for (const f of result) {
      expect(NOW - f.timestampMs).toBeLessThanOrEqual(24 * HOUR);
    }

    // Two pages were enough to expose the boundary; the third page must
    // not be queried.
    expect(responder).toHaveBeenCalledTimes(2);
  });

  it('T-013 never queries beyond what is needed when the first page already covers both stop conditions', async () => {
    // 50 in-window fills on a single page -> stop after one call.
    const onePage = Array.from({ length: 50 }, (_, i) =>
      rawEvent(NOW - (i + 1) * 1000, '1', '100'),
    );
    const responder = makePagedResponder([
      onePage,
      [rawEvent(NOW - 60 * HOUR, '1', '100')], // must not fetch
    ]);

    const result = await fetchFills({
      packageId: '0xpkg',
      poolId: POOL_ID,
      queryEvents: responder,
      nowMs: NOW,
    });

    expect(result.length).toBeGreaterThanOrEqual(50);
    expect(responder).toHaveBeenCalledTimes(1);
  });
});
