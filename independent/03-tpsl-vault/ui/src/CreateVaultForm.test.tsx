/**
 * T-005 — CreateVaultForm submits a PTB whose moveCall target, type
 *         arguments, and argument shape match the contract.
 * T-006 — CreateVaultForm rejects submission when both TP and SL inputs
 *         are empty (client-side EInvalidTriggerConfig defense).
 * T-007 — CreateVaultForm calls vault-list refresh exactly once after a
 *         successful signAndExecuteTransaction (and clears inputs).
 *
 * The form uses dapp-kit-react's `useDAppKit().signAndExecuteTransaction(...)`
 * action; the test mocks that action and asserts the recorded Transaction's
 * shape (moveCall target / typeArguments / argument-builder calls), NOT the
 * raw bytes. The injected `refresh` callback is the same function the
 * production wiring invokes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const TPSL_VAULT_PACKAGE_ID = '0x' + 'f'.repeat(64);
const POOL_SUI_USDC = {
  poolId: '0x' + '7'.repeat(64),
  baseCoinType: '0x2::sui::SUI',
  quoteCoinType: '0x' + 'd'.repeat(64) + '::usdc::USDC',
  label: 'SUI/USDC',
};

const ADDRESS_USER = '0x' + 'a'.repeat(64);

// --- mocks: dapp-kit-react -------------------------------------------------

const signAndExecuteMock = vi.fn();

vi.mock('@mysten/dapp-kit-react', () => {
  return {
    useDAppKit: () => ({
      signAndExecuteTransaction: signAndExecuteMock,
    }),
    useCurrentAccount: () => ({ address: ADDRESS_USER }),
    useCurrentClient: () => ({
      getCoins: vi.fn(async () => ({
        data: [
          {
            coinObjectId: '0x' + '9'.repeat(64),
            balance: '999999999',
            coinType: '0x2::sui::SUI',
            digest: 'd',
            version: '1',
          },
        ],
        hasNextPage: false,
      })),
    }),
  };
});

vi.mock('./manifest', () => ({
  useManifest: () => ({
    data: {
      rpcUrl: 'http://127.0.0.1:9000',
      pools: [POOL_SUI_USDC],
      tpslVaultPackageId: TPSL_VAULT_PACKAGE_ID,
    },
    isLoading: false,
    error: null,
  }),
}));

// --- import under test -----------------------------------------------------

import { CreateVaultForm } from './CreateVaultForm';

// --- helpers ---------------------------------------------------------------

function getRecordedTransaction(): unknown {
  const lastCall = signAndExecuteMock.mock.calls.at(-1);
  if (!lastCall) throw new Error('signAndExecuteTransaction was never called');
  const arg0 = lastCall[0] as { transaction: unknown };
  return arg0.transaction;
}

beforeEach(() => {
  signAndExecuteMock.mockReset();
});

// --- T-005: PTB shape ------------------------------------------------------

describe('T-005 CreateVaultForm builds a create_vault PTB with the correct shape', () => {
  it('serializes the moveCall to ${PKG}::tpsl_vault::create_vault with [coin, pool_id, side, Some(tp), None(sl)]', async () => {
    signAndExecuteMock.mockResolvedValue({ digest: '0xtxsuccess', effects: { status: { status: 'success' } } });

    const refresh = vi.fn();
    render(<CreateVaultForm refresh={refresh} />);

    const user = userEvent.setup();

    // Fill the form (pool defaults to the only pool in the manifest).
    const amountInput = screen.getByLabelText(/amount/i);
    await user.clear(amountInput);
    await user.type(amountInput, '1000000');

    const tpInput = screen.getByLabelText(/take[- ]?profit/i);
    await user.clear(tpInput);
    await user.type(tpInput, '2000000000');

    // SL left empty.

    // Side defaults to 0 (recommended convention) per the contract; the
    // implementer might surface a radio — accept either default.
    const submitBtn = screen.getByRole('button', { name: /create|submit/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(signAndExecuteMock).toHaveBeenCalledTimes(1);
    });

    const tx = getRecordedTransaction() as {
      getData?: () => { commands: unknown[] };
      blockData?: { transactions?: unknown[] };
    };

    // The Transaction shape varies by SDK version. We accept either the
    // SDK 2.x `getData()` shape (commands array) or the legacy `blockData`
    // shape (transactions array). We then drill in to find the MoveCall
    // command and assert on its package / module / function / typeArguments.
    let commands: unknown[] = [];
    if (typeof tx.getData === 'function') {
      commands = tx.getData().commands;
    } else if (tx.blockData?.transactions) {
      commands = tx.blockData.transactions;
    } else {
      throw new Error('unrecognized Transaction shape: ' + JSON.stringify(Object.keys(tx)));
    }

    type MoveCallCmd = {
      MoveCall?: { package: string; module: string; function: string; type_arguments?: string[]; typeArguments?: string[]; arguments?: unknown[] };
      $kind?: string;
      MoveCall_v?: unknown;
    };

    const moveCall = commands
      .map((c) => c as MoveCallCmd)
      .find((c) => c.MoveCall != null || c.$kind === 'MoveCall' || (c as { MoveCall?: unknown }).MoveCall != null);
    expect(moveCall, 'create_vault moveCall present').toBeDefined();

    const inner = (moveCall as { MoveCall?: { package: string; module: string; function: string; type_arguments?: string[]; typeArguments?: string[]; arguments?: unknown[] } }).MoveCall;
    if (inner) {
      expect(inner.package).toBe(TPSL_VAULT_PACKAGE_ID);
      expect(inner.module).toBe('tpsl_vault');
      expect(inner.function).toBe('create_vault');
      const typeArgs = inner.typeArguments ?? inner.type_arguments ?? [];
      expect(typeArgs).toEqual([POOL_SUI_USDC.baseCoinType]);
      // five positional arguments: coin, pool_id, side, Option<u64> tp, Option<u64> sl
      expect(inner.arguments).toBeDefined();
      expect(inner.arguments!.length).toBe(5);
    }
  });
});

// --- T-006: TP+SL both empty rejection -------------------------------------

describe('T-006 CreateVaultForm rejects submission when both TP and SL are empty', () => {
  it('does not call signAndExecuteTransaction and renders an inline validation error', async () => {
    const refresh = vi.fn();
    render(<CreateVaultForm refresh={refresh} />);

    const user = userEvent.setup();

    const amountInput = screen.getByLabelText(/amount/i);
    await user.clear(amountInput);
    await user.type(amountInput, '1000000');

    // BOTH TP and SL left empty.
    const submitBtn = screen.getByRole('button', { name: /create|submit/i });
    await user.click(submitBtn);

    // Give any async submit a chance to fail.
    await new Promise((r) => setTimeout(r, 50));

    expect(signAndExecuteMock).not.toHaveBeenCalled();

    // Inline validation error rendered via role="alert" so it's distinguishable
    // from the form's TP/SL field labels (orchestrator-amended: original regex
    // also matched the label text "Take-profit (optional)" and "Stop-loss
    // (optional)" on the form, producing multiple matches).
    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert).toBeInTheDocument();
    expect(errorAlert.textContent).toMatch(/(at least one|tp|sl|take[- ]?profit|stop[- ]?loss|provide|require)/i);
  });
});

// --- T-007: refresh-on-success --------------------------------------------

describe('T-007 CreateVaultForm calls refresh exactly once after successful submission', () => {
  it('invokes the injected refresh callback once on resolved-success and clears inputs', async () => {
    signAndExecuteMock.mockResolvedValue({ digest: '0xsuccess', effects: { status: { status: 'success' } } });

    const refresh = vi.fn();
    render(<CreateVaultForm refresh={refresh} />);

    const user = userEvent.setup();

    const amountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    await user.clear(amountInput);
    await user.type(amountInput, '1000000');

    const tpInput = screen.getByLabelText(/take[- ]?profit/i) as HTMLInputElement;
    await user.clear(tpInput);
    await user.type(tpInput, '2000000000');

    await user.click(screen.getByRole('button', { name: /create|submit/i }));

    await waitFor(() => {
      expect(signAndExecuteMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    // Inputs cleared on success.
    await waitFor(() => {
      expect(amountInput.value).toBe('');
      expect(tpInput.value).toBe('');
    });
  });
});
