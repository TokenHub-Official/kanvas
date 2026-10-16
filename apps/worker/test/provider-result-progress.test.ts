import { createServer, type Server } from "node:http";
import type { lookup } from "node:dns/promises";
import { expect, it } from "vitest";
import { createProviderHttpTransport } from "../src/provider/provider-http-transport.js";

async function listen(server: Server, host: string, port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing address");
  return address.port;
}

it.each(["GET", "POST"] as const)(
  "escapes a slow trickle for %s without retrying paid submissions",
  async (method) => {
    let fallbackCalls = 0;
    const slow = createServer((_req, res) => {
      res.writeHead(200, { "content-length": "1000" });
      res.write("x");
      const timer = setInterval(() => res.write("x"), 10);
      res.once("close", () => clearInterval(timer));
    });
    const fast = createServer((_req, res) => {
      fallbackCalls++;
      res.end("complete");
    });
    try {
      const port = await listen(slow, "127.0.0.1");
      await listen(fast, "::1", port);
      const transport = createProviderHttpTransport({
        allowHttp: true,
        allowPrivateNetworks: true,
        maximumRequestBytes: 1024,
        maximumResponseBytes: 2048,
        lookup: (() =>
          Promise.resolve([
            { address: "127.0.0.1", family: 4 },
            { address: "::1", family: 6 },
          ])) as unknown as typeof lookup,
        resultTimeouts: {
          connectMs: 300,
          headersMs: 300,
          firstByteMs: 300,
          idleMs: 300,
          progressWindowMs: 80,
          minimumBytesPerSecond: 1024,
          addressMs: 1000,
        },
      });
      const result = transport.request({
        baseUrl: `http://result.test:${port}`,
        path: "/file",
        method,
        headers: {},
        targetKind: "provider_result",
        responseMode: "binary",
        deadlineAt: new Date(Date.now() + 2000),
        signal: new AbortController().signal,
      });
      if (method === "GET")
        await expect(result).resolves.toMatchObject({
          body: Buffer.from("complete"),
        });
      else
        await expect(result).rejects.toMatchObject({
          stableErrorCode: "provider.transport_slow_transfer",
        });
      expect(fallbackCalls).toBe(method === "GET" ? 1 : 0);
    } finally {
      for (const server of [slow, fast]) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  },
);

it("only offers HTTPS result URLs allowed by the deployed result policy", () => {
  const transport = createProviderHttpTransport({
    allowHttp: false,
    allowPrivateNetworks: false,
    maximumRequestBytes: 1024,
    maximumResponseBytes: 1024,
    resultAllowedOrigins: ["https://files.example.test"],
  });
  expect(
    transport.isResultUrlAllowed?.(
      "https://files.example.test/image.png?signature=opaque",
    ),
  ).toBe(true);
  for (const url of [
    "https://other.example.test/a",
    "javascript:alert(1)",
    "https://user:pass@files.example.test/a",
    "http://files.example.test/a",
    "https://127.0.0.1/a",
  ])
    expect(transport.isResultUrlAllowed?.(url)).toBe(false);
});
