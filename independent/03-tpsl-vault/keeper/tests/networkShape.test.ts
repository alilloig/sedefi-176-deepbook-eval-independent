/**
 * T-009 — outbound HTTP shape lockdown for the keeper.
 *
 * Mirrors Cycle 1's T-014 pattern. With global fetch spied, drive ONE
 * tick of the keeper's vault-discovery + price-poll loop via the
 * implementer-exposed test seam (`runOnePollCycle`), and assert:
 *
 *   (a) every captured URL targets the configured rpcUrl host
 *       (127.0.0.1:9000 or localhost:9000) OR the configured faucet host;
 *   (b) NO URL contains the forbidden Cycle 1 indexer fragments
 *       (`:9008/get_pools`, `:9008/orderbook/`, `:9008/trades/`,
 *       `:9008/ticker`) — the keeper must NOT depend on
 *       `@mysten/deepbook-v3` (the helper SDK that pulls in those routes);
 *   (c) at least one outbound POST happened (no zero-call green-pass —
 *       rules out the Cycle 1 "structural fix that doesn't actually wire
 *       through" regression class).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runOnePollCycle } from '../src/index.js';

// --- canned manifest --------------------------------------------------------

const TPSL_VAULT_PKG = '0x' + 'a'.repeat(64);
const PYTH_PKG = '0x2aeae6eb8dbba4a235a91672130085e06a52e473ae5ddbad1f56ea5e0068fd34';
const DEEPBOOK_PKG = '0x' + 'b'.repeat(64);
const TOKEN_PKG = '0xb60903240f8a6006ebc861d9b0cd672b63caf7a5fcf3b588cc697c2af625fa84';
const DEEP_PIO = '0xddc6cbb7a203295d06ee94ad5c68fe59196fb1497e4d432eaf21e79e37b542a8';
const SUI_PIO = '0xec5cc6aecf447f72ab526c0303a1d6d7303245bde4296fb979190efa5906da28';

const FIXTURE_MANIFEST = {
  network: { type: 'localnet', rpcUrl: 'http://127.0.0.1:9000', faucetUrl: 'http://127.0.0.1:9123' },
  packages: {
    deepbook: { packageId: DEEPBOOK_PKG, objects: [] },
    pyth: { packageId: PYTH_PKG, objects: [] },
    token: { packageId: TOKEN_PKG, objects: [] },
  },
  pythOracles: {
    deepPriceInfoObjectId: DEEP_PIO,
    suiPriceInfoObjectId: SUI_PIO,
  },
  pools: {
    DEEP_SUI: {
      poolId: '0x' + '7'.repeat(64),
      baseCoinType: `${TOKEN_PKG}::deep::DEEP`,
      quoteCoinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    },
  },
};

// --- forbidden / allowed fragments ------------------------------------------

const FORBIDDEN_FRAGMENTS = [
  ':9008/get_pools',
  ':9008/orderbook/',
  ':9008/trades/',
  ':9008/ticker',
];

const ALLOWED_HOSTS = [
  '127.0.0.1:9000',
  'localhost:9000',
  '127.0.0.1:9123',
  'localhost:9123',
];

// --- fetch spy --------------------------------------------------------------

interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
}

let calls: CapturedRequest[] = [];
let originalFetch: typeof fetch;

beforeEach(() => {
  calls = [];
  originalFetch = globalThis.fetch;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let parsedBody: unknown = null;
    try {
      const raw = init?.body;
      if (typeof raw === 'string') parsedBody = JSON.parse(raw);
    } catch {
      parsedBody = null;
    }
    calls.push({ url, method: (init?.method ?? 'GET').toUpperCase(), body: parsedBody });

    const method = (parsedBody as { method?: string } | null)?.method;
    let result: unknown = {};

    if (method === 'sui_getObject' || method === 'sui_multiGetObjects') {
      result = {
        data: {
          objectId: '0xfake',
          version: '1',
          digest: 'd',
          type: 'fake',
          content: { dataType: 'moveObject', type: 'fake', hasPublicTransfer: false, fields: { triggered: false } },
        },
      };
    } else if (method === 'suix_queryEvents') {
      result = { data: [], nextCursor: null, hasNextPage: false };
    } else if (method === 'sui_devInspectTransactionBlock') {
      // Return a 34-byte BCS price (DEEP live capture) as base64.
      const bytes = [0,102,169,46,0,0,0,0,0,95,29,0,0,0,0,0,0,1,8,0,0,0,0,0,0,0,250,156,238,105,0,0,0,0];
      result = {
        results: [
          { returnValues: [[bytes, '0x...::price::Price']] },
        ],
        effects: { status: { status: 'success' } },
      };
    } else if (method === 'sui_executeTransactionBlock') {
      result = {
        digest: 'D' + 'g'.repeat(43),
        effects: { status: { status: 'success' } },
        events: [],
      };
    } else if (method === 'sui_getReferenceGasPrice') {
      result = '1000';
    }

    const responseBody = JSON.stringify({
      jsonrpc: '2.0',
      id: (parsedBody as { id?: number } | null)?.id ?? 1,
      result,
    });
    return new Response(responseBody, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('T-009 keeper outbound HTTP shape', () => {
  it('only targets Sui RPC / faucet hosts; never DeepBook indexer routes', async () => {
    await runOnePollCycle({
      manifest: FIXTURE_MANIFEST,
      tpslVaultPackageId: TPSL_VAULT_PKG,
      deepCoinId: '0x' + 'd'.repeat(64),
      pollIntervalMs: 5000,
    });

    expect(calls.length, 'keeper issued no HTTP at all').toBeGreaterThan(0);

    // Forbidden-fragment lockdown.
    for (const call of calls) {
      for (const banned of FORBIDDEN_FRAGMENTS) {
        expect(
          call.url.includes(banned),
          `call to ${call.url} hits forbidden indexer fragment ${banned}`,
        ).toBe(false);
      }
    }

    // Allowed-host lockdown.
    for (const call of calls) {
      const allowed = ALLOWED_HOSTS.some((host) => call.url.includes(host));
      expect(
        allowed,
        `call to ${call.url} is not on any allowed Sui RPC / faucet host`,
      ).toBe(true);
    }
  });
});
