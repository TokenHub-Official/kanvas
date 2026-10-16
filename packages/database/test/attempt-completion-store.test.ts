import { describe, expect, it } from "vitest";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  AtomicAttemptCompletionStoreError,
  buildAtomicAttemptCompletionManifestForTest,
  capabilityInputContainsArtifactId,
  completeAttemptInTransaction,
  completionRequestKeyFor,
  createAtomicAttemptCompletionStore,
  type CompleteAttemptOptions,
  type InitialUsageEntry,
} from "../src/runtime/attempt-completion-store.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const hash = (character: string): string => character.repeat(64);
const now = new Date("2026-07-28T00:00:00.000Z");

function workerOptions(
  overrides: Partial<CompleteAttemptOptions> = {},
): CompleteAttemptOptions {
  return {
    workspaceId: id(1),
    capabilityRunId: id(2),
    attemptId: id(3),
    completionId: id(4),
    terminalOutboxEventId: id(5),
    executionGeneration: 7,
    target: {
      executionTarget: "worker",
      implementationRevisionId: id(6),
      implementationDigest: digest("a"),
      adapterKey: "worker.image",
      attemptLeaseGeneration: 3,
      domainLeaseTokenHash: hash("b"),
    },
    capabilityOutput: {
      ok: true,
    },
    outputs: [],
    initialUsage: [],
    now,
    ...overrides,
  };
}

function providerOptions(): CompleteAttemptOptions {
  return {
    ...workerOptions(),
    target: {
      executionTarget: "provider",
      implementationRevisionId: id(6),
      implementationDigest: digest("a"),
      adapterKey: "provider.image",
      invocationId: id(20),
      succeededObservationId: id(21),
      invocationLeaseGeneration: 4,
      routeCandidateDigest: digest("d"),
      requestFingerprint: digest("e"),
      stableRequestKey: `kanvas:v1:${id(3)}`,
      responseDigest: digest("f"),
    },
  };
}

function output(
  offset: number,
  role: string,
  index: number,
): CompleteAttemptOptions["outputs"][number] {
  return {
    uploadSessionId: id(100 + offset),
    storedObjectId: id(200 + offset),
    artifactId: id(300 + offset),
    attemptOutputId: id(400 + offset),
    outputRole: role,
    outputIndex: index,
    artifactType: "image",
    metadata: {
      width: 100 + offset,
    },
  };
}

function quantityUsage(
  offset: number,
  entryKey: string,
  numericValue: string,
): InitialUsageEntry {
  return {
    id: id(500 + offset),
    entryKey,
    metricKey: "duration_ms",
    valueDimension: "quantity",
    unitCode: "millisecond",
    numericValue,
    entryKind: "observation",
    sourceKind: "kanvas_measured",
    evidenceDigest: digest("c"),
    observedAt: now,
  };
}

describe("Atomic Attempt Complete manifest", () => {
  it("accepts lineage only when the source Artifact is pinned in authoritative Capability input", () => {
    const sourceArtifactId = id(99);
    expect(
      capabilityInputContainsArtifactId(
        {
          sourceArtifactId,
          nested: {
            other: id(100),
          },
        },
        sourceArtifactId,
      ),
    ).toBe(true);
    expect(
      capabilityInputContainsArtifactId(
        {
          sourceArtifactId: id(100),
        },
        sourceArtifactId,
      ),
    ).toBe(false);
  });

  it("uses a stable logical request key while the SQL fact remains attempt-scoped", () => {
    expect(completionRequestKeyFor(id(3))).toBe(`complete:v1:${id(3)}`);
  });

  it("canonicalizes output and usage ordering and excludes generated row IDs", () => {
    const left = workerOptions({
      outputs: [output(2, "preview", 0), output(1, "primary", 0)],
      initialUsage: [
        quantityUsage(2, "z.duration", "1.2300"),
        quantityUsage(1, "a.duration", "2.0"),
      ],
    });
    const right = workerOptions({
      completionId: id(90),
      terminalOutboxEventId: id(91),
      outputs: [
        {
          ...output(1, "primary", 0),
          storedObjectId: id(92),
          artifactId: id(93),
          attemptOutputId: id(94),
        },
        {
          ...output(2, "preview", 0),
          storedObjectId: id(95),
          artifactId: id(96),
          attemptOutputId: id(97),
        },
      ],
      initialUsage: [
        {
          ...quantityUsage(1, "a.duration", "2"),
          id: id(98),
        },
        {
          ...quantityUsage(2, "z.duration", "1.23"),
          id: id(99),
        },
      ],
    });
    const facts = [
      {
        uploadSessionId: id(101),
        verifiedSize: "10",
        verifiedSha256: hash("d"),
        detectedMediaType: "image/png",
      },
      {
        uploadSessionId: id(102),
        verifiedSize: "20",
        verifiedSha256: hash("e"),
        detectedMediaType: "image/webp",
      },
    ];

    expect(
      buildAtomicAttemptCompletionManifestForTest(left, facts).digest,
    ).toBe(
      buildAtomicAttemptCompletionManifestForTest(right, [...facts]).digest,
    );
  });

  it("changes the manifest when semantic output changes", () => {
    const first = buildAtomicAttemptCompletionManifestForTest(
      workerOptions(),
      [],
    );
    const second = buildAtomicAttemptCompletionManifestForTest(
      workerOptions({
        capabilityOutput: {
          ok: false,
        },
      }),
      [],
    );

    expect(first.digest).not.toBe(second.digest);
  });

  it("requires decimal strings and represents unknown cost with NULL, never zero", () => {
    expect(() =>
      buildAtomicAttemptCompletionManifestForTest(
        workerOptions({
          initialUsage: [
            {
              ...quantityUsage(1, "duration", "1"),
              numericValue: 1 as unknown as string,
            } as unknown as InitialUsageEntry,
          ],
        }),
        [],
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "attempt_completion.invalid_argument",
      }),
    );

    expect(() =>
      buildAtomicAttemptCompletionManifestForTest(
        workerOptions({
          initialUsage: [
            {
              id: id(501),
              entryKey: "provider.cost",
              metricKey: "cost",
              valueDimension: "money",
              currencyCode: "USD",
              entryKind: "unknown",
              numericValue: "0" as never,
              sourceKind: "kanvas_calculated",
              evidenceDigest: digest("f"),
              observedAt: now,
            },
          ],
        }),
        [],
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "attempt_completion.invalid_argument",
      }),
    );
  });

  it("rejects duplicate output coordinates and non-JSON manifest values", () => {
    expect(() =>
      buildAtomicAttemptCompletionManifestForTest(
        workerOptions({
          outputs: [output(1, "primary", 0), output(2, "primary", 0)],
        }),
        [],
      ),
    ).toThrowError(AtomicAttemptCompletionStoreError);

    expect(() =>
      buildAtomicAttemptCompletionManifestForTest(
        workerOptions({
          capabilityOutput: {
            invalid: undefined,
          },
        }),
        [],
      ),
    ).toThrowError(AtomicAttemptCompletionStoreError);
  });
});

interface FakeConnectionOptions {
  readonly replay?: boolean;
  readonly replayManifestSchemaVersion?: number;
  readonly rejectCapabilityCas?: boolean;
  readonly target?: "provider" | "worker";
  readonly implementationLifecycleStatus?: string;
  readonly capabilityAuditDiffersFromAttempt?: boolean;
  readonly rejectAuditInsert?: boolean;
}

function createFakePool(options: FakeConnectionOptions = {}): {
  readonly pool: Pool;
  readonly connection: PoolConnection;
  readonly statements: string[];
  readonly transactions: string[];
} {
  const statements: string[] = [];
  const transactions: string[] = [];
  const target = options.target ?? "worker";
  const manifestHash = buildAtomicAttemptCompletionManifestForTest(
    target === "provider" ? providerOptions() : workerOptions(),
    [],
  ).digest;
  const execute = (
    sqlValue: string | { readonly sql: string },
  ): Promise<readonly [unknown, unknown]> => {
    const sql = typeof sqlValue === "string" ? sqlValue : sqlValue.sql;
    const normalized = sql.replaceAll(/\s+/gu, " ").trim();
    statements.push(normalized);
    if (
      normalized.includes("FROM capability_run") &&
      !normalized.includes("FROM capability_run AS source")
    ) {
      return Promise.resolve([
        [
          {
            id: id(2),
            workspaceId: id(1),
            invocationKind: "workflow",
            nodeRunId: id(7),
            contractRevisionId: id(8),
            bindingId: options.capabilityAuditDiffersFromAttempt
              ? id(70)
              : id(9),
            implementationRevisionId: options.capabilityAuditDiffersFromAttempt
              ? id(71)
              : id(6),
            lifecycleStatus: options.replay ? "completed" : "running",
            currentAttemptId: id(3),
            acceptedAttemptId: options.replay ? id(3) : null,
            output: {
              ok: true,
            },
            cancelRequestedAt: null,
            version: options.replay ? 3 : 2,
          },
        ],
        [],
      ]);
    }
    if (normalized.includes("FROM capability_attempt")) {
      let sideEffectState = target === "provider" ? "unknown" : "started";
      if (options.replay) {
        sideEffectState = "committed";
      }
      return Promise.resolve([
        [
          {
            id: id(3),
            workspaceId: id(1),
            capabilityRunId: id(2),
            bindingId: id(9),
            routeCandidateIndex: 0,
            executionTarget: target,
            implementationRevisionId: id(6),
            lifecycleStatus: options.replay ? "completed" : "running",
            sideEffectState,
            leaseGeneration: target === "provider" ? 0 : 3,
            leaseTokenHash:
              options.replay || target === "provider" ? null : hash("b"),
            leaseExpiresAt:
              options.replay || target === "provider"
                ? null
                : new Date(now.getTime() + 60_000),
            executionDeadlineAt:
              options.replay || target === "provider"
                ? null
                : new Date(now.getTime() + 120_000),
            cancelRequestedAt: null,
            completionManifestHash: options.replay ? manifestHash : null,
            version: options.replay ? 4 : 3,
          },
        ],
        [],
      ]);
    }
    if (normalized.includes("FROM attempt_completion")) {
      return Promise.resolve([
        options.replay
          ? [
              {
                id: id(4),
                workspaceId: id(1),
                capabilityRunId: id(2),
                capabilityAttemptId: id(3),
                completionRequestKey: id(3),
                manifestSchemaVersion: options.replayManifestSchemaVersion ?? 1,
                completionManifestHash: manifestHash,
                outputCount: 0,
                initialUsageEntryCount: 0,
                terminalOutboxEventId: id(5),
                completedAt: now,
              },
            ]
          : [],
        [],
      ]);
    }
    if (normalized.includes("FROM instance_runtime_state")) {
      return Promise.resolve([
        [
          {
            state: "ACTIVE",
            executionGeneration: 7,
            deadline: null,
          },
        ],
        [],
      ]);
    }
    if (normalized.includes("FROM provider_invocation_observation")) {
      return Promise.resolve([
        [
          {
            id: id(21),
            workspaceId: id(1),
            providerInvocationId: id(20),
            normalizedStatus: "succeeded",
            responseDigest: digest("f"),
            executionGeneration: 7,
            adoptionOutcome: "applied",
            recordedAt: new Date(now.getTime() - 1),
          },
        ],
        [],
      ]);
    }
    if (normalized.includes("FROM provider_invocation")) {
      return Promise.resolve([
        [
          {
            id: id(20),
            workspaceId: id(1),
            capabilityAttemptId: id(3),
            implementationRevisionId: id(6),
            pricingRevisionId: null,
            routeCandidateDigest: digest("d"),
            stableRequestKey: `kanvas:v1:${id(3)}`,
            requestFingerprint: digest("e"),
            remoteStatus: "succeeded",
            sideEffectState: "committed",
            workState: "terminal",
            reconcileLeaseGeneration: 4,
            terminalAt: new Date(now.getTime() - 1),
          },
        ],
        [],
      ]);
    }
    if (normalized.includes("FROM capability_binding AS binding")) {
      return Promise.resolve([
        [
          {
            bindingWorkspaceId: id(1),
            bindingContractRevisionId: id(8),
            bindingLifecycleStatus: "active",
            contractWorkspaceId: id(1),
            contractDigest: digest("c"),
            contractLifecycleStatus: "published",
            implementationRevisionId: id(6),
            implementationWorkspaceId: id(1),
            implementationExecutionTarget: target,
            implementationDigest: digest("a"),
            implementationAdapterKey:
              target === "provider" ? "provider.image" : "worker.image",
            implementationLifecycleStatus:
              options.implementationLifecycleStatus ?? "published",
          },
        ],
        [],
      ]);
    }
    if (normalized.includes("FROM capability_run AS source")) {
      const providerRoute = {
        providerProtocolVersion: 1,
        providerKey: "test-provider",
        apiSurface: "images",
        providerEndpointId: id(30),
        credentialIdentityId: id(31),
        credentialIdentityEpoch: 1,
        modelDeploymentId: id(32),
        pricingRevisionId: id(33),
        pinnedSecretVersionId: id(34),
        credentialIdentityDigest: digest("e"),
        instancePolicyRevisionId: id(35),
        workspacePolicyRevisionId: id(36),
        routePolicyRevisionId: id(37),
        modelProfileRevisionId: id(38),
        budgetAccountId: id(39),
        routingMode: "kanvas_fixed",
        executionTransparency: "full",
        maximumCharge: { currencyCode: "USD", amount: "1" },
        routeCandidateDigest: digest("d"),
        requestScopeDigest: digest("b"),
        queryMode: "none",
        notFoundIsAuthoritative: false,
      };
      return Promise.resolve([
        [
          {
            invocationKind: "workflow",
            nodeRunId: id(7),
            nodeWorkspaceId: id(1),
            nodeKey: "main",
            nodeLifecycleStatus: options.replay ? "completed" : "running",
            nodeInput: {},
            organizationId: id(11),
            workflowRunId: id(10),
            workflowWorkspaceId: id(1),
            workflowLifecycleStatus: options.replay ? "completed" : "running",
            routeSnapshot: {
              nodeKey: "main",
              contractRevisionId: id(8),
              contractKey: "image.transform",
              contractRevision: 1,
              contractDigest: digest("c"),
              candidates: [
                {
                  candidateIndex: 0,
                  idempotencyMode: "keyed",
                  bindingId: id(9),
                  bindingVersion: 1,
                  implementationRevisionId: id(6),
                  executionTarget: target,
                  implementationDigest: digest("a"),
                  adapterKey:
                    target === "provider" ? "provider.image" : "worker.image",
                  retryPolicy: {
                    maxAttempts: 1,
                    backoff: "fixed",
                    initialDelayMs: 0,
                    maxDelayMs: 0,
                  },
                  attemptTimeoutMs: 300_000,
                  fallbackOn: [],
                  ...(target === "provider" ? { providerRoute } : {}),
                },
              ],
            },
            contractDigest: digest("c"),
          },
        ],
        [],
      ]);
    }
    if (
      normalized.includes("FROM upload_session") ||
      normalized.includes("FROM attempt_output")
    ) {
      return Promise.resolve([[], []]);
    }
    if (normalized.includes("FROM usage_ledger_entry")) {
      return Promise.resolve([[], []]);
    }
    if (normalized.startsWith("UPDATE capability_attempt")) {
      return Promise.resolve([
        {
          affectedRows: 1,
        },
        [],
      ]);
    }
    if (normalized.startsWith("UPDATE capability_run")) {
      return Promise.resolve([
        {
          affectedRows: options.rejectCapabilityCas ? 0 : 1,
        },
        [],
      ]);
    }
    if (
      normalized.startsWith("INSERT INTO outbox_event") ||
      normalized.startsWith("INSERT INTO attempt_completion")
    ) {
      return Promise.resolve([
        {
          affectedRows: 1,
        },
        [],
      ]);
    }
    if (normalized.startsWith("INSERT INTO audit_event")) {
      if (options.rejectAuditInsert) {
        return Promise.reject(new Error("audit storage unavailable"));
      }
      return Promise.resolve([
        {
          affectedRows: 1,
        },
        [],
      ]);
    }
    throw new Error(`Unexpected SQL: ${normalized}`);
  };
  const connection = {
    execute,
    beginTransaction: () => {
      transactions.push("begin");
      return Promise.resolve();
    },
    commit: () => {
      transactions.push("commit");
      return Promise.resolve();
    },
    rollback: () => {
      transactions.push("rollback");
      return Promise.resolve();
    },
    release: () => {
      transactions.push("release");
    },
  } as unknown as PoolConnection;
  const pool = {
    getConnection: () => Promise.resolve(connection),
  } as unknown as Pool;
  return {
    pool,
    connection,
    statements,
    transactions,
  };
}

describe("Atomic Attempt Complete store", () => {
  it("atomically commits Attempt, Capability, Outbox and Audit completion facts", async () => {
    const fake = createFakePool();
    const result = await createAtomicAttemptCompletionStore(fake.pool, {
      instanceId: "kanvas-test",
    }).complete(workerOptions());

    expect(result.status).toBe("completed");
    expect(result.manifestSchemaVersion).toBe(1);
    expect(fake.transactions).toEqual(["begin", "commit", "release"]);
    expect(
      fake.statements.findIndex((sql) => sql.includes("FROM capability_run")),
    ).toBeLessThan(
      fake.statements.findIndex((sql) =>
        sql.includes("FROM capability_attempt"),
      ),
    );
    expect(
      fake.statements.findIndex((sql) =>
        sql.startsWith("INSERT INTO outbox_event"),
      ),
    ).toBeLessThan(
      fake.statements.findIndex((sql) =>
        sql.startsWith("INSERT INTO attempt_completion"),
      ),
    );
    expect(
      fake.statements.some(
        (sql) =>
          sql.startsWith("UPDATE node_run") ||
          sql.startsWith("UPDATE workflow_run"),
      ),
    ).toBe(false);
    expect(
      fake.statements.some((sql) => sql.startsWith("INSERT INTO audit_event")),
    ).toBe(true);
  });

  it("returns an exact replay without creating another Outbox or completion fact", async () => {
    const fake = createFakePool({
      replay: true,
    });
    const result = await createAtomicAttemptCompletionStore(fake.pool, {
      instanceId: "kanvas-test",
    }).complete(
      workerOptions({
        completionId: id(80),
        terminalOutboxEventId: id(81),
      }),
    );

    expect(result).toMatchObject({
      status: "replayed",
      completionId: id(4),
      manifestSchemaVersion: 1,
      terminalOutboxEventId: id(5),
    });
    expect(fake.statements.some((sql) => sql.startsWith("INSERT"))).toBe(false);
    expect(
      fake.statements.some(
        (sql) =>
          sql.includes("FROM instance_runtime_state") ||
          sql.includes("FROM node_run AS node"),
      ),
    ).toBe(false);
    expect(fake.transactions).toEqual(["begin", "commit", "release"]);
  });

  it("rejects a replay recorded with unknown manifest schema version 2", async () => {
    const fake = createFakePool({
      replay: true,
      replayManifestSchemaVersion: 2,
    });

    await expect(
      createAtomicAttemptCompletionStore(fake.pool, {
        instanceId: "kanvas-test",
      }).complete(workerOptions()),
    ).rejects.toMatchObject({
      code: "attempt_completion.identity_conflict",
    });
    expect(fake.transactions).toEqual(["begin", "rollback", "release"]);
  });

  it("rolls back completion facts when the atomic Audit write fails", async () => {
    const fake = createFakePool({
      rejectAuditInsert: true,
    });

    await expect(
      createAtomicAttemptCompletionStore(fake.pool, {
        instanceId: "kanvas-test",
      }).complete(workerOptions()),
    ).rejects.toThrow(/audit storage unavailable/u);
    expect(fake.transactions).toEqual(["begin", "rollback", "release"]);
    expect(
      fake.statements.some((sql) =>
        sql.startsWith("INSERT INTO attempt_completion"),
      ),
    ).toBe(true);
  });

  it("rolls back every fact when a terminal CAS loses arbitration", async () => {
    const fake = createFakePool({
      rejectCapabilityCas: true,
    });

    await expect(
      createAtomicAttemptCompletionStore(fake.pool, {
        instanceId: "kanvas-test",
      }).complete(workerOptions()),
    ).rejects.toMatchObject({
      code: "attempt_completion.state_conflict",
    });
    expect(fake.transactions).toEqual(["begin", "rollback", "release"]);
    expect(
      fake.statements.some((sql) =>
        sql.startsWith("INSERT INTO attempt_completion"),
      ),
    ).toBe(false);
  });

  it("uses the Attempt route pin while retaining Capability binding fields as initial audit facts", async () => {
    const fake = createFakePool({
      capabilityAuditDiffersFromAttempt: true,
    });

    const result = await createAtomicAttemptCompletionStore(fake.pool, {
      instanceId: "kanvas-test",
    }).complete(workerOptions());

    expect(result.status).toBe("completed");
    const lifecycleRead = fake.statements.find((sql) =>
      sql.includes("FROM capability_binding AS binding"),
    );
    expect(lifecycleRead).toContain("FOR SHARE");
    expect(lifecycleRead).not.toContain("binding.implementation_revision_id =");
    expect(fake.transactions).toEqual(["begin", "commit", "release"]);
  });

  it("rejects a revoked pinned revision before writing completion facts", async () => {
    const fake = createFakePool({
      implementationLifecycleStatus: "revoked",
    });

    await expect(
      createAtomicAttemptCompletionStore(fake.pool, {
        instanceId: "kanvas-test",
      }).complete(workerOptions()),
    ).rejects.toMatchObject({
      code: "attempt_completion.lifecycle_rejected",
    });
    expect(fake.transactions).toEqual(["begin", "rollback", "release"]);
    expect(fake.statements.some((sql) => sql.startsWith("UPDATE"))).toBe(false);
  });

  it("can join a terminal Provider observation to completion inside an existing transaction", async () => {
    const fake = createFakePool({
      target: "provider",
    });

    const result = await completeAttemptInTransaction(
      fake.connection,
      "kanvas-test",
      providerOptions(),
    );

    expect(result.status).toBe("completed");
    expect(fake.transactions).toEqual([]);
    expect(
      fake.statements.some((sql) =>
        sql.includes("FROM provider_invocation_observation"),
      ),
    ).toBe(true);
    expect(
      fake.statements.findIndex((sql) =>
        sql.includes("FROM provider_invocation_observation"),
      ),
    ).toBeLessThan(
      fake.statements.findIndex((sql) =>
        sql.startsWith("UPDATE capability_attempt"),
      ),
    );
  });
});
