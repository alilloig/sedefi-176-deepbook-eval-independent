/**
 * DCA vault keeper
 *
 * Polls every registered DcaVault on the sandbox localnet and submits an
 * `execute(vault, pool, clock)` transaction whenever the vault is due.
 *
 * Identity:  a fresh Ed25519 keypair per run, funded from the sandbox faucet.
 * Registry:  apps/03-dca-vault/vaults.json (written by create-vault.sh).
 * Targets:   apps/03-dca-vault/deployment.json (packageId, poolId, clockId).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, "..", "..");

const RPC_URL = process.env.SUI_RPC_URL ?? "http://127.0.0.1:9000";
const FAUCET_URL = process.env.SUI_FAUCET_URL ?? "http://127.0.0.1:9009";
const POLL_MS = Number(process.env.KEEPER_POLL_MS ?? 5_000);

interface Deployment {
    packageId: string;
    poolId: string;
    clockId: string;
}
interface VaultEntry {
    vaultId: string;
    createdAt: number;
}

function readJson<T>(p: string): T {
    return JSON.parse(readFileSync(p, "utf-8")) as T;
}

async function fundFromFaucet(address: string): Promise<void> {
    const res = await fetch(`${FAUCET_URL}/faucet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, token: "SUI" }),
    });
    if (!res.ok) {
        throw new Error(`faucet funding failed: ${res.status} ${await res.text()}`);
    }
}

/**
 * Cheaply reads DcaVault fields by dev-inspecting a tiny PTB that returns
 * sui_balance, deep_balance, and next_exec_ms. Simpler than parsing Move struct
 * bytes from getObject output.
 */
/**
 * Extract the u64 value from a Balance field in JSON-RPC content.
 * Depending on the Sui version, a Balance<T> may be returned as:
 *   - a flat string:  "1000000000"
 *   - a nested object: { fields: { value: "1000000000" } }
 *   - a nested object with type: { type: "…", fields: { value: "1000000000" } }
 */
function balanceValue(field: unknown): bigint {
    if (typeof field === "string" || typeof field === "number") return BigInt(field);
    if (field && typeof field === "object") {
        const obj = field as Record<string, unknown>;
        if ("fields" in obj) {
            const inner = obj.fields as Record<string, unknown>;
            return BigInt(inner.value as string);
        }
        if ("value" in obj) return BigInt(obj.value as string);
    }
    throw new Error(`unexpected Balance field shape: ${JSON.stringify(field)}`);
}

async function readVaultState(
    client: SuiJsonRpcClient,
    pkg: string,
    vaultId: string,
): Promise<{ suiBalance: bigint; deepBalance: bigint; nextExecMs: bigint }> {
    const obj = await client.getObject({ id: vaultId, options: { showContent: true } });
    const content = obj.data?.content;
    if (content?.dataType !== "moveObject") {
        throw new Error(`vault ${vaultId} missing moveObject content`);
    }
    const f = content.fields as Record<string, unknown>;
    const suiBalance = balanceValue(f.sui);
    const deepBalance = balanceValue(f.deep);
    const lastExec = BigInt(f.last_exec_ms as string);
    const interval = BigInt(f.interval_ms as string);
    return { suiBalance, deepBalance, nextExecMs: lastExec + interval };
}

async function tryExecute(
    client: SuiJsonRpcClient,
    keypair: Ed25519Keypair,
    dep: Deployment,
    vaultId: string,
): Promise<string> {
    const tx = new Transaction();
    tx.moveCall({
        target: `${dep.packageId}::dca_vault::execute`,
        arguments: [tx.object(vaultId), tx.object(dep.poolId), tx.object(dep.clockId)],
    });
    const res = await client.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: { showEffects: true },
    });
    return res.digest;
}

async function main() {
    const dep = readJson<Deployment>(join(APP_DIR, "deployment.json"));
    const vaults = readJson<VaultEntry[]>(join(APP_DIR, "vaults.json"));
    if (vaults.length === 0) {
        console.error("vaults.json is empty — create one with contracts/scripts/create-vault.sh");
        process.exit(1);
    }

    const client = new SuiJsonRpcClient({ url: RPC_URL.startsWith("http") ? RPC_URL : getJsonRpcFullnodeUrl("localnet"), network: "custom" });
    const keypair = new Ed25519Keypair();
    const address = keypair.toSuiAddress();

    console.log(`[keeper] address:  ${address}`);
    console.log(`[keeper] rpc:      ${RPC_URL}`);
    console.log(`[keeper] pool:     ${dep.poolId}`);
    console.log(`[keeper] watching: ${vaults.map((v) => v.vaultId).join(", ")}`);

    console.log("[keeper] funding keeper gas from sandbox faucet…");
    await fundFromFaucet(address);
    // Faucet is async — wait a beat.
    await new Promise((r) => setTimeout(r, 2000));

    for (;;) {
        const now = Date.now();
        for (const { vaultId } of vaults) {
            try {
                const state = await readVaultState(client, dep.packageId, vaultId);
                if (state.suiBalance === 0n) {
                    // Nothing left to swap — don't spam the node.
                    continue;
                }
                if (state.nextExecMs > BigInt(now)) {
                    continue;
                }
                console.log(`[keeper] executing ${vaultId} (sui=${state.suiBalance}, deep=${state.deepBalance})`);
                const digest = await tryExecute(client, keypair, dep, vaultId);
                console.log(`[keeper] ✔ digest=${digest}`);
            } catch (e: unknown) {
                const msg = (e as Error).message ?? String(e);
                // EIntervalNotElapsed (abort 1) and EInsufficientSui (abort 3) are
                // expected and harmless — skip silently. Match both the constant
                // names and the numeric abort codes the RPC actually returns.
                if (
                    msg.includes("EIntervalNotElapsed") ||
                    msg.includes("EInsufficientSui") ||
                    msg.includes("abort code: 1") ||
                    msg.includes("abort code: 3")
                ) continue;
                console.warn(`[keeper] ${vaultId} error: ${msg}`);
            }
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
}

main().catch((e) => {
    console.error("[keeper] fatal:", e);
    process.exit(1);
});
