if (import.meta.env.MODE === 'test') {
  await import("./test-setup");
}

import React, { useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { useDAppKit, useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { useManifest } from "./manifest";

interface Pool {
  poolId: string;
  baseCoinType: string;
  quoteCoinType: string;
  label?: string;
}

interface CreateVaultFormProps {
  refresh: () => void;
}

const SUI_COIN_TYPE = "0x2::sui::SUI";

export function CreateVaultForm({ refresh }: CreateVaultFormProps) {
  const { data: manifest } = useManifest();
  const account = useCurrentAccount();
  const client = useCurrentClient() as {
    getCoins?: (args: {
      owner: string;
      coinType: string;
    }) => Promise<{ data: Array<{ coinObjectId: string; balance: string }> }>;
  };
  const { signAndExecuteTransaction } = useDAppKit();

  const pools: Pool[] = manifest?.pools ?? [];
  const tpslVaultPackageId = manifest?.tpslVaultPackageId ?? "";

  const [selectedPoolIdx, setSelectedPoolIdx] = useState(0);
  const [amount, setAmount] = useState("");
  const [side, setSide] = useState(0);
  const [tpPrice, setTpPrice] = useState("");
  const [slPrice, setSlPrice] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const selectedPool = pools[selectedPoolIdx];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);
    setTxError(null);
    setSuccessMsg(null);

    // Validate: at least one of TP/SL must be set.
    if (!tpPrice.trim() && !slPrice.trim()) {
      setValidationError(
        "At least one of Take-Profit or Stop-Loss price must be set.",
      );
      return;
    }

    // Validate amount.
    const amountNum = parseInt(amount, 10);
    if (!amount.trim() || isNaN(amountNum) || amountNum <= 0) {
      setValidationError("Amount must be a positive integer.");
      return;
    }

    if (!selectedPool) {
      setValidationError("No pool selected.");
      return;
    }

    if (!account) {
      setValidationError("Wallet not connected.");
      return;
    }

    if (!tpslVaultPackageId) {
      setValidationError(
        "VITE_TPSL_VAULT_PACKAGE_ID is not set. Please publish the tpsl_vault package and set the env var.",
      );
      return;
    }

    setSubmitting(true);
    try {
      const tx = new Transaction();

      // Option<u64> encoding via BCS.
      const optionU64 = bcs.option(bcs.u64());
      const tpArg = tpPrice.trim()
        ? tx.pure(optionU64.serialize(BigInt(tpPrice.trim())))
        : tx.pure(optionU64.serialize(null));
      const slArg = slPrice.trim()
        ? tx.pure(optionU64.serialize(BigInt(slPrice.trim())))
        : tx.pure(optionU64.serialize(null));

      let coinArg: ReturnType<typeof tx.object>;

      if (selectedPool.baseCoinType === SUI_COIN_TYPE) {
        // Split from gas for SUI.
        const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountNum)]);
        coinArg = coin;
      } else {
        // Locate a funded Coin<Base> for non-SUI coins.
        const getCoins = client.getCoins;
        if (!getCoins) throw new Error("getCoins not available on client");
        const coinsResult = await getCoins.call(client, {
          owner: account.address,
          coinType: selectedPool.baseCoinType,
        });
        const funded = coinsResult.data.find(
          (c) => BigInt(c.balance) >= BigInt(amountNum),
        );
        if (!funded) {
          throw new Error(
            `No Coin<${selectedPool.baseCoinType}> of size ${amountNum} available — fund from sandbox faucet.`,
          );
        }
        const [coin] = tx.splitCoins(tx.object(funded.coinObjectId), [
          tx.pure.u64(amountNum),
        ]);
        coinArg = coin;
      }

      tx.moveCall({
        target: `${tpslVaultPackageId}::tpsl_vault::create_vault`,
        typeArguments: [selectedPool.baseCoinType],
        arguments: [
          coinArg,
          tx.pure.id(selectedPool.poolId),
          tx.pure.u8(side),
          tpArg,
          slArg,
        ],
      });

      await signAndExecuteTransaction({ transaction: tx });

      // Success: clear inputs, refresh list.
      setAmount("");
      setTpPrice("");
      setSlPrice("");
      setSuccessMsg(
        "Vault created — appears in the list within one polling interval.",
      );
      refresh();
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("rejected")) {
        setTxError("Transaction rejected by wallet — try again.");
      } else {
        setTxError(
          err instanceof Error ? err.message : "Transaction failed.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Create Vault">
      <h2>Create Vault</h2>

      {pools.length > 0 && (
        <div>
          <label htmlFor="pool-select">Pool</label>
          <select
            id="pool-select"
            value={selectedPoolIdx}
            onChange={(e) => setSelectedPoolIdx(Number(e.target.value))}
          >
            {pools.map((pool, i) => (
              <option key={pool.poolId} value={i}>
                {pool.label ??
                  `${pool.baseCoinType.split("::").pop()} / ${pool.quoteCoinType.split("::").pop()}`}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="amount-input">Amount (atomic units)</label>
        <input
          id="amount-input"
          type="number"
          min="1"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="e.g. 1000000"
        />
      </div>

      <div>
        <label htmlFor="side-select">Side</label>
        <select
          id="side-select"
          value={side}
          onChange={(e) => setSide(Number(e.target.value))}
        >
          <option value={0}>Take-profit on rise (0)</option>
          <option value={1}>Stop-loss on fall (1)</option>
        </select>
      </div>

      <div>
        <label htmlFor="tp-input">Take-Profit price (optional)</label>
        <input
          id="tp-input"
          type="number"
          min="0"
          step="1"
          value={tpPrice}
          onChange={(e) => setTpPrice(e.target.value)}
          placeholder="e.g. 2000000000"
        />
      </div>

      <div>
        <label htmlFor="sl-input">Stop-Loss price (optional)</label>
        <input
          id="sl-input"
          type="number"
          min="0"
          step="1"
          value={slPrice}
          onChange={(e) => setSlPrice(e.target.value)}
          placeholder="e.g. 500000000"
        />
      </div>

      {validationError && (
        <p role="alert" style={{ color: "red" }}>
          {validationError}
        </p>
      )}

      {txError && (
        <p role="alert" style={{ color: "red" }}>
          {txError}
        </p>
      )}

      {successMsg && (
        <p role="status" style={{ color: "green" }}>
          {successMsg}
        </p>
      )}

      <button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create Vault"}
      </button>
    </form>
  );
}
