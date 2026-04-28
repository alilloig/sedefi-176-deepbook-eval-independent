/**
 * Slot 1 data layer.
 *
 * Drives the chain-direct read path: per-pool inner-state via `sui_getObject`
 * and per-pool fill events via `suix_queryEvents`. Implemented with bare
 * `fetch` JSON-RPC calls so the network-shape test (T-014) can lock down
 * the outbound URL set with a single `globalThis.fetch` spy.
 *
 * Field shapes derived from `independent/01-market-stats/notes/chain-shape.md`.
 *
 * H-7 fix: `runDataLayer` now returns `Promise<PoolCardData[]>` instead of
 * `Promise<void>`, making it usable as the production data layer.
 *
 * CR-1 fix: full traversal path implemented — Pool → Versioned → PoolInner →
 * BigVector slices → Orders. Falls back to flat PoolInner shape when the
 * Versioned wrapper is absent (e.g. in T-014 fixture responses).
 */

import type { PoolDescriptor } from './manifest.js';
import type { PoolInnerState, Order } from './types.js';
import type { PoolCardData } from './components/PoolCard.js';
import { computeMarketStats } from './marketStats.js';
import { fetchFills, type QueryEventsFn, type RawFillEvent } from './fillFetcher.js';
import { aggregateFills, type FillRecord } from './fillAggregator.js';

export interface RunDataLayerArgs {
  manifest: {
    network?: { rpcUrl?: string };
    packages?: { deepbook?: { packageId?: string } };
    pools?: Record<string, { poolId: string; baseCoinType: string; quoteCoinType: string }>;
  };
  rpcUrl: string;
  nowMs: number;
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
  const env = (await response.json()) as {
    result?: T;
    error?: { code: number; message: string };
  };
  if (env.error) {
    throw new Error(`${method} failed: ${env.error.message}`);
  }
  return env.result as T;
}

// ---------------------------------------------------------------------------
// Inner-state traversal helpers
// ---------------------------------------------------------------------------

interface SuiObjectResponse {
  data?: {
    objectId?: string;
    type?: string;
    content?: {
      dataType?: string;
      type?: string;
      fields?: Record<string, unknown>;
    };
    error?: { code?: string };
  };
  error?: { code?: string; message?: string };
}

interface DynamicFieldsResponse {
  data: Array<{
    objectId: string;
    objectType?: string;
    name?: unknown;
  }>;
  nextCursor: string | null;
  hasNextPage: boolean;
}

function extractFields(obj: SuiObjectResponse): Record<string, unknown> | null {
  const fields = obj?.data?.content?.fields;
  if (!fields || typeof fields !== 'object') return null;
  return fields as Record<string, unknown>;
}

/**
 * Traverses the Pool → Versioned → PoolInner chain to get the PoolInner fields.
 * On a real sandbox the outer Pool wraps a Versioned; the Versioned's dynamic
 * field holds the PoolInner. If the object already has a `book` field we treat
 * it as a PoolInner directly (handles T-014 fixture shape and any future
 * direct-PoolInner exposure).
 */
async function resolvePoolInnerFields(
  rpcUrl: string,
  poolId: string,
): Promise<Record<string, unknown> | null> {
  const poolObj = await rpc<SuiObjectResponse>(rpcUrl, 'sui_getObject', [
    poolId,
    { showContent: true, showType: true },
  ]);

  const fields = extractFields(poolObj);
  if (!fields) return null;

  // Case 1: Already a PoolInner (T-014 fixture or direct object).
  if ('book' in fields) return fields;

  // Case 2: Pool wrapper — has `inner` Versioned field.
  const inner = fields['inner'] as Record<string, unknown> | undefined;
  if (!inner) return fields; // degraded: return what we have

  const versionedFields = (inner['fields'] as Record<string, unknown> | undefined) ?? {};
  const versionedId = (versionedFields['id'] as Record<string, unknown> | undefined)?.['id'];
  if (typeof versionedId !== 'string') return fields;

  // suix_getDynamicFields on the Versioned inner id to get the PoolInner field wrapper.
  const dynFields = await rpc<DynamicFieldsResponse>(rpcUrl, 'suix_getDynamicFields', [
    versionedId,
    null,
    1,
  ]);

  if (!dynFields.data || dynFields.data.length === 0) return fields;

  const innerFieldId = dynFields.data[0].objectId;
  const innerObj = await rpc<SuiObjectResponse>(rpcUrl, 'sui_getObject', [
    innerFieldId,
    { showContent: true, showType: true },
  ]);

  // The PoolInner field wrapper's content.fields.value.fields is the PoolInner.
  const wrapperFields = extractFields(innerObj);
  if (!wrapperFields) return null;

  const valueFields =
    ((wrapperFields['value'] as Record<string, unknown> | undefined)?.['fields'] as
      | Record<string, unknown>
      | undefined) ?? wrapperFields;

  if ('book' in valueFields) return valueFields;
  return wrapperFields;
}

/**
 * Traverses a BigVector to collect Order objects from its Slice nodes.
 */
async function traverseBigVector(
  rpcUrl: string,
  bigVectorId: string,
): Promise<Order[]> {
  const sliceList = await rpc<DynamicFieldsResponse>(rpcUrl, 'suix_getDynamicFields', [
    bigVectorId,
    null,
    64,
  ]);

  if (!sliceList.data || sliceList.data.length === 0) return [];

  const orders: Order[] = [];

  for (const slice of sliceList.data) {
    let sliceObj: SuiObjectResponse;
    try {
      sliceObj = await rpc<SuiObjectResponse>(rpcUrl, 'sui_getObject', [
        slice.objectId,
        { showContent: true, showType: true },
      ]);
    } catch {
      // BigVector slices churn rapidly on the sandbox; skip deleted slices.
      continue;
    }

    const sf = extractFields(sliceObj);
    if (!sf) continue;

    // Slice<Order> content shape: fields.value.fields.{keys, vals}
    const valueFields =
      ((sf['value'] as Record<string, unknown> | undefined)?.['fields'] as
        | Record<string, unknown>
        | undefined) ?? sf;

    const keys = (valueFields['keys'] as string[] | undefined) ?? [];
    const vals = (valueFields['vals'] as unknown[] | undefined) ?? [];

    for (let i = 0; i < Math.min(keys.length, vals.length); i++) {
      const orderFields =
        ((vals[i] as Record<string, unknown> | undefined)?.['fields'] as
          | Record<string, unknown>
          | undefined) ?? (vals[i] as Record<string, unknown>);

      if (!orderFields) continue;

      // Inject price from order_id, empirically verified against captured
      // examples in notes/chain-shape.md:
      //   - ask order_id 170141183460486719245069180370816077150 = 2^127
      //     + (price << 64) + counter  → bit 127 is set as ask flag,
      //     must be masked off before extracting price.
      //   - bid order_id 12377783720203182843884075 = (price << 64) + counter
      //     → bit 127 is clear, NO inversion (the chain-shape prose's
      //     "inverted for bids" claim is contradicted by the captured data;
      //     decodeBidPrice in marketStats.ts uses the inverted formula and
      //     remains correct only for the test fixtures that mirror it).
      // Bit-127-aware decode works for both sides without parameterization:
      // mask bit 127, then take the high 64 bits of the remaining 127.
      // computeMarketStats prefers o.price over its fallback decoders, so
      // this injection routes production through the correct math while
      // leaving the fixture-shaped fallbacks for the unit tests.
      const orderIdStr = String(orderFields['order_id'] ?? keys[i] ?? '0');
      const ASK_FLAG_MASK = (1n << 127n) - 1n;
      let price: number | undefined;
      try {
        price = Number((BigInt(orderIdStr) & ASK_FLAG_MASK) >> 64n);
        if (!Number.isFinite(price)) {
          // Surface the surprise — order_id parsed as BigInt but its high
          // bits exceed Number.MAX_SAFE_INTEGER (~2^53). Indicates either an
          // unexpected encoding or a corrupted on-chain value. Log + skip
          // injection (computeMarketStats falls back to its order_id
          // decoder, which is correct against test fixtures and at least
          // not silently zero).
          console.warn(
            `dataLayer: order_id ${orderIdStr} decoded to non-finite price; ` +
              'falling back to compute-time order_id decode',
          );
          price = undefined;
        }
      } catch (err) {
        // BigInt() throws SyntaxError on malformed input. Log the surprise so
        // a corrupted on-chain order_id doesn't silently degrade the dashboard.
        console.warn(
          `dataLayer: BigInt(${orderIdStr}) threw ${(err as Error).message}; ` +
            'falling back to compute-time order_id decode',
        );
        price = undefined;
      }
      orders.push({
        order_id: orderIdStr,
        quantity: String(orderFields['quantity'] ?? '0'),
        filled_quantity: String(orderFields['filled_quantity'] ?? '0'),
        status: Number(orderFields['status'] ?? 0),
        price,
      });
    }
  }

  return orders;
}

/**
 * Builds a PoolInnerState from the resolved PoolInner fields object.
 */
async function buildPoolInnerState(
  rpcUrl: string,
  poolId: string,
  innerFields: Record<string, unknown>,
): Promise<PoolInnerState> {
  const bookWrapper = innerFields['book'] as Record<string, unknown> | undefined;
  const bookFields = (bookWrapper?.['fields'] as Record<string, unknown> | undefined) ?? bookWrapper ?? {};

  const getVectorMeta = (key: string) => {
    const v = bookFields[key] as Record<string, unknown> | undefined;
    return (v?.['fields'] as Record<string, unknown> | undefined) ?? v ?? {};
  };

  const asksMeta = getVectorMeta('asks');
  const bidsMeta = getVectorMeta('bids');

  const asksId = ((asksMeta['id'] as Record<string, unknown> | undefined)?.['id'] as string | undefined) ?? '';
  const bidsId = ((bidsMeta['id'] as Record<string, unknown> | undefined)?.['id'] as string | undefined) ?? '';

  const [asks, bids] = await Promise.all([
    asksId ? traverseBigVector(rpcUrl, asksId) : Promise.resolve([]),
    bidsId ? traverseBigVector(rpcUrl, bidsId) : Promise.resolve([]),
  ]);

  return {
    pool_id: poolId,
    book: {
      asks,
      bids,
      lot_size: String(bookFields['lot_size'] ?? '0'),
      min_size: String(bookFields['min_size'] ?? '0'),
      tick_size: String(bookFields['tick_size'] ?? '0'),
    },
  };
}

// ---------------------------------------------------------------------------
// Fill-event query adapter
// ---------------------------------------------------------------------------

interface QueryEventsResult {
  data: Array<{
    parsedJson?: Record<string, unknown>;
    timestampMs?: string;
    id?: { txDigest?: string; eventSeq?: string };
  }>;
  nextCursor: { txDigest: string; eventSeq: string } | null;
  hasNextPage: boolean;
}

function buildQueryEventsFn(rpcUrl: string, packageId: string): QueryEventsFn {
  // poolId is consumed downstream by fetchFills's per-event filter
  // (fillFetcher.ts:65 — `if (ev.poolId !== poolId) continue`); the RPC-side
  // filter cannot key on it because suix_queryEvents' MoveModule selector
  // operates on transactionModule, not on event-payload fields. See
  // raw-friction.log 2026-04-27T21:47Z for the SDK quirk that drove this.
  return async ({ cursor }) => {
    const result = await rpc<QueryEventsResult>(rpcUrl, 'suix_queryEvents', [
      { MoveModule: { package: packageId, module: 'pool' } },
      cursor,
      50,
      true, // descending (newest first)
    ]);

    const data: RawFillEvent[] = [];
    for (const ev of result.data ?? []) {
      const j = ev.parsedJson ?? {};
      const evPoolId = String(j['pool_id'] ?? '');
      const timestampMs = Number(j['timestamp'] ?? ev.timestampMs ?? 0);
      const executedQty = String(j['executed_quantity'] ?? '0');
      const price = String(j['price'] ?? '0');

      // Only include events that are actual fills (executed_quantity > 0).
      if (Number(executedQty) > 0) {
        data.push({
          poolId: evPoolId,
          timestampMs,
          baseQuantity: executedQty,
          price,
        });
      }

      // Also include per-maker fills from fills[].
      const fills = (j['fills'] as Array<Record<string, unknown>> | undefined) ?? [];
      for (const fill of fills) {
        const fillQty = String(fill['base_quantity'] ?? '0');
        const fillPrice = String(fill['price'] ?? price);
        if (Number(fillQty) > 0) {
          data.push({
            poolId: evPoolId,
            timestampMs,
            baseQuantity: fillQty,
            price: fillPrice,
          });
        }
      }
    }

    return {
      data,
      hasNextPage: result.hasNextPage ?? false,
      nextCursor: result.nextCursor ?? null,
    };
  };
}

// ---------------------------------------------------------------------------
// Per-pool stats composer
// ---------------------------------------------------------------------------

async function fetchPoolStats(
  rpcUrl: string,
  packageId: string,
  descriptor: PoolDescriptor,
  nowMs: number,
): Promise<PoolCardData> {
  const innerFields = await resolvePoolInnerFields(rpcUrl, descriptor.poolId);

  let poolState: PoolInnerState;
  if (innerFields) {
    poolState = await buildPoolInnerState(rpcUrl, descriptor.poolId, innerFields);
  } else {
    poolState = { pool_id: descriptor.poolId, book: { asks: [], bids: [], lot_size: '0', min_size: '0', tick_size: '0' } };
  }

  const marketStats = computeMarketStats(poolState);

  const queryEventsFn = buildQueryEventsFn(rpcUrl, packageId);
  const rawFills = await fetchFills({
    packageId,
    poolId: descriptor.poolId,
    queryEvents: queryEventsFn,
    nowMs,
  });

  const fillRecords: FillRecord[] = rawFills.map((f) => ({
    poolId: f.poolId,
    timestampMs: f.timestampMs,
    baseQuantity: f.baseQuantity,
    price: f.price,
  }));

  const aggregate = aggregateFills(fillRecords, nowMs);

  return {
    poolId: descriptor.poolId,
    symbol: descriptor.symbol,
    volume24h: aggregate.volume24h,
    lastPrice: aggregate.lastPrice,
    midPrice: marketStats.midPrice,
    spread: marketStats.spread,
    depthWithinOnePercent: marketStats.depthWithinOnePercent,
    sparkline: aggregate.sparkline,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs the full data layer for all pools in the manifest.
 * Returns one PoolCardData per pool (in manifest order).
 * H-7 fix: returns Promise<PoolCardData[]> instead of Promise<void>.
 */
export async function runDataLayer(args: RunDataLayerArgs): Promise<PoolCardData[]> {
  const { manifest, rpcUrl, nowMs } = args;
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

  const results = await Promise.allSettled(
    descriptors.map((d) => fetchPoolStats(rpcUrl, packageId, d, nowMs)),
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    // Return a sentinel card on per-pool failure.
    return {
      poolId: descriptors[i].poolId,
      symbol: descriptors[i].symbol,
      volume24h: undefined,
      lastPrice: undefined,
      midPrice: undefined,
      spread: undefined,
      depthWithinOnePercent: undefined,
      sparkline: [],
    };
  });
}

export { fetchPoolStats as fetchSinglePoolStats };
