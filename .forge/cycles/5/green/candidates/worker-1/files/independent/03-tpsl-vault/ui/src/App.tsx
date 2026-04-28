// Register @testing-library/jest-dom matchers in test environment only.
// import.meta.env.MODE is 'test' in vitest and 'production' in Vite builds,
// so Rollup statically eliminates the block during production bundling.
if (import.meta.env.MODE === 'test') {
  await import("./test-setup");
}

import React, { useState, useEffect, useCallback } from "react";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react";
import { useManifest } from "./manifest";
import { useVaultList, VaultEntry } from "./useVaultList";
import { CreateVaultForm } from "./CreateVaultForm";
import { VaultRow, TriggerEvent } from "./VaultRow";

export function App() {
  const account = useCurrentAccount();
  const { data: manifest, isLoading: manifestLoading, error: manifestError } = useManifest();
  const client = useCurrentClient() as {
    queryEvents?: (args: { query: Record<string, unknown>; limit?: number }) => Promise<{
      data: Array<{
        parsedJson: {
          vault_id: string;
          owner: string;
          quote_out_amount: string;
          base_residual_amount: string;
          deep_residual_amount: string;
        };
      }>;
    }>;
  };

  const { vaults, refresh } = useVaultList();

  // Fetch TriggerFired events for triggered vaults.
  const [triggerEvents, setTriggerEvents] = useState<Map<string, TriggerEvent>>(new Map());

  const fetchTriggerEvents = useCallback(async () => {
    if (!manifest?.tpslVaultPackageId || !client.queryEvents) return;
    const triggeredVaults = vaults.filter((v) => v.triggered);
    if (triggeredVaults.length === 0) return;

    try {
      const result = await client.queryEvents({
        query: {
          MoveEventType: `${manifest.tpslVaultPackageId}::tpsl_vault::TriggerFired`,
        },
        limit: 1000,
      });

      const newMap = new Map<string, TriggerEvent>();
      for (const event of result.data) {
        const pj = event.parsedJson;
        newMap.set(pj.vault_id, {
          vaultId: pj.vault_id,
          quoteOutAmount: String(pj.quote_out_amount),
          baseResidualAmount: String(pj.base_residual_amount),
          deepResidualAmount: String(pj.deep_residual_amount),
        });
      }
      setTriggerEvents(newMap);
    } catch {
      // Non-blocking — triggered badge renders with "…" placeholder.
    }
  }, [manifest?.tpslVaultPackageId, vaults, client]);

  useEffect(() => {
    void fetchTriggerEvents();
  }, [fetchTriggerEvents]);

  // Missing env var warning.
  const tpslVaultPackageId = manifest?.tpslVaultPackageId;
  const missingPackageId = manifest && !tpslVaultPackageId;

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 900, margin: "0 auto", padding: 16 }}>
      <h1>TPSL Vault</h1>

      {manifestError && (
        <div role="alert" style={{ color: "red", marginBottom: 16 }}>
          <strong>Manifest error:</strong>{" "}
          {manifestError instanceof Error
            ? manifestError.message
            : String(manifestError)}
          <br />
          Run <code>pnpm deploy-all</code> from the deepbook-sandbox repo.
        </div>
      )}

      {missingPackageId && (
        <div role="alert" style={{ color: "orange", marginBottom: 16 }}>
          <strong>VITE_TPSL_VAULT_PACKAGE_ID is not set.</strong> Publish the
          tpsl_vault Move package and set this env var in{" "}
          <code>independent/03-tpsl-vault/ui/.env.local</code>.
          <br />
          Command: <code>sui client publish independent/03-tpsl-vault/move/</code>
        </div>
      )}

      {!account ? (
        <div>
          <p>Connect your wallet to view and manage your vaults.</p>
          <ConnectButton />
        </div>
      ) : (
        <div>
          <p style={{ fontSize: 12, color: "#666" }}>
            Connected: {account.address}
          </p>

          {manifestLoading ? (
            <p>Loading manifest…</p>
          ) : manifest ? (
            <>
              <CreateVaultForm refresh={refresh} />

              <h2>Your Vaults</h2>
              {vaults.length === 0 ? (
                <p>No active vaults.</p>
              ) : (
                <div>
                  {vaults.map((vault: VaultEntry) => (
                    <VaultRow
                      key={vault.vaultId}
                      vault={vault}
                      refresh={refresh}
                      triggerEvent={triggerEvents.get(vault.vaultId)}
                    />
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
