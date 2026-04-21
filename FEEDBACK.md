# DeepBook Sandbox — feedback from building three apps on top of it

**Author:** third-party integrator perspective, after a fresh read of the repo
at `deepbook-sandbox/` and building the three apps in `apps/01..03`.

**Reviewer caveat:** The evaluation proceeded in two phases. Phase 1
was a thorough code/doc read without a running sandbox, producing the
structural findings below. Phase 2 was a full end-to-end run using
`pnpm deploy-all --quick`, deploying all three apps against a live
sandbox instance and executing real transactions. Phase 2 uncovered
the critical DEEP/SUI market-maker bug (§4.4) and validated the
keeper, UI, and SDK integration paths. Every finding below has been
confirmed against either the live sandbox or the source code.

---

## 1. TL;DR

DeepBook Sandbox is a strong starting point: **one command, clean teardown,
complete stack** (RPC + indexer + oracle + market maker + dashboard). The
fundamentals are in place and the README is unusually thorough for a
developer tool. The frictions cluster in three areas:

1. **The DEEP/SUI market maker is silently broken** — the shared
   BalanceManager runs out of funds for DEEP/SUI orders because
   SUI/USDC consumes the balance first. The book is permanently empty,
   all swaps return 0, and the health endpoint still says "healthy".
   This blocked all three apps and wasted hours of debugging (§4.4).
2. **Custom contract authoring is location-coupled.** Every Move package
   that touches DeepBook has to live in `sandbox/packages/` for paths to
   resolve. That's an architectural lock-in that complicated all three of
   my apps and is documented as "if you hit duplicate-dep errors, use
   absolute paths" — symptomatic, not fixed.
3. **The SDK asks every integrator to re-derive the same state** —
   `CoinMap`, `PoolMap`, `DeepbookPackageIds`, object-type matching.
   The boilerplate in `examples/sandbox/setup.ts` should live in the SDK.

Everything else is papercuts, not blockers — documented below with
severity tags `[blocker] [friction] [papercut] [polish]`.

---

## 2. Testing methodology

What I did:

- Read the top-level `README.md` (38 KB), `CLAUDE.md`, and the
  `examples/sandbox/` scripts in full.
- Read the dashboard (`sandbox/dashboard/src/`) as the canonical browser
  integration.
- Read the Move `example_contract` template and wrote two new Move
  packages (`fee_rebate_swap`, `dca_vault`) that exercise the same
  dependency resolution path.
- Wrote three apps in `apps/01..03` covering:
  - read-only browser integration (order-book viewer),
  - Move package + SDK round-trip (fee-rebate swap),
  - a keeper-triggered Move vault + UI (DCA vault).
- Drafted the exact shell commands a new user would run (see
  `RUNBOOK.md`), which surfaced the friction points below.

What I validated end-to-end (Phase 2):

- `pnpm deploy-all --quick` → "DeepBook Sandbox Ready!" within ~2 min.
- App 1 (order book viewer): order book loads, but DEEP/SUI shows empty
  due to the market maker bug. SUI/USDC displays correctly.
- App 2 (fee-rebate swap): contract deploys and vault creation succeeds.
  Swap returns 0 DEEP due to empty DEEP/SUI book (§4.4).
- App 3 (DCA vault): contract deploys, keeper runs, UI shows vault
  state. Execute transactions succeed but produce 0 DEEP output.
- SDK's own `pnpm swap-tokens` example: also returns 0 DEEP,
  confirming the issue is at the pool level, not in our code.
- Confirmed the Move signature of `pool::swap_exact_quote_for_base`
  returns `(base_out, quote_leftover, deep_leftover)` as expected.

---

## 3. What went well

1. **`pnpm deploy-all` is genuinely one command.** For a stack with a Sui
   node, postgres, indexer, server, faucet, oracle service, market maker
   and dashboard, that's remarkable. The `--quick` flag to skip Rust
   builds is exactly right.

2. **Three independent manifest publication paths** — `sandbox/.env`,
   `sandbox/deployments/localnet.json`, and the faucet's `/manifest`
   HTTP endpoint. A consumer can pick whichever matches its language.
   (The JSON file has the richest shape.)

3. **Separation of deployer key from oracle key** is the right call —
   avoids gas coin contention and is a pattern more sandboxes should copy.

4. **Dev-wallet auto-import of the deployer key** in the dashboard
   (`sandbox/dashboard/src/dapp-kit.ts`) means a fresh clone +
   `pnpm deploy-all` lands in a browser with a funded account. Huge onboarding win.

5. **The README is excellent.** Data flow diagram, glossary, appendices
   for config/services/files/submodules. Most projects ship with 10% of
   this detail.

6. **Health endpoints for every service** (oracle `/`, market maker
   `/health`, faucet `/`). This makes it trivial to write a `doctor`
   script — see recommendation §5.6.

7. **Pyth historical prices (24h-old)** — a smart dev affordance. Prices
   are non-zero and deterministic without being live.

8. **`Pub.localnet.toml`** as the single source of truth for dependency
   resolution is clean. The Sui CLI semantics here are underused in the
   broader ecosystem and DeepBook Sandbox is one of the few projects
   demonstrating them well.

---

## 4. Friction points

### 4.1 Onboarding & discoverability

`[friction]` **The `pnpm create` package exists but is hard to find.**
Running `pnpm create @mysten-incubation/deepbook-sandbox` works:
it downloads the scaffolder, validates Docker + Sui CLI, and proceeds.
But the `@mysten-incubation` scope is non-obvious. Natural first
attempts — `npx deepbook-sandbox`, `npx @mysten/deepbook-sandbox`,
`npx create-deepbook-sandbox` — all 404. The README should open with
the one-liner and the npm registry listing should include `deepbook`
as a keyword so npm search surfaces it.

`[friction]` **The scaffolder's dependency check has good UX.** When
Docker or Sui CLI are missing, the output is clear:

```
Missing dependencies:
  ✗ Docker — Install Docker Desktop: https://docs.docker.com/get-docker/
  ✗ sui — Install the Sui CLI: https://docs.sui.io/...
```

This is genuinely helpful — worth calling out as a positive. However
the process exits hard (exit code 1) rather than offering to scaffold
the project skeleton anyway and letting the user install deps later.
A `--skip-checks` flag would let someone set up the file tree while
waiting for Docker to download.

`[friction]` **`git submodule update --init --recursive` is a second
step.** The quickstart says "clone with `--recurse-submodules`". If you
don't, the later "troubleshooting: can't build contracts" section is
what rescues you, but the error surface between those two is scary
(`unresolved dependency` on `deepbook`).

`[friction]` **`sui client objects --json` returns gRPC/BCS format —
unusable for scripting.** The most natural command for "find my DEEP
coin" — `sui client objects --json | jq '…select(…)…'` — fails because
the CLI's JSON output uses the gRPC format where object IDs are
embedded as raw byte arrays inside the `contents` field, and types are
nested structs like `{"Coin": {"struct": {"module": "deep", ...}}}`
rather than the flat `0x…::deep::DEEP` strings everyone expects. You
can *see* which objects are DEEP coins from the type metadata, but
extracting the actual object ID requires decoding BCS bytes — not
something you'd pipe through jq. The workaround is to call the
JSON-RPC `suix_getCoins` method directly via curl, which is not
something a newcomer will discover quickly. Either the sandbox README
should document this, or the sandbox should ship a helper script
(e.g. `pnpm sandbox coins --type DEEP`) that wraps the RPC call.

`[polish]` **Sui CLI version pinning is soft.** "1.63.2-1.64.1
recommended" leaves room for confusion. A `sandbox doctor` script
should just reject older/newer.

### 4.2 Custom contract authoring

`[blocker]` **Custom contracts must live inside `sandbox/packages/`.**
The `example_contract` Move.toml uses relative paths:

```
token = { local = "../../.external-packages/token" }
deepbook = { local = "../../.external-packages/deepbook" }
```

These resolve only when the contract is two dirs deep inside
`sandbox/packages/<name>/`. Putting a contract outside that tree (e.g.
in a sibling repo, which is what a real user would want) triggers
duplicate-dependency errors during publish — documented in the
troubleshooting section with the "use an absolute path" workaround.

My apps 02 and 03 work around this by **copying** sources into
`sandbox/packages/` at publish time (`scripts/deploy.sh`). That's the
right fix for now, but it's a user-space patch for what should be a
tooling affordance.

`[friction]` **`.external-packages/` only exists after the first
deploy.** Open the repo fresh in VSCode + Move Analyzer: every `use`
statement in `example_contract.move` is red. IDE support is broken
until you've run a 4-minute Docker deploy. A `pnpm sandbox fetch-deps`
command that populates `.external-packages/` without booting Docker
would unblock the IDE path.

`[friction]` **Build-before-publish is chicken-and-egg.**
`sui move build --build-env localnet` fails for the same reason — no
deps cached. So "just check it compiles" requires a full deploy.

`[papercut]` **`Pub.localnet.toml` is regenerated and wipes your entries
on `pnpm down`.** Documented, but the teardown table calls out
`Pub.localnet.toml → removed` while `deployments/localnet.json → kept` —
inconsistency worth explaining or fixing.

### 4.3 SDK ergonomics

`[friction]` **Every integrator re-implements setup.ts.** The
`buildPackageIds` / `buildCoinMap` / `buildPoolMap` / `extractObjectId`
helpers in `examples/sandbox/setup.ts` are ~70 lines of fragile
object-type string matching. My app 01 had to inline the same logic
because there's no `createSandboxClient(manifest)` SDK helper.

`[friction]` **`extractObjectId(objs, "Registry", "MarginRegistry")`**
is string-prefix matching by convention. A typo in "MarginRegistry"
silently binds the wrong object. The manifest should include typed
object kinds (`{ kind: "Registry", ... }`) instead of leaving the
consumer to regex-match `objectType`.

`[friction]` **Pool tick size is silent.** `place-limit-order.ts`
hard-codes `TICK_SIZE = 0.000001` with a manual rounding:

```ts
const TICK_SIZE = 0.000001;
const bidPrice = Math.floor((midPrice * 0.5) / TICK_SIZE) * TICK_SIZE;
```

The SDK should surface `client.deepbook.tickSize(poolKey)` (or
`poolBookParams` already returns it but the limit-order example doesn't
use it). Off-tick prices silently fail on-chain without a clear reason.

`[papercut]` **Swap's three-return-coin pattern is a footgun.**
`pool::swap_exact_quote_for_base` returns `(base_out, quote_leftover,
deep_leftover)`. All three must either be transferred or
`coin::destroy_zero`'d, or the transaction aborts. The TS example
comment helpfully explains "swap returns leftover coins that must be
transferred back" but the Move signature is unforgiving. A
`safe_swap_*` helper that burns zero-valued leftovers would prevent
beginners from writing a buggy module on their first try — I caught
myself writing one while drafting App 02.

`[blocker]` **DeepBook SDK crashes on gRPC `SimulateTransaction`
responses — `Cannot read properties of undefined (reading
'returnValues')`.**

This is a confirmed, reproducible bug that affects both our order book
viewer app and the sandbox's own dashboard (the "On-chain Mid Price"
card shows "—" because the same SDK call fails there too).

**Root cause (traced through source):**

Every read-only SDK method (`midPrice`, `getLevel2TicksFromMid`,
`poolBookParams`, `vaultBalances`, etc.) follows the same pattern in
`@mysten/deepbook-v3/src/queries/poolQueries.ts`:

```ts
const res = await this.#ctx.client.core.simulateTransaction({
    transaction: tx,
    include: { commandResults: true, effects: true },
});
const bytes = res.commandResults![0].returnValues[0].bcs;  // ← crash site
```

The `!` is a TypeScript non-null assertion — it tells the compiler
"trust me, this is not null" but generates zero runtime checks. The
crash happens when either:

1. **`commandResults` is an empty array.** The Sui gRPC client
   (`@mysten/sui/src/grpc/core.ts:460-470`) builds `commandResults` by
   mapping `response.commandOutputs` from the protobuf response. If the
   gRPC server returns `commandOutputs: []` (a valid empty repeated
   field), the SDK produces `commandResults: []`. Then
   `commandResults![0]` is `undefined`, and `.returnValues` throws.

2. **`CommandOutput.value` is missing.** The protobuf schema defines
   `value` as `optional` (`value?: Bcs`). The gRPC client maps it as
   `rv.value?.value ?? null`, so `bcs` becomes `null`. Then
   `bcs.U64.parse(null)` throws a different but equally unhelpful error.

3. **The simulation returned `$kind: 'FailedTransaction'`.** The gRPC
   client returns `commandResults` on both success and failure paths
   (`core.ts:472-486`). The DeepBook SDK never checks `res.$kind` — it
   blindly accesses `commandResults![0].returnValues[0].bcs` regardless
   of whether the simulation succeeded or failed. A failed simulation
   can have `commandResults` populated but with empty/missing return
   values.

**The gRPC field mask is the likely trigger.** The gRPC client requests
command outputs via a field mask path `'command_outputs'`
(`core.ts:430-431`). Depending on the Sui node version and how the gRPC
server interprets this mask, the response may include the
`command_outputs` envelope but omit nested fields like
`return_values[].value.value` (the actual BCS bytes). This would
produce a `commandResults` array with entries whose `returnValues` have
`{ bcs: null }` or are empty altogether.

**Only one query file has guards.** `balanceManagerQueries.ts` (lines
94-114) is the sole file that checks `res.FailedTransaction`,
`!res.commandResults`, and `!commandResult.returnValues` before
accessing:

```ts
if (res.FailedTransaction) {
    throw new Error('...');
}
if (!res.commandResults) {
    throw new Error('Failed to get manager balances: No command results');
}
// ...
if (!commandResult || !commandResult.returnValues) {
    throw new Error(`Failed to get balance for ${coin.type}: No return values`);
}
```

Every other query file (`poolQueries.ts`, `orderQueries.ts`,
`quantityQueries.ts`, etc.) uses the bare `!` non-null assertion.
Someone clearly hit this bug once, fixed it in one place, and didn't
propagate the fix.

**Impact:** Any app that polls DeepBook read-only methods via gRPC will
hit intermittent `TypeError` crashes. The sandbox dashboard works
around it by falling back to the market maker REST API for prices. Our
order book viewer required a `withRetry()` wrapper with a 300ms
backoff to suppress the errors.

**Recommended fixes (in priority order):**

1. **DeepBook SDK:** Add null guards to every `simulateTransaction`
   call site, matching the pattern already in
   `balanceManagerQueries.ts`. Check `res.$kind ===
   'FailedTransaction'`, then check `!res.commandResults` and
   `!res.commandResults[0]?.returnValues`, and throw a typed
   `SimulationError` instead of letting a raw `TypeError` escape.

2. **Sui gRPC client:** Normalize `commandOutputs` so that repeated
   fields are always arrays (never undefined), and `CommandOutput.value`
   is always present when the simulation succeeds. The JSON-RPC code
   path (`jsonRpc/core.ts:307-311`) does not have this issue because
   `devInspectTransactionBlock` returns a JSON response where
   `returnValues` is always either an array or handled by `?? []`.

3. **Sandbox dashboard:** The "On-chain Mid Price" card currently shows
   "—" because of this bug. Once the SDK is fixed, this card should
   display the actual on-chain mid price.

`[papercut]` **Whitelisted pools (`payWithDeep: false`, `deepAmount: 0`)
vs. fee-bearing pools is only documented in comments.** A user who
copies the DEEP/SUI swap code to SUI/USDC and forgets to pay DEEP fee
will silently get "insufficient DEEP" aborts. Exposing
`client.deepbook.requiresDeepFee(poolKey): boolean` would make it
surfaceable.

`[friction]` **SDK v2 breaking rename: `SuiClient` → `SuiJsonRpcClient`.**
As of `@mysten/sui@2.15`, the old `SuiClient` from `@mysten/sui/client`
no longer exists. The replacement is `SuiJsonRpcClient` from
`@mysten/sui/jsonRpc` (and requires a `network` parameter). The sandbox
examples that import `SuiClient` from `@mysten/sui/client` will fail on
install unless version-pinned. Similarly, `getFullnodeUrl` is now
`getJsonRpcFullnodeUrl`. This caught all three of my test apps — the fix
is mechanical but the error message (`Module has no exported member
'SuiClient'`) is cryptic for someone unfamiliar with the rename.

`[papercut]` **SDK v1 vs v2 mismatch.** `sandbox/` pins
`@mysten/sui@^2.5.0`, `examples/sandbox/` pins `@mysten/sui@^2.5.1`.
The README notes this but people will run `pnpm install` in the wrong
directory and then be confused why types don't line up.

`[polish]` **`@mysten-incubation/dev-wallet` is in the critical path.**
"Incubation" in the name is a red flag for a default wallet in a dev
tool shipped to users. The top-level `await adapterReady` in
`dapp-kit.ts` before `createDAppKit` is brittle — if the adapter init
ever throws, the whole dashboard refuses to mount with no fallback.

### 4.4 Runtime behavior

`[blocker]` **DEEP/SUI pool order book is empty — all swaps silently
return 0.** After `pnpm deploy-all --quick`, the market maker's
DEEP/SUI rebalance fails on every 10-second cycle with:

```
[ERR] DEEP/SUI rebalance error
    MoveAbort in 12th command, abort code: 3,
    in 'balance_manager::withdraw_with_proof' (instruction 45)
```

Abort code 3 is `EInsufficientBalance`. The root cause: the market
maker creates a **single shared BalanceManager** for both pools
(DEEP/SUI and SUI/USDC), deposits 1,000 DEEP + 100 SUI + 500 USDC,
then tries to place 60 orders per pool. SUI/USDC rebalance succeeds
(locking SUI for its bids), and by the time DEEP/SUI rebalance runs,
the BalanceManager doesn't have enough remaining balance to cover its
order grid. The DEEP/SUI placement aborts, all orders roll back, and
the book stays permanently empty.

Confirmed by inspecting the pool's inner state:

```json
{
  "asks": { "length": "0" },
  "bids": { "length": "0" },
  "vault": { "base_balance": "0", "quote_balance": "0", "deep_balance": "0" }
}
```

Meanwhile the health endpoint reports `"status":"healthy"` with
`"activeOrders":60` — those are all SUI/USDC orders. There is zero
indication that DEEP/SUI is broken unless you inspect the logs or
query the pool object directly.

**Impact:** Every DEEP/SUI swap — whether via the SDK's own
`pnpm swap-tokens` example, a direct `sui client ptb` call, or our
DCA vault contract — silently returns all input coins with 0 output.
The swap function's dry-run finds an empty book, computes
`base_quantity = 0 < min_size`, and early-returns. No error, no
event, no revert — just a quiet no-op that costs gas. This wasted
several hours of debugging across Apps 2 and 3 before we traced it
to the pool state.

**Recommended fixes:**

1. **Separate BalanceManagers per pool.** The market maker should
   create one BM per pool so resource contention is impossible.
2. **Health endpoint should report per-pool status.** Instead of a
   single `activeOrders: 60`, report
   `{"DEEP_SUI": {"orders": 0, "lastError": "..."}, "SUI_USDC": {"orders": 60}}`.
3. **Log the error visibly.** The `[ERR]` line scrolls past in Docker
   logs. A persistent warning on the health endpoint (and ideally a
   non-zero exit code or restart) would surface the failure faster.
4. **Increase initial deposits.** If a shared BM is kept, the funding
   amounts need to account for both pools' worst-case grid at oracle
   prices, not just the fallback mid price.

`[friction]` **`FORCE_REGENESIS=true` is the default.** Every
`pnpm deploy-all` wipes chain state. That means App 02's vault and
App 03's vaults disappear between sessions. Documented — but a default
of `false` for localnet (with an explicit `pnpm sandbox reset` for
wipes) would match the expectation of a developer sandbox (which should
behave like a database you can restart, not a goldfish).

`[papercut]` **`pnpm down` is destructive by default.** No
`--keep-packages` / `--keep-state` escape hatch. If you accidentally
tear down after spending 30 minutes publishing test vaults, there's no
recovery.

`[friction]` **8 GB Docker RAM is a steep floor.** That will exclude
entry-level M1 dev machines running Chrome + VSCode + the sandbox. A
"minimal" profile (just `sui-localnet` + `postgres`, skipping indexer,
server, oracle, market-maker, dashboard) would let a brand new user
feel the heartbeat in 30 s before opting into the full stack.

`[papercut]` **Dashboard's "Create Balance Manager" callout in the
troubleshooting section is a tell.** The error signature
(`dynamic_field::borrow_mut: dynamic field does not exist`) and the
fact that the fix is a one-time admin call that was added recently
(`init_balance_manager_map`) suggests an invariant that should be
enforced at Registry creation, not at BM creation. Any old localnet
artifact still trips it.

### 4.5 Testing & CI

`[friction]` **`examples/sandbox/*.ts` has no CI.** `pnpm
test:integration` covers sandbox internals but a change to
`@mysten/deepbook-v3` or to the manifest shape could silently break
every example. A `pnpm test:examples` that runs each script against a
fresh localnet (in parallel or series) would be cheap insurance.

`[papercut]` **No Move formatting CI gate.** Prettier covers TS in
pre-commit but Move files are formatted manually with
`bunx prettier-move -c *.move --write`. CI can't catch a misformatted
contract.

`[papercut]` **No schema for the faucet HTTP API.** `POST /faucet
{address, token, amount}` is described in prose. An OpenAPI spec or a
typed TypeScript client would tighten integration.

### 4.6 Observability

`[friction]` **No event subscription example.** The indexer + server
exposes events (used by the dashboard's market maker page), but
`examples/sandbox/` has no sample showing how to watch events live.
That's precisely the pattern an off-chain keeper (my App 03) wants to
use instead of polling `getObject`.

`[polish]` **No Prometheus/Grafana preset.** Market maker exposes
`:9091/metrics`. There's no compose override or Grafana dashboard to
visualize it. For a sandbox targeting DEX developers, this is a
near-trivial value-add.

---

## 5. Prioritized recommendations

### 5.1 Make the `pnpm create` package more discoverable `[high]`

`pnpm create @mysten-incubation/deepbook-sandbox` already works — the
scaffolder validates deps, prints clear errors, and bootstraps the
project. To maximize adoption:

- **Add the one-liner to the very top of the README**, before the
  architecture diagram. A "Quick start" box:
  ```bash
  pnpm create @mysten-incubation/deepbook-sandbox my-app
  ```
- **Publish an alias** under a more discoverable name
  (e.g. `create-deepbook-sandbox` or `@mysten/create-deepbook-sandbox`)
  so `npx deepbook-sandbox` or `npx create-deepbook-sandbox` also works.
- **Add a `--skip-checks` flag** that scaffolds files even when Docker/Sui
  CLI are missing — lets users set up the tree while downloading deps.

### 5.2 Ship `createSandboxClient(manifest)` in `@mysten/deepbook-v3` `[high]`

The 70-LOC boilerplate in `examples/sandbox/setup.ts` belongs in the
SDK. Proposed shape:

```ts
import { createSandboxClient, DeploymentManifest } from "@mysten/deepbook-v3";

const manifest: DeploymentManifest = await fetch("http://localhost:9009/manifest").then((r) => r.json());
const client = createSandboxClient(manifest, { network: "localnet", baseUrl: "http://localhost:9000" });
const mid = await client.deepbook.midPrice("DEEP_SUI");
```

Zero object-type matching in user code.

### 5.3 Decouple Move dependency resolution from `sandbox/packages/` `[high]`

Either:

- Accept a `SANDBOX_EXTERNAL_PATH` env var that `sui move build` can
  honor, so a contract anywhere on disk can reference the local
  DeepBook packages, **or**
- Publish stub npm-like Move packages that a standalone project can
  reference without physically living in `sandbox/packages/`.

### 5.4 `pnpm sandbox fetch-deps` and `pnpm sandbox doctor` `[medium]`

- `fetch-deps`: populate `.external-packages/` from the submodule
  without booting Docker. Unblocks IDE integration on fresh clones.
- `doctor`: validate Docker/RAM/Sui-CLI version/port availability, print
  green/red table. Catches 80% of "it doesn't work" Slack pings.

### 5.5 Default to `FORCE_REGENESIS=false` on localnet `[medium]`

Chain state should survive `pnpm deploy-all`. Add
`pnpm sandbox reset [--keep-packages] [--keep-state]` for the
destructive option, and make the default composable with published
custom packages.

### 5.6 Integration tests for the examples folder `[medium]`

`pnpm test:examples` that runs each `examples/sandbox/*.ts` against a
fresh localnet. Catches SDK drift early.

### 5.7 Event subscription example `[medium]`

A single script in `examples/sandbox/watch-events.ts` that subscribes
to `OrderPlaced`/`OrderFilled`/`OrderCanceled` events via the indexer's
gRPC or the server's REST. Reference pattern for every keeper-style
app (including my App 03).

### 5.8 `Move.lint` and `Move.format` as pre-commit hooks `[low]`

`bunx prettier-move --check` as a CI gate, not a manual command.

### 5.9 OpenAPI/Zod schema for the faucet `[low]`

Share the Zod schema between `sandbox/api/` and the SDK so TS
consumers type `{ address, token, amount? }` with no repeat of the
validation.

### 5.10 Minimal/Full compose profiles `[low]`

`docker compose --profile minimal up` → only `sui-localnet` +
`postgres`. Lets resource-constrained users get a heartbeat.

### 5.11 A compatibility matrix `[low]`

Sandbox `vX.Y.Z` ↔ DeepBook submodule commit ↔ `@mysten/deepbook-v3`
SDK version ↔ `@mysten/sui` SDK version. Ideally enforced by
`pnpm deploy-all` at runtime.

---

## 6. Appendix — specific code observations from the read

| File | Observation |
|------|-------------|
| `examples/sandbox/setup.ts` | `extractObjectId` by substring match is brittle; `const SUI_ADDRESS = SUI_FRAMEWORK_ADDRESS` is misleading (SUI coin's address is `0x2`, which equals framework, but a reader thinks there's a separate constant). |
| `examples/sandbox/place-limit-order.ts` | Hard-coded tick size `0.000001` — duplicated logic if another example needs it. |
| `sandbox/dashboard/src/dapp-kit.ts` | Top-level `await` + `import.meta.env.VITE_DEV_WALLET_PRIVATE_KEY` — prod build will surface the key in the bundle. Fine for a dev tool, but the file lacks a "NOT FOR PROD" comment. |
| `sandbox/packages/example_contract/sources/example_contract.move` | The body is `return;`. That's intentional as a template, but the file contains five imports that do nothing — the compiler will warn about unused use statements. A commented-out usage snippet would teach more. |
| `sandbox/packages/example_contract/Move.toml` | `localnet = "a62c4e17"` is a static chain-id, meaning the file is out of date the moment someone re-runs `pnpm deploy-all` with a new regenesis. Either regen this at publish time or document the hardcode. |
| `sandbox/api/src/routes/faucet.ts` (inferred from README) | Exposes DEEP via signed transfer from deployer `TreasuryCap`. That means the deployer key is in the faucet container's env — a tight blast radius if the container is compromised, but worth an explicit WARNING in the faucet README. |
| `sandbox/docker-compose.yml` | 7 services, 2 profiles (`localnet`, implicit default). A lightweight `minimal` profile would be a strict subset of `localnet`. |
| README Appendix B | `MARKET_MAKER_IMAGE`/`INDEXER_IMAGE`/`SERVER_IMAGE`/`FAUCET_IMAGE`/`ORACLE_SERVICE_IMAGE` all default to `-arm64` tags — x86 users who look only at the appendix and miss Appendix A's auto-detection paragraph will be confused. Flip the default to the non-arch-pinned tag and let auto-detect do the arch selection. |

---

## 7. Scoring summary

| Dimension | Grade | Note |
|-----------|-------|------|
| Time-to-first-data-point | B- | `pnpm deploy-all --quick` boots fast, but the DEEP/SUI pool is broken on arrival — first swap returns 0 with no error |
| Docs quality | A | Thorough, with glossary, appendices, and troubleshooting |
| SDK ergonomics | C+ | The boilerplate lives in every integration; needs a batteries-included helper. gRPC query methods crash with `TypeError` |
| Custom-contract DX | C | Location-coupled + IDE-hostile until first deploy |
| Market maker reliability | D | DEEP/SUI silently broken every cycle; health endpoint misleading; SUI/USDC works fine |
| Observability | C+ | Healthchecks everywhere but report false-positive "healthy"; missing per-pool error surfacing |
| Clean teardown | A- | `pnpm down` is honest about what it destroys |
| CI/testing story | B- | Sandbox internals tested, SDK examples aren't |

**Would I build on this for a real project?** Yes. The `pnpm create`
scaffolder is a solid on-ramp, and `pnpm deploy-all` delivers a complete
stack. I'd still fork to (a) keep my contracts outside `sandbox/packages/`
and (b) pin the regenesis default to keep state across restarts — but the
overall DX is meaningfully above average for blockchain dev tooling.

---

## 8. Ideas the apps themselves flushed out

Working on my three apps surfaced these concrete asks:

- **App 01 (order book viewer):** needed a `getLevel2TicksFromMid`
  return that included the tick size. Today I reformat the prices
  heuristically because a naïve `toFixed(4)` truncates DEEP/SUI ticks
  to 0. `{ tickSize, asks: [{price, qty}], bids: [...] }` would be cleaner.

- **App 02 (fee-rebate swap):** needed a way to build a Move contract
  that lives outside `sandbox/packages/` but still publishes against
  the sandbox's DeepBook. I couldn't find one — hence the
  stage-into-sandbox workaround in my `deploy.sh`.

- **App 03 (DCA vault + keeper):** needed an event subscription for
  `dca_vault::Executed` events so the UI can show a history feed
  without polling. The indexer could expose this via the DeepBook
  server's REST API if the event signature was registered, but there's
  no documented way to add custom event types to the indexer's
  subscription set.

Each of these is independently useful and small — they'd lift the
developer experience noticeably.
