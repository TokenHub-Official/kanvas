import { describe, expect, it, vi } from "vitest";

import {
  createCreateWorkflowRun,
  createCreateWorkflowCandidateTestRun,
  DomainError,
  type CapabilityRouteSnapshot,
  type CreateWorkflowRunDependencies,
  type NodeRunRecord,
  type OutboxEventRecord,
  type TransactionContext,
  type WorkflowRunRecord,
  type TrustedWorkspaceScope,
} from "../src/index.js";

const transactionContext = {} as TransactionContext;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;
const defaultRoute = Object.freeze<CapabilityRouteSnapshot>({
  nodeKey: "run_capability",
  contractRevisionId: "01K000000000000000000000004",
  contractKey: "image.background.remove",
  contractRevision: 1,
  contractDigest: digest("b"),
  candidates: Object.freeze([
    Object.freeze({
      candidateIndex: 0,
      idempotencyMode: "intrinsic",
      bindingId: "01K000000000000000000000005",
      bindingVersion: 1,
      implementationRevisionId: "01K000000000000000000000006",
      implementationDigest: digest("c"),
      executionTarget: "worker" as const,
      adapterKey: "demo.noop",
      retryPolicy: {
        maxAttempts: 2,
        backoff: "fixed" as const,
        initialDelayMs: 1000,
        maxDelayMs: 1000,
      },
      attemptTimeoutMs: 300_000,
      fallbackOn: Object.freeze([]),
    }),
  ]),
});
const validProviderRoute = Object.freeze({
  providerProtocolVersion: 1 as const,
  providerKey: "openai",
  apiSurface: "responses.v1",
  providerEndpointId: identity(7),
  credentialIdentityId: identity(8),
  credentialIdentityEpoch: 2,
  modelDeploymentId: identity(9),
  pricingRevisionId: identity(10),
  pinnedSecretVersionId: identity(11),
  credentialIdentityDigest: digest("f"),
  instancePolicyRevisionId: identity(12),
  workspacePolicyRevisionId: identity(13),
  routePolicyRevisionId: identity(14),
  modelProfileRevisionId: identity(15),
  budgetAccountId: identity(16),
  routingMode: "kanvas_fixed" as const,
  executionTransparency: "full" as const,
  maximumCharge: Object.freeze({
    currencyCode: "USD",
    amount: "1",
  }),
  routeCandidateDigest: digest("d"),
  requestScopeDigest: digest("e"),
  queryMode: "client_request_id" as const,
  notFoundIsAuthoritative: true,
});

function createHarness(route: CapabilityRouteSnapshot = defaultRoute): {
  readonly dependencies: CreateWorkflowRunDependencies;
  readonly runs: WorkflowRunRecord[];
  readonly nodes: NodeRunRecord[];
  readonly events: OutboxEventRecord[];
} {
  const runs: WorkflowRunRecord[] = [];
  const nodes: NodeRunRecord[] = [];
  const events: OutboxEventRecord[] = [];
  let nextId = 0;
  const dependencies: CreateWorkflowRunDependencies = {
    clock: {
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    },
    runtimeStateReader: {
      read: () =>
        Promise.resolve({
          state: "ACTIVE",
          executionGeneration: 7,
          stateVersion: 1,
        }),
    },
    ids: {
      next: () =>
        `01K0000000000000000000000${String(nextId++).padStart(2, "0")}`,
    },
    digest: {
      of: (value) => {
        let hash = 2_166_136_261;
        for (const character of JSON.stringify(value)) {
          hash ^= character.codePointAt(0) ?? 0;
          hash = Math.imul(hash, 16_777_619);
        }
        return `sha256:${hash.toString(16).padStart(8, "0").repeat(8)}`;
      },
    },
    inputValidator: {
      validate: (_schema, value) =>
        typeof value === "object" && value !== null ? [] : ["/ must be object"],
    },
    transactionManager: {
      run: (callback) => callback(transactionContext),
    },
    workflowRevisions: {
      findPublishedById: (workspaceId, revisionId) =>
        Promise.resolve(
          workspaceId === "01K000000000000000000000001" &&
            revisionId === "01K000000000000000000000003"
            ? {
                id: revisionId,
                workspaceId,
                canonicalDigest: `sha256:${"a".repeat(64)}`,
                topology: {
                  schemaVersion: 1,
                  key: "demo_flow",
                  entryNodeKey: "run_capability",
                  limits: { maxNodeRuns: 1, timeoutMs: 60_000 },
                  nodes: [
                    {
                      key: "run_capability",
                      kind: "invoke",
                      capability: {
                        contractId: "image.background.remove",
                        revision: 1,
                        canonicalDigest: digest("b"),
                      },
                      input: {},
                      next: [],
                    },
                  ],
                  outputs: {},
                },
                inputSchema: {
                  type: "object",
                },
                outputSchema: {
                  type: "object",
                },
              }
            : undefined,
        ),
    },
    workflowCandidates: {
      findWorkflowCandidateById: (workspaceId, candidateId) =>
        Promise.resolve(
          workspaceId === "01K000000000000000000000001" &&
            candidateId === "01K000000000000000000000011"
            ? {
                id: candidateId,
                workspaceId,
                canonicalDigest: digest("f"),
                topology: {
                  schemaVersion: 1,
                  key: "candidate_flow",
                  entryNodeKey: "run_capability",
                  limits: { maxNodeRuns: 1, timeoutMs: 60_000 },
                  nodes: [
                    {
                      key: "run_capability",
                      kind: "invoke",
                      capability: {
                        contractId: "image.background.remove",
                        revision: 1,
                        canonicalDigest: digest("b"),
                      },
                      input: {},
                      next: [],
                    },
                  ],
                  outputs: {},
                },
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
              }
            : undefined,
        ),
    },
    workflowRuns: {
      findByIdempotencyKey: (workspaceId, key) =>
        Promise.resolve(
          runs.find(
            (run) =>
              run.workspaceId === workspaceId && run.idempotencyKey === key,
          ),
        ),
      insert: (record) => {
        runs.push(record);
        return Promise.resolve();
      },
    },
    nodeRuns: {
      insertMany: (records) => {
        nodes.push(...records);
        return Promise.resolve();
      },
    },
    outbox: {
      append: (record) => {
        events.push(record);
        return Promise.resolve();
      },
    },
    bindings: {
      resolveRoutesForWorkflow: () => Promise.resolve([route]),
    },
  };

  return {
    dependencies,
    runs,
    nodes,
    events,
  };
}

describe("create workflow run", () => {
  it("runs an immutable Candidate through the same non-production execution facts", async () => {
    const harness = createHarness();
    const createTestRun = createCreateWorkflowCandidateTestRun(
      harness.dependencies,
    );

    const result = await createTestRun({
      workspaceId: "01K000000000000000000000001",
      actorId: "01K000000000000000000000002",
      publicationCandidateId: "01K000000000000000000000011",
      idempotencyKey: "candidate-test-1",
      input: { value: 1 },
    });

    expect(result.run).toMatchObject({
      definitionKind: "publication_candidate",
      publicationCandidateId: "01K000000000000000000000011",
      nonProduction: true,
    });
    expect(result.run.workflowRevisionId).toBeUndefined();
    expect(harness.nodes).toHaveLength(1);
    expect(harness.events).toHaveLength(1);
    expect(result.run.executionPlanSnapshot).toMatchObject({
      workflowDefinition: {
        kind: "publication_candidate",
        id: "01K000000000000000000000011",
        canonicalDigest: digest("f"),
      },
    });
  });

  it("atomically creates the run, root node facts and wake-up outbox", async () => {
    const harness = createHarness();
    const createRun = createCreateWorkflowRun(harness.dependencies);

    const result = await createRun({
      workspaceId: "01K000000000000000000000001",
      actorId: "01K000000000000000000000002",
      workflowRevisionId: "01K000000000000000000000003",
      idempotencyKey: "demo-run-1",
      input: {
        sourceArtifactId: "01K000000000000000000000007",
      },
    });

    expect(result.replayed).toBe(false);
    expect(harness.runs).toHaveLength(1);
    expect(harness.nodes).toMatchObject([
      {
        workflowRunId: result.run.id,
        nodeKey: "run_capability",
        scopeKey: "root",
        lifecycleStatus: "pending",
      },
    ]);
    expect(harness.events).toMatchObject([
      {
        messageType: "workflow.wakeup.requested",
        aggregateId: result.run.id,
        status: "pending",
        payload: {
          expectedGeneration: 7,
        },
      },
    ]);
  });

  it("passes trusted Agent provenance to persistence and rejects a mismatched owner", async () => {
    const harness = createHarness();
    const insert = vi.spyOn(harness.dependencies.workflowRuns, "insert");
    const createRun = createCreateWorkflowRun(harness.dependencies);
    const authority: TrustedWorkspaceScope = {
      trusted: true,
      workspaceId: "01K000000000000000000000001",
      principalId: "01K000000000000000000000002",
      organizationId: identity(10),
      principalType: "human",
      authenticationRefType: "session",
      authenticationRefId: "test-session",
      authorityType: "human_membership",
      authorityId: identity(11),
      authorityVersion: 1,
      authorizationModelVersion: 1,
      effectivePermissions: ["workflow.run", "library.read"],
    };
    const agentInvocation = { authority, actionReceiptId: identity(12) };
    const command = {
      workspaceId: authority.workspaceId,
      actorId: authority.principalId,
      workflowRevisionId: "01K000000000000000000000003",
      idempotencyKey: "agent-library-workflow",
      input: {},
      agentInvocation,
    };
    await createRun(command);
    expect(insert).toHaveBeenCalledWith(
      harness.runs[0],
      transactionContext,
      agentInvocation,
    );
    await expect(
      createRun({ ...command, actorId: identity(99) }),
    ).rejects.toMatchObject({ code: "authorization.permission_denied" });
    expect(harness.runs).toHaveLength(1);
  });

  it("pins the selected Brand context on a production Workflow Run", async () => {
    const harness = createHarness();
    const resolve = vi.fn().mockResolvedValue({
      brandKitId: "01K000000000000000000000020",
      brandKitRevisionId: "01K000000000000000000000021",
      name: "Kanvas 主品牌",
      revisionNumber: 3,
    });
    const createRun = createCreateWorkflowRun({
      ...harness.dependencies,
      brands: { resolve },
    });

    const result = await createRun({
      workspaceId: "01K000000000000000000000001",
      actorId: "01K000000000000000000000002",
      workflowRevisionId: "01K000000000000000000000003",
      brandKitRevisionId: "01K000000000000000000000021",
      canReadBrand: true,
      idempotencyKey: "branded-run-1",
      input: { prompt: "fixture" },
    });

    expect(resolve).toHaveBeenCalledWith(
      "01K000000000000000000000001",
      "01K000000000000000000000021",
      true,
      transactionContext,
    );
    expect(result.run.brand).toEqual({
      brandKitId: "01K000000000000000000000020",
      brandKitRevisionId: "01K000000000000000000000021",
      name: "Kanvas 主品牌",
      revisionNumber: 3,
    });
  });

  it("replays the same request and rejects a conflicting request", async () => {
    const harness = createHarness();
    const createRun = createCreateWorkflowRun(harness.dependencies);
    const base = {
      workspaceId: "01K000000000000000000000001",
      actorId: "01K000000000000000000000002",
      workflowRevisionId: "01K000000000000000000000003",
      idempotencyKey: "demo-run-2",
    } as const;

    await createRun({
      ...base,
      input: {
        value: 1,
      },
    });
    await expect(
      createRun({
        ...base,
        input: {
          value: 1,
        },
      }),
    ).resolves.toMatchObject({
      replayed: true,
    });
    await expect(
      createRun({
        ...base,
        input: {
          value: 2,
        },
      }),
    ).rejects.toBeInstanceOf(DomainError);

    expect(harness.runs).toHaveLength(1);
    expect(harness.events).toHaveLength(1);
  });

  it("pins provider identity and query semantics from route policy", async () => {
    const harness = createHarness({
      ...defaultRoute,
      candidates: [
        {
          ...defaultRoute.candidates[0]!,
          executionTarget: "provider",
          adapterKey: "provider.openai",
          providerRoute: validProviderRoute,
        },
      ],
    });
    const createRun = createCreateWorkflowRun(harness.dependencies);

    const result = await createRun({
      workspaceId: "01K000000000000000000000001",
      actorId: "01K000000000000000000000002",
      workflowRevisionId: "01K000000000000000000000003",
      idempotencyKey: "provider-run-valid",
      input: {
        prompt: "fixture",
      },
    });

    const routes = result.run.executionPlanSnapshot.routes;
    expect(Array.isArray(routes)).toBe(true);
    expect(routes).toMatchObject([
      {
        candidates: [
          {
            executionTarget: "provider",
            providerRoute: validProviderRoute,
          },
        ],
      },
    ]);
  });

  it.each([
    ["missing", undefined],
    [
      "malformed",
      {
        ...validProviderRoute,
        queryMode: "none",
        notFoundIsAuthoritative: true,
      },
    ],
  ])(
    "rejects %s provider identity before creating run facts",
    async (_label, providerRoute) => {
      const harness = createHarness({
        ...defaultRoute,
        candidates: [
          {
            ...defaultRoute.candidates[0]!,
            executionTarget: "provider",
            adapterKey: "provider.openai",
            ...(providerRoute
              ? {
                  providerRoute: providerRoute as typeof validProviderRoute,
                }
              : {}),
          },
        ],
      });
      const createRun = createCreateWorkflowRun(harness.dependencies);

      await expect(
        createRun({
          workspaceId: "01K000000000000000000000001",
          actorId: "01K000000000000000000000002",
          workflowRevisionId: "01K000000000000000000000003",
          idempotencyKey: `provider-run-${_label}`,
          input: {
            prompt: "fixture",
          },
        }),
      ).rejects.toMatchObject({
        code: "provider_route_snapshot.invalid",
      });
      expect(harness.runs).toHaveLength(0);
      expect(harness.nodes).toHaveLength(0);
      expect(harness.events).toHaveLength(0);
    },
  );

  it("pins ordered candidate routes for a WorkflowTopology v1 run", async () => {
    const harness = createHarness();
    const topology = {
      schemaVersion: 1 as const,
      key: "bounded_flow",
      entryNodeKey: "run_capability",
      limits: {
        maxNodeRuns: 1,
        timeoutMs: 60_000,
      },
      nodes: [
        {
          key: "run_capability",
          kind: "invoke" as const,
          capability: {
            contractId: "image.background.remove",
            revision: 1,
            canonicalDigest: digest("b"),
          },
          input: {
            sourceArtifactId: {
              $value: {
                source: "workflow_input" as const,
                pointer: "/sourceArtifactId",
              },
            },
          },
          next: [],
        },
      ],
      outputs: {},
    };
    const resolveRoutesForWorkflow = vi.fn().mockResolvedValue([
      {
        nodeKey: "run_capability",
        contractRevisionId: identity(4),
        contractKey: "image.background.remove",
        contractRevision: 1,
        contractDigest: digest("b"),
        candidates: [
          {
            candidateIndex: 0,
            bindingId: identity(5),
            bindingVersion: 1,
            implementationRevisionId: identity(6),
            implementationDigest: digest("c"),
            executionTarget: "worker",
            adapterKey: "worker.background.remove",
            idempotencyMode: "intrinsic",
            retryPolicy: {
              maxAttempts: 2,
              backoff: "fixed",
              initialDelayMs: 1000,
              maxDelayMs: 1000,
            },
            attemptTimeoutMs: 300_000,
            fallbackOn: [],
          },
        ],
      },
    ]);
    const dependencies: CreateWorkflowRunDependencies = {
      ...harness.dependencies,
      workflowRevisions: {
        findPublishedById: (workspaceId, revisionId) =>
          Promise.resolve({
            id: revisionId,
            workspaceId,
            canonicalDigest: digest("a"),
            topology,
            inputSchema: {
              type: "object",
            },
            outputSchema: {
              type: "object",
            },
          }),
      },
      bindings: {
        resolveRoutesForWorkflow,
      },
    };

    const result = await createCreateWorkflowRun(dependencies)({
      workspaceId: identity(1),
      actorId: identity(2),
      workflowRevisionId: identity(3),
      idempotencyKey: "v2-run",
      input: {
        sourceArtifactId: identity(7),
      },
    });

    expect(result.run.executionPlanSnapshot).toMatchObject({
      schemaVersion: 1,
      topology,
      routes: [
        {
          nodeKey: "run_capability",
          candidates: [
            {
              candidateIndex: 0,
              attemptTimeoutMs: 300_000,
              fallbackOn: [],
            },
          ],
        },
      ],
    });
    expect(result.run.executionDeadlineAt).toEqual(
      new Date("2026-07-27T12:01:00.000Z"),
    );
    expect(Object.isFrozen(result.run.executionPlanSnapshot)).toBe(true);

    resolveRoutesForWorkflow.mockRejectedValueOnce(
      Object.assign(new Error("blocked"), {
        code: "provider_route.unavailable",
      }),
    );
    await expect(
      createCreateWorkflowRun(dependencies)({
        workspaceId: identity(1),
        actorId: identity(2),
        workflowRevisionId: identity(3),
        idempotencyKey: "v2-run-blocked",
        input: {
          sourceArtifactId: identity(7),
        },
      }),
    ).rejects.toMatchObject({
      code: "workflow_run.route_unavailable",
    });
  });
});
