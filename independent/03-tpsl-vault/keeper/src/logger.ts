/**
 * Line-delimited JSON logger.
 *
 * Every call emits exactly one JSON object terminated by '\n' to process.stdout.
 * Minimum field set on every line: { ts, level, event, ...event-specific fields }.
 *
 * Secret redaction: fields named 'secretKey', 'privateKey', or 'seed' are
 * NEVER serialized, even if present in input records (defense-in-depth per
 * spec "never logged in full" rule for the ephemeral keypair).
 *
 * AC3.11 logging contract.
 */

/** Baseline fields on every log line. */
interface BaseLog {
  ts: string;
  level: 'info' | 'warn' | 'error';
  event: string;
}

const SECRET_KEYS = new Set(['secretKey', 'privateKey', 'seed']);

function buildLine(level: 'info' | 'warn' | 'error', event: string, extra: Record<string, unknown>): string {
  const base: BaseLog = {
    ts: new Date().toISOString(),
    level,
    event,
  };

  // Merge, excluding secret keys from both base and extra.
  const merged: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (!SECRET_KEYS.has(k)) {
      merged[k] = v;
    }
  }

  return JSON.stringify(merged) + '\n';
}

function emit(level: 'info' | 'warn' | 'error', event: string, extra: Record<string, unknown>): void {
  process.stdout.write(buildLine(level, event, extra));
}

// ============================================================================
// AC3.11 event emitters
// ============================================================================

export function logKeeperStarted(args: {
  keeper_address: string;
  tpsl_vault_package_id: string;
  poll_interval_ms: number;
}): void {
  emit('info', 'keeper_started', { ...args });
}

export function logVaultDiscovered(args: {
  vault_id: string;
  owner: string;
  pool_id: string;
  side: number;
  tp_price: string | null;
  sl_price: string | null;
}): void {
  emit('info', 'vault_discovered', args as unknown as Record<string, unknown>);
}

export function logPollCycle(args: {
  prices: Array<{ object_id: string; magnitude: string; exponent: string }>;
  known_vault_count: number;
}): void {
  emit('info', 'poll_cycle', args as unknown as Record<string, unknown>);
}

export function logTriggerAttempt(args: {
  vault_id: string;
  current_price: string;
  reason: 'tp' | 'sl';
}): void {
  emit('info', 'trigger_attempt', args as unknown as Record<string, unknown>);
}

export function logTriggerFired(args: {
  vault_id: string;
  current_price: string;
  tx_digest: string;
  quote_out_amount: string;
  base_residual_amount: string;
  deep_residual_amount: string;
}): void {
  emit('info', 'trigger_fired', args as unknown as Record<string, unknown>);
}

export function logTriggerFailed(args: {
  vault_id: string;
  current_price: string;
  tx_digest_or_null: string | null;
  abort_code_or_message: string;
}): void {
  emit('warn', 'trigger_failed', args as unknown as Record<string, unknown>);
}

export function logPythReadFailed(args: { object_id: string; error: string }): void {
  emit('warn', 'pyth_read_failed', args as unknown as Record<string, unknown>);
}

export function logKeeperShutdown(args: { signal: string }): void {
  emit('info', 'keeper_shutdown', args as unknown as Record<string, unknown>);
}
