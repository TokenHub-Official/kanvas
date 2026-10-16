import type { PoolConnection } from "mysql2/promise";
import type { WorkflowTopologyV1 } from "@kanvas/contracts/workflow";
import { describe, expect, it, vi } from "vitest";

import { createEffectiveInvocationSchemaProjector } from "../src/runtime/effective-invocation-schema-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import { ProviderRouteStoreError } from "../src/runtime/provider-route-store.js";

const workspaceId = "01K00000000000000000000001";
const workflowRevisionId = "01K00000000000000000000002";
const contractDigest = `sha256:${"a".repeat(64)}`;

const inputSchema = {
  type: "object",
  additionalProperties: false,
  "x-kanvas-provider-model-operation": "image.generate",
  "x-kanvas-provider-parameter-keys": ["quality"],
  required: ["prompt"],
  properties: {
    prompt: {
      type: "string",
      maxLength: 8_000,
    },
    quality: {
      type: "string",
      enum: ["medium", "high"],
    },
  },
};

const topology = {
  schemaVersion: 1 as const,
  key: "image_generate",
  entryNodeKey: "generate",
  limits: {
    maxNodeRuns: 1,
    timeoutMs: 300_000,
  },
  nodes: [
    {
      key: "generate",
      kind: "invoke" as const,
      capability: {
        contractId: "image.generate",
        revision: 1,
        canonicalDigest: contractDigest,
      },
      input: {
        $value: {
          source: "workflow_input" as const,
          pointer: "",
        },
      },
      next: [],
    },
  ],
  outputs: {
    result: {
      required: true,
      value: "ok",
    },
  },
};

const deploymentHardBounds = {
  allowedAdapterKinds: ["openai_compatible"],
  allowedPresetKinds: ["openrouter"],
  allowedRegionCodes: ["us"],
  allowedRoutingModes: ["kanvas_fixed"],
  allowedExecutionTransparencies: ["full"],
  maximumCharge: {
    currencyCode: "USD",
    amount: "100",
  },
  maxProviderRequestSeconds: 90,
};

const readyRoute = {
  providerProtocolVersion: 1,
  apiSurface: "images.generations.v1",
  modelOperation: "image.generate" as const,
  modelProfileRevisionId: "01K00000000000000000000005",
  parameterPolicies: {
    quality: {
      callerPolicy: "required" as const,
    },
  },
};

const modelProfile = {
  schemaVersion: 1,
  model: {
    displayName: "Image",
    family: "vendor-image",
    inputModalities: ["text"],
    outputModalities: ["image"],
  },
  operations: {
    "image.generate": {
      parameters: [
        {
          key: "quality",
          label: "Quality",
          required: false,
          valueType: "enum",
          values: ["medium", "high"],
          evidence: [
            {
              kind: "adapter_manifest",
              reference: "test.images.v1",
              observedAt: "2026-08-12T00:00:00.000Z",
              sourceDigest: `sha256:${"b".repeat(64)}`,
              confidence: "high",
              claim: "supported",
            },
          ],
        },
      ],
      evidence: [
        {
          kind: "adapter_manifest",
          reference: "test.images.v1",
          observedAt: "2026-08-12T00:00:00.000Z",
          sourceDigest: `sha256:${"b".repeat(64)}`,
          confidence: "high",
          claim: "supported",
        },
      ],
    },
  },
  sources: [],
};

function binding(bindingId: string): Readonly<Record<string, unknown>> {
  return {
    bindingId,
    executionTarget: "provider",
    routePolicyRevisionId: "01K00000000000000000000009",
    capabilityInputSchema: inputSchema,
  };
}

it("projects direct Agent capability parameters through the same route policy as Workflows", async () => {
  const execute = vi.fn().mockResolvedValue([[binding("provider")], []]);
  const projector = createEffectiveInvocationSchemaProjector({
    providerDeploymentHardBounds: deploymentHardBounds,
    resolveProviderRoute: vi.fn().mockResolvedValue(readyRoute),
    loadModelProfile: vi.fn().mockResolvedValue(modelProfile),
  });
  const result = await projector.projectCapabilityInTransaction(
    { execute } as unknown as PoolConnection,
    {
      workspaceId,
      contractId: "image.generate",
      revision: 1,
      canonicalDigest: contractDigest,
      inputSchema,
      now: new Date("2026-09-08T00:00:00Z"),
    },
  );
  expect(result.availability).toBe("available");
  if (result.availability !== "available")
    throw new Error("Expected available parameters");
  expect(result.fields.find((field) => field.key === "quality")).toMatchObject({
    required: true,
  });
  expect(execute.mock.calls[0]?.[1]).toEqual([
    workspaceId,
    "image.generate",
    1,
    contractDigest,
  ]);
});

it("projects a configured Provider without an optional deployment overlay", async () => {
  const execute = vi.fn().mockResolvedValue([[binding("provider")], []]);
  const projector = createEffectiveInvocationSchemaProjector({
    resolveProviderRoute: vi.fn().mockResolvedValue(readyRoute),
    loadModelProfile: vi.fn().mockResolvedValue(modelProfile),
  });
  const result = await projector.projectCapabilityInTransaction(
    { execute } as unknown as PoolConnection,
    {
      workspaceId,
      contractId: "image.generate",
      revision: 1,
      canonicalDigest: contractDigest,
      inputSchema,
      now: new Date("2026-09-08T00:00:00Z"),
    },
  );
  expect(result.availability).toBe("available");
  if (result.availability !== "available")
    throw new Error("Expected available parameters");
  expect(result.fields.find((field) => field.key === "quality")).toMatchObject({
    required: true,
  });
  expect(execute.mock.calls[0]?.[1]).toEqual([
    workspaceId,
    "image.generate",
    1,
    contractDigest,
  ]);
});

describe("EffectiveInvocationSchemaProjector", () => {
  it.each([
    { storedSchemaVersion: 1, availability: "available" },
    { storedSchemaVersion: 2, availability: "unavailable" },
    { storedSchemaVersion: 3, availability: "unavailable" },
  ] as const)(
    "loads only current V1 model profiles from persistence ($storedSchemaVersion)",
    async ({ storedSchemaVersion, availability }) => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce([[binding("provider")], []])
        .mockResolvedValueOnce([
          [
            {
              schemaVersion: storedSchemaVersion,
              profileDocument: modelProfile,
              canonicalDigest: digestProviderValue(modelProfile),
              lifecycleStatus: "published",
            },
          ],
          [],
        ]);
      const projector = createEffectiveInvocationSchemaProjector({
        providerDeploymentHardBounds: deploymentHardBounds,
        resolveProviderRoute: vi.fn().mockResolvedValue(readyRoute),
      });

      const result = await projector.projectInTransaction(
        { execute } as unknown as PoolConnection,
        {
          workspaceId,
          workflowRevisionId,
          topology,
          inputSchema,
          now: new Date("2026-08-12T00:00:00.000Z"),
        },
      );

      expect(result.availability).toBe(availability);
      if (availability === "unavailable") {
        expect(result).toMatchObject({ reason: "provider_unavailable" });
      }
    },
  );

  it("projects public Workflow inputs when provider parameters are fixed inside the graph", async () => {
    const projector = createEffectiveInvocationSchemaProjector({
      providerDeploymentHardBounds: deploymentHardBounds,
      resolveProviderRoute: vi.fn().mockResolvedValue(readyRoute),
      loadModelProfile: vi.fn().mockResolvedValue(modelProfile),
    });
    const mappedTopology = {
      ...topology,
      nodes: [
        {
          ...topology.nodes[0],
          input: {
            prompt: {
              $string: [
                "Poster: ",
                {
                  $value: {
                    source: "workflow_input" as const,
                    pointer: "/prompt",
                  },
                },
              ],
            },
            quality: "high",
          },
        },
      ],
    } as WorkflowTopologyV1;

    await expect(
      projector.projectInTransaction(
        {
          execute: vi.fn().mockResolvedValue([[binding("provider")], []]),
        } as unknown as PoolConnection,
        {
          workspaceId,
          workflowRevisionId,
          topology: mappedTopology,
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["prompt"],
            properties: {
              prompt: { type: "string", maxLength: 2_000 },
            },
          },
          now: new Date("2026-08-12T00:00:00.000Z"),
        },
      ),
    ).resolves.toMatchObject({
      availability: "available",
      controlledParameterKeys: [],
      fields: [
        {
          key: "prompt",
          valueType: "string",
          required: true,
        },
      ],
    });
  });

  it("skips non-dispatchable Provider candidates and projects the remaining ready set", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          bindingId: "01K00000000000000000000003",
          executionTarget: "provider",
          routePolicyRevisionId: "01K00000000000000000000009",
          capabilityInputSchema: inputSchema,
        },
        {
          bindingId: "01K00000000000000000000004",
          executionTarget: "provider",
          routePolicyRevisionId: "01K00000000000000000000010",
          capabilityInputSchema: inputSchema,
        },
        {
          bindingId: "01K00000000000000000000006",
          executionTarget: "provider",
          routePolicyRevisionId: "01K00000000000000000000011",
          capabilityInputSchema: inputSchema,
        },
      ],
      [],
    ]);
    const resolveProviderRoute = vi
      .fn()
      .mockRejectedValueOnce(
        new ProviderRouteStoreError(
          "provider_route.not_configured",
          "Route has not been configured.",
        ),
      )
      .mockRejectedValueOnce(
        new ProviderRouteStoreError(
          "provider_route.unavailable",
          "Route candidate is temporarily unavailable.",
        ),
      )
      .mockResolvedValueOnce(readyRoute);
    const loadModelProfile = vi.fn().mockResolvedValue(modelProfile);
    const projector = createEffectiveInvocationSchemaProjector({
      providerDeploymentHardBounds: deploymentHardBounds,
      resolveProviderRoute,
      loadModelProfile,
    });

    await expect(
      projector.projectInTransaction({ execute } as unknown as PoolConnection, {
        workspaceId,
        workflowRevisionId,
        topology,
        inputSchema,
        now: new Date("2026-08-12T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      availability: "available",
      controlledParameterKeys: ["quality"],
      fields: [
        {
          key: "prompt",
          valueType: "string",
          required: true,
        },
        {
          key: "quality",
          valueType: "enum",
          required: true,
          values: ["medium", "high"],
        },
      ],
    });
    expect(resolveProviderRoute).toHaveBeenCalledTimes(3);
    expect(loadModelProfile).toHaveBeenCalledTimes(1);
  });

  it("scans beyond eight raw bindings and allows at most eight dispatchable candidates", async () => {
    const rows = [
      binding("skip-not-configured"),
      binding("skip-unavailable"),
      ...Array.from({ length: 8 }, (_, index) =>
        binding(`ready-${String(index + 1)}`),
      ),
    ];
    const execute = vi.fn().mockResolvedValue([rows, []]);
    const resolveProviderRoute = vi.fn(
      (
        _connection: PoolConnection,
        _bounds: unknown,
        options: {
          readonly capabilityBindingId: string;
        },
      ) => {
        if (options.capabilityBindingId === "skip-not-configured") {
          return Promise.reject(
            new ProviderRouteStoreError(
              "provider_route.not_configured",
              "Not configured.",
            ),
          );
        }
        if (options.capabilityBindingId === "skip-unavailable") {
          return Promise.reject(
            new ProviderRouteStoreError(
              "provider_route.unavailable",
              "Unavailable.",
            ),
          );
        }
        return Promise.resolve(readyRoute);
      },
    );
    const projector = createEffectiveInvocationSchemaProjector({
      providerDeploymentHardBounds: deploymentHardBounds,
      resolveProviderRoute,
      loadModelProfile: vi.fn().mockResolvedValue(modelProfile),
    });

    await expect(
      projector.projectInTransaction({ execute } as unknown as PoolConnection, {
        workspaceId,
        workflowRevisionId,
        topology,
        inputSchema,
        now: new Date("2026-08-12T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      availability: "available",
    });
    expect(resolveProviderRoute).toHaveBeenCalledTimes(10);
    expect(String(execute.mock.calls[0]?.[0])).toContain("LIMIT 65");
  });

  it("becomes ambiguous only at the ninth dispatchable candidate", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue([
        [
          binding("skip-unavailable"),
          ...Array.from({ length: 9 }, (_, index) =>
            binding(`ready-${String(index + 1)}`),
          ),
        ],
        [],
      ]);
    const resolveProviderRoute = vi.fn(
      (
        _connection: PoolConnection,
        _bounds: unknown,
        options: {
          readonly capabilityBindingId: string;
        },
      ) => {
        if (options.capabilityBindingId === "skip-unavailable") {
          return Promise.reject(
            new ProviderRouteStoreError(
              "provider_route.unavailable",
              "Unavailable.",
            ),
          );
        }
        return Promise.resolve(readyRoute);
      },
    );
    const projector = createEffectiveInvocationSchemaProjector({
      providerDeploymentHardBounds: deploymentHardBounds,
      resolveProviderRoute,
      loadModelProfile: vi.fn().mockResolvedValue(modelProfile),
    });

    await expect(
      projector.projectInTransaction({ execute } as unknown as PoolConnection, {
        workspaceId,
        workflowRevisionId,
        topology,
        inputSchema,
        now: new Date("2026-08-12T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      availability: "unavailable",
      reason: "route_ambiguous",
    });
    expect(resolveProviderRoute).toHaveBeenCalledTimes(10);
  });

  it("matches execution planning by rejecting more than 64 active bindings", async () => {
    const projector = createEffectiveInvocationSchemaProjector({
      providerDeploymentHardBounds: deploymentHardBounds,
      resolveProviderRoute: vi.fn(),
      loadModelProfile: vi.fn(),
    });

    await expect(
      projector.projectInTransaction(
        {
          execute: vi
            .fn()
            .mockResolvedValue([
              Array.from({ length: 65 }, (_, index) =>
                binding(`binding-${String(index + 1)}`),
              ),
              [],
            ]),
        } as unknown as PoolConnection,
        {
          workspaceId,
          workflowRevisionId,
          topology,
          inputSchema,
          now: new Date("2026-08-12T00:00:00.000Z"),
        },
      ),
    ).resolves.toMatchObject({
      availability: "unavailable",
      reason: "route_ambiguous",
    });
  });

  it("skips an unconfigured Provider without deployment bounds when a non-Provider fallback is ready", async () => {
    const resolveProviderRoute = vi.fn();
    const projector = createEffectiveInvocationSchemaProjector({
      resolveProviderRoute,
      loadModelProfile: vi.fn(),
    });

    await expect(
      projector.projectInTransaction(
        {
          execute: vi.fn().mockResolvedValue([
            [
              {
                bindingId: "unconfigured-provider",
                executionTarget: "provider",
                routePolicyRevisionId: null,
                capabilityInputSchema: inputSchema,
              },
              {
                bindingId: "worker-fallback",
                executionTarget: "worker",
                routePolicyRevisionId: null,
                capabilityInputSchema: inputSchema,
              },
            ],
            [],
          ]),
        } as unknown as PoolConnection,
        {
          workspaceId,
          workflowRevisionId,
          topology,
          inputSchema,
          now: new Date("2026-08-12T00:00:00.000Z"),
        },
      ),
    ).resolves.toMatchObject({
      availability: "available",
      fields: [
        {
          key: "prompt",
          required: true,
          valueType: "string",
        },
      ],
    });
    expect(resolveProviderRoute).not.toHaveBeenCalled();
  });

  it("preserves a specific budget recovery reason when no route can run", async () => {
    const projector = createEffectiveInvocationSchemaProjector({
      providerDeploymentHardBounds: deploymentHardBounds,
      resolveProviderRoute: vi
        .fn()
        .mockRejectedValue(
          new ProviderRouteStoreError(
            "provider_route.unavailable",
            "Budget cannot cover the route.",
            { availabilityReason: "budget_unavailable" },
          ),
        ),
      loadModelProfile: vi.fn(),
    });

    await expect(
      projector.projectInTransaction(
        {
          execute: vi.fn().mockResolvedValue([[binding("budget-blocked")], []]),
        } as unknown as PoolConnection,
        {
          workspaceId,
          workflowRevisionId,
          topology,
          inputSchema,
          now: new Date("2026-08-12T00:00:00.000Z"),
        },
      ),
    ).resolves.toMatchObject({
      availability: "unavailable",
      reason: "budget_unavailable",
    });
  });

  it("fails closed for an integrity-invalid candidate instead of skipping it", async () => {
    const projector = createEffectiveInvocationSchemaProjector({
      providerDeploymentHardBounds: deploymentHardBounds,
      resolveProviderRoute: vi
        .fn()
        .mockRejectedValue(
          new ProviderRouteStoreError(
            "provider_route.integrity_violation",
            "Persisted route digest differs.",
          ),
        ),
      loadModelProfile: vi.fn(),
    });

    await expect(
      projector.projectInTransaction(
        {
          execute: vi.fn().mockResolvedValue([
            [
              {
                bindingId: "01K00000000000000000000003",
                executionTarget: "provider",
                routePolicyRevisionId: "01K00000000000000000000009",
                capabilityInputSchema: inputSchema,
              },
            ],
            [],
          ]),
        } as unknown as PoolConnection,
        {
          workspaceId,
          workflowRevisionId,
          topology,
          inputSchema,
          now: new Date("2026-08-12T00:00:00.000Z"),
        },
      ),
    ).resolves.toMatchObject({
      availability: "unavailable",
      reason: "schema_conflict",
    });
  });
});
