# Cycle 5 Contract — Slot 3 UI (React + Vite + dapp-kit-react, sub-cycle 3c of Slot 3)

## Goal

Deliver the wallet-connected React + Vite single-page app at
`independent/03-tpsl-vault/ui/` that, against a running sandbox with the
Cycle 3a `tpsl_vault` Move package published and the Cycle 4 keeper
running, lets the connected dev-wallet account: (a) see exactly the
vaults it owns (filtered strictly by `owner == currentAccount.address`),
(b) create a new vault via a form that submits a `tpsl_vault::create_vault`
PTB through dapp-kit-react, (c) withdraw any of its non-triggered
vaults via a `tpsl_vault::withdraw` PTB, and (d) see triggered vaults
render with a clear triggered badge plus the output amount routed to
the owner (read from the on-chain `TriggerFired` event payload).

This cycle delivers spec AC3.12, AC3.13, AC3.14, AC3.15, AC3.16, AC3.17
verbatim and validates AC3.18 (the cross-Slot-3 friction-log coverage
criterion, evaluated over the union of Cycles 3a + 3b + 3c) at the
end-of-cycle review per cycle-plan Cycle 3c. It promotes E-003, E-004,
and E-006 from stub to real; the keeper (Cycle 4) is the missing leg
those three scenarios needed for end-to-end exercisability.

## Behavior

The user starts the sandbox (`cd ~/workspace/deepbook-sandbox/sandbox &&
pnpm deploy-all`), publishes the Cycle 3a `tpsl_vault` Move package
against it (the same publish step Cycle 4 documented), starts the
Cycle 4 keeper with the resulting `TPSL_VAULT_PACKAGE_ID`, then runs
`pnpm dev` in `independent/03-tpsl-vault/ui/` and navigates to the
local dev URL.

### Boot

1. The page loads. A Vite dev-server middleware serves `/localnet.json`
   directly from
   `~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json`
   (the Cycle 1 proven pattern; documented escalation in Cycle 1's
   review as the cleanest manifest-source approach). The path on disk is
   resolvable from the user's `$HOME`; if the file is missing, the
   middleware returns HTTP 404 with a JSON body whose `error` field
   names the bootstrap command (`pnpm deploy-all` from the sandbox).
2. The app reads `/localnet.json` once at boot. From the manifest it
   captures, at minimum: `network.rpcUrl`, `packages.deepbook.packageId`,
   `packages.token.packageId` (needed for the DEEP coin type tag), and
   the `pools[]` entries (needed to render the create-form's pool
   picker with `baseCoinType` / `quoteCoinType` labels per pool).
3. The app reads `TPSL_VAULT_PACKAGE_ID` from a Vite-injected env var
   (`import.meta.env.VITE_TPSL_VAULT_PACKAGE_ID`). The package is
   published outside the sandbox's manifest (same constraint Cycle 4's
   keeper handles via `TPSL_VAULT_PACKAGE_ID`); if the env var is
   missing or blank, the page renders an actionable inline error
   naming the publish command (`sui client publish` from
   `independent/03-tpsl-vault/move/`) and the env var to set in
   `independent/03-tpsl-vault/ui/.env.local`. The app does NOT crash
   on a missing env var.
4. dapp-kit-react is initialized via `createDAppKit` mirroring the
   sandbox dashboard at `~/workspace/deepbook-sandbox/sandbox/dashboard/src/dapp-kit.ts`:
   - `networks: ["localnet"]`.
   - `createClient(network)` returns a `SuiGrpcClient` from
     `@mysten/sui/grpc` with `baseUrl: manifest.network.rpcUrl`.
   - `slushWalletConfig: null` (localnet only; no Slush).
   - `walletInitializers: [devWalletInitializer({ adapters: [adapter],
     autoConnect: true, autoApprove: false, mountUI: true })]` where
     `adapter` is an `InMemorySignerAdapter` from
     `@mysten-incubation/dev-wallet/adapters`. The Slot 3 UI MUST
     pre-import the sandbox's deployer key into the adapter before
     `createDAppKit` is called — verbatim mirror of the dashboard's
     pattern at
     `~/workspace/deepbook-sandbox/sandbox/dashboard/src/dapp-kit.ts`
     lines 8-27: read `import.meta.env.VITE_DEV_WALLET_PRIVATE_KEY`
     (Vite injects it from the sandbox's `.env`, which `pnpm
     deploy-all` populates with the deployer keypair); decode via
     `decodeSuiPrivateKey`; build an `Ed25519Keypair` from the
     decoded `secretKey`; `await adapter.importAccount({ signer:
     keypair, label: "Deployer" })`; `await` the resulting promise
     before invoking `createDAppKit(...)` so the dev-wallet UI
     mounts with the deployer account already loaded. This is the
     "auto-loaded dev wallet" the spec AC3.13 names; without
     pre-import the dev wallet starts empty and the user has to
     paste a private key by hand, which the spec wording does not
     permit. If `VITE_DEV_WALLET_PRIVATE_KEY` is empty or missing
     at boot (operator hasn't run `pnpm deploy-all`, or has copied
     a stale `.env`), the UI MUST surface an inline actionable
     error naming the bootstrap recipe (`pnpm deploy-all` from the
     sandbox, then ensure `sandbox/.env` is symlinked or copied
     into `independent/03-tpsl-vault/ui/.env.local`) AND fall
     through to the standard wallet-standard flow as a degraded
     mode (the user can still connect any wallet-standard wallet,
     including a manually-imported dev wallet account, but the
     "auto-loaded" obligation is documented as not-yet-met).
     Recording the missing-key condition in
     `independent/raw-friction.log` as a `[dapp-kit]` or
     `[sandbox]` observation is recommended.
5. The app wraps its tree in `<DAppKitProvider dAppKit={dAppKit}>`
   inside a `<QueryClientProvider client={queryClient}>` (per the
   dashboard's `main.tsx`), then renders the single Layout (no
   routing — Slot 3 UI is single-page).

### Connected-wallet UX

When the user clicks the dapp-kit `<ConnectButton />` (from
`@mysten/dapp-kit-react/ui`) and approves in the dev wallet (or any
other wallet-standard wallet), `useCurrentAccount()` returns a
non-null account. From that point:

**Vault list panel.** Renders one row per vault the user owns and is
not yet withdrawn. Population path:

1. The app issues a `suix_queryEvents` call (via the dapp-kit-react
   `useCurrentClient()` SuiClient instance, which is the
   `SuiGrpcClient` constructed in step 4) against the deployed
   `tpsl_vault` package, filtered to the `VaultCreated` event type
   (the same filter Cycle 4 uses — see Cycle 4 contract "Contract
   decisions" #1 and Cycle 1 friction log 2026-04-27T21:47:00Z:
   either a `MoveModule` filter selecting on the emitting module
   `module: "tpsl_vault"`, or a `MoveEventType` filter targeting
   `${TPSL_VAULT_PACKAGE_ID}::tpsl_vault::VaultCreated`). The implementer
   picks one filter shape and documents the choice in the cycle review.
2. For each `VaultCreated` event, the app extracts `vault_id`,
   `owner`, `pool_id`, `side`, `tp_price`, `sl_price`, and
   `deposit_amount` from the event's `parsedJson` (the same shape the
   keeper consumes; per Cycle 3a contract the event field set is
   load-bearing).
3. The app filters the resulting list to entries where
   `owner === currentAccount.address` BEFORE rendering. This is the
   AC3.14 invariant — the filter is applied client-side after the
   chain-direct event read; switching wallet accounts re-runs the
   filter and the rendered set updates.
4. For each owner-filtered vault, the app issues a `getObject` call
   (with `showContent: true`) on the `vault_id` to read the vault's
   current `triggered` flag and remaining `balance` value. A vault
   whose on-chain object has been deleted (the implementer MAY delete
   the shared object after withdraw — Cycle 3a contract leaves this
   to the implementer) OR whose `balance` value reads as zero AND
   `triggered` is `false` is treated as "withdrawn" and removed from
   the rendered list (see "Withdrawn render" below). A vault whose
   `triggered` flag is `true` renders with a triggered badge plus
   the output amount (see "Triggered render" below); a vault whose
   `triggered` flag is `false` AND whose `balance` value is non-zero
   renders with a withdraw control (see "Withdraw control" below).
5. The list refreshes on a recurring interval (default 5000 ms;
   matches the keeper's default `KEEPER_POLL_INTERVAL_MS` so the UI
   "within one keeper polling interval" obligation in spec UX Flow §3
   step 3 and §3 step 4, plus E-003 step 5, is satisfied with one
   tick of slack). The interval is configurable via
   `import.meta.env.VITE_VAULT_LIST_REFRESH_MS` in the closed range
   [1000, 30000]; values outside that range fall back to the 5000
   default with a `console.warn`.
6. The list refresh additionally fires immediately after the user's
   own `signAndExecuteTransaction` resolves successfully (create or
   withdraw); this is the path the spec UX Flow §3 step 3 calls
   "the new vault appears in the list within one keeper polling
   interval". The refresh is an idempotent re-query (not a delta
   patch); it is safe to call from both the timer and the post-tx
   handler concurrently because the response replaces the list
   wholesale.

**Create-vault form.** A single form with these fields:

- *Coin type.* A select populated from the manifest's `pools[]`
  entries (the user picks a pool first; the form's coin-type input
  is the picked pool's `baseCoinType`). The form does NOT let the
  user free-type a coin type that does not exist in the manifest
  (this would produce a vault with a `pool_id` whose Move package
  cannot route the type-arguments later).
- *Amount.* A numeric input for the deposit amount in atomic units of
  the picked pool's base coin (the same scale `Vault<T>.balance`
  carries). The form displays the `Coin<Base>` decimals from the
  manifest as a hint label (e.g. "DEEP — 6 decimals"); validation
  rejects zero / negative / non-integer / overflowing-`u64`
  amounts with an inline error.
- *Target pool.* The select from the manifest's `pools[]` (same
  select that drives the coin type field; the two are pinned
  together).
- *Side.* A radio or select binding to the `side: u8` Move field
  (per Cycle 3a contract decision #2, `side` is opaque metadata —
  the UI captures it but does not branch behavior on it; the
  recommended UI semantic is `0 = take-profit-on-rise`,
  `1 = stop-loss-on-fall`, but the implementer is free to pick a
  different convention provided it is documented in the form's UI
  copy and in the cycle review).
- *Take-profit price.* An optional numeric input. The user MUST set
  at least one of TP or SL (the form rejects submission with both
  empty; this mirrors the optional `EInvalidTriggerConfig` defense
  in Cycle 3a contract — the Move package may or may not enforce it
  on-chain, but the form enforces it client-side as good UX).
- *Stop-loss price.* An optional numeric input. Same range and
  validation as TP.

On submit, the form constructs a programmable transaction:

```ts
const tx = new Transaction();
const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]); // see note
tx.moveCall({
  target: `${TPSL_VAULT_PACKAGE_ID}::tpsl_vault::create_vault`,
  typeArguments: [pool.baseCoinType],
  arguments: [
    coin,
    tx.pure.id(pool.poolId),
    tx.pure.u8(side),
    tpPrice ? tx.pure(bcs.option(bcs.u64()).serialize(tpPrice)) : tx.pure(bcs.option(bcs.u64()).serialize(null)),
    slPrice ? tx.pure(bcs.option(bcs.u64()).serialize(slPrice)) : tx.pure(bcs.option(bcs.u64()).serialize(null)),
  ],
});
```

The above is illustrative (the `Option<u64>` BCS-serialize call may
take a slightly different shape under SDK 2.x — the implementer
consults `.ts-sdk-docs/sui/bcs.mdx` and `.ts-sdk-docs/dapp-kit/actions/sign-and-execute-transaction.mdx`
before authoring). Note about the `splitCoins` source: when the
chosen coin type is `SUI`, splitting from `tx.gas` is correct;
when the chosen coin type is anything else (DEEP, USDC), the form
must first locate a `Coin<Base>` object owned by the connected
account that holds at least `amount` atomic units (via
`client.getCoins({ owner, coinType })`) and split from THAT coin's
object reference. The implementer handles both paths cleanly; a
"no funded coin available" condition surfaces an actionable inline
error rather than a silent submit failure.

The form submits via dapp-kit-react's `signAndExecuteTransaction`
action surfaced through `dAppKit.signAndExecuteTransaction({ transaction })`
(or the React-hook equivalent
`useSignAndExecuteTransaction` — the implementer picks one and
documents it). On the resolved-success branch the form clears its
inputs, fires a vault-list refresh (per "Vault list panel" step 6
above), and shows a transient success message
("Vault created — appears in the list within one polling
interval"). On the resolved-failure branch (the
`FailedTransaction.status.error` field per the SDK 2.x action
docs) the form preserves its input state and renders the wallet's
returned error message inline; the user can amend and resubmit
without retyping. On wallet-rejection (the user clicks "Reject" in
the dev wallet) the form preserves its inputs and renders a
neutral "Transaction rejected by wallet — try again" message.

**Withdraw control.** Each non-triggered vault row exposes a
`Withdraw` button. On click, the app:

1. Constructs `tx.moveCall({ target:
   "${TPSL_VAULT_PACKAGE_ID}::tpsl_vault::withdraw", typeArguments:
   [vault.baseCoinType], arguments: [tx.object(vault.vaultId)] })`.
2. Submits via `signAndExecuteTransaction`.
3. On resolved-success, immediately refreshes the vault list. The
   refreshed list MUST NOT contain the withdrawn vault: the row
   "no longer appears in the connected account's vault list" per
   spec AC3.16 verification and per E-004 step "assert the vault
   row no longer appears in the connected account's vault list".
   This is the single render rule for this cycle — there is no
   "history" or "withdrawn" subsection. Implementation path: per
   "Vault list panel" step 4, the next refresh tick reads the
   vault's on-chain `balance` value via `getObject`; the row is
   filtered out when `balance == 0` AND `triggered == false`
   (which is exactly the post-withdraw state, since `withdraw`
   drains the entire balance and does NOT flip `triggered`). If
   the implementer also chose the "delete shared object after
   withdraw" Move-side variant from Cycle 3a (the contract leaves
   the choice to the implementer; this cycle does NOT change it),
   the `getObject` returns a not-found / deleted result — also
   handled by the same filter rule (treat as withdrawn → omit).
4. On resolved-failure, renders the wallet's error inline next to
   the row (e.g. `EVaultTriggered = 1002` if the keeper raced
   ahead — surfaced in human-readable form, e.g. "Cannot withdraw
   — vault was triggered before your withdraw landed"; the
   implementer maps the named Cycle 3a error codes 1001 / 1002 to
   user copy).
5. On wallet-rejection, renders a neutral "Transaction rejected by
   wallet" inline.

**Withdrawn render.** A vault that has been successfully withdrawn
(on-chain `balance == 0` AND `triggered == false`, OR the shared
object has been deleted) is OMITTED from the rendered list
entirely per AC3.16. There is no subsection, no "history" panel,
no greyed-out row — the vault simply ceases to appear. (This is
the simpler render rule; it also matches the spec's literal
wording in E-004.)

**Triggered render.** A vault whose on-chain `triggered` flag is
`true` renders with:

- A clearly-labeled triggered badge (e.g., a `<span>` with a
  high-contrast color and the text `Triggered` — the visual
  treatment is at the implementer's discretion provided the
  badge is unambiguous and meets the spec UX Flow §3 step 4
  "renders as triggered" obligation).
- The output amount routed to the owner. The app reads this from
  the corresponding `TriggerFired` event payload — fetched via
  `suix_queryEvents` on the deployed `tpsl_vault` package
  filtered to `${TPSL_VAULT_PACKAGE_ID}::tpsl_vault::TriggerFired`,
  matched on `vault_id == this row's vault_id` (event field
  shape per Cycle 3a contract: `quote_out_amount`,
  `base_residual_amount`, `deep_residual_amount`). The displayed
  output is `quote_out_amount` (the spec's "the output amount
  that was routed to the owner" — singular). The two residual
  amounts MAY also be rendered as supplementary context but are
  not required; if rendered, they must be labeled clearly so the
  user does not confuse `base_residual_amount` for an "amount
  not yet swapped" loss.
- No withdraw control (the on-chain Move would abort with
  `EVaultTriggered`; the UI removes the surface to prevent
  user confusion).

If a triggered vault's `TriggerFired` event has not yet landed in
the queried event window (race condition: the keeper just
submitted; the indexer is propagating), the row renders with the
triggered badge and a placeholder for the output amount (e.g.,
"…") that resolves on the next refresh. The placeholder is
explicitly NOT a "0" or a "—" because both could be confused
with a real trade outcome.

### Error states (spec UX Flow §6)

- *Wallet not connected.* The page renders the `<ConnectButton />`
  prominently and a brief copy line directing the user to connect.
  The vault list and create form are not surfaced (or are surfaced
  in a clearly-disabled state) until `useCurrentAccount()` returns
  a non-null account.
- *Manifest fetch failure.* The page surfaces the middleware's
  404 JSON body (the `error` field) inline with a "Run
  `pnpm deploy-all` from the sandbox" hint.
- *`TPSL_VAULT_PACKAGE_ID` missing.* See "Boot" step 3 — inline
  actionable error.
- *Sui RPC unreachable.* Each list-refresh tick surfaces a
  retriable inline error if the RPC call fails. The error
  surface is non-blocking (the previously-rendered list stays
  visible; the user can keep interacting with their wallet).
- *Transaction rejected by wallet.* Per the create / withdraw
  surfaces above — preserved form state, neutral message, retry.
- *Trigger evaluation failure observed in keeper.* Out of scope
  for the UI to render directly (the keeper logs to its own
  stdout; the UI only consumes on-chain state). The UI's
  triggered-row rendering is purely a function of the on-chain
  `triggered` flag plus the on-chain `TriggerFired` event.

### Lifecycle

The UI is a stateless dev-mode SPA. There is no service worker,
no offline mode, no persistent client-side cache. Refreshing the
browser tab restarts the app fresh; reconnecting the wallet
re-populates the list within one refresh interval.

### Contract decisions resolving spec ambiguities

These resolve places the spec leaves to the implementer so the
implementer does not re-relitigate:

1. **Vault-list source: events vs object enumeration.** Spec
   AC3.14 reads "the vault list filters to vaults owned by the
   connected account." The two SDK 2.x source paths are
   (a) query `VaultCreated` events from the package and filter
   the resulting list by `owner`, or (b) query owned objects of
   the connected account and filter by object type
   (`Vault<T>` is shared, not owned by the address — so this
   path requires a different shape: `getDynamicFields` against
   the user's address would not find shared vaults). This
   contract resolves in favor of path (a) — `suix_queryEvents`
   on `VaultCreated` filtered client-side by `owner` — for two
   reasons: it mirrors the keeper's discovery path (Cycle 4
   contract "Vault discovery loop"; one less bespoke read shape
   for the cross-component to understand), and `Vault<T>` is a
   shared object so `getOwnedObjects` against the user's address
   does not return it. The downstream implication: if the
   indexer has not yet ingested a brand-new `VaultCreated`
   event, the vault appears in the list on the NEXT refresh
   tick (not necessarily the first one after the create-tx
   resolves); the spec UX Flow §3 step 3 "within one keeper
   polling interval" obligation is satisfied by the refresh
   timer plus the post-tx forced refresh in concert. This is a
   real DevX observation worth a `[sui-sdk]` friction-log entry.

2. **dapp-kit-react instance shape.** The dashboard's
   `dapp-kit.ts` uses the `createDAppKit` factory + `<DAppKitProvider
   dAppKit={dAppKit}>` Provider pair (the React-2.0 dapp-kit
   shape). This contract requires the same shape — NOT the
   legacy 1.x `<SuiClientProvider> + <WalletProvider>` shape —
   because the spec pins `@mysten/dapp-kit-react ^2.0.1` and
   the Sui SDK 2.x stale-memory rule forbids the 1.x form.
   The dashboard pattern is the proven mirror; the implementer
   follows it.

3. **Coin source for the create transaction.** When the chosen
   coin type is `SUI`, splitting from `tx.gas` is correct.
   When the chosen coin type is `DEEP` / `USDC` / etc., the
   form locates a funded `Coin<Base>` via
   `client.getCoins({ owner, coinType })` and splits from that
   coin's object reference. If no funded coin is available
   (insufficient balance), the form surfaces an actionable
   inline error ("No `Coin<DEEP>` of size N available — fund
   from sandbox faucet or transfer from treasury") rather than
   submitting a doomed transaction.

4. **Avoiding the Cycle 4 "main loop = test seam" anti-pattern.**
   Cycle 4's iter-1 produced 5 critical findings whose root
   cause was a `runOnePollCycle` function that was both the
   test seam AND the production poll function, with the
   submission step skipped behind an optional dependency. This
   contract requires the UI to mirror the Cycle 4 iter-2 fix
   pattern: every refresh path, every transaction-submit path,
   and every state derivation must be reachable from the
   production wiring as well as from any test seam. Concretely
   — if the implementer adds a `useVaultList` hook with an
   internal `refresh()` function for tests, that same
   `refresh()` must be the function the production timer
   invokes. If the implementer wraps the dapp-kit submit
   action behind a small adapter for testability, the
   adapter's default implementation must be the real
   `dAppKit.signAndExecuteTransaction` call (not a no-op stub
   defaulted in production by accident). Reviewers in this
   cycle should flag any code path where the production code
   would run a different function than the tests do — that's
   exactly the pattern Cycle 4 caught after iter-2 and we don't
   want a third repeat.

5. **No keeper-IPC surface.** The UI does NOT consume the
   keeper's stdout, does NOT make HTTP / RPC calls to the
   keeper, and does NOT depend on the keeper running for the
   create / withdraw / list-render paths. The UI consumes the
   same on-chain state the keeper does (vault objects + events
   via Sui RPC). The keeper's role from the UI's perspective
   is exactly: "something flipped `triggered: false → true` on
   chain" — which the UI's next list refresh observes through
   `getObject`. The two components are independently
   restartable.

6. **Single render rule for withdrawn vaults.** Per the
   "Withdrawn render" section above and per spec AC3.16 / E-004:
   a successfully-withdrawn vault is OMITTED from the rendered
   list. There is no "history" subsection, no greyed-out row,
   no "withdrawn" badge. This contract resolves what was
   previously left as implementer choice in favor of the
   spec-literal interpretation; the implementer does not
   re-relitigate.

### Implementation guidance (non-binding)

- **Sui SDK 2.x stale-memory rule.** Before authoring any
  `@mysten/*` import, the implementer reads the SDK 2.0
  migration doc set in this exact order:
  1. `.ts-sdk-docs/sui/migrations/sui-2.0/index.mdx` (cross-package
     overview).
  2. `.ts-sdk-docs/sui/migrations/sui-2.0/dapp-kit.mdx` (the
     `@mysten/dapp-kit-react` package specifically — covers the
     `createDAppKit` + `<DAppKitProvider>` shape and replaces the
     1.x `<SuiClientProvider> + <WalletProvider>` legacy form).
  3. `.ts-sdk-docs/sui/migrations/sui-2.0/sui.mdx` (the
     `@mysten/sui` package specifically; relevant for
     `Transaction`, `bcs`, `SuiGrpcClient`).
  4. `.ts-sdk-docs/dapp-kit/dapp-kit-instance.mdx` and
     `.ts-sdk-docs/dapp-kit/actions/sign-and-execute-transaction.mdx`
     (the `createDAppKit` config surface and the submit action
     surface).
  5. `.ts-sdk-docs/dapp-kit/react/hooks/use-current-account.mdx`,
     `.ts-sdk-docs/dapp-kit/react/hooks/use-current-client.mdx`,
     and the other `dapp-kit/react/hooks/*` (for the React hook
     shapes the UI consumes).
  Training memory predates 2.0; the hook names, the provider
  shape, and the action API have all changed.

- **Mirror the sandbox dashboard's dapp-kit setup.**
  `~/workspace/deepbook-sandbox/sandbox/dashboard/src/dapp-kit.ts`
  is the proven `createDAppKit` reference for this exact stack
  (`@mysten/dapp-kit-react ^2.0.1`, `@mysten/dapp-kit-core
  ^1.2.2`, `SuiGrpcClient` from `@mysten/sui/grpc`). The Slot 3
  UI's `dapp-kit.ts` follows the same shape, only adjusting:
  - The dev-wallet private key source — the dashboard reads
    `import.meta.env.VITE_DEV_WALLET_PRIVATE_KEY` from the
    sandbox's `.env`; the UI MUST do the same (per Boot step 4
    above and per AC3.13 verification). The dashboard's lines
    8-27 are the exact reference pattern; mirror them verbatim,
    only renaming variables for local style if needed. Pre-import
    is not optional for this cycle.
  - The `baseUrl` — dashboard hardcodes `http://localhost:9000`;
    Slot 3 UI reads `manifest.network.rpcUrl` from
    `/localnet.json` (more robust to a sandbox that boots on a
    non-default port).

- **Mirror the sandbox dashboard's `main.tsx` provider tree.**
  `<StrictMode> > <QueryClientProvider client={queryClient}> >
  <DAppKitProvider dAppKit={dAppKit}> > <App />` is the proven
  shape. The UI follows it.

- **Vite middleware for `/localnet.json`.** Cycle 1's
  `vite.config.ts` is the proven pattern (a
  `server.configureServer` middleware that intercepts
  `/localnet.json` and reads the file from
  `~/workspace/deepbook-sandbox/sandbox/deployments/localnet.json`
  on disk). The Slot 3 UI mirrors that pattern verbatim — same
  path resolution via `homedir()`, same 404-with-actionable-error
  body on miss, same content-type. Do NOT pull the manifest into
  `public/` (the Cycle 1 review documented why: the manifest
  changes per `pnpm deploy-all` and a `public/`-staged copy
  drifts).

- **Type tags for type arguments.** `create_vault<T>` and
  `withdraw<T>` are generic in the vault's coin type. The UI
  resolves the type tag (`<package_id>::module::TypeName`) for
  the picked pool from the manifest's `pools[]` entry; never
  hardcoded, never inferred from the coin name alone. (Cycle 4
  contract guidance #5 made the same point for the keeper's
  `execute_trigger<Base, Quote>` call.)

- **`tx.pure` for Option<u64>.** Move's `Option<u64>` is a
  BCS-serializable shape (a `Some` variant with a `u64` payload
  or a `None` variant). The SDK 2.x docs at
  `.ts-sdk-docs/sui/bcs.mdx` show the canonical encoding. The
  implementer uses the SDK's `bcs.option(bcs.u64())` builder
  rather than hand-rolling the byte sequence — this is exactly
  the kind of detail training memory gets wrong.

- **Refresh timer ergonomics.** The 5000 ms default refresh
  interval matches the keeper's default `KEEPER_POLL_INTERVAL_MS`
  so the spec's "within one keeper polling interval" obligation
  for E-003 / E-004 / E-006 is satisfied with one tick of
  slack. Implementing this as a `setInterval` inside a
  `useEffect` with a cleanup function in the unmount path is
  the simplest correct shape; do not pull in a heavier
  state-management library for this single timer.

- **Wallet-state derived UI.** All "is the user connected?"
  branching reads from `useCurrentAccount()` returning non-null.
  Do not introduce a parallel local state mirror of the
  account; the dapp-kit hook is the source of truth. The
  vault-list refresh effect's dependency array includes the
  account address so switching accounts re-runs the effect
  (E-006).

- **Minimal styling.** The spec's Non-Functional Requirements
  explicitly say "should be readable and keyboard-operable but
  no formal a11y bar applies." A clean, readable layout with
  semantic HTML (form, label, button, table or list) plus
  Tailwind or hand-written CSS is sufficient. The implementer
  may pull in shadcn/ui or Radix primitives if doing so
  reduces LOC; staying lighter (vanilla CSS + semantic HTML)
  is also acceptable. Do not pull in routing, do not pull in a
  CSS-in-JS framework with a runtime cost.

- **LOC envelope.** Cycle 1 overran its envelope ~4-6x; reviewers
  flagged real bloat (parallel APIs, dead types). The
  implementer should keep this UI tight. A target of ~600 LOC
  total across `src/**/*.{ts,tsx}` is reasonable for this
  scope (one `dapp-kit.ts`, one `main.tsx`, one `App.tsx`,
  one `manifest.ts`, one `useVaultList.ts`, one
  `CreateVaultForm.tsx`, one `VaultRow.tsx`, one
  `useTriggeredEvents.ts`, plus type / util files). Going
  significantly over should prompt a self-review for
  duplication.

- **Friction-log discipline.** Append observations to
  `independent/raw-friction.log` during the cycle; AC3.18 is
  validated at end-of-cycle. Realistic categories surfaced by
  this cycle's work: `[dapp-kit]` (the React 2.0 hook surface
  + `<ConnectButton>` + `signAndExecuteTransaction` action),
  `[sui-sdk]` (the BCS `Option<u64>` encoding, the
  `getCoins` / `splitCoins` non-`SUI` path, any
  `suix_queryEvents` quirk that wasn't already friction-logged
  in Cycle 1 or Cycle 4), `[deepbook]` (only if a
  Cycle-3-or-earlier observation surfaces a new edge here —
  unlikely; the UI doesn't call DeepBook directly), `[sandbox]`
  (only if the manifest schema or dev-wallet key path
  surprises). The end-of-cycle review's AC3.18 check evaluates
  the union of Cycles 3a + 3b + 3c (per cycle-plan Cycle 3c)
  and confirms at least one entry from each relevant source
  category seen across all three sub-cycles.

## In scope

This section enumerates the set of files this cycle is permitted
to create or modify. The authoritative scope boundary is the
`## Files` section below; this list and `## Files` are kept in
sync. Where this section names an "Optional" file, the file may
be omitted (the cycle's AC compliance does not depend on it) but
if the implementer ships it, the file MUST land at one of the
glob paths listed under `## Files`.

A single React + Vite + dapp-kit-react TypeScript SPA rooted at
`independent/03-tpsl-vault/ui/` with these files:

- `package.json` declaring:
  - `"name": "@independent/03-tpsl-vault-ui"`, `"private": true`,
    `"version": "0.0.1"`, `"type": "module"` (Sui SDK 2.x and
    dapp-kit-react are ESM-only).
  - Dependencies (pinned to spec.md "Architecture Overview > Tech
    stack"): `"@mysten/sui": "^2.14.1"`,
    `"@mysten/dapp-kit-react": "^2.0.1"`,
    `"@mysten/dapp-kit-core": "^1.2.2"`,
    `"react": "19.2.0"`, `"react-dom": "19.2.0"`,
    `"@tanstack/react-query": "^5.x"` (matches the dashboard's
    pin band; the implementer pins to what the running dapp-kit
    requires per its peerDependencies). `@mysten-incubation/dev-wallet`
    is REQUIRED — the spec AC3.13 "auto-loaded dev wallet"
    obligation is satisfied only by the dashboard's pattern of
    `InMemorySignerAdapter` + `devWalletInitializer` +
    deployer-key pre-import (see Boot step 4 and the
    Implementation guidance "Mirror the sandbox dashboard's
    dapp-kit setup" bullet). The implementer pins the package
    to the same major as the sandbox dashboard's
    `pnpm-lock.yaml` resolution. `@mysten/deepbook-v3` is NOT a
    dependency of this UI (the UI never calls DeepBook directly;
    every DeepBook interaction is mediated by the
    `tpsl_vault` Move package, exactly the same justification
    Cycle 4 contract used for the keeper's package.json — see
    Cycle 4 AC3.7 verification).
  - Dev dependencies: `"typescript": "~5.9.3"`, `"vite": "^7.3.1"`,
    `"@vitejs/plugin-react": "^5.x"` (matches the dashboard /
    Cycle 1), `"@types/react": "^19.x"`, `"@types/react-dom":
    "^19.x"`, `"@types/node": "^24.x"`. Test deps (vitest,
    jsdom, @testing-library/react, @testing-library/jest-dom)
    are recommended; the implementer mirrors Cycle 1's package.json
    test stack.
  - Scripts: `"dev"` (`vite`), `"build"` (`vite build` — or
    `tsc -b && vite build` mirroring the dashboard if the
    implementer wants tsc to run as a pre-build typecheck),
    `"preview"` (`vite preview`), `"test"` (`vitest run`),
    `"test:watch"` (`vitest`).
- `tsconfig.json` configured per Sui SDK 2.0 ESM requirements:
  `"module": "NodeNext"` (or `"ESNext"`),
  `"moduleResolution": "NodeNext"` (or `"Bundler"`),
  `"target": "ES2022"`, `"strict": true`, `"esModuleInterop":
  true`, `"skipLibCheck": true`, `"jsx": "react-jsx"`,
  `"outDir": "./dist"`, `"rootDir": "./src"`. Other compiler
  settings are at the implementer's discretion. The implementer
  MAY add a `tsconfig.node.json` for the Vite config file
  mirroring the dashboard if the strict-mode TS settings
  conflict with `vite.config.ts`'s Node imports.
- `vite.config.ts` mirroring Cycle 1's pattern:
  - `defineConfig` with `plugins: [react()]`.
  - `server.configureServer` middleware intercepting
    `/localnet.json` and serving from
    `path.join(homedir(), 'workspace', 'deepbook-sandbox',
    'sandbox', 'deployments', 'localnet.json')`. Returns 404
    with a JSON `{ error: ... }` body on read-miss, naming the
    bootstrap command.
  - `test` block (vitest config) with `environment: 'jsdom'`,
    `globals: true`, `include: ['src/**/*.{test,spec}.{ts,tsx}']`
    (colocated layout, matches the in-scope `## Files` glob; this
    diverges from Cycle 1's `tests/**/*` only because Cycle 5's
    file scope does not whitelist a separate `tests/` sibling
    by default — the colocated layout keeps tests inside the
    declared `src/**/*.{ts,tsx}` glob without a scope-extension
    request). If the implementer obtains a green-phase scope
    extension to add a `tests/` sibling, they additionally
    extend the include glob to
    `['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}']`.
- `index.html` — minimal HTML shell with a `<div id="root">`
  that `main.tsx` mounts into. Mirrors the dashboard's
  `index.html` shape (which mirrors any standard Vite + React
  template).
- `src/main.tsx` — entry point. Renders `<StrictMode> >
  <QueryClientProvider client={queryClient}> > <DAppKitProvider
  dAppKit={dAppKit}> > <App />`. Imports `./dapp-kit.ts` for
  the `dAppKit` instance. The `queryClient` instance may live
  here or in a small `query-client.ts` file; either is fine.
  Global styles are imported here if the implementer ships a
  CSS file (see the styling note below).
- `src/dapp-kit.ts` — `createDAppKit` instance. Mirrors
  `~/workspace/deepbook-sandbox/sandbox/dashboard/src/dapp-kit.ts`
  with one adjustment documented above (manifest-derived
  `baseUrl` instead of the dashboard's hardcoded
  `http://localhost:9000`). The deployer-key pre-import path is
  required, NOT optional (see Boot step 4 and AC3.13). Exports
  the `dAppKit` instance and the augmented `Register` module
  declaration.
- `src/App.tsx` — top-level layout. Renders the connect button,
  the create-vault form, and the vault list. Wraps the
  create / list surfaces in a "wallet not connected" gate
  against `useCurrentAccount()`.
- `src/manifest.ts` — manifest loader. Fetches `/localnet.json`
  once at mount via a `useQuery` (cached for the session), and
  exposes resolved fields (`rpcUrl`, `deepbookPackageId`,
  `tokenPackageId`, `pools[]`) plus a typed `Pool` shape. The
  `TPSL_VAULT_PACKAGE_ID` env var is also surfaced from this
  file (it is package metadata even though it is not in the
  sandbox manifest).
- `src/useVaultList.ts` (or `src/hooks/useVaultList.ts`) — the
  vault-list hook. Encapsulates the `suix_queryEvents` +
  `getObject` reads, the owner filter, the refresh timer, and
  the post-tx forced-refresh entry point. Returns the
  typed `Vault[]` plus a `refresh()` function (callable from
  create / withdraw success handlers). Per "Contract
  decisions" #4, this hook's `refresh()` is the SAME function
  the production timer invokes — there is no separate
  "production-only" refresh path.
- `src/useTriggeredEvents.ts` (optional; may be merged into
  useVaultList) — looks up `TriggerFired` event payloads for
  triggered vaults so the row can render the output amount.
  Cached per `vault_id`.
- `src/CreateVaultForm.tsx` — the create form. Self-contained;
  reads pools from `manifest.ts`, builds the PTB, submits via
  dapp-kit-react, calls `refresh()` on success.
- `src/VaultRow.tsx` — single-row render. Shows
  `vault_id` (truncated), pool label, side, TP/SL prices,
  balance, and either a Withdraw button (untriggered) or a
  triggered badge + output amount (triggered).
- Optional `src/lib/*.ts` (or `src/util/*.ts`) for small pure
  helpers (e.g., a `truncateAddress`, a `formatU64Amount`
  formatter, a `bcs.option(...)` helper). Pure functions;
  vitest-testable in isolation.
- **Styling note.** The implementer MAY ship a `src/index.css`
  global stylesheet OR rely on inline styles / a CSS-modules
  approach within the `.tsx` files; both approaches fall under
  the `src/**/*.{ts,tsx}` glob in `## Files` if no separate
  `.css` file is created. If the implementer DOES want a
  separate global stylesheet, the orchestrator's cycle-init
  step will need to extend the scope glob to include
  `src/**/*.css` (the implementer flags this in the green
  phase via the standard "scope expansion" path; do not silently
  add a `.css` file outside the declared globs).
- **Tests note.** The cycle's red/green loop runs against unit
  tests located in the conventional vitest layout. The
  implementer MAY ship them as colocated `src/**/*.test.ts(x)`
  (which falls within the `src/**/*.{ts,tsx}` glob) OR — if a
  `tests/` sibling directory feels cleaner — request a scope
  extension at green-phase to add `tests/**/*.{test,spec}.{ts,tsx}`.
  The default layout for this cycle is colocated; the cycle's
  AC compliance does not depend on the layout choice. The unit
  tests target the pure helpers (formatters, BCS option
  builder), the `useVaultList` filter logic (with mocked
  SuiClient), the `CreateVaultForm` validation, and the
  `VaultRow` triggered-vs-untriggered branching. AC3.13 through
  AC3.17 are also validated end-to-end via E-003, E-004, and
  E-006 (chrome-devtools-mcp scenarios) against the live
  sandbox; the unit tests are NOT a substitute for the e2e pass.

Friction observations appended to `independent/raw-friction.log`
during this cycle. AC3.18 (cross-Slot-3 friction-log coverage,
evaluated over the union of Cycles 3a + 3b + 3c) is formally
validated at the end of this cycle's review. This cycle MUST
append at least one entry per source category it actually
exercises during this cycle's work; realistic categories for
Cycle 5 are `[dapp-kit]`, `[sui-sdk]`, `[sandbox]` (only if
surprises surface), and possibly `[deepbook]` (unlikely; the
UI does not call DeepBook directly). The end-of-cycle review
takes the union of all three sub-cycles' entries and confirms
every relevant source category seen during Slot 3 work is
represented.

## Out of scope

- Any modification to `~/workspace/deepbook-sandbox/`. The sandbox
  is a read-only dependency. The UI consumes the sandbox via the
  Vite middleware reading the deployments manifest, which is a
  read.
- Any modification to the Cycle 3a Move package
  (`independent/03-tpsl-vault/move/`) or the Cycle 4 keeper
  (`independent/03-tpsl-vault/keeper/`). The UI consumes both via
  on-chain state only; if the UI surfaces a need for a new Move
  entry or a new keeper logging field, that is a follow-up cycle,
  not a scope expansion of Cycle 5.
- Slot 1 (`independent/01-market-stats/`) and Slot 2
  (`independent/02-slippage-swap/`) sources. Out of scope per
  files-in-scope glob; the proven Cycle 1 patterns (the Vite
  middleware shape, the dapp-kit dashboard pattern) MAY be
  referenced and mirrored but their source files are NOT
  imported.
- Any source under `01-orderbook-viewer/`, `02-fee-rebate-swap/`,
  `03-dca-vault/`, `FEEDBACK.md`, or `RUNBOOK.md` at the repo
  root (forbidden-read boundary inherited from spec.md
  "Cross-Cutting Invariants > Forbidden-read boundary" — the
  prior solution's Slot-3 UI equivalent at `03-dca-vault/` MUST
  NOT be opened by this cycle's planner, implementer, or
  reviewer).
- The Cycle 4 keeper's stdout consumption from inside the UI.
  The UI does NOT pipe / parse keeper logs; the two components
  communicate through on-chain state only.
- A keeper-supplied "low DEEP balance" surface in the UI. That
  observable is the keeper operator's concern, not the wallet
  user's.
- Multi-wallet account-switching in a single browser tab while
  preserving the create-form draft. Switching accounts resets
  the form (and the vault list re-renders against the new
  account) — the spec does not require draft preservation
  across wallet switches.
- A "history" view of withdrawn vaults, a "withdrawn" subsection,
  or any greyed-out / archive surface for vaults that have been
  withdrawn. Per "Contract decisions" #6 and the "Withdrawn
  render" rule above, withdrawn vaults are OMITTED from the
  rendered list entirely; there is no other surface for them in
  this cycle.
- Pagination of the vault list. The expected vault count per
  user on a localnet is small (single digits in practice for
  E-003 / E-004 / E-006); pagination would be over-engineering
  for this cycle.
- Routing / multi-page navigation. Single-route SPA; no
  React Router.
- Production-grade caching, retry/backoff, or a service
  worker. Same as Cycle 1.
- Wallet-disconnect telemetry, analytics, or any external
  observability surface.
- Production-grade ESM-vs-CJS configuration tuning beyond what
  SDK 2.x ESM-only requires (`"type": "module"` plus the
  matching tsconfig settings).
- `RUNBOOK.md` and `FEEDBACK.md` documentation (Cycle 4 docs
  pass per cycle-plan; that cycle is post-this-cycle in the
  ordering).
- Modifying `.forge/spec.md`, `.forge/cycle-plan.md`,
  `.forge/agent-config.md`, or any prior cycle's contract /
  review.
- Testnet / devnet / mainnet operation. Localnet only.
- Production-grade keeper-key UX. The dev wallet is a
  localnet-only convenience; the UI does not surface key
  management for the user's connected wallet beyond what
  dapp-kit's `<ConnectButton />` already provides.

## Files

This is the authoritative scope boundary for this cycle. The
implementer creates or modifies only files matching one of the
glob paths below. All files named "Optional" in `## In scope`
above are still subject to these globs — i.e., they must land
at one of these paths or not exist. Anything else requires a
green-phase scope extension request to the orchestrator.

- `independent/03-tpsl-vault/ui/package.json`
- `independent/03-tpsl-vault/ui/tsconfig.json`
- `independent/03-tpsl-vault/ui/tsconfig.node.json` (optional;
  see tsconfig note in In Scope)
- `independent/03-tpsl-vault/ui/vite.config.ts`
- `independent/03-tpsl-vault/ui/index.html`
- `independent/03-tpsl-vault/ui/src/**/*.ts`
- `independent/03-tpsl-vault/ui/src/**/*.tsx`
- `independent/raw-friction.log` (append-only)

## Acceptance

(See Acceptance criteria — this section exists so the structural
validator finds its required heading.)

## Acceptance criteria

Lifted verbatim from spec.md Slot 3 UI block (AC3.13 through
AC3.17), the Slot 3 keeper-side AC3.12 (full demo path now claimed
here per cycle-plan Cycle 3c), and the cross-component AC3.18.
Every AC traces back to a spec AC ID. Test IDs (`T-NNN`) for the
unit / integration suite will be assigned by the test-author
phase against `tests.json`; this contract names the behavior, not
the test files.

- **AC3.12** — *An end-to-end demo path is documented and verified:
  sandbox boot → publish package → keeper running → user creates TP
  vault via UI → operator pushes the relevant on-chain price past
  the threshold → keeper detects, fires, and the UI reflects the
  triggered state with the output coin routed to the owner.*
  - Verification: this is the full AC3.12 deliverable that
    Cycle 4 staged the keeper-side prerequisites for. Concrete
    end-to-end check (mirrors E-003's scenario):
    1. Sandbox up; `tpsl_vault` published; keeper running with
       valid `TPSL_VAULT_PACKAGE_ID` and `KEEPER_DEEP_COIN_ID`;
       Slot 3 UI dev server running on its configured port; dev
       wallet has a funded `Coin<Base>` for the chosen pool.
    2. The user opens the UI, clicks Connect, approves in the
       dev wallet, opens the create form, picks a coin / amount /
       pool / side / TP price reachable by a sandbox-side
       market-mover trade, and submits.
    3. Within one vault-list refresh interval (default 5 s, ≤ one
       keeper polling interval) the new vault appears in the
       list with `triggered: false`.
    4. The operator runs a sandbox-side market-mover trade
       sufficient to push the on-chain Pyth-derived
       `current_price` past the vault's TP. (Tooling: a sandbox
       script under `~/workspace/deepbook-sandbox/sandbox/scripts/`
       or a Move CLI call against `swap_exact_base_for_quote`
       with a large enough size to move the indexed price.)
    5. Within one keeper polling interval after the price moves,
       the keeper fires `execute_trigger` (Cycle 4 obligation;
       observable in the keeper's stdout and on chain).
    6. Within one vault-list refresh interval after the trigger
       transaction lands, the UI's vault row for that vault
       transitions to a triggered badge AND renders the output
       amount (read from the `TriggerFired` event's
       `quote_out_amount` field). The wallet's account
       balance also reflects receipt of `Coin<Quote>` of value
       `quote_out_amount` (plus the `base_residual_amount` and
       `deep_residual_amount` per Cycle 3a contract decision #3).
    7. The full path takes at most ~15 s from price-mover trade
       to triggered render in the UI: ≤5 s for keeper detect +
       fire, ~1 s for tx finality, ≤5 s for UI refresh tick to
       see the new on-chain `triggered` flag plus the
       `TriggerFired` event. The implementer documents this
       observed latency in the cycle review.

- **AC3.13** — *The UI is React + Vite with `@mysten/dapp-kit-react`;
  the connect-wallet flow works against the sandbox's auto-loaded
  dev wallet.*
  - Verification: `package.json` declares `"@mysten/dapp-kit-react":
    "^2.0.1"`, `"@mysten/dapp-kit-core": "^1.2.2"`, `"react":
    "19.2.0"`, `"vite": "^7.3.1"` (matching spec Architecture
    Overview pins) AND `@mysten-incubation/dev-wallet` (REQUIRED
    for the auto-loaded dev wallet — see Behavior "Boot" step 4
    and Contract decisions implicit in the dashboard mirror).
    `pnpm install` exits zero. `pnpm dev` starts Vite cleanly.
    The app's provider tree is `<DAppKitProvider
    dAppKit={dAppKit}>` (the React-2.0 dapp-kit shape — NOT the
    legacy 1.x `<SuiClientProvider> + <WalletProvider>` shape).
    `dapp-kit.ts` uses `createDAppKit(...)` mirroring the
    sandbox dashboard's pattern, including the deployer-key
    pre-import path: read `import.meta.env.VITE_DEV_WALLET_PRIVATE_KEY`,
    decode via `decodeSuiPrivateKey`, build an `Ed25519Keypair`,
    call `adapter.importAccount({ signer, label: "Deployer" })`,
    `await` the resulting promise before invoking
    `createDAppKit(...)`. With a valid `VITE_DEV_WALLET_PRIVATE_KEY`
    in `.env.local` (sourced from the sandbox's `.env` after
    `pnpm deploy-all`), the dev wallet UI mounts with the
    deployer account auto-loaded — this is the spec's
    "auto-loaded dev wallet" obligation. The `<ConnectButton />`
    from `@mysten/dapp-kit-react/ui` renders in the page;
    clicking it opens the wallet modal; selecting the dev wallet
    completes the connect flow without console errors AND
    without requiring the user to paste a private key. (Cycle
    test: rendering `<DAppKitProvider> > <App />` in jsdom with
    a test dapp-kit instance mounts without throwing; an
    integration test against the dev wallet's
    `InMemorySignerAdapter` with a fixture private key
    pre-imported asserts the dev wallet account is present
    before the user clicks Connect, and that
    `useCurrentAccount()` returns a non-null account whose
    address matches the fixture key's address after the connect
    flow completes. The end-to-end live-sandbox check is folded
    into E-003 / E-004 / E-006, all of which depend on the
    deployer-key pre-import to be exercisable without manual
    key paste.)

- **AC3.14** — *The vault list filters to vaults owned by the
  connected account.*
  - Verification: with two distinct dev addresses A and B, a
    vault created by A is rendered in the UI when the user
    connects as A and is NOT rendered when the user connects as
    B. The filter is applied client-side on the
    `VaultCreated` event's `owner` field after the chain-direct
    `suix_queryEvents` read; `useCurrentAccount()` is the source
    of truth for the comparison. Switching accounts (the
    dapp-kit `useCurrentAccount` hook returns a new value)
    re-runs the effect's filter and the rendered set updates.
    (Cycle test: a `useVaultList` hook test feeds the hook a
    fixture set of `VaultCreated` events from two accounts plus
    a fixed `currentAccount` and asserts the rendered set is
    exactly the entries whose `owner` matches. End-to-end:
    E-006.)

- **AC3.15** — *A vault creation form captures coin type, amount,
  target pool, side, and optional TP/SL prices, and submits a
  transaction. On success, the new vault appears in the list
  within one keeper polling interval.*
  - Verification: the create-vault form has the five named
    inputs (coin type, amount, target pool, side, TP/SL prices,
    with at least one of TP/SL required client-side) and a
    submit control. Submitting builds a programmable transaction
    calling `${TPSL_VAULT_PACKAGE_ID}::tpsl_vault::create_vault<T>`
    with the correct argument shape (input coin, pool_id, side,
    Option<u64> tp_price, Option<u64> sl_price, ctx). The
    transaction is submitted via dapp-kit-react's
    `signAndExecuteTransaction` action. On the resolved-success
    branch, the form's success handler triggers a vault-list
    `refresh()` (the same function the timer invokes). Within
    one vault-list refresh interval (default 5 s, matching the
    keeper's default `KEEPER_POLL_INTERVAL_MS = 5000`), the new
    vault appears in the connected account's vault list with
    `triggered: false`. (Cycle test: a `CreateVaultForm` test
    with a mocked `dAppKit.signAndExecuteTransaction` asserts
    the PTB shape — package id, module, function, type
    arguments, argument values — matches the contract.
    End-to-end: E-003 step "submit the create form … wait for
    the new vault to appear in the connected account's vault
    list".)

- **AC3.16** — *A withdraw control on each non-triggered vault
  submits an owner-only transaction. On success, the vault
  disappears from the list.*
  - Verification: each vault row whose on-chain `triggered`
    flag is `false` exposes a Withdraw button. Clicking it
    builds `tx.moveCall({ target:
    "${TPSL_VAULT_PACKAGE_ID}::tpsl_vault::withdraw",
    typeArguments: [vault.baseCoinType], arguments:
    [tx.object(vault.vaultId)] })` and submits via
    dapp-kit-react. On the resolved-success branch, the vault
    list refreshes and the row no longer appears anywhere in
    the rendered UI: per "Contract decisions" #6 and
    "Withdrawn render", a successfully-withdrawn vault is
    OMITTED from the list entirely (no "history" subsection,
    no greyed-out row, no "withdrawn" badge). On a wallet
    error or on-chain abort, the row stays and renders an
    inline error mapping `ENotOwner = 1001` and
    `EVaultTriggered = 1002` to user copy. (Cycle test: a
    `VaultRow` test asserts the Withdraw button is present
    for `triggered: false` rows and absent for `triggered:
    true` rows; a hook test asserts the list refresh fires
    after a successful withdraw AND that a vault whose
    `getObject` returns `balance == 0 && triggered == false`
    is filtered out of the returned list. End-to-end: E-004.)

- **AC3.17** — *Triggered vaults render with a clear triggered
  badge and the output amount that was routed to the owner.*
  - Verification: a vault row whose on-chain `triggered` flag
    is `true` renders a clearly-labeled triggered badge (a
    `<span>` or equivalent with high-contrast styling and the
    text "Triggered" or equivalent unambiguous label) and the
    output amount routed to the owner. The output amount is
    the `quote_out_amount` field from the corresponding
    on-chain `TriggerFired` event payload (event field shape
    per Cycle 3a contract; emitted on every successful
    trigger fire per Cycle 4 obligation). The Withdraw button
    is NOT rendered on a triggered row (the on-chain Move
    would abort with `EVaultTriggered`; removing the surface
    prevents user confusion). (Cycle test: a `VaultRow` test
    feeds the row a fixture vault with `triggered: true` and a
    matching `TriggerFired` event payload, asserts the badge
    is present, asserts the displayed output amount matches
    `quote_out_amount`, asserts the Withdraw button is absent.
    End-to-end: E-003 final step "the ui shows the output
    amount routed to the owner for that vault".)

- **AC3.18** — *By the end of the Slot-3 cycle, `independent/raw-friction.log`
  contains at least one entry from every relevant source category
  seen during Slot 3 work.*
  - Verification: at end-of-cycle review, the consolidator
    enumerates every source category exercised across the union
    of Cycles 3a + 3b + 3c (per cycle-plan Cycle 3c — the
    "Slot-3 cycle" referenced in spec AC3.18 means this union).
    Realistic categories across the three sub-cycles:
    - `[deepbook]` — exercised by Cycle 3a (no-manager swap
      pattern, fixture reuse, named error code overlap with
      DeepBook's 0-30 range).
    - `[move]` — exercised by Cycle 3a (Move 2024 idiom,
      `Option<u64>` ergonomics, test-scenario caveats).
    - `[sui-sdk]` — exercised by Cycle 4 (event filter
      semantics, simulateTransaction pattern, ephemeral keypair
      / faucet flow, Transaction#serialize() deprecation,
      suix_queryEvents positional params) and Cycle 5
      (BCS Option<u64>, getCoins-then-splitCoins for non-SUI,
      any new SDK 2.x quirk).
    - `[dapp-kit]` — exercised by Cycle 5 (the React 2.0 hook
      surface, `<ConnectButton>` flow,
      `signAndExecuteTransaction` action's
      `FailedTransaction` discriminated union, the
      `<DAppKitProvider>` setup vs the legacy 1.x providers).
    - `[sandbox]` — already exercised by Phase 0 (indexer
      pool-keyed REST broken — 2026-04-27T21:25Z entries) and
      potentially this cycle if the dev-wallet key path or
      manifest schema surprises.
    - `[sui-pilot]` — exercised by Cycles 3a / 4 / 5 if any
      sui-pilot tooling friction surfaces (this is a soft
      surface; not strictly required if no friction surfaces).
    - `[forge-process]` — out of FEEDBACK scope by default
      (filter applied in the docs pass per spec
      Cross-Cutting Invariants); not counted toward AC3.18
      unless re-tagged.
    The reviewer reads the consolidated `raw-friction.log`,
    matches lines to categories, and confirms every realistic
    category has ≥ 1 entry. If a category is missing, the
    reviewer notes it and either (a) adds a missing observation
    that surfaces during the AC3.18 review pass itself, or (b)
    flags the gap as a known carry-forward to FEEDBACK
    (preferred over fabricating an observation).

## E2E coverage

This cycle promotes three scenarios from stub to real and (by
construction) leaves no Slot-3 scenarios at stub. The final
state across the seven E2E scenarios:

- **E-001** (Slot 1) — already real (Cycle 1).
- **E-002** (Slot 2) — already real (Cycle 2).
- **E-003** (`slot 3 end-to-end take-profit fire from ui through
  keeper through ui again`, kind `ui`,
  `covers_contract: [AC3.2, AC3.4, AC3.9, AC3.10, AC3.12, AC3.13,
  AC3.15, AC3.17]`) — status: **real** (per cycle-plan
  Cycle 3c). All preconditions are satisfiable as of this cycle:
  Cycle 3a published the Move package and emits the
  `VaultCreated` / `TriggerFired` events the scenario asserts on,
  Cycle 4 runs the keeper that detects and fires within one
  polling interval, Cycle 5 ships the UI that creates vaults via
  the form and renders the triggered badge + output amount. The
  scenario's full sequence (navigate → connect → create → wait
  for list refresh → side-channel-assert `VaultCreated` → push
  price → wait for keeper to fire → assert UI transitions to
  triggered → assert UI shows output amount → side-channel-assert
  `TriggerFired`) is exercisable end-to-end against the live
  sandbox. The `tooling: chrome-devtools-mcp` is the orchestrator's
  e2e harness; the cycle's review documents the chrome-devtools-mcp
  invocation.

- **E-004** (`slot 3 owner-only withdraw before trigger returns
  full balance and removes vault`, kind `ui`,
  `covers_contract: [AC3.3, AC3.13, AC3.16]`) — status: **real**
  (per cycle-plan Cycle 3c). The Move-side withdraw path was
  already exercised by Cycle 3a's "withdraw before fire (success)"
  unit test; this cycle ships the UI's Withdraw button that drives
  it from a wallet-connected user. The scenario's sequence
  (navigate → connect → create with TP/SL outside reach → wait
  for list refresh → click Withdraw → wait for refresh → assert
  vault row no longer in active list → assert connected account's
  base coin balance reflects the deposit return less gas) is
  exercisable end-to-end. Per "Contract decisions" #6, "no longer
  in active list" means OMITTED entirely — there is no other
  surface (history subsection, greyed-out row) the row could move
  to in this cycle.

- **E-005** (Slot 2 success path) — already real (Cycle 2).

- **E-006** (`slot 3 vault list excludes vaults owned by other
  accounts`, kind `ui`, `covers_contract: [AC3.14]`) —
  status: **real** (per cycle-plan Cycle 3c). The UI's owner
  filter (per AC3.14 verification) is the missing piece; this
  cycle ships it. The scenario (account A creates vault via
  CLI → connect as account B → assert account A's vault is
  invisible → reconnect as A → assert account A's vault is
  visible) is exercisable end-to-end.

- **E-007** (Slot 3 CLI withdraw rejection) — already real
  (Cycle 4).

## Decision Gates

No new decision gates introduced this cycle. The carried-forward
gates and their status:

- **G-Boot** (already passed; carried forward from Cycle 1).
  Sandbox boots cleanly via `pnpm deploy-all`; manifest written;
  ports `:9000` (Sui RPC), `:9008` (indexer REST status), `:9010`
  (oracle status) all respond. This cycle does NOT re-verify
  G-Boot but DOES depend on it remaining green throughout.
- **G-Pyth** (already passed; carried forward from Cycle 4).
  The keeper's `notes/pyth-shape.md` is sealed and referenced
  from the keeper's `pythReader.ts`. This cycle does NOT touch
  Pyth on-chain reads (the keeper handles all Pyth integration).
- **G-Vault** (already passed; carried forward from Cycle 3a).
  The Move package uses the no-manager swap path; this cycle
  does NOT touch the Move package and inherits the gate.

## Stated orchestration dependencies

- Cycles 1, 2, 3a, 4 complete with the sandbox up (G-Boot still
  passing).
- The Cycle 3a `tpsl_vault` Move package published against the
  running sandbox so the UI has a known package id to consume
  via `VITE_TPSL_VAULT_PACKAGE_ID`. The publish step is itself
  NOT a Cycle 5 deliverable (the UI assumes the operator has
  published — the same assumption Cycle 4 makes for the
  keeper). The cycle's runbook-style instructions in the green
  phase will document the publish command.
- The Cycle 4 keeper running against the same published
  package, so the UI's triggered-state rendering surface
  (E-003, AC3.12, AC3.17) has something driving the on-chain
  `triggered` flag from `false → true` in response to Pyth
  price moves. The UI does not start the keeper; the operator
  does.
- The dapp-kit-react ^2.0.1 / dapp-kit-core ^1.2.2 / SuiGrpcClient
  surface remaining stable — i.e., the same versions the sandbox
  dashboard uses successfully. If a peer-dep mismatch surfaces
  during `pnpm install`, the implementer pins to the dashboard's
  resolved versions (the dashboard's `pnpm-lock.yaml` shows the
  successful resolution) and friction-logs the resolution as a
  `[dapp-kit]` or `[sui-sdk]` observation.
- No new decision gates introduced beyond the carry-forwards
  above.
