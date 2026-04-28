/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the Slot 3 keeper.
 *
 * Environment is `node` (not jsdom): the keeper is a long-running Node.js
 * service. There are no DOM globals to mock; tests exercise pure helpers and
 * spy on `globalThis.fetch` for outbound RPC shape lockdown (Cycle 1
 * T-014 pattern).
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.{test,spec}.ts'],
  },
});
