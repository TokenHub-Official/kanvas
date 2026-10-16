import type { CurrentProviderRouteSnapshot } from "@kanvas/application";
import {
  digestProviderValue,
  type ProviderInvocationExecutionContext,
} from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import { OpenAiCompatibleImageGenerateProviderAdapter } from "../src/provider/openai-compatible-image-generate-provider.js";
import type {
  AuthorizedProviderInvocationRequest,
  ProviderImageOutput,
} from "../src/provider/provider-adapter.js";
import type {
  ProviderHttpRequest,
  ProviderHttpResponse,
  ProviderHttpTransport,
} from "../src/provider/provider-http-transport.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const parameterPolicies = Object.freeze({
  size: Object.freeze({ callerPolicy: "optional" as const }),
  aspectRatio: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  resolution: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  quality: Object.freeze({ callerPolicy: "optional" as const }),
  outputFormat: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  background: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  outputCompression: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  numberOfImages: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  seed: Object.freeze({ callerPolicy: "optional" as const }),
});

function route(
  providerKey: string,
  overrides: Partial<CurrentProviderRouteSnapshot> = {},
): CurrentProviderRouteSnapshot {
  return Object.freeze({
    providerProtocolVersion: 1,
    providerKey,
    apiSurface: "images.generations.v1",
    providerEndpointId: id(1),
    credentialIdentityId: id(2),
    credentialIdentityEpoch: 1,
    pinnedSecretVersionId: id(3),
    credentialIdentityDigest: digest("a"),
    instancePolicyRevisionId: id(4),
    workspacePolicyRevisionId: id(5),
    routePolicyRevisionId: id(6),
    modelProfileRevisionId: id(7),
    modelDeploymentId: id(8),
    pricingRevisionId: id(9),
    budgetAccountId: id(10),
    routingMode:
      providerKey === "openrouter" ? "gateway_managed" : "kanvas_fixed",
    executionTransparency: providerKey === "openrouter" ? "partial" : "full",
    maximumCharge: {
      currencyCode: "USD",
      amount: "2",
    },
    routeCandidateDigest: digest("b"),
    requestScopeDigest: digest("c"),
    queryMode: "none",
    notFoundIsAuthoritative: false,
    modelOperation: "image.generate",
    parameterPolicies,
    parameterPolicyDigest: digest("d"),
    ...overrides,
  });
}

function context(
  currentRoute: CurrentProviderRouteSnapshot,
  preset: "openai" | "openrouter" | "xai" | "newapi",
): ProviderInvocationExecutionContext {
  let endpoint: {
    adapterKind: "openai_compatible" | "openai_native" | "openrouter_native";
    baseUrl: string;
    canonicalOrigin: string;
  } = {
    adapterKind: "openai_compatible",
    baseUrl: "https://newapi.example/v1",
    canonicalOrigin: "https://newapi.example",
  };
  if (preset === "openai") {
    endpoint = {
      adapterKind: "openai_native",
      baseUrl: "https://api.openai.com/v1",
      canonicalOrigin: "https://api.openai.com",
    };
  } else if (preset === "openrouter") {
    endpoint = {
      adapterKind: "openrouter_native",
      baseUrl: "https://openrouter.ai/api/v1",
      canonicalOrigin: "https://openrouter.ai",
    };
  } else if (preset === "xai") {
    endpoint = {
      adapterKind: "openai_compatible",
      baseUrl: "https://api.x.ai/v1",
      canonicalOrigin: "https://api.x.ai",
    };
  }
  const providerModelIds = {
    newapi: "gpt-image-test",
    openai: "gpt-image-test",
    openrouter: "openai/gpt-image-test",
    xai: "grok-imagine-image-quality",
  } as const;
  return Object.freeze({
    invocationId: id(11),
    workspaceId: id(12),
    route: currentRoute,
    implementationConfiguration: Object.freeze({
      promptTemplate: "Create: {{prompt}}",
    }),
    endpoint: Object.freeze({
      id: currentRoute.providerEndpointId,
      adapterKind: endpoint.adapterKind,
      presetKind: preset,
      baseUrl: endpoint.baseUrl,
      canonicalOrigin: endpoint.canonicalOrigin,
      regionCode: preset === "newapi" ? "private" : "global",
      networkPolicy: {},
      dataPolicy: {},
    }),
    model: Object.freeze({
      deploymentId: currentRoute.modelDeploymentId,
      providerModelId: providerModelIds[preset],
      modelProfileRevisionId: currentRoute.modelProfileRevisionId,
      modelProfile: {},
    }),
    pricing: Object.freeze({
      revisionId: currentRoute.pricingRevisionId,
      currencyCode: "USD",
      pricing: {},
    }),
    secret: Object.freeze({
      id: currentRoute.pinnedSecretVersionId,
      workspaceId: id(12),
      credentialId: currentRoute.credentialIdentityId,
      version: 1,
      materialGeneration: 1,
      sourceKind: "deployment_reference",
      lifecycleStatus: "active",
      aadDigest: digest("e"),
      materialFingerprint: digest("f"),
      formatVersion: 1,
      drainDeadlineAt: null,
      deploymentReference: `deployment://provider/${preset}`,
    }),
  });
}

function png(marker = 0): Buffer {
  return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, marker, 0, 0, 0]);
}

function jpeg(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

function webp(marker = 0): Buffer {
  const bytes = Buffer.alloc(16);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WEBP", 8, "ascii");
  bytes[12] = marker;
  return bytes;
}

function artifactBody(artifactId: string, bytes: Uint8Array) {
  return Object.freeze({
    artifactId,
    storedObjectId: id(30),
    artifactType: "image.source",
    dataClassification: "confidential" as const,
    byteSize: String(bytes.byteLength),
    sha256: "0".repeat(64),
    mediaType: "image/png" as const,
    body: (async function* () {
      await Promise.resolve();
      yield bytes;
    })(),
  });
}

function request(
  executionContext: ProviderInvocationExecutionContext,
  input: Readonly<Record<string, unknown>>,
  effectiveParameters: Readonly<Record<string, string | number | boolean>>,
  open = vi.fn(),
): AuthorizedProviderInvocationRequest {
  return Object.freeze({
    route: executionContext.route,
    stableRequestKey: "kanvas:v1:image-generate",
    requestFingerprint: digest("9"),
    input,
    effectiveParameters,
    deadlineAt: new Date(Date.now() + 10_000),
    executionContext,
    credential: Buffer.from("sk-test-only", "utf8"),
    inputArtifacts: { open },
  });
}

function preparedRequest(
  adapter: OpenAiCompatibleImageGenerateProviderAdapter,
  value: AuthorizedProviderInvocationRequest,
): AuthorizedProviderInvocationRequest {
  const prepared = adapter.prepare(value);
  return Object.freeze({
    ...value,
    preparedRequestSnapshot: prepared.snapshot,
    preparedRequestDigest: digestProviderValue(prepared.snapshot),
  });
}

async function bytesFrom(output: ProviderImageOutput): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of output.body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("OpenAI-compatible image generate Provider Adapter", () => {
  it("preserves confirmed usage when the generated image download fails", async () => {
    const confirmed = vi.fn<
      NonNullable<AuthorizedProviderInvocationRequest["onResultConfirmed"]>
    >(() => Promise.resolve());
    const transport = vi.fn(
      (http: ProviderHttpRequest): Promise<ProviderHttpResponse> => {
        if (http.method === "POST")
          return Promise.resolve({
            statusCode: 200,
            headers: {},
            body: { data: [{ url: "https://cdn.x.ai/generated/image.jpg" }] },
          });
        expect(confirmed).toHaveBeenCalledOnce();
        return Promise.reject(new Error("result GET interrupted"));
      },
    );
    const adapter = new OpenAiCompatibleImageGenerateProviderAdapter({
      request: transport,
    });
    const input = request(
      context(route("xai"), "xai"),
      { prompt: "A landscape" },
      { numberOfImages: 1 },
    );
    const prepared: AuthorizedProviderInvocationRequest = {
      ...preparedRequest(adapter, input),
      onResultConfirmed: confirmed,
    };
    await expect(
      adapter.submit(prepared, new AbortController().signal),
    ).rejects.toThrow("result GET interrupted");
    expect(confirmed.mock.calls[0]?.[0].resultEvidence).toEqual({
      urls: ["https://cdn.x.ai/generated/image.jpg"],
      totalCount: 1,
      omittedCount: 0,
    });
    expect(confirmed.mock.calls[0]?.[0].usage).toContainEqual({
      metricKey: "output_images",
      numericValue: "1",
      unitCode: "image",
    });
    expect(
      transport.mock.calls.filter(([call]) => call.method === "POST"),
    ).toHaveLength(1);
  });

  it("prepares a secret-free OpenRouter request and materializes reference-guided Base64 outputs", async () => {
    const referenceId = id(20);
    const source = png(7);
    const first = webp(1);
    const second = webp(2);
    const requestHttp = vi.fn(
      (httpRequest: ProviderHttpRequest): Promise<ProviderHttpResponse> => {
        expect(httpRequest.path).toBe("/images");
        return Promise.resolve({
          statusCode: 200,
          headers: {
            "x-request-id": "req_openrouter_image_1",
          },
          body: {
            data: [
              { b64_json: first.toString("base64") },
              { b64_json: second.toString("base64") },
            ],
            usage: {
              prompt_tokens: 11,
              completion_tokens: 22,
              total_tokens: 33,
              cost: 0.42,
            },
          },
        });
      },
    );
    const adapter = new OpenAiCompatibleImageGenerateProviderAdapter({
      request: requestHttp,
    });
    const currentRoute = route("openrouter");
    const executionContext = context(currentRoute, "openrouter");
    const open = vi.fn().mockResolvedValue(artifactBody(referenceId, source));
    const invocation = request(
      executionContext,
      {
        prompt: "A glass sculpture",
        referenceArtifactIds: [referenceId],
        aspectRatio: "16:9",
        resolution: "2K",
        outputFormat: "webp",
        numberOfImages: 2,
      },
      {
        size: "1024x1024",
        aspectRatio: "16:9",
        resolution: "2K",
        quality: "high",
        outputFormat: "webp",
        background: "transparent",
        outputCompression: 80,
        numberOfImages: 2,
        seed: 42,
      },
      open,
    );

    const prepared = adapter.prepare(invocation);

    expect(prepared.snapshot).toMatchObject({
      schemaVersion: "kanvas.openai-compatible-image-generation-request/v1",
      method: "POST",
      path: "/images",
      provider: {
        preset: "openrouter",
        providerModelId: "openai/gpt-image-test",
      },
      body: {
        model: "openai/gpt-image-test",
        prompt: "Create: A glass sculpture",
        size: "1024x1024",
        aspect_ratio: "16:9",
        resolution: "2K",
        quality: "high",
        output_format: "webp",
        background: "transparent",
        output_compression: 80,
        n: 2,
        seed: 42,
        stream: false,
      },
      referenceArtifactIds: [referenceId],
    });
    expect(JSON.stringify(prepared.snapshot)).not.toContain("sk-test-only");
    expect(JSON.stringify(prepared.snapshot)).not.toContain(
      source.toString("base64"),
    );
    expect(open).not.toHaveBeenCalled();

    const observation = await adapter.submit(
      preparedRequest(adapter, invocation),
      new AbortController().signal,
    );

    expect(open).toHaveBeenCalledWith({
      inputPointer: "/referenceArtifactIds/0",
    });
    const outbound = requestHttp.mock.calls[0]?.[0];
    expect(outbound?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(outbound?.headers.authorization).toBe("Bearer sk-test-only");
    expect(outbound?.headers["idempotency-key"]).toBe(
      "kanvas:v1:image-generate",
    );
    expect(outbound?.body).toMatchObject({
      model: "openai/gpt-image-test",
      prompt: "Create: A glass sculpture",
      input_references: [
        {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${source.toString("base64")}`,
          },
        },
      ],
    });
    expect(observation).toMatchObject({
      status: "succeeded",
      providerRequestId: "req_openrouter_image_1",
      output: {
        schemaVersion: "kanvas.image-generate-result/v1",
        imageArtifactId: {
          $kanvas: "attempt-output-artifact/v1",
          outputRole: "generated",
          outputIndex: 0,
        },
      },
    });
    expect(observation.outputs).toHaveLength(2);
    expect(observation.reportedCharge).toBeUndefined();
    expect(await bytesFrom(observation.outputs![0]!)).toEqual(first);
    expect(await bytesFrom(observation.outputs![1]!)).toEqual(second);
    expect(observation.usage).toEqual(
      expect.arrayContaining([
        {
          metricKey: "output_images",
          numericValue: "2",
          unitCode: "image",
        },
        {
          metricKey: "input_tokens",
          numericValue: "11",
          unitCode: "token",
        },
      ]),
    );
  });

  it("uses xAI's OpenAI-compatible generation path and downloads a bounded URL output", async () => {
    const generated = jpeg();
    const requestHttp = vi.fn(
      (httpRequest: ProviderHttpRequest): Promise<ProviderHttpResponse> => {
        if (httpRequest.method === "POST") {
          return Promise.resolve({
            statusCode: 200,
            headers: {
              "x-request-id": "req_xai_image_1",
            },
            body: {
              data: [
                {
                  url: "https://cdn.x.ai/generated/image-1.jpg",
                },
              ],
            },
          });
        }
        return Promise.resolve({
          statusCode: 200,
          headers: {
            "content-type": "image/jpeg",
          },
          body: Buffer.from(generated),
        });
      },
    );
    const adapter = new OpenAiCompatibleImageGenerateProviderAdapter({
      request: requestHttp,
    });
    const currentRoute = route("xai");
    const executionContext = context(currentRoute, "xai");
    const invocation = request(
      executionContext,
      { prompt: "A spacecraft over Mars" },
      {
        aspectRatio: "16:9",
        resolution: "2k",
        quality: "medium",
        numberOfImages: 1,
      },
    );

    const observation = await adapter.submit(
      preparedRequest(adapter, invocation),
      new AbortController().signal,
    );

    expect(requestHttp).toHaveBeenCalledTimes(2);
    expect(requestHttp.mock.calls[0]?.[0]).toMatchObject({
      baseUrl: "https://api.x.ai/v1",
      path: "/images/generations",
      method: "POST",
      body: {
        model: "grok-imagine-image-quality",
        prompt: "Create: A spacecraft over Mars",
        aspect_ratio: "16:9",
        resolution: "2k",
        quality: "medium",
        n: 1,
      },
    });
    expect(requestHttp.mock.calls[1]?.[0]).toMatchObject({
      baseUrl: "https://cdn.x.ai",
      path: "/generated/image-1.jpg",
      method: "GET",
      responseMode: "binary",
    });
    expect(observation).toMatchObject({
      status: "succeeded",
      providerRequestId: "req_xai_image_1",
    });
    expect(await bytesFrom(observation.outputs![0]!)).toEqual(generated);
  });

  it("fails closed when a generation preset cannot represent reference Artifacts", () => {
    const currentRoute = route("openai");
    const executionContext = context(currentRoute, "openai");
    const adapter = new OpenAiCompatibleImageGenerateProviderAdapter({
      request: vi.fn(),
    } satisfies ProviderHttpTransport);
    const invocation = request(
      executionContext,
      {
        prompt: "Restyle this image",
        referenceArtifactIds: [id(20)],
      },
      {},
    );

    expect(() => adapter.prepare(invocation)).toThrow(
      /cannot safely express referenceArtifactIds/u,
    );
  });

  it("rejects a prepared request whose persisted digest was changed", async () => {
    const requestHttp = vi.fn();
    const adapter = new OpenAiCompatibleImageGenerateProviderAdapter({
      request: requestHttp,
    } satisfies ProviderHttpTransport);
    const currentRoute = route("openai");
    const executionContext = context(currentRoute, "openai");
    const invocation = request(
      executionContext,
      { prompt: "A ceramic lamp" },
      {
        size: "1024x1024",
        quality: "high",
        outputFormat: "png",
      },
    );
    const prepared = adapter.prepare(invocation);

    await expect(
      adapter.submit(
        {
          ...invocation,
          preparedRequestSnapshot: prepared.snapshot,
          preparedRequestDigest: digest("0"),
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/differs from its digest/u);
    expect(requestHttp).not.toHaveBeenCalled();
  });

  it("rejects effective fields that are not pinned by the Route policy", () => {
    const currentRoute = route("newapi");
    const executionContext = context(currentRoute, "newapi");
    const adapter = new OpenAiCompatibleImageGenerateProviderAdapter({
      request: vi.fn(),
    } satisfies ProviderHttpTransport);
    const invocation = request(
      executionContext,
      { prompt: "A poster" },
      {
        moderation: "low",
      },
    );

    expect(() => adapter.prepare(invocation)).toThrow(
      /outside the pinned Adapter contract/u,
    );
  });

  it("rejects provider-wire aliases as capability parameters", () => {
    const currentRoute = route("openai");
    const executionContext = context(currentRoute, "openai");
    const adapter = new OpenAiCompatibleImageGenerateProviderAdapter({
      request: vi.fn(),
    } satisfies ProviderHttpTransport);
    const invocation = request(
      executionContext,
      { prompt: "A poster" },
      { n: 2 },
    );

    expect(() => adapter.prepare(invocation)).toThrow(
      /outside the pinned Adapter contract/u,
    );
  });
});
