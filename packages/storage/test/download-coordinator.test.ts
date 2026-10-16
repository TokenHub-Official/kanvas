import type {
  ArtifactDownloadAuthorizationAllow,
  ArtifactDownloadAuthorizationPort,
  StorageCapabilities,
  StoragePort,
} from "@kanvas/application";
import type {
  AuthorizedCommittedObject,
  StorageUploadStore,
} from "@kanvas/database";
import { describe, expect, it, vi } from "vitest";

import {
  ArtifactDownloadError,
  createArtifactDownloadCoordinator,
  type ArtifactDownloadStore,
} from "../src/download-coordinator.js";
import { createStorageProfileRegistry } from "../src/storage-profile-registry.js";

const ids = Object.freeze({
  principal: "01K00000000000000000000201",
  workspace: "01K00000000000000000000202",
  artifact: "01K00000000000000000000203",
  stored: "01K00000000000000000000204",
  profile: "01K00000000000000000000205",
  decision: "01K00000000000000000000206",
});
const digest = "a".repeat(64);
const identityHash = `sha256:${"b".repeat(64)}`;
const now = new Date("2026-07-28T01:00:00.000Z");

const capabilities: StorageCapabilities = Object.freeze({
  uploadModes: ["server_stream"] as const,
  writeProtectionModes: ["server_owned"] as const,
  multipart: false,
  fullObjectChecksum: true,
  rangeRead: true,
  versionBoundIdentity: false,
  sealedIdentityImmutable: true,
  deploymentScope: "single_node",
  maximumObjectBytes: String(Number.MAX_SAFE_INTEGER),
  serverSideEncryption: "not_provided",
});

const allow: ArtifactDownloadAuthorizationAllow = Object.freeze({
  decision: "allow",
  decisionId: ids.decision,
  principalId: ids.principal,
  workspaceId: ids.workspace,
  artifactId: ids.artifact,
  purpose: "download",
  dataClassification: "restricted",
  authorizationVersion: 7,
  proxyRequired: false,
  validUntil: new Date("2026-07-28T01:05:00.000Z"),
});

function committed(
  overrides: Partial<AuthorizedCommittedObject> = {},
): AuthorizedCommittedObject {
  return {
    artifactId: ids.artifact,
    storedObjectId: ids.stored,
    artifactType: "image",
    dataClassification: "restricted",
    displayFilename: "../../unsafe\r\nHeader: yes.png",
    storageProfileId: ids.profile,
    container: "artifacts",
    objectKey: "v1/output.png",
    immutableIdentityHash: identityHash,
    byteSize: "10",
    sha256: digest,
    mediaType: "image/png",
    ...overrides,
  };
}

function bytes(value: string): AsyncIterable<Uint8Array> {
  const iterator = [Buffer.from(value)][Symbol.iterator]();
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return Promise.resolve(iterator.next());
        },
      };
    },
  };
}

const defaultOpenRead: StoragePort["openRead"] = (request) =>
  Promise.resolve({
    identity: request.identity,
    totalByteSize: request.expectedByteSize,
    contentByteSize: request.range
      ? (
          BigInt(request.range.endInclusive) -
          BigInt(request.range.start) +
          1n
        ).toString()
      : request.expectedByteSize,
    ...(request.range ? { range: request.range } : {}),
    body: bytes("body"),
  });

function port(
  openRead: StoragePort["openRead"] = vi.fn(defaultOpenRead),
  kind: StoragePort["kind"] = "local",
): StoragePort {
  return {
    storageProfileId: ids.profile,
    kind,
    capabilities:
      kind === "local"
        ? capabilities
        : {
            ...capabilities,
            deploymentScope: "distributed",
            serverSideEncryption: "provider_managed",
          },
    writeObject: vi.fn(),
    sealObject: vi.fn(),
    inspectObject: vi.fn(),
    openRead,
    deleteObject: vi.fn(),
    cleanupUnpublishedObject: vi.fn(),
  };
}

function authorization(
  initial: Awaited<
    ReturnType<ArtifactDownloadAuthorizationPort["authorize"]>
  > = allow,
  revalidated: Awaited<
    ReturnType<ArtifactDownloadAuthorizationPort["revalidate"]>
  > = allow,
): ArtifactDownloadAuthorizationPort {
  return {
    authorize: vi.fn().mockResolvedValue(initial),
    revalidate: vi.fn().mockResolvedValue(revalidated),
  };
}

function store(
  object: AuthorizedCommittedObject = committed(),
): ArtifactDownloadStore {
  return {
    readAuthorizedCommittedObject: vi
      .fn<StorageUploadStore["readAuthorizedCommittedObject"]>()
      .mockResolvedValue(object),
  };
}

function coordinator(
  artifactStore: ArtifactDownloadStore,
  auth: ArtifactDownloadAuthorizationPort,
  storagePort: StoragePort,
  clock: () => Date = () => now,
) {
  return createArtifactDownloadCoordinator({
    store: artifactStore,
    authorization: auth,
    profiles: createStorageProfileRegistry([
      {
        storageProfileId: ids.profile,
        kind: storagePort.kind,
        adapter: storagePort,
      },
    ]),
    now: clock,
  });
}

const request = Object.freeze({
  principalId: ids.principal,
  workspaceId: ids.workspace,
  artifactId: ids.artifact,
  purpose: "download",
});

describe("artifact download coordinator", () => {
  it("denies before DB lookup and never treats caller input as classification authority", async () => {
    const artifactStore = store();
    const storagePort = port();
    const auth = authorization({
      decision: "deny",
      disclosure: "not_found",
      reasonCode: "policy.denied",
    });
    const readObject = vi.mocked(artifactStore.readAuthorizedCommittedObject);
    const openObject = vi.mocked(storagePort.openRead);

    await expect(
      coordinator(artifactStore, auth, storagePort).prepare(request),
    ).rejects.toBeInstanceOf(ArtifactDownloadError);
    await expect(
      coordinator(artifactStore, auth, storagePort).prepare(request),
    ).rejects.toMatchObject({
      code: "artifact_download.denied",
      disclosure: "not_found",
    });
    expect(readObject).not.toHaveBeenCalled();
    expect(openObject).not.toHaveBeenCalled();
  });

  it("proxies restricted Local objects with exact committed facts, strict range, and safe headers", async () => {
    const artifactStore = store();
    const openRead = vi
      .fn<StoragePort["openRead"]>()
      .mockImplementation((readRequest) =>
        Promise.resolve({
          identity: readRequest.identity,
          totalByteSize: "10",
          contentByteSize: "4",
          range: { start: "6", endInclusive: "9" },
          body: bytes("6789"),
        }),
      );
    const storagePort = port(openRead);
    const auth = authorization();
    const readObject = vi.mocked(artifactStore.readAuthorizedCommittedObject);
    const prepared = await coordinator(
      artifactStore,
      auth,
      storagePort,
    ).prepare({
      ...request,
      rangeHeader: "bytes=-4",
    });

    expect(readObject).toHaveBeenCalledWith({
      workspaceId: ids.workspace,
      artifactId: ids.artifact,
      allowedDataClassifications: ["restricted"],
    });
    expect(openRead).toHaveBeenCalledWith({
      identity: {
        storageProfileId: ids.profile,
        container: "artifacts",
        objectKey: "v1/output.png",
      },
      expectedByteSize: "10",
      expectedSha256: digest,
      expectedImmutableIdentityHash: identityHash,
      range: { start: "6", endInclusive: "9" },
    });
    expect(prepared).toMatchObject({
      delivery: "proxy",
      status: 206,
      dataClassification: "restricted",
      headers: {
        "accept-ranges": "bytes",
        "cache-control": "private, no-store",
        "content-length": "4",
        "content-range": "bytes 6-9/10",
        "content-type": "image/png",
        "x-content-type-options": "nosniff",
      },
    });
    expect(prepared.headers["content-disposition"]).not.toMatch(/[\r\n]/u);
    expect(prepared.headers["content-disposition"]).toContain(
      "filename*=UTF-8''",
    );
    expect(Object.keys(prepared)).not.toContain("path");
    expect(Object.keys(prepared)).not.toContain("url");
    const output: Uint8Array[] = [];
    for await (const chunk of prepared.body) {
      output.push(chunk);
    }
    expect(Buffer.concat(output).toString()).toBe("6789");
  });

  it("uses the same reauthorized proxy contract for an S3 profile", async () => {
    const openRead = vi
      .fn<StoragePort["openRead"]>()
      .mockImplementation(defaultOpenRead);
    const storagePort = port(openRead, "s3");
    const prepared = await coordinator(
      store(),
      authorization(),
      storagePort,
    ).prepare(request);

    expect(prepared).toMatchObject({
      delivery: "proxy",
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-length": "10",
      },
    });
    expect(openRead).toHaveBeenCalledOnce();
  });

  it("revalidates immediately before open and fails closed on revocation", async () => {
    const artifactStore = store();
    const storagePort = port();
    const auth = authorization(allow, {
      decision: "deny",
      disclosure: "forbidden",
      reasonCode: "membership.revoked",
    });
    const revalidate = vi.mocked(auth.revalidate);
    const openObject = vi.mocked(storagePort.openRead);

    await expect(
      coordinator(artifactStore, auth, storagePort).prepare(request),
    ).rejects.toMatchObject({
      code: "artifact_download.revoked",
      disclosure: "forbidden",
    });
    expect(revalidate).toHaveBeenCalledWith(allow, now);
    expect(openObject).not.toHaveBeenCalled();
  });

  it.each([
    ["bytes=0-1,4-5", "artifact_download.range_invalid"],
    ["bytes=5-4", "artifact_download.range_unsatisfiable"],
    ["bytes=10-", "artifact_download.range_unsatisfiable"],
    ["bytes=-0", "artifact_download.range_unsatisfiable"],
    ["items=0-1", "artifact_download.range_invalid"],
  ])("rejects unsupported range %s", async (rangeHeader, code) => {
    const storagePort = port();
    const openObject = vi.mocked(storagePort.openRead);
    await expect(
      coordinator(store(), authorization(), storagePort).prepare({
        ...request,
        rangeHeader,
      }),
    ).rejects.toMatchObject({ code });
    expect(openObject).not.toHaveBeenCalled();
  });

  it("does not fall back to another profile or accept changed revalidation bindings", async () => {
    const storagePort = port();
    const openObject = vi.mocked(storagePort.openRead);
    const wrongProfileStore = store(
      committed({
        storageProfileId: "01K00000000000000000000999",
      }),
    );
    await expect(
      coordinator(wrongProfileStore, authorization(), storagePort).prepare(
        request,
      ),
    ).rejects.toMatchObject({
      code: "artifact_download.unavailable",
    });
    expect(openObject).not.toHaveBeenCalled();

    const changed = {
      ...allow,
      decisionId: "01K00000000000000000000888",
    } satisfies ArtifactDownloadAuthorizationAllow;
    await expect(
      coordinator(store(), authorization(allow, changed), storagePort).prepare(
        request,
      ),
    ).rejects.toMatchObject({
      code: "artifact_download.revoked",
    });
    expect(openObject).not.toHaveBeenCalled();
  });

  it("rejects expired authorization before DB access", async () => {
    const artifactStore = store();
    const storagePort = port();
    const expired = {
      ...allow,
      validUntil: new Date("2026-07-28T00:59:59.000Z"),
    } satisfies ArtifactDownloadAuthorizationAllow;
    const readObject = vi.mocked(artifactStore.readAuthorizedCommittedObject);
    await expect(
      coordinator(artifactStore, authorization(expired), storagePort).prepare(
        request,
      ),
    ).rejects.toMatchObject({
      code: "artifact_download.denied",
    });
    expect(readObject).not.toHaveBeenCalled();
  });
});
