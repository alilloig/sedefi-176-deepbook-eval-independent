/**
 * T-014 — outbound HTTP shape lockdown.
 *
 * The cycle contract forbids the SPA's data layer from contacting any
 * indexer pool-keyed REST route on :9008 (`/get_pools`, `/orderbook/...`,
 * `/trades/...`, `/ticker`). Only Sui RPC JSON-RPC on :9000 is allowed.
 *
 * This test spies on global `fetch`, runs the data layer end-to-end
 * against a fixture manifest + fixture pool/event responses, and asserts
 * on the URL set the data layer touched.
 *
 * The spy returns canned JSON-RPC responses keyed by the JSON-RPC method
 * name, so the data layer's call sequence is exercised even though no
 * real sandbox is running.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runDataLayer } from '../src/dataLayer.js';

// --- canned manifest ----------------------------------------------------------

const FIXTURE_PACKAGE_ID =
  '0xe7b03bfa906a4c4f2a696ad253f9815a55eafb50f6aa52b121128c8d5cef4329';

const fixtureManifest = {
  network: { type: 'localnet', rpcUrl: 'http://127.0.0.1:9000' },
  packages: { deepbook: { packageId: FIXTURE_PACKAGE_ID, objects: [] } },
  pools: {
    SUI_USDC: {
      poolId: '0x' + '7'.repeat(64),
      baseCoinType: '0x2::sui::SUI',
      quoteCoinType: '0x3fefe1eac271f6d449bdc8428d1ddb8017817c140f76308ab0ca5ebc1f2b5b61::usdc::USDC',
    },
  },
};

// --- pinned forbidden URL fragments ------------------------------------------

const FORBIDDEN_FRAGMENTS = [
  ':9008/get_pools',
  ':9008/orderbook/',
  ':9008/trades/',
  ':9008/ticker',
];

const ALLOWED_HOSTS = [
  '127.0.0.1:9000',
  'localhost:9000',
];

// --- spy plumbing -------------------------------------------------------------

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

    // Build a minimal canned JSON-RPC response based on method.
    const method = (parsedBody as { method?: string } | null)?.method;

    let result: unknown = {};
    if (method === 'sui_getObject') {
      // Return a minimal pool wrapper -> versioned -> inner-state shape that
      // exercises the dynamic-field traversal path. To keep the spy simple
      // we always return a "leaf" object with a `book` field; the data
      // layer's traversal logic is allowed to issue extra calls if it
      // wants.
      result = {
        data: {
          objectId: '0xfake',
          version: '1',
          digest: 'd',
          type: '0xfake::pool::PoolInner<0x2::sui::SUI, 0xusdc::usdc::USDC>',
          content: {
            dataType: 'moveObject',
            type: '0xfake::pool::PoolInner<0x2::sui::SUI, 0xusdc::usdc::USDC>',
            hasPublicTransfer: false,
            fields: {
              id: { id: '0xfake' },
              pool_id: '0xfake',
              book: {
                fields: {
                  asks: { fields: { id: { id: '0xfakeasks' }, length: '0', root_id: '0', max_slice_size: '64' } },
                  bids: { fields: { id: { id: '0xfakebids' }, length: '0', root_id: '0', max_slice_size: '64' } },
                  lot_size: '1',
                  min_size: '1',
                  tick_size: '1',
                },
              },
            },
          },
        },
      };
    } else if (method === 'suix_getDynamicFields') {
      result = { data: [], nextCursor: null, hasNextPage: false };
    } else if (method === 'suix_queryEvents') {
      result = { data: [], nextCursor: null, hasNextPage: false };
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

describe('T-014 outbound HTTP shape', () => {
  it('only targets Sui RPC :9000 JSON-RPC; never indexer pool-keyed routes', async () => {
    await runDataLayer({
      manifest: fixtureManifest,
      rpcUrl: 'http://127.0.0.1:9000',
      nowMs: 2_000_000_000_000,
    });

    expect(calls.length, 'data layer issued no HTTP at all').toBeGreaterThan(0);

    // Forbidden-fragment lockdown.
    for (const call of calls) {
      for (const banned of FORBIDDEN_FRAGMENTS) {
        expect(
          call.url.includes(banned),
          `call to ${call.url} hits forbidden indexer fragment ${banned}`,
        ).toBe(false);
      }
    }

    // Allowed-host lockdown: every URL must point at the configured Sui RPC
    // host. We accept either 127.0.0.1:9000 or localhost:9000 for resolver
    // friendliness.
    for (const call of calls) {
      const allowed = ALLOWED_HOSTS.some((host) => call.url.includes(host));
      expect(
        allowed,
        `call to ${call.url} is not on any allowed Sui RPC host`,
      ).toBe(true);
    }

    // Method lockdown: only sui_getObject / suix_queryEvents /
    // suix_getDynamicFields are tolerable for Slot 1's chain-direct
    // dataflow. Anything else hints the data layer wandered.
    const allowedMethods = new Set([
      'sui_getObject',
      'suix_queryEvents',
      'suix_getDynamicFields',
      'sui_multiGetObjects',
    ]);
    for (const call of calls) {
      if (call.method !== 'POST') continue;
      const method = (call.body as { method?: string } | null)?.method;
      if (!method) continue;
      expect(
        allowedMethods.has(method),
        `unexpected JSON-RPC method "${method}" in data layer`,
      ).toBe(true);
    }
  });
});
