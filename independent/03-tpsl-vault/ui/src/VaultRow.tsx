if (import.meta.env.MODE === 'test') {
  await import("./test-setup");
}

import React, { useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { useManifest } from "./manifest";

export interface VaultEntry {
  vaultId: string;
  owner: string;
  poolId: string;
  side: number;
  tpPrice: string | null;
  slPrice: string | null;
  depositAmount: string;
  balance: string;
  triggered: boolean;
  baseCoinType: string;
}

export interface TriggerEvent {
  vaultId: string;
  quoteOutAmount: string;
  baseResidualAmount: string;
  deepResidualAmount: string;
}

interface VaultRowProps {
  vault: VaultEntry;
  refresh: () => void;
  triggerEvent?: TriggerEvent;
}

export function VaultRow({ vault, refresh, triggerEvent }: VaultRowProps) {
  const { data: manifest } = useManifest();
  const { signAndExecuteTransaction } = useDAppKit();
  const tpslVaultPackageId = manifest?.tpslVaultPackageId ?? "";

  const [rowError, setRowError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  async function handleWithdraw() {
    setRowError(null);
    setWithdrawing(true);
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${tpslVaultPackageId}::tpsl_vault::withdraw`,
        typeArguments: [vault.baseCoinType],
        arguments: [tx.object(vault.vaultId)],
      });
      await signAndExecuteTransaction({ transaction: tx });
      refresh();
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("rejected")) {
        setRowError("Transaction rejected by wallet.");
      } else if (
        err instanceof Error &&
        (err.message.includes("1001") || err.message.includes("ENotOwner"))
      ) {
        setRowError("Cannot withdraw — you are not the vault owner.");
      } else if (
        err instanceof Error &&
        (err.message.includes("1002") || err.message.includes("EVaultTriggered"))
      ) {
        setRowError(
          "Cannot withdraw — vault was triggered before your withdraw landed.",
        );
      } else {
        setRowError(err instanceof Error ? err.message : "Withdraw failed.");
      }
    } finally {
      setWithdrawing(false);
    }
  }

  const truncate = (id: string) =>
    id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;

  return (
    <div style={{ border: "1px solid #ccc", padding: 8, marginBottom: 4 }}>
      <span title={vault.vaultId} style={{ marginRight: 8 }}>
        {truncate(vault.vaultId)}
      </span>
      <span style={{ marginRight: 8 }}>Pool: {truncate(vault.poolId)}</span>
      <span style={{ marginRight: 8 }}>
        Side: {vault.side === 0 ? "TP-rise" : "SL-fall"}
      </span>
      <span style={{ marginRight: 8 }}>TP: {vault.tpPrice ?? "—"}</span>
      <span style={{ marginRight: 8 }}>SL: {vault.slPrice ?? "—"}</span>
      <span style={{ marginRight: 8 }}>Balance: {vault.balance}</span>
      <span>
        {vault.triggered ? (
          <>
            <span
              style={{
                background: "orange",
                color: "black",
                padding: "2px 6px",
                borderRadius: 4,
                fontWeight: "bold",
              }}
            >
              Triggered
            </span>
            {triggerEvent ? (
              <span> — output: {triggerEvent.quoteOutAmount}</span>
            ) : (
              <span> — output: …</span>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void handleWithdraw()}
              disabled={withdrawing}
            >
              {withdrawing ? "Withdrawing…" : "Withdraw"}
            </button>
            {rowError && (
              <span role="alert" style={{ color: "red", marginLeft: 8 }}>
                {rowError}
              </span>
            )}
          </>
        )}
      </span>
    </div>
  );
}
