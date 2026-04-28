/**
 * Pure trigger-condition evaluator.
 *
 * Mirrors the Move contract's execute_trigger condition logic exactly:
 *   tp_met = vault.tp_price.is_some() && current_price >= tp_price
 *   sl_met = vault.sl_price.is_some() && current_price <= sl_price
 *   fire   = (tp_met || sl_met) && !triggered
 *
 * The "both met" tie-break returns 'tp' because Move evaluates tp_met first
 * in `tp_met || sl_met`.
 *
 * Pure function: accepts plain objects, returns a plain object.
 * No SDK imports, no logger, no I/O.
 */

/** Minimal vault shape required by the evaluator. */
export interface EvaluatorVault {
  vault_id: string;
  tp_price: bigint | null;
  sl_price: bigint | null;
  triggered: boolean;
}

export type EvaluatorReason = 'tp' | 'sl' | 'none' | 'already_triggered';

export interface EvaluatorResult {
  shouldFire: boolean;
  reason: EvaluatorReason;
}

/**
 * Evaluates whether a trigger should fire for this vault given the current price.
 */
export function evaluateTrigger(vault: EvaluatorVault, currentPrice: bigint): EvaluatorResult {
  if (vault.triggered) {
    return { shouldFire: false, reason: 'already_triggered' };
  }

  const tpMet = vault.tp_price !== null && currentPrice >= vault.tp_price;
  const slMet = vault.sl_price !== null && currentPrice <= vault.sl_price;

  if (tpMet) {
    return { shouldFire: true, reason: 'tp' };
  }
  if (slMet) {
    return { shouldFire: true, reason: 'sl' };
  }

  return { shouldFire: false, reason: 'none' };
}
