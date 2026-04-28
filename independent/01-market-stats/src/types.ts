/**
 * Slot 1 chain-shape derived types — single source of truth.
 *
 * All field names below are derived empirically from the capture in
 * `independent/01-market-stats/notes/chain-shape.md` (G-PoolShape artifact).
 * Do NOT rename fields from training memory; if the sandbox shape drifts,
 * re-capture chain-shape.md first and update these types from there.
 *
 * This file is the authoritative home for:
 *   - Deployment manifest types (DeploymentManifest, ManifestPoolEntry,
 *     PoolDescriptor, LoadedManifest)
 *   - Chain-object types (PoolInnerState, Book, BigVectorMeta, SliceOrder, Order)
 *   - Event types (RawOrderInfoEvent, RawFillEntry)
 *   - UI aggregate types (PoolCardData)
 *
 * Consumers in src/ import from here; the node-fs loader (manifest.ts) and
 * the browser fetch loader (main.tsx) both delegate to parseManifest().
 */

// ---------------------------------------------------------------------------
// Deployment manifest
// ---------------------------------------------------------------------------

export interface ManifestPoolEntry {
  poolId: string;
  baseCoinType: string;
  quoteCoinType: string;
}

export interface DeploymentManifest {
  network?: { type?: string; rpcUrl?: string };
  packages?: { deepbook?: { packageId?: string } };
  pools?: Record<string, ManifestPoolEntry>;
}

export interface PoolDescriptor {
  symbol: string;
  poolId: string;
  baseCoinType: string;
  quoteCoinType: string;
}

export interface LoadedManifest {
  deepbookPackageId: string;
  pools: PoolDescriptor[];
}

// ---------------------------------------------------------------------------
// Chain object shapes — derived from notes/chain-shape.md Step 3 / Step 4
// ---------------------------------------------------------------------------

/** From chain-shape.md: content.fields.value.fields.book.fields.asks|bids.fields */
export interface BigVectorMeta {
  id: { id: string };
  length: string;
  root_id: string;
  max_slice_size: string;
}

/**
 * Order struct shape from Slice<Order> content — see chain-shape.md Step 4.
 *
 * `price` is NOT on the chain Order struct; it is injected by the data layer
 * from the corresponding OrderInfo event payload to avoid order_id bit-decode
 * errors on bid orders (see chain-shape.md "Critical decoding note").
 */
export interface Order {
  order_id: string;
  quantity: string;
  filled_quantity: string;
  status: number;
  /** Injected from companion OrderInfo/OrderPlaced event. Preferred over order_id decode. */
  price?: number;
}

export interface Book {
  asks: Order[];
  bids: Order[];
  lot_size: string;
  min_size: string;
  tick_size: string;
}

export interface PoolInnerState {
  pool_id: string;
  book: Book;
}

// ---------------------------------------------------------------------------
// Event shapes — derived from notes/chain-shape.md Fill Event Sample
// ---------------------------------------------------------------------------

/** Per-maker fill entry inside OrderInfo.fills[] */
export interface RawFillEntry {
  maker_order_id: string;
  taker_is_bid: boolean;
  base_quantity: string;
  quote_quantity: string;
  price: string;
  expired: boolean;
  completed: boolean;
}

/** Top-level OrderInfo event parsedJson — see chain-shape.md */
export interface RawOrderInfoEvent {
  pool_id: string;
  order_id: string;
  is_bid: boolean;
  price: string;
  executed_quantity: string;
  cumulative_quote_quantity: string;
  fills: RawFillEntry[];
  timestamp: string;
}
