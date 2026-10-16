import { Readable } from "node:stream";

import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { FastifyReply, FastifyRequest } from "fastify";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";
import { ContentTransferController } from "../src/storage/content-transfer.controller.js";
import type { ContentTransferService } from "../src/storage/content-transfer.service.js";

const ids = Object.freeze({
  workspace: "01K00000000000000000000001",
  organization: "01K00000000000000000000002",
  principal: "01K00000000000000000000003",
  session: "01K00000000000000000000004",
  membership: "01K00000000000000000000005",
  upload: "01K00000000000000000000006",
  artifact: "01K00000000000000000000007",
});

const scope: TrustedWorkspaceScope = {
  workspaceId: ids.workspace,
  organizationId: ids.organization,
  principalId: ids.principal,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: ids.session,
  authorityType: "human_membership",
  authorityId: ids.membership,
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["asset.write", "artifact.download"],
  trusted: true,
};

function createFixture() {
  const request = {
    id: "request-content-transfer",
  } as FastifyRequest;
  const contexts = new RequestAuthorizationContextStore();
  contexts.set(request, {
    authentication: {
      authSubjectId: "01K00000000000000000000008",
      sessionId: ids.session,
      authenticationStrength: "single_factor",
    },
    scope,
  });
  const allocateUserImport = vi
    .fn<ContentTransferService["allocateUserImport"]>()
    .mockResolvedValue({
      uploadSessionId: ids.upload,
      state: "open",
      expiresAt: "2026-07-28T17:00:00.000Z",
      maximumBytes: "1024",
      replayed: false,
    });
  const uploadUserImport = vi
    .fn<ContentTransferService["uploadUserImport"]>()
    .mockResolvedValue({
      uploadSessionId: ids.upload,
      state: "verified",
      replayed: false,
    });
  const commitUserImport = vi
    .fn<ContentTransferService["commitUserImport"]>()
    .mockResolvedValue({
      status: "committed",
      uploadSessionId: ids.upload,
      storedObjectId: "01K00000000000000000000009",
      artifactId: ids.artifact,
      contentDigest: `sha256:${"a".repeat(64)}`,
      mediaType: "image/png",
      byteSize: "4",
      committedAt: "2026-07-28T16:00:00.000Z",
    });
  const prepareArtifactDownload = vi
    .fn<ContentTransferService["prepareArtifactDownload"]>()
    .mockResolvedValue({
      delivery: "proxy",
      status: 206,
      dataClassification: "restricted",
      headers: {
        "accept-ranges": "bytes",
        "cache-control": "private, no-store",
        "content-disposition": 'attachment; filename="source.png"',
        "content-length": "2",
        "content-type": "image/png",
        "content-range": "bytes 1-2/4",
        "x-content-type-options": "nosniff",
      },
      body: Readable.from([Uint8Array.of(2, 3)]),
    });
  const preparePersistedArtifactPreview = vi
    .fn<ContentTransferService["preparePersistedArtifactPreview"]>()
    .mockResolvedValue(undefined);
  const artifactPreviewConfig = vi
    .fn<ContentTransferService["artifactPreviewConfig"]>()
    .mockReturnValue({
      mode: "on_demand",
      fallbackOnMiss: true,
      width: 640,
      height: 640,
      quality: 80,
      effort: 4,
      maximumSourceBytes: 41_943_040,
      workerConcurrency: 2,
      generationAttempts: 3,
      generationRetryMs: 5_000,
      cleanupPollIntervalMs: 30_000,
      cleanupRetryMs: 30_000,
      variantKey: "interactive-preview",
      profileVersion: `artifact-preview-webp-v1:${"a".repeat(64)}`,
    });
  const controller = new ContentTransferController(
    {
      allocateUserImport,
      uploadUserImport,
      commitUserImport,
      prepareArtifactDownload,
      preparePersistedArtifactPreview,
      artifactPreviewConfig,
    } as unknown as ContentTransferService,
    contexts,
  );
  return {
    allocateUserImport,
    commitUserImport,
    controller,
    prepareArtifactDownload,
    preparePersistedArtifactPreview,
    request,
    uploadUserImport,
  };
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

describe("ContentTransferController", () => {
  it("binds User Import commands to the trusted request scope", async () => {
    const fixture = createFixture();
    const raw = Readable.from([Uint8Array.of(1, 2, 3, 4)]);

    await expect(
      fixture.controller.allocate(fixture.request, "import-key", {
        expectedMediaType: "image/png",
        expectedSize: "4",
      }),
    ).resolves.toMatchObject({
      uploadSessionId: ids.upload,
    });
    await expect(
      fixture.controller.upload(
        fixture.request,
        {
          uploadSessionId: ids.upload,
        },
        "image/png",
        raw,
      ),
    ).resolves.toMatchObject({
      state: "verified",
    });
    await fixture.controller.commit(
      fixture.request,
      {
        uploadSessionId: ids.upload,
      },
      {
        artifactType: "source-image",
        dataClassification: "restricted",
      },
    );

    expect(fixture.allocateUserImport).toHaveBeenCalledWith(
      scope,
      "import-key",
      {
        expectedMediaType: "image/png",
        expectedSize: "4",
      },
    );
    expect(fixture.uploadUserImport).toHaveBeenCalledWith(
      scope,
      ids.upload,
      raw,
    );
    expect(fixture.commitUserImport).toHaveBeenCalledWith(
      scope,
      ids.upload,
      {
        artifactType: "source-image",
        dataClassification: "restricted",
      },
      fixture.request.id,
    );
  });

  it("rejects unsupported raw content before storage invocation", async () => {
    const fixture = createFixture();
    await expect(
      fixture.controller.upload(
        fixture.request,
        {
          uploadSessionId: ids.upload,
        },
        "text/plain",
        Readable.from(["untrusted"]),
      ),
    ).rejects.toMatchObject({
      status: 415,
    });
    expect(fixture.uploadUserImport).not.toHaveBeenCalled();
  });

  it("streams an authorized Range download with exact proxy headers", async () => {
    const fixture = createFixture();
    let sentBody: AsyncIterable<Uint8Array> | undefined;
    const headers = vi.fn();
    const status = vi.fn();
    const send = vi.fn((value: unknown) => {
      sentBody = value as AsyncIterable<Uint8Array>;
    });
    const reply = {
      headers,
      status,
      send,
    } as unknown as FastifyReply;

    await fixture.controller.download(
      fixture.request,
      reply,
      {
        artifactId: ids.artifact,
      },
      "bytes=1-2",
    );

    expect(fixture.prepareArtifactDownload).toHaveBeenCalledWith(
      scope,
      ids.artifact,
      "bytes=1-2",
      fixture.request.id,
    );
    expect(status).toHaveBeenCalledWith(206);
    expect(headers).toHaveBeenCalledWith(
      expect.objectContaining({
        "cache-control": "private, no-store",
        "content-range": "bytes 1-2/4",
      }),
    );
    if (!sentBody) {
      throw new Error("Download stream was not sent.");
    }
    await expect(collect(sentBody)).resolves.toEqual(Buffer.from([2, 3]));
  });

  it("reauthorizes and bounds an immutable image preview", async () => {
    const fixture = createFixture();
    const source = await sharp({
      create: {
        width: 1_200,
        height: 800,
        channels: 4,
        background: {
          r: 48,
          g: 72,
          b: 245,
          alpha: 1,
        },
      },
    })
      .png()
      .toBuffer();
    fixture.prepareArtifactDownload.mockResolvedValueOnce({
      delivery: "proxy",
      status: 200,
      dataClassification: "internal",
      headers: {
        "accept-ranges": "bytes",
        "cache-control": "private, no-store",
        "content-disposition": 'attachment; filename="large.png"',
        "content-length": String(source.byteLength),
        "content-type": "image/png",
        "x-content-type-options": "nosniff",
      },
      body: Readable.from([source]),
    });
    const headers = vi.fn();
    const status = vi.fn();
    let sent: Buffer | undefined;
    const reply = {
      headers,
      status,
      send: vi.fn((value: unknown) => {
        sent = value as Buffer;
      }),
    } as unknown as FastifyReply;

    await fixture.controller.preview(fixture.request, reply, {
      artifactId: ids.artifact,
    });

    expect(fixture.prepareArtifactDownload).toHaveBeenCalledWith(
      scope,
      ids.artifact,
      undefined,
      fixture.request.id,
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(headers).toHaveBeenCalledWith(
      expect.objectContaining({
        "cache-control": "private, max-age=86400, must-revalidate",
        "content-type": "image/webp",
      }),
    );
    if (!sent) {
      throw new Error("Preview bytes were not sent.");
    }
    await expect(sharp(sent).metadata()).resolves.toMatchObject({
      format: "webp",
      width: 640,
      height: 427,
    });
  });

  it("streams a persisted preview without reading or transcoding the source", async () => {
    const fixture = createFixture();
    const persisted = Buffer.from("persisted-preview");
    fixture.preparePersistedArtifactPreview.mockResolvedValueOnce({
      headers: {
        "cache-control": "private, max-age=86400, must-revalidate",
        "content-length": String(persisted.byteLength),
        "content-type": "image/webp",
        "x-content-type-options": "nosniff",
      },
      body: Readable.from([persisted]),
    });
    const headers = vi.fn();
    const status = vi.fn();
    const send = vi.fn();
    const reply = { headers, status, send } as unknown as FastifyReply;

    await fixture.controller.preview(fixture.request, reply, {
      artifactId: ids.artifact,
    });

    expect(fixture.prepareArtifactDownload).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(200);
    expect(headers).toHaveBeenCalledWith(
      expect.objectContaining({ "content-type": "image/webp" }),
    );
    expect(send).toHaveBeenCalledOnce();
  });
});
