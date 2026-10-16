import "reflect-metadata";
import fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  registerSiteToolUploadLimit,
  siteToolUploadBodyLimit,
} from "../src/http/site-tool-upload-limit.js";
import { SiteToolsController } from "../src/http/site-tools.controller.js";

describe("site tool upload HTTP body limit", () => {
  it.each(["uploadImage", "upload"] as const)(
    "accepts a 2 MiB file encoded as JSON on %s",
    async (method) => {
      const app = fastify();
      registerSiteToolUploadLimit(app);
      const config = Reflect.getMetadata(
        "__fastify_route_config__",
        Object.getOwnPropertyDescriptor(SiteToolsController.prototype, method)!
          .value as object,
      ) as { siteToolUpload: boolean };
      app.post("/upload", { config }, (request) =>
        Promise.resolve({
          bytes: Buffer.from(
            (request.body as { contentBase64: string }).contentBase64,
            "base64",
          ).length,
        }),
      );
      try {
        const response = await app.inject({
          method: "POST",
          url: "/upload",
          payload: {
            contentBase64: Buffer.alloc(2 * 1024 * 1024).toString("base64"),
          },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ bytes: 2 * 1024 * 1024 });
      } finally {
        await app.close();
      }
    },
  );
  it("keeps oversized uploads and ordinary routes bounded", async () => {
    const app = fastify();
    registerSiteToolUploadLimit(app);
    app.post("/upload", { config: { siteToolUpload: true } }, () =>
      Promise.resolve({
        ok: true,
      }),
    );
    app.post("/ordinary", () => Promise.resolve({ ok: true }));
    try {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/upload",
            payload: { contentBase64: "a".repeat(siteToolUploadBodyLimit) },
          })
        ).statusCode,
      ).toBe(413);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/ordinary",
            payload: { value: "a".repeat(1024 * 1024) },
          })
        ).statusCode,
      ).toBe(413);
    } finally {
      await app.close();
    }
  });
});
