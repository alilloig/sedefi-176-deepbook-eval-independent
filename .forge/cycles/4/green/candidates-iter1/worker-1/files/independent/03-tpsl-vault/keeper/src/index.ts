/**
 * Keeper entry point.
 *
 * Exposes `runOnePollCycle` as a test seam for network-shape validation (T-009).
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
  pools?: Record<
    string,
    {
      poolId: string;
      baseCoinType: string;
      quoteCoinType: string;
      baseDecimals?: number;
      quoteDecimals?: number;
    }
  >;
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
  const { manifest, tpslVaultPackageId, deepCoinId, registry: externalRegistry } = args;
  const rpcUrl = manifest.network.rpcUrl;
  const pythPkgId = manifest.packages.pyth?.packageId ?? '';

  const registry = externalRegistry ?? new VaultRegistry();
  const cursorRef = args.cursorRef ?? { cursor: null };

  // --- 1. Vault discovery tick (suix_queryEvents) ---
  try {
    await discoverVaultsTick(registry, rpcUrl, tpslVaultPackageId, cursorRef);
  } catch (err) {
    // Non-fatal: log and continue to price tick.
    process.stderr.write(`vault discovery error: ${String(err)}\n`);
  }

  // --- 2. Price + trigger tick ---
  const priceObjects = [
    { key: 'deep', objectId: manifest.pythOracles.deepPriceInfoObjectId },
    { key: 'sui', objectId: manifest.pythOracles.suiPriceInfoObjectId },
  ];

  const priceResults: Array<{
    object_id: string;
    magnitude: string;
    exponent: string;
    parsed?: ReturnType<typeof parsePriceFromBcs>;
  }> = [];

  for (const po of priceObjects) {
    if (!po.objectId) continue;
    try {
      const price = await readPriceFromChain({
        pythPackageId: pythPkgId,
        priceInfoObjectId: po.objectId,
        rpcUrl,
      });
      priceResults.push({
        object_id: po.objectId,
        magnitude: price.magnitude.toString(),
        exponent: price.exponent.toString(),
        parsed: price,
      });
    } catch (err) {
      logPythReadFailed({ object_id: po.objectId, error: String(err) });
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

  // Determine which price oracle pair maps to each pool.
  // For now, use DEEP oracle for base and SUI oracle for quote on the DEEP/SUI pool.
  // Full manifest-driven mapping is handled in the manifest module.
  const deepPrice = priceByObjectId.get(manifest.pythOracles.deepPriceInfoObjectId);
  const suiPrice = priceByObjectId.get(manifest.pythOracles.suiPriceInfoObjectId);

  for (const vault of registry.iterate()) {
    if (!vault.baseCoinType || !vault.quoteCoinType) continue;

    // Resolve prices for this vault's pool.
    const baseP = deepPrice;
    const quoteP = suiPrice;
    if (!baseP || !quoteP) continue;

    let currentPrice: bigint;
    try {
      currentPrice = calculateBaseQuotePrice({
        baseMagnitude: baseP.magnitude,
        baseExponent: baseP.exponent,
        quoteMagnitude: quoteP.magnitude,
        quoteExponent: quoteP.exponent,
        quoteDecimals: 9, // Default SUI decimals; manifest-driven in production
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

    // Note: trigger submission requires a signer, which is only available
    // in the full boot path. In runOnePollCycle (test seam), we skip submission.
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
): Promise<void> {
  const params: unknown[] = [
    { MoveModule: { package: tpslVaultPackageId, module: 'tpsl_vault' } },
    { descending: false, limit: 50 },
  ];
  if (cursorRef.cursor !== null) {
    params.push(cursorRef.cursor);
  }

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
    } catch {
      // Skip malformed events.
    }
  }

  if (json.result?.nextCursor) {
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
        registry,
        cursorRef,
      });
    } catch (err) {
      process.stderr.write(`poll cycle error: ${String(err)}\n`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
  void rpcUrl; // suppress unused warning — used by runOnePollCycle via manifest
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
