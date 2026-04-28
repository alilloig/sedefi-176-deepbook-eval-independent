/**
 * Tests for the G-PoolShape artifact and its derivation evidence.
 *
 * T-021: notes/chain-shape.md exists and contains both a pool inner-state
 *        capture and a fill-event capture.
 * T-022: at least one TypeScript source file under src/ that defines a
 *        chain-shape-derived type contains a doc-comment or
 *        import-adjacent comment naming notes/chain-shape.md.
 *
 * Both tests are filesystem-based — they don't import the runtime modules.
 * That keeps them independent of the import-error reds for src/ modules.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

describe('chain-shape capture (G-PoolShape)', () => {
  it('T-021 notes/chain-shape.md exists and contains both pool inner-state and fill-event captures', async () => {
    const filePath = path.join(projectRoot, 'notes', 'chain-shape.md');
    const stat = await fs.stat(filePath).catch(() => null);
    expect(stat, `notes/chain-shape.md must exist at ${filePath}`).not.toBeNull();
    expect(stat!.isFile()).toBe(true);

    const content = await fs.readFile(filePath, 'utf8');
    expect(content.length).toBeGreaterThan(200); // not a stub

    // Pool inner-state capture markers.
    const poolMarkers = [
      /sui_getObject/i,
      /(book|asks|bids)/i,
    ];
    for (const m of poolMarkers) {
      expect(
        m.test(content),
        `chain-shape.md missing pool-state marker ${m}`,
      ).toBe(true);
    }

    // Fill-event capture markers.
    const fillMarkers = [
      /suix_queryEvents/i,
      /(orderinfo|orderfilled|orderplaced|fills?)/i,
    ];
    for (const m of fillMarkers) {
      expect(
        m.test(content),
        `chain-shape.md missing fill-event marker ${m}`,
      ).toBe(true);
    }
  });

  it('T-022 at least one src/ TypeScript file references notes/chain-shape.md as derivation source', async () => {
    const srcDir = path.join(projectRoot, 'src');

    // Walk src/ recursively for *.ts / *.tsx and look for a comment
    // mentioning chain-shape.md (or notes/chain-shape.md).
    async function walk(dir: string): Promise<string[]> {
      const out: string[] = [];
      const stat = await fs.stat(dir).catch(() => null);
      if (!stat || !stat.isDirectory()) return out;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          out.push(...(await walk(p)));
        } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) {
          out.push(p);
        }
      }
      return out;
    }

    const tsFiles = await walk(srcDir);
    expect(
      tsFiles.length,
      `expected at least one TypeScript source file under ${srcDir}`,
    ).toBeGreaterThan(0);

    let referencingFile: string | null = null;
    for (const f of tsFiles) {
      const content = await fs.readFile(f, 'utf8');
      if (/chain-shape\.md/i.test(content)) {
        referencingFile = f;
        break;
      }
    }

    expect(
      referencingFile,
      'no src/ file references notes/chain-shape.md as derivation source',
    ).not.toBeNull();
  });
});
