import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// At dev time we bake the vault registry + deployment into the bundle so the UI
// has zero setup beyond a running sandbox. In a real app these would be
// fetched at runtime or set via VITE_ env vars.
const APP = join(__dirname, "..");
function readJsonSafe(p: string) {
    try {
        return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
        return null;
    }
}

export default defineConfig({
    plugins: [react()],
    define: {
        __DEPLOYMENT__: JSON.stringify(readJsonSafe(join(APP, "deployment.json"))),
        __VAULTS__: JSON.stringify(readJsonSafe(join(APP, "vaults.json")) ?? []),
    },
    server: {
        port: 5175,
        proxy: {
            "/api/sui": { target: "http://127.0.0.1:9000", changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/sui/, "") },
        },
    },
});
