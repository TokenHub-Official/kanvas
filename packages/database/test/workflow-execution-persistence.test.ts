import type {
  PublishedWorkflowRevision,
  ProviderRouteSnapshot,
} from "@kanvas/application";
import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { createWorkflowExecutionPersistence } from "../src/runtime/workflow-execution-persistence.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;
const retryPolicy = Object.freeze({
  maxAttempts: 2,
  backoff: "fixed",
  initialDelayMs: 1000,
  maxDelayMs: 1000,
});
const providerRoute = Object.freeze<ProviderRouteSnapshot>({
  providerProtocolVersion: 1,
  providerKey: "openai",
  apiSurface: "responses.v1",
  providerEndpointId: identity(6),
  credentialIdentityId: identity(7),
  credentialIdentityEpoch: 5,
  modelDeploymentId: identity(8),
  pricingRevisionId: identity(9),
  pinnedSecretVersionId: identity(10),
  credentialIdentityDigest: digest("f"),
  instancePolicyRevisionId: identity(11),
  workspacePolicyRevisionId: identity(12),
  routePolicyRevisionId: identity(13),
  modelProfileRevisionId: identity(14),
  budgetAccountId: identity(15),
  routingMode: "kanvas_fixed",
  executionTransparency: "full",
  maximumCharge: Object.freeze({ currencyCode: "USD", amount: "1" }),
  routeCandidateDigest: digest("d"),
  requestScopeDigest: digest("e"),
  queryMode: "client_request_id",
  notFoundIsAuthoritative: true,
});
const revision: PublishedWorkflowRevision = {
  id: "01K000000000000000000000001",
  workspaceId: "01K000000000000000000000002",
  canonicalDigest: digest("a"),
  topology: {
    schemaVersion: 1,
    key: "provider_fixture",
    entryNodeKey: "invoke_provider",
    limits: {
      maxNodeRuns: 1,
      timeoutMs: 300_000,
    },
    nodes: [
      {
        key: "invoke_provider",
        kind: "invoke",
        capability: {
          contractId: "provider.fixture",
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
};

function createPoolHarness(routePolicy: unknown): {
  readonly pool: Pool;
  readonly commit: ReturnType<typeof vi.fn>;
  readonly rollback: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn().mockResolvedValue([
    [
      {
        contractRevisionId: "01K000000000000000000000003",
        contractKey: "provider.fixture",
        contractRevision: 1,
        contractDigest: digest("b"),
        idempotencyMode: "keyed",
        bindingId: "01K000000000000000000000004",
        bindingVersion: 7,
        implementationRevisionId: "01K000000000000000000000005",
        implementationDigest: digest("c"),
        executionTarget: "provider",
        adapterKey: "provider.openai",
        routePolicy,
      },
    ],
  ]);
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    execute,
    commit,
    rollback,
    release: vi.fn(),
  } as unknown as PoolConnection;
  return {
    pool: {
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool,
    commit,
    rollback,
  };
}

describe("WorkflowExecutionPersistence provider binding snapshot", () => {
  it("resolves one selected published Brand Revision inside the run transaction", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          brandKitRevisionId: identity(21),
          brandKitId: identity(20),
          brandName: "Kanvas 主品牌",
          brandRevisionNumber: 3,
        },
      ],
      [],
    ]);
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      execute,
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    } as unknown as PoolConnection;
    const persistence = createWorkflowExecutionPersistence({
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool);

    await expect(
      persistence.transactionManager.run((context) =>
        persistence.brands.resolve(identity(2), identity(21), true, context),
      ),
    ).resolves.toEqual({
      brandKitId: identity(20),
      brandKitRevisionId: identity(21),
      name: "Kanvas 主品牌",
      revisionNumber: 3,
    });
    expect(String(execute.mock.calls[0]?.[0])).toContain(
      "INNER JOIN brand_kit_revision",
    );
    expect(execute.mock.calls[0]?.[1]).toEqual([identity(2), identity(21)]);
  });

  it("fails closed when a published revision contains a malformed topology", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          id: revision.id,
          workspaceId: revision.workspaceId,
          canonicalDigest: revision.canonicalDigest,
          topology: {
            schemaVersion: 1,
            key: "malformed",
            nodes: [],
          },
          inputSchema: {
            type: "object",
          },
          outputSchema: {
            type: "object",
          },
        },
      ],
    ]);
    const commit = vi.fn().mockResolvedValue(undefined);
    const rollback = vi.fn().mockResolvedValue(undefined);
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      execute,
      commit,
      rollback,
      release: vi.fn(),
    } as unknown as PoolConnection;
    const persistence = createWorkflowExecutionPersistence({
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool);

    await expect(
      persistence.transactionManager.run((transaction) =>
        persistence.workflowRevisions.findPublishedById(
          revision.workspaceId,
          revision.id,
          transaction,
        ),
      ),
    ).rejects.toMatchObject({
      code: "workflow_revision.topology_invalid",
    });
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledOnce();
  });

  it("does not let an embedded Provider route bypass the current published route policy", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          contractRevisionId: identity(3),
          contractKey: "provider.fixture",
          contractRevision: 1,
          contractDigest: digest("b"),
          idempotencyMode: "keyed",
          bindingId: identity(4),
          bindingVersion: 1,
          implementationRevisionId: identity(5),
          implementationDigest: digest("c"),
          executionTarget: "provider",
          adapterKey: "provider.unconfigured",
          routePolicyRevisionId: null,
          routePolicy: {
            retryPolicy,
            providerRoute,
          },
        },
        {
          contractRevisionId: identity(3),
          contractKey: "provider.fixture",
          contractRevision: 1,
          contractDigest: digest("b"),
          idempotencyMode: "keyed",
          bindingId: identity(14),
          bindingVersion: 1,
          implementationRevisionId: identity(15),
          implementationDigest: digest("f"),
          executionTarget: "worker",
          adapterKey: "worker.ready",
          routePolicyRevisionId: null,
          routePolicy: {
            retryPolicy,
            attemptTimeoutMs: 60_000,
          },
        },
      ],
    ]);
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      execute,
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    } as unknown as PoolConnection;
    const persistence = createWorkflowExecutionPersistence({
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool);
    const v2Revision: PublishedWorkflowRevision = {
      ...revision,
      topology: {
        schemaVersion: 1,
        key: "provider_fixture",
        entryNodeKey: "invoke_provider",
        limits: {
          maxNodeRuns: 1,
          timeoutMs: 300_000,
        },
        nodes: [
          {
            key: "invoke_provider",
            kind: "invoke",
            capability: {
              contractId: "provider.fixture",
              revision: 1,
              canonicalDigest: digest("b"),
            },
            input: {},
            next: [],
          },
        ],
        outputs: {},
      },
    };

    await expect(
      persistence.transactionManager.run((context) =>
        persistence.bindings.resolveRoutesForWorkflow(v2Revision, context, {
          requestScopeDigest: digest("f"),
          now: new Date("2026-08-04T00:00:00.000Z"),
        }),
      ),
    ).resolves.toMatchObject([
      {
        candidates: [
          {
            candidateIndex: 0,
            bindingId: identity(14),
            executionTarget: "worker",
          },
        ],
      },
    ]);
  });

  it("rejects Browser-only fallback reasons on a Provider route", async () => {
    const harness = createPoolHarness({
      retryPolicy,
      fallbackOn: ["browser_lease_expired"],
      providerRoute,
    });
    const persistence = createWorkflowExecutionPersistence(harness.pool);
    const v2Revision: PublishedWorkflowRevision = {
      ...revision,
      topology: {
        schemaVersion: 1,
        key: "provider_fixture",
        entryNodeKey: "invoke_provider",
        limits: {
          maxNodeRuns: 1,
          timeoutMs: 300_000,
        },
        nodes: [
          {
            key: "invoke_provider",
            kind: "invoke",
            capability: {
              contractId: "provider.fixture",
              revision: 1,
              canonicalDigest: digest("b"),
            },
            input: {},
            next: [],
          },
        ],
        outputs: {},
      },
    };

    await expect(
      persistence.transactionManager.run((context) =>
        persistence.bindings.resolveRoutesForWorkflow(v2Revision, context, {
          requestScopeDigest: digest("f"),
          now: new Date("2026-08-04T00:00:00.000Z"),
        }),
      ),
    ).rejects.toMatchObject({
      code: "capability_binding.fallback_policy_invalid",
    });
    expect(harness.commit).not.toHaveBeenCalled();
    expect(harness.rollback).toHaveBeenCalledOnce();
  });
});
