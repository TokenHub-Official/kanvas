import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  createTrustedProxyPolicy,
  parseTrustedProxyCidrs,
} from "../src/trusted-proxy.js";

describe("reverse-proxy address boundary", () => {
  it("rejects spoofed forwarded headers from a direct client", async () => {
    const app = Fastify({
      trustProxy: createTrustedProxyPolicy(
        1,
        parseTrustedProxyCidrs(undefined),
      ),
    });
    app.get("/", (request) => ({
      ip: request.ip,
      host: request.host,
      protocol: request.protocol,
    }));
    try {
      const response = await app.inject({
        url: "/",
        remoteAddress: "203.0.113.10",
        headers: {
          host: "origin.example.com",
          "x-forwarded-for": "198.51.100.20",
          "x-forwarded-host": "spoofed.example.com",
          "x-forwarded-proto": "https",
        },
      });
      expect(response.json()).toEqual({
        ip: "203.0.113.10",
        host: "origin.example.com",
        protocol: "http",
      });
    } finally {
      await app.close();
    }
  });

  it("accepts the standalone loopback proxy and stops at the configured hop count", async () => {
    const app = Fastify({
      trustProxy: createTrustedProxyPolicy(
        1,
        parseTrustedProxyCidrs(undefined),
      ),
    });
    app.get("/", (request) => ({
      ip: request.ip,
      host: request.host,
      protocol: request.protocol,
    }));
    try {
      const response = await app.inject({
        url: "/",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "localhost",
          "x-forwarded-for": "198.51.100.1, 203.0.113.10",
          "x-forwarded-host": "kanvas.example.com",
          "x-forwarded-proto": "https",
        },
      });
      expect(response.json()).toEqual({
        ip: "203.0.113.10",
        host: "kanvas.example.com",
        protocol: "https",
      });
    } finally {
      await app.close();
    }
  });

  it("requires an admitted address at every trusted hop", () => {
    const trust = createTrustedProxyPolicy(
      2,
      parseTrustedProxyCidrs("10.20.0.0/24,::1/128"),
    );
    expect(trust).not.toBe(false);
    if (trust === false) throw new Error("Expected trust function");
    expect(trust("10.20.0.7", 0)).toBe(true);
    expect(trust("::1", 1)).toBe(true);
    expect(trust("203.0.113.9", 0)).toBe(false);
    expect(trust("10.20.0.7", 2)).toBe(false);
    expect(createTrustedProxyPolicy(0, ["127.0.0.1"])).toBe(false);
    expect(() => parseTrustedProxyCidrs("")).toThrow();
    expect(() => parseTrustedProxyCidrs("not-an-address")).toThrow();
  });
});
