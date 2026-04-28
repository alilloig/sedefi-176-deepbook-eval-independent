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

// Lazy-init promise pattern (NOT top-level await) — top-level await broke
// vitest's vi.mock module resolution in App.test.tsx. main.tsx awaits this
// promise once before mounting the React tree.
async function buildDAppKit() {
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

  return createDAppKit({
    networks: ["localnet"],
    createClient(network: string) {
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
}

export const dAppKitPromise = buildDAppKit();

// Backward-compat: tests mock `./dapp-kit` and read `dAppKit` directly. In
// production code that imports `dAppKit` for synchronous access, this is
// undefined until the promise resolves; main.tsx is the only consumer and
// it awaits dAppKitPromise before mounting.
export let dAppKit: Awaited<ReturnType<typeof buildDAppKit>> | undefined =
  undefined;
dAppKitPromise.then((kit) => {
  dAppKit = kit;
});
