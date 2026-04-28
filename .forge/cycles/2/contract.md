# Cycle 2 Contract — Slot 2 Slippage-Safe Swap (Move wrapper)

## Behavior

Caller invokes the cycle's public entry function via `sui client call`,
supplying a `Coin<BaseAsset>` of size > 0, a `Coin<DEEP>` covering the swap
fee, a `min_out: u64` floor on the realised quote-side output, the target
DeepBook `Pool<BaseAsset, QuoteAsset>` shared object (lookup-able from the
sandbox manifest), and the system `&Clock`. The wrapper internally calls
DeepBook's no-manager `swap_exact_base_for_quote`, destructures the
`(Coin<BaseAsset>, Coin<QuoteAsset>, Coin<DEEP>)` return tuple, asserts
`coin::value(&quote_out) >= min_out` with the named error constant
`EInsufficientOutput`, and on success transfers all three coins (base
residual, quote output, DEEP residual) back to `tx_context::sender(ctx)`.
On floor breach the transaction aborts with the documented error code so
both unit-test `#[expected_failure]` assertions and E-002's CLI abort-code
assertion can pin a single stable value. No state is created, no objects
are minted by the wrapper itself, and no `BalanceManager` is constructed
or referenced.

## Goal

Deliver a Move 2024 package under `independent/02-slippage-swap/` that exposes
a single public entry function wrapping DeepBook's no-manager
`deepbook::pool::swap_exact_base_for_quote` with a caller-supplied `min_out`
floor. The wrapper destructures DeepBook's `(Coin<BaseAsset>, Coin<QuoteAsset>,
Coin<DEEP>)` return tuple, asserts the realised quote output meets `min_out`
via a documented named error constant, and on success transfers all three
coins (base residual, quote output, DEEP residual) back to
`tx_context::sender(ctx)`. Tests under `tests/` exercise both the success
path and the slippage-floor failure path using the Move 2024 test-scenario
pattern. The package's `Move.toml` mirrors the sandbox's `example_contract`
template byte-for-byte in dependency order, edition, and source layout.

## In scope

- A single Move 2024 package rooted at `independent/02-slippage-swap/` with
  `Move.toml`, `sources/`, and `tests/` directories.
- Exactly one public entry function, parameterised over base and quote coin
  types `<BaseAsset, QuoteAsset>`, that performs a slippage-safe base-to-quote
  swap by calling `deepbook::pool::swap_exact_base_for_quote` (no-manager
  path) and asserts the returned `Coin<QuoteAsset>` has value `>= min_out`.
- A named error constant `EInsufficientOutput: u64 = 0;` raised when the
  slippage floor is not met, used by both the wrapper's `assert!` and the
  Move unit-test `#[expected_failure(abort_code = ...)]` annotation, and
  asserted by E-002's CLI abort-code capture.
- On success, transfer of all three returned coins (base residual, quote
  output, DEEP residual) back to `tx_context::sender(ctx)` so no balance
  manager object is created or left as a side effect (E-005 expectation).
- Two unit tests under `tests/` using the Move 2024 test-scenario pattern:
  one success-path test asserting the floor is met and coins are routed to
  the sender, and one failure-path test annotated with
  `#[expected_failure(abort_code = ::<module>::EInsufficientOutput)]`.
- A `Move.toml` whose `[package]` block sets `edition = "2024"` and whose
  `[dependencies]` table declares the same five external packages, in the
  same order, as the sandbox's `example_contract` template:
  `token`, `deepbook`, `deepbook_margin`, `pyth`, `usdc`. Dependency `local`
  paths are absolute and resolve to
  `~/workspace/deepbook-sandbox/sandbox/.external-packages/` for the first
  three and `~/workspace/deepbook-sandbox/sandbox/packages/` for the last
  two.
- At least one `[deepbook]` and one `[move]` observation appended to
  `independent/raw-friction.log` during this cycle (AC2.7).

## Out of scope

- Any source under `01-orderbook-viewer/`, `02-fee-rebate-swap/`,
  `03-dca-vault/` (forbidden-read boundary inherited from spec). The Slot 1
  source under `independent/01-market-stats/` is also out of scope; this
  cycle does not depend on Slot 1.
- The off-chain TypeScript keeper, UI, indexer queries, Pyth price feeds,
  and any vault/TPSL logic. Those belong to Cycles 3a / 3b / 3c.
- Manager-based DeepBook swap paths, balance manager creation, or any
  wrapper variant that retains custody of returned coins.
- Production deployment, mainnet/testnet publication, or any mutation of
  files under `~/workspace/deepbook-sandbox/sandbox/`.
- `RUNBOOK.md` and `FEEDBACK.md` (Cycle 4 deliverables).
- Modifying the global cycle-plan or spec.

## Files

- `independent/02-slippage-swap/Move.toml`
- `independent/02-slippage-swap/sources/**/*.move`
- `independent/02-slippage-swap/tests/**/*.move`
- `independent/raw-friction.log` (append-only)

## Acceptance criteria

- AC2.1: The package's Move dependency declaration is structurally
  identical to the sandbox's `example_contract` template (same external
  packages, same edition).
  - Verification: `Move.toml` declares `edition = "2024"` and lists the
    same five external packages in the same order as
    `~/workspace/deepbook-sandbox/sandbox/packages/example_contract/Move.toml`
    (`token`, `deepbook`, `deepbook_margin`, `pyth`, `usdc`), each with an
    absolute `local =` path resolving into the sandbox's
    `.external-packages/` (token, deepbook, deepbook_margin) or `packages/`
    (pyth, usdc) directory.
- AC2.2: The module exports a single public entry function for a
  base-to-quote slippage-safe swap, parameterized over base and quote
  coin types.
  - Verification: exactly one `public entry fun` in the module's source
    file, parameterised `<BaseAsset, QuoteAsset>`, taking the pool, an
    input `Coin<BaseAsset>`, a `Coin<DEEP>` fee coin, a `min_out: u64`,
    a `&Clock`, and `&mut TxContext`.
- AC2.3: The function calls DeepBook's `swap_exact_base_for_quote`
  (no-manager path), asserts the output coin's value meets `min_out`
  with a documented, named error code, and routes leftover input and
  the DEEP fee coin back to the sender.
  - Verification: source contains a call to
    `deepbook::pool::swap_exact_base_for_quote` (or its module-aliased
    equivalent), destructures the returned
    `(Coin<BaseAsset>, Coin<QuoteAsset>, Coin<DEEP>)`, performs
    `assert!(coin::value(&quote_out) >= min_out, EInsufficientOutput)`,
    and transfers all three coins to `tx_context::sender(ctx)` on the
    success path. The named error constant
    `const EInsufficientOutput: u64 = 0;` is declared at module scope
    with a doc comment naming it as the slippage-floor abort code.
- AC2.4: `sui move build` exits zero against the sandbox's bundled
  DeepBook package.
  - Verification: running `sui move build` from
    `independent/02-slippage-swap/` against the running sandbox returns
    exit code 0 with no errors.
- AC2.5: `sui move test` includes at least one success-path test
  (output meets floor) and one failure-path test (output below floor
  triggers the documented error code), implemented with the
  test-scenario pattern.
  - Verification: `tests/` contains at least one `#[test]` function that
    drives a successful swap end-to-end via `test_scenario` and asserts
    the sender received a `Coin<QuoteAsset>` of value `>= min_out`, plus
    at least one `#[test]` function annotated
    `#[expected_failure(abort_code = ::<module>::EInsufficientOutput)]`
    that drives a swap with `min_out` strictly above achievable output
    and observes the abort. `sui move test` exits zero (all tests pass /
    fail-as-expected).
- AC2.6: A Move 2024 quality pass (sui-pilot's `move-code-quality`)
  reports no issues.
  - Verification: invoking the sui-pilot `move-code-quality` workflow
    against `independent/02-slippage-swap/` reports no findings on the
    final pass.
- AC2.7: At least one `[deepbook]` and one `[move]` observation is
  appended to `independent/raw-friction.log` during the Slot-2 cycle.
  - Verification: `independent/raw-friction.log` gains at least one new
    line tagged `[deepbook]` and at least one new line tagged `[move]`
    over the lifetime of this cycle, each with a UTC ISO-8601 timestamp.

## E2E coverage

Both scenarios brought online at `status: real`:

- E-002 (`slot 2 swap aborts with documented error code when min_out
  exceeds achievable output`, kind `cli`). The Move unit test annotated
  with `#[expected_failure(abort_code = ::<module>::EInsufficientOutput)]`
  (per AC2.5) confirms the wrapper-side abort path exists, and the named
  constant `EInsufficientOutput` provides the documented abort code that
  E-002's `sui client call` capture asserts on. The published-package
  side of E-002 (publish + CLI invocation) is exercisable as soon as
  `sui move build` (AC2.4) succeeds and the package is published against
  the running sandbox; `covers_contract: [AC2.3]` per spec.
- E-005 (`slot 2 swap success path delivers output coin meeting min_out
  and returns DEEP fee residual to sender`, kind `cli`). The success-path
  unit test (per AC2.5) plus the wrapper's transfer-to-sender behaviour
  (per AC2.3) ensure the published function delivers a quote coin
  meeting `min_out`, returns the DEEP residual, returns any unconsumed
  base coin, and creates no balance manager object as a side effect;
  `covers_contract: [AC2.3]` per spec.

## Stated orchestration dependencies

- Cycle 1 complete with the sandbox up (G-Boot still passing). This
  cycle does not read or import Slot 1 source; the sandbox's running
  state is the only Cycle-1 artifact this contract relies on.
- The sandbox's bundled DeepBook external package present under
  `~/workspace/deepbook-sandbox/sandbox/.external-packages/deepbook/` and
  the `example_contract` template present under
  `~/workspace/deepbook-sandbox/sandbox/packages/example_contract/`,
  used as the structural reference for `Move.toml` (AC2.1) and the
  source of the `swap_exact_base_for_quote` symbol (AC2.3).
- No new decision gates introduced beyond G-Boot inherited from Cycle 1.
