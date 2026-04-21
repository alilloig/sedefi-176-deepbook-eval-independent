# 01 · Order Book Viewer

A tiny read-only React dApp that queries the DEEP/SUI order book from a running
**DeepBook Sandbox** localnet and renders a live depth chart.

## What it does

- Fetches the deployment manifest from the sandbox faucet (`http://localhost:9009/manifest`)
- Builds a `@mysten/deepbook-v3` client against the localnet RPC (`http://localhost:9000`)
- Reads the mid price and Level 2 order book every 3 seconds
- Renders ask/bid stacks as a simple horizontal bar chart (no charting lib)

No wallet connection, no signing — this is purely a sandbox smoke test for the
indexer/market-maker/RPC chain from the browser.

## Why it's interesting for the sandbox

It exercises three pieces of the stack that a dapp developer will hit first:

1. **Manifest discovery** via the faucet `/manifest` endpoint
2. **RPC from a browser** (CORS, gRPC-Web vs JSON-RPC, port 9000)
3. **SDK `deepbook()` extension** with custom package/coin/pool maps

If anything here fails, the rest of DeepBook integration will too.

## Quick start

```bash
cd apps/01-orderbook-viewer
pnpm install   # or npm install
pnpm dev       # http://localhost:5174
```

The app assumes the sandbox is already up (`cd deepbook-sandbox/sandbox && pnpm deploy-all`).

See `../RUNBOOK.md` for the full orchestration.
