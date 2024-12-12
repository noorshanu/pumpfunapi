import {
  Connection,
  SendOptions,
  VersionedTransaction,
  Transaction,
} from "@solana/web3.js";
import { createConnection } from "./createConnection.js";
import { getTransactionStatus } from "./getTransactionStatus.js";
import { SendCommitment } from "./types/SendCommitment.js";
import pRetry from "p-retry";

export interface SendSolanaTransactionParameters {
  commitment?: SendCommitment;
  connection?: Connection;
  repeatTimeout?: number;
  maxRetries?: number;
  blockHeightLimit?: number;
  sendOptions?: SendOptions;
  checkBlockHeight?: boolean;
  speed?: "slow" | "fast";
}

const commitments = ["processed", "confirmed", "finalized"];

const getIsTransaction = (
  transaction: VersionedTransaction | Transaction | Uint8Array | string,
): transaction is VersionedTransaction =>
  typeof transaction === "object" &&
  typeof (transaction as VersionedTransaction).serialize === "function";

const getIsTxn = (
  transaction: VersionedTransaction | Transaction | Uint8Array | string,
): transaction is string => typeof transaction === "string";

export default async function sendTransaction(
  transaction: VersionedTransaction | Transaction | Uint8Array | string,
  _parameters?: SendSolanaTransactionParameters,
  _retry = 0,
): Promise<string> {
  let parameters: SendSolanaTransactionParameters = {};

  if (_parameters) {
    parameters = _parameters;
  }

  const {
    connection = createConnection(),
    repeatTimeout = 2000,
    blockHeightLimit = 150,
    maxRetries = 10,
    commitment = "processed",
    speed = "fast",
    checkBlockHeight = true,
  } = parameters;

  if (getIsTransaction(transaction)) {
    transaction = transaction.serialize();
  }
  if (getIsTxn(transaction)) {
    transaction = Buffer.from(transaction, "base64");
  }

  let tx = "";
  let lastValidBlockHeight: number | undefined;

  const getBlockhash = async () =>
    pRetry(
      () => {
        return connection.getLatestBlockhashAndContext().then((blockhash) => {
          if (
            !blockhash ||
            !blockhash?.value?.blockhash ||
            ("err" in blockhash && blockhash.err) ||
            ("value" in blockhash &&
              "err" in blockhash.value &&
              blockhash.value.err)
          ) {
            throw new Error("Blockhash not found");
          }
          lastValidBlockHeight =
            blockhash.value.lastValidBlockHeight - blockHeightLimit;
        });
      },
      {
        retries: 2,
        onFailedAttempt: () => console.log("Get blockhash failed, retrying..."),
      },
    );

  void getBlockhash();

  const send = () => {
    return connection.sendRawTransaction(transaction as Uint8Array, {
      skipPreflight: true,
      ...parameters?.sendOptions,
      preflightCommitment: undefined,
      maxRetries: 0,
    });
  };

  try {
    tx = await send();

    const commitmentIndex = commitments.indexOf(commitment);

    if (commitment) {
      let times = 0;
      let isReady = false;

      while (!isReady) {
        times += 1;
        if (_retry > maxRetries) {
          throw new Error("Max retries exceeded");
        }
        if (times > 10) {
          throw new Error("Transaction expired");
        }
        const status = await getTransactionStatus(tx, connection);

        isReady = status
          ? commitments.indexOf(status) >= commitmentIndex
          : false;
        if (isReady) {
          break;
        } else {
          if (speed === "slow") {
            await new Promise((resolve) => setTimeout(resolve, repeatTimeout));
          }
          await send();
          await new Promise((resolve) => setTimeout(resolve, repeatTimeout));
          _retry += 1;
        }

        if (checkBlockHeight) {
          const blockHeight = await connection.getBlockHeight();

          if (!lastValidBlockHeight) {
            lastValidBlockHeight = blockHeight;
          }

          if (blockHeight > lastValidBlockHeight) {
            throw new Error("Transaction block expired");
          }
        }
      }
    }
  } catch (error_: unknown) {
    const error = error_ as Error;
    if (error.message.includes("429") && _retry < maxRetries) {
      console.log("Retrying 429...", error.message);
      await new Promise((resolve) => setTimeout(resolve, repeatTimeout));
      return sendTransaction(transaction, parameters, _retry + 1);
    }

    throw error;
  }

  return tx;
}

export { createConnection } from "./createConnection.js";
