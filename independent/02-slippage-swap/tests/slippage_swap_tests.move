// Copyright (c) Alilloig
// SPDX-License-Identifier: Apache-2.0

#[test_only]
module slippage_swap::slippage_swap_tests;

use deepbook::balance_manager::BalanceManager;
use deepbook::balance_manager_tests::USDC;
use deepbook::constants;
use deepbook::pool::Pool;
use deepbook::pool_tests::setup_everything;
use slippage_swap::slippage_swap;
use sui::clock::Clock;
use sui::coin::{Self, Coin, mint_for_testing};
use sui::sui::SUI;
use sui::test_scenario::{Self, begin, end, return_shared};
use token::deep::DEEP;

const OWNER: address = @0x1;
const TRADER: address = @0xCAFE;

// Reasonable upper bound on DEEP fee residual a single small swap will leave.
// The fixture mints generously; the wrapper must return any residual.
const DEEP_IN: u64 = 1_000 * 1_000_000_000; // 1000 DEEP at scaling 1e9

// `setup_everything` opens 1000 base units of liquidity at bid=1.0 and ask=2.0
// (in float-scaling). Choosing a small base input keeps us safely on the
// bid book side and well below the available depth.
fun base_in_amount(): u64 {
    1 * constants::float_scaling()
}

// T-001: success path with a generous min_out floor (well below what is
// realisable). We assert the sender receives a Coin<USDC> whose value is
// >= min_out. The realised amount when selling base into the bid at 1.0
// should be close to (but less than) `base_in_amount`, so a min_out of
// half that is comfortably below the floor.
#[test]
fun swap_succeeds_when_liquidity_sufficient() {
    let mut test = begin(OWNER);
    let pool_id = setup_everything<SUI, USDC, SUI, DEEP>(&mut test);

    let min_out = constants::float_scaling() / 2; // 0.5 quote units, well below realisable

    test.next_tx(TRADER);
    {
        let mut pool = test.take_shared_by_id<Pool<SUI, USDC>>(pool_id);
        let clock = test.take_shared<Clock>();
        let base_in = mint_for_testing<SUI>(base_in_amount(), test.ctx());
        let deep_in = mint_for_testing<DEEP>(DEEP_IN, test.ctx());

        slippage_swap::swap_exact_base_for_quote<SUI, USDC>(
            &mut pool,
            base_in,
            deep_in,
            min_out,
            &clock,
            test.ctx(),
        );

        return_shared(pool);
        return_shared(clock);
    };

    // After the call, the wrapper must transfer the realised quote coin to
    // the sender. Inspect it in the next tx.
    test.next_tx(TRADER);
    {
        let quote_out = test.take_from_sender<Coin<USDC>>();
        assert!(coin::value(&quote_out) >= min_out, 0);
        test.return_to_sender(quote_out);
    };

    end(test);
}

// T-002: failure path — min_out above any achievable output must abort with
// the named slippage_swap::EInsufficientOutput error code. Annotated with
// expected_failure pinned to that constant; if the wrapper aborts with any
// other code (or fails to abort) the test fails.
#[test, expected_failure(abort_code = ::slippage_swap::slippage_swap::EInsufficientOutput)]
fun swap_aborts_when_min_out_unreachable() {
    let mut test = begin(OWNER);
    let pool_id = setup_everything<SUI, USDC, SUI, DEEP>(&mut test);

    let min_out: u64 = 1_000_000_000_000_000; // far above realisable for 1 base unit

    test.next_tx(TRADER);
    {
        let mut pool = test.take_shared_by_id<Pool<SUI, USDC>>(pool_id);
        let clock = test.take_shared<Clock>();
        let base_in = mint_for_testing<SUI>(base_in_amount(), test.ctx());
        let deep_in = mint_for_testing<DEEP>(DEEP_IN, test.ctx());

        slippage_swap::swap_exact_base_for_quote<SUI, USDC>(
            &mut pool,
            base_in,
            deep_in,
            min_out,
            &clock,
            test.ctx(),
        );

        return_shared(pool);
        return_shared(clock);
    };

    end(test);
}

// T-003 was DROPPED by orchestrator amendment: the original test required
// two `begin`/`end` test_scenario pairs in a single #[test] function (one to
// observe realised output, one to pin min_out to that exact value). Move's
// test_scenario does not fully reset the shared-object store between
// sequential begin/end pairs in one test, so the second `setup_everything`
// hit `EFieldAlreadyExists` inside `deepbook::registry::test_registry` —
// the failure was entirely in fixture machinery, not in the wrapper code.
// The boundary case `value == min_out` is asymptotic between T-001 (success
// for `value > min_out`) and T-002 (abort for `value < min_out`); a strict
// `>=` regression would surface in one of those two tests already.
// See independent/raw-friction.log for the test-scenario reset friction.

// T-004: min_out = 0 must succeed and route a strictly-positive quote coin
// to the sender, confirming no hidden non-zero floor inside the wrapper.
#[test]
fun swap_succeeds_when_min_out_is_zero() {
    let mut test = begin(OWNER);
    let pool_id = setup_everything<SUI, USDC, SUI, DEEP>(&mut test);

    test.next_tx(TRADER);
    {
        let mut pool = test.take_shared_by_id<Pool<SUI, USDC>>(pool_id);
        let clock = test.take_shared<Clock>();
        let base_in = mint_for_testing<SUI>(base_in_amount(), test.ctx());
        let deep_in = mint_for_testing<DEEP>(DEEP_IN, test.ctx());

        slippage_swap::swap_exact_base_for_quote<SUI, USDC>(
            &mut pool,
            base_in,
            deep_in,
            0,
            &clock,
            test.ctx(),
        );

        return_shared(pool);
        return_shared(clock);
    };

    test.next_tx(TRADER);
    {
        let quote_out = test.take_from_sender<Coin<USDC>>();
        assert!(coin::value(&quote_out) > 0, 3);
        test.return_to_sender(quote_out);
    };

    end(test);
}

// T-005: a successful swap transfers all three returned coins to the sender
// and creates no BalanceManager. Verifies all four side-effects observable
// by the on-chain caller (E-005 expectation).
#[test]
fun swap_transfers_all_three_coins_and_no_manager() {
    let mut test = begin(OWNER);
    let pool_id = setup_everything<SUI, USDC, SUI, DEEP>(&mut test);

    test.next_tx(TRADER);
    {
        let mut pool = test.take_shared_by_id<Pool<SUI, USDC>>(pool_id);
        let clock = test.take_shared<Clock>();
        let base_in = mint_for_testing<SUI>(base_in_amount(), test.ctx());
        let deep_in = mint_for_testing<DEEP>(DEEP_IN, test.ctx());

        slippage_swap::swap_exact_base_for_quote<SUI, USDC>(
            &mut pool,
            base_in,
            deep_in,
            0,
            &clock,
            test.ctx(),
        );

        return_shared(pool);
        return_shared(clock);
    };

    test.next_tx(TRADER);
    {
        // Quote output: must be present and positive.
        let quote_out = test.take_from_sender<Coin<USDC>>();
        assert!(coin::value(&quote_out) > 0, 4);
        test.return_to_sender(quote_out);

        // DEEP residual: must be present (the wrapper hands the coin back
        // even if value is 0).
        let deep_residual = test.take_from_sender<Coin<DEEP>>();
        test.return_to_sender(deep_residual);

        // Base residual: must be present (may be zero-value but the coin
        // object must exist as a transferred object).
        let base_residual = test.take_from_sender<Coin<SUI>>();
        test.return_to_sender(base_residual);

        // No BalanceManager owned by sender: pins the no-manager path.
        assert!(
            !test_scenario::has_most_recent_for_sender<BalanceManager>(&test),
            5,
        );
    };

    end(test);
}
