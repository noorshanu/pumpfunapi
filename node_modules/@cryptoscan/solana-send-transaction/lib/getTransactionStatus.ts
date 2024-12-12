import { createConnection } from "./createConnection.js";
import { SendCommitment } from "./types/SendCommitment.js";

interface Status {
  value?: {
    confirmationStatus?: SendCommitment;
    status?: {
      Ok?: boolean;
    };
  };
  Err?: Record<string, unknown>;
}

export const getTransactionStatus = async (
  tx: string,
  connection = createConnection(),
): Promise<SendCommitment | void> => {
  const status = (await connection.getSignatureStatus(tx)) as unknown as Status;

  if ("Err" in status && status.Err) {
    throw new Error(
      "Transaction confirmed and failed with errors: " +
        Object.keys(status.Err).join(", "),
    );
  }
  if (!status?.value) {
    return;
  }
  if ("confirmationStatus" in status.value) {
    return status.value.confirmationStatus;
  }
  if ("status" in status.value) {
    return status?.value?.status?.Ok ? "confirmed" : "processed";
  }
};
