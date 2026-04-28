import { createDAppKit } from "@mysten/dapp-kit-react";
import { devWalletInitializer } from "@mysten-incubation/dev-wallet";
import { InMemorySignerAdapter } from "@mysten-incubation/dev-wallet/adapters";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

// Injected at build time by Vite from .env.local (VITE_DEV_WALLET_PRIVATE_KEY).
const PRIVATE_KEY = import.meta.env.VITE_DEV_WALLET_PRIVATE_KEY ?? "";

// The rpcUrl is read at runtime from /localnet.json. For the dapp-kit client
// constructor we fall back to localhost:9000 (sandbox default). In production
// the manifest-derived URL is used when issuing queries via useCurrentClient().
const RPC_URL = import.meta.env.VITE_RPC_URL ?? "http://localhost:9000";

const adapter = new InMemorySignerAdapter();

await adapter.initialize();

if (!PRIVATE_KEY) {
  console.warn(
    "[DevWallet] VITE_DEV_WALLET_PRIVATE_KEY missing — set it in .env.local " +
      "(sourced from sandbox/.env after `pnpm deploy-all`). Dev wallet will " +
      "start with no accounts.",
  );
} else {
  const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  await adapter.importAccount({ signer: keypair, label: "Deployer" });
}

export const dAppKit = createDAppKit({
  networks: ["localnet"],
  createClient(network) {
    return new SuiGrpcClient({ network, baseUrl: RPC_URL });
  },
  slushWalletConfig: null,
  walletInitializers: [
    devWalletInitializer({
      adapters: [adapter],
      autoConnect: true,
      autoApprove: false,
      mountUI: true,
    }),
  ],
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
