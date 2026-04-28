/**
 * Tests for the deployment-manifest loader.
 *
 * The loader is responsible for taking the sandbox's
 * `sandbox/deployments/localnet.json` (or any structurally-equivalent
 * fixture) and returning typed pool descriptors plus the deployed
 * DeepBook package id. Hard-coded pool ids or package ids are forbidden
 * by the cycle contract — the loader is the only path the SPA uses to
 * discover those.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  loadManifest,
  type PoolDescriptor,
} from '../src/manifest.js';

async function writeFixture(contents: unknown, name = 'localnet.json'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'mstats-manifest-'));
  const file = path.join(dir, name);
  await fs.writeFile(file, JSON.stringify(contents), 'utf8');
  return file;
}

const FIXTURE_PACKAGE_ID =
  '0xe7b03bfa906a4c4f2a696ad253f9815a55eafb50f6aa52b121128c8d5cef4329';

const fixtureManifest = {
  network: { type: 'localnet', rpcUrl: 'http://127.0.0.1:9000' },
  packages: {
    deepbook: { packageId: FIXTURE_PACKAGE_ID, objects: [] },
  },
  pools: {
    DEEP_SUI: {
      poolId:
        '0x111b6627ccc814eff84c10bc1a1f647559f352310c11c2e492244a125c53cfe3',
      baseCoinType:
        '0xb60903240f8a6006ebc861d9b0cd672b63caf7a5fcf3b588cc697c2af625fa84::deep::DEEP',
      quoteCoinType: '0x2::sui::SUI',
    },
    SUI_USDC: {
      poolId:
        '0x697f5f0f2d2d351d54be6e10a9491af344ea23eaf2485e10463c3800398aed13',
      baseCoinType: '0x2::sui::SUI',
      quoteCoinType:
        '0x3fefe1eac271f6d449bdc8428d1ddb8017817c140f76308ab0ca5ebc1f2b5b61::usdc::USDC',
    },
  },
};

describe('manifest loader', () => {
  it('T-001 enumerates all pool descriptors from a fixture deployment manifest', async () => {
    const manifestPath = await writeFixture(fixtureManifest);

    const result = await loadManifest(manifestPath);

    expect(result.pools).toHaveLength(
      Object.keys(fixtureManifest.pools).length,
    );

    const byPoolId = new Map<string, PoolDescriptor>(
      result.pools.map((p) => [p.poolId, p]),
    );

    // Each declared pool round-trips its three load-bearing identifiers.
    for (const [, raw] of Object.entries(fixtureManifest.pools)) {
      const got = byPoolId.get(raw.poolId);
      expect(got, `descriptor for poolId ${raw.poolId}`).toBeDefined();
      expect(got!.poolId).toBe(raw.poolId);
      expect(got!.baseCoinType).toBe(raw.baseCoinType);
      expect(got!.quoteCoinType).toBe(raw.quoteCoinType);
    }
  });

  it('T-002 extracts the deployed DeepBook package id (no hard-coded fallback)', async () => {
    const manifestPath = await writeFixture(fixtureManifest);

    const result = await loadManifest(manifestPath);

    expect(typeof result.deepbookPackageId).toBe('string');
    expect(result.deepbookPackageId).toBe(FIXTURE_PACKAGE_ID);

    // Adversarial check: a manifest with a different (non-default) package id
    // must produce that different package id, never a baked-in fallback.
    const otherFixture = {
      ...fixtureManifest,
      packages: {
        deepbook: { packageId: '0x' + 'a'.repeat(64), objects: [] },
      },
    };
    const otherPath = await writeFixture(otherFixture, 'other.json');
    const other = await loadManifest(otherPath);
    expect(other.deepbookPackageId).toBe('0x' + 'a'.repeat(64));
    expect(other.deepbookPackageId).not.toBe(FIXTURE_PACKAGE_ID);
  });

  it('T-003 throws an actionable error naming the manifest path and bootstrap recipe when missing', async () => {
    const missingPath = path.join(
      tmpdir(),
      `mstats-missing-${Date.now()}-does-not-exist.json`,
    );

    await expect(loadManifest(missingPath)).rejects.toSatisfy(
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        const msg = err.message;
        // The error must name the missing manifest path …
        if (!msg.includes(missingPath)) return false;
        // … and must reference the sandbox bootstrap recipe so the inline
        // error UI can surface it. We accept either the canonical command
        // or its directory marker, but at least one must be present.
        const referencesBootstrap =
          msg.includes('pnpm deploy-all') ||
          msg.includes('deepbook-sandbox') ||
          msg.includes('deploy-all');
        return referencesBootstrap;
      },
    );
  });

  it('T-004 rejects a manifest missing the pools key', async () => {
    const broken = { network: fixtureManifest.network, packages: fixtureManifest.packages };
    const manifestPath = await writeFixture(broken);

    await expect(loadManifest(manifestPath)).rejects.toSatisfy(
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        // Validation error must mention the missing key explicitly so it
        // can never be confused with "no pools" (which is a different,
        // semantically valid state).
        return /pools/i.test(err.message);
      },
    );
  });
});
