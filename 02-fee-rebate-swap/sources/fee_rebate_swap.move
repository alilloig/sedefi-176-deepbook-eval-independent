/// A minimal fee-rebate router around DeepBook's SUI → DEEP swap.
///
/// Anyone with an admin-seeded RebateVault can call `swap_sui_for_deep_with_rebate`
/// to receive a small DEEP bonus out of the vault's reserve on top of the pool's
/// swap output. Useful as a loyalty/marketing primitive or onboarding incentive.
module fee_rebate_swap::fee_rebate_swap;

use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;

use deepbook::pool::{Self, Pool};
use token::deep::DEEP;

// -- Errors -----------------------------------------------------------------
const EInsufficientReserve: u64 = 1;
const ENotAdmin: u64 = 2;

// -- Objects ----------------------------------------------------------------

/// Shared vault holding the DEEP reserve used to pay out rebates.
public struct RebateVault has key {
    id: UID,
    admin: address,
    reserve: Balance<DEEP>,
    /// Basis points (10_000 = 100%). 10 = 0.10%.
    rebate_bps: u64,
    total_paid_out: u64,
}

// -- Events -----------------------------------------------------------------

public struct RebateClaimed has copy, drop {
    user: address,
    deep_out: u64,
    rebate: u64,
}

// -- Entry / admin ----------------------------------------------------------

public entry fun create_vault(rebate_bps: u64, ctx: &mut TxContext) {
    transfer::share_object(RebateVault {
        id: object::new(ctx),
        admin: tx_context::sender(ctx),
        reserve: balance::zero(),
        rebate_bps,
        total_paid_out: 0,
    });
}

public entry fun top_up(vault: &mut RebateVault, deep: Coin<DEEP>, ctx: &TxContext) {
    assert!(tx_context::sender(ctx) == vault.admin, ENotAdmin);
    balance::join(&mut vault.reserve, coin::into_balance(deep));
}

public entry fun set_rebate_bps(vault: &mut RebateVault, new_bps: u64, ctx: &TxContext) {
    assert!(tx_context::sender(ctx) == vault.admin, ENotAdmin);
    vault.rebate_bps = new_bps;
}

// -- Core: rebated swap -----------------------------------------------------

public fun swap_sui_for_deep_with_rebate(
    vault: &mut RebateVault,
    pool: &mut Pool<DEEP, SUI>,
    sui_in: Coin<SUI>,
    min_deep_out: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<DEEP> {
    // DEEP/SUI is a whitelisted pool — zero DEEP fee coin is fine.
    let (mut deep_out, sui_leftover, deep_leftover) = pool::swap_exact_quote_for_base(
        pool,
        sui_in,
        coin::zero<DEEP>(ctx),
        min_deep_out,
        clock,
        ctx,
    );

    let sender = tx_context::sender(ctx);

    // Refund any unused SUI to the caller.
    if (coin::value(&sui_leftover) > 0) {
        transfer::public_transfer(sui_leftover, sender);
    } else {
        coin::destroy_zero(sui_leftover);
    };
    // Merge any leftover DEEP (usually 0 for a whitelisted pool).
    if (coin::value(&deep_leftover) > 0) {
        coin::join(&mut deep_out, deep_leftover);
    } else {
        coin::destroy_zero(deep_leftover);
    };

    // Pay the rebate from the vault reserve.
    let deep_amount = coin::value(&deep_out);
    let rebate_amount = deep_amount * vault.rebate_bps / 10_000;
    assert!(balance::value(&vault.reserve) >= rebate_amount, EInsufficientReserve);
    coin::join(
        &mut deep_out,
        coin::from_balance(balance::split(&mut vault.reserve, rebate_amount), ctx),
    );
    vault.total_paid_out = vault.total_paid_out + rebate_amount;

    event::emit(RebateClaimed {
        user: sender,
        deep_out: deep_amount,
        rebate: rebate_amount,
    });

    deep_out
}

// -- Readers ----------------------------------------------------------------

public fun reserve_value(vault: &RebateVault): u64 {
    balance::value(&vault.reserve)
}
public fun total_paid_out(vault: &RebateVault): u64 { vault.total_paid_out }
public fun rebate_bps(vault: &RebateVault): u64 { vault.rebate_bps }
public fun admin(vault: &RebateVault): address { vault.admin }
