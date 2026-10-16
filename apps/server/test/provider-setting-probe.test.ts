import { describe, expect, it, vi } from "vitest";

import {
  blockedProviderAddress,
  probeProviderSetting,
  requestProviderBinary,
} from "../src/provider/provider-setting-probe.js";
import type {
  ProviderProbeRequester,
  ProviderSettingProbeError,
} from "../src/provider/provider-setting-probe.js";

describe("Provider setting remote probe", () => {
  it("rejects unsafe or unbounded external binary downloads before network access", async () => {
    await expect(
      requestProviderBinary({
        url: "http://127.0.0.1/private.png",
        headers: {},
        maximumBytes: 1024,
      }),
    ).rejects.toMatchObject({ code: "unsafe_endpoint" });
    await expect(
      requestProviderBinary({
        url: "https://example.com/image.png",
        headers: {},
        maximumBytes: Number.MAX_SAFE_INTEGER,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
  ])("blocks non-public or mapped Provider address %s", (address) => {
    expect(blockedProviderAddress(address)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "allows public Provider address %s",
    (address) => {
      expect(blockedProviderAddress(address)).toBe(false);
    },
  );

  it.each([
    ["openai", "https://api.openai.com/v1", "/models/gpt-image-1"],
    [
      "xai",
      "https://api.x.ai/v1",
      "/image-generation-models/grok-imagine-image",
    ],
    [
      "gemini",
      "https://generativelanguage.googleapis.com/v1beta",
      "/models/gemini-3.1-flash-image-preview",
    ],
    ["anthropic", "https://api.anthropic.com/v1", "/models/claude-sonnet-4-6"],
  ] as const)(
    "uses the read-only %s model endpoint",
    async (preset, baseUrl, expectedPath) => {
      const request = vi.fn<ProviderProbeRequester>().mockResolvedValue({
        statusCode: 200,
        body: {},
      });
      await probeProviderSetting(
        {
          preset,
          baseUrl,
          apiKey: Buffer.from("test-key"),
          modelKeys: {
            anthropic: ["claude-sonnet-4-6"],
            gemini: ["gemini-3.1-flash-image-preview"],
            newapi: ["gpt-image-2"],
            openai: ["gpt-image-1"],
            openrouter: ["gpt-image-2"],
            tokenhub: ["gpt-image-2"],
            xai: ["grok-imagine-image"],
          }[preset],
        },
        request,
      );
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ path: expectedPath }),
      );
      if (preset === "anthropic") {
        expect(request).toHaveBeenCalledWith(
          expect.objectContaining({
            headers: {
              "anthropic-version": "2023-06-01",
              "x-api-key": "test-key",
            },
          }),
        );
      }
    },
  );

  it.each([
    ["newapi", "https://newapi.example.com/v1", "/models"],
    ["tokenhub", "https://us-api.tokenhub.com", "/v1/models"],
  ] as const)(
    "checks the %s model catalog without generating an image",
    async (preset, baseUrl, expectedPath) => {
      const request = vi.fn<ProviderProbeRequester>().mockResolvedValue({
        statusCode: 200,
        body: { data: [{ id: "gpt-image-2" }] },
      });
      await probeProviderSetting(
        {
          preset,
          baseUrl,
          apiKey: Buffer.from("test-key"),
          modelKeys: ["gpt-image-2"],
        },
        request,
      );
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ path: expectedPath }),
      );
    },
  );

  it("authenticates OpenRouter before checking image model access", async () => {
    const request = vi.fn<ProviderProbeRequester>().mockResolvedValue({
      statusCode: 200,
      body: {},
    });
    await probeProviderSetting(
      {
        preset: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: Buffer.from("test-key"),
        modelKeys: ["openai/gpt-image-1"],
      },
      request,
    );
    expect(request.mock.calls.map(([value]) => value.path)).toEqual([
      "/key",
      "/images/models/openai/gpt-image-1/endpoints",
    ]);
  });

  it("reports an invalid credential without exposing the remote body", async () => {
    await expect(
      probeProviderSetting(
        {
          preset: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKey: Buffer.from("bad-key"),
          modelKeys: ["gpt-image-1"],
        },
        () =>
          Promise.resolve({
            statusCode: 401,
            body: { error: "secret remote detail" },
          }),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ProviderSettingProbeError>>({
        code: "authentication_failed",
        message: "API Key 无效或已失效。",
      }),
    );
  });
});
