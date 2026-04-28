/**
 * Config — env var parsing and validation.
 *
 * Pure function: accepts a plain Record<string, string | undefined> (no
 * internal process.env reads), returns a validated Config or throws an
 * actionable error naming the offending env var.
 *
 * AC3.9: KEEPER_POLL_INTERVAL_MS must be in the closed range [5000, 10000].
 * AC3.10: TPSL_VAULT_PACKAGE_ID must be a 0x-prefixed 66-char hex string.
 * Per contract decision #2: KEEPER_DEEP_COIN_ID is required (halt-boot).
 */

export interface Config {
  /** Sui RPC URL (from manifest at boot; not parsed by config itself). */
  rpcUrl?: string;
  /** Poll interval in ms; default 5000; must be in [5000, 10000]. */
  pollIntervalMs: number;
  /** The tpsl_vault package ID (0x-prefixed 66-char hex). */
  tpslVaultPackageId: string;
  /** The pre-funded DEEP coin object ID (0x-prefixed 66-char hex). */
  deepCoinId: string;
  /** DEEP atomic units to split per trigger (default 100_000_000 = 1 DEEP). */
  deepPerTrigger: bigint;
  /** Log level gate; default 'info'. */
  logLevel: string;
  /** Path to the sandbox deployment manifest JSON. */
  sandboxManifestPath: string;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;
const MIN_POLL_MS = 5000;
const MAX_POLL_MS = 10000;

/** Validates a 0x-prefixed 66-character hex string. */
function isValidSuiId(val: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(val);
}

/**
 * Loads and validates configuration from the supplied env-like map.
 * Throws on any validation failure with an actionable message.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // --- KEEPER_POLL_INTERVAL_MS ---
  let pollIntervalMs: number;
  const rawInterval = env['KEEPER_POLL_INTERVAL_MS'];
  if (rawInterval === undefined || rawInterval === '') {
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  } else {
    const parsed = Number(rawInterval);
    if (!Number.isInteger(parsed) || parsed < MIN_POLL_MS || parsed > MAX_POLL_MS) {
      throw new Error(
        `KEEPER_POLL_INTERVAL_MS must be an integer in [${MIN_POLL_MS}, ${MAX_POLL_MS}], got: ${JSON.stringify(rawInterval)}`,
      );
    }
    pollIntervalMs = parsed;
  }

  // --- TPSL_VAULT_PACKAGE_ID ---
  const rawPkgId = env['TPSL_VAULT_PACKAGE_ID'];
  if (!rawPkgId || !isValidSuiId(rawPkgId)) {
    throw new Error(
      `TPSL_VAULT_PACKAGE_ID must be a 0x-prefixed 66-character hex string, got: ${JSON.stringify(rawPkgId)}`,
    );
  }

  // --- KEEPER_DEEP_COIN_ID ---
  const rawDeepCoinId = env['KEEPER_DEEP_COIN_ID'];
  if (!rawDeepCoinId || !isValidSuiId(rawDeepCoinId)) {
    throw new Error(
      `KEEPER_DEEP_COIN_ID must be a 0x-prefixed 66-character hex string, got: ${JSON.stringify(rawDeepCoinId)}`,
    );
  }

  // --- KEEPER_DEEP_PER_TRIGGER (optional, default 100_000_000) ---
  const rawDeepPerTrigger = env['KEEPER_DEEP_PER_TRIGGER'];
  const deepPerTrigger =
    rawDeepPerTrigger !== undefined && rawDeepPerTrigger !== ''
      ? BigInt(rawDeepPerTrigger)
      : 100_000_000n;

  return {
    pollIntervalMs,
    tpslVaultPackageId: rawPkgId,
    deepCoinId: rawDeepCoinId,
    deepPerTrigger,
    logLevel: env['KEEPER_LOG_LEVEL'] ?? 'info',
    sandboxManifestPath:
      env['SANDBOX_MANIFEST_PATH'] ??
      `${process.env['HOME'] ?? '/root'}/workspace/deepbook-sandbox/sandbox/deployments/localnet.json`,
  };
}
