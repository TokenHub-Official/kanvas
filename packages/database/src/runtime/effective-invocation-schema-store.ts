import {
  compileProviderParameterPolicy,
  projectEffectiveInvocationSchema,
  unavailableEffectiveInvocationSchema,
  type EffectiveInvocationRouteCandidate,
  type EffectiveInvocationRouteGroup,
} from "@kanvas/application";
import type {
  EffectiveInvocationSchema,
  EffectiveInvocationUnavailableReason,
} from "@kanvas/contracts/api";
import type {
  ProviderModelCapabilityKey,
  ProviderModelParameterPolicies,
} from "@kanvas/contracts/provider-model";
import type { WorkflowTopology } from "@kanvas/contracts/workflow";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

import {
  parseProviderDeploymentHardBounds,
  type ProviderDeploymentHardBounds,
} from "./configuration-policy.js";
import {
  providerRouteModelProfileSchemaSupported,
  ProviderRouteStoreError,
  resolveProviderRouteInTransaction,
} from "./provider-route-store.js";
import { digestProviderValue } from "./provider-value-digest.js";

interface InvocationBindingRow extends RowDataPacket {
  readonly bindingId: string;
  readonly executionTarget: string;
  readonly routePolicyRevisionId: string | null;
  readonly capabilityInputSchema: unknown;
}

interface ModelProfileRow extends RowDataPacket {
  readonly schemaVersion: number;
  readonly profileDocument: unknown;
  readonly canonicalDigest: string;
  readonly lifecycleStatus: string;
}

interface CapabilityProjection {
  readonly controlledParameterKeys: readonly string[];
  readonly dispatchableCandidateCount: number;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly candidates: readonly EffectiveInvocationRouteCandidate[];
}

interface EffectiveInvocationProviderRoute {
  readonly apiSurface: string;
  readonly modelOperation?: Exclude<
    ProviderModelCapabilityKey,
    "text.generate"
  >;
  readonly modelProfileRevisionId: string;
  readonly parameterPolicies?: ProviderModelParameterPolicies;
}

type UnavailableInvocationSchema = Extract<
  EffectiveInvocationSchema,
  { readonly availability: "unavailable" }
>;

export interface ProjectWorkflowEffectiveInvocationSchemaOptions {
  readonly workspaceId: string;
  readonly workflowRevisionId: string;
  readonly topology: WorkflowTopology;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly now: Date;
}

export interface EffectiveInvocationSchemaProjector {
  projectInTransaction(
    connection: PoolConnection,
    options: ProjectWorkflowEffectiveInvocationSchemaOptions,
  ): Promise<EffectiveInvocationSchema>;
}

interface CapabilityEffectiveInvocationSchemaProjector extends EffectiveInvocationSchemaProjector {
  projectCapabilityInTransaction(
    connection: PoolConnection,
    options: {
      readonly workspaceId: string;
      readonly contractId: string;
      readonly revision: number;
      readonly canonicalDigest: string;
      readonly inputSchema: Readonly<Record<string, unknown>>;
      readonly now: Date;
    },
  ): Promise<EffectiveInvocationSchema>;
}

const parameterKeyPattern = /^[A-Za-z][A-Za-z0-9]*$/u;

function jsonRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Readonly<Record<string, unknown>>)
    : undefined;
}

function providerParameterContract(schema: Readonly<Record<string, unknown>>):
  | {
      readonly operation: "image.generate" | "image.edit";
      readonly keys: readonly string[];
    }
  | {
      readonly keys: readonly [];
    }
  | undefined {
  const operation = schema["x-kanvas-provider-model-operation"];
  const configured = schema["x-kanvas-provider-parameter-keys"];
  if (operation === undefined && configured === undefined) {
    return Object.freeze({ keys: [] as const });
  }
  if (
    (operation !== "image.generate" && operation !== "image.edit") ||
    !Array.isArray(configured) ||
    configured.length > 64
  ) {
    return undefined;
  }
  const properties = jsonRecord(schema.properties);
  if (
    !properties ||
    configured.some(
      (key) =>
        typeof key !== "string" ||
        !parameterKeyPattern.test(key) ||
        !Object.hasOwn(properties, key),
    ) ||
    new Set(configured).size !== configured.length
  ) {
    return undefined;
  }
  return Object.freeze({
    operation,
    keys: Object.freeze([...(configured as string[])]),
  });
}

function isDirectWorkflowInput(value: unknown): boolean {
  const template = jsonRecord(value);
  const reference = jsonRecord(template?.$value);
  return (
    reference?.source === "workflow_input" &&
    reference.pointer === "" &&
    Object.keys(template ?? {}).length === 1 &&
    Object.keys(reference).length === 2
  );
}

async function loadModelProfile(
  connection: PoolConnection,
  workspaceId: string,
  modelProfileRevisionId: string,
): Promise<unknown> {
  const [rows] = await connection.execute<ModelProfileRow[]>(
    `SELECT
       schema_version AS schemaVersion,
       profile_document AS profileDocument,
       canonical_digest AS canonicalDigest,
       lifecycle_status AS lifecycleStatus
     FROM model_profile_revision
     WHERE workspace_id = ?
       AND id = ?
     LIMIT 1
     FOR SHARE`,
    [workspaceId, modelProfileRevisionId],
  );
  const row = rows[0];
  const document = row ? jsonRecord(row.profileDocument) : undefined;
  if (
    !row ||
    !providerRouteModelProfileSchemaSupported(row.schemaVersion) ||
    row.lifecycleStatus !== "published" ||
    !document ||
    digestProviderValue(document) !== row.canonicalDigest
  ) {
    return undefined;
  }
  return document;
}

async function loadCapabilityProjection(
  connection: PoolConnection,
  deploymentHardBounds: ProviderDeploymentHardBounds | undefined,
  dependencies: {
    readonly resolveProviderRoute: (
      connection: PoolConnection,
      deploymentHardBounds: ProviderDeploymentHardBounds | undefined,
      options: {
        readonly workspaceId: string;
        readonly capabilityBindingId: string;
        readonly requestScopeDigest: string;
        readonly now: Date;
      },
    ) => Promise<EffectiveInvocationProviderRoute>;
    readonly loadModelProfile: (
      connection: PoolConnection,
      workspaceId: string,
      modelProfileRevisionId: string,
    ) => Promise<unknown>;
  },
  options: Pick<
    ProjectWorkflowEffectiveInvocationSchemaOptions,
    "workspaceId" | "workflowRevisionId" | "now"
  >,
  capability: {
    readonly contractId: string;
    readonly revision: number;
    readonly canonicalDigest: string;
  },
): Promise<CapabilityProjection | UnavailableInvocationSchema> {
  const [rows] = await connection.execute<InvocationBindingRow[]>(
    `SELECT
         binding.id AS bindingId,
         implementation.execution_target AS executionTarget,
         binding.route_policy_revision_id AS routePolicyRevisionId,
         contract.input_schema AS capabilityInputSchema
       FROM capability_contract_revision AS contract
       INNER JOIN capability_binding AS binding
         ON binding.contract_revision_id = contract.id
         AND binding.workspace_id = contract.workspace_id
         AND binding.lifecycle_status = 'active'
       INNER JOIN capability_implementation_revision AS implementation
         ON implementation.id = binding.implementation_revision_id
         AND implementation.workspace_id = binding.workspace_id
         AND implementation.lifecycle_status = 'published'
       WHERE contract.workspace_id = ?
         AND contract.contract_key = ?
         AND contract.revision = ?
         AND contract.canonical_digest = ?
         AND contract.lifecycle_status = 'published'
       ORDER BY binding.priority ASC, binding.id ASC
       LIMIT 65`,
    [
      options.workspaceId,
      capability.contractId,
      capability.revision,
      capability.canonicalDigest,
    ],
  );
  if (rows.length === 0) {
    return unavailableEffectiveInvocationSchema("workflow_unavailable");
  }
  if (rows.length > 64) {
    return unavailableEffectiveInvocationSchema("route_ambiguous");
  }
  const inputSchema = jsonRecord(rows[0]!.capabilityInputSchema);
  if (
    !inputSchema ||
    rows.some(
      (row) =>
        digestProviderValue(jsonRecord(row.capabilityInputSchema) ?? null) !==
        digestProviderValue(inputSchema),
    )
  ) {
    return unavailableEffectiveInvocationSchema("schema_conflict");
  }
  const contract = providerParameterContract(inputSchema);
  if (!contract) {
    return unavailableEffectiveInvocationSchema("schema_conflict");
  }
  const candidates: EffectiveInvocationRouteCandidate[] = [];
  let nonProviderCandidateCount = 0;
  const unavailableReasons = new Set<EffectiveInvocationUnavailableReason>();
  for (const row of rows) {
    if (row.executionTarget !== "provider") {
      nonProviderCandidateCount += 1;
      if (candidates.length + nonProviderCandidateCount > 8) {
        return unavailableEffectiveInvocationSchema(
          "route_ambiguous",
          contract.keys,
        );
      }
      continue;
    }
    if (!row.routePolicyRevisionId) {
      unavailableReasons.add("provider_unconfigured");
      continue;
    }
    let route;
    try {
      route = await dependencies.resolveProviderRoute(
        connection,
        deploymentHardBounds,
        {
          workspaceId: options.workspaceId,
          capabilityBindingId: row.bindingId,
          requestScopeDigest: digestProviderValue({
            schemaVersion: 1,
            purpose: "effective_invocation_schema",
            workflowRevisionId: options.workflowRevisionId,
          }),
          now: options.now,
        },
      );
    } catch (error) {
      if (
        error instanceof ProviderRouteStoreError &&
        error.code === "provider_route.not_configured"
      ) {
        unavailableReasons.add("provider_unconfigured");
        continue;
      }
      if (
        error instanceof ProviderRouteStoreError &&
        error.code === "provider_route.unavailable"
      ) {
        unavailableReasons.add(
          error.availabilityReason ?? "provider_unavailable",
        );
        continue;
      }
      if (
        error instanceof ProviderRouteStoreError &&
        [
          "provider_route.integrity_violation",
          "provider_route.identity_conflict",
          "provider_route.invalid_argument",
        ].includes(error.code)
      ) {
        return unavailableEffectiveInvocationSchema(
          "schema_conflict",
          contract.keys,
        );
      }
      throw error;
    }
    if (!("operation" in contract)) {
      if (route.modelOperation) {
        return unavailableEffectiveInvocationSchema("schema_conflict");
      }
      continue;
    }
    if (
      route.modelOperation !== contract.operation ||
      !route.parameterPolicies
    ) {
      return unavailableEffectiveInvocationSchema(
        "schema_conflict",
        contract.keys,
      );
    }
    const profile = await dependencies.loadModelProfile(
      connection,
      options.workspaceId,
      route.modelProfileRevisionId,
    );
    if (!profile) {
      unavailableReasons.add("provider_unavailable");
      continue;
    }
    try {
      const compiled = compileProviderParameterPolicy({
        modelProfileDocument: profile,
        capabilityKey: contract.operation,
        capabilityParameterKeys: contract.keys,
        routeParameterPolicies: route.parameterPolicies,
      });
      candidates.push(
        Object.freeze({
          parameterDefinitions: compiled.operation.parameters,
          parameterPolicies: compiled.policies,
        }),
      );
      if (candidates.length + nonProviderCandidateCount > 8) {
        return unavailableEffectiveInvocationSchema(
          "route_ambiguous",
          contract.keys,
        );
      }
    } catch {
      return unavailableEffectiveInvocationSchema(
        "schema_conflict",
        contract.keys,
      );
    }
  }
  if (candidates.length === 0 && nonProviderCandidateCount === 0) {
    const reasons = [...unavailableReasons];
    return unavailableEffectiveInvocationSchema(
      reasons.length === 1 ? reasons[0]! : "route_unavailable",
      contract.keys,
    );
  }
  return Object.freeze({
    controlledParameterKeys: contract.keys,
    dispatchableCandidateCount: candidates.length + nonProviderCandidateCount,
    inputSchema,
    candidates: Object.freeze(candidates),
  });
}

function isUnavailable(
  value: CapabilityProjection | UnavailableInvocationSchema,
): value is UnavailableInvocationSchema {
  return "availability" in value;
}

export function createEffectiveInvocationSchemaProjector(
  options: {
    readonly providerDeploymentHardBounds?: unknown;
    readonly resolveProviderRoute?: (
      connection: PoolConnection,
      deploymentHardBounds: ProviderDeploymentHardBounds | undefined,
      options: {
        readonly workspaceId: string;
        readonly capabilityBindingId: string;
        readonly requestScopeDigest: string;
        readonly now: Date;
      },
    ) => Promise<EffectiveInvocationProviderRoute>;
    readonly loadModelProfile?: (
      connection: PoolConnection,
      workspaceId: string,
      modelProfileRevisionId: string,
    ) => Promise<unknown>;
  } = {},
): CapabilityEffectiveInvocationSchemaProjector {
  const deploymentHardBounds =
    options.providerDeploymentHardBounds === undefined
      ? undefined
      : parseProviderDeploymentHardBounds(options.providerDeploymentHardBounds);
  const resolveProviderRoute =
    options.resolveProviderRoute ?? resolveProviderRouteInTransaction;
  const loadProfile = options.loadModelProfile ?? loadModelProfile;
  return Object.freeze({
    async projectCapabilityInTransaction(
      connection: PoolConnection,
      input: Parameters<
        CapabilityEffectiveInvocationSchemaProjector["projectCapabilityInTransaction"]
      >[1],
    ) {
      const context = {
        workspaceId: input.workspaceId,
        workflowRevisionId: input.contractId,
        inputSchema: input.inputSchema,
        now: input.now,
      };
      const projection = await loadCapabilityProjection(
        connection,
        deploymentHardBounds,
        { resolveProviderRoute, loadModelProfile: loadProfile },
        context,
        input,
      );
      if (isUnavailable(projection)) return projection;
      return projectEffectiveInvocationSchema({
        inputSchema: input.inputSchema,
        routeGroups: [projection],
      });
    },
    async projectInTransaction(
      connection: PoolConnection,
      projectionOptions: ProjectWorkflowEffectiveInvocationSchemaOptions,
    ) {
      const groups: EffectiveInvocationRouteGroup[] = [];
      const cache = new Map<
        string,
        CapabilityProjection | UnavailableInvocationSchema
      >();
      for (const node of projectionOptions.topology.nodes) {
        if (node.kind !== "invoke" && node.kind !== "map") {
          continue;
        }
        const capability =
          node.kind === "invoke" ? node.capability : node.invoke.capability;
        const cacheKey = [
          capability.contractId,
          capability.revision,
          capability.canonicalDigest,
        ].join(":");
        let projection = cache.get(cacheKey);
        if (!projection) {
          projection = await loadCapabilityProjection(
            connection,
            deploymentHardBounds,
            {
              resolveProviderRoute,
              loadModelProfile: loadProfile,
            },
            projectionOptions,
            capability,
          );
          cache.set(cacheKey, projection);
        }
        if (isUnavailable(projection)) {
          return projection;
        }
        const input = node.kind === "invoke" ? node.input : node.invoke.input;
        if (
          !isDirectWorkflowInput(input) &&
          projection.controlledParameterKeys.length > 0
        ) {
          continue;
        }
        if (isDirectWorkflowInput(input)) {
          groups.push(
            Object.freeze({
              controlledParameterKeys: projection.controlledParameterKeys,
              dispatchableCandidateCount: projection.dispatchableCandidateCount,
              inputSchema: projection.inputSchema,
              candidates: projection.candidates,
            }),
          );
        }
      }
      return projectEffectiveInvocationSchema({
        inputSchema: projectionOptions.inputSchema,
        routeGroups: Object.freeze(groups),
      });
    },
  });
}
