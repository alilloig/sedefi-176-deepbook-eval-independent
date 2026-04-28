# Cycle 3 Contract — Slot 3 TP/SL Vault (Move package, sub-cycle 3a of Slot 3)

## Goal

Deliver a Move 2024 package under `independent/03-tpsl-vault/move/` that
defines `Vault<T>` as a shared object custodying a `Balance<T>` under
owner-defined take-profit and stop-loss prices, plus three entry functions
(`create_vault`, `withdraw`, `execute_trigger`) and two events
(`VaultCreated`, `TriggerFired`). On trigger fire the vault uses DeepBook's
no-manager `swap_exact_base_for_quote` (per Decision Gate G-Vault) to convert
the custodied balance and route the output coin to the vault owner. Tests
under `tests/` exercise the five required state-transition paths from AC3.5
using DeepBook's `pool_tests::setup_everything` fixture pattern proven by
Cycle 2. The `Move.toml` mirrors Cycle 2's proven dependency declaration
(structurally equivalent to the sandbox's `example_contract` template, with
the Cycle-2 `deepbook_margin` deviation carried forward).

## Behavior

A user constructs a vault by calling `create_vault<T>` with an input
`Coin<T>`, the target DeepBook pool's `ID`, a `side: u8` indicator
(stored-and-emitted opaque metadata only — see "Side semantics" below), and
at least one of `Option<u64>` take-profit / stop-loss prices. The
constructor wraps the coin's balance into a freshly-shared `Vault<T>` whose
`triggered` flag starts `false` and emits a `VaultCreated` event carrying
the new vault's `vault_id`, `owner`, `pool_id`, `side`, `tp_price`,
`sl_price`, and the deposited amount.

While the vault is untriggered, the owner may call `withdraw<T>` to drain
the entire custodied balance back into a `Coin<T>` returned to the sender;
the function aborts with `ENotOwner` if the caller is not `vault.owner`
and aborts with `EVaultTriggered` if `vault.triggered` is already `true`.

Anyone may call `execute_trigger<Base, Quote>` with the vault, the target
DeepBook `Pool<Base, Quote>` shared object, the current observed price
(provided by the off-chain keeper from a Pyth `PriceInfoObject` read in
Cycle 3b), a `Coin<DEEP>` covering the swap fee, and the system `&Clock`.
The function aborts with `EVaultTriggered` if the vault has already fired,
and aborts with `ETriggerConditionNotMet` unless one of the configured
conditions is satisfied: TP fires when `tp_price.is_some() &&
current_price >= tp_price`; SL fires when `sl_price.is_some() &&
current_price <= sl_price`. On success the function withdraws the entire
balance from the vault into a `Coin<Base>`, calls
`deepbook::pool::swap_exact_base_for_quote` (no-manager path) with the
withdrawn base coin, the supplied DEEP coin, and `min_quote_out = 0` (the
vault is gated by the keeper-supplied condition rather than a separate
slippage floor in this slot), destructures the returned
`(Coin<Base>, Coin<Quote>, Coin<DEEP>)` tuple, transfers all three coins to
`vault.owner` (NOT to the trigger caller — the owner alone receives the
proceeds and the residuals; see "Output coin handling" below for the
spec-vs-contract reconciliation), sets `vault.triggered = true`, and emits
a `TriggerFired` event carrying the vault's id, the owner, the
`current_price` that satisfied the gate, the `quote_out_amount`, and the
two residual amounts (`base_residual_amount`, `deep_residual_amount`).

The vault state machine is one-way: `triggered: false → true`; a triggered
vault accepts no further operations and is effectively a settled record on
chain. The implementer may choose whether to delete the shared object
post-trigger or leave it in place; both are acceptable interpretations of
spec AC3.4 ("marks the vault triggered"). The latter is recommended for
this cycle because it leaves an indexable settled-record for the UI to
render in Cycle 3c (AC3.17).

No `BalanceManager` is constructed or referenced anywhere in this package.

### Contract decisions resolving spec ambiguities

These three decisions resolve places where the spec's Slot-3 Move
acceptance criteria leave an interpretive gap that the implementer would
otherwise have to invent. Each decision is documented here so the
implementer does not have to make the call independently:

1. **"Entry function" interpretation.** Spec AC3.2, AC3.3, AC3.4 each say
   "entry function". This contract takes that wording literally: the three
   functions `create_vault`, `withdraw`, `execute_trigger` are declared
   `public entry fun` (the Move 2024 keyword form). Cycle 2's R4 finding
   noted that lint W99010 flags `public entry` as deprecated style for the
   Slot-2 single-call wrapper, but the spec word here is "entry", and a
   contract that downgrades to plain `public fun` would not be verbatim
   spec compliance. The W99010 lint emission is acceptable for this
   package and may be silenced via `#[allow(lint(public_entry))]` at the
   function level if the sui-pilot quality pass treats it as a finding
   rather than a warning. (`public fun` is also callable from `sui client
   call` and from PTBs — but using it would not be the form the spec
   names.)

2. **`side: u8` semantics.** Spec AC3.1 lists `side` as a stored "side
   indicator". Spec AC3.2 routes it into the creation event. AC3.4
   describes the trigger as always swapping base-for-quote on the
   no-manager path with no branching on `side`. This contract reads the
   spec literally: `side` is **stored-and-emitted opaque metadata only**
   — it is written by `create_vault`, included in `VaultCreated`, and is
   informational. Downstream consumers (the keeper in Cycle 3b, the UI
   in Cycle 3c) may render it however they choose; the Move package does
   not branch trigger behavior on it, does not validate its domain, and
   does not assign semantic meaning to specific `u8` values. The
   `execute_trigger` function always calls `swap_exact_base_for_quote`,
   regardless of `side`. A side-aware vault that swaps in either
   direction would require the `swap_exact_quote_for_base` path too,
   which is out of scope per spec AC3.4 ("calls DeepBook's
   swap_exact_base_for_quote" — singular and directional). Choosing a
   semantic encoding for `side` is left to the keeper / UI in subsequent
   cycles, not to this Move package.

3. **Output coin handling on trigger.** Spec AC3.4 says the trigger
   "routes the output coin to the vault owner" — singular ("the output
   coin"). The DeepBook no-manager swap returns three coins:
   `(Coin<Base> base_residual, Coin<Quote> quote_out, Coin<DEEP>
   deep_residual)`. This contract interprets "the output coin" as the
   primary obligation (the `Coin<Quote>`) and routes the two residuals
   (`Coin<Base>` and `Coin<DEEP>`) **also to `vault.owner`** rather
   than to the `execute_trigger` caller. Rationale: the trigger is
   permissionless, and routing residuals to the (potentially adversarial)
   caller would let the caller skim base-residual and DEEP-residual
   value as a side effect of helping the owner. Routing all three to the
   owner is the conservative interpretation that satisfies the spec's
   "output coin to owner" obligation while not creating a side-channel.
   Cycle 2's `slippage_swap` module sets the precedent for transferring
   all three returned coins to a single party. If the user prefers a
   "residuals back to caller" interpretation, the implementer flips the
   two residual `transfer::public_transfer` calls without changing any
   other behavior.

## In scope

- A single Move 2024 package rooted at `independent/03-tpsl-vault/move/`
  with `Move.toml`, `sources/`, and `tests/` directories.
- One module (name at the implementer's discretion; recommended
  `tpsl_vault::tpsl_vault`) declaring:
  - `public struct Vault<phantom T> has key { … }` as a shared object
    holding at minimum: `id: UID`, `owner: address`,
    `balance: Balance<T>`, `tp_price: Option<u64>`, `sl_price: Option<u64>`,
    `pool_id: ID`, `side: u8`, `triggered: bool`. The implementer may add
    additional fields (e.g., a creation timestamp or a snapshotted output
    amount post-trigger) provided the listed fields and lifecycle
    semantics are preserved.
  - `public entry fun create_vault<T>(coin: Coin<T>, pool_id: ID, side:
    u8, tp_price: Option<u64>, sl_price: Option<u64>, ctx: &mut
    TxContext)`. Constructs and shares the vault; emits `VaultCreated`.
    Per "Contract decisions" #1, `public entry fun` is used to satisfy
    the spec word "entry function" verbatim. The constructor MAY (but
    is not required to) abort with `EInvalidTriggerConfig` if both
    `tp_price` and `sl_price` are `None` — see "Optional
    defense-in-depth" below.
  - `public entry fun withdraw<T>(vault: &mut Vault<T>, ctx: &mut
    TxContext): Coin<T>`. Owner-only (`assert!(ctx.sender() ==
    vault.owner, ENotOwner)`); aborts with `EVaultTriggered` if
    `vault.triggered` is already `true`; otherwise withdraws the full
    custodied balance into a `Coin<T>` returned to the caller. The
    implementation may either return the coin from the function or
    transfer it directly to the sender — pick whichever is consistent
    with the rest of the package's style; both are valid for AC3.3.
    (Note: a `public entry fun` returning `Coin<T>` is supported in
    Move 2024 because `Coin<T>` is droppable-via-transfer; the
    return-void variant that `transfer::public_transfer`s the coin is
    equivalently valid.)
  - `public entry fun execute_trigger<Base, Quote>(vault: &mut
    Vault<Base>, pool: &mut Pool<Base, Quote>, current_price: u64,
    deep_in: Coin<DEEP>, clock: &Clock, ctx: &mut TxContext)`.
    Permissionless but condition-gated as described in Behavior. Aborts
    with `EVaultTriggered` if the vault has already fired; aborts with
    `ETriggerConditionNotMet` otherwise. On success: withdraws the
    custodied balance into a `Coin<Base>`, calls
    `deepbook::pool::swap_exact_base_for_quote(pool, base_coin, deep_in,
    0, clock, ctx)` (no-manager path; `min_quote_out = 0`), transfers
    all three returned coins to `vault.owner` via
    `transfer::public_transfer` per "Contract decisions" #3, sets
    `vault.triggered = true`, and emits `TriggerFired`.
- Two events with the exact field shapes below (downstream consumers in
  Cycles 3b/3c index off these fields):
  - `public struct VaultCreated has copy, drop, store { vault_id: ID,
    owner: address, pool_id: ID, side: u8, tp_price: Option<u64>,
    sl_price: Option<u64>, deposit_amount: u64 }`.
  - `public struct TriggerFired has copy, drop, store { vault_id: ID,
    owner: address, current_price: u64, quote_out_amount: u64,
    base_residual_amount: u64, deep_residual_amount: u64 }`.
  - The implementer may add fields if they aid downstream consumers,
    but the listed fields must be present in this exact form. The
    `vault_id` field of both events is the value returned by
    `object::id(&vault)`.
- A named-error block declared at module scope, with non-zero abort codes
  (carry-forward from Cycle 2 R3-002: `EInsufficientOutput = 0` collided
  with seven DeepBook error codes also valued 0; non-zero values keep CLI
  abort-code consumers — including E-007 — unambiguous):
  - `const ENotOwner: u64 = 1001;` — withdraw caller is not vault owner.
  - `const EVaultTriggered: u64 = 1002;` — operation attempted on a vault
    whose `triggered` flag is already `true` (used by both `withdraw` and
    `execute_trigger`).
  - `const ETriggerConditionNotMet: u64 = 1003;` — `execute_trigger`
    invoked while `current_price` does not satisfy either TP or SL.
  - **Optional defense-in-depth (not required for AC compliance):**
    `const EInvalidTriggerConfig: u64 = 1004;` — `create_vault` called
    with both `tp_price` and `sl_price` as `None`. Spec AC3.2 does not
    require this guard; it is recommended because a vault with no
    triggers can never fire and is only drainable via `withdraw`, which
    arguably defeats the slot's intent. The implementer MAY include or
    omit this constant and the corresponding `assert!` without breaking
    AC3.2.
  - The implementer may add additional named codes, provided they remain
    non-zero and avoid DeepBook's documented 0-30 range.
- A `Move.toml` whose `[package]` block sets `edition = "2024"` and whose
  `[dependencies]` table declares the same four external packages, in the
  same order, as Cycle 2's `independent/02-slippage-swap/Move.toml`:
  `token`, `deepbook`, `pyth`, `usdc`. Dependency `local` paths are
  absolute and resolve to
  `~/workspace/deepbook-sandbox/sandbox/.external-packages/` for
  `token`/`deepbook` and `~/workspace/deepbook-sandbox/sandbox/packages/`
  for `pyth`/`usdc`. `deepbook_margin` is omitted with the same comment
  Cycle 2 used (carry-forward of R2-002: the bundled
  `deepbook_margin/tests/helper/test_helpers.move` references
  `pyth::price_info::new_price_info_object_for_test` which does not exist
  in the bundled `pyth` package, so any package depending on
  `deepbook_margin` fails to build). The `[environments]` block carries
  the localnet chain ID consistent with Cycle 2's Move.toml; the
  implementer should regenerate it against the running sandbox if
  Cycle 2's value is stale (Cycle 2 R1-001 carry-forward: this is why
  `sui move test -e localnet` is required rather than bare `sui move
  test`).
- At least five Move 2024 unit tests under `tests/`, using the
  `test_scenario` pattern and reusing
  `deepbook::pool_tests::setup_everything<SUI, USDC, SUI, DEEP>` for
  liquidity setup (proven by Cycle 2; the fixture opens 1000 base units
  of liquidity at bid=1.0 and ask=2.0 in float-scaling, which is a
  convenient anchor for choosing TP/SL test prices). The five required
  tests, mapped to AC3.5:
  - **TP fires** — vault with `tp_price = Some(1 * float_scaling())` and
    `current_price = 1 * float_scaling()` (or higher); calling
    `execute_trigger` succeeds, the vault's `triggered` flag flips to
    `true`, the owner address receives a `Coin<USDC>` of value `> 0`,
    and a `TriggerFired` event is emitted.
  - **SL fires** — vault with `sl_price = Some(2 * float_scaling())` and
    `current_price = 1 * float_scaling()` (i.e., price has fallen to or
    below the SL threshold); calling `execute_trigger` succeeds and
    behaves as the TP case above.
  - **Neither fires (abort)** — vault with `tp_price = Some(10 *
    float_scaling())` and `sl_price = Some(0)` (TP unreachable upward,
    SL unreachable downward); calling `execute_trigger` with
    `current_price = 1 * float_scaling()` aborts with
    `ETriggerConditionNotMet`. Annotated
    `#[expected_failure(abort_code = ::tpsl_vault::tpsl_vault::ETriggerConditionNotMet)]`.
  - **Withdraw before fire (success)** — vault is freshly created and
    the owner calls `withdraw`; the returned `Coin<T>` has value equal
    to the originally deposited amount (no slippage on withdraw — it's
    a balance drain, not a swap).
  - **Withdraw after fire (abort)** — vault is fired via
    `execute_trigger` (TP path) and the owner then calls `withdraw`;
    the call aborts with `EVaultTriggered`. Annotated
    `#[expected_failure(abort_code = ::tpsl_vault::tpsl_vault::EVaultTriggered)]`.
  - **Recommended additional test (non-blocking, implementer's
    discretion)**: non-owner withdraw on an untriggered vault aborts
    with `ENotOwner` — would lift E-007's "non-owner withdraw rejected
    with documented owner-only error code" Move-side assertion into the
    in-cycle test suite. AC3.5 only requires the five listed; this is a
    bonus that makes E-007's stub→real promotion in Cycle 3b cleaner.
  - All tests use the `expected_failure(abort_code = ::module::CONST)`
    fully-qualified form (Cycle 2 R3-002 lesson) so that abort-code
    matches are unambiguous regardless of what other constants in scope
    happen to share a numeric value.
  - All tests must avoid the Cycle-2 T-003 fixture pitfall: do NOT use
    two `test_scenario::begin`/`end` pairs inside a single `#[test]`
    function. The DeepBook `registry::test_registry` fixture cannot be
    re-initialised inside one test (it triggers
    `EFieldAlreadyExists`); each test owns exactly one
    `test_scenario` lifetime.
- A `tests/` module name following the Move 2024 single-block module
  declaration form (`module tpsl_vault::tpsl_vault_tests;`), annotated
  `#[test_only]` per Move 2024 idiom.
- Friction observations appended to `independent/raw-friction.log`
  during this cycle. AC3.18 (the cross-Slot-3 friction-log coverage
  criterion) is formally validated at the end of Cycle 3c, but Cycle 3a
  is the first sub-cycle of Slot 3 and should append at least one
  observation for every source category it actually exercises during
  this cycle's work. Realistic categories for this cycle are
  `[deepbook]` (no-manager swap path ergonomics, fixture reuse),
  `[move]` (Move 2024 idiom, `Option<u64>` ergonomics, test-scenario
  caveats), `[sandbox]` (any sandbox-side issue surfaced while
  iterating), and `[sui-pilot]` (any tooling friction encountered via
  the sui-pilot agent). Categories the keeper / UI cycles will own
  (`[sui-sdk]`, `[dapp-kit]`) are not expected to surface here.

## Out of scope

- The off-chain TypeScript keeper service that polls Pyth
  `PriceInfoObject`s, evaluates trigger conditions, and submits
  `execute_trigger` transactions (Cycle 3b — spec ACs 3.7 to 3.11 in the
  Slot-3 keeper acceptance block).
- The wallet-connected React + Vite UI for vault list, create form, and
  withdraw control (Cycle 3c — spec ACs 3.13 to 3.17 in the Slot-3 UI
  acceptance block).
- The end-to-end demo path validation that requires both keeper and UI
  (spec AC3.12; formally claimed by Cycle 3c per cycle-plan).
- The cross-Slot-3 friction-log coverage assertion across all source
  categories seen during Slot 3 work (spec AC3.18; validated at end of
  Cycle 3c per cycle-plan).
- Any source under `independent/01-market-stats/` or
  `independent/02-slippage-swap/` (out-of-scope per files-in-scope
  glob; the proven `slippage_swap.move` pattern may be referenced as
  prior work but not imported as a Move dependency).
- Any source under `01-orderbook-viewer/`, `02-fee-rebate-swap/`,
  `03-dca-vault/`, `FEEDBACK.md`, or `RUNBOOK.md` at the repo root
  (forbidden-read boundary inherited from spec.md "Cross-Cutting
  Invariants > Forbidden-read boundary" — the prior solution's
  Slot-3 equivalent at `03-dca-vault/` must NOT be opened).
- Manager-based DeepBook swap paths
  (`swap_exact_base_for_quote_with_manager`); the no-manager path is
  load-bearing per Decision Gate G-Vault.
- The opposite-direction no-manager swap (`swap_exact_quote_for_base`).
  Spec AC3.4 names `swap_exact_base_for_quote` specifically; supporting
  both directions would require the vault to read its own coin types as
  base-vs-quote at runtime, which is out of scope for this slot. See
  "Contract decisions" #2 for how `side` interacts with this restriction.
- Any wrapper variant that retains custody of swap proceeds in the
  module (the entire return tuple is forwarded to `vault.owner`; the
  `execute_trigger` caller receives nothing as a side effect, per
  "Contract decisions" #3).
- Reading Pyth prices on-chain inside `execute_trigger`. The
  `current_price: u64` parameter is supplied by the off-chain keeper
  (which, in Cycle 3b, will read it from a Pyth `PriceInfoObject`).
  The Move package itself does not link against `pyth::price_info` at
  the call site; it merely declares `pyth` as a Move dependency for
  consistency with the `example_contract` template.
- A separate slippage floor on the `execute_trigger` swap call.
  `min_quote_out = 0` is passed to DeepBook because the keeper-supplied
  `current_price` gate is the trigger-side correctness gate; introducing
  a second floor here would require the keeper to compute a min-out
  estimate from current depth, which is out of scope for the Move
  package and can be revisited in Cycle 3b if keeper experience demands
  it.
- `RUNBOOK.md` and `FEEDBACK.md` documentation (Cycle 4 deliverable).
- Modifying spec.md, cycle-plan.md, agent-config.md, or any prior
  cycle's contract / review.

## Files

- `independent/03-tpsl-vault/move/Move.toml`
- `independent/03-tpsl-vault/move/sources/**/*.move`
- `independent/03-tpsl-vault/move/tests/**/*.move`
- `independent/raw-friction.log` (append-only)

## Acceptance criteria

- AC3.1: `Vault<T>` is a shared object whose state includes a `UID`,
  the owner address, the custodied `Balance<T>`, an optional
  take-profit price, an optional stop-loss price, the target pool's
  identifier, a side indicator, and a triggered lifecycle flag.
  - Verification: `Vault<T>` is declared `public struct Vault<phantom T>
    has key { … }` with at minimum the fields `id: UID`,
    `owner: address`, `balance: Balance<T>`, `tp_price: Option<u64>`,
    `sl_price: Option<u64>`, `pool_id: ID`, `side: u8`,
    `triggered: bool`. The struct is shared via
    `transfer::share_object(vault)` inside `create_vault`. The
    implementer may add additional fields without breaking this AC.
- AC3.2: A vault creation entry function accepts an input coin, target
  pool, side, and optional TP/SL prices, constructs a shared vault,
  and emits a creation event carrying the vault's identifier and key
  fields.
  - Verification: a `public entry fun create_vault<T>(coin: Coin<T>,
    pool_id: ID, side: u8, tp_price: Option<u64>, sl_price: Option<u64>,
    ctx: &mut TxContext)` exists; converts the input coin into a
    `Balance<T>` via `coin::into_balance`; constructs and shares a
    `Vault<T>` via `transfer::share_object`; emits a `VaultCreated`
    event via `event::emit` with the exact field shape declared in the
    "In scope" event spec above (`vault_id`, `owner`, `pool_id`, `side`,
    `tp_price`, `sl_price`, `deposit_amount`). The "entry" wording in
    the spec is satisfied verbatim by the `public entry fun` keyword
    form per "Contract decisions" #1.
- AC3.3: A withdraw entry function is owner-only, refuses to operate on
  a triggered vault, and returns the entire custodied balance to the
  sender as a coin.
  - Verification: a `public entry fun withdraw<T>(vault: &mut Vault<T>,
    ctx: &mut TxContext): Coin<T>` (or a return-void variant that
    `transfer::public_transfer`s the coin to the sender) exists;
    asserts `ctx.sender() == vault.owner` with `ENotOwner`; asserts
    `!vault.triggered` with `EVaultTriggered`; withdraws the entire
    `Balance<T>` via `balance::withdraw_all` (or the equivalent
    Move-2024 dot-syntax form) and converts it to a `Coin<T>` via
    `coin::from_balance`; the returned (or transferred) coin's value
    equals the originally-deposited amount minus zero (no fees on
    withdraw).
- AC3.4: The trigger entry function is permissionless but
  condition-gated: it aborts unless the supplied current price satisfies
  the vault's TP or SL condition. On success it drains the vault, calls
  DeepBook's `swap_exact_base_for_quote` (no-manager path), routes the
  output coin to the vault owner, marks the vault triggered, and emits
  a trigger event.
  - Verification: a `public entry fun execute_trigger<Base,
    Quote>(vault: &mut Vault<Base>, pool: &mut Pool<Base, Quote>,
    current_price: u64, deep_in: Coin<DEEP>, clock: &Clock, ctx: &mut
    TxContext)` exists; is NOT gated on `ctx.sender() == vault.owner`
    (anyone may call); aborts with `EVaultTriggered` if
    `vault.triggered` is already `true`; aborts with
    `ETriggerConditionNotMet` if neither
    `(vault.tp_price.is_some() && current_price >= *vault.tp_price.borrow())`
    nor
    `(vault.sl_price.is_some() && current_price <= *vault.sl_price.borrow())`
    holds. On the success path: withdraws the full `Balance<Base>` from
    the vault into a `Coin<Base>`; calls
    `deepbook::pool::swap_exact_base_for_quote(pool, base_coin, deep_in,
    0, clock, ctx)` (no-manager path; `min_quote_out = 0`);
    destructures the `(Coin<Base>, Coin<Quote>, Coin<DEEP>)` return
    tuple; transfers the `Coin<Quote>` (the spec's "output coin") to
    `vault.owner` via `transfer::public_transfer`; transfers the
    `Coin<Base>` residual and the `Coin<DEEP>` residual ALSO to
    `vault.owner` per "Contract decisions" #3; sets `vault.triggered =
    true`; emits a `TriggerFired` event via `event::emit` with the
    exact field shape declared in the "In scope" event spec above
    (`vault_id`, `owner`, `current_price`, `quote_out_amount`,
    `base_residual_amount`, `deep_residual_amount`). Decision Gate
    G-Vault: the `swap_exact_base_for_quote_with_manager` variant must
    NOT appear anywhere in the source.
- AC3.5: At least four unit tests cover: TP fires, SL fires, neither
  condition fires (abort), withdraw before fire (success), withdraw
  after fire (abort).
  - Verification: `tests/` contains at least five `#[test]` functions
    matching the five state-transition cases enumerated in In Scope
    above; the two abort cases are annotated
    `#[expected_failure(abort_code = ::tpsl_vault::tpsl_vault::<CODE>)]`
    with the corresponding non-zero error constant; tests reuse
    `deepbook::pool_tests::setup_everything<SUI, USDC, SUI, DEEP>` for
    fixture setup; `sui move test` (with whatever environment flag
    Cycle-2 R1-001 carry-forward determines is required against the
    running sandbox; expected to be `-e localnet`) exits zero (all
    tests pass / fail-as-expected).
- AC3.6: `sui move build && sui move test` both pass; a Move 2024
  quality pass reports no issues.
  - Verification: `sui move build` from
    `independent/03-tpsl-vault/move/` exits zero with no errors against
    the running sandbox; `sui move test` from the same directory exits
    zero with all tests pass / expected-fail; invoking the sui-pilot
    `move-code-quality` workflow against the package reports no
    findings on the final pass. NOTE: Cycle 2 R1-001 carry-forward —
    the bundled DeepBook external package's `Move.lock` pins a
    `localnet` chain ID; if the running sandbox's actual chain ID
    differs, the unflagged `sui move build` / `sui move test` commands
    fail and the `-e localnet` flag is required to disambiguate. This
    is a sandbox-side artifact rather than a deviation from the spec's
    "build and test pass" obligation; the AC is satisfied by either
    the bare commands or the `-e localnet` variants exiting zero
    against the live sandbox. NOTE 2: lint W99010 (`public entry`
    deprecation, observed against the Slot-2 wrapper in Cycle 2 R4)
    may emit informational warnings against this package's three
    `public entry fun` declarations because spec AC3.2/3.3/3.4 use the
    word "entry function" verbatim and "Contract decisions" #1 honors
    that wording. If the sui-pilot quality pass treats W99010 as a
    blocking finding rather than an informational lint, suppress with
    `#[allow(lint(public_entry))]` at each entry function. The AC is
    satisfied by a clean final-pass quality report; how W99010 is
    handled (suppress vs. fix-by-removing-`entry`) is implementer's
    discretion only if the quality tool would otherwise block.

## E2E coverage

Cycle 3a brings exactly one E2E scenario forward (stub → enables the
keeper-side "real" promotion in Cycle 3b) and leaves three at stub:

- **E-007** (`slot 3 withdraw is rejected on triggered vaults and
  rejected for non-owner callers`, kind `cli`,
  `covers_contract: [AC3.3]`) — status: **stub**. The Move-side abort
  paths E-007 asserts on (`ENotOwner` for the non-owner withdraw,
  `EVaultTriggered` for the triggered-vault withdraw) are implemented
  in this cycle and exercised by the AC3.5 unit tests
  (the "withdraw after fire (abort)" required test plus the recommended
  non-owner-withdraw bonus test). Both named error constants are
  declared at module scope as documented owner-only / triggered-vault
  abort codes that E-007's `sui client call` capture can pin.
  Promoted to **real** in Cycle 3b once the keeper can fire the trigger
  end-to-end via CLI tooling (per cycle-plan Cycle 3b).
- **E-003** (`slot 3 end-to-end take-profit fire from ui through keeper
  through ui again`, kind `ui`) — status: **stub**. Move-side creation
  and trigger entries exist and emit `VaultCreated` / `TriggerFired`
  events as required by E-003's side-channel event assertions, but no
  UI / keeper to drive them end-to-end. Promoted to **real** in Cycle
  3c.
- **E-004** (`slot 3 owner-only withdraw before trigger returns full
  balance and removes vault`, kind `ui`) — status: **stub**. Withdraw
  entry exists and the AC3.5 "withdraw before fire (success)" unit test
  passes, but no UI to drive it. Promoted to **real** in Cycle 3c.
- **E-006** (`slot 3 vault list excludes vaults owned by other
  accounts`, kind `ui`) — status: **stub**. Vault carries an `owner:
  address` field that the UI's owner-filter will key off, but no UI
  vault list yet. Promoted to **real** in Cycle 3c.

## Decision Gates

- **G-Vault** (in-cycle, contract-and-implementation phase, per spec
  Decision Gates and cycle-plan Cycle 3a). The vault uses DeepBook's
  no-manager `swap_exact_base_for_quote` on trigger fire. Only escalate
  via `AskUserQuestion` if mid-build evidence shows the no-manager path
  is insufficient — concrete escalation triggers:
  - The no-manager path's three-coin return tuple cannot be destructured
    cleanly inside `execute_trigger` (e.g., a Move type-checker error
    that no documented workaround resolves).
  - Gas exhaustion on the trigger transaction at the sandbox's
    configured budget (a fixture-reachable amount; not a localnet-budget
    misconfiguration).
  - The DEEP fee accounting becomes ambiguous (e.g., the wrapper cannot
    reliably forward the residual to `vault.owner` because the return
    type does not carry it).
  Do NOT silently switch to the manager-based path. If the gate trips,
  pause and describe the failure mode in the escalation; the user (or
  spec author) decides the resolution path. None of Cycle 2's review
  findings indicate this path is at risk — Cycle 2's `slippage_swap`
  module proves the no-manager path destructures cleanly into
  `(Coin<BaseAsset>, Coin<QuoteAsset>, Coin<DEEP>)` and forwards all
  three coins via `transfer::public_transfer` without issue.

## Stated orchestration dependencies

- Cycle 1 complete with the sandbox up (G-Boot still passing). This
  cycle does not import Slot 1 source.
- Cycle 2 complete (proves the no-manager swap pattern, the
  `example_contract` Move.toml mirror, and the
  `deepbook::pool_tests::setup_everything` fixture pattern this cycle's
  unit tests reuse). The carry-forward Move.toml deviation
  (`deepbook_margin` excluded due to the bundled
  `deepbook_margin/tests/helper/test_helpers.move` referencing a
  non-existent `pyth::price_info::new_price_info_object_for_test`
  symbol) applies to this cycle for the same reason and via the same
  fix.
- The sandbox's bundled DeepBook external package present under
  `~/workspace/deepbook-sandbox/sandbox/.external-packages/deepbook/`
  (used both as the source of the `swap_exact_base_for_quote` symbol
  for `execute_trigger` and as the source of the
  `pool_tests::setup_everything` test fixture).
- No new decision gates introduced beyond G-Vault (in-cycle) and
  G-Boot inherited from Cycle 1. G-Pyth is Cycle 3b's gate (keeper
  reads on-chain `PriceInfoObject`); this cycle does not touch Pyth.
