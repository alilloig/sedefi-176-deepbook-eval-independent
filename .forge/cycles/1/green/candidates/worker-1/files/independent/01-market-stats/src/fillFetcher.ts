/**
 * Paginated fill-event fetcher.
 *
 * Wraps a `queryEvents`-shaped function with two stop conditions per the
 * cycle contract: stop when 50 fills have been collected, or when the
 * 24h window has been crossed (whichever fires first). Never issues a
 * follow-up call after either condition is met.
 *
 * Event shape and `module: "pool"` filter rationale documented in
 * `independent/01-market-stats/notes/chain-shape.md` (suix_queryEvents
 * filters by transactionModule, not the declaring module).
 *
 * H-1 fix: events are filtered by poolId before accumulation. The
 * `MoveModule` filter on suix_queryEvents returns events from ALL pools
 * in the deployed package; the `pool_id` field on each OrderInfo payload
 * (chain-shape.md line 217) enables per-pool demultiplexing.
 */

export interface RawFillEvent {
  poolId: string;
  timestampMs: number;
  baseQuantity: string;
  price: string;
}

export interface QueryEventsCursor {
  txDigest: string;
  eventSeq: string;
}

export interface QueryEventsResponse {
  data: RawFillEvent[];
  hasNextPage: boolean;
  nextCursor: QueryEventsCursor | null;
}

export type QueryEventsFn = (args: {
  packageId: string;
  poolId: string;
  cursor: QueryEventsCursor | null;
}) => Promise<QueryEventsResponse>;

export interface FetchFillsArgs {
  packageId: string;
  poolId: string;
  queryEvents: QueryEventsFn;
  nowMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FILLS = 50;

export async function fetchFills(args: FetchFillsArgs): Promise<RawFillEvent[]> {
  const { packageId, poolId, queryEvents, nowMs } = args;
  const collected: RawFillEvent[] = [];
  let cursor: QueryEventsCursor | null = null;
  let crossedWindow = false;

  while (true) {
    const response = await queryEvents({ packageId, poolId, cursor });

    for (const ev of response.data) {
      // H-1: filter events by poolId — suix_queryEvents with MoveModule filter
      // returns events from ALL pools; we demultiplex here using pool_id.
      if (ev.poolId !== poolId) continue;

      if (nowMs - ev.timestampMs > DAY_MS) {
        crossedWindow = true;
      } else {
        collected.push(ev);
      }
    }

    if (collected.length >= MAX_FILLS) break;
    if (crossedWindow) break;
    if (!response.hasNextPage) break;
    cursor = response.nextCursor;
  }

  return collected;
}
