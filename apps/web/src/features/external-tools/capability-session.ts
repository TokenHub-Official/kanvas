import type {
  CapabilityRunDetails,
  UserCapabilitySummary,
} from "@kanvas/contracts/api";
import {
  ApiProblem,
  cancelCapabilityRun,
  createCapabilityRun,
  fetchCapabilityRun,
} from "../../api/transport.js";
import { record, ToolBridgeError, type ToolRequest } from "./bridge.js";
import { supportsBasicTool } from "./catalog.js";
import { fetchUserCapabilities } from "./transport.js";

interface Recovery {
  readonly contractRevisionId: string;
  readonly input: Record<string, unknown>;
  readonly idempotencyKey: string;
  runId?: string;
  uncertain?: boolean;
}

export interface CapabilityToolDependencies {
  list: () => Promise<{ items: UserCapabilitySummary[]; truncated: boolean }>;
  start: (
    body: { contractRevisionId: string; input: Record<string, unknown> },
    key: string,
  ) => Promise<CapabilityRunDetails>;
  status: (id: string) => Promise<CapabilityRunDetails>;
  cancel: (id: string, key: string) => Promise<CapabilityRunDetails>;
  storage?: Pick<Storage, "getItem" | "setItem">;
  storageKey: string;
  recover?: () => Promise<CapabilityRunDetails | undefined>;
  allowed: boolean;
  supports?: (capability: UserCapabilitySummary) => boolean;
  onRun?: (run: CapabilityRunDetails) => void;
}

const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
function readRecovery(deps: CapabilityToolDependencies): Recovery | undefined {
  try {
    const value = record(
      JSON.parse(deps.storage?.getItem(deps.storageKey) ?? "null"),
    );
    if (
      typeof value?.contractRevisionId !== "string" ||
      !ulid.test(value.contractRevisionId) ||
      typeof value.idempotencyKey !== "string" ||
      !/^[a-f0-9-]{36}$/.test(value.idempotencyKey) ||
      (value.uncertain !== undefined && typeof value.uncertain !== "boolean") ||
      !record(value.input) ||
      JSON.stringify(value.input).length > 24_000 ||
      (value.runId !== undefined &&
        (typeof value.runId !== "string" || !ulid.test(value.runId)))
    )
      return undefined;
    const recovered = value as unknown as Recovery;
    if (!recovered.runId && recovered.uncertain === undefined)
      recovered.uncertain = true;
    return recovered;
  } catch {
    return undefined;
  }
}

function resultView(run: CapabilityRunDetails) {
  return {
    status: run.lifecycleStatus,
    output: run.output ?? null,
    cancelRequested: Boolean(run.cancelRequestedAt),
    browserRequired: Boolean(run.browserExecution),
    failed: Boolean(run.error),
  };
}

export function createCapabilityToolSession(deps: CapabilityToolDependencies) {
  const supports = deps.supports ?? supportsBasicTool;
  let recovery = readRecovery(deps);
  let busy = false;
  let recoveryChecked = false;
  const present = (run: CapabilityRunDetails) => {
    deps.onRun?.(run);
    return resultView(run);
  };
  const save = (): void => {
    try {
      deps.storage?.setItem(deps.storageKey, JSON.stringify(recovery ?? null));
    } catch {
      /* The mounted session still retains its receipt. */
    }
  };
  return async (request: ToolRequest): Promise<unknown> => {
    if (!deps.allowed) throw new ToolBridgeError("permission_denied");
    if (busy) throw new ToolBridgeError("busy");
    busy = true;
    try {
      if (!recovery && !recoveryChecked && deps.recover) {
        const restored = await deps.recover();
        recoveryChecked = true;
        if (restored) {
          recovery = {
            contractRevisionId: restored.contractRevisionId,
            input: record(restored.input) ?? {},
            idempotencyKey: crypto.randomUUID(),
            runId: restored.id,
            uncertain: false,
          };
          save();
          present(restored);
        }
      }
      if (request.method === "capabilities.list") {
        const catalog = await deps.list();
        return {
          items: catalog.items.filter(supports).map((item) => ({
            id: item.contractRevisionId,
            title: item.displayName,
            schema: item.inputSchema,
            labels: Object.fromEntries(
              item.parameters.map((parameter) => [
                parameter.key,
                parameter.label,
              ]),
            ),
          })),
          truncated: catalog.truncated,
          recovery: recovery
            ? {
                input: recovery.input,
                capabilityId: recovery.contractRevisionId,
                pending: !recovery.runId,
              }
            : null,
        };
      }
      if (request.method === "run.status") {
        if (!recovery?.runId) throw new ToolBridgeError("no_run");
        return present(await deps.status(recovery.runId));
      }
      if (request.method === "run.cancel") {
        if (!recovery?.runId) throw new ToolBridgeError("no_run");
        return present(
          await deps.cancel(
            recovery.runId,
            recovery.idempotencyKey + "-cancel",
          ),
        );
      }
      const { capabilityId, input } = request.params;
      if (
        typeof capabilityId !== "string" ||
        !record(input) ||
        JSON.stringify(input).length > 24_000
      )
        throw new ToolBridgeError("invalid_input");
      if (recovery) {
        if (!recovery.runId) {
          if (
            recovery.contractRevisionId !== capabilityId ||
            JSON.stringify(recovery.input) !== JSON.stringify(input)
          )
            throw new ToolBridgeError("previous_pending");
        } else {
          const previous = await deps.status(recovery.runId);
          if (
            previous.lifecycleStatus === "queued" ||
            previous.lifecycleStatus === "running"
          )
            throw new ToolBridgeError("run_active");
          recovery = undefined;
        }
      }
      // Re-read current availability at every invocation, not just on initial display.
      const catalog = await deps.list();
      const capability = catalog.items.find(
        (item) => item.contractRevisionId === capabilityId && supports(item),
      );
      if (!capability) throw new ToolBridgeError("unavailable");
      recovery ??= {
        contractRevisionId: capabilityId,
        input: record(input)!,
        idempotencyKey: crypto.randomUUID(),
      };
      const hadUncertainSubmission = recovery.uncertain === true;
      recovery.uncertain = true;
      save();
      try {
        const run = await deps.start(
          {
            contractRevisionId: recovery.contractRevisionId,
            input: recovery.input,
          },
          recovery.idempotencyKey,
        );
        recovery.runId = run.id;
        recovery.uncertain = false;
        save();
        return present(run);
      } catch (error) {
        // A later rejection cannot prove an earlier lost submission never committed.
        if (
          !hadUncertainSubmission &&
          error instanceof ApiProblem &&
          [400, 401, 403, 404, 422].includes(error.status)
        ) {
          recovery = undefined;
          save();
          throw new ToolBridgeError("rejected");
        }
        throw new ToolBridgeError("submission_unknown");
      }
    } finally {
      busy = false;
    }
  };
}

export function workspaceCapabilityToolSession(options: {
  workspaceId: string;
  csrfToken: string;
  principalId: string;
  locale: string;
  allowed: boolean;
  supports?: (capability: UserCapabilitySummary) => boolean;
  onRun?: (run: CapabilityRunDetails) => void;
}) {
  let storage: Storage | undefined;
  try {
    storage = window.sessionStorage;
  } catch {
    /* In-memory recovery is still available. */
  }
  return createCapabilityToolSession({
    allowed: options.allowed,
    ...(options.onRun ? { onRun: options.onRun } : {}),
    list: () => fetchUserCapabilities(options.workspaceId, options.locale),
    start: (body, key) => createCapabilityRun(options, body, key),
    status: (id) => fetchCapabilityRun(options.workspaceId, id),
    cancel: (id, key) => cancelCapabilityRun(options, id, key),
    ...(storage ? { storage } : {}),
    storageKey: `kanvas:external-tool:basic-capability:v1:${options.principalId}:${options.workspaceId}`,
  });
}
