# Cycle 4 Contract — Slot 3 Keeper (Node.js TS, sub-cycle 3b of Slot 3)

## Goal

Deliver a Node.js + TypeScript service under
`independent/03-tpsl-vault/keeper/` that watches the deployed `tpsl_vault`
package's `VaultCreated` events to maintain a registry of known vaults,
polls the on-chain Pyth `PriceInfoObject`s named in the sandbox's
deployment manifest on a configurable 5-10 s interval, evaluates each
vault's TP/SL trigger condition against the parsed Pyth price, and on
condition-met builds and submits an `execute_trigger<Base, Quote>`
transaction signed with an ephemeral keeper key. Every poll cycle and
every trigger fire is logged to stdout in a structured, parseable
(line-delimited JSON) format so operators and the Cycle 5 UI / E-007
test harness can assert on the keeper's behavior. The Move package and
its events / entry signature are taken as given (Cycle 3a, sealed).

This cycle delivers AC3.7 through AC3.11 verbatim and the keeper-side
half of AC3.12 (the "keeper detects, fires" leg of the documented
end-to-end demo path is functional and verifiable from CLI tooling
without a UI). The full AC3.12 deliverable (sandbox boot → publish →
keeper running → user creates TP vault via UI → operator pushes price →
keeper detects, fires → UI reflects triggered state with output coin
routed to owner) is formally claimed by Cycle 5 (UI), per cycle-plan
Cycle 3b's stated AC3.12 status.

## Behavior

The keeper is a long-running service started from the package's `start`
script. At boot it:

1. Reads the sandbox deployment manifest at
   `~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json`
   (path overridable via the `SANDBOX_MANIFEST_PATH` env var). It pulls
   out, at minimum:
   - `network.rpcUrl` — the Sui RPC URL (`http://127.0.0.1:9000` on the
     bundled localnet).
   - `packages.deepbook.packageId`, `packages.pyth.packageId` — needed
     for module-qualified move-call targets and event filters.
   - `packages.token.packageId` — needed because the trigger swap
     consumes a `Coin<DEEP>` and `DEEP`'s type tag is rooted at the
     token package id.
   - `pythOracles.deepPriceInfoObjectId`,
     `pythOracles.suiPriceInfoObjectId` — the two on-chain
     `PriceInfoObject`s the keeper polls.
   - `pools[]` — used to map a vault's `pool_id` field to the pool's
     `baseCoinType` / `quoteCoinType` (so the keeper can supply the
     correct generic type arguments to `execute_trigger<Base, Quote>`),
     and to map the vault's pool to the right Pyth price object pair
     (DEEP for the DEEP/SUI pool, SUI for the SUI/USDC pool).
2. Reads the deployed `tpsl_vault` package's address from the keeper's
   own configuration. The `tpsl_vault` package is published outside the
   manifest (the sandbox manifest only carries the four sandbox-bundled
   packages). The keeper accepts the address via the
   `TPSL_VAULT_PACKAGE_ID` env var; the package id is reproducible by
   running `sui client publish` against the running sandbox from
   `independent/03-tpsl-vault/move/`.
3. Generates an ephemeral Ed25519 keypair via the SDK (no key
   persistence; localnet only — spec.md "Non-Functional Requirements
   > Security"). Logs the keeper address at boot. The keeper requests
   gas from the localnet faucet at `network.faucetUrl` if its balance
   is insufficient to fund a single `execute_trigger` call; failure to
   fund halts the boot with a clear error.
4. Constructs a Sui SDK 2.x client. The implementer SHOULD prefer
   `SuiGrpcClient` from `@mysten/sui/grpc` (the model the sandbox's
   own `scripts/market-maker/` uses — see
   `~/workspace/deepbook-sandbox/sandbox/scripts/market-maker/price-feed.ts`
   for the canonical Pyth read pattern) but `SuiJsonRpcClient` from
   `@mysten/sui/jsonRpc` is also acceptable provided the network field
   is set explicitly per SDK 2.0 (the per-cycle implementer reads
   `.ts-sdk-docs/sui/migrations/sui-2.0/sui.mdx` and
   `.ts-sdk-docs/sui/migrations/sui-2.0/json-rpc-migration.mdx` BEFORE
   choosing). The choice is logged and documented in the cycle review.

After boot, the keeper enters two concurrent loops:

**Vault discovery loop.** Polls for `VaultCreated` events emitted by
the `tpsl_vault` package on a recurring interval; this is the
required baseline implementation this cycle (per "Contract decisions"
#1 below — the spec leaves discovery cadence open per "Open Questions
> Slot 3 vault discovery cadence" and this contract resolves that
ambiguity in favor of polling). Subscription via the SDK 2.x event
subscription API is optional and may be layered on top if the SDK 2.x
docs the implementer reads at task time recommend it; polling alone
satisfies AC3.8 per spec's "(with polling as an acceptable fallback)"
parenthetical. The keeper reuses Cycle 1's
proven `suix_queryEvents` pattern (per `independent/raw-friction.log`
2026-04-27T21:47:00Z): the `MoveModule` filter selects on the
**transactionModule** (the module that emits the event), so the
filter must be `{ MoveModule: { package: TPSL_VAULT_PACKAGE_ID,
module: "tpsl_vault" } }`, NOT a filter on the event struct's
declaring module. The keeper maintains an in-memory
`Map<vaultId, KnownVault>` where each `KnownVault` carries the
`vault_id`, `owner`, `pool_id`, `side`, `tp_price`, `sl_price`,
`deposit_amount`, and a derived `(baseCoinType, quoteCoinType,
basePriceInfoObjectId, quotePriceInfoObjectId)` resolved from the
manifest. New vaults are appended; the keeper does not need to handle
re-org rewinds on localnet (single-node, no re-orgs in practice).
Catalog reconciliation (comparing the in-memory map to a fresh full
re-query) MAY be done at keeper shutdown / restart but is not
required.

**Price + trigger loop.** On a configurable interval (default 5000
ms; configurable via `KEEPER_POLL_INTERVAL_MS` in the closed range
[5000, 10000] per AC3.9 — values outside this range halt boot with
an `EBadConfig`-style error message), the keeper:

1. Reads each manifest-named `PriceInfoObject` via `devInspect` /
   `simulateTransaction` of `pyth::pyth::get_price_unsafe(price_info)`.
   The reference implementation in
   `~/workspace/deepbook-sandbox/sandbox/scripts/market-maker/price-feed.ts`
   shows the canonical pattern: build a `Transaction`, call
   `${pythPackageId}::pyth::get_price_unsafe`, run
   `simulateTransaction` with `checksEnabled: false` and
   `include: { commandResults: true }`, read the BCS bytes from
   `result.commandResults?.[0]?.returnValues?.[0]?.bcs`, and decode
   the `Price` struct (price.negative: 1 byte, price.magnitude: 8
   bytes u64 LE, conf: 8 bytes u64 LE, expo.negative: 1 byte,
   expo.magnitude: 8 bytes u64 LE, timestamp: 8 bytes u64 LE). The
   keeper exposes the parsed price as
   `{ magnitude: bigint, exponent: bigint, conf: bigint,
   publishTimeSeconds: bigint }`. Per Decision Gate G-Pyth, the BCS
   layout, the BCS bytes the read returns on the running sandbox,
   the field semantics, and the price formula the keeper applies
   (see step 2) MUST be documented in
   `independent/03-tpsl-vault/keeper/notes/pyth-shape.md` BEFORE the
   keeper's price-read code is written; that file is referenced by
   the keeper's `pythReader.ts` (or equivalent) source comment, and
   the path is load-bearing per spec G-Pyth (the implementer
   reproduces the pattern, does not rely on training memory).
2. Computes the `current_price` value the Move contract expects.
   `tpsl_vault::execute_trigger`'s `current_price: u64` argument is
   the same scale as the vault's `tp_price` / `sl_price` fields,
   which per Cycle 3 contract are stored as `Option<u64>`. The
   keeper's pricing model: for a `Pool<Base, Quote>`, current_price
   represents "1 unit of Base (in atomic units, 10^baseDecimals)
   priced in atomic units of Quote (10^quoteDecimals)", i.e. the
   same convention the sandbox market-maker's
   `calculateBaseQuotePrice` produces — it reads base and quote USD
   prices from Pyth and computes `(baseMagnitude * 10^(quoteDecimals
   + baseExpo - quoteExpo)) / quoteMagnitude`. The keeper SHOULD
   reuse that formula verbatim. For each known vault, the keeper
   resolves its `pool_id` to the pool's base / quote coin types and
   decimal counts (from the manifest's `pools[]` entries), reads the
   corresponding two Pyth PriceInfoObjects, applies the formula, and
   obtains a single `u64 current_price` for that vault.
3. Evaluates the trigger condition exactly as the Move contract
   does (Cycle 3 contract Behavior section): TP fires if
   `tp_price.is_some && current_price >= tp_price`; SL fires if
   `sl_price.is_some && current_price <= sl_price`. If neither
   holds the vault is skipped for this poll cycle.
4. For each vault whose condition fires AND whose `triggered` flag
   is not already set in keeper memory, the keeper builds a
   programmable transaction calling
   `${TPSL_VAULT_PACKAGE_ID}::tpsl_vault::execute_trigger<Base,
   Quote>` with the vault object reference (shared object — the
   keeper passes it as `tx.object(vaultId)`, the SDK resolves
   shared-object initial shared version), the pool object reference
   (`tx.object(poolId)`, also shared), the computed `current_price`
   as a `pure(u64)`, a `Coin<DEEP>` argument sourced from the
   keeper's own DEEP balance via `tx.splitCoins` (the keeper
   pre-funds itself via the localnet faucet plus a one-shot
   transfer of DEEP from the manifest's pre-minted treasury — this
   prefunding step is NOT in scope for automation here, but the
   keeper MUST detect a missing-DEEP-balance condition and log a
   clear actionable error rather than silently failing), the system
   Clock at `0x6` (`tx.object("0x6")` — `tx.object.clock()` if the
   SDK exposes it), and signs+submits via the keeper's ephemeral
   keypair. The signing path uses
   `client.signAndExecuteTransaction` (or
   `signAndExecute`-equivalent in the chosen client variant, per
   the SDK 2.0 docs).
5. On successful trigger fire, the keeper marks the vault's
   `triggered` flag in its in-memory map (so subsequent polls
   within the same process do not double-fire) and logs a
   structured `trigger_fired` line including the trigger
   transaction digest, the vault id, the parsed `current_price`
   that satisfied the gate, and the on-chain `TriggerFired` event
   payload (read via `client.getTransactionBlock` / equivalent on
   the digest, OR via the events returned in the `signAndExecute`
   response — the keeper SHOULD prefer the latter when the SDK
   exposes it). On failed trigger fire (e.g., the on-chain
   assertion failed because another keeper or caller raced ahead,
   or the price moved back between condition-check and
   tx-execution), the keeper logs the abort code in the structured
   failure line and continues; the same vault is not blacklisted —
   if the price re-crosses the threshold on a subsequent poll, the
   keeper retries.

**Logging contract.** Every poll cycle emits one `poll_cycle` line.
Every fire attempt emits one `trigger_attempt` line and one of
`trigger_fired` / `trigger_failed`. Every vault discovery emits one
`vault_discovered` line. Every Pyth read failure emits one
`pyth_read_failed` line. Format is line-delimited JSON; one JSON
object per line, each object carries at minimum
`{ ts: ISO8601 string, level: "info"|"warn"|"error", event: <event
name>, ... }`. A small set of additional event-specific fields per
line is required (vault_id, current_price, tx_digest as applicable —
see the Acceptance criteria section). Log lines go to stdout
unconditionally; `KEEPER_LOG_LEVEL` (default `info`) gates additional
debug events. This format makes the keeper's behavior assertable
from the Cycle 5 E-003 / E-007 test harness via simple line-by-line
parsing.

**Lifecycle.** The keeper installs `SIGINT` and `SIGTERM` handlers
that stop the two loops, drain in-flight transactions, log a
`keeper_shutdown` line, and exit zero. There is no persistent state
to flush.

**No promises this cycle does NOT make.** The keeper does not retry
on Sui RPC outages beyond a single attempt per poll cycle (the next
poll cycle is the retry). The keeper does not re-read past
`VaultCreated` events on restart unless the discovery path is
implemented as a cursor-tracked poll (recommended; see
"Implementation guidance" below). The keeper does not validate
manifest schema beyond the field presence checks listed in step 1 of
boot. The keeper does not attempt to detect that the `tpsl_vault`
package address was upgraded (the spec assumes a single deployment).

### Contract decisions resolving spec ambiguities

Three spec-level questions surface for the keeper that the spec
leaves to the implementer. This contract resolves them so the
implementer does not re-relitigate:

1. **Vault discovery — subscription vs polling vs hybrid.** Spec
   AC3.8 reads "subscribing to creation events from the deployed
   package (with polling as an acceptable fallback)". This contract
   takes the spec's "polling as an acceptable fallback" wording as
   the path of least resistance for this cycle and requires the
   keeper to ship a polling implementation: every K seconds (default
   5, same cadence as the price loop, but cursor-tracked
   independently) the keeper issues a `suix_queryEvents` against the
   `tpsl_vault` package + module `tpsl_vault` from its last-seen
   cursor, filtering on the `VaultCreated` event type. Subscription
   may be added as a follow-on if the SDK 2.x docs the implementer
   reads at task time recommend it; the polling implementation
   alone is sufficient for AC3.8 compliance per the spec's
   parenthetical. The choice (and any subscription experiment) is
   documented in the cycle review.

2. **DEEP fee coin sourcing for the trigger transaction.** The
   `execute_trigger` entry takes `deep_in: Coin<DEEP>`. Cycle 3a's
   contract decision #3 routes the DEEP residual back to
   `vault.owner` rather than the trigger caller, so the keeper does
   NOT recover DEEP it spends on triggers. This contract requires
   the keeper to: (a) at boot, accept a prefunded keeper-DEEP coin
   object id via the `KEEPER_DEEP_COIN_ID` env var (sourced
   manually from the `token` package's pre-minted DEEP treasury
   entry in the manifest); (b) on each trigger fire, split a
   minimal DEEP amount (default 100_000_000 atomic units = 1 DEEP)
   from that coin via `tx.splitCoins(tx.object(KEEPER_DEEP_COIN_ID),
   [tx.pure.u64(KEEPER_DEEP_PER_TRIGGER)])` and pass the resulting
   coin handle as the `deep_in` argument; (c) log a
   `low_deep_balance` warning when the keeper's DEEP balance falls
   below a configurable reserve threshold (default 10 DEEP). This
   is the simplest model that lets the keeper actually fire
   triggers without a more elaborate DEEP-acquisition pipeline that
   is out of scope for this slot.

3. **Vault `triggered` ground-truth on restart.** The `triggered`
   flag is on-chain state. The keeper's in-memory `Map` is a cache.
   On startup, before entering the trigger loop, the keeper SHOULD
   re-read each known vault's on-chain state via
   `client.getObject(vaultId)` (with `showContent: true`) and seed
   `triggered` from there; without this seeding, a keeper restart
   immediately after a fire would attempt a doomed-to-abort
   `execute_trigger` retry. The keeper's discovery-loop poll
   already re-fetches `VaultCreated` events from cursor-zero on
   restart by default (cursor is in-memory only this cycle), so the
   catalog is reconstructed every restart; pairing that with a
   per-vault on-chain `triggered` read is the consistent design.
   The implementer MAY persist the cursor across restarts, but
   this is out of scope for AC3.8 (the spec only requires that the
   keeper "discovers vaults", not that the cursor survive restart).

### Implementation guidance (non-binding)

The following non-binding guidance reflects what worked in the
sandbox's own market-maker and Cycle 1's `dataLayer.ts`, and what
recurring friction-log lessons predict will trip up an implementer
who writes from training memory:

- **Sui SDK 2.x stale-memory rule.** Before authoring any
  `@mysten/sui/*` import, the implementer reads the SDK 2.0
  migration doc set in this exact order:
  1. `.ts-sdk-docs/sui/migrations/sui-2.0/index.mdx` (cross-package
     overview).
  2. `.ts-sdk-docs/sui/migrations/sui-2.0/sui.mdx` (the
     `@mysten/sui` package specifically).
  3. `.ts-sdk-docs/sui/migrations/sui-2.0/json-rpc-migration.mdx`
     (if the implementer chooses `SuiJsonRpcClient`).
  4. `.ts-sdk-docs/sui/clients/grpc.mdx` and
     `.ts-sdk-docs/sui/clients/json-rpc.mdx` (client instantiation,
     network parameter requirements, ESM-only constraints).
  Training memory predates 2.0; the constructor signatures, the
  hook / provider names, and the transaction-submit method shapes
  have all changed. (See `independent/raw-friction.log` Cycle 1
  entries on `suix_queryEvents` `MoveModule` filter semantics —
  that surprise is a member of the same family of stale-memory
  failures.)

- **No stub pipelines.** Cycle 1 friction-log entry
  2026-04-27T22:55:00Z calls out a "structural fix that doesn't
  actually wire through" failure mode that repeated twice in Slot 1
  green-phase iterations. Every source file the keeper produces
  must carry data end-to-end against the running sandbox: a
  `pythReader` module that returns `{ magnitude: 0n, exponent: 0n
  }` placeholder values to "make tests green" is a regression. The
  cycle's acceptance criteria (in particular AC3.10, AC3.11)
  require the end-to-end keeper-detects-and-fires path to be
  functional and observable in the logs against the running
  sandbox.

- **`suix_queryEvents` MoveModule filter semantics.** Per
  `independent/raw-friction.log` 2026-04-27T21:47:00Z, the SDK 2.x
  `suix_queryEvents` `MoveModule` filter selects on the
  **transactionModule** (the module that emitted the event), not
  the event struct's declaring module. For the `tpsl_vault`
  package, the filter is therefore
  `{ MoveModule: { package: TPSL_VAULT_PACKAGE_ID, module:
  "tpsl_vault" } }`. A type-name filter like `{ MoveEventType:
  "<package>::tpsl_vault::VaultCreated" }` is also acceptable and
  is more precise; the implementer chooses one and documents it.

- **Shared-object handling.** `Vault<T>` and `Pool<Base, Quote>`
  are both shared. The SDK 2.x `tx.object(id)` resolves
  shared-object references automatically given the SDK can fetch
  the `initial_shared_version` from chain; if the keeper hits a
  "shared-object initial version not provided" error class, the
  workaround is to pass `tx.sharedObjectRef({ objectId, mutable,
  initialSharedVersion })` explicitly after one
  `client.getObject(id)` to learn the initial version. The pool is
  passed `mutable: true` (DeepBook mutates the order book on swap);
  the vault is also `mutable: true` (the entry mutates `triggered`
  and drains the balance).

- **Generic type arguments.** `execute_trigger<Base, Quote>`
  requires the type tags (e.g., `0xb609...::deep::DEEP` and
  `0x...::sui::SUI` for the DEEP/SUI pool). The keeper resolves
  these from the manifest's `pools[]` entries, NOT from training
  memory. Type tags are passed via `tx.moveCall({ target,
  typeArguments: [base, quote], arguments: [...] })`.

- **Failure mode visibility.** Trigger transactions can abort with
  `EVaultTriggered` (someone raced ahead),
  `ETriggerConditionNotMet` (price moved back between check and
  exec), or `EWrongPool` (manifest drift — should not happen in
  practice on a single-deployment localnet). The keeper logs the
  abort code if the SDK surfaces it; otherwise the transaction
  effects' status is logged and the abort code parsed from the
  error message string.

## In scope

- A single Node.js + TypeScript package rooted at
  `independent/03-tpsl-vault/keeper/` with these files:
  - `package.json` declaring:
    - `"name": "@independent/03-tpsl-vault-keeper"`, `"private":
      true`, `"version": "0.0.1"`, `"type": "module"` (per spec
      Architecture: SDK 2.x is ESM-only).
    - Dependencies (pinned to spec.md "Architecture Overview > Tech
      stack"): `"@mysten/sui": "^2.14.1"`. Other `@mysten/*`
      packages may be added if the SDK 2.0 docs the implementer
      reads recommend extracting a sub-client (e.g.,
      `@mysten/sui/grpc` is a sub-path of `@mysten/sui` and does
      NOT require a separate package; `@mysten/sui/jsonRpc`
      likewise).
    - Dev dependencies: `"typescript": "~5.9.3"`, `"vitest":
      "^3.2.0"` (for any unit tests of pure helpers),
      `"@types/node": "^24.0.0"`. The implementer MAY add `tsx` or
      `ts-node` equivalents to enable a `dev` script that runs the
      keeper without a separate build step; either choice is
      acceptable provided the production-mode `start` script also
      works after `pnpm build`.
    - Scripts: `"start"` (runs the keeper from compiled output or
      via `tsx` — implementer's choice), `"build"` (`tsc`),
      `"test"` (`vitest run`). A `dev` script that watches sources
      and restarts the keeper is recommended but not required.
  - `tsconfig.json` configured per Sui SDK 2.0 ESM requirements:
    `"module": "NodeNext"` (or `"ESNext"`),
    `"moduleResolution": "NodeNext"` (or `"Bundler"`),
    `"target": "ES2022"`, `"strict": true`, `"esModuleInterop":
    true`, `"skipLibCheck": true`, `"outDir": "./dist"`,
    `"rootDir": "./src"`. Other compiler settings are at the
    implementer's discretion.
  - `notes/pyth-shape.md` — the G-Pyth deliverable. Documents:
    - The exact Pyth `PriceInfoObject` IDs in the running sandbox
      manifest (`deepPriceInfoObjectId`, `suiPriceInfoObjectId`).
    - The exact bytes returned by a single call to
      `pyth::pyth::get_price_unsafe` against the DEEP price object,
      captured against the live sandbox.
    - The BCS field layout the keeper decodes (price.negative,
      price.magnitude, conf, expo.negative, expo.magnitude,
      timestamp), with a worked example: bytes → parsed numbers →
      "DEEP/USD = X" interpretation.
    - The price-conversion formula (the keeper-side mirror of the
      sandbox market-maker's `calculateBaseQuotePrice`) and a
      worked example for DEEP/SUI showing how `current_price` ends
      up as a `u64` the Move `tp_price` / `sl_price` comparisons
      accept.
    - A note on staleness: `publish_time` is parsed and exposed
      but the keeper does NOT enforce a max-age check this cycle
      (the sandbox's own oracle-service drives publish times and
      the keeper trusts them on localnet). Defense-in-depth checks
      are out of scope.
    The keeper's `pythReader.ts` (or equivalent) source comment
    must reference this file by relative path. The path is
    load-bearing per spec G-Pyth.
  - `src/**/*.ts` — the keeper implementation. Module decomposition
    is at the implementer's discretion; the suggested decomposition
    (mirroring the sandbox market-maker's clean separation that
    Cycle 1 friction-logged as a strength) is:
    - `src/index.ts` — entry point. Loads config, constructs
      client, generates ephemeral keypair, requests faucet
      funding, kicks off both loops, installs signal handlers.
    - `src/config.ts` — env var parsing, validation, and the
      `Config` type. Halts boot on bad config with a clear
      message.
    - `src/manifest.ts` — manifest loader; resolves vault
      `pool_id` to `(baseCoinType, quoteCoinType, baseDecimals,
      quoteDecimals, basePriceInfoObjectId,
      quotePriceInfoObjectId)`.
    - `src/pythReader.ts` — wraps `pyth::pyth::get_price_unsafe`
      simulation and BCS decode; returns
      `{ magnitude, exponent, conf, publishTimeSeconds }`.
      References `notes/pyth-shape.md` in its module comment.
    - `src/priceModel.ts` — the
      `calculateBaseQuotePrice(base, quote, quoteDecimals)`
      formula lifted from the sandbox market-maker, exposed as a
      pure function (no SDK dependencies — vitest-testable in
      isolation).
    - `src/vaultRegistry.ts` — the `VaultCreated` event poller,
      the cursor-tracked `Map<vaultId, KnownVault>`, and the
      on-startup `triggered`-flag re-seed via `getObject`.
    - `src/triggerEvaluator.ts` — pure function that takes
      `(KnownVault, current_price)` and returns
      `{ shouldFire, reason }` (reason ∈
      `"tp"|"sl"|"none"|"already_triggered"`). Mirrors the Move
      contract's condition logic exactly.
    - `src/triggerSubmitter.ts` — builds the `execute_trigger`
      programmable transaction (move call + DEEP coin split +
      clock object), signs with the ephemeral key, submits via
      the chosen client variant, parses the response for the
      `TriggerFired` event payload and tx digest.
    - `src/logger.ts` — line-delimited JSON logger; minimum field
      set on every line `{ ts, level, event, ... }`. Honors
      `KEEPER_LOG_LEVEL`.
    The implementer MAY collapse or split this layout differently
    provided each AC is satisfied by a real source file (no stub
    pipelines — see Implementation guidance above).
  - Optional `src/**/*.test.ts` files (vitest) for the pure
    modules (`priceModel.ts`, `triggerEvaluator.ts`,
    `pythReader.ts`'s BCS decoder). These are NOT required for AC
    compliance but are recommended; AC3.10 / AC3.11 are validated
    end-to-end against the live sandbox, not via unit tests. If
    the implementer ships unit tests they must use `vitest run`
    (matching the Cycle 1 stack).

- Friction observations appended to `independent/raw-friction.log`
  during this cycle. AC3.18 (cross-Slot-3 friction-log coverage)
  is formally validated at the end of Cycle 5, but Cycle 4 should
  append at least one observation per source category it actually
  exercises during this cycle's work. Realistic categories for
  this cycle are `[sui-sdk]` (event filter semantics,
  `simulateTransaction` pattern, ephemeral keypair / faucet flow,
  network constructor argument), `[deepbook]` (any DEEP-balance
  acquisition friction), `[sandbox]` (any manifest schema or
  oracle-service friction surfaced while iterating), `[move]`
  (only if a regression in the Cycle 3 contract surfaces — the
  keeper is read-only against the Move package this cycle).
  `[dapp-kit]` is NOT expected (Cycle 5). The post-cycle review
  compares the produced log entries against this expectation and
  notes any drift.

## Out of scope

- The wallet-connected React + Vite UI for vault list / create /
  withdraw (Cycle 5 — spec ACs 3.13 to 3.17). The keeper exposes
  no HTTP / IPC surface for the UI to consume; the UI consumes
  the same on-chain state the keeper does (Sui RPC for vault
  list, Sui RPC events for trigger detection from the user side).

- The end-to-end UI-driven AC3.12 demo path. AC3.12 in full
  requires the UI's create-vault and triggered-state-render
  surfaces; this cycle delivers the keeper-side
  "detects-and-fires" leg only, verifiable via CLI tooling
  (manual `sui client call` to create a vault, manual
  market-mover trade to push the price, observation of the
  keeper's `trigger_fired` log line, and `sui client object` on
  the vault to see `triggered: true`).

- E-003, E-004, E-006 promotion to real. These are UI scenarios
  (`tooling: chrome-devtools-mcp`); their UI-side steps remain
  unexercisable until Cycle 5. Per cycle-plan Cycle 3b, only
  E-007 promotes to real this cycle.

- The Move package itself, its tests, its build, and its publish.
  Cycle 3a sealed the Move package; this cycle imports its
  address via env var only.

- On-chain Pyth integration in the Move contract. The Move side
  trusts the keeper-supplied `current_price` (per Cycle 3
  review's "current_price not on-chain verified" intentional
  design); this cycle does not revisit that decision.

- Persistent storage of the keeper's vault registry, cursor, or
  triggered-flag cache. The keeper rebuilds state from on-chain
  reads on every restart.

- Production-grade keeper key management. The ephemeral keypair
  is generated in-process at boot, never persisted, never logged
  in full (the keeper logs the address; never the private key
  seed).

- DEEP balance acquisition automation. The operator funds the
  keeper's DEEP coin manually by transferring a `Coin<DEEP>` from
  the manifest's pre-minted treasury entry; the keeper consumes
  that coin id via `KEEPER_DEEP_COIN_ID` env var.

- Multi-vault parallel trigger submission. The keeper may submit
  triggers serially (one per loop tick) or in parallel; either is
  acceptable. There is no spec-level concurrency requirement.

- Slot 1 (`independent/01-market-stats/`) and Slot 2
  (`independent/02-slippage-swap/`) sources. Out of scope per
  files-in-scope glob; the proven Cycle 1 patterns
  (`suix_queryEvents` filter shape, BCS handling, friction-log
  format) MAY be referenced and learned from but their source
  files are NOT imported.

- Any source under `01-orderbook-viewer/`, `02-fee-rebate-swap/`,
  `03-dca-vault/`, `FEEDBACK.md`, or `RUNBOOK.md` at the repo
  root (forbidden-read boundary inherited from spec.md
  "Cross-Cutting Invariants > Forbidden-read boundary" — the
  prior solution's Slot-3 equivalent at `03-dca-vault/` must NOT
  be opened).

- Modifying the sandbox tree at `~/workspace/deepbook-sandbox`
  (read-only dependency per spec). The keeper imports manifest
  data by reading the JSON file; it does not modify the sandbox.

- Testnet / devnet / mainnet operation. Localnet only.

- `RUNBOOK.md` and `FEEDBACK.md` documentation (final docs cycle
  deliverable, post all three Slot-3 sub-cycles per cycle-plan).

- Modifying `.forge/spec.md`, `.forge/cycle-plan.md`,
  `.forge/agent-config.md`, or any prior cycle's contract /
  review.

## Files

- `independent/03-tpsl-vault/keeper/package.json`
- `independent/03-tpsl-vault/keeper/tsconfig.json`
- `independent/03-tpsl-vault/keeper/notes/pyth-shape.md`
- `independent/03-tpsl-vault/keeper/src/**/*.ts`
- `independent/raw-friction.log` (append-only)

## Acceptance criteria

- AC3.7: Keeper is a TypeScript Node.js service whose Sui and
  DeepBook SDK pins match the sandbox dashboard.
  - Verification: `independent/03-tpsl-vault/keeper/package.json`
    declares `"@mysten/sui": "^2.14.1"` (matching spec
    "Architecture Overview > Tech stack and pinned versions").
    `"type": "module"` is set (SDK 2.x is ESM-only).
    `tsconfig.json` sets `"moduleResolution": "NodeNext"` or
    `"Bundler"`, `"target": "ES2022"`. `pnpm install` exits zero;
    `pnpm build` exits zero (the TypeScript compiler reports no
    errors). The keeper does NOT import the legacy 1.x
    `@mysten/sui.js` package or any 1.x-only sub-path. **DeepBook
    SDK pin (resolves the "DeepBook SDK pins match the sandbox
    dashboard" half of this AC):** this cycle does NOT permit a
    `@mysten/deepbook-v3` (or any other DeepBook helper SDK)
    dependency in `package.json`. The keeper consumes DeepBook
    exclusively via the direct Move-call path (`tx.moveCall` against
    `${TPSL_VAULT_PACKAGE_ID}::tpsl_vault::execute_trigger`) — the
    `tpsl_vault` Move package is the keeper's only DeepBook
    interaction surface, and that surface is already type-checked by
    the published Move package. Adding `@mysten/deepbook-v3` would
    pull in a separate version-coupled abstraction layer the keeper
    does not need (the trigger transaction has a fixed three-arg
    shape: vault, pool, current_price + DEEP coin + clock — all
    expressible directly via `@mysten/sui` `Transaction`). The
    sandbox dashboard uses `@mysten/deepbook-v3` because the
    dashboard renders DeepBook book / order data; the keeper
    renders nothing. If a future cycle (e.g., the UI in Cycle 5)
    determines a DeepBook helper is needed, that cycle's contract
    pins the version against the spec table; this cycle's keeper
    `package.json` MUST NOT carry it. The AC's "DeepBook SDK pins
    match the sandbox dashboard" wording is satisfied vacuously by
    the absence of a DeepBook SDK dependency (no pin to mismatch).
    The cycle review documents this resolution.
- AC3.8: The keeper discovers vaults by subscribing to creation
  events from the deployed package (with polling as an acceptable
  fallback).
  - Verification: at boot and on a recurring interval, the keeper
    issues `suix_queryEvents` (or the SDK 2.x equivalent
    `client.queryEvents` shape) against the `tpsl_vault` package
    with a filter that matches `VaultCreated` events. The filter
    structure follows Cycle 1's friction-log finding
    (2026-04-27T21:47:00Z): `MoveModule` selects on the emitting
    module (`module: "tpsl_vault"`) — alternatively the keeper
    may use a `MoveEventType` filter targeting
    `<TPSL_VAULT_PACKAGE_ID>::tpsl_vault::VaultCreated`. New
    event payloads are decoded into `KnownVault` records
    (`vault_id`, `owner`, `pool_id`, `side`, `tp_price`,
    `sl_price`, `deposit_amount`) and inserted into the keeper's
    in-memory registry. The cursor is tracked per loop tick so
    the same event is not re-processed. The keeper logs a
    `vault_discovered` line (per the AC3.11 logging contract)
    for each new vault. To verify end-to-end on the live
    sandbox: with the keeper running, an operator publishes the
    `tpsl_vault` package, calls `create_vault`, and observes a
    `vault_discovered` line in the keeper's stdout within one
    polling interval. (Per "Contract decisions" #1, the
    implementer is free to additionally try the SDK's
    subscription API; polling alone satisfies the AC.)
- AC3.9: The keeper polls on-chain Pyth `PriceInfoObject`s on a
  configurable interval in the 5-10 second range and parses
  price and exponent.
  - Verification: the keeper exposes `KEEPER_POLL_INTERVAL_MS`
    as a config knob (read from env or a config file at the
    implementer's discretion); the default is between 5000 and
    10000 ms inclusive; values outside [5000, 10000] are
    rejected at boot with a clear error. The price-loop tick
    reads the two `PriceInfoObject`s named in
    `manifest.pythOracles.{deepPriceInfoObjectId,
    suiPriceInfoObjectId}` via the
    `pyth::pyth::get_price_unsafe(price_info)` simulation /
    devInspect pattern documented in `notes/pyth-shape.md` and
    decodes the BCS-returned `Price` struct into
    `{ magnitude: bigint, exponent: bigint, conf: bigint,
    publishTimeSeconds: bigint }`. Both magnitude and exponent
    are parsed (negativity bytes are handled per the Pyth Price
    BCS layout). G-Pyth is satisfied: `notes/pyth-shape.md`
    exists, documents the BCS layout against captured
    live-sandbox bytes, and is referenced by the `pythReader`
    source's module comment BEFORE the parsing code is written.
    To verify end-to-end: with the keeper running and no vaults
    active, `poll_cycle` log lines appear at the configured
    interval and each line includes the parsed DEEP and SUI
    Pyth prices.
- AC3.10: For each known vault, the keeper evaluates the
  trigger condition; on fire, it builds and submits a
  transaction calling the vault's trigger entry signed with an
  ephemeral keeper key.
  - Verification: each price-loop tick iterates the vault
    registry, computes the per-vault `current_price` (via the
    keeper-side `calculateBaseQuotePrice` mirror of the sandbox
    market-maker formula, applied to the vault's pool's
    base/quote Pyth prices and decimals), and applies the same
    condition logic the Move contract uses (TP fires if
    `tp_price.is_some && current_price >= tp_price`; SL fires if
    `sl_price.is_some && current_price <= sl_price`). On fire,
    the keeper builds a programmable transaction with the move
    call `${TPSL_VAULT_PACKAGE_ID}::tpsl_vault::execute_trigger
    <Base, Quote>` (type tags resolved from the vault's pool
    entry in the manifest), arguments `[tx.object(vaultId),
    tx.object(poolId), tx.pure.u64(currentPrice), <split DEEP
    coin>, tx.object("0x6")]`, signs with the ephemeral Ed25519
    keypair generated at boot, and submits via the SDK 2.x
    `signAndExecuteTransaction` (or chosen-client equivalent).
    The keeper detects abort responses, parses the abort code if
    available, logs a `trigger_failed` line, and continues. To
    verify end-to-end: with the keeper running, an operator
    creates a TP vault via CLI, pushes the on-chain price past
    the threshold (manual market-mover trade), and within one
    polling interval the keeper logs a `trigger_fired` line
    whose `tx_digest` corresponds to a successful on-chain
    transaction with a `TriggerFired` event referencing the
    vault id, AND `sui client object <vaultId>` shows
    `triggered: true`.
- AC3.11: The keeper logs each poll cycle and each trigger fire
  to stdout in a structured, parseable format.
  - Verification: the keeper emits stdout lines as
    line-delimited JSON. Required event names and minimum
    fields:
    - `keeper_started`: `{ ts, level, event, keeper_address,
      tpsl_vault_package_id, poll_interval_ms }`.
    - `vault_discovered`: `{ ts, level, event, vault_id, owner,
      pool_id, tp_price, sl_price, side }`.
    - `poll_cycle`: `{ ts, level, event,
      prices: [ { object_id, magnitude, exponent } ],
      known_vault_count }`.
    - `trigger_attempt`: `{ ts, level, event, vault_id,
      current_price, reason }` (`reason` ∈ `"tp" | "sl"`).
    - `trigger_fired`: `{ ts, level, event, vault_id,
      current_price, tx_digest, quote_out_amount,
      base_residual_amount, deep_residual_amount }` (the
      residual amounts are read back from the on-chain
      `TriggerFired` event).
    - `trigger_failed`: `{ ts, level, event, vault_id,
      current_price, tx_digest_or_null,
      abort_code_or_message }`.
    - `pyth_read_failed`: `{ ts, level, event, object_id,
      error }`.
    - `keeper_shutdown`: `{ ts, level, event, signal }`.
    Each line is a single valid JSON object terminated by
    `\n`. `ts` is an ISO-8601 UTC string. The keeper does NOT
    log the ephemeral keypair's secret bytes, only the public
    address. The implementer MAY add additional fields per
    line and additional debug-level events gated on
    `KEEPER_LOG_LEVEL`. To verify:
    `node dist/index.js | head -20 | jq -c .` (or equivalent
    `cat <log> | jq` against captured stdout) parses every
    line cleanly; `grep '"event":"poll_cycle"'` shows lines at
    the configured interval; `grep '"event":"trigger_fired"'`
    after a manual trigger scenario shows exactly one line per
    fire with the documented field set.
- AC3.12 (keeper-side prerequisites only — full AC formally
  claimed by Cycle 5 per cycle-plan):
  - Verification: the "keeper detects-and-fires" leg of the
    AC3.12 demo path is functional and verifiable from CLI
    tooling against the running sandbox without any UI.
    Concrete CLI verification sequence (this cycle's "real"
    promotion of E-007 exercises this path top-to-bottom):
    1. Sandbox is up; `tpsl_vault` package published; keeper
       running with valid `TPSL_VAULT_PACKAGE_ID` and
       `KEEPER_DEEP_COIN_ID` env vars; keeper's
       `keeper_started` log line appeared.
    2. An operator creates a TP vault via `sui client call`
       targeting `tpsl_vault::create_vault` with a
       take-profit price reachable by a sandbox-side
       market-mover trade.
    3. Within one `KEEPER_POLL_INTERVAL_MS` interval, the
       keeper logs a `vault_discovered` line carrying the new
       vault id.
    4. The operator runs a sandbox-side market-mover trade
       sufficient to push the on-chain Pyth-derived
       `current_price` past the vault's TP.
    5. Within one `KEEPER_POLL_INTERVAL_MS` interval after
       the price update lands, the keeper logs a
       `trigger_attempt` followed by a `trigger_fired` line
       referencing the vault id and a successful on-chain tx
       digest.
    6. `sui client object <vaultId> --json` reports
       `triggered: true`; querying events of the
       `trigger_fired` tx digest confirms a `TriggerFired`
       event with the matching vault id was emitted.
    7. **Owner-routed output verification (keeper-side
       prerequisite for the spec's "output coin routed to the
       owner" obligation):** the trigger transaction's
       owned-objects diff (read via `sui client tx-block
       <tx_digest> --json` or equivalent) shows the
       `Coin<Quote>`, the `Coin<Base>` residual, and the
       `Coin<DEEP>` residual all owned by the vault's `owner`
       address (NOT the keeper's ephemeral address). This
       proves the keeper's PTB shape is correct end-to-end:
       the on-chain Move contract's
       `transfer::public_transfer(*, vault.owner)` calls land
       on the right target because the keeper supplied the
       right vault object reference. (Routing is enforced by
       the Move contract per Cycle 3 contract decision #3;
       this step proves the keeper participated correctly so
       the routing actually fires.) The keeper's
       `trigger_fired` log line additionally exposes
       `quote_out_amount`, `base_residual_amount`, and
       `deep_residual_amount` from the on-chain `TriggerFired`
       event payload, which the Cycle 5 UI consumes to render
       AC3.17. The full AC3.12 deliverable (which adds "user
       creates TP vault via UI" in step 2 and "UI reflects the
       triggered state" in step 6) is claimed by Cycle 5;
       this cycle satisfies the keeper-side prerequisites
       including the owner-routing verification step.

## E2E coverage

This cycle promotes one scenario to real and leaves three at
stub:

- **E-007** (`slot 3 withdraw is rejected on triggered vaults
  and rejected for non-owner callers`, kind `cli`,
  `covers_contract: [AC3.3]`) — status: **real** (per
  cycle-plan Cycle 3b). With the keeper now able to drive
  `execute_trigger` against a known vault from CLI tooling,
  the full E-007 sequence becomes exercisable end-to-end
  without the UI:
  1. Account A creates vault V1 with a reachable TP price.
  2. Account B (non-owner) calls `withdraw` on V1 → aborts
     with `ENotOwner = 1001` (the documented owner-only error
     code from Cycle 3 contract). Asserted.
  3. The operator pushes the on-chain price past V1's TP
     threshold; within one keeper polling interval the keeper
     logs `trigger_fired` for V1 and `sui client object`
     confirms `triggered: true`.
  4. Account A (owner) calls `withdraw` on V1 → aborts with
     `EVaultTriggered = 1002` (the documented triggered-vault
     error code). Asserted.
  E-007's Move-side abort assertions (steps 2 and 4) were
  already exercised by Cycle 3a's unit tests (the `withdraw`
  non-owner path and the `withdraw_after_fire_aborts` test);
  this cycle promotes E-007 to real because the
  previously-missing piece — the keeper firing the trigger
  between steps 2 and 4 — now exists.

- **E-003** (`slot 3 end-to-end take-profit fire from ui
  through keeper through ui again`, kind `ui`) —
  status: **stub**. The keeper's create-event-watcher and
  trigger-fire path are now functional and the on-chain
  `TriggerFired` event is emitted, but E-003's UI-driven
  steps (navigate, connect-wallet, submit create-vault form,
  observe triggered-badge in UI) are not exercisable until
  Cycle 5. The keeper's structured log lines and the
  `getTransactionBlock` event read are sufficient for the UI
  to consume in Cycle 5.

- **E-004** (`slot 3 owner-only withdraw before trigger
  returns full balance and removes vault`, kind `ui`) —
  status: **stub**. The keeper does not gate withdraw (the
  Move contract does); the UI's withdraw control is the
  missing piece. Promoted to real in Cycle 5.

- **E-006** (`slot 3 vault list excludes vaults owned by
  other accounts`, kind `ui`) — status: **stub**. The
  keeper's vault registry is not user-facing; the UI's
  owner-filtered vault list is the missing piece. Promoted
  to real in Cycle 5.

## Decision Gates

- **G-Pyth** (pre-red-phase, per spec.md Decision Gates and
  cycle-plan Cycle 3b). One on-chain `PriceInfoObject` (per
  `~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json`
  → `pythOracles.deepPriceInfoObjectId` or
  `pythOracles.suiPriceInfoObjectId`) is fetched via the
  SDK 2.x `simulateTransaction` pattern shown in
  `~/workspace/deepbook-sandbox/sandbox/scripts/market-maker/price-feed.ts`
  (the canonical sandbox reference). Its field layout
  (price, expo, conf, publish_time, plus the negativity
  bytes for the two signed fields) is documented in
  `independent/03-tpsl-vault/keeper/notes/pyth-shape.md`
  along with the captured BCS bytes from the live sandbox
  and a worked decode example. The keeper's price-read
  source file references `notes/pyth-shape.md` in its module
  comment. The path is load-bearing — any agent that writes
  the keeper's price-read code must follow the documented
  layout, NOT training memory. Concrete escalation triggers
  if the gate cannot pass:
  - The sandbox's `PriceInfoObject` IDs in the manifest do
    not correspond to live, readable on-chain objects (e.g.,
    oracle-service is not running). Escalate via
    `AskUserQuestion`; do not work around by hard-coding
    price values.
  - The BCS layout returned by the bundled `pyth` package
    differs from what the sandbox market-maker expects
    (e.g., upstream Pyth bumped the Price struct layout and
    the bundled `.external-packages/...` is out of date).
    Escalate; do not silently adopt a different layout.

## Stated orchestration dependencies

- Cycles 1, 2, 3a complete with the sandbox up (G-Boot still
  passing).
- The Cycle 3a `tpsl_vault` Move package published against
  the running sandbox so the keeper has a known package id
  to consume via `TPSL_VAULT_PACKAGE_ID`. The publish step
  is itself NOT a Cycle 4 deliverable (the keeper assumes
  the operator has published); the cycle's runbook-style
  instructions in the green phase will document the publish
  command.
- The sandbox's running oracle-service publishing prices to
  the two manifest-named `PriceInfoObject`s. If the
  oracle-service is not running (a sandbox-side
  prerequisite), the keeper's `pyth_read_failed` log line
  surfaces the condition and G-Pyth cannot pass.
- A pre-funded `Coin<DEEP>` accessible to the keeper for
  the trigger transaction's `deep_in` argument. The
  operator hands the coin id to the keeper via
  `KEEPER_DEEP_COIN_ID`.
- No new decision gates introduced beyond G-Pyth. G-Boot
  inherited from Cycle 1, G-Vault inherited from Cycle 3a
  (the keeper's trigger-transaction shape consumes the
  no-manager swap path baked into the Move contract; the
  keeper does not re-relitigate G-Vault).
