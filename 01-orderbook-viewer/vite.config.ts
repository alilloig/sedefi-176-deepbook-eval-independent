import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The sandbox exposes: RPC :9000, faucet :9009, oracle :9010.
// Proxy them through vite so the browser avoids CORS preflights.
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5174,
        proxy: {
            "/api/sui": { target: "http://127.0.0.1:9000", changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/sui/, "") },
            "/api/faucet": { target: "http://127.0.0.1:9009", changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/faucet/, "") },
            "/api/oracle": { target: "http://127.0.0.1:9010", changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/oracle/, "") },
        },
    },
});
