/**
 * T-004 — triggerEvaluator pure decision function.
 *
 * Mirrors the Move `execute_trigger` condition logic exactly:
 *   tp_met = vault.tp_price.is_some && current_price >= tp_price
 *   sl_met = vault.sl_price.is_some && current_price <= sl_price
 *   fire   = (tp_met || sl_met) && !triggered
 *
 * Anti-tautology guard: each boundary case (`current == tp` is INCLUSIVE,
 * `current == sl` is INCLUSIVE) is asserted explicitly. The "both met"
 * tie-break asserts `tp` because Move's `||` evaluates `tp_met` first.
 */

import { describe, it, expect } from 'vitest';

import {
  evaluateTrigger,
  type EvaluatorVault,
  type EvaluatorResult,
} from '../src/triggerEvaluator.js';

function v(overrides: Partial<EvaluatorVault> = {}): EvaluatorVault {
  return {
    vault_id: '0xv',
    tp_price: null,
    sl_price: null,
    triggered: false,
    ...overrides,
  };
}

describe('T-004 evaluateTrigger', () => {
  it('returns already_triggered regardless of price when triggered=true', () => {
    const out = evaluateTrigger(v({ triggered: true, tp_price: 100n }), 200n);
    const expected: EvaluatorResult = { shouldFire: false, reason: 'already_triggered' };
    expect(out).toEqual(expected);
  });

  it('TP only — current below tp returns none', () => {
    expect(evaluateTrigger(v({ tp_price: 100n }), 99n)).toEqual({
      shouldFire: false,
      reason: 'none',
    });
  });

  it('TP only — current EQUAL to tp fires (>= boundary inclusive)', () => {
    expect(evaluateTrigger(v({ tp_price: 100n }), 100n)).toEqual({
      shouldFire: true,
      reason: 'tp',
    });
  });

  it('TP only — current above tp fires', () => {
    expect(evaluateTrigger(v({ tp_price: 100n }), 101n)).toEqual({
      shouldFire: true,
      reason: 'tp',
    });
  });

  it('SL only — current above sl returns none', () => {
    expect(evaluateTrigger(v({ sl_price: 50n }), 51n)).toEqual({
      shouldFire: false,
      reason: 'none',
    });
  });

  it('SL only — current EQUAL to sl fires (<= boundary inclusive)', () => {
    expect(evaluateTrigger(v({ sl_price: 50n }), 50n)).toEqual({
      shouldFire: true,
      reason: 'sl',
    });
  });

  it('SL only — current below sl fires', () => {
    expect(evaluateTrigger(v({ sl_price: 50n }), 49n)).toEqual({
      shouldFire: true,
      reason: 'sl',
    });
  });

  it('both prices set, both met (degenerate crossed-bound case): tp wins (Move evaluates tp_met first)', () => {
    expect(
      evaluateTrigger(v({ tp_price: 100n, sl_price: 200n }), 150n),
    ).toEqual({ shouldFire: true, reason: 'tp' });
  });

  it('both prices null returns none (no condition can fire)', () => {
    expect(evaluateTrigger(v(), 999n)).toEqual({
      shouldFire: false,
      reason: 'none',
    });
  });
});
