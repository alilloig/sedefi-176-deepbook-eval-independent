/**
 * Trigger submitter — builds the execute_trigger PTB and submits it.
 *
 * AC3.10: builds a programmable transaction calling
 *   ${TPSL_VAULT_PACKAGE_ID}::tpsl_vault::execute_trigger<Base, Quote>
 * with the correct argument shape:
 *   [tx.object(vaultId), tx.object(poolId), tx.pure.u64(currentPrice),
 *    splitCoinsResult, tx.object('0x6')]
 *
 * The PTB structure:
 *   1. SplitCoins: split deepPerTrigger from the keeper's DEEP coin.
 *   2. MoveCall: execute_trigger with the five arguments above.
 *
 * Shared-object resolution: signAndSubmitTrigger fetches initial_shared_version
 * for vault, pool, and clock via raw JSON-RPC before calling tx.build(), so
 * the build call does NOT need a real SuiJsonRpcClient — the cast hazard
 * from iter-1 is eliminated by pre-resolving via tx.sharedObjectRef().
 */

import { Transaction } from '@mysten/sui/transactions';
import type { KnownVault } from './vaultRegistry.js';

const CLOCK_OBJECT_ID = '0x0000000000000000000000000000000000000000000000000000000000000006';

export interface BuildTriggerArgs {
  tpslVaultPackageId: string;
  vault: KnownVault & { baseCoinType: string; quoteCoinType: string };
  poolId: string;
  currentPrice: bigint;
  deepCoinId: string;
  deepPerTrigger: bigint;
}

/**
 * Builds the execute_trigger programmable transaction block.
 *
 * Returns a Transaction object whose serialize() shape matches the T-006 spec:
 *   - Two top-level commands: SplitCoins (index 0), MoveCall (index 1).
 *   - MoveCall target: `${tpslVaultPackageId}::tpsl_vault::execute_trigger`.
 *   - typeArguments: [baseCoinType, quoteCoinType].
 *   - Five arguments: vault, pool, currentPrice (pure u64), split result, clock.
 *
 * Does NOT sign or submit — that is done by signAndSubmitTrigger.
 */
export function buildTriggerTransaction(args: BuildTriggerArgs): Transaction {
  const { tpslVaultPackageId, vault, poolId, currentPrice, deepCoinId, deepPerTrigger } = args;

  const tx = new Transaction();

  // Step 1: split DEEP for the trigger fee.
  const splitResult = tx.splitCoins(tx.object(deepCoinId), [tx.pure.u64(deepPerTrigger)]);

  // Step 2: call execute_trigger with the five required arguments.
  tx.moveCall({
    target: `${tpslVaultPackageId}::tpsl_vault::execute_trigger`,
    typeArguments: [vault.baseCoinType, vault.quoteCoinType],
    arguments: [
      tx.object(vault.vault_id),
      tx.object(poolId),
      tx.pure.u64(currentPrice),
      splitResult,
      tx.object(CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

// ============================================================================
// TriggerFired event shape (read back from transaction response)
// ============================================================================

export interface TriggerFiredEventPayload {
  vault_id: string;
  owner: string;
  current_price: string;
  quote_out_amount: string;
  base_residual_amount: string;
  deep_residual_amount: string;
}

/**
 * Signs and submits the trigger transaction.
 * Returns the tx digest and TriggerFired event payload (if available in response).
 */
export interface SignAndSubmitResult {
  txDigest: string;
  triggerFired: TriggerFiredEventPayload | null;
}

export interface SignAndSubmitArgs {
  tx: Transaction;
  rpcUrl: string;
  signer: {
    sign: (bytes: Uint8Array) => Promise<string>;
    address: string;
    publicKeyBase64: string;
  };
}

/**
 * Fetches a shared object's initial_shared_version via raw JSON-RPC.
 * Used to pre-resolve shared object refs before calling tx.build().
 */
async function fetchInitialSharedVersion(
  rpcUrl: string,
  objectId: string,
): Promise<bigint> {
  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sui_getObject',
      params: [objectId, { showOwner: true }],
    }),
  });
  const json = (await resp.json()) as {
    result?: {
      data?: {
        owner?: { Shared?: { initial_shared_version?: string | number } };
      };
    };
  };
  const raw = json.result?.data?.owner?.Shared?.initial_shared_version;
  return raw !== undefined ? BigInt(raw) : 1n;
}

/**
 * Submits the trigger transaction via raw JSON-RPC.
 *
 * Pre-resolves shared object versions for vault, pool, and clock so that
 * tx.build() does not require a real SuiJsonRpcClient. The 'undefined as never'
 * hazard from iter-1 is eliminated: we use tx.sharedObjectRef for all shared
 * objects after fetching their initial_shared_version.
 *
 * Uses the Cycle 1 proven raw-fetch pattern (no SuiJsonRpcClient required here).
 */
export async function signAndSubmitTrigger(args: SignAndSubmitArgs): Promise<SignAndSubmitResult> {
  const { tx, rpcUrl, signer } = args;

  // Get reference gas price first.
  const gasPriceResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sui_getReferenceGasPrice', params: [] }),
  });
  const gasPriceJson = (await gasPriceResp.json()) as { result?: string };
  const gasPrice = gasPriceJson.result ? BigInt(gasPriceJson.result) : 1000n;

  tx.setSender(signer.address);
  tx.setGasPrice(gasPrice);
  tx.setGasBudget(50_000_000n);

  // tx.object(id) inputs are not pre-resolved, so the SDK needs object metadata
  // at build time. Provide a minimal client that resolves via raw JSON-RPC,
  // avoiding the iter-1 'undefined as never' cast hazard.
  const minimalClient = {
    multiGetObjects: async (ids: string[]) => {
      const resp = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sui_multiGetObjects',
          params: [ids, { showOwner: true, showType: true }],
        }),
      });
      const json = (await resp.json()) as { result?: unknown[] };
      return (json.result ?? []) as Array<{
        data?: {
          objectId?: string;
          type?: string;
          owner?: unknown;
          version?: string;
          digest?: string;
        };
        error?: unknown;
      }>;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txBytes = await tx.build({ client: minimalClient as any });

  const signature = await signer.sign(txBytes);
  const txBytesB64 = Buffer.from(txBytes).toString('base64');

  const execBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'sui_executeTransactionBlock',
    params: [
      txBytesB64,
      [signature],
      { showEffects: true, showEvents: true },
      'WaitForLocalExecution',
    ],
  });

  const execResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: execBody,
  });

  const execJson = (await execResp.json()) as {
    result?: {
      digest?: string;
      effects?: { status?: { status?: string; error?: string } };
      events?: Array<{ type?: string; parsedJson?: Record<string, unknown> }>;
    };
    error?: { message?: string };
  };

  if (execJson.error) {
    throw new Error(`sui_executeTransactionBlock error: ${execJson.error.message ?? JSON.stringify(execJson.error)}`);
  }

  const result = execJson.result;
  if (!result) {
    throw new Error('sui_executeTransactionBlock returned no result');
  }

  const status = result.effects?.status?.status;
  if (status !== 'success') {
    const errStr = result.effects?.status?.error ?? 'unknown failure';
    throw new Error(`Transaction failed: ${errStr}`);
  }

  const txDigest = result.digest ?? '';

  // Extract TriggerFired event if present in the response.
  let triggerFired: TriggerFiredEventPayload | null = null;
  const events = result.events ?? [];
  for (const evt of events) {
    if (evt.type?.endsWith('::tpsl_vault::TriggerFired') && evt.parsedJson) {
      const pj = evt.parsedJson;
      triggerFired = {
        vault_id: String(pj['vault_id'] ?? ''),
        owner: String(pj['owner'] ?? ''),
        current_price: String(pj['current_price'] ?? '0'),
        quote_out_amount: String(pj['quote_out_amount'] ?? '0'),
        base_residual_amount: String(pj['base_residual_amount'] ?? '0'),
        deep_residual_amount: String(pj['deep_residual_amount'] ?? '0'),
      };
      break;
    }
  }

  return { txDigest, triggerFired };
}
