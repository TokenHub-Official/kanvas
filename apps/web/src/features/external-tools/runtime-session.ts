import { ApiProblem } from "../../api/transport.js";
import type { ToolSession, CapabilityRunDetails } from "@kanvas/contracts/api";
import { createCapabilityToolSession } from "./capability-session.js";
import { record, ToolBridgeError } from "./bridge.js";
import type { ToolRuntimeApi } from "./tool-api.js";

interface Receipt {
  revisionId: string;
  requestKey: string;
  sessionId?: string;
  rejected?: boolean;
}
const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export interface RuntimeSessionOptions {
  api: ToolRuntimeApi;
  principalId: string;
  scopeKey: string;
  toolId: string;
  revisionId: string;
  storage?: Pick<Storage, "getItem" | "setItem">;
}
/** Retains an uncertain creation receipt before making the request. Never opens a replacement implicitly. */
export function createRuntimeSessionRecovery(options: RuntimeSessionOptions) {
  const storageKey = `kanvas:tool-session:v1:${options.principalId}:${options.scopeKey}:${options.toolId}`;
  let receipt: Receipt | undefined;
  try {
    const value = record(
      JSON.parse(options.storage?.getItem(storageKey) ?? "null"),
    );
    if (
      typeof value?.revisionId === "string" &&
      idPattern.test(value.revisionId) &&
      typeof value.requestKey === "string" &&
      /^[a-f0-9-]{36}$/.test(value.requestKey) &&
      (value.rejected === undefined || typeof value.rejected === "boolean") &&
      (value.sessionId === undefined ||
        (typeof value.sessionId === "string" &&
          idPattern.test(value.sessionId)))
    )
      receipt = value as unknown as Receipt;
  } catch {
    /* A damaged receipt cannot authorize a session. */
  }
  let opening: Promise<ToolSession> | undefined;
  function save() {
    try {
      options.storage?.setItem(storageKey, JSON.stringify(receipt ?? null));
    } catch {
      /* Keep the mounted receipt even when storage is unavailable. */
    }
  }
  async function open(): Promise<ToolSession> {
    if (opening) return opening;
    if (receipt?.rejected)
      throw new ToolBridgeError("session_creation_rejected");
    receipt ??= {
      revisionId: options.revisionId,
      requestKey: crypto.randomUUID(),
    };
    save();
    const current = receipt;
    opening = (async () => {
      let session: ToolSession;
      try {
        session = current.sessionId
          ? await options.api.get(current.sessionId)
          : await options.api.create(
              options.toolId,
              current.revisionId,
              current.requestKey,
            );
      } catch (error) {
        if (
          !current.sessionId &&
          error instanceof ApiProblem &&
          [400, 401, 403, 404, 409, 422].includes(error.status)
        ) {
          current.rejected = true;
          save();
        }
        throw error;
      }
      if (
        session.toolId !== options.toolId ||
        session.revisionId !== current.revisionId
      )
        throw new ToolBridgeError("session_mismatch");
      current.sessionId = session.id;
      save();
      return session;
    })();
    try {
      return await opening;
    } finally {
      opening = undefined;
    }
  }
  async function closeKnown(): Promise<void> {
    if (opening) await opening;
    if (receipt?.sessionId) {
      try {
        await options.api.close(receipt.sessionId);
      } catch (error) {
        if (!(error instanceof ApiProblem && error.status === 404)) throw error;
      }
    } else if (receipt && !receipt.rejected)
      throw new ToolBridgeError("session_creation_unknown");
    receipt = undefined;
    save();
  }
  let displayOpening: Promise<ToolSession> | undefined;
  async function openForDisplay(): Promise<ToolSession> {
    if (displayOpening) return displayOpening;
    displayOpening = (async () => {
      const current = await open();
      // Only a confirmed, task-free standalone runtime can be replaced automatically.
      // Capability receipts and uncertain submissions retain their original identity.
      if (
        !current.available &&
        current.maximumRuns === 0 &&
        current.runIds.length === 0
      ) {
        await closeKnown();
        return open();
      }
      return current;
    })();
    try {
      return await displayOpening;
    } finally {
      displayOpening = undefined;
    }
  }
  return {
    open,
    openForDisplay,
    /** Call only for an explicit reopen action after displaying the previous session/recovery state. */
    async reopen(): Promise<ToolSession> {
      await closeKnown();
      return open();
    },
    close: closeKnown,
  };
}

export function createUploadedToolBridge(options: {
  api: ToolRuntimeApi;
  session: ToolSession;
  principalId: string;
  scopeKey: string;
  storage?: Pick<Storage, "getItem" | "setItem">;
  onRun?: (run: CapabilityRunDetails) => void;
}) {
  const id = options.session.id;
  return createCapabilityToolSession({
    allowed: options.session.kind === "use" && options.session.available,
    supports: (capability) =>
      options.session.allowedContractRevisionIds.includes(
        capability.contractRevisionId,
      ),
    list: () => options.api.list(id),
    recover: async () => {
      const runId = options.session.runIds.at(-1);
      return runId ? options.api.status(id, runId) : undefined;
    },
    start: (body, key) => options.api.start(id, body, key),
    status: (runId) => options.api.status(id, runId),
    cancel: (runId) => options.api.cancel(id, runId),
    storageKey: `kanvas:tool-run:v1:${options.principalId}:${options.scopeKey}:${id}`,
    ...(options.storage ? { storage: options.storage } : {}),
    ...(options.onRun ? { onRun: options.onRun } : {}),
  });
}
