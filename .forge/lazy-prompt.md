# SEDEFI-176 Independent Solution — lazy prompt for /forge

The user invoked `/code-forge-v2:forge` with the entire `independent/faena.md` brief as the lazy prompt. The brief is a self-contained handoff document for executing Linear ticket SEDEFI-176 — Deepbook Sandbox UX/DevX evaluation with Claude — as an *independent* second-pass solution. The full content of that brief is in `independent/faena.md` (already on disk). Read it from there rather than from this file.

## Quick orientation for the forge-orchestrator

- **Repo:** `~/workspace/deepbook-sandbox-evaluation-apps/` (working in worktree `.claude/worktrees/alilloig+SEDEFI-176/`).
- **Existing solution at repo root:** `01-orderbook-viewer/`, `02-fee-rebate-swap/`, `03-dca-vault/`, `FEEDBACK.md`, `RUNBOOK.md`. **Forbidden to read** the substantive content of any of these (function bodies, READMEs, FEEDBACK/RUNBOOK bodies). Allowed: directory names, manifest metadata, framework identification from imports.
- **Independent work goes under `independent/`** only.
- **Read-only dependency:** `~/workspace/deepbook-sandbox` (the DeepBook Sandbox monorepo). Do not modify it.
- **Brief location:** `independent/faena.md` (already exists; treat as the canonical statement of intent).

## Locked-in scope (verbatim from the brief)

Three apps under `independent/` plus a runbook and a structured FEEDBACK doc:

1. **`01-market-stats/`** — single-route React + Vite app. Cross-pool aggregate stats (24h volume, last/mid price, spread, depth at ±1% from mid, 50-trade sparkline). Polls indexer REST `:9008` and Sui RPC `:9000`. No wallet. ~200-300 LOC TS.
2. **`02-slippage-swap/`** — single Move 2024 module wrapping DeepBook v3's swap with a slippage check; one entry function + unit tests. ~100-150 LOC Move.
3. **`03-tpsl-vault/`** — Stop-loss / Take-profit vault. Move package + Node.js keeper (polls Pyth oracle at `:9010`) + React UI with `dapp-kit-react`. Auto-executes a market order when TP/SL trigger fires. ~400-500 LOC combined.

Plus:
- **`independent/RUNBOOK.md`** — clone-to-test instructions for all three apps.
- **`independent/FEEDBACK.md`** — three required sections (working well / can be improved / not working — needs fix or refactoring), ≥3 concrete bullets each, sourced from a friction log kept during the build.

## What the protocol must wrestle with

This task is unusual for code-forge in two ways:

1. **The deliverable is partly qualitative.** `FEEDBACK.md` captures DevX friction observed *during* the build. There is no test the green phase can satisfy for "the friction log is honest and concrete." Phase F (e2e) is more relevant for end-to-end app behavior than for the documentation.
2. **The brief is already mature.** Section 6 ("Locked-in app picks") and Sections 7-12 already specify the spec, execution sequence, validation plan, risks, and open questions. Phase 0 (claudex) and Phase 1 (spec) may largely confirm rather than refine — the orchestrator should let claudex still run for sanity but expect rapid convergence, and should plan around the documentation deliverable explicitly.

## Constraints to respect across all phases

- **Localnet only.** Sandbox bootstrap = `cd ~/workspace/deepbook-sandbox/sandbox && pnpm install && pnpm deploy-all` (auto-publishes packages, starts indexer/oracle/faucet/market-maker, opens dashboard at `:5173`).
- **pnpm**, **TypeScript**, **Move 2024.beta**.
- **Sui SDK 2.x.** Always read `.ts-sdk-docs/sui/migrations/sui-2.0/*.mdx` (sui-pilot bundled docs) before touching `@mysten/*` imports — training memory is stale.
- **DeepBook SDK pin:** match `^1.2.1` (dashboard) for slot 1 / slot 3 UI. Match `^1.1.5` (examples) only if a specific reason emerges.
- **Move dep on DeepBook:** mirror `~/workspace/deepbook-sandbox/sandbox/packages/example_contract/Move.toml` exactly. Don't reinvent.
- **No reading the existing solution.** If accidentally encountered, stop and note the breach in `FEEDBACK.md`.

## Open questions (from §11 of faena.md, to resolve during build)

1. **Vault<T> shape** (slot 3) — shared (default) or owned? Affects keeper trigger model.
2. **Pool selection** (slot 1) — enumerate from `sandbox/deployments/localnet.json` (default) or hard-code DEEP/SUI + SUI/USDC?
3. **Indexer REST schema** — confirm endpoints empirically against a running sandbox before writing TS types.
4. **Slippage `min_out` units** (slot 2) — match what DeepBook's swap helper returns.

## Hand-off

Phase 0 (claudex) will refine this prompt and surface clarifications. The full brief in `independent/faena.md` is the canonical source — this file is just the entry point.
