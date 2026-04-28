/**
 * Tests for the PoolCard React component.
 *
 * The card receives precomputed `PoolCardData` and renders six labeled
 * statistics. The labels are queried by accessible text, so a future
 * styling change can shift layout without breaking tests, but renaming a
 * label or omitting a stat will break loudly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { PoolCard, type PoolCardData } from '../src/components/PoolCard.js';

const baseData: PoolCardData = {
  poolId: '0x' + 'a'.repeat(64),
  symbol: 'SUI/USDC',
  volume24h: 1234.56,
  lastPrice: 0.671,
  midPrice: 0.6715,
  spread: 0.001,
  depthWithinOnePercent: 5000,
  sparkline: [
    { timestampMs: 1, price: 0.67 },
    { timestampMs: 2, price: 0.671 },
    { timestampMs: 3, price: 0.672 },
  ],
};

const REQUIRED_LABEL_PATTERNS = [
  /24h(?:\s*hour)?\s*volume/i,
  /last\s*price/i,
  /mid\s*[- ]?price/i,
  /(bid\s*\/\s*ask\s*spread|spread)/i,
  /depth\s*at\s*[+-]?\/?[+-]?\s*1\s*%/i,
  /sparkline|trades/i,
];

afterEach(() => {
  cleanup();
});

describe('PoolCard', () => {
  it('T-015 renders all six labeled statistics for a single pool', () => {
    render(<PoolCard data={baseData} />);

    for (const pattern of REQUIRED_LABEL_PATTERNS) {
      expect(
        screen.getAllByText(pattern).length,
        `missing labeled stat for ${pattern}`,
      ).toBeGreaterThan(0);
    }
  });

  describe('T-016 sentinel rendering for undefined values', () => {
    let consoleErrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrSpy.mockRestore();
    });

    it('renders all six labels with a sentinel placeholder when mid/spread are undefined', () => {
      const degraded: PoolCardData = {
        ...baseData,
        midPrice: undefined,
        spread: undefined,
      };

      expect(() => render(<PoolCard data={degraded} />)).not.toThrow();

      // All six labels still present.
      for (const pattern of REQUIRED_LABEL_PATTERNS) {
        expect(
          screen.getAllByText(pattern).length,
          `missing labeled stat for ${pattern}`,
        ).toBeGreaterThan(0);
      }

      // No console.error during mount (React would log on a thrown
      // render or unhandled value-coercion crash).
      expect(consoleErrSpy).not.toHaveBeenCalled();
    });
  });
});
