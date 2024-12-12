import { describe, it, expect, vi } from "vitest";
import { createConnection } from "../lib/createConnection";
import { Connection } from "@solana/web3.js";
import type { Commitment } from "@solana/web3.js";

// Mock fetch for proxy testing
global.fetch = vi.fn(
  () => Promise.resolve({ json: () => Promise.resolve({}) }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) as any;

describe("createConnection", () => {
  it("should create a connection with default parameters", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connection: any = createConnection();
    expect(connection).toBeInstanceOf(Connection);
    expect(connection._rpcEndpoint).toBe("https://api.mainnet-beta.solana.com");
    expect(connection._rpcWsEndpoint).toBe(
      "wss://api.mainnet-beta.solana.com/",
    );
  });

  it("should create a connection with a custom URL", () => {
    const customUrl = "https://custom.rpc.endpoint";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connection: any = createConnection(customUrl);
    expect(connection).toBeInstanceOf(Connection);
    expect(connection._rpcEndpoint).toBe(customUrl);
  });

  it("should create a connection with a custom proxy", async () => {
    const customProxy = "https://custom.proxy/";
    const getProxy = () => customProxy;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connection: any = createConnection(undefined, getProxy);

    // Ensure fetch is called with the proxy
    await connection._rpcRequest("getVersion", []).catch(() => {});
    expect(global.fetch).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchCallArguments = (global.fetch as any).mock.calls[0];
    expect(fetchCallArguments[1].agent.proxy.toString()).toBe(customProxy);
  });

  it("should create a connection with additional connection config parameters", () => {
    const parameters = {
      commitment: "processed" as Commitment,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connection: any = createConnection(undefined, undefined, parameters);
    expect(connection._commitment).toEqual(parameters.commitment);
  });
});
