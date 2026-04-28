/**
 * Pyth PriceInfoObject BCS decoder.
 *
 * Reference: ../notes/pyth-shape.md (load-bearing per spec G-Pyth).
 *
 * The keeper drives price reads via sui_devInspectTransactionBlock against
 * `pyth::pyth::get_price_unsafe(price_info)` and decodes the BCS bytes
 * returned as the move call's return value.
 *
 * BCS layout (34 bytes total, per notes/pyth-shape.md):
 *   offset  bytes  field
 *   ------  -----  -------------------------
 *        0      1  price.negative  (bool: 0=false, 1=true)
 *        1      8  price.magnitude (u64 LE)
 *        9      8  conf            (u64 LE)
 *       17      1  expo.negative   (bool)
 *       18      8  expo.magnitude  (u64 LE)
 *       26      8  timestamp       (u64 LE)
 *
 * A negative price byte aborts with 'Negative price from oracle'.
 * The exponent is: expoNegative ? -expoMagnitude : +expoMagnitude.
 * For all USD-denominated Pyth feeds on this sandbox the exponent is -8.
 *
 * Pattern: Cycle 1 proven raw fetch JSON-RPC (no @mysten/sui client needed).
 * Transaction kind BCS is built manually using @mysten/sui/bcs utilities.
 */

import { bcs } from '@mysten/sui/bcs';

const PRICE_BCS_LENGTH = 34;

/** Decoded Pyth price. */
export interface PythPrice {
  /** u64 magnitude of the I64 `price` field (always non-negative). */
  magnitude: bigint;
  /** Signed exponent; typically -8 for USD-denominated Pyth feeds. */
  exponent: bigint;
  /** Confidence interval as a u64 (same scale as magnitude). */
  conf: bigint;
  /** Publish time in seconds since the Unix epoch. */
  publishTimeSeconds: bigint;
}

function readU64LE(bytes: Uint8Array | number[], offset: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v |= BigInt(bytes[offset + i]) << BigInt(i * 8);
  }
  return v;
}

/**
 * Parses the 34-byte BCS payload returned by `pyth::pyth::get_price_unsafe`.
 *
 * @param bytes - 34-byte buffer (Uint8Array or number[]).
 * @throws Error('Negative price from oracle') if price.negative byte is non-zero.
 * @throws Error if input is shorter than 34 bytes.
 */
export function parsePriceFromBcs(bytes: Uint8Array | number[]): PythPrice {
  if (bytes.length < PRICE_BCS_LENGTH) {
    throw new Error(
      `Pyth BCS price buffer too short: expected ${PRICE_BCS_LENGTH} bytes, got ${bytes.length}`,
    );
  }

  const priceNegative = bytes[0] !== 0;
  if (priceNegative) {
    throw new Error('Negative price from oracle');
  }

  const priceMagnitude = readU64LE(bytes, 1);
  const conf = readU64LE(bytes, 9);
  const expoNegative = bytes[17] !== 0;
  const expoMagnitude = readU64LE(bytes, 18);
  const timestamp = readU64LE(bytes, 26);

  const exponent = expoNegative ? -expoMagnitude : expoMagnitude;

  return {
    magnitude: priceMagnitude,
    exponent,
    conf,
    publishTimeSeconds: timestamp,
  };
}

/**
 * Builds the BCS TransactionKind bytes for a call to
 * `pyth::pyth::get_price_unsafe(price_info)`.
 *
 * Uses @mysten/sui/bcs to manually serialize the transaction kind offline,
 * bypassing the SDK's client-dependent build path. The initial_shared_version
 * must be provided (fetch from sui_getObject if unknown).
 */
export function buildGetPriceUnsafeTxKindB64(
  pythPackageId: string,
  priceInfoObjectId: string,
  initialSharedVersion: bigint,
): string {
  const txKindBytes = bcs.TransactionKind.serialize({
    $kind: 'ProgrammableTransaction',
    ProgrammableTransaction: {
      inputs: [
        {
          $kind: 'Object',
          Object: {
            $kind: 'SharedObject',
            SharedObject: {
              objectId: priceInfoObjectId,
              initialSharedVersion,
              mutable: false,
            },
          },
        },
      ],
      commands: [
        {
          $kind: 'MoveCall',
          MoveCall: {
            package: pythPackageId,
            module: 'pyth',
            function: 'get_price_unsafe',
            typeArguments: [],
            arguments: [{ $kind: 'Input', Input: 0 }],
          },
        },
      ],
    },
  });
  return Buffer.from(txKindBytes.toBytes()).toString('base64');
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Reads the Pyth price for a given PriceInfoObject via raw JSON-RPC
 * sui_devInspectTransactionBlock. Returns the decoded PythPrice.
 *
 * First calls sui_getObject to resolve the initial_shared_version, then
 * builds the transaction kind BCS and calls devInspect.
 */
export async function readPriceFromChain(args: {
  pythPackageId: string;
  priceInfoObjectId: string;
  rpcUrl: string;
}): Promise<PythPrice> {
  const { pythPackageId, priceInfoObjectId, rpcUrl } = args;

  // Step 1: resolve initial_shared_version via sui_getObject.
  const getObjResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sui_getObject',
      params: [priceInfoObjectId, { showOwner: true }],
    }),
  });

  const getObjJson = (await getObjResp.json()) as {
    result?: {
      data?: {
        owner?: { Shared?: { initial_shared_version?: string | number } };
      };
    };
  };

  const rawVersion = getObjJson.result?.data?.owner?.Shared?.initial_shared_version;
  const initialSharedVersion = rawVersion !== undefined ? BigInt(rawVersion) : 1n;

  // Step 2: build the transaction kind BCS and call devInspect.
  const txB64 = buildGetPriceUnsafeTxKindB64(pythPackageId, priceInfoObjectId, initialSharedVersion);

  const devInspectResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'sui_devInspectTransactionBlock',
      params: [ZERO_ADDR, txB64, null, null],
    }),
  });

  if (!devInspectResp.ok) {
    throw new Error(`devInspect HTTP error: ${devInspectResp.status}`);
  }

  const devJson = (await devInspectResp.json()) as {
    result?: {
      results?: Array<{ returnValues?: Array<[number[], string]> }>;
      effects?: { status?: { status?: string } };
    };
    error?: { message?: string };
  };

  if (devJson.error) {
    throw new Error(
      `devInspect RPC error: ${devJson.error.message ?? JSON.stringify(devJson.error)}`,
    );
  }

  const returnValues = devJson.result?.results?.[0]?.returnValues;
  if (!returnValues || returnValues.length === 0) {
    throw new Error('devInspect returned no values from get_price_unsafe');
  }

  const [bcsBytes] = returnValues[0];
  return parsePriceFromBcs(bcsBytes);
}
