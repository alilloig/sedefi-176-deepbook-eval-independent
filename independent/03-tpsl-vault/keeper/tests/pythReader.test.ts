/**
 * T-003 — pythReader BCS decoder.
 *
 * Pins the 34-byte Pyth Price BCS layout documented in
 * `notes/pyth-shape.md` (captured live against the running sandbox):
 *
 *   offset  bytes  field
 *   ------  -----  --------------------------
 *        0      1  price.negative   (bool)
 *        1      8  price.magnitude  (u64 LE)
 *        9      8  conf             (u64 LE)
 *       17      1  expo.negative    (bool)
 *       18      8  expo.magnitude   (u64 LE)
 *       26      8  timestamp        (u64 LE)
 *
 * Anti-tautology guard: if the implementer flips the sign-handling on the
 * exponent (returns +8n instead of -8n), the DEEP/SUI fixtures fail; if
 * they swallow the negative-price abort case, the third fixture passes
 * silently — both cases the contract requires to fail noisily.
 */

import { describe, it, expect } from 'vitest';

import { parsePriceFromBcs } from '../src/pythReader.js';

// Helper: pack a u64 little-endian into 8 bytes.
function u64LE(n: bigint): number[] {
  const out: number[] = [];
  let v = n;
  for (let i = 0; i < 8; i++) {
    out.push(Number(v & 0xffn));
    v >>= 8n;
  }
  return out;
}

function buildPriceBcs(args: {
  priceNegative: 0 | 1;
  priceMagnitude: bigint;
  conf: bigint;
  expoNegative: 0 | 1;
  expoMagnitude: bigint;
  timestamp: bigint;
}): Uint8Array {
  const bytes: number[] = [];
  bytes.push(args.priceNegative);
  bytes.push(...u64LE(args.priceMagnitude));
  bytes.push(...u64LE(args.conf));
  bytes.push(args.expoNegative);
  bytes.push(...u64LE(args.expoMagnitude));
  bytes.push(...u64LE(args.timestamp));
  if (bytes.length !== 34) {
    throw new Error(`fixture builder bug: expected 34 bytes, got ${bytes.length}`);
  }
  return new Uint8Array(bytes);
}

describe('T-003 parsePriceFromBcs', () => {
  it('DEEP/USD-shape: positive price + negative exponent decodes correctly', () => {
    // Live capture from the sandbox per notes/pyth-shape.md:
    // hex 0066a92e00000000005f1d000000000000010800000000000000fa9cee6900000000
    const bytes = buildPriceBcs({
      priceNegative: 0,
      priceMagnitude: 3_058_022n,
      conf: 7_519n,
      expoNegative: 1,
      expoMagnitude: 8n,
      timestamp: 1_777_249_018n,
    });

    const out = parsePriceFromBcs(bytes);

    expect(out.magnitude).toBe(3_058_022n);
    expect(out.exponent).toBe(-8n); // CRITICAL — Pyth feeds are negative
    expect(out.conf).toBe(7_519n);
    expect(out.publishTimeSeconds).toBe(1_777_249_018n);
  });

  it('SUI/USD-shape: positive price + negative exponent (live capture)', () => {
    // hex 0014809f0500000000625f010000000000010800000000000000fa9cee6900000000
    const bytes = buildPriceBcs({
      priceNegative: 0,
      priceMagnitude: 94_371_860n,
      conf: 90_466n,
      expoNegative: 1,
      expoMagnitude: 8n,
      timestamp: 1_777_249_018n,
    });

    const out = parsePriceFromBcs(bytes);

    expect(out.magnitude).toBe(94_371_860n);
    expect(out.exponent).toBe(-8n);
    expect(out.conf).toBe(90_466n);
    expect(out.publishTimeSeconds).toBe(1_777_249_018n);
  });

  it('positive exponent (non-Pyth-typical but legal) returns positive bigint', () => {
    const bytes = buildPriceBcs({
      priceNegative: 0,
      priceMagnitude: 42n,
      conf: 1n,
      expoNegative: 0,
      expoMagnitude: 3n,
      timestamp: 1_700_000_000n,
    });
    const out = parsePriceFromBcs(bytes);
    expect(out.exponent).toBe(3n);
  });

  it('throws "Negative price from oracle" when price.negative byte = 1', () => {
    const bytes = buildPriceBcs({
      priceNegative: 1,
      priceMagnitude: 1_000n,
      conf: 0n,
      expoNegative: 1,
      expoMagnitude: 8n,
      timestamp: 1_700_000_000n,
    });
    expect(() => parsePriceFromBcs(bytes)).toThrowError(/Negative price from oracle/);
  });

  it('rejects too-short input rather than reading past the buffer', () => {
    const truncated = new Uint8Array(33); // 1 byte short
    expect(() => parsePriceFromBcs(truncated)).toThrow();
  });
});
