/**
 * T-003 — useVaultList filters VaultCreated events by owner == currentAccount.address.
 * T-004 — useVaultList omits vaults whose getObject reports balance==0 AND triggered==false
 *         (the post-withdraw filter), AND omits vaults whose getObject returns deleted/not-found.
 *
 * The hook reads VaultCreated events via SuiClient.queryEvents (or
 * suix_queryEvents under the hood) and per-vault state via SuiClient.getObject.
 * We mock both and assert the rendered/filtered list returned by the hook.
 *
 * Test seam: per Cycle contract decision #4, the hook's `refresh()` must be the
 * SAME function the production timer invokes — these tests call it via the
 * hook's exposed shape (return value), not via a private path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';

// --- fixtures --------------------------------------------------------------

const ADDRESS_A = '0x' + 'a'.repeat(64);
const ADDRESS_B = '0x' + 'b'.repeat(64);

const VAULT_A1 = '0x' + '1'.repeat(64);
const VAULT_A2 = '0x' + '2'.repeat(64);
const VAULT_B1 = '0x' + '3'.repeat(64);

const POOL_ID = '0x' + '7'.repeat(64);

// --- mock SuiClient surface ------------------------------------------------

const queryEventsMock = vi.fn();
const getObjectMock = vi.fn();

// Tracks the hook's account-aware re-runs across the suite.
const setCurrentAccountAddress = vi.fn<(addr: string | null) => void>();
let currentAccountAddress: string | null = ADDRESS_A;

vi.mock('@mysten/dapp-kit-react', () => {
  return {
    useCurrentAccount: () => (currentAccountAddress ? { address: currentAccountAddress } : null),
    useCurrentClient: () => ({
      queryEvents: queryEventsMock,
      getObject: getObjectMock,
      core: {
        getObject: getObjectMock,
      },
    }),
  };
});

vi.mock('./manifest', () => ({
  useManifest: () => ({
    data: {
      rpcUrl: 'http://127.0.0.1:9000',
      pools: [
        {
          poolId: POOL_ID,
          baseCoinType: '0x2::sui::SUI',
          quoteCoinType: '0xusdc::usdc::USDC',
        },
      ],
      tpslVaultPackageId: '0xfeed',
    },
    isLoading: false,
    error: null,
  }),
}));

// --- import under test (will fail until useVaultList is implemented) -------

import { useVaultList } from './useVaultList';

// --- helpers ---------------------------------------------------------------

function vaultCreatedEvent(vaultId: string, owner: string) {
  return {
    parsedJson: {
      vault_id: vaultId,
      owner,
      pool_id: POOL_ID,
      side: 0,
      tp_price: '2000000000',
      sl_price: null,
      deposit_amount: '1000000',
    },
    timestampMs: '1700000000000',
    id: { txDigest: 'd', eventSeq: '0' },
  };
}

function vaultObjectFunded(vaultId: string, balance: string, triggered: boolean) {
  return {
    data: {
      objectId: vaultId,
      version: '1',
      digest: 'd',
      content: {
        dataType: 'moveObject',
        type: '0xfeed::tpsl_vault::Vault<0x2::sui::SUI>',
        hasPublicTransfer: false,
        fields: {
          id: { id: vaultId },
          // Move's `Balance<T>` BCS-serializes to `{ value: u64 }`; in
          // sui_getObject's content.fields it lands as
          // `{ fields: { value: "<atomic>" } }`. Earlier fixtures used a
          // bare string, mirroring the production bug.
          balance: { fields: { value: balance } },
          triggered,
          owner: ADDRESS_A,
          pool_id: POOL_ID,
          side: 0,
          tp_price: { fields: { vec: ['2000000000'] } },
          sl_price: { fields: { vec: [] } },
        },
      },
    },
  };
}

function vaultObjectDeleted() {
  return { data: null, error: { code: 'notExists' } };
}

beforeEach(() => {
  queryEventsMock.mockReset();
  getObjectMock.mockReset();
  setCurrentAccountAddress.mockReset();
  currentAccountAddress = ADDRESS_A;
});

// --- T-003: owner-filter ---------------------------------------------------

describe('T-003 useVaultList filters VaultCreated events by owner == currentAccount.address', () => {
  it('returns only the two vaults owned by A when currentAccount is A; switching to B returns the one B-owned vault', async () => {
    queryEventsMock.mockResolvedValue({
      data: [
        vaultCreatedEvent(VAULT_A1, ADDRESS_A),
        vaultCreatedEvent(VAULT_B1, ADDRESS_B),
        vaultCreatedEvent(VAULT_A2, ADDRESS_A),
      ],
      hasNextPage: false,
      nextCursor: null,
    });

    // Both per-vault getObject reads return funded + non-triggered (so the
    // owner filter is the ONLY filter that fires).
    getObjectMock.mockImplementation(async (args: { id: string } | { objectId: string }) => {
      const id = (args as { id?: string }).id ?? (args as { objectId: string }).objectId;
      return vaultObjectFunded(id, '1000000', false);
    });

    const { result, rerender } = renderHook(() => useVaultList());

    await waitFor(() => {
      expect(result.current.vaults).toBeDefined();
      expect(result.current.vaults.length).toBe(2);
    });

    const idsForA = result.current.vaults.map((v: { vaultId: string }) => v.vaultId).sort();
    expect(idsForA).toEqual([VAULT_A1, VAULT_A2].sort());
    expect(idsForA).not.toContain(VAULT_B1);

    // Switch the account to B and re-render. The hook depends on the
    // currentAccount.address — switching must re-run its effect and surface the
    // single B-owned vault.
    act(() => {
      currentAccountAddress = ADDRESS_B;
    });
    rerender();

    await waitFor(() => {
      expect(result.current.vaults.length).toBe(1);
    });
    const idsForB = result.current.vaults.map((v: { vaultId: string }) => v.vaultId);
    expect(idsForB).toEqual([VAULT_B1]);
  });
});

// --- T-004: post-withdraw + deleted filter ---------------------------------

describe('T-004 useVaultList omits balance==0 && triggered==false vaults and deleted vaults', () => {
  it('returns only the funded non-triggered vault; the post-withdraw and deleted vaults are absent', async () => {
    const VAULT_FUNDED = VAULT_A1;
    const VAULT_WITHDRAWN = VAULT_A2;
    const VAULT_DELETED = '0x' + 'c'.repeat(64);

    queryEventsMock.mockResolvedValue({
      data: [
        vaultCreatedEvent(VAULT_FUNDED, ADDRESS_A),
        vaultCreatedEvent(VAULT_WITHDRAWN, ADDRESS_A),
        vaultCreatedEvent(VAULT_DELETED, ADDRESS_A),
      ],
      hasNextPage: false,
      nextCursor: null,
    });

    getObjectMock.mockImplementation(async (args: { id?: string; objectId?: string }) => {
      const id = args.id ?? args.objectId;
      if (id === VAULT_FUNDED) return vaultObjectFunded(VAULT_FUNDED, '1000000', false);
      if (id === VAULT_WITHDRAWN) return vaultObjectFunded(VAULT_WITHDRAWN, '0', false);
      if (id === VAULT_DELETED) return vaultObjectDeleted();
      throw new Error(`unexpected getObject for ${id}`);
    });

    const { result } = renderHook(() => useVaultList());

    await waitFor(() => {
      expect(result.current.vaults.length).toBe(1);
    });

    const ids = result.current.vaults.map((v: { vaultId: string }) => v.vaultId);
    expect(ids).toEqual([VAULT_FUNDED]);
    expect(ids).not.toContain(VAULT_WITHDRAWN);
    expect(ids).not.toContain(VAULT_DELETED);
  });
});
