import sharp from "sharp";
import "reflect-metadata";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import type { TrustedInstanceAdministratorScope } from "@kanvas/application";
import { ToolVersionBodySchema } from "@kanvas/contracts/api";
import { InstanceAccessStoreError } from "@kanvas/database";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { SiteToolsController } from "../src/http/site-tools.controller.js";
import { InstanceAdministratorContextStore } from "../src/http/instance-administrator-context.js";
import { InstanceAdministratorGuard } from "../src/http/instance-administrator.guard.js";
import { ContractBodyPipe } from "../src/http/contract-body.pipe.js";
import { inspectHtmlTool } from "../src/tools/html-tool-inspection.js";

const scope: TrustedInstanceAdministratorScope = {
  instanceId: "tools",
  principalId: "01K00000000000000000000001",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "test-session",
  authorityType: "instance_administrator",
  authorityId: "01K00000000000000000000001",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  trusted: true,
};
function fixture() {
  const request = {} as FastifyRequest;
  const contexts = new InstanceAdministratorContextStore();
  contexts.set(request, {
    scope,
    authentication: {
      authSubjectId: "user",
      sessionId: "test-session",
      authenticationStrength: "single_factor",
    },
  });
  const mutate = vi
    .fn<ServerDatabaseRuntime["siteTools"]["mutate"]>()
    .mockResolvedValue({ toolId: scope.principalId, version: 2 });
  const uploadImage = vi
    .fn<ServerDatabaseRuntime["siteToolImages"]["upload"]>()
    .mockResolvedValue({ imageId: scope.principalId });
  return {
    request,
    mutate,
    uploadImage,
    controller: new SiteToolsController(
      {
        siteTools: { mutate },
        siteToolImages: { upload: uploadImage },
      } as unknown as ServerDatabaseRuntime,
      contexts,
    ),
  };
}
describe("site tool maintenance HTTP boundary", () => {
  it("uses site administrator guard for the whole controller", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SiteToolsController)).toContain(
      InstanceAdministratorGuard,
    );
  });
  it("checks only through server inspection, rejecting client supplied success or scope", async () => {
    const { request, mutate, controller } = fixture();
    const pipe = new ContractBodyPipe(ToolVersionBodySchema);
    expect(() => pipe.transform({ expectedVersion: 1, passed: true })).toThrow(
      BadRequestException,
    );
    expect(() =>
      pipe.transform({ expectedVersion: 1, workspaceId: scope.principalId }),
    ).toThrow(BadRequestException);
    await controller.check(request, scope.principalId, "check-1", {
      expectedVersion: 1,
    });
    expect(mutate).toHaveBeenCalledWith(
      scope,
      "check-1",
      { kind: "check", toolId: scope.principalId, expectedVersion: 1 },
      inspectHtmlTool,
    );
  });
  it("requires retry identity and rejects noncanonical HTML encoding", async () => {
    const { request, mutate, controller } = fixture();
    await expect(
      controller.publish(request, scope.principalId, undefined, {
        expectedVersion: 1,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(() =>
      controller.upload(request, scope.principalId, "upload-1", {
        expectedVersion: 1,
        filename: "tool.html",
        contentBase64: "not base64",
      }),
    ).toThrow(BadRequestException);
    expect(mutate).not.toHaveBeenCalled();
  });
  it("normalizes image bytes before storing and rejects executable artwork", async () => {
    const { request, uploadImage, controller } = fixture();
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "blue" },
    })
      .jpeg()
      .toBuffer();
    await controller.uploadImage(request, "image-1", {
      contentBase64: bytes.toString("base64"),
    });
    expect(uploadImage).toHaveBeenCalledOnce();
    const normalized = uploadImage.mock.calls[0]![2];
    expect((await sharp(normalized.bytes).metadata()).format).toBe("png");
    expect(uploadImage.mock.calls[0]![0]).toBe(scope);
    await expect(
      controller.uploadImage(request, "image-2", {
        contentBase64: Buffer.from(
          "<svg><script>alert(1)</script></svg>",
        ).toString("base64"),
      }),
    ).rejects.toThrow(BadRequestException);
    expect(uploadImage).toHaveBeenCalledOnce();
  });

  it("maps revoked authority to a forbidden response", async () => {
    const { request, mutate, controller } = fixture();
    mutate.mockRejectedValue(
      new InstanceAccessStoreError("instance_access.forbidden", "Revoked"),
    );
    await expect(
      controller.publish(request, scope.principalId, "publish-1", {
        expectedVersion: 1,
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
