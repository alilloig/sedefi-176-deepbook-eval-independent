/**
 * Price formula that mirrors the sandbox market-maker's calculateBaseQuotePrice.
 *
 * Reference: notes/pyth-shape.md § "Price formula the keeper applies".
 *
 * For a Pool<Base, Quote>, current_price represents:
 *   "1 unit of Base (in atomic units) priced in atomic units of Quote"
 *
 * Formula:
 *   scaledExpo = quoteDecimals + baseExponent - quoteExponent
 *   if scaledExpo >= 0:
 *     result = baseMagnitude * 10^scaledExpo / quoteMagnitude
 *   else:
 *     result = baseMagnitude / (quoteMagnitude * 10^-scaledExpo)
 *
 * Pure function — no SDK dependencies, no I/O. Vitest-testable in isolation.
 */

export interface PriceModelArgs {
  baseMagnitude: bigint;
  /** Signed exponent for base (typically -8 for Pyth USD feeds). */
  baseExponent: bigint;
  quoteMagnitude: bigint;
  /** Signed exponent for quote (typically -8 for Pyth USD feeds). */
  quoteExponent: bigint;
  /** Decimal count of the QUOTE coin (e.g. 9 for SUI, 6 for USDC). */
  quoteDecimals: number;
}

const U64_MAX = (1n << 64n) - 1n;

/**
 * Calculates the base/quote price as a u64-compatible bigint.
 *
 * Throws:
 *   'zero magnitude' if either magnitude is 0n (Pyth read failure, not a real price).
 *   'price overflow u64' if the result exceeds 2^64-1 (Move takes current_price as u64).
 */
export function calculateBaseQuotePrice(args: PriceModelArgs): bigint {
  const { baseMagnitude, baseExponent, quoteMagnitude, quoteExponent, quoteDecimals } = args;

  if (baseMagnitude === 0n || quoteMagnitude === 0n) {
    throw new Error('zero magnitude');
  }

  const scaledExpo = BigInt(quoteDecimals) + baseExponent - quoteExponent;
  const result =
    scaledExpo >= 0n
      ? (baseMagnitude * 10n ** scaledExpo) / quoteMagnitude
      : baseMagnitude / (quoteMagnitude * 10n ** -scaledExpo);

  if (result > U64_MAX) {
    throw new Error('price overflow u64');
  }

  return result;
}
