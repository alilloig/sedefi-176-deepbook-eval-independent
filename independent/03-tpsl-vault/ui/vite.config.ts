/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Cycle 1 proven pattern: serve `/localnet.json` directly from the sandbox
 * deployments directory via a dev-server middleware. Avoids `public/` drift
 * and a manual setup step.
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
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
