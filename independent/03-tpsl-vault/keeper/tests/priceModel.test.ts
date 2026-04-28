/**
 * T-005 — priceModel.calculateBaseQuotePrice.
 *
 * Mirrors the sandbox market-maker formula
 * (`scripts/market-maker/price-feed.ts > calculateBaseQuotePrice`):
 *
 *   scaledExpo = quoteDecimals + baseExponent - quoteExponent
 *   if scaledExpo >= 0:
 *     result = baseMag * 10^scaledExpo / quoteMag
 *   else:
 *     result = baseMag / (quoteMag * 10^-scaledExpo)
 *
 * Anti-tautology guard: zero-magnitude → throws ('zero magnitude' is a
 * Pyth read failure, not a real price); >2^64-1 → throws ('price overflow
 * u64' — the Move contract receives u64). The exact integer-division
 * result for the DEEP/SUI live values is pinned, so a one-decimal-off
 * scaling bug cannot make the test pass.
 */

import { describe, it, expect } from 'vitest';

import { calculateBaseQuotePrice } from '../src/priceModel.js';

describe('T-005 calculateBaseQuotePrice', () => {
  it('DEEP/SUI live capture: 3_058_022 * 10^-8 / 0.94371860 → mist of SUI per atomic DEEP', () => {
    // From notes/pyth-shape.md worked example:
    // (3_058_022 * 10^9) / 94_371_860 = 32_404_071 (integer division)
    // Use the pre-capture deepMagnitude=2_500_000 / suiMagnitude=350_000_000
    // values from tests.json so the spec line matches verbatim — the test
    // contract pinned a specific fixture pair.
    const out = calculateBaseQuotePrice({
      baseMagnitude: 2_500_000n,
      baseExponent: -8n,
      quoteMagnitude: 350_000_000n,
      quoteExponent: -8n,
      quoteDecimals: 9,
    });

    // (2_500_000 * 10^9) / 350_000_000 = 2_500_000_000_000_000 / 350_000_000
    //                                  = 7_142_857 (integer floor)
    expect(out).toBe(7_142_857n);
  });

  it('SUI/USDC live shape: quoteDecimals=6 (USDC), exponents both -8', () => {
    // Made-up SUI/USDC: SUI=$0.94, USDC=$1.00
    // baseMag 94_000_000 / quoteMag 100_000_000, both expo -8, qD=6
    // scaledExpo = 6 + -8 - -8 = 6
    // result = (94_000_000 * 10^6) / 100_000_000 = 940_000
    const out = calculateBaseQuotePrice({
      baseMagnitude: 94_000_000n,
      baseExponent: -8n,
      quoteMagnitude: 100_000_000n,
      quoteExponent: -8n,
      quoteDecimals: 6,
    });
    expect(out).toBe(940_000n);
  });

  it('throws "price overflow u64" if the result exceeds 2^64-1', () => {
    // Pick magnitudes that produce a result above 2^64-1 = 18_446_744_073_709_551_615.
    // (10^30 * 10^9) / 1 = 10^39 ≫ 2^64.
    expect(() =>
      calculateBaseQuotePrice({
        baseMagnitude: 10n ** 30n,
        baseExponent: 0n,
        quoteMagnitude: 1n,
        quoteExponent: 0n,
        quoteDecimals: 9,
      }),
    ).toThrowError(/price overflow u64/);
  });

  it('throws "zero magnitude" if base magnitude is 0n', () => {
    expect(() =>
      calculateBaseQuotePrice({
        baseMagnitude: 0n,
        baseExponent: -8n,
        quoteMagnitude: 350_000_000n,
        quoteExponent: -8n,
        quoteDecimals: 9,
      }),
    ).toThrowError(/zero magnitude/);
  });

  it('throws "zero magnitude" if quote magnitude is 0n', () => {
    expect(() =>
      calculateBaseQuotePrice({
        baseMagnitude: 2_500_000n,
        baseExponent: -8n,
        quoteMagnitude: 0n,
        quoteExponent: -8n,
        quoteDecimals: 9,
      }),
    ).toThrowError(/zero magnitude/);
  });
});
