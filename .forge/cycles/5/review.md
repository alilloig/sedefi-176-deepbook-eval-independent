# Cycle 5 — Consolidated Review (Slot 3 UI, React + Vite + dapp-kit-react)

## Verdict

**ACCEPTED.** 10/10 vitest assertions pass. Implementation produces the React + Vite + dapp-kit-react UI per AC3.13-AC3.17. Two orchestrator-amended test issues + one implementation refactor along the way:

1. **dapp-kit.ts top-level await** broke vitest's vi.mock module resolution (vitest's CJS interop layer can't statically resolve a module that uses TLA in some configurations). Refactored to lazy promise pattern (`dAppKitPromise`); `main.tsx` awaits before mounting. Production behavior unchanged.

2. **T-006 regex too broad** — `/(at least one|tp|sl|take[- ]?profit|stop[- ]?loss)/i` matched both the form's TP/SL labels AND the validation error, causing `findByText` to throw "Found multiple elements". Amended to `findByRole('alert')` + textContent-regex (orchestrator-authorized per the test-author "BLOCKED — tests need amendment" path, same as Cycle 2 T-003 + Cycle 3 event-buffer fix + Cycle 4 T-006).

3. **T-001 `require('./dapp-kit')` in ESM context** — package is `"type": "module"`; CommonJS require in test body throws despite vi.mock being registered. Amended to dynamic ESM `await import('./dapp-kit')`.

## What was built

- React 19 + Vite 7 + dapp-kit-react ^2.0.1 + dapp-kit-core ^1.2.2 SPA at `independent/03-tpsl-vault/ui/`.
- 7 source modules (~700 LOC TS+TSX): `dapp-kit.ts`, `manifest.ts`, `useVaultList.ts`, `App.tsx`, `CreateVaultForm.tsx`, `VaultRow.tsx`, `uiDataLayer.ts`, `main.tsx`.
- Mirrors `~/workspace/deepbook-sandbox/sandbox/dashboard/src/dapp-kit.ts` setup (createDAppKit, devWalletInitializer, InMemorySignerAdapter, deployer-key pre-import).
- Vite middleware serves `/localnet.json` from sandbox manifest (Cycle 1 proven pattern).
- Vault list filters by `currentAccount.address`; create-vault form submits PTB via `useDAppKit().signAndExecuteTransaction`; withdraw button on non-triggered vaults; "Triggered" badge + output amount on triggered vaults.

## Cycle 4 lesson application — production path coverage

Cycle 4's T-009 was criticized for stubbing the test seam without exercising production submission. Cycle 5's T-007 + T-008 explicitly assert that the `refresh` callback the test injects is the SAME function the production submit handler calls — preventing the same anti-pattern. T-010 also pins network shape across the production paths via fetch spy.

## Skipped iter-2 review pass

Per user directive ("when the forge is done, ship it") and the established Cycle 1-4 pattern, the 6-reviewer iter-2 verification pass was skipped to advance to the docs cycle. The implementation is functionally complete (10/10 assertions pass), the test amendments are documented above, and remaining concerns (LSP-vs-runtime staleness in the IDE, etc.) are carry-forward observations for `independent/FEEDBACK.md`.

## Carry-forward concerns (for FEEDBACK)

1. **TLA + vitest mock interaction** — `await` at module top level breaks `vi.mock` static resolution under some vitest configs. The lazy-promise workaround keeps tests viable but adds complexity vs the natural top-level-await pattern shown in `~/workspace/deepbook-sandbox/sandbox/dashboard/src/dapp-kit.ts`. Source: `[sui-sdk]` / `[forge-process]`.

2. **dapp-kit-react ^2.0.1 + DAppKitProvider dAppKit prop typing** — the prop is `dAppKit` not `client` (1.x style). Required reading the migration docs to land on the right shape. Source: `[dapp-kit]`.

3. **InMemorySignerAdapter import path** — lives at `@mysten-incubation/dev-wallet/adapters` (incubation namespace). Easy to miss without reading the dashboard source directly. Source: `[dapp-kit]`.

4. **CommonJS require() in ESM tests** — vitest's TS test files default to ESM when `"type": "module"`; `require()` calls in test bodies throw at runtime even though TypeScript accepts them. Subtle inconsistency between Vite tooling defaults and Node's CJS/ESM split. Source: `[forge-process]`.

5. **Recurring LSP-vs-runtime divergence** — TypeScript LSP from worktree-root doesn't index sub-package `node_modules`; `Cannot find module 'react'` etc. diagnostics appear constantly even though `pnpm test` resolves cleanly. Already documented in Cycle 1 / Cycle 4 friction logs. Source: `[forge-process]`.

## Audit trail

- Tests sealed at `independent/03-tpsl-vault/ui/src/*.test.{ts,tsx}` (6 files, 10 assertions across T-001..T-010).
- Implementation at `independent/03-tpsl-vault/ui/src/{dapp-kit,manifest,useVaultList,uiDataLayer,App,CreateVaultForm,VaultRow,main}.{ts,tsx}`.
- Candidate preserved at `cycles/5/green/candidates/worker-1/`.
- Final green log: `cycles/5/green.log` (10/10 PASS).

## Next

Advance to Cycle 6 (Documentation pass — RUNBOOK + FEEDBACK).
