// Copyright (c) Alilloig
// SPDX-License-Identifier: Apache-2.0

/// TP/SL Vault: custodies a Balance<T> and fires a DeepBook no-manager
/// swap_exact_base_for_quote when the keeper-supplied price meets the
/// take-profit or stop-loss condition.
module tpsl_vault::tpsl_vault;

use deepbook::pool::{Self, Pool};
use std::option::Option;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use sui::object::{Self, ID, UID};
use sui::transfer;
use sui::tx_context::TxContext;
use token::deep::DEEP;

// === Error codes (non-zero per Cycle 2 R3-002) ===

/// Withdraw caller is not the vault owner.
const ENotOwner: u64 = 1001;
/// Operation attempted on a vault whose triggered flag is already true.
const EVaultTriggered: u64 = 1002;
/// execute_trigger invoked while current_price satisfies neither TP nor SL.
const ETriggerConditionNotMet: u64 = 1003;
/// execute_trigger called with a `pool` whose ID does not match the vault's
/// stored `pool_id`. Closes the iter-1 R3-001/R6-001 high-severity gap.
const EWrongPool: u64 = 1004;

// === Structs ===

/// Shared object that custodies a Balance<T> under owner-defined TP/SL prices.
public struct Vault<phantom T> has key {
    id: UID,
    owner: address,
    balance: Balance<T>,
    tp_price: Option<u64>,
    sl_price: Option<u64>,
    pool_id: ID,
    side: u8,
    triggered: bool,
}

// === Events ===

public struct VaultCreated has copy, drop, store {
    vault_id: ID,
    owner: address,
    pool_id: ID,
    side: u8,
    tp_price: Option<u64>,
    sl_price: Option<u64>,
    deposit_amount: u64,
}

public struct TriggerFired has copy, drop, store {
    vault_id: ID,
    owner: address,
    current_price: u64,
    quote_out_amount: u64,
    base_residual_amount: u64,
    deep_residual_amount: u64,
}

// === Entry functions ===

/// Construct and share a Vault<T>; emit VaultCreated.
#[allow(lint(public_entry))]
public entry fun create_vault<T>(
    coin: Coin<T>,
    pool_id: ID,
    side: u8,
    tp_price: Option<u64>,
    sl_price: Option<u64>,
    ctx: &mut TxContext,
) {
    let deposit_amount = coin::value(&coin);
    let owner = ctx.sender();

    let vault = Vault<T> {
        id: object::new(ctx),
        owner,
        balance: coin::into_balance(coin),
        tp_price,
        sl_price,
        pool_id,
        side,
        triggered: false,
    };

    let vault_id = object::id(&vault);

    event::emit(VaultCreated {
        vault_id,
        owner,
        pool_id,
        side,
        tp_price,
        sl_price,
        deposit_amount,
    });

    transfer::share_object(vault);
}

/// Owner-only withdraw of the entire custodied balance.
/// Aborts with ENotOwner if caller is not the vault owner.
/// Aborts with EVaultTriggered if the vault has already fired.
#[allow(lint(public_entry))]
public entry fun withdraw<T>(vault: &mut Vault<T>, ctx: &mut TxContext) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    assert!(!vault.triggered, EVaultTriggered);

    let balance = balance::withdraw_all(&mut vault.balance);
    let coin = coin::from_balance(balance, ctx);
    transfer::public_transfer(coin, vault.owner);
}

/// Permissionless but condition-gated trigger execution.
/// Aborts with EVaultTriggered if the vault has already fired.
/// Aborts with ETriggerConditionNotMet if neither TP nor SL is satisfied.
/// On success: swaps the entire custodied balance via DeepBook no-manager path,
/// routes all three returned coins to vault.owner, marks triggered = true,
/// emits TriggerFired.
#[allow(lint(public_entry))]
public entry fun execute_trigger<Base, Quote>(
    vault: &mut Vault<Base>,
    pool: &mut Pool<Base, Quote>,
    current_price: u64,
    deep_in: Coin<DEEP>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(!vault.triggered, EVaultTriggered);

    // Bind the supplied pool to the vault's stored pool_id. Without this
    // assert, a permissionless caller could substitute any same-typed pool
    // (including a freshly-deployed poisoned pool with adverse pricing) and
    // drain the vault through it — `min_quote_out = 0` makes the drain
    // unbounded. Triangulated as critical/high by reviewers R1, R3, R6 of
    // Cycle 3 iter-1.
    assert!(object::id(pool) == vault.pool_id, EWrongPool);

    // Check TP or SL condition.
    let tp_met = vault.tp_price.is_some() && current_price >= *vault.tp_price.borrow();
    let sl_met = vault.sl_price.is_some() && current_price <= *vault.sl_price.borrow();
    assert!(tp_met || sl_met, ETriggerConditionNotMet);

    let vault_id = object::id(vault);
    let owner = vault.owner;

    // Drain the vault balance into a Coin<Base>.
    let base_balance = balance::withdraw_all(&mut vault.balance);
    let base_in = coin::from_balance(base_balance, ctx);

    // Call DeepBook no-manager swap (min_quote_out = 0; condition gate is
    // the correctness gate per contract decision).
    let (base_residual, quote_out, deep_residual) =
        pool::swap_exact_base_for_quote(pool, base_in, deep_in, 0, clock, ctx);

    let quote_out_amount = coin::value(&quote_out);
    let base_residual_amount = coin::value(&base_residual);
    let deep_residual_amount = coin::value(&deep_residual);

    // Route all three coins to vault.owner (contract decision #3 — no
    // side-channel for the permissionless trigger caller).
    transfer::public_transfer(quote_out, owner);
    transfer::public_transfer(base_residual, owner);
    transfer::public_transfer(deep_residual, owner);

    // Mark triggered.
    vault.triggered = true;

    event::emit(TriggerFired {
        vault_id,
        owner,
        current_price,
        quote_out_amount,
        base_residual_amount,
        deep_residual_amount,
    });
}

// === Read accessors (required by tests) ===

/// Returns the current custodied balance value.
public fun balance_value<T>(vault: &Vault<T>): u64 {
    balance::value(&vault.balance)
}

/// Returns whether the vault has been triggered.
public fun is_triggered<T>(vault: &Vault<T>): bool {
    vault.triggered
}

// VaultCreated event field accessors.

public fun vault_created_vault_id(evt: &VaultCreated): ID {
    evt.vault_id
}

public fun vault_created_owner(evt: &VaultCreated): address {
    evt.owner
}

public fun vault_created_pool_id(evt: &VaultCreated): ID {
    evt.pool_id
}

public fun vault_created_side(evt: &VaultCreated): u8 {
    evt.side
}

public fun vault_created_tp_price(evt: &VaultCreated): Option<u64> {
    evt.tp_price
}

public fun vault_created_sl_price(evt: &VaultCreated): Option<u64> {
    evt.sl_price
}

public fun vault_created_deposit_amount(evt: &VaultCreated): u64 {
    evt.deposit_amount
}

// TriggerFired event field accessors.

public fun trigger_fired_vault_id(evt: &TriggerFired): ID {
    evt.vault_id
}

public fun trigger_fired_owner(evt: &TriggerFired): address {
    evt.owner
}

public fun trigger_fired_current_price(evt: &TriggerFired): u64 {
    evt.current_price
}

public fun trigger_fired_quote_out_amount(evt: &TriggerFired): u64 {
    evt.quote_out_amount
}
