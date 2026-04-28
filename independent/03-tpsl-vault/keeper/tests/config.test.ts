/**
 * T-008 — config validation.
 *
 * Pure function: takes an env-like Record<string, string | undefined>,
 * returns a Config or throws an actionable error. The function MUST NOT
 * read process.env on its own (testability + no hidden side effects).
 *
 * Anti-tautology guard: rejected values for KEEPER_POLL_INTERVAL_MS are
 * pinned at boundary minus/plus one, plus zero, negative, and NaN-string;
 * the error message MUST name both the env var and the [5000, 10000]
 * range. If the implementer accepts any of these, the test reports a
 * loosened assertion.
 */

import { describe, it, expect } from 'vitest';

import { loadConfig } from '../src/config.js';

const VALID_PKG_ID = '0x' + 'a'.repeat(64); // 66 chars total
const VALID_DEEP_COIN_ID = '0x' + 'd'.repeat(64);

function baseEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    TPSL_VAULT_PACKAGE_ID: VALID_PKG_ID,
    KEEPER_DEEP_COIN_ID: VALID_DEEP_COIN_ID,
    ...overrides,
  };
}

describe('T-008 loadConfig — KEEPER_POLL_INTERVAL_MS', () => {
  it('default (env unset) is 5000 (the spec-pinned default)', () => {
    const c = loadConfig(baseEnv());
    expect(c.pollIntervalMs).toBe(5000);
  });

  it('5000 is accepted (low boundary inclusive)', () => {
    expect(loadConfig(baseEnv({ KEEPER_POLL_INTERVAL_MS: '5000' })).pollIntervalMs).toBe(5000);
  });

  it('10000 is accepted (high boundary inclusive)', () => {
    expect(loadConfig(baseEnv({ KEEPER_POLL_INTERVAL_MS: '10000' })).pollIntervalMs).toBe(10000);
  });

  it('7500 is accepted (mid range)', () => {
    expect(loadConfig(baseEnv({ KEEPER_POLL_INTERVAL_MS: '7500' })).pollIntervalMs).toBe(7500);
  });

  for (const bad of ['4999', '10001', '0', '-1', 'abc']) {
    it(`rejects "${bad}" with an error naming KEEPER_POLL_INTERVAL_MS and [5000, 10000]`, () => {
      let err: Error | null = null;
      try {
        loadConfig(baseEnv({ KEEPER_POLL_INTERVAL_MS: bad }));
      } catch (e) {
        err = e as Error;
      }
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/KEEPER_POLL_INTERVAL_MS/);
      expect((err as Error).message).toMatch(/5000/);
      expect((err as Error).message).toMatch(/10000/);
    });
  }
});

describe('T-008 loadConfig — TPSL_VAULT_PACKAGE_ID', () => {
  it('accepts a 66-char 0x-prefixed hex string', () => {
    const c = loadConfig(baseEnv({ TPSL_VAULT_PACKAGE_ID: VALID_PKG_ID }));
    expect(c.tpslVaultPackageId).toBe(VALID_PKG_ID);
  });

  it('throws when missing, naming the env var', () => {
    expect(() =>
      loadConfig(baseEnv({ TPSL_VAULT_PACKAGE_ID: undefined })),
    ).toThrowError(/TPSL_VAULT_PACKAGE_ID/);
  });

  it('throws when empty string', () => {
    expect(() => loadConfig(baseEnv({ TPSL_VAULT_PACKAGE_ID: '' }))).toThrowError(
      /TPSL_VAULT_PACKAGE_ID/,
    );
  });

  it('throws when missing 0x prefix', () => {
    expect(() =>
      loadConfig(baseEnv({ TPSL_VAULT_PACKAGE_ID: 'a'.repeat(64) })),
    ).toThrowError(/TPSL_VAULT_PACKAGE_ID/);
  });

  it('throws when length is wrong (too short)', () => {
    expect(() =>
      loadConfig(baseEnv({ TPSL_VAULT_PACKAGE_ID: '0xabc' })),
    ).toThrowError(/TPSL_VAULT_PACKAGE_ID/);
  });
});

describe('T-008 loadConfig — KEEPER_DEEP_COIN_ID', () => {
  it('accepts a valid 0x-hex-66 id', () => {
    const c = loadConfig(baseEnv({ KEEPER_DEEP_COIN_ID: VALID_DEEP_COIN_ID }));
    expect(c.deepCoinId).toBe(VALID_DEEP_COIN_ID);
  });

  it('throws when missing, naming the env var', () => {
    expect(() =>
      loadConfig(baseEnv({ KEEPER_DEEP_COIN_ID: undefined })),
    ).toThrowError(/KEEPER_DEEP_COIN_ID/);
  });

  it('throws when malformed (no 0x prefix)', () => {
    expect(() =>
      loadConfig(baseEnv({ KEEPER_DEEP_COIN_ID: 'd'.repeat(64) })),
    ).toThrowError(/KEEPER_DEEP_COIN_ID/);
  });
});
