import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import {
  isBrowserOutputContentType,
  registerRawUploadContentParser,
} from "../src/http/raw-upload-content-parser.js";

describe("raw upload content parser", () => {
  let instance: FastifyInstance | undefined;

  afterEach(async () => {
    await instance?.close();
    instance = undefined;
  });

  it("keeps supported image payloads as backpressured byte streams", async () => {
    instance = fastify();
    registerRawUploadContentParser(instance);
    instance.put("/content", async (request) => {
      const body = request.body as AsyncIterable<Uint8Array>;
      let byteSize = 0;
      for await (const chunk of body) {
        byteSize += chunk.byteLength;
      }
      return { byteSize };
    });

    const response = await instance.inject({
      method: "PUT",
      url: "/content",
      headers: {
        "content-type": "image/png",
      },
      payload: Buffer.from([1, 2, 3, 4]),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ byteSize: 4 });
  });

  it("exposes the exact content-type allowlist used by the route", () => {
    expect(isBrowserOutputContentType("image/png")).toBe(true);
    expect(isBrowserOutputContentType("application/octet-stream")).toBe(true);
    expect(isBrowserOutputContentType("text/plain")).toBe(false);
    expect(isBrowserOutputContentType("image/png; charset=utf-8")).toBe(false);
  });
});
