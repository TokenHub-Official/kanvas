import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { createResourceSourceStore } from "../src/runtime/resource-source-store.js";

const workspaceId = "01K00000000000000000000000";
const organizationId = "01K00000000000000000000001";
const principalId = "01K00000000000000000000002";
const authorityId = "01K00000000000000000000003";
const sourceId = "01K00000000000000000000004";
const endpointId = "01K00000000000000000000005";
const credentialId = "01K00000000000000000000006";
const auditEventId = "01K00000000000000000000007";
const now = new Date("2026-08-27T04:00:00.000Z");
const digest = `sha256:${"a".repeat(64)}`;

const scope: TrustedWorkspaceScope = {
  workspaceId,
  organizationId,
  principalId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "session-reference",
  authorityType: "human_membership",
  authorityId,
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["credential.manage", "asset.read", "asset.write"],
  trusted: true,
};

const authorizationRow = {
  principalId,
  principalStatus: "active",
  membershipId: authorityId,
  membershipRole: "admin",
  membershipStatus: "active",
  membershipVersion: 1,
  organizationId,
  workspaceId,
  workspaceStatus: "active",
};

const audit = {
  auditEventId,
  actorPrincipalId: principalId,
  actorType: "human" as const,
  authenticationRefType: "session" as const,
  authenticationRefHash: digest,
  authorityType: "human_membership" as const,
  authorityId,
  authorityVersion: 1,
};

const licensePolicy = {
  requireCommercialUse: true,
  allowAttribution: true,
  allowShareAlike: false,
  allowStandaloneRedistributionRestriction: true,
  allowUnknownModelRelease: true,
  allowUnknownPropertyRelease: true,
  allowedLicenseIds: ["CC0-1.0", "CC-BY-4.0"],
};

function result(affectedRows = 1): ResultSetHeader {
  return { affectedRows } as ResultSetHeader;
}

function sourceRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: sourceId,
    workspaceId,
    displayName: "Open image source",
    adapterKind: "openverse.v1",
    adapterVersion: "1.0.0",
    authMode: "api_key",
    endpointOrigin: "https://api.openverse.org",
    providerEndpointId: endpointId,
    credentialId,
    activeSecretVersionId: null,
    activeSecretLifecycle: null,
    credentialIdentityEpoch: 1,
    credentialIdentityDigest: digest,
    credentialVersion: 1,
    configurationDocument: {},
    configurationDigest: digest,
    licensePolicy,
    lifecycleStatus: "draft",
    validationStatus: "not_checked",
    validationReasonCode: null,
    currentRevisionId: null,
    idempotencyKey: "create-source-1",
    requestHash: digest,
    version: 1,
    createdAt: now,
    updatedAt: now,
    disabledAt: null,
    ...overrides,
  };
}

function queuedPool(results: readonly unknown[]) {
  const queue = [...results];
  const beginTransaction = vi.fn(() => Promise.resolve());
  const commit = vi.fn(() => Promise.resolve());
  const rollback = vi.fn(() => Promise.resolve());
  const release = vi.fn();
  const execute = vi.fn((query: string, values?: readonly unknown[]) => {
    void query;
    void values;
    const next = queue.shift();
    if (next === undefined) {
      return Promise.reject(new Error("Unexpected SQL execution."));
    }
    return Promise.resolve(next);
  });
  const connection = {
    beginTransaction,
    commit,
    rollback,
    release,
    execute,
  } as unknown as PoolConnection;
  const pool = {
    getConnection: vi.fn(() => Promise.resolve(connection)),
  } as unknown as Pool;
  return {
    pool,
    execute,
    commit,
    rollback,
    release,
    remaining: () => queue.length,
  };
}

describe("Resource Source Store", () => {
  it("creates Endpoint, Credential and Source without persisting secret material", async () => {
    const queued = queuedPool([
      [[authorizationRow], []],
      [[], []],
      [result(), []],
      [result(), []],
      [result(), []],
      [result(), []],
    ]);
    const store = createResourceSourceStore(queued.pool);

    await expect(
      store.createDraft({
        scope,
        sourceId,
        providerEndpointId: endpointId,
        credentialId,
        displayName: "Open image source",
        adapterKind: "openverse.v1",
        adapterVersion: "1.0.0",
        authMode: "api_key",
        endpointOrigin: "https://api.openverse.org",
        configuration: { safeSearch: true },
        licensePolicy,
        idempotencyKey: "create-source-1",
        now,
        audit,
      }),
    ).resolves.toMatchObject({
      replayed: false,
      value: {
        id: sourceId,
        credentialId,
        lifecycleStatus: "draft",
        secretConfigured: false,
      },
    });

    expect(queued.remaining()).toBe(0);
    expect(queued.commit).toHaveBeenCalledOnce();
    const sql = queued.execute.mock.calls
      .map(([query]) => String(query))
      .join("\n");
    expect(sql).not.toContain("material_ciphertext");
    expect(sql).not.toContain("material_plaintext");
  });

  it("does not validate an authenticated source before SecretVersion activation", async () => {
    const queued = queuedPool([
      [[authorizationRow], []],
      [[sourceRow()], []],
    ]);
    const store = createResourceSourceStore(queued.pool);

    await expect(
      store.recordValidation({
        scope,
        sourceId,
        expectedVersion: 1,
        outcome: "passed",
        validationDigest: digest,
        reasonCode: "resource_source.connection_verified",
        now,
        audit,
      }),
    ).rejects.toMatchObject({
      code: "resource_source.secret_not_ready",
    });

    expect(queued.rollback).toHaveBeenCalledOnce();
    expect(queued.commit).not.toHaveBeenCalled();
  });

  it("publishes one immutable Revision only after passed validation", async () => {
    const sourceRevisionId = "01K00000000000000000000008";
    const queued = queuedPool([
      [[authorizationRow], []],
      [
        [
          sourceRow({
            activeSecretVersionId: "01K00000000000000000000009",
            activeSecretLifecycle: "active",
            lifecycleStatus: "ready",
            validationStatus: "passed",
            validationReasonCode: "resource_source.connection_verified",
            version: 2,
          }),
        ],
        [],
      ],
      [[], []],
      [[], []],
      [[{ nextRevisionNumber: 1 }], []],
      [result(), []],
      [result(), []],
      [result(), []],
    ]);
    const store = createResourceSourceStore(queued.pool);

    await expect(
      store.publish({
        scope,
        sourceId,
        sourceRevisionId,
        expectedVersion: 2,
        capabilities: ["image.search", "image.import"],
        idempotencyKey: "publish-source-1",
        now,
        audit,
      }),
    ).resolves.toMatchObject({
      replayed: false,
      value: {
        id: sourceRevisionId,
        sourceId,
        revisionNumber: 1,
        capabilities: ["image.search", "image.import"],
      },
    });

    expect(queued.remaining()).toBe(0);
    expect(queued.commit).toHaveBeenCalledOnce();
    expect(queued.rollback).not.toHaveBeenCalled();
  });

  it("replays a completed mutation from its persisted idempotency identity", async () => {
    const operationId = "01K00000000000000000000010";
    const requestHash = `sha256:${"b".repeat(64)}`;
    const pendingOperation = {
      workspaceId,
      idempotencyKey: "validate-source-1",
      operationId,
      sourceId,
      operationKind: "validate",
      requestHash,
      plannedResourceId: null,
      status: "pending",
      resultSourceVersion: null,
      resultReasonCode: null,
    };
    const completedOperation = {
      ...pendingOperation,
      status: "succeeded",
      resultSourceVersion: 2,
      resultReasonCode: "resource_source.connection_verified",
    };
    const queued = queuedPool([
      [[authorizationRow], []],
      [[sourceRow()], []],
      [[], []],
      [result(), []],
      [[authorizationRow], []],
      [[sourceRow({ version: 2 })], []],
      [[pendingOperation], []],
      [result(), []],
      [[authorizationRow], []],
      [[sourceRow({ version: 2 })], []],
      [[completedOperation], []],
    ]);
    const store = createResourceSourceStore(queued.pool);

    await expect(
      store.claimOperation({
        scope,
        sourceId,
        operationId,
        operationKind: "validate",
        idempotencyKey: "validate-source-1",
        requestHash,
        expectedSourceVersion: 1,
        now,
        audit,
      }),
    ).resolves.toMatchObject({ replayed: false, resumed: false });
    await expect(
      store.completeOperation({
        scope,
        sourceId,
        operationId,
        idempotencyKey: "validate-source-1",
        requestHash,
        resultSourceVersion: 2,
        resultReasonCode: "resource_source.connection_verified",
        now,
        audit,
      }),
    ).resolves.toMatchObject({ replayed: false });
    await expect(
      store.claimOperation({
        scope,
        sourceId,
        operationId: "01K00000000000000000000011",
        operationKind: "validate",
        idempotencyKey: "validate-source-1",
        requestHash,
        expectedSourceVersion: 1,
        now,
        audit,
      }),
    ).resolves.toMatchObject({
      replayed: true,
      resultReasonCode: "resource_source.connection_verified",
    });

    expect(queued.remaining()).toBe(0);
  });

  it("projects only published revisions through asset read scope", async () => {
    const publishedRevisionId = "01K00000000000000000000012";
    const queued = queuedPool([
      [[authorizationRow], []],
      [
        [
          {
            id: sourceId,
            displayName: "Open image source",
            adapterKind: "openverse.v1",
            adapterVersion: "1.0.0",
            authMode: "none",
            endpointOrigin: "https://api.openverse.org",
            providerEndpointId: endpointId,
            credentialId: null,
            credentialIdentityEpoch: null,
            credentialIdentityDigest: null,
            activeSecretVersionId: null,
            revisionId: publishedRevisionId,
            configurationDocument: {},
            licensePolicy,
            capabilities: ["image.search", "image.import"],
          },
        ],
        [],
      ],
    ]);
    const store = createResourceSourceStore(queued.pool);

    await expect(store.listPublished(scope, now)).resolves.toEqual([
      {
        id: sourceId,
        displayName: "Open image source",
        adapterKind: "openverse.v1",
        revisionId: publishedRevisionId,
        capabilities: ["image.search", "image.import"],
      },
    ]);
    expect(queued.remaining()).toBe(0);
  });

  it("adopts an editable Art Text manifest as one immutable internal Revision", async () => {
    const sourceRevisionId = "01K00000000000000000000013";
    const artTextRevisionId = "01K00000000000000000000014";
    const queued = queuedPool([
      [[authorizationRow], []],
      [[], []],
      [[{ id: sourceRevisionId }], []],
      [result(), []],
      [result(), []],
    ]);
    const store = createResourceSourceStore(queued.pool);

    await expect(
      store.adoptArtTextPreset({
        scope,
        sourceId,
        sourceRevisionId,
        artTextPresetRevisionId: artTextRevisionId,
        externalId: "comic-pop",
        manifest: {
          schemaVersion: 1,
          id: "comic-pop",
          revision: `sha256:${"c".repeat(64)}`,
          labels: { "en-US": "Comic Pop" },
          fontRequirements: {
            requiredScripts: ["latin"],
            fallbackCategory: "display",
          },
          fill: { kind: "solid", color: "#ff4f9a" },
          effects: [{ kind: "outline", color: "#151515", width: 7 }],
          letterSpacing: 2,
          lineHeight: 1.1,
          alignment: "center",
          editable: {
            text: true,
            font: true,
            colorSlots: ["primary", "outline"],
          },
          license: {
            licenseId: "CC0-1.0",
            licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
            commercialUseAllowed: true,
            modificationAllowed: true,
            attributionRequired: false,
            shareAlikeRequired: false,
            standaloneRedistributionAllowed: true,
            modelReleaseStatus: "not_applicable",
            propertyReleaseStatus: "not_applicable",
            trademarkRisk: "none_declared",
            capturedAt: now.toISOString(),
            termsDigest: digest,
          },
        },
        provenance: {
          sourcePageUrl: "https://styles.example.com/presets/comic-pop.json",
        },
        idempotencyKey: "adopt-art-text-1",
        now,
        audit,
      }),
    ).resolves.toMatchObject({
      replayed: false,
      value: {
        id: artTextRevisionId,
        sourceId,
        sourceRevisionId,
        externalId: "comic-pop",
      },
    });
    expect(queued.remaining()).toBe(0);
  });

  it("adopts verified font Artifacts into one immutable Font Revision", async () => {
    const sourceRevisionId = "01K00000000000000000000015";
    const fontRevisionId = "01K00000000000000000000016";
    const artifactId = "01K00000000000000000000017";
    const queued = queuedPool([
      [[authorizationRow], []],
      [[], []],
      [[{ id: sourceRevisionId }], []],
      [result(), []],
      [result(), []],
      [result(), []],
    ]);
    const store = createResourceSourceStore(queued.pool);

    await expect(
      store.adoptFontRevision({
        scope,
        sourceId,
        sourceRevisionId,
        fontRevisionId,
        externalId: "inter",
        family: "Inter",
        upstreamVersion: "5.2.7",
        descriptor: {
          category: "sans",
          scripts: ["latin"],
          license: { licenseId: "OFL-1.1" },
        },
        files: [
          {
            artifactId,
            format: "ttf",
            weight: 400,
            style: "normal",
            subset: "latin",
          },
        ],
        idempotencyKey: "adopt-font-1",
        now,
        audit,
      }),
    ).resolves.toMatchObject({
      replayed: false,
      value: {
        id: fontRevisionId,
        family: "Inter",
        sourceRevisionId,
      },
    });
    expect(queued.remaining()).toBe(0);
  });
});
