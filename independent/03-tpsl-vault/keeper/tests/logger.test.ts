/**
 * T-007 — line-delimited JSON logger.
 *
 * Spies on process.stdout.write to capture each log line, parses it, and
 * asserts:
 *   (1) exactly one well-formed JSON object per call, terminated by '\n';
 *   (2) the five baseline keys (ts, level, event, plus event-specific
 *       AC3.11 fields);
 *   (3) ts matches the ISO-8601 UTC regex;
 *   (4) keys named secretKey / privateKey / seed are NEVER serialized
 *       (defense-in-depth against the spec's "never logged in full" rule
 *       for the ephemeral keypair).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  logKeeperStarted,
  logVaultDiscovered,
  logPollCycle,
  logTriggerAttempt,
  logTriggerFired,
  logTriggerFailed,
  logPythReadFailed,
  logKeeperShutdown,
} from '../src/logger.js';

// --- stdout.write spy --------------------------------------------------------

let captured: string[] = [];
let realWrite: typeof process.stdout.write;

beforeEach(() => {
  captured = [];
  realWrite = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = vi.fn((chunk: any, ...rest: any[]) => {
    if (typeof chunk === 'string') captured.push(chunk);
    else if (chunk instanceof Uint8Array) captured.push(Buffer.from(chunk).toString('utf8'));
    // emulate the real signature's success return
    return true;
  }) as unknown as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = realWrite;
});

const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function takeOnly(): Record<string, unknown> {
  expect(captured.length).toBe(1);
  const line = captured[0];
  expect(line.endsWith('\n')).toBe(true);
  const trimmed = line.slice(0, -1);
  // Must be a single, valid JSON object.
  expect(() => JSON.parse(trimmed)).not.toThrow();
  return JSON.parse(trimmed);
}

describe('T-007 logger baseline shape', () => {
  it('logKeeperStarted emits one line with ts/level/event + AC3.11 fields', () => {
    logKeeperStarted({
      keeper_address: '0x' + '5'.repeat(64),
      tpsl_vault_package_id: '0x' + 'a'.repeat(64),
      poll_interval_ms: 5000,
    });

    const obj = takeOnly();
    expect(obj.event).toBe('keeper_started');
    expect(obj.level).toBe('info');
    expect(typeof obj.ts).toBe('string');
    expect(obj.ts as string).toMatch(ISO8601);
    expect(obj.keeper_address).toBe('0x' + '5'.repeat(64));
    expect(obj.tpsl_vault_package_id).toBe('0x' + 'a'.repeat(64));
    expect(obj.poll_interval_ms).toBe(5000);
  });

  it('logVaultDiscovered carries vault_id, owner, pool_id, tp_price, sl_price, side', () => {
    logVaultDiscovered({
      vault_id: '0xv',
      owner: '0xo',
      pool_id: '0xp',
      side: 0,
      tp_price: '100',
      sl_price: null,
    });
    const obj = takeOnly();
    expect(obj.event).toBe('vault_discovered');
    expect(obj.vault_id).toBe('0xv');
    expect(obj.owner).toBe('0xo');
    expect(obj.pool_id).toBe('0xp');
    expect(obj.side).toBe(0);
    expect(obj.tp_price).toBe('100');
    expect(obj.sl_price).toBeNull();
  });

  it('logPollCycle carries prices array + known_vault_count', () => {
    logPollCycle({
      prices: [
        { object_id: '0xpio1', magnitude: '3058022', exponent: '-8' },
        { object_id: '0xpio2', magnitude: '94371860', exponent: '-8' },
      ],
      known_vault_count: 2,
    });
    const obj = takeOnly();
    expect(obj.event).toBe('poll_cycle');
    expect(obj.known_vault_count).toBe(2);
    const prices = obj.prices as Array<Record<string, unknown>>;
    expect(prices).toHaveLength(2);
    expect(prices[0].object_id).toBe('0xpio1');
    expect(prices[0].magnitude).toBe('3058022');
    expect(prices[0].exponent).toBe('-8');
  });

  it('logTriggerAttempt carries vault_id, current_price, reason', () => {
    logTriggerAttempt({
      vault_id: '0xv',
      current_price: '32404071',
      reason: 'tp',
    });
    const obj = takeOnly();
    expect(obj.event).toBe('trigger_attempt');
    expect(obj.reason).toBe('tp');
    expect(obj.current_price).toBe('32404071');
  });

  it('logTriggerFired carries the AC3.11 minimum field set', () => {
    logTriggerFired({
      vault_id: '0xv',
      current_price: '32404071',
      tx_digest: 'D' + 'g'.repeat(43),
      quote_out_amount: '500',
      base_residual_amount: '0',
      deep_residual_amount: '0',
    });
    const obj = takeOnly();
    expect(obj.event).toBe('trigger_fired');
    expect(obj.tx_digest).toBeDefined();
    expect(obj.quote_out_amount).toBe('500');
    expect(obj.base_residual_amount).toBe('0');
    expect(obj.deep_residual_amount).toBe('0');
  });

  it('logTriggerFailed level is at least warn', () => {
    logTriggerFailed({
      vault_id: '0xv',
      current_price: '32404071',
      tx_digest_or_null: null,
      abort_code_or_message: 'EVaultTriggered=1002',
    });
    const obj = takeOnly();
    expect(obj.event).toBe('trigger_failed');
    expect(['warn', 'error']).toContain(obj.level);
  });

  it('logPythReadFailed level is at least warn + carries object_id and error', () => {
    logPythReadFailed({ object_id: '0xpio1', error: 'simulate fail' });
    const obj = takeOnly();
    expect(obj.event).toBe('pyth_read_failed');
    expect(['warn', 'error']).toContain(obj.level);
    expect(obj.object_id).toBe('0xpio1');
    expect(obj.error).toBe('simulate fail');
  });

  it('logKeeperShutdown carries signal', () => {
    logKeeperShutdown({ signal: 'SIGTERM' });
    const obj = takeOnly();
    expect(obj.event).toBe('keeper_shutdown');
    expect(obj.signal).toBe('SIGTERM');
  });
});

describe('T-007 secret-key redaction', () => {
  it('NEVER serializes a "secretKey" field even if present in the input record', () => {
    // The logger API surface for keeper_started is { keeper_address,
    // tpsl_vault_package_id, poll_interval_ms } per AC3.11; but the
    // implementer's signature may permit extra fields. Pass an adversarial
    // input where a secret slips in as an extra key.
    logKeeperStarted({
      keeper_address: '0x' + '5'.repeat(64),
      tpsl_vault_package_id: '0x' + 'a'.repeat(64),
      poll_interval_ms: 5000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ secretKey: 'leaked-secret-bytes' } as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ privateKey: 'leaked-private' } as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ seed: 'leaked-seed' } as any),
    });

    const obj = takeOnly();
    expect(obj).not.toHaveProperty('secretKey');
    expect(obj).not.toHaveProperty('privateKey');
    expect(obj).not.toHaveProperty('seed');
    // And the line text must not contain the literal secret either.
    const line = captured[0];
    expect(line).not.toContain('leaked-secret-bytes');
    expect(line).not.toContain('leaked-private');
    expect(line).not.toContain('leaked-seed');
  });
});
