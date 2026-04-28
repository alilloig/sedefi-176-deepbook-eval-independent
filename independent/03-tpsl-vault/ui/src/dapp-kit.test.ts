/**
 * T-002 — `src/dapp-kit.ts` pre-imports the deployer key into the
 * InMemorySignerAdapter BEFORE createDAppKit is called.
 *
 * Mirrors the dashboard's `dapp-kit.ts` lines 8-27 obligation. Mocks
 * @mysten-incubation/dev-wallet/adapters and @mysten/dapp-kit-react and
 * verifies (a) `adapter.importAccount` was invoked with an Ed25519Keypair
 * derived from the fixture private key, AND (b) the import await resolved
 * BEFORE createDAppKit was called (call-ordering assertion).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

// --- fixture key (Ed25519, encoded in Bech32 sui-private-key format) ------

// We generate one deterministically at suite import. encodeSuiPrivateKey is
// SDK-stable; the generated keypair gives us a concrete address to assert on.
const FIXTURE_KEYPAIR = Ed25519Keypair.generate();
const FIXTURE_ADDRESS = FIXTURE_KEYPAIR.getPublicKey().toSuiAddress();
const FIXTURE_PRIVATE_KEY = FIXTURE_KEYPAIR.getSecretKey();

// --- call-ordering recorder -------------------------------------------------

const callSequence: string[] = [];

// --- mocks ------------------------------------------------------------------

const importAccountMock = vi.fn(async (_args: { signer: unknown; label: string }) => {
  callSequence.push('importAccount');
});

const initializeMock = vi.fn(async () => {
  callSequence.push('initialize');
});

vi.mock('@mysten-incubation/dev-wallet/adapters', () => {
  return {
    InMemorySignerAdapter: vi.fn().mockImplementation(() => ({
      initialize: initializeMock,
      importAccount: importAccountMock,
    })),
  };
});

vi.mock('@mysten-incubation/dev-wallet', () => {
  return {
    devWalletInitializer: vi.fn(() => ({ __initializer: true })),
  };
});

const createDAppKitMock = vi.fn((_config: unknown) => {
  callSequence.push('createDAppKit');
  return { __mock: true };
});

vi.mock('@mysten/dapp-kit-react', () => {
  return {
    createDAppKit: createDAppKitMock,
  };
});

vi.mock('@mysten/sui/grpc', () => {
  return {
    SuiGrpcClient: vi.fn().mockImplementation((args) => ({ __client: true, ...args })),
  };
});

// --- env injection ----------------------------------------------------------

beforeEach(() => {
  callSequence.length = 0;
  importAccountMock.mockClear();
  initializeMock.mockClear();
  createDAppKitMock.mockClear();
  vi.resetModules();
  // Vite's import.meta.env injection. The dapp-kit module reads this.
  (globalThis as unknown as { import_meta_env?: Record<string, string> }).import_meta_env = {
    VITE_DEV_WALLET_PRIVATE_KEY: FIXTURE_PRIVATE_KEY,
  };
  // jsdom does not give us import.meta directly, but vitest runs in vite's
  // module-graph land — the simplest cross-test route is to set the env via
  // process.env which the implementer's dapp-kit.ts reads through
  // import.meta.env at build time. Vitest aliases import.meta.env to
  // process.env automatically.
  process.env.VITE_DEV_WALLET_PRIVATE_KEY = FIXTURE_PRIVATE_KEY;
});

describe('T-002 dapp-kit pre-imports deployer key before createDAppKit', () => {
  it('invokes adapter.importAccount with a keypair matching the fixture address, then calls createDAppKit', async () => {
    // Importing the module triggers the top-level await chain.
    await import('./dapp-kit');

    // The adapter's importAccount must have been called once with an
    // Ed25519Keypair whose address matches the fixture key.
    expect(importAccountMock).toHaveBeenCalledTimes(1);
    const callArg = importAccountMock.mock.calls[0]![0];
    expect(callArg.label).toBe('Deployer');
    const passedKeypair = callArg.signer as Ed25519Keypair;
    expect(passedKeypair.getPublicKey().toSuiAddress()).toBe(FIXTURE_ADDRESS);

    // createDAppKit must have been called.
    expect(createDAppKitMock).toHaveBeenCalledTimes(1);

    // Call ordering: importAccount must precede createDAppKit.
    const importIdx = callSequence.indexOf('importAccount');
    const createIdx = callSequence.indexOf('createDAppKit');
    expect(importIdx).toBeGreaterThanOrEqual(0);
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(importIdx).toBeLessThan(createIdx);
  });
});
