// Copyright (c) Alilloig
// SPDX-License-Identifier: Apache-2.0

/// Slippage-safe wrapper around DeepBook's no-manager swap_exact_base_for_quote.
/// Asserts the realised quote output meets a caller-supplied floor before
/// forwarding all returned coins to the sender.
module slippage_swap::slippage_swap;

use deepbook::pool::{Self, Pool};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use token::deep::DEEP;

// === Errors ===

/// Abort code raised when the realised quote output is below the caller's
/// min_out floor (slippage-floor abort code).
const EInsufficientOutput: u64 = 0;

// === Public entry ===

/// Swap an exact amount of BaseAsset for QuoteAsset through a DeepBook pool
/// without a balance manager, enforcing a caller-supplied minimum output floor.
///
/// The function:
///   1. Calls `deepbook::pool::swap_exact_base_for_quote` with `min_quote_out = 0`
///      so DeepBook's internal assertion never fires — this wrapper's assertion
///      is the sole gate.
///   2. Destructures the returned `(Coin<BaseAsset>, Coin<QuoteAsset>, Coin<DEEP>)`.
///   3. Asserts `coin::value(&quote_out) >= min_out` with `EInsufficientOutput`.
///   4. Transfers all three coins (base residual, quote output, DEEP residual)
///      to `tx_context::sender(ctx)`.
public entry fun swap_exact_base_for_quote<BaseAsset, QuoteAsset>(
    pool: &mut Pool<BaseAsset, QuoteAsset>,
    base_in: Coin<BaseAsset>,
    deep_in: Coin<DEEP>,
    min_out: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // Pass min_quote_out = 0 to DeepBook so its internal check never fires;
    // we apply our own assertion below.
    let (base_residual, quote_out, deep_residual) =
        pool::swap_exact_base_for_quote(pool, base_in, deep_in, 0, clock, ctx);

    // Enforce the caller's slippage floor.
    assert!(coin::value(&quote_out) >= min_out, EInsufficientOutput);

    // Route all three coins back to the sender — no balance manager created.
    let sender = ctx.sender();
    transfer::public_transfer(base_residual, sender);
    transfer::public_transfer(quote_out, sender);
    transfer::public_transfer(deep_residual, sender);
}
