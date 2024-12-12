import { describe, test, expect } from "vitest";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { getTransactionStatus } from "../lib/getTransactionStatus";

const getLatestTransaction = async (publicKeyString): Promise<string> => {
  const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
  const publicKey = new PublicKey(publicKeyString);
  const confirmedSignatures = await connection.getSignaturesForAddress(
    publicKey,
    { limit: 1 },
  );

  if (confirmedSignatures.length === 0) {
    throw new Error("No transactions found for the provided public key.");
  }

  const latestSignature = confirmedSignatures[0].signature;
  return latestSignature;
};

describe("test get transaction status", () => {
  test("should get confirmed status", async () => {
    const address = "B6h248NJkAcBAkaCnji889a26tCiGXGN8cxhEJ4dX391";
    const key = new PublicKey(address);
    const status = await getTransactionStatus(await getLatestTransaction(key));
    expect(status).toBe("finalized");
  });
});
