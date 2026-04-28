/**
 * Keeper entry point.
 *
 * Exposes `runOnePollCycle` as a test seam for network-shape validation (T-009).
 * When the optional `submitter` argument is provided, trigger transactions are
 * built and submitted; when absent (T-009 test seam), submission is skipped.
 *
 * At runtime, starts two concurrent loops:
 *   1. Vault discovery loop: polls suix_queryEvents for VaultCreated events.
 *   2. Price + trigger loop: reads Pyth prices and evaluates trigger conditions.
 *
 * All outbound HTTP goes to the configured rpcUrl (JSON-RPC raw fetch per
 * the Cycle 1 proven pattern — no @mysten/deepbook-v3 dependency per AC3.7).
 */

import { VaultRegistry, parseVaultCreatedEvent } from './vaultRegistry.js';
import { readPriceFromChain, parsePriceFromBcs } from './pythReader.js';
import { calculateBaseQuotePrice } from './priceModel.js';
import { evaluateTrigger } from './triggerEvaluator.js';
import { buildTriggerTransaction, signAndSubmitTrigger } from './triggerSubmitter.js';
import {
  logKeeperStarted,
  logVaultDiscovered,
  logPollCycle,
  logTriggerAttempt,
  logTriggerFired,
  logTriggerFailed,
  logPythReadFailed,
  logKeeperShutdown,
} from './logger.js';
import { loadConfig } from './config.js';

// ============================================================================
// Manifest types
// ============================================================================

export interface PoolEntry {
  poolId: string;
  baseCoinType: string;
  quoteCoinType: string;
  baseDecimals?: number;
  quoteDecimals?: number;
  /** objectId of the PriceInfoObject for the base coin */
  basePriceInfoObjectId?: string;
  /** objectId of the PriceInfoObject for the quote coin */
  quotePriceInfoObjectId?: string;
}

export interface SandboxManifest {
  network: {
    type: string;
    rpcUrl: string;
    faucetUrl?: string;
  };
  packages: {
    deepbook?: { packageId: string; objects?: unknown[] };
    pyth?: { packageId: string; objects?: unknown[] };
    token?: { packageId: string; objects?: unknown[] };
  };
  pythOracles: {
    deepPriceInfoObjectId: string;
    suiPriceInfoObjectId: string;
  };
  pools?: Record<string, PoolEntry>;
}

// ============================================================================
// Manifest helpers — resolves pool_id → coin types, decimals, oracle IDs
// ============================================================================

/**
 * Looks up a vault's pool_id in manifest.pools and returns the matching entry.
 * Returns undefined if no matching pool is found.
 */
export function resolvePoolEntry(
  manifest: SandboxManifest,
  poolId: string,
): PoolEntry | undefined {
  if (!manifest.pools) return undefined;
  const normalizedId = poolId.toLowerCase();
  for (const entry of Object.values(manifest.pools)) {
    if (entry.poolId.toLowerCase() === normalizedId) {
      return entry;
    }
  }
  return undefined;
}

/**
 * Builds a coin-type → PriceInfoObjectId map from the manifest.
 * Handles the DEEP and SUI standard mappings; can be extended for other coins.
 */
export function buildCoinTypeOracleMap(manifest: SandboxManifest): Map<string, string> {
  const map = new Map<string, string>();
  const tokenPkgId = manifest.packages.token?.packageId;
  if (tokenPkgId && manifest.pythOracles.deepPriceInfoObjectId) {
    // DEEP coin type varies by token package
    map.set(`${tokenPkgId}::deep::DEEP`, manifest.pythOracles.deepPriceInfoObjectId);
  }
  // SUI — standard address
  if (manifest.pythOracles.suiPriceInfoObjectId) {
    map.set(
      '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
      manifest.pythOracles.suiPriceInfoObjectId,
    );
  }
  return map;
}

// ============================================================================
// Submitter type (optional — absent in T-009 test seam path)
// ============================================================================

export interface TriggerSubmitter {
  signer: {
    sign: (bytes: Uint8Array) => Promise<string>;
    address: string;
    publicKeyBase64: string;
  };
  packageId: string;
  deepCoinId: string;
  deepPerTrigger: bigint;
}

// ============================================================================
// runOnePollCycle — test seam (T-009)
// ============================================================================

export interface PollCycleArgs {
  manifest: SandboxManifest;
  tpslVaultPackageId: string;
  deepCoinId: string;
  pollIntervalMs: number;
  registry?: VaultRegistry;
  /** Optional: cursor for event polling (updated in place). */
  cursorRef?: { cursor: string | null };
  /**
   * Optional submitter. When provided, buildTriggerTransaction + signAndSubmitTrigger
   * are called for vaults whose trigger condition fires.
   * When absent (T-009 test seam), submission is skipped.
   */
  submitter?: TriggerSubmitter;
}

/**
 * Runs one combined vault-discovery + price-poll tick.
 * Used as a test seam by T-009 and internally by the main poll loop.
 *
 * Outbound HTTP:
 *   - suix_queryEvents (vault discovery) → rpcUrl
 *   - sui_getObject + sui_devInspectTransactionBlock (price reads) → rpcUrl
 *
 * Never calls DeepBook indexer routes (AC3.7 — no @mysten/deepbook-v3 dep).
 */
export async function runOnePollCycle(args: PollCycleArgs): Promise<void> {
  const { manifest, tpslVaultPackageId, submitter, registry: externalRegistry } = args;
  const rpcUrl = manifest.network.rpcUrl;
  const pythPkgId = manifest.packages.pyth?.packageId ?? '';

  const registry = externalRegistry ?? new VaultRegistry();
  const cursorRef = args.cursorRef ?? { cursor: null };

  // Build coin-type → oracle map once per tick
  const coinTypeOracleMap = buildCoinTypeOracleMap(manifest);

  // --- 1. Vault discovery tick (suix_queryEvents) ---
  try {
    await discoverVaultsTick(registry, rpcUrl, tpslVaultPackageId, cursorRef, manifest, coinTypeOracleMap);
  } catch (err) {
    // Non-fatal: log structured error and continue to price tick.
    logPythReadFailed({ object_id: 'vault_discovery', error: String(err) });
  }

  // --- 2. Price + trigger tick ---
  // Collect all unique oracle object IDs we need prices for.
  const oracleObjectIds = new Set<string>();
  oracleObjectIds.add(manifest.pythOracles.deepPriceInfoObjectId);
  oracleObjectIds.add(manifest.pythOracles.suiPriceInfoObjectId);

  const priceResults: Array<{
    object_id: string;
    magnitude: string;
    exponent: string;
    parsed?: ReturnType<typeof parsePriceFromBcs>;
  }> = [];

  for (const objectId of oracleObjectIds) {
    if (!objectId) continue;
    try {
      const price = await readPriceFromChain({
        pythPackageId: pythPkgId,
        priceInfoObjectId: objectId,
        rpcUrl,
      });
      priceResults.push({
        object_id: objectId,
        magnitude: price.magnitude.toString(),
        exponent: price.exponent.toString(),
        parsed: price,
      });
    } catch (err) {
      logPythReadFailed({ object_id: objectId, error: String(err) });
    }
  }

  logPollCycle({
    prices: priceResults.map((p) => ({
      object_id: p.object_id,
      magnitude: p.magnitude,
      exponent: p.exponent,
    })),
    known_vault_count: registry.size(),
  });

  // --- 3. Trigger evaluation (no-op if no vaults or no prices) ---
  if (priceResults.length === 0) return;

  // Build price map by oracle object id.
  const priceByObjectId = new Map(
    priceResults.filter((p) => p.parsed).map((p) => [p.object_id, p.parsed!]),
  );

  for (const vault of registry.iterate()) {
    if (!vault.baseCoinType || !vault.quoteCoinType) continue;

    // Resolve per-vault oracle IDs from the coin-type map.
    const basePriceObjectId = coinTypeOracleMap.get(vault.baseCoinType);
    const quotePriceObjectId = coinTypeOracleMap.get(vault.quoteCoinType);

    // Resolve quoteDecimals from stored vault field or fallback.
    const quoteDecimals = vault.quoteDecimals ?? 9;

    const baseP = basePriceObjectId ? priceByObjectId.get(basePriceObjectId) : undefined;
    const quoteP = quotePriceObjectId ? priceByObjectId.get(quotePriceObjectId) : undefined;
    if (!baseP || !quoteP) continue;

    let currentPrice: bigint;
    try {
      currentPrice = calculateBaseQuotePrice({
        baseMagnitude: baseP.magnitude,
        baseExponent: baseP.exponent,
        quoteMagnitude: quoteP.magnitude,
        quoteExponent: quoteP.exponent,
        quoteDecimals,
      });
    } catch {
      continue;
    }

    const evaluation = evaluateTrigger(vault, currentPrice);
    if (!evaluation.shouldFire || evaluation.reason === 'none' || evaluation.reason === 'already_triggered') {
      continue;
    }

    // Fire the trigger.
    logTriggerAttempt({
      vault_id: vault.vault_id,
      current_price: currentPrice.toString(),
      reason: evaluation.reason as 'tp' | 'sl',
    });

    // Submit trigger if submitter is provided (production path).
    // When submitter is absent (T-009 test seam), we skip submission.
    if (!submitter) continue;

    if (!vault.baseCoinType || !vault.quoteCoinType) continue;

    const tx = buildTriggerTransaction({
      tpslVaultPackageId: submitter.packageId,
      vault: vault as typeof vault & { baseCoinType: string; quoteCoinType: string },
      poolId: vault.pool_id,
      currentPrice,
      deepCoinId: submitter.deepCoinId,
      deepPerTrigger: submitter.deepPerTrigger,
    });

    try {
      const result = await signAndSubmitTrigger({
        tx,
        rpcUrl,
        signer: submitter.signer,
      });

      registry.markTriggered(vault.vault_id);

      logTriggerFired({
        vault_id: vault.vault_id,
        current_price: currentPrice.toString(),
        tx_digest: result.txDigest,
        quote_out_amount: result.triggerFired?.quote_out_amount ?? '0',
        base_residual_amount: result.triggerFired?.base_residual_amount ?? '0',
        deep_residual_amount: result.triggerFired?.deep_residual_amount ?? '0',
      });
    } catch (err) {
      const errStr = String(err);
      // Try to parse abort code from error message.
      const abortMatch = errStr.match(/MoveAbort.*?(\d+)/);
      const abortCode = abortMatch ? abortMatch[1] : errStr;

      logTriggerFailed({
        vault_id: vault.vault_id,
        current_price: currentPrice.toString(),
        tx_digest_or_null: null,
        abort_code_or_message: abortCode,
      });
    }
  }
}

// ============================================================================
// Vault discovery helper
// ============================================================================

async function discoverVaultsTick(
  registry: VaultRegistry,
  rpcUrl: string,
  tpslVaultPackageId: string,
  cursorRef: { cursor: string | null },
  manifest: SandboxManifest,
  coinTypeOracleMap: Map<string, string>,
): Promise<void> {
  // Per Cycle 1 friction-log 2026-04-27T21:47:00Z and R1-001/R2-006:
  // suix_queryEvents JSON-RPC positional params: [query, cursor, limit, descending]
  const params: unknown[] = [
    { MoveModule: { package: tpslVaultPackageId, module: 'tpsl_vault' } },
    cursorRef.cursor,
    50,
    false,
  ];

  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'suix_queryEvents',
      params,
    }),
  });

  const json = (await resp.json()) as {
    result?: {
      data: unknown[];
      nextCursor: string | null;
      hasNextPage: boolean;
    };
    error?: { message?: string };
  };

  if (json.error) {
    throw new Error(`suix_queryEvents error: ${json.error.message ?? JSON.stringify(json.error)}`);
  }

  const data = json.result?.data ?? [];

  for (const evt of data) {
    try {
      const raw = evt as {
        type?: string;
        parsedJson?: Record<string, unknown>;
        id?: { txDigest: string; eventSeq: string };
        packageId?: string;
        transactionModule?: string;
        sender?: string;
        bcs?: string;
        timestampMs?: string;
      };

      // Only process VaultCreated events.
      if (!raw.type?.endsWith('::tpsl_vault::VaultCreated')) continue;

      const envelope = {
        id: raw.id ?? { txDigest: '', eventSeq: '0' },
        packageId: raw.packageId ?? '',
        transactionModule: raw.transactionModule ?? '',
        sender: raw.sender ?? '',
        type: raw.type ?? '',
        parsedJson: raw.parsedJson ?? {},
        bcs: raw.bcs ?? '',
        timestampMs: raw.timestampMs ?? '0',
      };

      const vault = parseVaultCreatedEvent(envelope);

      // Resolve baseCoinType / quoteCoinType / quoteDecimals from manifest pools.
      // This is required so the trigger loop's coin-type guards pass (R1-002, R2-002).
      const poolEntry = resolvePoolEntry(manifest, vault.pool_id);
      if (poolEntry) {
        vault.baseCoinType = poolEntry.baseCoinType;
        vault.quoteCoinType = poolEntry.quoteCoinType;
        vault.quoteDecimals = poolEntry.quoteDecimals;
      }

      const { wasNew } = registry.addOrUpdate(vault);

      if (wasNew) {
        logVaultDiscovered({
          vault_id: vault.vault_id,
          owner: vault.owner,
          pool_id: vault.pool_id,
          side: vault.side,
          tp_price: vault.tp_price !== null ? vault.tp_price.toString() : null,
          sl_price: vault.sl_price !== null ? vault.sl_price.toString() : null,
        });
      }
    } catch (err) {
      // Log parse failures so the operator can diagnose schema drift.
      logPythReadFailed({
        object_id: 'vault_parse',
        error: `VaultCreated event parse failed: ${String(err)}`,
      });
    }
  }

  // Always update cursor (including when nextCursor is null — signals caught up to head).
  if (json.result !== undefined) {
    cursorRef.cursor = json.result.nextCursor;
  }
}

// ============================================================================
// Main boot (only runs when executed directly)
// ============================================================================

async function main(): Promise<void> {
  const config = loadConfig(process.env as Record<string, string | undefined>);

  // Read the sandbox manifest.
  const fs = await import('fs');
  const manifestRaw = fs.readFileSync(config.sandboxManifestPath, 'utf-8');
  const manifest = JSON.parse(manifestRaw) as SandboxManifest;

  const rpcUrl = manifest.network.rpcUrl;

  // Generate ephemeral Ed25519 keypair.
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
  const keypair = new Ed25519Keypair();
  const keeperAddress = keypair.getPublicKey().toSuiAddress();

  logKeeperStarted({
    keeper_address: keeperAddress,
    tpsl_vault_package_id: config.tpslVaultPackageId,
    poll_interval_ms: config.pollIntervalMs,
  });

  const registry = new VaultRegistry();
  const cursorRef = { cursor: null as string | null };

  // Build submitter for production trigger submission.
  const submitter: TriggerSubmitter = {
    signer: {
      sign: async (bytes: Uint8Array) => {
        const { Signer } = await import('@mysten/sui/cryptography');
        void Signer; // SDK 2.x: keypair.sign returns base64 sig
        const sig = await keypair.sign(bytes);
        return Buffer.from(sig).toString('base64');
      },
      address: keeperAddress,
      publicKeyBase64: keypair.getPublicKey().toBase64(),
    },
    packageId: config.tpslVaultPackageId,
    deepCoinId: config.deepCoinId,
    deepPerTrigger: config.deepPerTrigger,
  };

  // Seed triggered flags for known vaults via on-chain read.
  // Runs after the first discovery tick in the main loop below.
  let firstTickDone = false;

  // Helper to do a getObject call for seeding.
  const getObjectForSeed = async (id: string) => {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sui_getObject',
        params: [id, { showContent: true }],
      }),
    });
    const json = (await resp.json()) as {
      result?: {
        data?: {
          objectId?: string;
          content?: {
            dataType?: string;
            fields?: Record<string, unknown>;
          };
        } | null;
      };
    };
    return json.result ?? { data: null };
  };

  // Signal handlers.
  let running = true;
  const shutdown = (signal: string) => {
    running = false;
    logKeeperShutdown({ signal });
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Main poll loop.
  while (running) {
    try {
      await runOnePollCycle({
        manifest,
        tpslVaultPackageId: config.tpslVaultPackageId,
        deepCoinId: config.deepCoinId,
        pollIntervalMs: config.pollIntervalMs,
        registry,
        cursorRef,
        submitter,
      });

      // After the first tick, seed triggered flags from chain for all known vaults.
      // This prevents retry-after-fire when the keeper restarts.
      if (!firstTickDone) {
        firstTickDone = true;
        for (const vault of registry.iterate()) {
          await registry.seedTriggeredFromChain(vault.vault_id, getObjectForSeed);
        }
      }
    } catch (err) {
      process.stderr.write(`poll cycle error: ${String(err)}\n`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

// Only run main when this module is the entry point.
// In ESM, `import.meta.url` tells us if we're the main module.
const isMain =
  typeof process !== 'undefined' &&
  typeof import.meta !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMain) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
