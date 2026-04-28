/**
 * Integration tests for the App root component.
 *
 * App orchestrates: manifest loader -> data layer -> per-pool PoolCard.
 * The tests stub the loader and data layer (the App component must
 * accept these as injected dependencies, or it must read them from a
 * module the tests can mock — the implementer chooses the seam).
 *
 * For test seam clarity we pass them via props on App. Implementations
 * that prefer module-level injection should adjust the App signature
 * accordingly; the tests will catch mismatches loudly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { App, type AppDeps } from '../src/App.js';
import type { PoolCardData } from '../src/components/PoolCard.js';

const FIXTURE_PACKAGE_ID = '0x' + 'b'.repeat(64);

const fixtureManifest = {
  network: { type: 'localnet' as const, rpcUrl: 'http://127.0.0.1:9000' },
  packages: { deepbook: { packageId: FIXTURE_PACKAGE_ID, objects: [] } },
  pools: {
    DEEP_SUI: {
      poolId: '0x' + '1'.repeat(64),
      baseCoinType: '0xdeep::deep::DEEP',
      quoteCoinType: '0x2::sui::SUI',
    },
    SUI_USDC: {
      poolId: '0x' + '2'.repeat(64),
      baseCoinType: '0x2::sui::SUI',
      quoteCoinType: '0xusdc::usdc::USDC',
    },
    EXTRA_PAIR: {
      poolId: '0x' + '3'.repeat(64),
      baseCoinType: '0xa::a::A',
      quoteCoinType: '0xb::b::B',
    },
  },
};

function makePoolCardData(poolId: string, symbol: string): PoolCardData {
  return {
    poolId,
    symbol,
    volume24h: 1,
    lastPrice: 1,
    midPrice: 1,
    spread: 0,
    depthWithinOnePercent: 1,
    sparkline: [{ timestampMs: 1, price: 1 }],
  };
}

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('T-017 renders exactly N PoolCards for a fixture manifest with N pool entries', async () => {
    const deps: AppDeps = {
      loadManifest: vi.fn(async () => ({
        deepbookPackageId: FIXTURE_PACKAGE_ID,
        pools: Object.entries(fixtureManifest.pools).map(([symbol, p]) => ({
          symbol,
          poolId: p.poolId,
          baseCoinType: p.baseCoinType,
          quoteCoinType: p.quoteCoinType,
        })),
      })),
      fetchPoolStats: vi.fn(async (descriptor) =>
        makePoolCardData(descriptor.poolId, descriptor.symbol),
      ),
    };

    render(<App deps={deps} />);

    await waitFor(() => {
      const cards = screen.getAllByTestId('pool-card');
      expect(cards.length).toBe(3);
    });

    // And each unique poolId appears exactly once.
    const cards = screen.getAllByTestId('pool-card');
    const ids = cards.map((c) => c.getAttribute('data-pool-id'));
    const uniqIds = new Set(ids);
    expect(uniqIds.size).toBe(3);
  });

  describe('T-018 mounts without console errors when manifest reachable', () => {
    let consoleErrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrSpy.mockRestore();
    });

    it('records zero console.error calls during initial mount + paint', async () => {
      const deps: AppDeps = {
        loadManifest: vi.fn(async () => ({
          deepbookPackageId: FIXTURE_PACKAGE_ID,
          pools: [
            {
              symbol: 'SUI_USDC',
              poolId: '0x' + '2'.repeat(64),
              baseCoinType: '0x2::sui::SUI',
              quoteCoinType: '0xusdc::usdc::USDC',
            },
          ],
        })),
        fetchPoolStats: vi.fn(async (descriptor) =>
          makePoolCardData(descriptor.poolId, descriptor.symbol),
        ),
      };

      render(<App deps={deps} />);

      await waitFor(() => {
        expect(screen.getAllByTestId('pool-card').length).toBe(1);
      });

      expect(consoleErrSpy).not.toHaveBeenCalled();
    });
  });

  it('T-019 renders an actionable inline error referencing the bootstrap recipe when manifest is missing', async () => {
    const deps: AppDeps = {
      loadManifest: vi.fn(async () => {
        throw new Error(
          'Deployment manifest not found at /tmp/missing.json. ' +
            'Run `pnpm deploy-all` from the deepbook-sandbox repo.',
        );
      }),
      fetchPoolStats: vi.fn(),
    };

    render(<App deps={deps} />);

    // The error UI must visibly reference the bootstrap recipe.
    await waitFor(() => {
      expect(
        screen.getByText(/deploy-all|deepbook-sandbox/i),
      ).toBeInTheDocument();
    });

    // No PoolCards rendered.
    expect(screen.queryAllByTestId('pool-card').length).toBe(0);
  });

  it('T-020 renders an actionable inline error mentioning the Sui RPC endpoint when RPC unreachable', async () => {
    const deps: AppDeps = {
      loadManifest: vi.fn(async () => ({
        deepbookPackageId: FIXTURE_PACKAGE_ID,
        pools: [
          {
            symbol: 'SUI_USDC',
            poolId: '0x' + '2'.repeat(64),
            baseCoinType: '0x2::sui::SUI',
            quoteCoinType: '0xusdc::usdc::USDC',
          },
        ],
      })),
      fetchPoolStats: vi.fn(async () => {
        throw new Error(
          'sui_getObject failed: cannot reach Sui RPC at http://127.0.0.1:9000',
        );
      }),
    };

    render(<App deps={deps} />);

    // The error UI must mention either the RPC endpoint, the rpc port,
    // or the bootstrap recipe.
    await waitFor(() => {
      expect(
        screen.getByText(/sui rpc|127\.0\.0\.1:9000|9000|deploy-all|deepbook-sandbox/i),
      ).toBeInTheDocument();
    });

    // The React tree did not crash: querying the body still works.
    expect(document.body).toBeInTheDocument();
  });
});
