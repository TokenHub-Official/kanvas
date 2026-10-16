import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  downloadModelResource,
  hasOnlyPublicAddresses,
  normalizeHuggingFaceFileUrl,
} from "../src/model-resource/secure-model-download.js";

describe("secure model download", () => {
  it("turns Hugging Face browser links into stable file downloads", () => {
    expect(
      normalizeHuggingFaceFileUrl(
        "https://huggingface.co/acme/isnet/blob/main/model.onnx",
      ).toString(),
    ).toBe("https://huggingface.co/acme/isnet/resolve/main/model.onnx");
  });

  it("follows long signed download redirects", async () => {
    const location = `https://cdn.example/${"a".repeat(512)}`;
    const responses = [
      Object.assign(Readable.from([]), {
        headers: { location },
        statusCode: 302,
      }) as IncomingMessage,
      Object.assign(Readable.from([Buffer.from("x")]), {
        headers: { "content-length": "1" },
        statusCode: 200,
      }) as IncomingMessage,
    ];
    const request = vi.fn(
      (
        _url: URL,
        _options: unknown,
        callback: (response: IncomingMessage) => void,
      ) => {
        const response = responses.shift();
        if (!response) throw new Error("Unexpected model download request.");
        queueMicrotask(() => callback(response));
        return Object.assign(new EventEmitter(), {
          end: vi.fn(),
        }) as unknown as ClientRequest;
      },
    );

    const download = await downloadModelResource({
      url: "https://models.example/model.onnx",
      maximumBytes: 10,
      deadlineAt: new Date(Date.now() + 10_000),
      lookup: vi.fn().mockResolvedValue([{ address: "1.1.1.1", family: 4 }]),
      request: request as never,
    });
    const chunks: Uint8Array[] = [];
    for await (const chunk of download.body) chunks.push(chunk);

    expect(Buffer.concat(chunks).toString()).toBe("x");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects a DNS answer set when any address is private", () => {
    expect(hasOnlyPublicAddresses([{ address: "1.1.1.1", family: 4 }])).toBe(
      true,
    );
    expect(
      hasOnlyPublicAddresses([
        { address: "1.1.1.1", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    ).toBe(false);
    expect(hasOnlyPublicAddresses([{ address: "::1", family: 6 }])).toBe(false);
  });

  it("uses only an explicit CONNECT proxy without resolving the target locally", async () => {
    const lookup = vi.fn().mockRejectedValue(new Error("DNS must not run"));
    const request = vi.fn((_url: unknown, options: unknown) => {
      if (!options || typeof options !== "object" || !("agent" in options)) {
        throw new Error("Proxy agent missing");
      }
      expect(options.agent).toBeDefined();
      throw new Error("request reached");
    });

    await expect(
      downloadModelResource({
        url: "https://models.example/model.onnx",
        maximumBytes: 1_048_576,
        deadlineAt: new Date(Date.now() + 10_000),
        proxyUrl: "http://127.0.0.1:7890",
        lookup: lookup as never,
        request,
      }),
    ).rejects.toThrow("request reached");
    expect(lookup).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
  });

  it("rejects credential-bearing model import proxies before I/O", async () => {
    await expect(
      downloadModelResource({
        url: "https://models.example/model.onnx",
        maximumBytes: 1_048_576,
        deadlineAt: new Date(Date.now() + 10_000),
        proxyUrl: "http://user:secret@127.0.0.1:7890/path",
        request: vi.fn() as never,
      }),
    ).rejects.toThrow(/exact HTTP\(S\) origin without credentials/u);
  });
});
