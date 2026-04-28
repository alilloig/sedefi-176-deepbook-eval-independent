# Cycle Plan

This plan turns `.forge/spec.md` into ordered cycles. Each cycle traces back
to spec acceptance criteria verbatim and names which `## E2E Tests` scenarios
it brings online (status: stub | mock | real).

Cross-cycle invariants (workspace boundary, forbidden-read boundary, source
attribution, stack pins) live in `spec.md` and are not re-stated here. Every
cycle inherits them.

The Slot 3 work is split into three sub-cycles (3a, 3b, 3c) because the
dependency chain (Move on-chain -> keeper consumes vault events + on-chain
prices -> UI consumes both) is real, and per-cycle TDD discipline benefits
from smaller increments. Each sub-cycle ends with its own consolidated
review; the final E-003 / E-004 / E-006 sign-off lands inside Cycle 3c.
For AC mapping purposes, "the Slot-3 cycle" referenced in spec AC3.18 means
the union of Cycles 3a + 3b + 3c, and AC3.18 is therefore validated at the
end of Cycle 3c (the final Slot-3 sub-cycle).

The Cycle 4 docs pass is a Phase-F-style consolidation: no red/green test
loop, one consolidated review, and source-attribution discipline (every
bullet in `FEEDBACK.md` cites a `raw-friction.log` line by timestamp).

---

## Cycle 1 -- Slot 1 Market Stats

- Goal: Build the read-only Slot 1 dashboard that enumerates pools from the
  sandbox manifest and renders per-pool market statistics sourced from the
  DeepBook indexer REST surface.
- Acceptance criteria delivered: AC1.1, AC1.2, AC1.3, AC1.4, AC1.5, AC1.6,
  AC1.7.
- E2E scenarios brought online:
  - E-001 -- status: real.
- Files in scope:
  - `independent/01-market-stats/package.json`
  - `independent/01-market-stats/tsconfig.json`
  - `independent/01-market-stats/vite.config.ts`
  - `independent/01-market-stats/index.html`
  - `independent/01-market-stats/notes/chain-shape.md`
  - `independent/01-market-stats/src/**/*.ts`
  - `independent/01-market-stats/src/**/*.tsx`
  - `independent/raw-friction.log` (append-only)
- Dependencies: none (first build cycle).
- Decision Gates:
  - **G-Boot** (pre-cycle). Sandbox boots cleanly via
    `cd ~/workspace/deepbook-sandbox/sandbox && pnpm deploy-all`; manifest
    `sandbox/deployments/localnet.json` is written; ports `:9000` (Sui RPC),
    `:9008` (indexer REST), and `:9010` (oracle status) all respond. If
    not, halt and escalate to the user before any red-phase work.
  - **G-PoolShape** (pre-red-phase, renamed from G-Schema after the
    Phase-0 indexer-broken finding — see spec.md "Decision Gates").
    The pool object's inner-state field layout (returned by
    `sui_getObject` on a manifest poolId with `showContent: true`,
    plus any necessary dynamic-field traversal to expose the bid/ask
    book) and a sample DeepBook fill-event payload (returned by
    `suix_queryEvents` filtered to the deployed DeepBook package's
    order module) are captured against the running sandbox. Both
    shapes are documented in
    `independent/01-market-stats/notes/chain-shape.md`. TypeScript
    types in Slot 1 source are derived from that file (AC1.6).

---

## Cycle 2 -- Slot 2 Slippage-Safe Swap (Move wrapper)

- Goal: Implement and test the Move 2024 module that wraps DeepBook's
  no-manager `swap_exact_base_for_quote`, asserts the realised output meets
  the caller's `min_out` floor with a documented named error code, and
  routes leftovers (input residual + DEEP fee coin) back to the sender.
- Acceptance criteria delivered: AC2.1, AC2.2, AC2.3, AC2.4, AC2.5, AC2.6,
  AC2.7.
- E2E scenarios brought online:
  - E-002 -- status: real.
  - E-005 -- status: real.
- Files in scope:
  - `independent/02-slippage-swap/Move.toml`
  - `independent/02-slippage-swap/sources/**/*.move`
  - `independent/02-slippage-swap/tests/**/*.move`
  - `independent/raw-friction.log` (append-only)
- Dependencies: Cycle 1 complete (G-Boot still passing; sandbox up). Cycle
  2 does not depend on Slot 1 source, only on the live sandbox and the
  bundled DeepBook external package.
- Decision Gates: none beyond G-Boot inherited from Cycle 1.

---

## Cycle 3a -- Slot 3 Move package (Vault<T>)

- Goal: Implement and unit-test the `Vault<T>` shared object plus
  create / withdraw / trigger entry functions and the `VaultCreated` /
  `TriggerFired` events. Use the no-manager swap path on trigger.
- Acceptance criteria delivered: AC3.1, AC3.2, AC3.3, AC3.4, AC3.5, AC3.6.
- E2E scenarios brought online:
  - E-007 -- status: stub. The Move-side abort assertions for "non-owner
    withdraw" and "withdraw on triggered vault" exist as Move unit tests
    in this cycle (AC3.5), but the E-007 scenario itself requires a
    running keeper to fire the trigger end-to-end and is not yet
    exercisable. Promoted to real in Cycle 3b.
  - E-003 -- status: stub. Move-side creation and trigger entries exist
    and emit events, but no UI / keeper to drive them end-to-end.
  - E-004 -- status: stub. Withdraw entry exists and unit-tests pass,
    but no UI to drive it.
  - E-006 -- status: stub. No UI vault list yet.
- Files in scope:
  - `independent/03-tpsl-vault/move/Move.toml`
  - `independent/03-tpsl-vault/move/sources/**/*.move`
  - `independent/03-tpsl-vault/move/tests/**/*.move`
  - `independent/raw-friction.log` (append-only)
- Dependencies: Cycle 2 complete (proves the no-manager swap pattern and
  the `example_contract` Move.toml mirror works end-to-end against the
  bundled DeepBook package).
- Decision Gates:
  - **G-Vault** (in-cycle, contract phase). The vault uses the no-manager
    swap path on trigger (Spec Decision Gates, Open Questions resolution
    A). Only escalate via `AskUserQuestion` if mid-build evidence shows
    the no-manager path is insufficient (e.g., gas blowups, missing
    return values, custodial mismatch). Do NOT silently switch to a
    manager-based path.

---

## Cycle 3b -- Slot 3 Keeper

- Goal: Implement the off-chain TypeScript keeper that subscribes to
  `VaultCreated` events, polls on-chain Pyth `PriceInfoObject`s on a
  configurable 5-10 s interval, evaluates trigger conditions, and submits
  trigger transactions signed with an ephemeral keeper key.
- Acceptance criteria delivered: AC3.7, AC3.8, AC3.9, AC3.10, AC3.11.
- AC3.12 status: this cycle delivers the keeper-side prerequisites for
  AC3.12 (the keeper detects-and-fires half of the documented end-to-end
  demo path is functional and verifiable from the CLI side). Full AC3.12
  delivery requires the UI's create-vault and triggered-state-render
  surfaces, so the AC is formally claimed by Cycle 3c.
- E2E scenarios brought online:
  - E-007 -- status: real. Per spec, E-007 is a CLI scenario whose
    `covers_contract` is `[AC3.3]`; with the keeper now able to fire
    triggers via CLI tooling, the full scenario (non-owner withdraw
    abort, then keeper-fire, then triggered-vault withdraw abort) is
    exercisable end-to-end without the UI.
  - E-003 -- status: stub. UI-driven steps in E-003 are still not
    exercisable.
  - E-004 -- status: stub. UI withdraw control is still missing.
  - E-006 -- status: stub. UI vault list is still missing.
- Files in scope:
  - `independent/03-tpsl-vault/keeper/package.json`
  - `independent/03-tpsl-vault/keeper/tsconfig.json`
  - `independent/03-tpsl-vault/keeper/notes/pyth-shape.md`
  - `independent/03-tpsl-vault/keeper/src/**/*.ts`
  - `independent/raw-friction.log` (append-only)
- Dependencies: Cycle 3a complete and the Slot 3 Move package published
  against the running sandbox (so the keeper has a known module address,
  vault event type, and trigger entry to call).
- Decision Gates:
  - **G-Pyth** (pre-red-phase). One on-chain `PriceInfoObject` (per
    `sandbox/deployments/localnet.json` -> `pythOracles.deepPriceInfoObjectId`
    or `suiPriceInfoObjectId`) is fetched via the SDK; its field layout
    (price / expo / conf / publish_time) is documented in
    `independent/03-tpsl-vault/keeper/notes/pyth-shape.md`. The keeper's
    price-read code references that file (AC3.9 grounding).

---

## Cycle 3c -- Slot 3 UI

- Goal: Implement the React + Vite + dapp-kit-react wallet-connected UI
  that lists owner-filtered vaults, creates vaults via the Move package's
  creation entry, and exposes a withdraw control on non-triggered vaults.
  Triggered vaults render with a clear badge and the output amount routed
  to the owner. Closing this cycle, validate the full end-to-end demo
  path from spec AC3.12 (sandbox boot -> publish -> keeper running ->
  user creates TP vault via UI -> operator pushes price past threshold
  -> keeper detects, fires -> UI reflects triggered state with output
  routed to owner).
- Acceptance criteria delivered: AC3.12, AC3.13, AC3.14, AC3.15, AC3.16,
  AC3.17, AC3.18.
- E2E scenarios brought online:
  - E-003 -- status: real (full UI -> create -> keeper-fire -> UI
    triggered-state path is now exercisable end-to-end).
  - E-004 -- status: real (UI withdraw control on a non-triggered vault).
  - E-006 -- status: real (UI vault list filters strictly by connected
    account).
- Files in scope:
  - `independent/03-tpsl-vault/ui/package.json`
  - `independent/03-tpsl-vault/ui/tsconfig.json`
  - `independent/03-tpsl-vault/ui/vite.config.ts`
  - `independent/03-tpsl-vault/ui/index.html`
  - `independent/03-tpsl-vault/ui/src/**/*.ts`
  - `independent/03-tpsl-vault/ui/src/**/*.tsx`
  - `independent/raw-friction.log` (append-only)
- Dependencies: Cycle 3a (Move package published) and Cycle 3b (keeper
  running) both complete. The UI consumes the same module address the
  keeper consumes, and depends on the keeper to drive the
  triggered-state badge in E-003 and the AC3.12 demo path.
- Decision Gates: none beyond the already-passed G-Boot, G-Pyth, G-Vault
  carried from prior cycles. AC3.18 (cross-component friction-log
  coverage: at least one entry from every relevant source category seen
  during Slot 3 work, evaluated over the union of Cycles 3a + 3b + 3c)
  is verified at the end of this cycle's review.

---

## Cycle 4 -- Documentation pass (RUNBOOK + FEEDBACK)

- Goal: Produce the two non-cycle deliverables. `RUNBOOK.md` lists the
  copy-pasteable bootstrap and per-app run commands derived from the
  verified Cycle 1-3c work. `FEEDBACK.md` distills
  `independent/raw-friction.log` into the three required sections
  (working well / can be improved / not working) with every bullet
  citing a friction-log line by timestamp.
- Acceptance criteria delivered: none (post-cycle deliverables, not in
  the AC numbering scheme; spec "Post-cycle deliverables" section
  governs).
- E2E scenarios brought online: none (E-001 through E-007 are all real
  by the end of Cycle 3c; this cycle only documents the artifacts).
- Files in scope:
  - `independent/RUNBOOK.md`
  - `independent/FEEDBACK.md`
  - `independent/raw-friction.log` (final consolidation pass; still
    append-only, but the consolidator may add re-tag annotations
    inline rather than rewriting prior lines)
- Dependencies: Cycles 1, 2, 3a, 3b, 3c all complete.
- Process notes (per spec "Post-cycle deliverables" + plan section 2):
  - No red/green test loop. One consolidated review pass.
  - Source-attribution discipline is mandatory: `[forge-process]`
    entries are filtered out of `FEEDBACK.md` unless they reveal a
    DeepBook-relevant issue surfaced through orchestration, in which
    case the consolidator re-tags them to the relevant DeepBook source.
  - Every `FEEDBACK.md` bullet must cite a `raw-friction.log` line by
    its `YYYY-MM-DDTHH:MM:SSZ` timestamp.
