import { createHash } from "node:crypto";

import { DomainError } from "@kanvas/application";
import type {
  CanonicalDigest,
  CancelWorkflowRunDependencies,
  CreateWorkflowRunDependencies,
  JsonSchemaInputValidator,
  WorkflowApprovalDecisionPort,
  WorkflowPublicationPort,
} from "@kanvas/application";
import { registerKanvasJsonSchemaKeywords } from "@kanvas/contracts/api";
import { BoundedWorkflowRuntimeError } from "@kanvas/database/runtime";
import type {
  PublicationGovernanceStore,
  BoundedWorkflowOrchestratorStore,
  WorkflowExecutionPersistence,
} from "@kanvas/database/runtime";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { monotonicFactory } from "ulid";

function compareCanonicalText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function canonicalize(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical JSON cannot contain a non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareCanonicalText(left, right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  throw new Error(`Unsupported canonical JSON value: ${typeof value}`);
}

export const canonicalDigest: CanonicalDigest = Object.freeze<CanonicalDigest>({
  of(value) {
    return `sha256:${createHash("sha256")
      .update(canonicalize(value))
      .digest("hex")}`;
  },
});

export function createJsonSchemaInputValidator(): JsonSchemaInputValidator {
  const ajv = new Ajv2020({
    strict: true,
    strictRequired: false,
    strictTypes: false,
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
  });
  const registerFormats = addFormats as unknown as (
    instance: Ajv2020,
  ) => unknown;
  registerFormats(ajv);
  registerKanvasJsonSchemaKeywords(ajv);
  const cache = new Map<string, ValidateFunction>();

  return Object.freeze<JsonSchemaInputValidator>({
    validate(schema, value) {
      const cacheKey = canonicalDigest.of(schema);
      let validator = cache.get(cacheKey);
      if (!validator) {
        validator = ajv.compile(schema);
        cache.set(cacheKey, validator);
      }
      if (validator(value)) {
        return [];
      }
      return (validator.errors ?? []).map(
        (error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`,
      );
    },
  });
}

export function createWorkflowExecutionDependencies(
  persistence: WorkflowExecutionPersistence,
  cancellationGraceMs: number,
): Omit<CreateWorkflowRunDependencies, "clock" | "runtimeStateReader"> &
  Pick<CancelWorkflowRunDependencies, "cancellations" | "cancellationGraceMs"> {
  const nextUlid = monotonicFactory();
  return Object.freeze({
    ids: Object.freeze({
      next: () => nextUlid(),
    }),
    digest: canonicalDigest,
    inputValidator: createJsonSchemaInputValidator(),
    cancellationGraceMs,
    ...persistence,
  });
}

export function createWorkflowApprovalDecisionPort(
  store: BoundedWorkflowOrchestratorStore,
): WorkflowApprovalDecisionPort {
  const port: WorkflowApprovalDecisionPort = {
    async decide(options) {
      try {
        return await store.decideApproval(options);
      } catch (error) {
        if (!(error instanceof BoundedWorkflowRuntimeError)) throw error;
        if (error.code === "workflow.v1.approval_decision_invalid") {
          throw new DomainError(
            "workflow_approval.decision_invalid",
            "Decision does not match the pinned approval schema.",
          );
        }
        if (error.code === "workflow.v1.approval_not_found") {
          throw new DomainError(
            "workflow_approval.not_found",
            "Approval request was not found.",
          );
        }
        if (error.code === "workflow.v1.approval_authorization_invalid") {
          throw new DomainError(
            "workflow_approval.forbidden",
            "Approval authorization is no longer valid.",
          );
        }
        throw new DomainError(
          "workflow_approval.already_decided",
          "Approval decision could not be recorded against the current state.",
        );
      }
    },
  };
  return Object.freeze(port);
}

export function createWorkflowPublicationPort(
  store: PublicationGovernanceStore,
): WorkflowPublicationPort {
  const port: WorkflowPublicationPort = {
    listWorkflowCandidates: (workspaceId, workflowKey) =>
      store.listWorkflowCandidates(workspaceId, workflowKey),
    getWorkflowCandidateReview: (workspaceId, candidateId) =>
      store.getWorkflowCandidateReview(workspaceId, candidateId),
    async submitCandidate(options) {
      const candidate = await store.submitCandidate(options);
      if (candidate.subjectKind !== "workflow") {
        throw new Error(
          "Workflow publication adapter received a non-Workflow Candidate.",
        );
      }
      return {
        ...candidate,
        subjectKind: "workflow" as const,
      };
    },
    recordCheck: (options) => store.recordCheck(options),
    reviewCandidate: (options) => store.reviewCandidate(options),
    async publishWorkflow(options) {
      const revision = await store.publishWorkflow(options);
      return {
        ...revision,
        subjectKind: "workflow" as const,
      };
    },
  };
  return Object.freeze(port);
}
