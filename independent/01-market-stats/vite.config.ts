/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * CR-3 fix: A Vite dev-server middleware serves `/localnet.json` directly
 * from `~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json`.
 *
 * Choice documented here (forge-process): the Vite middleware approach was
 * selected over a `public/` symlink because it avoids a manual setup step,
 * works across dev environments without filesystem state, and keeps the build
 * output clean (the manifest is not bundled into `dist/`).
 */
const MANIFEST_DISK_PATH = path.join(
  homedir(),
  'workspace',
  'deepbook-sandbox',
  'sandbox',
  'deployments',
  'localnet.json',
);

// configureServer is a Vite Plugin hook, NOT a `server: ServerOptions` field.
// Placing it under `server: {}` causes Vite to silently drop the middleware
// and serve the SPA shell on /localnet.json.
const manifestMiddlewarePlugin = {
  name: 'manifest-middleware',
  configureServer(server: { middlewares: { use: (path: string, fn: (req: unknown, res: { setHeader: (k: string, v: string) => void; statusCode: number; end: (s: string) => void }) => void) => void } }) {
    server.middlewares.use('/localnet.json', async (_req, res) => {
      try {
        const content = await fs.readFile(MANIFEST_DISK_PATH, 'utf8');
        res.setHeader('content-type', 'application/json');
        res.statusCode = 200;
        res.end(content);
      } catch {
        const msg = JSON.stringify({
          error: `localnet.json not found at ${MANIFEST_DISK_PATH}. Run pnpm deploy-all from the deepbook-sandbox repo.`,
        });
        res.setHeader('content-type', 'application/json');
        res.statusCode = 404;
        res.end(msg);
      }
    });
  },
};

export default defineConfig({
  plugins: [react(), manifestMiddlewarePlugin],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
  },
});
