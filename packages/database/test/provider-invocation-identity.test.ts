import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { createIdentityCapabilityMappingPlanV1 } from "@kanvas/contracts/capability";

import {
  invocationMatchesPinnedContext,
  loadPinnedProviderContext,
  resolvePinnedProviderParameters,
  type AttemptRow,
  type CapabilityRow,
  type InvocationRow,
  type PinnedProviderContext,
} from "../src/runtime/provider-invocation-identity.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const capability = {
  id: id(1),
  workspaceId: id(2),
  nodeRunId: id(3),
  invocationKind: "workflow",
  contractRevisionId: id(4),
  bindingId: id(5),
  implementationRevisionId: id(6),
  lifecycleStatus: "running",
  currentAttemptId: id(7),
  acceptedAttemptId: null,
  version: 1,
  cancelRequestedAt: null,
  cancelDeadlineAt: null,
} as CapabilityRow;

const attempt = {
  id: id(7),
  workspaceId: capability.workspaceId,
  capabilityRunId: capability.id,
  bindingId: capability.bindingId,
  routeCandidateIndex: 0,
  candidateAttemptNumber: 1,
  executionTarget: "provider",
  implementationRevisionId: capability.implementationRevisionId,
  lifecycleStatus: "running",
  sideEffectState: "started",
  error: null,
  executionDeadlineAt: new Date("2026-07-28T00:00:00.000Z"),
  version: 1,
  cancelRequestedAt: null,
  cancelDeadlineAt: null,
} as AttemptRow;

const route = Object.freeze({
  providerProtocolVersion: 1 as const,
  providerKey: "openai",
  apiSurface: "responses.v1",
  providerEndpointId: id(8),
  credentialIdentityId: id(9),
  credentialIdentityEpoch: 1,
  pinnedSecretVersionId: id(10),
  credentialIdentityDigest: digest("1"),
  instancePolicyRevisionId: id(11),
  workspacePolicyRevisionId: id(12),
  routePolicyRevisionId: id(13),
  modelProfileRevisionId: id(14),
  modelDeploymentId: id(15),
  pricingRevisionId: id(16),
  budgetAccountId: id(17),
  routingMode: "kanvas_fixed" as const,
  executionTransparency: "full" as const,
  maximumCharge: {
    currencyCode: "USD",
    amount: "1.25",
  },
  routeCandidateDigest: digest("2"),
  requestScopeDigest: digest("3"),
  queryMode: "client_request_id" as const,
  notFoundIsAuthoritative: true,
});

const context = {
  invocationKind: "workflow",
  workflowRunId: id(18),
  nodeRunId: capability.nodeRunId!,
  workspaceId: capability.workspaceId,
  actorId: id(24),
  adapterKey: "provider.test",
  implementationDigest: digest("4"),
  implementationLifecycleStatus: "published",
  route,
  input: {},
  compiledOutputMapping: createIdentityCapabilityMappingPlanV1("output"),
  stableRequestKey: `kanvas:v1:${attempt.id}`,
  requestFingerprint: digest("5"),
} satisfies PinnedProviderContext;

const invocation = {
  id: id(19),
  workspaceId: capability.workspaceId,
  capabilityAttemptId: attempt.id,
  implementationRevisionId: attempt.implementationRevisionId,
  providerEndpointId: route.providerEndpointId,
  providerKey: route.providerKey,
  apiSurface: route.apiSurface,
  credentialIdentityId: route.credentialIdentityId,
  credentialIdentityEpoch: route.credentialIdentityEpoch,
  pinnedSecretVersionId: route.pinnedSecretVersionId,
  modelDeploymentId: route.modelDeploymentId,
  pricingRevisionId: route.pricingRevisionId,
  routeCandidateDigest: route.routeCandidateDigest,
  requestScopeDigest: route.requestScopeDigest,
  stableRequestKey: context.stableRequestKey,
  requestFingerprint: context.requestFingerprint,
  parameterResolutionDigest: null,
  preparedRequestSnapshot: null,
  preparedRequestDigest: null,
  providerRequestId: null,
  remoteStatus: "running",
  sideEffectState: "started",
  queryMode: route.queryMode,
  notFoundIsAuthoritative: 1,
  workState: "query_pending",
  reconcileLeaseGeneration: 1,
  reconcileExecutionGeneration: null,
  reconcileLeaseTokenHash: null,
  reconcileLeaseExpiresAt: null,
  nextReconcileAt: null,
  version: 1,
  submissionStartedAt: new Date("2026-07-27T23:00:00.000Z"),
  acknowledgedAt: new Date("2026-07-27T23:00:01.000Z"),
} as InvocationRow;

describe("Provider invocation pinned identity", () => {
  it("requires a Provider Invocation to persist the exact SecretVersion pin", () => {
    expect(
      invocationMatchesPinnedContext(invocation, context, capability, attempt),
    ).toBe(true);
    expect(
      invocationMatchesPinnedContext(
        {
          ...invocation,
          pinnedSecretVersionId: id(20),
        },
        context,
        capability,
        attempt,
      ),
    ).toBe(false);
    expect(
      invocationMatchesPinnedContext(
        {
          ...invocation,
          pinnedSecretVersionId: null,
        },
        context,
        capability,
        attempt,
      ),
    ).toBe(false);
  });

  it("resolves caller overrides and route defaults into one immutable parameter snapshot", () => {
    const evidence = {
      kind: "adapter_manifest" as const,
      reference: "test.image-adapter.v1",
      observedAt: "2026-08-12T07:00:00.000Z",
      sourceDigest: digest("9"),
      confidence: "high" as const,
      claim: "supported" as const,
    };
    const parameterPolicies = {
      quality: {
        callerPolicy: "optional" as const,
        defaultValue: "medium",
      },
      resolution: {
        callerPolicy: "optional" as const,
        defaultValue: "2k",
      },
    };
    const imageRoute = {
      ...route,
      apiSurface: "images.generations.v1",
      modelOperation: "image.generate" as const,
      parameterPolicies,
      parameterPolicyDigest: digestProviderValue(parameterPolicies),
    };
    const result = resolvePinnedProviderParameters({
      route: imageRoute,
      modelProfileDocument: {
        schemaVersion: 1,
        model: {
          displayName: "GPT Image Test",
          family: "gpt-image",
          inputModalities: ["text"],
          outputModalities: ["image"],
        },
        operations: {
          "image.generate": {
            parameters: [
              {
                key: "quality",
                label: "Quality",
                valueType: "enum",
                values: ["low", "medium", "high"],
                required: false,
                evidence: [evidence],
              },
              {
                key: "resolution",
                label: "Resolution",
                valueType: "enum",
                values: ["1k", "2k", "4k"],
                required: false,
                evidence: [evidence],
              },
            ],
            evidence: [evidence],
          },
        },
        sources: [],
      },
      modelProfileDigest: digest("8"),
      capabilityInputSchema: {
        type: "object",
        "x-kanvas-provider-model-operation": "image.generate",
        "x-kanvas-provider-parameter-keys": ["quality", "resolution"],
        properties: {
          prompt: { type: "string" },
          quality: { type: "string" },
          resolution: { type: "string" },
        },
      },
      input: {
        prompt: "A product photo",
        quality: "high",
      },
    });
    expect(result).toMatchObject({
      values: {
        quality: "high",
        resolution: "2k",
      },
      snapshot: {
        modelOperation: "image.generate",
        values: {
          quality: "high",
          resolution: "2k",
        },
        facts: [
          {
            key: "quality",
            value: "high",
            source: "caller",
          },
          {
            key: "resolution",
            value: "2k",
            source: "route_default",
          },
        ],
      },
    });
    expect(result?.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(() =>
      resolvePinnedProviderParameters({
        route: imageRoute,
        modelProfileDocument: {
          schemaVersion: 1,
          model: {
            displayName: "GPT Image Test",
            family: "gpt-image",
            inputModalities: ["text"],
            outputModalities: ["image"],
          },
          operations: {
            "image.generate": {
              parameters: [],
              evidence: [evidence],
            },
          },
          sources: [],
        },
        modelProfileDigest: digest("8"),
        capabilityInputSchema: {
          type: "object",
          "x-kanvas-provider-model-operation": "image.edit",
          "x-kanvas-provider-parameter-keys": [],
          properties: {},
        },
        input: {},
      }),
    ).toThrow(/model operation differ/u);
    expect(() =>
      resolvePinnedProviderParameters({
        route: {
          ...imageRoute,
          parameterPolicyDigest: digest("7"),
        },
        modelProfileDocument: {},
        modelProfileDigest: digest("8"),
        capabilityInputSchema: {},
        input: {},
      }),
    ).toThrow(/differs from its digest/u);
  });

  it.each([
    { storedSchemaVersion: 1, accepted: true },
    { storedSchemaVersion: 2, accepted: false },
    { storedSchemaVersion: 3, accepted: false },
  ])(
    "accepts only current V1 model profiles while loading a pinned Provider context ($storedSchemaVersion)",
    async ({ storedSchemaVersion, accepted }) => {
      const evidence = {
        kind: "adapter_manifest" as const,
        reference: "test.image-adapter.v1",
        observedAt: "2026-08-12T07:00:00.000Z",
        sourceDigest: digest("9"),
        confidence: "high" as const,
        claim: "supported" as const,
      };
      const parameterPolicies = {
        quality: {
          callerPolicy: "optional" as const,
          defaultValue: "medium",
        },
      };
      const pinnedProviderRoute = {
        ...route,
        apiSurface: "images.generations.v1",
        modelOperation: "image.generate" as const,
        parameterPolicies,
        parameterPolicyDigest: digestProviderValue(parameterPolicies),
      };
      const capabilityInputSchema = {
        type: "object",
        "x-kanvas-provider-model-operation": "image.generate",
        "x-kanvas-provider-parameter-keys": ["quality"],
        properties: {
          prompt: { type: "string" },
          quality: { type: "string" },
        },
      };
      const profileDocument = {
        schemaVersion: 1,
        model: {
          displayName: "GPT Image Test",
          family: "gpt-image",
          inputModalities: ["text"],
          outputModalities: ["image"],
        },
        operations: {
          "image.generate": {
            parameters: [
              {
                key: "quality",
                label: "Quality",
                valueType: "enum",
                values: ["low", "medium", "high"],
                required: false,
                evidence: [evidence],
              },
            ],
            evidence: [evidence],
          },
        },
        sources: [],
      };
      const capabilityInput = { prompt: "A product photo", quality: "high" };
      const compiledInputMapping =
        createIdentityCapabilityMappingPlanV1("input");
      const compiledOutputMapping =
        createIdentityCapabilityMappingPlanV1("output");
      const implementationDigest = digest("4");
      const routeSnapshot = {
        nodeKey: "invoke",
        contractRevisionId: capability.contractRevisionId,
        contractKey: "image.generate",
        contractRevision: 1,
        contractDigest: digest("a"),
        candidates: [
          {
            candidateIndex: 0,
            idempotencyMode: "keyed",
            bindingId: attempt.bindingId,
            bindingVersion: 1,
            implementationRevisionId: attempt.implementationRevisionId,
            implementationDigest,
            executionTarget: "provider",
            adapterKey: "provider.test",
            providerRoute: pinnedProviderRoute,
            retryPolicy: {
              maxAttempts: 1,
              backoff: "fixed",
              initialDelayMs: 0,
              maxDelayMs: 0,
            },
            attemptTimeoutMs: 300_000,
            fallbackOn: [],
          },
        ],
      };
      const execute = vi
        .fn()
        .mockResolvedValueOnce([
          [
            {
              invocationKind: "workflow",
              workflowRunId: context.workflowRunId,
              workflowWorkspaceId: capability.workspaceId,
              actorId: context.actorId,
              nodeRunId: capability.nodeRunId,
              nodeWorkspaceId: capability.workspaceId,
              input: capabilityInput,
              inputDigest: digestProviderValue(capabilityInput),
              routeSnapshot,
              capabilityInputSchema,
              adapterKey: "provider.test",
              implementationExecutionTarget: "provider",
              implementationWorkspaceId: capability.workspaceId,
              implementationLifecycleStatus: "published",
              implementationCanonicalDigest: implementationDigest,
              implementationContractRevisionId: capability.contractRevisionId,
              implementationConfiguration: {},
              inputMappingDigest: digestProviderValue(compiledInputMapping),
              compiledInputMapping,
              outputMappingDigest: digestProviderValue(compiledOutputMapping),
              compiledOutputMapping,
              runtimeAdapterRevisionId: id(21),
              runtimeAdapterRevisionDigest: digest("6"),
              runtimeAdapterRevisionStatus: "published",
              runtimeAdapterExecutionTarget: "provider",
              runtimeAdapterKey: "provider.test",
              runtimeAdapterDefinitionStatus: "active",
            },
          ],
          [],
        ])
        .mockResolvedValueOnce([
          [
            {
              schemaVersion: storedSchemaVersion,
              profileDocument,
              canonicalDigest: digestProviderValue(profileDocument),
              lifecycleStatus: "published",
            },
          ],
          [],
        ]);
      const result = loadPinnedProviderContext(
        { execute } as unknown as PoolConnection,
        capability,
        attempt,
      );

      if (accepted) {
        await expect(result).resolves.toMatchObject({
          effectiveParameters: { quality: "high" },
        });
      } else {
        await expect(result).rejects.toThrow(
          /model profile is unavailable or invalid/u,
        );
      }
    },
  );
});
