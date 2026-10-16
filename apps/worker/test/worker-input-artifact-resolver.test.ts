import { createHash } from "node:crypto";

import type { StoragePort } from "@kanvas/application";
import {
  StorageUploadStoreError,
  type AuthorizedCommittedObject,
  type StorageUploadStore,
} from "@kanvas/database/runtime";
import type { TrustedImageStorageRuntime } from "@kanvas/storage";
import { describe, expect, it, vi } from "vitest";

import {
  WorkerInputArtifactResolutionError,
  createWorkerInputArtifactResolver,
} from "../src/storage/worker-input-artifact-resolver.js";

function ulid(suffix: string): string {
  return `01K${"0".repeat(23 - suffix.length)}${suffix}`;
}

const ids = Object.freeze({
  workspace: ulid("1"),
  artifact: ulid("2"),
  storedObject: ulid("3"),
  profile: ulid("4"),
});
const bytes = new Uint8Array([137, 80, 78, 71]);
const sha256 = createHash("sha256").update(bytes).digest("hex");

function committedObject(
  overrides: Partial<AuthorizedCommittedObject> = {},
): AuthorizedCommittedObject {
  return Object.freeze({
    artifactId: ids.artifact,
    storedObjectId: ids.storedObject,
    artifactType: "image.source",
    dataClassification: "confidential",
    displayFilename: "source.png",
    storageProfileId: ids.profile,
    container: "private-objects",
    objectKey: "do/not/expose/this/key",
    immutableIdentityHash: `sha256:${"a".repeat(64)}`,
    byteSize: bytes.byteLength.toString(),
    sha256,
    mediaType: "image/png",
    ...overrides,
  });
}

function createResolver(options: {
  readonly object?: AuthorizedCommittedObject;
  readonly readAuthorizedCommittedObject?: StorageUploadStore["readAuthorizedCommittedObject"];
  readonly openRead?: StoragePort["openRead"];
  readonly createProviderReadUrl?: StoragePort["createProviderReadUrl"];
  readonly maximumInputBytes?: number;
  readonly authorizeConsumerArtifact?: () => Promise<void>;
}) {
  const readAuthorizedCommittedObject =
    options.readAuthorizedCommittedObject ??
    vi.fn().mockResolvedValue(options.object ?? committedObject());
  const openRead =
    options.openRead ??
    vi.fn().mockResolvedValue({
      identity: {
        storageProfileId: ids.profile,
        container: "private-objects",
        objectKey: "do/not/expose/this/key",
      },
      totalByteSize: bytes.byteLength.toString(),
      contentByteSize: bytes.byteLength.toString(),
      body: (async function* () {
        await Promise.resolve();
        yield bytes;
      })(),
    });
  const adapter = {
    openRead,
    ...(options.createProviderReadUrl
      ? {
          createProviderReadUrl: options.createProviderReadUrl,
        }
      : {}),
  } as unknown as StoragePort;
  const runtime = {
    maximumInputBytes: options.maximumInputBytes ?? 1024,
    profiles: {
      resolve: (storageProfileId: string) =>
        storageProfileId === ids.profile
          ? {
              storageProfileId: ids.profile,
              kind: "local" as const,
              adapter,
            }
          : undefined,
    },
  } as unknown as TrustedImageStorageRuntime;
  return {
    readAuthorizedCommittedObject,
    openRead,
    resolver: createWorkerInputArtifactResolver({
      runtime,
      ...(options.authorizeConsumerArtifact
        ? { authorizeConsumerArtifact: options.authorizeConsumerArtifact }
        : {}),
      store: {
        readAuthorizedCommittedObject,
      },
      allowedDataClassifications: ["internal", "confidential"],
    }),
  };
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<number[]> {
  const collected: number[] = [];
  for await (const chunk of body) {
    collected.push(...chunk);
  }
  return collected;
}

describe("Worker input Artifact resolver", () => {
  it("rechecks consumer access before delayed body and URL access", async () => {
    const authorizeConsumerArtifact = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    const createProviderReadUrl = vi.fn().mockResolvedValue({
      url: "https://example.com/image",
      expiresAt: new Date(),
    });
    const { resolver, openRead } = createResolver({
      authorizeConsumerArtifact,
      createProviderReadUrl,
    });
    const access = resolver.bind({
      workspaceId: ids.workspace,
      capabilityRunId: ulid("8"),
      input: { sourceArtifactId: ids.artifact },
      signal: new AbortController().signal,
    });
    const file = await access.open({ inputPointer: "/sourceArtifactId" });
    authorizeConsumerArtifact.mockRejectedValue(new Error("revoked"));
    await expect(collect(file.body)).rejects.toMatchObject({
      stage: "authorize",
    });
    await expect(file.createProviderReadUrl!(60)).rejects.toMatchObject({
      stage: "authorize",
    });
    expect(openRead).not.toHaveBeenCalled();
    expect(createProviderReadUrl).not.toHaveBeenCalled();
  });
  it("fails before metadata access when consumer authorization is missing", async () => {
    const { resolver, readAuthorizedCommittedObject } = createResolver({});
    await expect(
      resolver
        .bind({
          workspaceId: ids.workspace,
          capabilityRunId: ulid("8"),
          input: { sourceArtifactId: ids.artifact },
          signal: new AbortController().signal,
        })
        .open({ inputPointer: "/sourceArtifactId" }),
    ).rejects.toMatchObject({ stage: "unavailable" });
    expect(readAuthorizedCommittedObject).not.toHaveBeenCalled();
  });
  it("exposes only an on-demand provider URL function after Artifact authorization", async () => {
    const createProviderReadUrl = vi.fn().mockResolvedValue({
      url: "https://private.example/source.png?signature=redacted",
      expiresAt: new Date(Date.now() + 900_000),
    });
    const { resolver } = createResolver({
      createProviderReadUrl,
    });
    const access = resolver.bind({
      workspaceId: ids.workspace,
      input: { sourceArtifactId: ids.artifact },
      signal: new AbortController().signal,
    });
    const opened = await access.open({
      inputPointer: "/sourceArtifactId",
    });

    expect(opened).not.toHaveProperty("objectKey");
    await expect(opened.createProviderReadUrl?.(900)).resolves.toBe(
      "https://private.example/source.png?signature=redacted",
    );
    expect(createProviderReadUrl).toHaveBeenCalledWith({
      identity: {
        storageProfileId: ids.profile,
        container: "private-objects",
        objectKey: "do/not/expose/this/key",
      },
      expectedByteSize: String(bytes.byteLength),
      expectedSha256: sha256,
      expectedImmutableIdentityHash: `sha256:${"a".repeat(64)}`,
      responseContentType: "image/png",
      expiresInSeconds: 900,
    });
  });

  it("binds access to an Artifact ULID in Attempt input and hides storage identity", async () => {
    const { resolver, readAuthorizedCommittedObject, openRead } =
      createResolver({});
    const access = resolver.bind({
      workspaceId: ids.workspace,
      input: {
        items: [
          {
            sourceArtifactId: ids.artifact,
          },
        ],
      },
      signal: new AbortController().signal,
    });

    const artifact = await access.open({
      inputPointer: "/items/0/sourceArtifactId",
    });

    expect(readAuthorizedCommittedObject).toHaveBeenCalledWith({
      workspaceId: ids.workspace,
      artifactId: ids.artifact,
      allowedDataClassifications: ["internal", "confidential"],
    });
    expect(openRead).not.toHaveBeenCalled();
    expect(artifact).toMatchObject({
      artifactId: ids.artifact,
      storedObjectId: ids.storedObject,
      artifactType: "image.source",
      dataClassification: "confidential",
      displayFilename: "source.png",
      byteSize: "4",
      sha256,
      mediaType: "image/png",
    });
    expect(JSON.stringify(artifact)).not.toContain("do/not/expose/this/key");
    expect(JSON.stringify(artifact)).not.toContain("private-objects");
    await expect(collect(artifact.body)).resolves.toEqual([137, 80, 78, 71]);
    expect(openRead).toHaveBeenCalledWith({
      identity: {
        storageProfileId: ids.profile,
        container: "private-objects",
        objectKey: "do/not/expose/this/key",
      },
      expectedByteSize: bytes.byteLength.toString(),
      expectedSha256: sha256,
      expectedImmutableIdentityHash: `sha256:${"a".repeat(64)}`,
    });
    await expect(collect(artifact.body)).rejects.toMatchObject({
      stage: "read",
    });
  });

  it("rejects unresolved and non-Artifact pointers before database access", async () => {
    const { resolver, readAuthorizedCommittedObject } = createResolver({});
    const access = resolver.bind({
      workspaceId: ids.workspace,
      input: {
        sourceArtifactId: "not-an-artifact-id",
      },
      signal: new AbortController().signal,
    });

    await expect(
      access.open({
        inputPointer: "/sourceArtifactId",
      }),
    ).rejects.toMatchObject({
      stage: "validate",
    });
    await expect(
      access.open({
        inputPointer: "/missing",
      }),
    ).rejects.toMatchObject({
      stage: "validate",
    });
    expect(readAuthorizedCommittedObject).not.toHaveBeenCalled();
  });

  it("fails closed when committed-object authorization is denied", async () => {
    const { resolver, openRead } = createResolver({
      readAuthorizedCommittedObject: vi
        .fn()
        .mockRejectedValue(
          new StorageUploadStoreError(
            "storage_upload.access_denied",
            "secret database detail",
          ),
        ),
    });
    const access = resolver.bind({
      workspaceId: ids.workspace,
      input: {
        sourceArtifactId: ids.artifact,
      },
      signal: new AbortController().signal,
    });

    await expect(
      access.open({
        inputPointer: "/sourceArtifactId",
      }),
    ).rejects.toMatchObject({
      name: "WorkerInputArtifactResolutionError",
      stage: "authorize",
    });
    expect(openRead).not.toHaveBeenCalled();
  });

  it("rejects oversized or unsupported images before opening storage", async () => {
    const { resolver, openRead } = createResolver({
      object: committedObject({
        byteSize: "1025",
      }),
      maximumInputBytes: 1024,
    });
    const access = resolver.bind({
      workspaceId: ids.workspace,
      input: {
        sourceArtifactId: ids.artifact,
      },
      signal: new AbortController().signal,
    });

    await expect(
      access.open({
        inputPointer: "/sourceArtifactId",
      }),
    ).rejects.toBeInstanceOf(WorkerInputArtifactResolutionError);
    expect(openRead).not.toHaveBeenCalled();
  });

  it("checks the streamed body against committed size and digest facts", async () => {
    const { resolver } = createResolver({
      openRead: vi.fn().mockResolvedValue({
        identity: {
          storageProfileId: ids.profile,
          container: "private-objects",
          objectKey: "do/not/expose/this/key",
        },
        totalByteSize: "4",
        contentByteSize: "4",
        body: (async function* () {
          await Promise.resolve();
          yield new Uint8Array([1, 2, 3, 4]);
        })(),
      }),
    });
    const access = resolver.bind({
      workspaceId: ids.workspace,
      input: {
        sourceArtifactId: ids.artifact,
      },
      signal: new AbortController().signal,
    });
    const artifact = await access.open({
      inputPointer: "/sourceArtifactId",
    });

    await expect(collect(artifact.body)).rejects.toMatchObject({
      stage: "read",
    });
  });

  it("does not open storage when the Attempt is cancelled before body consumption", async () => {
    const { resolver, openRead } = createResolver({});
    const cancellation = new AbortController();
    const access = resolver.bind({
      workspaceId: ids.workspace,
      input: {
        sourceArtifactId: ids.artifact,
      },
      signal: cancellation.signal,
    });
    const artifact = await access.open({
      inputPointer: "/sourceArtifactId",
    });

    cancellation.abort(new Error("attempt lease lost"));

    await expect(collect(artifact.body)).rejects.toThrow("attempt lease lost");
    expect(openRead).not.toHaveBeenCalled();
  });
});
