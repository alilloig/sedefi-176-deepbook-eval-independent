/**
 * Vault registry — VaultCreated event parser and in-memory registry.
 *
 * Covers AC3.8: the keeper discovers vaults by polling suix_queryEvents
 * for VaultCreated events emitted by the tpsl_vault package.
 *
 * The registry:
 *   - Parses raw event envelopes from suix_queryEvents into typed KnownVault records.
 *   - Deduplicates by vault_id (addOrUpdate returns wasNew flag).
 *   - Seeds the in-memory `triggered` flag from on-chain state via injected getObject.
 *   - Exposes markTriggered / isTriggered for in-process caching.
 */

// ============================================================================
// Types
// ============================================================================

/** Raw envelope from suix_queryEvents. */
export interface VaultCreatedEventEnvelope {
  id: { txDigest: string; eventSeq: string };
  packageId: string;
  transactionModule: string;
  sender: string;
  type: string;
  parsedJson: Record<string, unknown>;
  bcs: string;
  timestampMs: string;
}

/** Option<u64> as serialized by the Sui SDK from Move: { Some: "decimal" } | null */
type MoveOptionU64 = { Some: string } | null;

/** In-memory vault record. */
export interface KnownVault {
  vault_id: string;
  owner: string;
  pool_id: string;
  side: number;
  tp_price: bigint | null;
  sl_price: bigint | null;
  deposit_amount: bigint;
  triggered: boolean;
  /** Resolved from manifest at discovery time; may be absent if registry is used standalone. */
  baseCoinType?: string;
  quoteCoinType?: string;
}

// ============================================================================
// Event parser
// ============================================================================

function requireField<T>(obj: Record<string, unknown>, key: string): T {
  if (!(key in obj)) {
    throw new Error(`VaultCreated event missing required field: ${key}`);
  }
  return obj[key] as T;
}

function normalizeHex(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new Error(`Expected hex string, got ${typeof raw}`);
  }
  return raw.toLowerCase().startsWith('0x') ? raw.toLowerCase() : `0x${raw.toLowerCase()}`;
}

function parseOptionU64(raw: unknown): bigint | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === 'object' && raw !== null && 'Some' in raw) {
    const some = (raw as Record<string, unknown>).Some;
    if (some === undefined || some === null) return null;
    return BigInt(String(some));
  }
  // Treat any other falsy shape as None.
  return null;
}

/**
 * Parses a raw suix_queryEvents VaultCreated envelope into a KnownVault.
 *
 * Throws a descriptive error if any required field is absent from parsedJson.
 */
export function parseVaultCreatedEvent(envelope: VaultCreatedEventEnvelope): KnownVault {
  const pj = envelope.parsedJson;

  // Validate and extract all seven required fields.
  // requireField throws naming the missing key.
  const rawVaultId = requireField<unknown>(pj, 'vault_id');
  const rawOwner = requireField<unknown>(pj, 'owner');
  const rawPoolId = requireField<unknown>(pj, 'pool_id');
  const rawSide = requireField<unknown>(pj, 'side');
  const rawTpPrice = requireField<unknown>(pj, 'tp_price');
  const rawSlPrice = requireField<unknown>(pj, 'sl_price');
  const rawDepositAmount = requireField<unknown>(pj, 'deposit_amount');

  return {
    vault_id: normalizeHex(rawVaultId),
    owner: normalizeHex(rawOwner),
    pool_id: normalizeHex(rawPoolId),
    side: Number(rawSide),
    tp_price: parseOptionU64(rawTpPrice),
    sl_price: parseOptionU64(rawSlPrice),
    deposit_amount: BigInt(String(rawDepositAmount)),
    triggered: false,
  };
}

// ============================================================================
// Registry class
// ============================================================================

/** getObject dependency type — injected so the registry has no I/O of its own. */
export type GetObjectFn = (id: string) => Promise<{
  data?: {
    objectId?: string;
    content?: {
      dataType?: string;
      fields?: Record<string, unknown>;
    };
  } | null;
}>;

export class VaultRegistry {
  private readonly vaults: Map<string, KnownVault> = new Map();

  /**
   * Inserts or updates the vault record. Returns { wasNew } to indicate
   * whether this vault_id was previously unknown.
   */
  addOrUpdate(vault: KnownVault): { wasNew: boolean } {
    const id = vault.vault_id;
    const wasNew = !this.vaults.has(id);
    if (!wasNew) {
      // Preserve triggered flag from existing entry.
      const existing = this.vaults.get(id)!;
      this.vaults.set(id, { ...vault, triggered: existing.triggered });
    } else {
      this.vaults.set(id, { ...vault });
    }
    return { wasNew };
  }

  /** Iterates all known vaults (triggered or not). */
  iterate(): IterableIterator<KnownVault> {
    return this.vaults.values();
  }

  /** Current number of known vaults. */
  size(): number {
    return this.vaults.size;
  }

  /**
   * Seeds the in-memory `triggered` flag from on-chain state.
   * Issues exactly one getObject call. If the object is missing or
   * the triggered field is non-boolean, logs a warning and leaves
   * the in-memory flag unchanged (defaults to false).
   */
  async seedTriggeredFromChain(vaultId: string, getObject: GetObjectFn): Promise<void> {
    const result = await getObject(vaultId);
    const content = result?.data?.content;
    if (!content || content.dataType !== 'moveObject' || !content.fields) {
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'warn',
          event: 'seed_triggered_warning',
          vault_id: vaultId,
          message: 'getObject returned missing or malformed content; leaving triggered=false',
        }),
      );
      return;
    }
    const triggered = content.fields['triggered'];
    if (typeof triggered !== 'boolean') {
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'warn',
          event: 'seed_triggered_warning',
          vault_id: vaultId,
          message: `triggered field is non-boolean (${typeof triggered}); leaving flag unchanged`,
        }),
      );
      return;
    }
    const vault = this.vaults.get(vaultId);
    if (vault) {
      vault.triggered = triggered;
    }
  }

  /** Sets the triggered flag for a known vault. */
  markTriggered(vaultId: string): void {
    const vault = this.vaults.get(vaultId);
    if (vault) {
      vault.triggered = true;
    }
  }

  /** Returns the current triggered flag for a known vault (false if unknown). */
  isTriggered(vaultId: string): boolean {
    return this.vaults.get(vaultId)?.triggered ?? false;
  }
}
