import { Connection } from "@solana/web3.js";
import type {
  ConnectionConfig,
  Connection as SolanaConnection,
} from "@solana/web3.js";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.fetch = fetch as any;

export const createConnection = (
  url?: string,
  getProxy?: () => string,
  parameters: Partial<ConnectionConfig> = {},
): SolanaConnection => {
  return new Connection(url || "https://api.mainnet-beta.solana.com", {
    disableRetryOnRateLimit: true,
    wsEndpoint: "wss://api.mainnet-beta.solana.com/",
    fetch: getProxy
      ? async (input, options): Promise<Response> => {
          const processedInput =
            typeof input === "string" && input.slice(0, 2) === "//"
              ? "https:" + input
              : input;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (global.fetch as any)(processedInput, {
            ...options,
            agent: getProxy ? new HttpsProxyAgent(getProxy()) : undefined,
          });
        }
      : undefined,
    ...parameters,
  });
};
