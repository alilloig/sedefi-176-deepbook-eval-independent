/// Minimal Dollar-Cost-Averaging vault on top of DeepBook.
///
/// Owner locks up SUI and a cadence, a keeper periodically triggers an
/// atomic SUI → DEEP swap. Owner can withdraw accumulated DEEP + unused SUI
/// at any time.
module dca_vault::dca_vault;

use sui::balance::{Self, Balance};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;

use deepbook::pool::{Self, Pool};
use token::deep::DEEP;

// -- Errors -----------------------------------------------------------------
const EIntervalNotElapsed: u64 = 1;
const ENotOwner: u64 = 2;
const EInsufficientSui: u64 = 3;

// -- Object -----------------------------------------------------------------

public struct DcaVault has key {
    id: UID,
    owner: address,
    sui: Balance<SUI>,
    deep: Balance<DEEP>,
    /// Amount of SUI (in MIST, 1 SUI = 1_000_000_000) swapped per execution.
    amount_per_exec: u64,
    /// Minimum time between executions, in milliseconds.
    interval_ms: u64,
    /// Unix-ms timestamp of the last execution (0 ⇒ never).
    last_exec_ms: u64,
    total_executions: u64,
    total_deep_bought: u64,
}

// -- Events -----------------------------------------------------------------

public struct Executed has copy, drop {
    vault: ID,
    sui_in: u64,
    deep_out: u64,
    exec_index: u64,
    timestamp_ms: u64,
}

// -- Entry API --------------------------------------------------------------

public entry fun create(
    sui_deposit: Coin<SUI>,
    amount_per_exec: u64,
    interval_ms: u64,
    ctx: &mut TxContext,
) {
    let owner = tx_context::sender(ctx);
    transfer::share_object(DcaVault {
        id: object::new(ctx),
        owner,
        sui: coin::into_balance(sui_deposit),
        deep: balance::zero(),
        amount_per_exec,
        interval_ms,
        last_exec_ms: 0,
        total_executions: 0,
        total_deep_bought: 0,
    });
}

public entry fun top_up_sui(vault: &mut DcaVault, sui: Coin<SUI>, ctx: &TxContext) {
    assert!(tx_context::sender(ctx) == vault.owner, ENotOwner);
    balance::join(&mut vault.sui, coin::into_balance(sui));
}

public entry fun withdraw_all(vault: &mut DcaVault, ctx: &mut TxContext) {
    assert!(tx_context::sender(ctx) == vault.owner, ENotOwner);
    let sui_amt = balance::value(&vault.sui);
    let deep_amt = balance::value(&vault.deep);
    let sui_out = coin::from_balance(balance::split(&mut vault.sui, sui_amt), ctx);
    let deep_out = coin::from_balance(balance::split(&mut vault.deep, deep_amt), ctx);
    transfer::public_transfer(sui_out, vault.owner);
    transfer::public_transfer(deep_out, vault.owner);
}

// -- Core: DCA execution (permissionless) -----------------------------------

public fun execute(
    vault: &mut DcaVault,
    pool: &mut Pool<DEEP, SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let now = clock::timestamp_ms(clock);
    assert!(now >= vault.last_exec_ms + vault.interval_ms, EIntervalNotElapsed);
    assert!(balance::value(&vault.sui) >= vault.amount_per_exec, EInsufficientSui);

    let sui_coin = coin::from_balance(
        balance::split(&mut vault.sui, vault.amount_per_exec),
        ctx,
    );
    let (deep_out, sui_leftover, deep_leftover) = pool::swap_exact_quote_for_base(
        pool,
        sui_coin,
        coin::zero<DEEP>(ctx),
        0,
        clock,
        ctx,
    );

    // Any unfilled SUI goes back into the vault rather than being lost.
    balance::join(&mut vault.sui, coin::into_balance(sui_leftover));
    if (coin::value(&deep_leftover) > 0) {
        balance::join(&mut vault.deep, coin::into_balance(deep_leftover));
    } else {
        coin::destroy_zero(deep_leftover);
    };

    let deep_amount = coin::value(&deep_out);
    balance::join(&mut vault.deep, coin::into_balance(deep_out));

    vault.last_exec_ms = now;
    vault.total_executions = vault.total_executions + 1;
    vault.total_deep_bought = vault.total_deep_bought + deep_amount;

    event::emit(Executed {
        vault: object::id(vault),
        sui_in: vault.amount_per_exec,
        deep_out: deep_amount,
        exec_index: vault.total_executions,
        timestamp_ms: now,
    });
}

// -- Readers ----------------------------------------------------------------

public fun sui_balance(v: &DcaVault): u64 { balance::value(&v.sui) }
public fun deep_balance(v: &DcaVault): u64 { balance::value(&v.deep) }
public fun next_exec_ms(v: &DcaVault): u64 { v.last_exec_ms + v.interval_ms }
public fun interval_ms(v: &DcaVault): u64 { v.interval_ms }
public fun amount_per_exec(v: &DcaVault): u64 { v.amount_per_exec }
public fun total_executions(v: &DcaVault): u64 { v.total_executions }
public fun total_deep_bought(v: &DcaVault): u64 { v.total_deep_bought }
public fun owner(v: &DcaVault): address { v.owner }
