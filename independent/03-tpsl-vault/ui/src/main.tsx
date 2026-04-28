import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DAppKitProvider } from "@mysten/dapp-kit-react";
import { dAppKitPromise } from "./dapp-kit";
import { App } from "./App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
    },
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("No #root element found");

// Await the dev-wallet-equipped dApp kit before mounting the React tree.
// (Lazy-init pattern; top-level await in dapp-kit.ts broke vitest mocks.)
dAppKitPromise.then((dAppKit) => {
  createRoot(rootEl).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <DAppKitProvider dAppKit={dAppKit}>
          <App />
        </DAppKitProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
});
