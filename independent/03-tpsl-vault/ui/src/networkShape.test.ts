/**
 * T-010 — outbound HTTP from the UI's data layer only targets Sui RPC :9000 —
 * never indexer pool-keyed routes on :9008.
 *
 * Lifted from Cycle 1 T-014 / Cycle 4 T-009 lessons. Spies on global fetch,
 * drives the UI's data layer (manifest fetch + useVaultList chain reads + a
 * representative create/withdraw submit) end-to-end against a fixture
 * manifest whose rpcUrl is http://127.0.0.1:9000, and asserts every captured
 * fetch URL points at the allowed Sui RPC host or the in-app /localnet.json
 * endpoint.
 *
 * JSON-RPC method allowlist:
 *   sui_getObject, sui_multiGetObjects, suix_queryEvents, suix_getDynamicFields
 *
 * Forbidden URL fragments: anything from the indexer pool-keyed REST surface.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- the data layer entry point we drive -----------------------------------

import { runUiDataLayer } from './uiDataLayer';

// --- fixture manifest ------------------------------------------------------

const FIXTURE_MANIFEST = {
  network: { type: 'localnet', rpcUrl: 'http://127.0.0.1:9000' },
  packages: {
    deepbook: { packageId: '0x' + 'd'.repeat(64), objects: [] },
    token: { packageId: '0x' + 'e'.repeat(64) },
  },
  pools: [
    {
      poolId: '0x' + '7'.repeat(64),
      baseCoinType: '0x2::sui::SUI',
      quoteCoinType: '0x' + 'd'.repeat(64) + '::usdc::USDC',
    },
  ],
};

const FIXTURE_USER_ADDRESS = '0x' + 'a'.repeat(64);
const TPSL_VAULT_PACKAGE_ID = '0x' + 'f'.repeat(64);

// --- forbidden + allowed sets ---------------------------------------------

const FORBIDDEN_FRAGMENTS = [
  ':9008/get_pools',
  ':9008/orderbook/',
  ':9008/trades/',
  ':9008/ticker',
];

const ALLOWED_HOSTS = ['127.0.0.1:9000', 'localhost:9000'];
const ALLOWED_LOCAL_PATHS = ['/localnet.json'];

const ALLOWED_JSON_RPC_METHODS = new Set([
  'sui_getObject',
  'sui_multiGetObjects',
  'suix_queryEvents',
  'suix_getDynamicFields',
]);

// --- spy plumbing ----------------------------------------------------------

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
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    let parsedBody: unknown = null;
    try {
      const raw = init?.body;
      if (typeof raw === 'string') parsedBody = JSON.parse(raw);
    } catch {
      parsedBody = null;
    }
    calls.push({ url, method: (init?.method ?? 'GET').toUpperCase(), body: parsedBody });

    // Branch on the URL or RPC method to return a plausible canned response.
    if (url.includes('/localnet.json')) {
      return new Response(JSON.stringify(FIXTURE_MANIFEST), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const method = (parsedBody as { method?: string } | null)?.method;

    let result: unknown = {};
    if (method === 'suix_queryEvents') {
      result = { data: [], hasNextPage: false, nextCursor: null };
    } else if (method === 'sui_getObject' || method === 'sui_multiGetObjects') {
      result = { data: null };
    } else if (method === 'suix_getDynamicFields') {
      result = { data: [], hasNextPage: false, nextCursor: null };
    }

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: (parsedBody as { id?: number } | null)?.id ?? 1,
        result,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('T-010 outbound HTTP shape', () => {
  it('only targets Sui RPC :9000 / /localnet.json; never indexer pool-keyed routes', async () => {
    await runUiDataLayer({
      manifestUrl: '/localnet.json',
      rpcUrl: 'http://127.0.0.1:9000',
      currentAccountAddress: FIXTURE_USER_ADDRESS,
      tpslVaultPackageId: TPSL_VAULT_PACKAGE_ID,
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

    // Allowed-host / allowed-local-path lockdown.
    for (const call of calls) {
      const onAllowedHost = ALLOWED_HOSTS.some((host) => call.url.includes(host));
      const onAllowedPath = ALLOWED_LOCAL_PATHS.some((path) => call.url.endsWith(path) || call.url.includes(path));
      expect(
        onAllowedHost || onAllowedPath,
        `call to ${call.url} is not on any allowed Sui RPC host or local path`,
      ).toBe(true);
    }

    // Method lockdown for JSON-RPC POSTs.
    for (const call of calls) {
      if (call.method !== 'POST') continue;
      const method = (call.body as { method?: string } | null)?.method;
      if (!method) continue;
      expect(
        ALLOWED_JSON_RPC_METHODS.has(method),
        `unexpected JSON-RPC method "${method}" in UI data layer`,
      ).toBe(true);
    }
  });
});
