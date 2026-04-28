// Copyright (c) Alilloig
// SPDX-License-Identifier: Apache-2.0

#[test_only]
module tpsl_vault::tpsl_vault_tests;

use deepbook::balance_manager_tests::USDC;
use deepbook::constants;
use deepbook::pool::Pool;
use deepbook::pool_tests::setup_everything;
use std::option;
use sui::clock::Clock;
use sui::coin::{Self, Coin, mint_for_testing};
use sui::event;
use sui::object;
use sui::sui::SUI;
use sui::test_scenario::{Self, begin, end, return_shared};
use token::deep::DEEP;
use tpsl_vault::tpsl_vault::{Self, Vault, VaultCreated, TriggerFired};

// === Test addresses ===

const OWNER: address = @0x1;
const KEEPER: address = @0xCAFE;
const STRANGER: address = @0xBEEF;

// === Test constants ===

// 1000 DEEP at scaling 1e9 — generous fee budget for a single small swap.
// The wrapper must return any DEEP residual; this just ensures the swap
// doesn't fail for lack of DEEP.
const DEEP_IN: u64 = 1_000 * 1_000_000_000;

// `setup_everything` opens 1000 base units of liquidity at bid=1.0 and
// ask=2.0 (in float-scaling). A 1-base-unit deposit keeps us well below
// the available depth on the bid book.
fun base_in_amount(): u64 {
    1 * constants::float_scaling()
}

// Side metadata is opaque to the Move package per Contract decisions #2;
// we just pin a stable u8 for the create_vault tests.
const SIDE_LONG: u8 = 0;

// =====================================================================
// T-001 — create_vault constructs a shared vault with the deposited
// balance and emits VaultCreated.
// =====================================================================
#[test]
fun create_vault_constructs_shared_vault_and_emits_event() {
    let mut test = begin(OWNER);
    // Use the fixture's pool_id as the supplied pool reference. This makes
    // the VaultCreated.pool_id field assertion exact.
    let pool_id = setup_everything<SUI, USDC, SUI, DEEP>(&mut test);

    // Locals captured in the create-tx block survive across `next_tx`.
    // The Move test_scenario CLEARS the event buffer on every `next_tx`, so
    // VaultCreated must be inspected in the same tx that emits it; we stash
    // the vault_id into a local so the next-tx vault-take can cross-check.
    let mut event_vault_id = object::id_from_address(@0x0);

    test.next_tx(OWNER);
    {
        let coin_in = mint_for_testing<SUI>(base_in_amount(), test.ctx());
        tpsl_vault::create_vault<SUI>(
            coin_in,
            pool_id,
            SIDE_LONG,
            option::some(2 * constants::float_scaling()),
            option::none<u64>(),
            test.ctx(),
        );

        // Inspect VaultCreated INSIDE the emitting tx (events buffer
        // resets on next_tx).
        let created_events = event::events_by_type<VaultCreated>();
        assert!(created_events.length() == 1, 102);
        let evt = &created_events[0];
        event_vault_id = tpsl_vault::vault_created_vault_id(evt);
        assert!(tpsl_vault::vault_created_owner(evt) == OWNER, 104);
        assert!(tpsl_vault::vault_created_pool_id(evt) == pool_id, 105);
        assert!(tpsl_vault::vault_created_side(evt) == SIDE_LONG, 106);
        assert!(
            tpsl_vault::vault_created_tp_price(evt)
                == option::some(2 * constants::float_scaling()),
            107,
        );
        assert!(
            tpsl_vault::vault_created_sl_price(evt) == option::none<u64>(),
            108,
        );
        assert!(
            tpsl_vault::vault_created_deposit_amount(evt) == base_in_amount(),
            109,
        );
    };

    test.next_tx(OWNER);
    {
        // Now the vault is takeable as a shared object; cross-check its
        // ID against the event-reported ID, and verify deposit + lifecycle.
        let vault = test.take_shared<Vault<SUI>>();
        let vault_id = object::id(&vault);
        assert!(vault_id == event_vault_id, 103);
        assert!(tpsl_vault::balance_value(&vault) == base_in_amount(), 100);
        assert!(!tpsl_vault::is_triggered(&vault), 101);
        return_shared(vault);
    };

    end(test);
}

// =====================================================================
// T-002 — withdraw before fire returns the full deposited balance to
// the owner.
// =====================================================================
#[test]
fun withdraw_before_fire_returns_full_balance_to_owner() {
    let mut test = begin(OWNER);
    let pool_id = setup_everything<SUI, USDC, SUI, DEEP>(&mut test);

    test.next_tx(OWNER);
    {
        let coin_in = mint_for_testing<SUI>(base_in_amount(), test.ctx());
        tpsl_vault::create_vault<SUI>(
            coin_in,
            pool_id,
            SIDE_LONG,
            option::some(2 * constants::float_scaling()),
            option::none<u64>(),
            test.ctx(),
        );
    };

    test.next_tx(OWNER);
    {
        let mut vault = test.take_shared<Vault<SUI>>();
        tpsl_vault::withdraw<SUI>(&mut vault, test.ctx());
        return_shared(vault);
    };

    test.next_tx(OWNER);
    {
        // OWNER must own a Coin<SUI> equal to the original deposit. The
        // contract may return the coin directly or transfer-to-sender;
        // both surface as a take_from_sender hit (AC3.3 names both).
        let drained = test.take_from_sender<Coin<SUI>>();
        assert!(coin::value(&drained) == base_in_amount(), 200);
        test.return_to_sender(drained);
    };

    end(test);
}

// =====================================================================
// T-003 — withdraw by non-owner aborts with ENotOwner.
// =====================================================================
#[
    test,
    expected_failure(abort_code = ::tpsl_vault::tpsl_vault::ENotOwner),
]
fun withdraw_by_non_owner_aborts_with_enotowner() {
    let mut test = begin(OWNER);
    let pool_id = setup_everything<SUI, USDC, SUI, DEEP>(&mut test);

    test.next_tx(OWNER);
    {
        let coin_in = mint_for_testing<SUI>(base_in_amount(), test.ctx());
        tpsl_vault::create_vault<SUI>(
            coin_in,
            pool_id,
            SIDE_LONG,
            option::some(2 * constants::float_scaling()),
            option::none<u64>(),
            test.ctx(),
        );
    };

    test.next_tx(STRANGER);
    {
        let mut vault = test.take_shared<Vault<SUI>>();
        tpsl_vault::withdraw<SUI>(&mut vault, test.ctx());
        return_shared(vault);
    };

    end(test);
}

// =====================================================================
// T-004 — execute_trigger fires when current_price reaches TP and routes
// proceeds (quote, base residual, DEEP residual) to the owner.
// =====================================================================
#[test]
fun execute_trigger_fires_on_tp_and_routes_proceeds_to_owner() {
    let mut test = begin(OWNER);
    let pool_id = setup_everything<SUI, USDC, SUI, DEEP>(&mut test);

    test.next_tx(OWNER);
    {
        let coin_in = mint_for_testing<SUI>(base_in_amount(), test.ctx());
        tpsl_vault::create_vault<SUI>(
            coin_in,
            pool_id,
            SIDE_LONG,
            option::some(1 * constants::float_scaling()),
            option::none<u64>(),
            test.ctx(),
        );
    };

    // Inspect TriggerFired INSIDE the firing tx (events buffer resets on
    // every next_tx). Locals persist across next_tx blocks, so we stash
    // event-derived values for cross-checking after the swap settles.
    let mut event_vault_id = object::id_from_address(@0x0);
    let mut event_quote_out_amount: u64 = 0;

    // KEEPER fires the trigger.
    test.next_tx(KEEPER);
    {
        let mut vault = test.take_shared<Vault<SUI>>();
        let vault_id_now = object::id(&vault);
        let mut pool = test.take_shared_by_id<Pool<SUI, USDC>>(pool_id);
        let clock = test.take_shared<Clock>();
        let deep_in = mint_for_testing<DEEP>(DEEP_IN, test.ctx());

        tpsl_vault::execute_trigger<SUI, USDC>(
            &mut vault,
            &mut pool,
            1 * constants::float_scaling(),
            deep_in,
            &clock,
            test.ctx(),
        );

        // Vault must be marked triggered after the call.
        assert!(tpsl_vault::is_triggered(&vault), 400);

        // Inspect event INSIDE this tx before next_tx clears the buffer.
        let fired_events = event::events_by_type<TriggerFired>();
        assert!(fired_events.length() == 1, 404);
        let evt = &fired_events[0];
        event_vault_id = tpsl_vault::trigger_fired_vault_id(evt);
        event_quote_out_amount = tpsl_vault::trigger_fired_quote_out_amount(evt);
        assert!(event_vault_id == vault_id_now, 405);
        assert!(tpsl_vault::trigger_fired_owner(evt) == OWNER, 406);
        assert!(
            tpsl_vault::trigger_fired_current_price(evt)
                == 1 * constants::float_scaling(),
            407,
        );
        assert!(event_quote_out_amount > 0, 408);

        return_shared(vault);
        return_shared(pool);
        return_shared(clock);
    };

    // OWNER inspects what they received: Coin<USDC> (quote out, > 0),
    // Coin<SUI> (base residual, may be 0), Coin<DEEP> (deep residual).
    test.next_tx(OWNER);
    {
        let quote_out = test.take_from_sender<Coin<USDC>>();
        assert!(coin::value(&quote_out) > 0, 401);
        // Cross-check coin value matches the event-reported amount.
        assert!(coin::value(&quote_out) == event_quote_out_amount, 409);
        test.return_to_sender(quote_out);

        let base_residual = test.take_from_sender<Coin<SUI>>();
        test.return_to_sender(base_residual);

        let deep_residual = test.take_from_sender<Coin<DEEP>>();
        test.return_to_sender(deep_residual);
    };

    // KEEPER must NOT receive any of the swap output — pins the
    // no-side-channel routing (Contract decisions #3).
    test.next_tx(KEEPER);
    {
        assert!(
            !test_scenario::has_most_recent_for_address<Coin<USDC>>(KEEPER),
            402,
        );
        assert!(
            !test_scenario::has_most_recent_for_address<Coin<DEEP>>(KEEPER),
            403,
        );
    };

    // Suppress unused-variable warning for the captured event_vault_id —
    // it's already cross-checked against vault_id_now inside the trigger tx.
    let _ = event_vault_id;

    end(test);
}

// =====================================================================
// T-005 — execute_trigger fires when current_price falls to SL threshold
// and routes proceeds to owner.
// =====================================================================
#[test]
fun execute_trigger_fires_on_sl_and_routes_proceeds_to_owner() {
    let mut test = begin(OWNER);
    let pool_id = setup_everything<SUI, USDC, SUI, DEEP>(&mut test);

    test.next_tx(OWNER);
    {
        let coin_in = mint_for_testing<SUI>(base_in_amount(), test.ctx());
        tpsl_vault::create_vault<SUI>(
            coin_in,
            pool_id,
            SIDE_LONG,
            option::none<u64>(),
            option::some(2 * constants::float_scaling()),
            test.ctx(),
        );
    };

    // T-005 same fix pattern as T-004: inspect TriggerFired INSIDE the
    // firing tx before next_tx clears the events buffer.
    let mut event_vault_id = object::id_from_address(@0x0);

    test.next_tx(KEEPER);
    {
        let mut vault = test.take_shared<Vault<SUI>>();
        let vault_id_now = object::id(&vault);
        let mut pool = test.take_shared_by_id<Pool<SUI, USDC>>(pool_id);
        let clock = test.take_shared<Clock>();
        let deep_in = mint_for_testing<DEEP>(DEEP_IN, test.ctx());

        // current_price = 1, sl_price = 2 → 1 <= 2 → SL fires.
        tpsl_vault::execute_trigger<SUI, USDC>(
            &mut vault,
            &mut pool,
            1 * constants::float_scaling(),
            deep_in,
            &clock,
            test.ctx(),
        );

        assert!(tpsl_vault::is_triggered(&vault), 500);

        let fired_events = event::events_by_type<TriggerFired>();
        assert!(fired_events.length() == 1, 502);
        let evt = &fired_events[0];
        event_vault_id = tpsl_vault::trigger_fired_vault_id(evt);
        assert!(event_vault_id == vault_id_now, 503);
        assert!(tpsl_vault::trigger_fired_owner(evt) == OWNER, 504);
        assert!(
            tpsl_vault::trigger_fired_current_price(evt)
                == 1 * constants::float_scaling(),
            505,
        );

        return_shared(vault);
        return_shared(pool);
        return_shared(clock);
    };

    test.next_tx(OWNER);
    {
        let quote_out = test.take_from_sender<Coin<USDC>>();
        assert!(coin::value(&quote_out) > 0, 501);
        test.return_to_sender(quote_out);

        let base_residual = test.take_from_sender<Coin<SUI>>();
        test.return_to_sender(base_residual);

        let deep_residual = test.take_from_sender<Coin<DEEP>>();
        test.return_to_sender(deep_residual);
    };

    // Suppress unused-local warning — the cross-check against vault_id_now
    // happened inline inside the trigger tx above.
    let _ = event_vault_id;

    end(test);
}

// =====================================================================
// T-006 — execute_trigger aborts with ETriggerConditionNotMet when
// neither TP nor SL is satisfied.
// =====================================================================
#[
    test,
    expected_failure(
        abort_code = ::tpsl_vault::tpsl_vault::ETriggerConditionNotMet,
    ),
]
fun execute_trigger_aborts_when_neither_tp_nor_sl_satisfied() {
    let mut test = begin(OWNER);
    let pool_id = setup_everything<SUI, USDC, SUI, DEEP>(&mut test);

    test.next_tx(OWNER);
    {
        let coin_in = mint_for_testing<SUI>(base_in_amount(), test.ctx());
        // tp = 10 (unreachable upward at price=1) and sl = 0 (unreachable
        // downward at price=1) → neither condition satisfied.
        tpsl_vault::create_vault<SUI>(
            coin_in,
            pool_id,
            SIDE_LONG,
            option::some(10 * constants::float_scaling()),
            option::some(0),
            test.ctx(),
        );
    };

    test.next_tx(KEEPER);
    {
        let mut vault = test.take_shared<Vault<SUI>>();
        let mut pool = test.take_shared_by_id<Pool<SUI, USDC>>(pool_id);
        let clock = test.take_shared<Clock>();
        let deep_in = mint_for_testing<DEEP>(DEEP_IN, test.ctx());

        tpsl_vault::execute_trigger<SUI, USDC>(
            &mut vault,
            &mut pool,
            1 * constants::float_scaling(),
            deep_in,
            &clock,
            test.ctx(),
        );

        return_shared(vault);
        return_shared(pool);
        return_shared(clock);
    };

    end(test);
}

// =====================================================================
// T-007 — withdraw after a successful trigger aborts with EVaultTriggered.
// Trigger and withdraw both happen in a single test_scenario lifetime
// (Cycle 2 R3-fixture lesson: do NOT use two begin/end pairs in one test).
// =====================================================================
#[
    test,
    expected_failure(abort_code = ::tpsl_vault::tpsl_vault::EVaultTriggered),
]
fun withdraw_after_fire_aborts_with_evaulttriggered() {
    let mut test = begin(OWNER);
    let pool_id = setup_everything<SUI, USDC, SUI, DEEP>(&mut test);

    test.next_tx(OWNER);
    {
        let coin_in = mint_for_testing<SUI>(base_in_amount(), test.ctx());
        tpsl_vault::create_vault<SUI>(
            coin_in,
            pool_id,
            SIDE_LONG,
            option::some(1 * constants::float_scaling()),
            option::none<u64>(),
            test.ctx(),
        );
    };

    // KEEPER fires the trigger: tp = 1, current_price = 1 → 1 >= 1 → fires.
    test.next_tx(KEEPER);
    {
        let mut vault = test.take_shared<Vault<SUI>>();
        let mut pool = test.take_shared_by_id<Pool<SUI, USDC>>(pool_id);
        let clock = test.take_shared<Clock>();
        let deep_in = mint_for_testing<DEEP>(DEEP_IN, test.ctx());

        tpsl_vault::execute_trigger<SUI, USDC>(
            &mut vault,
            &mut pool,
            1 * constants::float_scaling(),
            deep_in,
            &clock,
            test.ctx(),
        );

        return_shared(vault);
        return_shared(pool);
        return_shared(clock);
    };

    // OWNER then attempts a withdraw — must abort with EVaultTriggered.
    test.next_tx(OWNER);
    {
        let mut vault = test.take_shared<Vault<SUI>>();
        tpsl_vault::withdraw<SUI>(&mut vault, test.ctx());
        return_shared(vault);
    };

    end(test);
}
