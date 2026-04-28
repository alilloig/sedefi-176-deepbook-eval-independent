/**
 * T-001 / T-002 — vault registry tests.
 *
 * T-001: parseVaultCreatedEvent must turn a captured suix_queryEvents
 * payload into a typed KnownVault, with strict missing-field detection.
 *
 * T-002: VaultRegistry must (a) dedupe by vault_id, (b) iterate all known
 * vaults, (c) seed the in-memory `triggered` flag from a single getObject
 * call (injected as a function dependency), and (d) flip / read the
 * triggered flag in-memory.
 *
 * Anti-tautology guard: the assertions below pin the EXACT shape the Move
 * VaultCreated event emits per `tpsl_vault::tpsl_vault::VaultCreated`
 * (vault_id, owner, pool_id, side, tp_price: Option<u64>, sl_price:
 * Option<u64>, deposit_amount: u64). Loosening any individual assertion
 * (e.g. dropping the Option<None> -> null check, or accepting either
 * casing of the address) means the parser silently corrupts state — these
 * tests are intentionally tight.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  parseVaultCreatedEvent,
  VaultRegistry,
  type KnownVault,
  type VaultCreatedEventEnvelope,
} from '../src/vaultRegistry.js';

// --- T-001 fixtures ---------------------------------------------------------

const VAULT_ID = '0xabc123' + 'a'.repeat(58); // 64-hex
const OWNER = '0xdeadbeef' + 'b'.repeat(56);
const POOL_ID = '0x' + '7'.repeat(64);

function tpslEvent(overrides: Partial<Record<string, unknown>> = {}): VaultCreatedEventEnvelope {
  // This mirrors the suix_queryEvents response shape: each event has a
  // `parsedJson` field whose value reflects the Move struct field-for-field.
  // Option<u64> is rendered by the SDK as { Some: "<decimal-string>" } or
  // { None: true }/null.
  return {
    id: { txDigest: 'D', eventSeq: '0' },
    packageId: '0xpackage',
    transactionModule: 'tpsl_vault',
    sender: OWNER,
    type: '0xpackage::tpsl_vault::VaultCreated',
    parsedJson: {
      vault_id: VAULT_ID,
      owner: OWNER,
      pool_id: POOL_ID,
      side: 0,
      tp_price: { Some: '12345' },
      sl_price: null,
      deposit_amount: '1000000000',
      ...overrides,
    },
    bcs: '',
    timestampMs: '1777245324000',
  };
}

describe('T-001 parseVaultCreatedEvent', () => {
  it('parses a Some/None payload into typed KnownVault with normalized hex', () => {
    const v = parseVaultCreatedEvent(tpslEvent());

    expect(v.vault_id).toBe(VAULT_ID.toLowerCase());
    expect(v.vault_id.startsWith('0x')).toBe(true);
    expect(v.pool_id).toBe(POOL_ID.toLowerCase());
    expect(v.owner).toBe(OWNER.toLowerCase());
    expect(v.owner.startsWith('0x')).toBe(true);
    expect(v.side).toBe(0);
    expect(typeof v.side).toBe('number');
    expect(v.tp_price).toBe(12345n);
    expect(v.sl_price).toBeNull();
    expect(v.deposit_amount).toBe(1_000_000_000n);
  });

  it('handles None tp_price + Some sl_price', () => {
    const v = parseVaultCreatedEvent(
      tpslEvent({ tp_price: null, sl_price: { Some: '999' } }),
    );
    expect(v.tp_price).toBeNull();
    expect(v.sl_price).toBe(999n);
  });

  it('side: 1 is preserved (not collapsed to 0 / boolean)', () => {
    const v = parseVaultCreatedEvent(tpslEvent({ side: 1 }));
    expect(v.side).toBe(1);
  });

  it('throws if vault_id is missing, naming the field', () => {
    const e = tpslEvent();
    delete (e.parsedJson as Record<string, unknown>).vault_id;
    expect(() => parseVaultCreatedEvent(e)).toThrowError(/vault_id/);
  });

  it('throws if owner is missing, naming the field', () => {
    const e = tpslEvent();
    delete (e.parsedJson as Record<string, unknown>).owner;
    expect(() => parseVaultCreatedEvent(e)).toThrowError(/owner/);
  });

  it('throws if pool_id is missing, naming the field', () => {
    const e = tpslEvent();
    delete (e.parsedJson as Record<string, unknown>).pool_id;
    expect(() => parseVaultCreatedEvent(e)).toThrowError(/pool_id/);
  });

  it('throws if side is missing, naming the field', () => {
    const e = tpslEvent();
    delete (e.parsedJson as Record<string, unknown>).side;
    expect(() => parseVaultCreatedEvent(e)).toThrowError(/side/);
  });

  it('throws if deposit_amount is missing, naming the field', () => {
    const e = tpslEvent();
    delete (e.parsedJson as Record<string, unknown>).deposit_amount;
    expect(() => parseVaultCreatedEvent(e)).toThrowError(/deposit_amount/);
  });

  it('throws if tp_price key is entirely absent (vs explicit null)', () => {
    const e = tpslEvent();
    delete (e.parsedJson as Record<string, unknown>).tp_price;
    expect(() => parseVaultCreatedEvent(e)).toThrowError(/tp_price/);
  });

  it('throws if sl_price key is entirely absent', () => {
    const e = tpslEvent();
    delete (e.parsedJson as Record<string, unknown>).sl_price;
    expect(() => parseVaultCreatedEvent(e)).toThrowError(/sl_price/);
  });
});

// --- T-002 fixtures ---------------------------------------------------------

function knownVault(overrides: Partial<KnownVault> = {}): KnownVault {
  return {
    vault_id: VAULT_ID.toLowerCase(),
    owner: OWNER.toLowerCase(),
    pool_id: POOL_ID.toLowerCase(),
    side: 0,
    tp_price: 100n,
    sl_price: null,
    deposit_amount: 1_000_000_000n,
    triggered: false,
    ...overrides,
  };
}

describe('T-002 VaultRegistry add/dedupe/seed/markTriggered', () => {
  it('addOrUpdate on a new id returns wasNew=true; second call returns wasNew=false and does NOT duplicate', () => {
    const reg = new VaultRegistry();
    const first = reg.addOrUpdate(knownVault());
    const second = reg.addOrUpdate(knownVault());

    expect(first.wasNew).toBe(true);
    expect(second.wasNew).toBe(false);
    expect(reg.size()).toBe(1);
  });

  it('iterate() returns every known vault regardless of triggered flag', () => {
    const reg = new VaultRegistry();
    reg.addOrUpdate(knownVault({ vault_id: '0x' + '1'.repeat(64) }));
    reg.addOrUpdate(knownVault({ vault_id: '0x' + '2'.repeat(64), triggered: true }));
    reg.addOrUpdate(knownVault({ vault_id: '0x' + '3'.repeat(64) }));

    const all = Array.from(reg.iterate());
    expect(all).toHaveLength(3);
    const ids = all.map((v) => v.vault_id).sort();
    expect(ids).toEqual([
      '0x' + '1'.repeat(64),
      '0x' + '2'.repeat(64),
      '0x' + '3'.repeat(64),
    ]);
  });

  it('seedTriggeredFromChain sets triggered=true via injected getObject when chain says triggered', async () => {
    const reg = new VaultRegistry();
    reg.addOrUpdate(knownVault());

    const getObject = vi.fn(async (_id: string) => ({
      data: {
        objectId: VAULT_ID.toLowerCase(),
        content: {
          dataType: 'moveObject',
          fields: { triggered: true },
        },
      },
    }));

    await reg.seedTriggeredFromChain(VAULT_ID.toLowerCase(), getObject);

    expect(getObject).toHaveBeenCalledTimes(1);
    expect(reg.isTriggered(VAULT_ID.toLowerCase())).toBe(true);
  });

  it('seedTriggeredFromChain leaves flag at default false when chain object is missing/malformed', async () => {
    const reg = new VaultRegistry();
    reg.addOrUpdate(knownVault());

    const getObject = vi.fn(async () => ({ data: null })); // not found

    await reg.seedTriggeredFromChain(VAULT_ID.toLowerCase(), getObject);

    expect(reg.isTriggered(VAULT_ID.toLowerCase())).toBe(false);
  });

  it('seedTriggeredFromChain leaves flag unchanged when triggered field is non-boolean', async () => {
    const reg = new VaultRegistry();
    reg.addOrUpdate(knownVault({ triggered: false }));

    const getObject = vi.fn(async () => ({
      data: { content: { dataType: 'moveObject', fields: { triggered: 'maybe' } } },
    }));

    await reg.seedTriggeredFromChain(VAULT_ID.toLowerCase(), getObject);

    expect(reg.isTriggered(VAULT_ID.toLowerCase())).toBe(false);
  });

  it('markTriggered + isTriggered round trip', () => {
    const reg = new VaultRegistry();
    reg.addOrUpdate(knownVault());
    expect(reg.isTriggered(VAULT_ID.toLowerCase())).toBe(false);
    reg.markTriggered(VAULT_ID.toLowerCase());
    expect(reg.isTriggered(VAULT_ID.toLowerCase())).toBe(true);
  });
});
