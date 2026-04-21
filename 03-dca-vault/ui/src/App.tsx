/**
 * DCA Vault viewer — read-only dashboard of every registered vault.
 *
 * Deployment + vault list are baked into the bundle at build time via
 * vite.config.ts's define(). In a real app these would come from env vars
 * or a server.
 */
import { useEffect, useMemo, useState } from "react";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

declare const __DEPLOYMENT__: { packageId: string; poolId: string; clockId: string } | null;
declare const __VAULTS__: Array<{ vaultId: string; createdAt: number }>;

interface VaultState {
    id: string;
    owner: string;
    suiBalance: bigint;
    deepBalance: bigint;
    intervalMs: bigint;
    lastExecMs: bigint;
    amountPerExec: bigint;
    totalExecutions: bigint;
    totalDeepBought: bigint;
}

/**
 * Extract the u64 value from a Balance field in JSON-RPC content.
 * Depending on the Sui version, a Balance<T> may be returned as:
 *   - a flat string:  "1000000000"
 *   - a nested object: { fields: { value: "1000000000" } }
 */
function balanceValue(field: unknown): bigint {
    if (typeof field === "string" || typeof field === "number") return BigInt(field);
    if (field && typeof field === "object") {
        const obj = field as Record<string, unknown>;
        if ("fields" in obj) return BigInt((obj.fields as Record<string, unknown>).value as string);
        if ("value" in obj) return BigInt(obj.value as string);
    }
    throw new Error(`unexpected Balance field shape: ${JSON.stringify(field)}`);
}

function fmtAmount(raw: bigint, decimals: number, unit: string) {
    const s = raw.toString().padStart(decimals + 1, "0");
    const head = s.slice(0, -decimals);
    const tail = s.slice(-decimals).replace(/0+$/, "");
    return `${head}${tail ? `.${tail}` : ""} ${unit}`;
}

export function App() {
    const [states, setStates] = useState<Record<string, VaultState | { error: string }>>({});
    const client = useMemo(() => new SuiJsonRpcClient({ url: "http://127.0.0.1:9000", network: "custom" }), []);
    const dep = __DEPLOYMENT__;

    useEffect(() => {
        let cancelled = false;
        async function poll() {
            for (const { vaultId } of __VAULTS__) {
                try {
                    const obj = await client.getObject({ id: vaultId, options: { showContent: true } });
                    if (obj.data?.content?.dataType !== "moveObject") {
                        throw new Error("not a moveObject");
                    }
                    const f = obj.data.content.fields as Record<string, any>;
                    const s: VaultState = {
                        id: vaultId,
                        owner: f.owner,
                        suiBalance: balanceValue(f.sui),
                        deepBalance: balanceValue(f.deep),
                        intervalMs: BigInt(f.interval_ms),
                        lastExecMs: BigInt(f.last_exec_ms),
                        amountPerExec: BigInt(f.amount_per_exec),
                        totalExecutions: BigInt(f.total_executions),
                        totalDeepBought: BigInt(f.total_deep_bought),
                    };
                    if (!cancelled) setStates((st) => ({ ...st, [vaultId]: s }));
                } catch (e: unknown) {
                    if (!cancelled) setStates((st) => ({ ...st, [vaultId]: { error: (e as Error).message } }));
                }
            }
        }
        poll();
        const id = setInterval(poll, 3000);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [client]);

    if (!dep || __VAULTS__.length === 0) {
        return (
            <div style={{ maxWidth: 720, margin: "3rem auto", padding: "0 1rem" }}>
                <h1 style={{ fontSize: 20 }}>DCA Vault Viewer</h1>
                <p style={{ color: "#8b94a7" }}>
                    No vaults registered. Run <code>contracts/scripts/deploy.sh</code> then{" "}
                    <code>contracts/scripts/create-vault.sh</code>, then restart <code>pnpm dev</code>.
                </p>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 720, margin: "3rem auto", padding: "0 1rem" }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>DCA Vaults</h1>
            <p style={{ color: "#8b94a7", marginTop: 4 }}>
                Package: <code>{dep.packageId.slice(0, 10)}…</code> · Pool: <code>{dep.poolId.slice(0, 10)}…</code>
            </p>

            {__VAULTS__.map(({ vaultId }) => {
                const v = states[vaultId];
                return (
                    <div
                        key={vaultId}
                        style={{
                            marginTop: 16,
                            padding: 14,
                            border: "1px solid #2a3242",
                            borderRadius: 6,
                            background: "#111522",
                        }}
                    >
                        <div style={{ color: "#a9b3c5", fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                            {vaultId}
                        </div>
                        {!v && <div style={{ color: "#8b94a7", marginTop: 6 }}>loading…</div>}
                        {v && "error" in v && <div style={{ color: "#e08585", marginTop: 6 }}>error: {v.error}</div>}
                        {v && "suiBalance" in v && (
                            <>
                                <Row label="Owner" value={`${v.owner.slice(0, 10)}…`} />
                                <Row label="SUI balance" value={fmtAmount(v.suiBalance, 9, "SUI")} />
                                <Row label="DEEP accumulated" value={fmtAmount(v.deepBalance, 6, "DEEP")} />
                                <Row label="Slice size" value={fmtAmount(v.amountPerExec, 9, "SUI")} />
                                <Row label="Interval" value={`${Number(v.intervalMs) / 1000} s`} />
                                <Row label="Executions" value={v.totalExecutions.toString()} />
                                <Row
                                    label="Next execution"
                                    value={
                                        v.lastExecMs === 0n
                                            ? "immediately (never executed)"
                                            : new Date(Number(v.lastExecMs + v.intervalMs)).toLocaleTimeString()
                                    }
                                />
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span style={{ color: "#8b94a7" }}>{label}</span>
            <span style={{ fontFamily: "ui-monospace, monospace", color: "#f5f7fa" }}>{value}</span>
        </div>
    );
}
