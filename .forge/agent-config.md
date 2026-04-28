---
project_domains: []

required_subagents:
  - match: "**/*.move"
    subagent_type: "sui-pilot:sui-pilot-agent"
    applies_to: [planner, implementer-worker, reviewer]
  - match: "**/Move.toml"
    subagent_type: "sui-pilot:sui-pilot-agent"
    applies_to: [planner, implementer-worker]

recommended_agents:
  - subagent_type: "sui-pilot:sui-pilot-agent"
    rationale: "Primary Sui Move and DeepBook ecosystem specialist; user-favored. Slot 2 and Slot 3 Move packages route here unconditionally; Slot 3 keeper and Slot 1 indexer client should also consult sui-pilot for SDK 2.x stale-memory checks before any @mysten/* import."
    suitable_for: [planner, test-author, implementer, implementer-worker, reviewer]
    domain_relevance: high

  - subagent_type: "impeccable:anti-patterns"
    rationale: "Frontend / TypeScript anti-patterns specialist; user-favored. Best fit for reviewing Slot 1 React+Vite SPA and Slot 3 React+dapp-kit-react UI code, plus the Slot 3 Node keeper TypeScript."
    suitable_for: [reviewer]
    domain_relevance: medium

  - subagent_type: "superpowers:code-reviewer"
    rationale: "User-favored general code reviewer (superpowers plugin). Useful as a second-pass reviewer on the Slot 1 frontend, the Slot 3 keeper, and the Slot 3 UI for issues outside the Move/sui-pilot beat."
    suitable_for: [reviewer]
    domain_relevance: medium

  - subagent_type: "feature-dev:code-explorer"
    rationale: "Codebase exploration specialist (feature-dev plugin). Best fit for the empirical-confirmation gates: G-Schema (curl indexer + capture payloads), G-Pyth (read on-chain PriceInfoObject + document layout), and any cross-cycle investigation of the read-only sandbox tree at ~/workspace/deepbook-sandbox."
    suitable_for: [planner, implementer-worker]
    domain_relevance: medium

  - subagent_type: "feature-dev:code-architect"
    rationale: "Architectural advisor (feature-dev plugin). Useful for the Slot 3 Move package design pass before the red phase, and for cross-component consistency between vault on-chain shape, keeper PTB construction, and UI transaction submission."
    suitable_for: [planner]
    domain_relevance: medium

  - subagent_type: "feature-dev:code-reviewer"
    rationale: "General reviewer (feature-dev plugin). Available as a fall-through reviewer for off-chain TS work where the impeccable + superpowers reviewers have already opined."
    suitable_for: [reviewer]
    domain_relevance: low

  - subagent_type: "pr-review-toolkit:silent-failure-hunter"
    rationale: "Silent-failure detector (pr-review-toolkit). High-value pass over the Slot 3 keeper (where 'log and skip' on a missing PriceInfoObject read is exactly the kind of silent-failure the audience for FEEDBACK.md should learn about) and over the Slot 1 indexer fetch error paths."
    suitable_for: [reviewer]
    domain_relevance: medium

  - subagent_type: "pr-review-toolkit:type-design-analyzer"
    rationale: "TS type-design specialist (pr-review-toolkit). Best fit for reviewing the indexer-schema-derived TypeScript types in Slot 1 (AC1.6) and for the Slot 3 keeper's PriceInfoObject parsing types."
    suitable_for: [reviewer]
    domain_relevance: medium
---

# Routing decisions

## Detection signals

This repo is unambiguously a Sui ecosystem project, with two parallel
detection signals that — under a properly-scoped `project_domains` rule —
would set `project_domains: [sui-dapp]`:

- `~/workspace/deepbook-sandbox/sandbox/packages/example_contract/Move.toml`
  exists and is the canonical template the Slot 2 and Slot 3 Move packages
  must mirror (per spec Cross-Cutting Invariants and AC2.1). The
  `independent/` work will produce two new `Move.toml` + `*.move` trees
  (Slot 2 and Slot 3 Move package).
- The sandbox dashboard's `package.json` and the spec's
  Architecture Overview pin `@mysten/sui ^2.14.1`,
  `@mysten/deepbook-v3 ^1.2.1`, `@mysten/dapp-kit-react ^2.0.1`, and
  `@mysten/dapp-kit-core ^1.2.2`. Slot 1 frontend, Slot 3 keeper, and
  Slot 3 UI all consume these packages.

There is no `walrus.toml` or `seal_id` usage in scope, so `walrus` and
`seal` would not be added either.

### v0.2.0 design tension — `project_domains` is empty by necessity

`project_domains` is set to `[]` (empty) instead of `[sui-dapp]`. Reason:
forge-guard rule 6 (`checkSpecialistRouting`) interprets a non-empty
`project_domains` containing any `sui-*` domain as "force
`subagent_type=sui-pilot:sui-pilot-agent` for **every** Task dispatch in
this project, regardless of role." This conflates two different things:

1. *This codebase contains Move artifacts and Sui SDK consumers*
   (true; Move-glob hard binding handled below).
2. *Every orchestration role — planner, test-author, implementer
   coordinator, consolidator, reviewer dimensions — must be a Move
   expert and use sui-pilot's tool surface*
   (NOT true; orchestration roles need their own tools — e.g., the
   forge-planner needs `mcp__codex__codex` for G2.5 and G5 gates,
   which sui-pilot does not have).

Routing the planner through sui-pilot strips Codex tools and breaks the
Phase 2 / per-cycle contract gates. Filed as a v0.2.0 bug at
`/Users/alilloig/workspace/code-forge/.claude/worktrees/forge-beta/docs/BUG-orchestrator-spawned-no-agent-tool.md`
(amended with this finding).

**Pragmatic workaround for this run:** keep `project_domains: []` and rely
on `required_subagents` below for Move-artifact correctness binding (it
already scopes via `applies_to`, which is the right granularity).
Sui SDK 2.x stale-memory checks for off-chain TS work fall through to the
soft routing in `recommended_agents` (sui-pilot is surfaced first there).

## `required_subagents` (correctness-grade hard routing)

- `**/*.move` and `**/Move.toml` route to `sui-pilot:sui-pilot-agent`
  for planner, implementer-worker, and reviewer roles. This is the
  smallest correctness-grade binding: Move source and Move package
  manifests must always be touched by an agent that has the bundled
  Sui / Move Book / DeepBook / Pyth doc index loaded, because the
  spec's hard rules (no-manager swap path, edition 2024, Move.toml
  mirrors example_contract exactly) require those docs.
- `Move.toml` is matched as `**/Move.toml` (not bare `Move.toml`) so
  both `independent/02-slippage-swap/Move.toml` and
  `independent/03-tpsl-vault/move/Move.toml` are caught.
- TypeScript files are NOT in `required_subagents`. Spec
  Cross-Cutting Invariants do require any agent touching `@mysten/*`
  imports to consult the bundled SDK 2.0 migration docs, but that's
  a soft routing recommendation (handled via `recommended_agents`
  surfacing sui-pilot for off-chain TS work too), not a hard
  correctness binding — the off-chain TS work is mostly thin
  glue (indexer fetch, PriceInfoObject parse, dapp-kit-react form
  submission) where general TS reviewers contribute meaningfully.

## `recommended_agents` (user-favoritism + soft routing)

The user's `~/.claude/settings.json` enables (relevant subset):
`sui-pilot@contract-hero`, `impeccable@impeccable`,
`superpowers@claude-plugins-official`,
`feature-dev@claude-plugins-official`,
`pr-review-toolkit@claude-plugins-official`,
`chrome-devtools-mcp@claude-plugins-official`,
`code-review@claude-plugins-official`,
`code-simplifier@claude-plugins-official`.

Per the planner agent definition's user-favoritism rule, sui-pilot,
impeccable, and superpowers/* are surfaced first regardless of
secondary scoring. After that the list is ordered by
`domain_relevance` desc.

Concretely:

- **sui-pilot** (high). Already a hard requirement for Move artifacts;
  also surfaced first in recommendations because it is the only agent
  that loads the Sui SDK 2.x migration docs and the DeepBook /
  Pyth / Walrus / Seal indices. Keeper TS work (Slot 3) and indexer
  client work (Slot 1) should consult it for SDK 2.x stale-memory
  checks before any `@mysten/*` import is written.
- **impeccable:anti-patterns** (medium). Frontend / TS anti-patterns
  reviewer; user-favored. Highest soft-routing fit for Slot 1 React+Vite
  SPA review and Slot 3 React+dapp-kit-react UI review, plus a useful
  pass over the Slot 3 keeper TS.
- **superpowers:code-reviewer** (medium). User-favored. Generic reviewer
  for any cycle; complements impeccable on TS off-chain work.
- **feature-dev:code-explorer** (medium). Best fit for the empirical
  gates (G-Schema curl + capture, G-Pyth on-chain object read +
  layout doc) and for cross-cycle exploration of the read-only sandbox
  tree, where a strong codebase-explorer agent reduces wasted reads.
- **feature-dev:code-architect** (medium). Useful for the Slot 3 Move
  package design pass before the red phase (vault state machine,
  trigger gating, swap call shape) and for cross-component
  consistency reviews.
- **feature-dev:code-reviewer** (low). Fall-through reviewer for
  off-chain TS where impeccable + superpowers have already opined;
  kept available, low-priority.
- **pr-review-toolkit:silent-failure-hunter** (medium). High-value
  on the Slot 3 keeper specifically — the "log and skip on missing
  PriceInfoObject" failure mode is exactly the kind of silent
  failure that, if shipped, would also be the kind of DevX-relevant
  observation for FEEDBACK.md to call out.
- **pr-review-toolkit:type-design-analyzer** (medium). Targeted at
  the indexer-schema-derived TS types (AC1.6) and the keeper's
  PriceInfoObject parse types. These are the two off-chain
  type-design surfaces with the most leverage.

## What is NOT recommended and why

- `chrome-devtools-mcp` is enabled and is named in spec E-001, E-003,
  E-004, E-006 as the e2e tooling. It is a tool, not an agent role,
  so it is referenced inline in the e2e scenarios (`tooling:
  chrome-devtools-mcp`) rather than listed under `recommended_agents`.
- `code-review` and `code-simplifier` plugins are enabled but provide
  generic review/simplifier passes that are subsumed by the more
  targeted `pr-review-toolkit:*` and `impeccable:anti-patterns`
  agents recommended above. Surfacing them would dilute the routing
  signal.
- `playwright` and `playground` plugins are disabled in
  `~/.claude/settings.json`; not surfaced.
- Linear / Notion / Slack / GitHub plugins are disabled; not
  surfaced.

## Forbidden-read interaction with routing

The spec's Cross-Cutting Invariants prohibit any subagent dispatch
over `01-orderbook-viewer/`, `02-fee-rebate-swap/`,
`03-dca-vault/`, `FEEDBACK.md`, and `RUNBOOK.md` at the repo root.
This is enforced at the orchestrator level (per dispatch), not at
the routing-config level — `agent-config.md` does not encode it.
Every dispatched agent must additionally honor that forbidden-read
boundary by inheriting the spec's Cross-Cutting Invariants.
