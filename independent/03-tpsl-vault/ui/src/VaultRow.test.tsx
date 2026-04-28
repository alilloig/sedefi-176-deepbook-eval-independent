/**
 * T-008 — VaultRow on a non-triggered vault renders a Withdraw button and
 *         submits the correct withdraw PTB on click; refresh fires on success.
 * T-009 — VaultRow on a triggered vault renders a Triggered badge plus
 *         quote_out_amount and omits the Withdraw button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const TPSL_VAULT_PACKAGE_ID = '0x' + 'f'.repeat(64);
const VAULT_ID = '0x' + 'a'.repeat(64);

// --- mocks: dapp-kit-react -------------------------------------------------

const signAndExecuteMock = vi.fn();

vi.mock('@mysten/dapp-kit-react', () => {
  return {
    useDAppKit: () => ({
      signAndExecuteTransaction: signAndExecuteMock,
    }),
    useCurrentAccount: () => ({ address: '0x' + 'a'.repeat(64) }),
    useCurrentClient: () => ({}),
  };
});

vi.mock('./manifest', () => ({
  useManifest: () => ({
    data: {
      rpcUrl: 'http://127.0.0.1:9000',
      pools: [],
      tpslVaultPackageId: TPSL_VAULT_PACKAGE_ID,
    },
    isLoading: false,
    error: null,
  }),
}));

// --- import under test -----------------------------------------------------

import { VaultRow } from './VaultRow';

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

// --- T-008: Withdraw button + PTB shape ------------------------------------

describe('T-008 VaultRow renders Withdraw on non-triggered vault and submits correct PTB', () => {
  it('clicking Withdraw submits the withdraw PTB and fires refresh on success', async () => {
    signAndExecuteMock.mockResolvedValue({ digest: '0xtx', effects: { status: { status: 'success' } } });

    const refresh = vi.fn();
    const vault = {
      vaultId: VAULT_ID,
      owner: '0x' + 'a'.repeat(64),
      poolId: '0x' + '7'.repeat(64),
      side: 0,
      tpPrice: '2000000000',
      slPrice: null,
      depositAmount: '1000000',
      balance: '1000000',
      triggered: false,
      baseCoinType: '0x2::sui::SUI',
    };

    render(<VaultRow vault={vault} refresh={refresh} />);

    const withdrawBtn = screen.getByRole('button', { name: /withdraw/i });
    expect(withdrawBtn).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(withdrawBtn);

    await waitFor(() => {
      expect(signAndExecuteMock).toHaveBeenCalledTimes(1);
    });

    // Assert PTB shape.
    const tx = getRecordedTransaction() as {
      getData?: () => { commands: unknown[] };
      blockData?: { transactions?: unknown[] };
    };

    let commands: unknown[] = [];
    if (typeof tx.getData === 'function') {
      commands = tx.getData().commands;
    } else if (tx.blockData?.transactions) {
      commands = tx.blockData.transactions;
    } else {
      throw new Error('unrecognized Transaction shape');
    }

    type MoveCallCmd = {
      MoveCall?: { package: string; module: string; function: string; type_arguments?: string[]; typeArguments?: string[]; arguments?: unknown[] };
    };

    const moveCall = commands
      .map((c) => c as MoveCallCmd)
      .find((c) => c.MoveCall != null);
    expect(moveCall, 'withdraw moveCall present').toBeDefined();
    const inner = moveCall!.MoveCall!;
    expect(inner.package).toBe(TPSL_VAULT_PACKAGE_ID);
    expect(inner.module).toBe('tpsl_vault');
    expect(inner.function).toBe('withdraw');
    const typeArgs = inner.typeArguments ?? inner.type_arguments ?? [];
    expect(typeArgs).toEqual(['0x2::sui::SUI']);
    expect(inner.arguments).toBeDefined();
    expect(inner.arguments!.length).toBe(1);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });
});

// --- T-009: Triggered render -----------------------------------------------

describe('T-009 VaultRow on triggered vault renders Triggered badge + quote_out_amount, omits Withdraw', () => {
  it('renders the Triggered badge, displays the quote_out_amount, and the Withdraw button is absent', () => {
    const vault = {
      vaultId: VAULT_ID,
      owner: '0x' + 'a'.repeat(64),
      poolId: '0x' + '7'.repeat(64),
      side: 0,
      tpPrice: '2000000000',
      slPrice: null,
      depositAmount: '1000000',
      balance: '0',
      triggered: true,
      baseCoinType: '0x2::sui::SUI',
    };

    const triggerEvent = {
      vaultId: VAULT_ID,
      quoteOutAmount: '4242000000',
      baseResidualAmount: '0',
      deepResidualAmount: '0',
    };

    render(<VaultRow vault={vault} refresh={vi.fn()} triggerEvent={triggerEvent} />);

    // (a) Triggered badge present (case-insensitive).
    expect(screen.getByText(/triggered/i)).toBeInTheDocument();

    // (b) Rendered text contains the digits "4242" of the quote_out_amount
    // (decimals-formatting permitted as long as the digit run is preserved).
    const root = document.body.textContent ?? '';
    expect(root).toMatch(/4242/);

    // (c) No Withdraw button.
    expect(screen.queryByRole('button', { name: /withdraw/i })).toBeNull();
  });
});
