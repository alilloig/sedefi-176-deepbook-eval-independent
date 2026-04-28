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

export default defineConfig({
  plugins: [react()],
  server: {
    // CR-3: serve /localnet.json from the sandbox deployments directory.
    // The middleware intercepts GET /localnet.json before Vite's static handler.
    configureServer(server) {
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
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
  },
});
