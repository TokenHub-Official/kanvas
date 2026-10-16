import type { TrustedWorkspaceScope } from "@kanvas/application";
import { Readable } from "node:stream";
import {
  BrowserControlPlaneStoreError,
  type AtomicAttemptCompletionStore,
  type BrowserControlPlaneStore,
  type BrowserModelRuntimeCandidate,
  type ModelResourceAdminStore,
  type StorageUploadStore,
  type UploadSessionRecord,
} from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { canonicalDigest } from "../src/application-adapters.js";
import { BrowserExecutorControlPlaneService } from "../src/browser-executor/browser-executor-control-plane.service.js";
import type { ServerConfig } from "../src/config.js";
import { createNodeBrowserAttemptGrantCodec } from "../src/security/browser-attempt-grant-crypto.js";
import type { ServerStorageRuntime } from "../src/storage/server-storage-runtime.js";

const ids = Object.freeze({
  workspace: "01K00000000000000000000001",
  organization: "01K00000000000000000000002",
  principal: "01K00000000000000000000003",
  membership: "01K00000000000000000000004",
  authentication: "01K00000000000000000000005",
  runtimeRelease: "01K00000000000000000000006",
  implementation: "01K00000000000000000000007",
  executorSession: "01K00000000000000000000008",
  executorCapability: "01K00000000000000000000009",
  assignment: "01K00000000000000000000010",
  workflowRun: "01K00000000000000000000011",
  nodeRun: "01K00000000000000000000012",
  capabilityRun: "01K00000000000000000000013",
  attempt: "01K00000000000000000000014",
  contract: "01K00000000000000000000015",
  binding: "01K00000000000000000000016",
  storageProfile: "01K00000000000000000000019",
  storageProbe: "01K00000000000000000000020",
  uploadSession: "01K00000000000000000000021",
});

const runtimeDigest =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const implementationDigest =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const probeDigest =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const config = {
  environment: "test",
  enabledExecutionTargets: ["worker", "browser"],
  browserExecutor: {
    enabled: true,
    controlPlaneVersion: 1,
    runtimeReleaseId: ids.runtimeRelease,
    runtimeReleaseDigest: runtimeDigest,
    sessionTtlSeconds: 3_600,
    attemptLeaseDurationMs: 30_000,
    candidateLimit: 20,
  },
} as unknown as ServerConfig;

const humanScope: TrustedWorkspaceScope = {
  workspaceId: ids.workspace,
  organizationId: ids.organization,
  principalId: ids.principal,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: ids.authentication,
  authorityType: "human_membership",
  authorityId: ids.membership,
  authorityVersion: 3,
  authorizationModelVersion: 1,
  effectivePermissions: ["capability.run"],
  trusted: true,
};

const capabilities = [
  {
    implementationRevisionId: ids.implementation,
    implementationDigest,
    adapterKey: "browser.remove-background",
    backend: "webgpu" as const,
    probeProfileVersion: 1,
    probeResultDigest: probeDigest,
  },
];

const registrationBody = {
  controlPlaneVersion: 1 as const,
  runtimeReleaseId: ids.runtimeRelease,
  runtimeReleaseDigest: runtimeDigest,
  capabilityManifestVersion: 1,
  capabilityManifestDigest: canonicalDigest.of({
    capabilityManifestVersion: 1,
    capabilities,
  }),
  capabilities,
};

function createFixture(
  overrides: Partial<BrowserControlPlaneStore> = {},
  storage?: ServerStorageRuntime,
  storageOverrides: Partial<StorageUploadStore> = {},
  modelResourceOverrides: Partial<ModelResourceAdminStore> = {},
) {
  const registerExecutorSession = vi
    .fn<BrowserControlPlaneStore["registerExecutorSession"]>()
    .mockResolvedValue({
      sessionId: ids.executorSession,
      workspaceId: ids.workspace,
      state: "active",
      expiresAt: new Date("2026-07-28T12:00:00.000Z"),
      capabilityIds: [ids.executorCapability],
    });
  const claimNextAttempt = vi
    .fn<BrowserControlPlaneStore["claimNextAttempt"]>()
    .mockResolvedValue({
      assignmentId: ids.assignment,
      sessionId: ids.executorSession,
      workspaceId: ids.workspace,
      invocationKind: "workflow",
      workflowRunId: ids.workflowRun,
      nodeRunId: ids.nodeRun,
      capabilityRunId: ids.capabilityRun,
      attemptId: ids.attempt,
      contractRevisionId: ids.contract,
      bindingId: ids.binding,
      routeCandidateIndex: 0,
      candidateAttemptNumber: 1,
      implementationRevisionId: ids.implementation,
      implementationDigest,
      runtimeAdapterRevisionId: ids.implementation,
      runtimeAdapterRevisionDigest: implementationDigest,
      adapterKey: "browser.remove-background",
      backend: "webgpu",
      probeProfileVersion: 1,
      probeResultDigest: probeDigest,
      input: { artifactId: "source" },
      leaseGeneration: 4,
      executionGeneration: 7,
      leaseExpiresAt: new Date("2026-07-28T11:00:30.000Z"),
      executionDeadlineAt: new Date("2026-07-28T11:05:00.000Z"),
    });
  const heartbeatAttempt = vi
    .fn<BrowserControlPlaneStore["heartbeatAttempt"]>()
    .mockResolvedValue("renewed");
  const authorizeAttemptOutput = vi
    .fn<BrowserControlPlaneStore["authorizeAttemptOutput"]>()
    .mockResolvedValue({
      status: "authorized",
      actorId: ids.principal,
      expiresAt: new Date("2026-07-28T11:05:00.000Z"),
    });
  const acknowledgeAttemptCancellation = vi
    .fn<BrowserControlPlaneStore["acknowledgeAttemptCancellation"]>()
    .mockResolvedValue("acknowledged");
  const drainSession = vi
    .fn<BrowserControlPlaneStore["drainSession"]>()
    .mockResolvedValue({
      sessionId: ids.executorSession,
      state: "draining",
      changed: true,
    });
  const revokeSession = vi
    .fn<BrowserControlPlaneStore["revokeSession"]>()
    .mockResolvedValue({
      sessionId: ids.executorSession,
      state: "revoked",
      changed: true,
    });
  const completeAttempt = vi
    .fn<AtomicAttemptCompletionStore["complete"]>()
    .mockResolvedValue({
      status: "completed",
      completionId: "01K00000000000000000000017",
      completionRequestKey: `complete:v1:${ids.attempt}`,
      completionManifestHash:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      manifestSchemaVersion: 1,
      terminalOutboxEventId: "01K00000000000000000000018",
      completedAt: new Date("2026-07-28T11:01:00.000Z"),
      outputs: [],
    });
  const uploadRecord: UploadSessionRecord = {
    id: ids.uploadSession,
    workspaceId: ids.workspace,
    actorId: ids.principal,
    purpose: "attempt_output",
    attemptId: ids.attempt,
    outputRole: "primary",
    outputIndex: 0,
    expectedSize: "68",
    expectedMediaType: "image/png",
    storageProfileId: ids.storageProfile,
    compatibilityProbeId: ids.storageProbe,
    profileConfigurationHash: runtimeDigest,
    container: "objects",
    objectKey: `workspaces/${ids.workspace}/attempts/${ids.attempt}/uploads/${ids.uploadSession}`,
    uploadMode: "server_stream",
    writeProtectionMode: "server_owned",
    state: "open",
    version: 1,
    expiresAt: new Date("2026-07-28T11:05:00.000Z"),
    cleanupEligibleAt: new Date("2026-07-28T12:05:00.000Z"),
    verificationProfileVersion: "trusted-image-structural-v1",
    replayed: false,
  };
  const allocateUploadSession = vi
    .fn<StorageUploadStore["allocateUploadSession"]>()
    .mockResolvedValue(uploadRecord);
  const readAttemptOutputUploadSession = vi
    .fn<StorageUploadStore["readAttemptOutputUploadSession"]>()
    .mockResolvedValue(uploadRecord);
  const mapAttemptOutput = vi
    .fn<BrowserControlPlaneStore["mapAttemptOutput"]>()
    .mockImplementation((options) => Promise.resolve(options.adapterOutput));
  const browserControlPlane: BrowserControlPlaneStore = {
    registerExecutorSession,
    claimNextAttempt,
    heartbeatAttempt,
    authorizeAttemptOutput,
    mapAttemptOutput,
    acknowledgeAttemptCancellation,
    drainSession,
    revokeSession,
    ...overrides,
  };
  const listBrowserRuntimeCandidates = vi
    .fn<ModelResourceAdminStore["listBrowserRuntimeCandidates"]>()
    .mockResolvedValue([]);
  const getBrowserRuntimeCandidate = vi
    .fn<ModelResourceAdminStore["getBrowserRuntimeCandidate"]>()
    .mockResolvedValue(undefined);
  const database = {
    atomicAttemptCompletions: {
      complete: completeAttempt,
    },
    browserControlPlane,
    modelResources: {
      listBrowserRuntimeCandidates,
      getBrowserRuntimeCandidate,
      ...modelResourceOverrides,
    },
    storageUploads: {
      allocateUploadSession,
      readAttemptOutputUploadSession,
      ...storageOverrides,
    },
    runtimeStateReader: {
      read: vi.fn().mockResolvedValue({
        state: "ACTIVE",
        executionGeneration: 7,
        stateVersion: 2,
      }),
    },
  } as unknown as ServerDatabaseRuntime;
  return {
    registerExecutorSession,
    claimNextAttempt,
    heartbeatAttempt,
    acknowledgeAttemptCancellation,
    completeAttempt,
    allocateUploadSession,
    readAttemptOutputUploadSession,
    authorizeAttemptOutput,
    mapAttemptOutput,
    listBrowserRuntimeCandidates,
    getBrowserRuntimeCandidate,
    service: new BrowserExecutorControlPlaneService(config, database, storage),
  };
}

function createStorageRuntime() {
  const ingest = vi
    .fn<ServerStorageRuntime["uploads"]["ingest"]>()
    .mockResolvedValue({
      uploadSessionId: ids.uploadSession,
      state: "verified",
      replayed: false,
    });
  const ensureCompatibilityProbe = vi
    .fn<ServerStorageRuntime["ensureCompatibilityProbe"]>()
    .mockResolvedValue({
      id: ids.storageProbe,
      workspaceId: ids.workspace,
      probeKey: "local-filesystem.v1:test:2026-07",
      storageProfileId: ids.storageProfile,
      profileConfigurationHash: runtimeDigest,
      status: "passed",
      capabilities: {
        supportsConditionalCreate: false,
        supportsServerOwnedWrite: true,
        supportsMultipart: false,
        supportsRangeRead: true,
        supportsVersionBoundIdentity: false,
        supportsFullObjectChecksum: true,
        sealedIdentityImmutable: true,
      },
      validUntil: new Date("2026-08-01T00:00:00.000Z"),
      replayed: false,
    });
  const runtime = {
    profileId: ids.storageProfile,
    profileConfigurationHash: runtimeDigest,
    container: "objects",
    maximumInputBytes: 134_217_728,
    modelResourceMaximumInputBytes: 536_870_912,
    cleanupGraceMilliseconds: 3_600_000,
    userImportSessionTtlMilliseconds: 3_600_000,
    modelResourceImportSessionTtlMilliseconds: 3_600_000,
    verificationProfileVersion: "trusted-image-structural-v1",
    profiles: {
      resolve: () => undefined,
    },
    uploads: { ingest },
    modelUploads: { ingest },
    packageUploads: { ingest },
    fontUploads: { ingest },
    libraryDocumentUploads: { ingest: vi.fn() },
    libraryTextUploads: { ingest },
    vectorUploads: { ingest },
    ensureCompatibilityProbe,
    close: () => Promise.resolve(),
  } as ServerStorageRuntime;
  return { runtime, ingest, ensureCompatibilityProbe };
}

describe("BrowserExecutorControlPlaneService", () => {
  it("projects active Browser bindings to one model release without storage identity", async () => {
    const candidate: BrowserModelRuntimeCandidate = {
      capabilityKey: "image.background.remove",
      bindingPriority: 1,
      sourceKind: "model_resource",
      implementationRevisionId: ids.implementation,
      implementationDigest,
      adapterKey: "first-party.image.background-remove.isnet.browser.v1",
      runtimeAdapterRevisionId: ids.implementation,
      runtimeAdapterRevisionDigest: `sha256:${"1".repeat(64)}`,
      runtimeAdapter: {
        schemaVersion: "kanvas.runtime-adapter-definition/v1",
        adapterKey: "first-party.image.background-remove.isnet.browser.v1",
        revision: 1,
        displayName: {
          defaultLocale: "en-US",
          values: { "zh-CN": "背景移除", "en-US": "Background removal" },
        },
        executionTarget: "browser",
        sourceKinds: ["model_resource"],
        supportedModelFormats: ["onnx"],
        invocationInputSchema: {},
        invocationOutputSchema: {},
        configurationSchema: {},
        runtimeProfile: {
          kind: "browser.u2net.v1",
          version: 1,
          settings: { backend: "wasm", role: "background_remove" },
        },
        artifactInputs: [],
        executable: {
          kind: "built_in",
          packageKey: "kanvas.browser-image-runtime",
          packageVersion: "1.0.0",
          entrypoint: "first-party.image.background-remove.isnet.browser.v1",
          releaseDigest: `sha256:${"2".repeat(64)}`,
        },
      },
      implementationConfiguration: {
        backend: "wasm",
        wasmPaths: "/onnxruntime/",
        model: {
          family: "isnet",
          variant: "isnet-general-fp16",
          inputSize: 1024,
          normalization: "isnet",
          sha256: "d".repeat(64),
        },
      },
      modelResourceRevisionId: "01K00000000000000000000022",
      modelResourceRevisionDigest: `sha256:${"e".repeat(64)}`,
      storage: {
        storageProfileId: "models-s3",
        container: "private-models",
        objectKey: "isnet/model.onnx",
        byteSize: "1024",
        sha256: "d".repeat(64),
        immutableIdentityHash: `sha256:${"f".repeat(64)}`,
      },
      manifest: {
        schemaVersion: "kanvas.model-resource/v1",
        family: "isnet",
        variant: "isnet-general-fp16",
        format: "onnx",
        executionTargets: ["browser"],
        sha256: `sha256:${"d".repeat(64)}`,
        byteSize: "1024",
        mediaType: "application/octet-stream",
        license: { spdxId: "MIT" },
        source: {
          kind: "hugging_face",
          repository: "imgly/isnet-general-onnx",
          revision: "440dea9095f704826361ef382869aa26773f7c2a",
          filePath: "onnx/model_fp16.onnx",
        },
        runtime: {},
      },
    };
    const listBrowserRuntimeCandidates = vi.fn().mockResolvedValue([candidate]);
    const fixture = createFixture(
      {},
      undefined,
      {},
      { listBrowserRuntimeCandidates },
    );

    const manifest = await fixture.service.runtimeManifest(humanScope);

    expect(manifest.capabilities).toEqual([
      expect.objectContaining({
        implementationRevisionId: ids.implementation,
        modelResource: {
          revisionId: candidate.modelResourceRevisionId,
          revisionDigest: candidate.modelResourceRevisionDigest,
          contentUrl: `/api/v1/model-resource-revisions/${candidate.modelResourceRevisionId}/content`,
          contentDigest: candidate.manifest!.sha256,
          format: "onnx",
          family: "isnet",
          variant: "isnet-general-fp16",
        },
      }),
    ]);
    expect(manifest.capabilities[0]?.probeResultDigest).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
    expect(JSON.stringify(manifest)).not.toMatch(
      /models-s3|private-models|isnet\/model\.onnx/u,
    );
  });

  it("streams one storage-backed model through its immutable release facts", async () => {
    const modelResourceRevisionId = "01K00000000000000000000022";
    const body = Readable.from([Uint8Array.of(1, 2, 3)]);
    const openRead = vi.fn().mockResolvedValue({
      identity: {
        storageProfileId: "models-s3",
        container: "private-models",
        objectKey: "isnet/model.onnx",
      },
      totalByteSize: "3",
      contentByteSize: "3",
      body,
    });
    const storage = {
      profiles: {
        resolve: () => ({
          kind: "s3",
          storageProfileId: "models-s3",
          adapter: {
            kind: "s3",
            storageProfileId: "models-s3",
            openRead,
          },
        }),
      },
    } as unknown as ServerStorageRuntime;
    const getBrowserRuntimeCandidate = vi.fn().mockResolvedValue({
      capabilityKey: "image.background.remove",
      bindingPriority: 1,
      implementationRevisionId: ids.implementation,
      implementationDigest,
      adapterKey: "first-party.image.background-remove.isnet.browser.v1",
      implementationConfiguration: {},
      modelResourceRevisionId,
      modelResourceRevisionDigest: `sha256:${"e".repeat(64)}`,
      storage: {
        storageProfileId: "models-s3",
        container: "private-models",
        objectKey: "isnet/model.onnx",
        byteSize: "3",
        sha256: "d".repeat(64),
        immutableIdentityHash: `sha256:${"f".repeat(64)}`,
      },
      manifest: {
        schemaVersion: "kanvas.model-resource/v1",
        family: "isnet",
        variant: "isnet-general-fp16",
        format: "onnx",
        executionTargets: ["browser"],
        sha256: `sha256:${"d".repeat(64)}`,
        byteSize: "3",
        mediaType: "application/octet-stream",
        license: { spdxId: "MIT" },
        source: {
          kind: "hugging_face",
          repository: "imgly/isnet-general-onnx",
          revision: "440dea9095f704826361ef382869aa26773f7c2a",
          filePath: "onnx/model_fp16.onnx",
        },
        runtime: {},
      },
    });
    const fixture = createFixture(
      {},
      storage,
      {},
      { getBrowserRuntimeCandidate },
    );

    const prepared = await fixture.service.openModelResource(
      humanScope,
      modelResourceRevisionId,
    );

    expect(prepared.headers).toMatchObject({
      "content-length": "3",
      "content-type": "application/octet-stream",
      "x-content-type-options": "nosniff",
    });
    expect(openRead).toHaveBeenCalledWith({
      identity: {
        storageProfileId: "models-s3",
        container: "private-models",
        objectKey: "isnet/model.onnx",
      },
      expectedByteSize: "3",
      expectedSha256: "d".repeat(64),
      expectedImmutableIdentityHash: `sha256:${"f".repeat(64)}`,
    });
  });

  it("registers only the pinned runtime and canonical capability manifest", async () => {
    const fixture = createFixture();
    await expect(
      fixture.service.register(humanScope, registrationBody),
    ).resolves.toMatchObject({
      controlPlaneVersion: 1,
      sessionId: ids.executorSession,
      workspaceId: ids.workspace,
      state: "active",
      capabilityIds: [ids.executorCapability],
    });
    const registration = fixture.registerExecutorSession.mock.calls[0]?.[0];
    expect(registration?.authority.workspaceId).toBe(ids.workspace);
    expect(registration?.authority.createdByPrincipalId).toBe(ids.principal);
    expect(registration?.authority.authorityVersion).toBe(3);
    expect(registration?.authority.authenticationRefHash).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(registration?.runtimeReleaseId).toBe(ids.runtimeRelease);
    expect(registration?.runtimeReleaseDigest).toBe(runtimeDigest);
    expect(registration?.capabilityManifestDigest).toBe(
      registrationBody.capabilityManifestDigest,
    );
    expect(registration?.capabilities[0]?.id).toMatch(
      /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u,
    );
    expect(registration?.capabilities[0]?.implementationRevisionId).toBe(
      ids.implementation,
    );
  });

  it("rejects a manifest whose claimed digest is not canonical", async () => {
    const fixture = createFixture();
    await expect(
      fixture.service.register(humanScope, {
        ...registrationBody,
        capabilityManifestDigest: runtimeDigest,
      }),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(fixture.registerExecutorSession).not.toHaveBeenCalled();
  });

  it("returns the raw grant once while persisting only domain-separated hashes", async () => {
    const fixture = createFixture();
    const claimed = await fixture.service.claim(
      humanScope,
      ids.executorSession,
      1,
    );
    expect(claimed.assignment?.attemptGrant).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const persisted = fixture.claimNextAttempt.mock.calls[0]?.[0];
    expect(persisted?.sessionId).toBe(ids.executorSession);
    expect(persisted?.executionGeneration).toBe(7);
    expect(persisted?.attemptGrantTokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(persisted?.domainLeaseTokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(persisted).not.toHaveProperty("rawGrant");
    expect(persisted?.attemptGrantTokenHash).not.toBe(
      persisted?.domainLeaseTokenHash,
    );
  });

  it("binds heartbeat to workspace, session, assignment and attempt facts", async () => {
    const fixture = createFixture();
    const rawGrant = createNodeBrowserAttemptGrantCodec().issue().rawGrant;
    await expect(
      fixture.service.heartbeat(
        ids.workspace,
        ids.executorSession,
        ids.assignment,
        rawGrant,
        {
          controlPlaneVersion: 1,
          attemptId: ids.attempt,
          leaseGeneration: 4,
          executionGeneration: 7,
        },
      ),
    ).resolves.toMatchObject({
      result: "renewed",
    });
    const heartbeat = fixture.heartbeatAttempt.mock.calls[0]?.[0];
    expect(heartbeat?.workspaceId).toBe(ids.workspace);
    expect(heartbeat?.sessionId).toBe(ids.executorSession);
    expect(heartbeat?.assignmentId).toBe(ids.assignment);
    expect(heartbeat?.attemptId).toBe(ids.attempt);
    expect(heartbeat?.attemptLeaseGeneration).toBe(4);
    expect(heartbeat?.executionGeneration).toBe(7);
  });

  it("turns a runtime fence into a terminal client stop signal", async () => {
    const fixture = createFixture({
      heartbeatAttempt: vi
        .fn()
        .mockRejectedValue(
          new BrowserControlPlaneStoreError(
            "browser_control.runtime_fenced",
            "fenced",
          ),
        ),
    });
    const rawGrant = createNodeBrowserAttemptGrantCodec().issue().rawGrant;
    await expect(
      fixture.service.heartbeat(
        ids.workspace,
        ids.executorSession,
        ids.assignment,
        rawGrant,
        {
          controlPlaneVersion: 1,
          attemptId: ids.attempt,
          leaseGeneration: 4,
          executionGeneration: 7,
        },
      ),
    ).resolves.toMatchObject({
      result: "revoked",
    });
  });

  it("derives completion authority from the grant and delegates one atomic adoption", async () => {
    const fixture = createFixture();
    const rawGrant = createNodeBrowserAttemptGrantCodec().issue().rawGrant;
    await expect(
      fixture.service.complete(
        ids.workspace,
        ids.executorSession,
        ids.assignment,
        rawGrant,
        {
          controlPlaneVersion: 1,
          attemptId: ids.attempt,
          capabilityRunId: ids.capabilityRun,
          leaseGeneration: 4,
          executionGeneration: 7,
          implementationRevisionId: ids.implementation,
          implementationDigest,
          adapterKey: "browser.remove-background",
          capabilityOutput: {
            foreground: {
              $kanvas: "attempt-output-artifact/v1",
              outputRole: "primary",
              outputIndex: 0,
            },
          },
          outputs: [
            {
              uploadSessionId: ids.uploadSession,
              outputRole: "primary",
              outputIndex: 0,
              artifactType: "image.foreground",
              metadata: {},
            },
          ],
          initialUsage: [
            {
              entryKey: "browser.duration",
              metricKey: "duration",
              valueDimension: "quantity",
              unitCode: "millisecond",
              entryKind: "observation",
              numericValue: "1250",
              evidenceDigest: probeDigest,
              observedAt: "2026-07-28T11:00:59.000Z",
            },
          ],
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      manifestSchemaVersion: 1,
      outputs: [],
    });
    const completion = fixture.completeAttempt.mock.calls[0]?.[0];
    expect(completion?.workspaceId).toBe(ids.workspace);
    expect(completion?.attemptId).toBe(ids.attempt);
    expect(completion?.target).toMatchObject({
      executionTarget: "browser",
      assignmentId: ids.assignment,
      sessionId: ids.executorSession,
      attemptLeaseGeneration: 4,
    });
    expect(completion?.target).not.toHaveProperty("rawGrant");
    const output = completion?.outputs[0];
    expect(output).toMatchObject({
      uploadSessionId: ids.uploadSession,
      outputRole: "primary",
      outputIndex: 0,
      artifactType: "image.foreground",
    });
    expect(completion?.capabilityOutput).toEqual({
      foreground: output?.artifactId,
    });
    expect(completion?.initialUsage[0]).toMatchObject({
      sourceKind: "producer_reported",
      numericValue: "1250",
      observedAt: new Date("2026-07-28T11:00:59.000Z"),
    });
  });

  it("acknowledges cancellation with the same grant and execution fences", async () => {
    const fixture = createFixture();
    const rawGrant = createNodeBrowserAttemptGrantCodec().issue().rawGrant;
    await expect(
      fixture.service.acknowledgeCancellation(
        ids.workspace,
        ids.executorSession,
        ids.assignment,
        rawGrant,
        {
          controlPlaneVersion: 1,
          attemptId: ids.attempt,
          capabilityRunId: ids.capabilityRun,
          leaseGeneration: 4,
          executionGeneration: 7,
        },
      ),
    ).resolves.toMatchObject({
      result: "acknowledged",
    });
    const acknowledgement =
      fixture.acknowledgeAttemptCancellation.mock.calls[0]?.[0];
    expect(acknowledgement).toMatchObject({
      workspaceId: ids.workspace,
      sessionId: ids.executorSession,
      assignmentId: ids.assignment,
      capabilityRunId: ids.capabilityRun,
      attemptId: ids.attempt,
      attemptLeaseGeneration: 4,
      executionGeneration: 7,
    });
    expect(acknowledgement).not.toHaveProperty("rawGrant");
  });

  it("allocates a replayable server-owned output bound to the current Attempt", async () => {
    const storage = createStorageRuntime();
    const fixture = createFixture({}, storage.runtime);
    const rawGrant = createNodeBrowserAttemptGrantCodec().issue().rawGrant;

    await expect(
      fixture.service.allocateAttemptOutput(
        ids.workspace,
        ids.executorSession,
        ids.assignment,
        rawGrant,
        "render-primary-v1",
        {
          controlPlaneVersion: 1,
          attemptId: ids.attempt,
          leaseGeneration: 4,
          executionGeneration: 7,
          outputRole: "primary",
          outputIndex: 0,
          expectedSize: "68",
          expectedMediaType: "image/png",
        },
      ),
    ).resolves.toEqual({
      uploadSessionId: ids.uploadSession,
      state: "open",
      expiresAt: "2026-07-28T11:05:00.000Z",
      maximumBytes: "68",
      replayed: false,
    });

    expect(fixture.authorizeAttemptOutput).toHaveBeenCalledOnce();
    expect(storage.ensureCompatibilityProbe).toHaveBeenCalledOnce();
    const allocation = fixture.allocateUploadSession.mock.calls[0]?.[0];
    expect(allocation).toMatchObject({
      workspaceId: ids.workspace,
      actorId: ids.principal,
      purpose: "attempt_output",
      attemptId: ids.attempt,
      outputRole: "primary",
      outputIndex: 0,
      expectedSize: "68",
      expectedMediaType: "image/png",
      storageProfileId: ids.storageProfile,
      compatibilityProbeId: ids.storageProbe,
      uploadMode: "server_stream",
      writeProtectionMode: "server_owned",
      expiresAt: new Date("2026-07-28T11:05:00.000Z"),
      cleanupEligibleAt: new Date("2026-07-28T12:05:00.000Z"),
    });
    expect(allocation?.allocationRequestKey).toMatch(
      /^browser-output:v1:[0-9a-f]{64}$/u,
    );
    expect(allocation?.allocationRequestHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(allocation?.objectKey).not.toContain("primary");
  });

  it("re-authorizes and ingests only the exactly bound output session", async () => {
    const storage = createStorageRuntime();
    const fixture = createFixture({}, storage.runtime);
    const rawGrant = createNodeBrowserAttemptGrantCodec().issue().rawGrant;
    const body = Readable.from([Uint8Array.of(1, 2, 3)]);

    await expect(
      fixture.service.uploadAttemptOutput(
        ids.workspace,
        ids.executorSession,
        ids.assignment,
        ids.uploadSession,
        rawGrant,
        ids.attempt,
        4,
        7,
        "primary",
        0,
        body,
      ),
    ).resolves.toEqual({
      uploadSessionId: ids.uploadSession,
      state: "verified",
      replayed: false,
    });

    expect(fixture.readAttemptOutputUploadSession).toHaveBeenCalledWith({
      workspaceId: ids.workspace,
      uploadSessionId: ids.uploadSession,
      attemptId: ids.attempt,
      outputRole: "primary",
      outputIndex: 0,
    });
    const ingestion = storage.ingest.mock.calls[0]?.[0];
    expect(ingestion?.body).toBe(body);
    expect(ingestion?.session).toMatchObject({
      id: ids.uploadSession,
      actorId: ids.principal,
    });
  });

  it("fails closed when output storage is not configured", async () => {
    const fixture = createFixture();
    const rawGrant = createNodeBrowserAttemptGrantCodec().issue().rawGrant;
    await expect(
      fixture.service.allocateAttemptOutput(
        ids.workspace,
        ids.executorSession,
        ids.assignment,
        rawGrant,
        "render-primary-v1",
        {
          controlPlaneVersion: 1,
          attemptId: ids.attempt,
          leaseGeneration: 4,
          executionGeneration: 7,
          outputRole: "primary",
          outputIndex: 0,
          expectedMediaType: "image/png",
        },
      ),
    ).rejects.toMatchObject({
      status: 503,
    });
  });
});
