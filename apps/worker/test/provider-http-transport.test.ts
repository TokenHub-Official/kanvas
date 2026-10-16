import type { lookup as dnsLookup } from "node:dns/promises";
import { createServer, type Server, type Socket } from "node:net";

import { describe, expect, it, vi } from "vitest";

import {
  createPinnedProviderLookup,
  createProviderHttpTransport,
  isBlockedProviderAddress,
} from "../src/provider/provider-http-transport.js";

describe("Provider HTTP transport", () => {
  async function listen(server: Server): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test proxy did not expose a TCP address.");
    }
    return address.port;
  }

  async function close(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  it("honors Node 22 lookup all mode while keeping the socket pinned", async () => {
    const lookup = createPinnedProviderLookup({
      address: "203.0.113.10",
      family: 4,
    });
    const all = await new Promise<unknown>((resolve, reject) => {
      lookup(
        "provider.example",
        {
          all: true,
        },
        (error, address) => (error ? reject(error) : resolve(address)),
      );
    });
    const one = await new Promise<{
      readonly address: unknown;
      readonly family: number | undefined;
    }>((resolve, reject) => {
      lookup(
        "provider.example",
        {
          all: false,
        },
        (error, address, family) =>
          error
            ? reject(error)
            : resolve({
                address,
                family,
              }),
      );
    });

    expect(all).toEqual([
      {
        address: "203.0.113.10",
        family: 4,
      },
    ]);
    expect(one).toEqual({
      address: "203.0.113.10",
      family: 4,
    });
  });

  it("keeps the serialized body intact until the socket write completes", async () => {
    let observedBody = "";
    const server = createServer((socket: Socket) => {
      let buffered = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        const headerEnd = buffered.indexOf("\r\n\r\n");
        if (headerEnd < 0) {
          return;
        }
        const headers = buffered.subarray(0, headerEnd).toString("ascii");
        const lengthMatch = /content-length: ([0-9]+)/iu.exec(headers);
        const contentLength = Number(lengthMatch?.[1] ?? "0");
        const body = buffered.subarray(headerEnd + 4);
        if (body.byteLength < contentLength) {
          return;
        }
        observedBody = body.subarray(0, contentLength).toString("utf8");
        const response = JSON.stringify({ ok: true });
        socket.end(
          `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${String(
            Buffer.byteLength(response),
          )}\r\nconnection: close\r\n\r\n${response}`,
        );
      });
    });
    const port = await listen(server);
    try {
      const transport = createProviderHttpTransport({
        allowedOrigins: [`http://127.0.0.1:${String(port)}`],
        allowPrivateNetworks: true,
        allowHttp: true,
        maximumRequestBytes: 1024,
        maximumResponseBytes: 1024,
      });
      await expect(
        transport.request({
          baseUrl: `http://127.0.0.1:${String(port)}`,
          path: "/generation/tasks",
          method: "POST",
          headers: {},
          body: {
            model: "gpt-image-2-edit",
            images: ["https://image.example/source.png"],
          },
          deadlineAt: new Date(Date.now() + 10_000),
          signal: new AbortController().signal,
        }),
      ).resolves.toMatchObject({
        statusCode: 200,
        body: { ok: true },
      });
      expect(JSON.parse(observedBody)).toEqual({
        model: "gpt-image-2-edit",
        images: ["https://image.example/source.png"],
      });
    } finally {
      await close(server);
    }
  });

  it("blocks local, metadata, documentation and mapped private addresses", () => {
    expect(isBlockedProviderAddress("127.0.0.1")).toBe(true);
    expect(isBlockedProviderAddress("169.254.169.254")).toBe(true);
    expect(isBlockedProviderAddress("10.20.30.40")).toBe(true);
    expect(isBlockedProviderAddress("192.0.2.10")).toBe(true);
    expect(isBlockedProviderAddress("::1")).toBe(true);
    expect(isBlockedProviderAddress("fc00::1")).toBe(true);
    expect(isBlockedProviderAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedProviderAddress("8.8.8.8")).toBe(false);
    expect(isBlockedProviderAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("fails before I/O when DNS includes a forbidden address", async () => {
    const forbiddenLookup = (() =>
      Promise.resolve([
        {
          address: "203.0.113.7",
          family: 4,
        },
      ])) as unknown as typeof dnsLookup;
    const transport = createProviderHttpTransport({
      allowedOrigins: ["https://provider.example"],
      allowPrivateNetworks: false,
      allowHttp: false,
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
      lookup: forbiddenLookup,
    });

    await expect(
      transport.request({
        baseUrl: "https://provider.example/v1",
        path: "/responses",
        method: "POST",
        headers: {},
        body: {},
        deadlineAt: new Date(Date.now() + 10_000),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      stableErrorCode: "provider.transport_address_forbidden",
      effect: "not_started",
    });
  });

  it("keeps DNS protection when the optional deployment allowlist is absent", async () => {
    const forbiddenLookup = (() =>
      Promise.resolve([
        {
          address: "203.0.113.7",
          family: 4,
        },
      ])) as unknown as typeof dnsLookup;
    const transport = createProviderHttpTransport({
      allowPrivateNetworks: false,
      allowHttp: false,
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
      lookup: forbiddenLookup,
    });

    await expect(
      transport.request({
        baseUrl: "https://provider.example/v1",
        path: "/responses",
        method: "POST",
        headers: {},
        body: {},
        deadlineAt: new Date(Date.now() + 10_000),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      stableErrorCode: "provider.transport_address_forbidden",
      effect: "not_started",
    });
  });

  it("keeps DNS protection for result URLs with default download settings", async () => {
    const forbiddenLookup = (() =>
      Promise.resolve([
        {
          address: "203.0.113.7",
          family: 4,
        },
      ])) as unknown as typeof dnsLookup;
    const transport = createProviderHttpTransport({
      allowPrivateNetworks: false,
      allowHttp: false,
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
      lookup: forbiddenLookup,
    });

    await expect(
      transport.request({
        baseUrl: "https://provider.example/v1",
        targetKind: "provider_result",
        path: "/responses",
        method: "POST",
        headers: {},
        body: {},
        deadlineAt: new Date(Date.now() + 10_000),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      stableErrorCode: "provider.transport_address_forbidden",
      effect: "not_started",
    });
  });

  it("uses only an explicit CONNECT proxy and leaves target DNS to that trust boundary", async () => {
    const proxy = createServer((socket: Socket) => {
      let buffered = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        const text = buffered.toString("utf8");
        if (text.startsWith("CONNECT ")) {
          if (!text.includes("\r\n\r\n")) {
            return;
          }
          expect(text).toContain("CONNECT provider.example:80 ");
          buffered = Buffer.alloc(0);
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          return;
        }
        if (!text.includes("\r\n\r\n")) {
          return;
        }
        expect(text).toContain("GET /responses HTTP/1.1");
        const body = JSON.stringify({ ok: true });
        socket.end(
          `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${String(Buffer.byteLength(body))}\r\nconnection: close\r\n\r\n${body}`,
        );
      });
    });
    const port = await listen(proxy);
    let lookupCalled = false;
    const lookup = (() => {
      lookupCalled = true;
      throw new Error("Target DNS must not run outside the proxy.");
    }) as unknown as typeof dnsLookup;
    try {
      const transport = createProviderHttpTransport({
        allowedOrigins: ["http://provider.example"],
        proxyUrl: `http://127.0.0.1:${String(port)}`,
        allowPrivateNetworks: false,
        allowHttp: true,
        maximumRequestBytes: 1024,
        maximumResponseBytes: 1024,
        lookup,
      });
      await expect(
        transport.request({
          baseUrl: "http://provider.example",
          path: "/responses",
          method: "GET",
          headers: {},
          deadlineAt: new Date(Date.now() + 10_000),
          signal: new AbortController().signal,
        }),
      ).resolves.toMatchObject({
        statusCode: 200,
        body: { ok: true },
      });
      expect(lookupCalled).toBe(false);
    } finally {
      await close(proxy);
    }
  });

  it("rejects proxy credentials and path escapes", () => {
    expect(() =>
      createProviderHttpTransport({
        allowedOrigins: ["https://provider.example"],
        proxyUrl: "http://user:secret@127.0.0.1:7890/path",
        allowPrivateNetworks: false,
        allowHttp: false,
        maximumRequestBytes: 1024,
        maximumResponseBytes: 1024,
      }),
    ).toThrow(/exact HTTP\(S\) origin without credentials/u);
  });

  it("downloads result bytes with omitted optional switches and origin lists", async () => {
    const server = createServer((socket: Socket) => {
      socket.once("data", () =>
        socket.end(
          "HTTP/1.1 200 OK\r\ncontent-type: image/png\r\ncontent-length: 3\r\nconnection: close\r\n\r\nimg",
        ),
      );
    });
    const port = await listen(server);
    try {
      // Local fixture transport overrides only; production defaults reject these addresses.
      const transport = createProviderHttpTransport({
        allowHttp: true,
        allowPrivateNetworks: true,
        maximumRequestBytes: 1024,
        maximumResponseBytes: 1024,
      });
      await expect(
        transport.request({
          baseUrl: `http://127.0.0.1:${port}`,
          path: "/image.png?signature=fixture",
          method: "GET",
          headers: {},
          targetKind: "provider_result",
          responseMode: "binary",
          deadlineAt: new Date(Date.now() + 10000),
          signal: new AbortController().signal,
        }),
      ).resolves.toMatchObject({ statusCode: 200, body: Buffer.from("img") });
    } finally {
      await close(server);
    }
  });

  it("never forwards credentials to a result URL", async () => {
    const transport = createProviderHttpTransport({
      allowPrivateNetworks: false,
      allowHttp: false,
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
    });
    for (const name of ["Authorization", "Cookie", "Proxy-Authorization"]) {
      await expect(
        transport.request({
          baseUrl: "https://8.8.8.8",
          path: "/image.png",
          method: "GET",
          headers: { [name]: "fixture-credential" },
          targetKind: "provider_result",
          deadlineAt: new Date(Date.now() + 10000),
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/must not forward credentials/u);
    }
  });

  it("keeps Provider result downloads behind a separate switch and exact-origin allowlist", async () => {
    const disabled = createProviderHttpTransport({
      resultDownloadsEnabled: false,
      resultAllowedOrigins: ["https://result.example"],
      allowPrivateNetworks: false,
      allowHttp: false,
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
    });
    const enabled = createProviderHttpTransport({
      resultDownloadsEnabled: true,
      resultAllowedOrigins: ["https://result.example"],
      allowPrivateNetworks: false,
      allowHttp: false,
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
    });
    const request = {
      path: "/output.png",
      method: "GET" as const,
      headers: {},
      responseMode: "binary" as const,
      targetKind: "provider_result" as const,
      deadlineAt: new Date(Date.now() + 10_000),
      signal: new AbortController().signal,
    };

    await expect(
      disabled.request({
        ...request,
        baseUrl: "https://result.example",
      }),
    ).rejects.toMatchObject({
      stableErrorCode: "provider.output_download_disabled",
      effect: "not_started",
    });
    await expect(
      enabled.request({
        ...request,
        baseUrl: "https://untrusted-result.example",
      }),
    ).rejects.toMatchObject({
      stableErrorCode: "provider.output_origin_not_allowed",
      effect: "not_started",
    });
  });

  it("reads governed policy for each download and fails closed before network access", async () => {
    const resolveResultPolicy = vi.fn().mockResolvedValue({
      version: null,
      source: "environment",
      enabled: true,
      allowedOrigins: [],
    });
    const recordResultPolicyDecision = vi.fn().mockResolvedValue(undefined);
    const lookup = vi.fn();
    const transport = createProviderHttpTransport({
      resolveResultPolicy,
      recordResultPolicyDecision,
      lookup,
      allowPrivateNetworks: false,
      allowHttp: false,
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
    });
    const request = {
      baseUrl: "https://result.example",
      path: "/result",
      method: "GET" as const,
      headers: {},
      responseMode: "binary" as const,
      targetKind: "provider_result" as const,
      deadlineAt: new Date(Date.now() + 10_000),
      signal: new AbortController().signal,
      resultPolicyContext: {
        workspaceId: "workspace",
        providerEndpointId: "endpoint",
      },
    };
    await expect(transport.request(request)).rejects.toMatchObject({
      stableErrorCode: "provider.output_origin_not_allowed",
    });
    expect(recordResultPolicyDecision).toHaveBeenLastCalledWith({
      context: request.resultPolicyContext,
      origin: "https://result.example",
      version: null,
      source: "environment",
      outcome: "provider.output_origin_not_allowed",
    });
    resolveResultPolicy.mockResolvedValueOnce({
      source: "instance",
      version: 2,
      enabled: false,
      allowedOrigins: ["https://result.example"],
    });
    await expect(transport.request(request)).rejects.toMatchObject({
      stableErrorCode: "provider.output_download_disabled",
    });
    expect(recordResultPolicyDecision).toHaveBeenLastCalledWith({
      context: request.resultPolicyContext,
      origin: "https://result.example",
      version: 2,
      source: "instance",
      outcome: "provider.output_download_disabled",
    });
    resolveResultPolicy.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(transport.request(request)).rejects.toMatchObject({
      stableErrorCode: "provider.output_policy_unavailable",
    });
    const unscoped = { ...request };
    Reflect.deleteProperty(unscoped, "resultPolicyContext");
    await expect(transport.request(unscoped)).rejects.toMatchObject({
      stableErrorCode: "provider.output_policy_unavailable",
    });
    expect(resolveResultPolicy).toHaveBeenCalledTimes(3);
    expect(resolveResultPolicy).toHaveBeenCalledWith(
      request.resultPolicyContext,
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(
      transport.isResultUrlAllowed?.("https://result.example/result"),
    ).toBe(false);
  });

  it("does not interpret an explicitly empty origin restriction as absent", () => {
    expect(() =>
      createProviderHttpTransport({
        allowedOrigins: [],
        allowPrivateNetworks: false,
        allowHttp: false,
        maximumRequestBytes: 1024,
        maximumResponseBytes: 1024,
      }),
    ).toThrow(/At least one Provider origin/u);
  });

  it("rejects protocol, origin, header and request-size escapes before I/O", async () => {
    const transport = createProviderHttpTransport({
      allowedOrigins: ["https://8.8.8.8"],
      allowPrivateNetworks: false,
      allowHttp: false,
      maximumRequestBytes: 16,
      maximumResponseBytes: 1024,
    });
    const common = {
      path: "/responses",
      method: "POST" as const,
      deadlineAt: new Date(Date.now() + 10_000),
      signal: new AbortController().signal,
    };

    await expect(
      transport.request({
        ...common,
        baseUrl: "http://8.8.8.8",
        headers: {},
        body: {},
      }),
    ).rejects.toThrow(/forbidden protocol/u);
    await expect(
      transport.request({
        ...common,
        baseUrl: "https://1.1.1.1",
        headers: {},
        body: {},
      }),
    ).rejects.toThrow(/origin is not in the deployment allowlist/u);
    await expect(
      transport.request({
        ...common,
        baseUrl: "https://8.8.8.8",
        headers: {
          host: "attacker.example",
        },
        body: {},
      }),
    ).rejects.toThrow(/header is invalid or reserved/u);
    await expect(
      transport.request({
        ...common,
        baseUrl: "https://8.8.8.8",
        headers: {},
        body: {
          input: "far too large",
        },
      }),
    ).rejects.toThrow(/request body exceeds/u);
    await expect(
      transport.request({
        ...common,
        baseUrl: "https://8.8.8.8",
        headers: {},
        body: {},
        binaryBody: new Uint8Array([1]),
        contentType: "multipart/form-data; boundary=test",
      }),
    ).rejects.toThrow(/both JSON and binary/u);
    await expect(
      transport.request({
        ...common,
        baseUrl: "https://8.8.8.8",
        headers: {},
        binaryBody: new Uint8Array(17),
        contentType: "multipart/form-data; boundary=test",
      }),
    ).rejects.toThrow(/request body exceeds/u);
    await expect(
      transport.request({
        ...common,
        baseUrl: "https://8.8.8.8",
        headers: {},
        binaryBody: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/requires a bounded content type/u);
  });

  it("rejects an expired deadline before resolving or opening a socket", async () => {
    const transport = createProviderHttpTransport({
      allowedOrigins: ["https://8.8.8.8"],
      allowPrivateNetworks: false,
      allowHttp: false,
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
    });

    await expect(
      transport.request({
        baseUrl: "https://8.8.8.8",
        path: "/responses",
        method: "GET",
        headers: {},
        deadlineAt: new Date(Date.now() - 1),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      stableErrorCode: "provider.transport_deadline_exceeded",
      effect: "not_started",
    });
  });

  it("finishes a streaming response when its terminal event arrives", async () => {
    const server = createServer((socket: Socket) => {
      socket.once("data", () => {
        socket.write(
          "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: keep-alive\r\n\r\ndata: [DONE]\n\n",
        );
      });
    });
    const port = await listen(server);
    try {
      const transport = createProviderHttpTransport({
        allowedOrigins: [`http://127.0.0.1:${String(port)}`],
        allowPrivateNetworks: true,
        allowHttp: true,
        maximumRequestBytes: 1024,
        maximumResponseBytes: 1024,
      });

      await expect(
        transport.request({
          baseUrl: `http://127.0.0.1:${String(port)}`,
          path: "/responses",
          method: "GET",
          headers: {},
          responseMode: "binary",
          onData: (chunk) =>
            Buffer.from(chunk).includes(Buffer.from("data: [DONE]"))
              ? "complete"
              : undefined,
          deadlineAt: new Date(Date.now() + 10_000),
          signal: new AbortController().signal,
        }),
      ).resolves.toMatchObject({
        statusCode: 200,
        body: Buffer.from("data: [DONE]\n\n"),
      });
    } finally {
      await close(server);
    }
  });

  it("exposes a bounded live response body before the terminal event", async () => {
    const server = createServer((socket: Socket) => {
      socket.once("data", () => {
        socket.write(
          "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\ndata: first\n\n",
        );
        setTimeout(() => socket.end("data: [DONE]\n\n"), 20);
      });
    });
    const port = await listen(server);
    try {
      const transport = createProviderHttpTransport({
        allowedOrigins: [`http://127.0.0.1:${String(port)}`],
        allowPrivateNetworks: true,
        allowHttp: true,
        maximumRequestBytes: 1024,
        maximumResponseBytes: 1024,
      });
      const response = await transport.request({
        baseUrl: `http://127.0.0.1:${String(port)}`,
        path: "/responses",
        method: "GET",
        headers: {},
        responseMode: "stream",
        deadlineAt: new Date(Date.now() + 10_000),
        signal: new AbortController().signal,
      });

      expect(response.body).toBeInstanceOf(ReadableStream);
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const first = await reader.read();
      expect(Buffer.from(first.value ?? []).toString("utf8")).toBe(
        "data: first\n\n",
      );
      const terminal = await reader.read();
      expect(Buffer.from(terminal.value ?? []).toString("utf8")).toBe(
        "data: [DONE]\n\n",
      );
      await expect(reader.read()).resolves.toMatchObject({ done: true });
    } finally {
      await close(server);
    }
  });

  it("enforces the absolute deadline while a response keeps streaming", async () => {
    const server = createServer((socket: Socket) => {
      socket.on("error", () => {
        // The client intentionally resets this socket at the absolute deadline.
      });
      socket.once("data", () => {
        socket.write(
          "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n",
        );
        const interval = setInterval(() => socket.write("data: {}\n\n"), 5);
        socket.once("close", () => clearInterval(interval));
      });
    });
    const port = await listen(server);
    try {
      const transport = createProviderHttpTransport({
        allowedOrigins: [`http://127.0.0.1:${String(port)}`],
        allowPrivateNetworks: true,
        allowHttp: true,
        maximumRequestBytes: 1024,
        maximumResponseBytes: 1024,
      });

      await expect(
        transport.request({
          baseUrl: `http://127.0.0.1:${String(port)}`,
          path: "/responses",
          method: "GET",
          headers: {},
          responseMode: "binary",
          deadlineAt: new Date(Date.now() + 50),
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({
        stableErrorCode: "provider.transport_deadline_exceeded",
        effect: "unknown",
      });
    } finally {
      await close(server);
    }
  });
});
