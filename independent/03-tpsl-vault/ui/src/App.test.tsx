/**
 * T-001 — App renders without throwing inside DAppKitProvider when wallet is
 * not connected.
 *
 * Asserts the React 2.0 dapp-kit shape works end-to-end: <QueryClientProvider>
 * + <DAppKitProvider dAppKit={dAppKit}> wrapping <App />, with
 * useCurrentAccount() returning null. The "wallet not connected" UX surface
 * (a connect button or equivalent connect-prompt element) MUST be reachable.
 *
 * The test mocks the dapp-kit-react module so we do not need a live network
 * during the suite. The mock surfaces useCurrentAccount() returning null and
 * provides a minimal <DAppKitProvider> + <ConnectButton /> + <DAppKitUI />
 * shape.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- mock @mysten/dapp-kit-react -------------------------------------------

vi.mock('@mysten/dapp-kit-react', () => {
  return {
    DAppKitProvider: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="dapp-kit-provider">{children}</div>
    ),
    useCurrentAccount: () => null,
    useCurrentClient: () => ({
      core: {
        getObject: vi.fn(),
      },
      queryEvents: vi.fn(async () => ({ data: [] })),
    }),
    useDAppKit: () => ({
      signAndExecuteTransaction: vi.fn(),
    }),
    ConnectButton: () => <button type="button">Connect Wallet</button>,
  };
});

// --- mock the dapp-kit module so App doesn't trigger real createDAppKit ----

vi.mock('./dapp-kit', () => ({
  dAppKit: { __mock: true },
}));

// --- mock manifest fetch ---------------------------------------------------

vi.mock('./manifest', () => ({
  useManifest: () => ({
    data: {
      rpcUrl: 'http://127.0.0.1:9000',
      pools: [],
      tpslVaultPackageId: '0xfeed',
    },
    isLoading: false,
    error: null,
  }),
}));

// --- import under test (will fail until App.tsx is implemented) ------------

import { App } from './App';

describe('T-001 App renders without throwing when wallet is not connected', () => {
  it('mounts the App tree and surfaces a Connect-wallet element', async () => {
    // Orchestrator-amended: switched from CommonJS require() to ESM dynamic
    // import. The package is "type": "module"; require() in ESM context throws
    // 'Cannot find module' even after vi.mock has registered the mock.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { DAppKitProvider } = (await import('@mysten/dapp-kit-react')) as {
      DAppKitProvider: React.ComponentType<{ children: React.ReactNode; dAppKit: unknown }>;
    };
    const { dAppKit } = (await import('./dapp-kit')) as { dAppKit: unknown };

    expect(() =>
      render(
        <QueryClientProvider client={queryClient}>
          <DAppKitProvider dAppKit={dAppKit}>
            <App />
          </DAppKitProvider>
        </QueryClientProvider>,
      ),
    ).not.toThrow();

    // The wallet-not-connected branch surfaces a connect prompt. Accept any
    // button whose accessible name matches /connect/i (covers both the dapp-kit
    // <ConnectButton /> and any custom "Connect" surface the implementer
    // might wrap it in).
    const connectControl = screen.getByRole('button', { name: /connect/i });
    expect(connectControl).toBeInTheDocument();
  });
});
