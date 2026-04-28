/**
 * T-006 — triggerSubmitter PTB shape.
 *
 * Validates the structural shape of the Transaction returned by
 * `buildTriggerTransaction`. Submission/signing is out of scope for this
 * test; the keeper builds the tx purely.
 *
 * Anti-tautology guard: each of the five argument-index assertions and
 * each of the two type-argument assertions is pinned. A submitter that
 * forgets the clock argument, swaps base/quote, or omits the splitCoins
 * intermediate command will fail this test.
 */

import { describe, it, expect } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';

import { buildTriggerTransaction } from '../src/triggerSubmitter.js';
import type { KnownVault } from '../src/vaultRegistry.js';

const PKG = '0x' + 'a'.repeat(63) + '1';
const VAULT_ID = '0x' + 'b'.repeat(63) + '1';
const POOL_ID = '0x' + 'c'.repeat(63) + '1';
const DEEP_COIN = '0x' + 'd'.repeat(63) + '1';
const BASE_TYPE = '0xb60903240f8a6006ebc861d9b0cd672b63caf7a5fcf3b588cc697c2af625fa84::deep::DEEP';
const QUOTE_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

const baseVault: KnownVault & { baseCoinType: string; quoteCoinType: string } = {
  vault_id: VAULT_ID,
  owner: '0x' + 'e'.repeat(64),
  pool_id: POOL_ID,
  side: 0,
  tp_price: 100n,
  sl_price: null,
  deposit_amount: 1_000_000_000n,
  triggered: false,
  baseCoinType: BASE_TYPE,
  quoteCoinType: QUOTE_TYPE,
};

describe('T-006 buildTriggerTransaction', () => {
  it('returns a @mysten/sui Transaction with the expected moveCall + splitCoins shape', () => {
    const tx = buildTriggerTransaction({
      tpslVaultPackageId: PKG,
      vault: baseVault,
      poolId: POOL_ID,
      currentPrice: 32_414_055n,  // orchestrator-amended: original 32_404_071 didn't match the comment's hex on line 88 (0x01EE9967 = 32_414_055)
      deepCoinId: DEEP_COIN,
      deepPerTrigger: 100_000_000n,
    });

    expect(tx).toBeInstanceOf(Transaction);

    const data = JSON.parse(tx.serialize());
    const cmds: Array<Record<string, unknown>> = data.transactions;

    // (a) Exactly two top-level commands: SplitCoins + MoveCall.
    expect(cmds).toHaveLength(2);
    const split = cmds.find((c) => c.kind === 'SplitCoins') as Record<string, unknown>;
    const moveCall = cmds.find((c) => c.kind === 'MoveCall') as Record<string, unknown>;
    expect(split).toBeDefined();
    expect(moveCall).toBeDefined();

    // (b) MoveCall target + type arguments are pinned in order.
    expect(moveCall.target).toBe(`${PKG}::tpsl_vault::execute_trigger`);
    expect(moveCall.typeArguments).toEqual([BASE_TYPE, QUOTE_TYPE]);

    // (c) MoveCall arguments are five, in order:
    //     [vault, pool, currentPrice (pure u64), splitDeepResult, clock 0x6].
    const args = moveCall.arguments as Array<Record<string, unknown>>;
    expect(args).toHaveLength(5);

    // arg 0 — vault object
    expect(args[0].kind).toBe('Input');
    expect(args[0].type).toBe('object');
    expect(args[0].value).toBe(VAULT_ID);

    // arg 1 — pool object
    expect(args[1].kind).toBe('Input');
    expect(args[1].type).toBe('object');
    expect(args[1].value).toBe(POOL_ID);

    // arg 2 — current_price as pure u64 (8-byte LE).
    expect(args[2].kind).toBe('Input');
    expect(args[2].type).toBe('pure');
    const purePayload = args[2].value as { Pure: number[] };
    expect(Array.isArray(purePayload.Pure)).toBe(true);
    expect(purePayload.Pure).toHaveLength(8);
    // 32_404_071 = 0x01EE9967  →  LE: 67 99 EE 01 00 00 00 00
    expect(purePayload.Pure).toEqual([0x67, 0x99, 0xee, 0x01, 0x00, 0x00, 0x00, 0x00]);

    // arg 3 — splitDeep result (the SplitCoins command's return).
    expect(args[3].kind).toBe('Result');
    // The split command must come BEFORE the moveCall (so its index is 0)
    // for the result reference to be valid.
    expect(args[3].index).toBe(0);

    // arg 4 — clock at 0x6.
    expect(args[4].kind).toBe('Input');
    expect(args[4].type).toBe('object');
    expect(args[4].value).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000006',
    );

    // (d) The SplitCoins command splits from the configured DEEP coin id
    //     and uses the deepPerTrigger amount.
    const splitCoin = split.coin as Record<string, unknown>;
    expect(splitCoin.kind).toBe('Input');
    expect(splitCoin.type).toBe('object');
    expect(splitCoin.value).toBe(DEEP_COIN);

    const splitAmounts = split.amounts as Array<Record<string, unknown>>;
    expect(splitAmounts).toHaveLength(1);
    expect(splitAmounts[0].type).toBe('pure');
    // 100_000_000 = 0x05F5E100  →  LE: 00 E1 F5 05 00 00 00 00
    const splitPure = splitAmounts[0].value as { Pure: number[] };
    expect(splitPure.Pure).toEqual([0x00, 0xe1, 0xf5, 0x05, 0x00, 0x00, 0x00, 0x00]);
  });
});
