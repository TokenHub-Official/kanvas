import { createHash } from "node:crypto";

import type { CurrentProviderRouteSnapshot } from "@kanvas/application";
import {
  digestProviderValue,
  type ProviderInvocationExecutionContext,
} from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import { GeminiImageProviderAdapter } from "../src/provider/gemini-image-provider.js";
import {
  ProviderAdapterContractError,
  type AuthorizedProviderInvocationRequest,
  type ProviderRequestPreparationRequest,
} from "../src/provider/provider-adapter.js";
import type {
  ProviderHttpRequest,
  ProviderHttpTransport,
} from "../src/provider/provider-http-transport.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0x03, 0xff, 0xd9]);

function route(
  operation: "image.generate" | "image.edit",
): CurrentProviderRouteSnapshot {
  return Object.freeze({
    providerProtocolVersion: 1,
    providerKey: "gemini",
    apiSurface: "generate-content.image.v1",
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
    routingMode: "kanvas_fixed",
    executionTransparency: "full",
    maximumCharge: {
      currencyCode: "USD",
      amount: "2",
    },
    routeCandidateDigest: digest("b"),
    requestScopeDigest: digest("c"),
    queryMode: "none",
    notFoundIsAuthoritative: false,
    modelOperation: operation,
    parameterPolicies: Object.freeze({
      aspectRatio: Object.freeze({
        callerPolicy: "optional" as const,
      }),
      resolution: Object.freeze({
        callerPolicy: "optional" as const,
      }),
      outputFormat: Object.freeze({
        callerPolicy: "optional" as const,
      }),
    }),
    parameterPolicyDigest: digest("d"),
  });
}

function context(
  currentRoute: CurrentProviderRouteSnapshot,
): ProviderInvocationExecutionContext {
  return Object.freeze({
    invocationId: id(11),
    workspaceId: id(12),
    route: currentRoute,
    implementationConfiguration: Object.freeze({
      promptTemplate: "Art direction:\n{{prompt}}",
      providerParameters: Object.freeze({}),
    }),
    endpoint: Object.freeze({
      id: currentRoute.providerEndpointId,
      adapterKind: "gemini_native",
      presetKind: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      canonicalOrigin: "https://generativelanguage.googleapis.com",
      regionCode: "global",
      networkPolicy: {},
      dataPolicy: {},
    }),
    model: Object.freeze({
      deploymentId: currentRoute.modelDeploymentId,
      providerModelId: "gemini-3.1-flash-image-preview",
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
      deploymentReference: "deployment://provider/gemini",
    }),
  });
}

function preparationRequest(options: {
  readonly operation: "image.generate" | "image.edit";
  readonly input: unknown;
  readonly effectiveParameters?: Readonly<
    Record<string, string | number | boolean>
  >;
}): ProviderRequestPreparationRequest {
  const currentRoute = route(options.operation);
  return Object.freeze({
    route: currentRoute,
    stableRequestKey: `kanvas:v1:${options.operation}`,
    requestFingerprint: digest("9"),
    input: options.input,
    ...(options.effectiveParameters
      ? {
          effectiveParameters: options.effectiveParameters,
        }
      : {}),
    deadlineAt: new Date(Date.now() + 10_000),
    executionContext: context(currentRoute),
  });
}

function artifact(
  artifactId: string,
  bytes: Uint8Array,
  mediaType: "image/png" | "image/jpeg" | "image/webp" = "image/png",
) {
  return Object.freeze({
    artifactId,
    storedObjectId: id(90),
    artifactType: "image.source",
    dataClassification: "confidential" as const,
    byteSize: String(bytes.byteLength),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mediaType,
    body: (async function* () {
      await Promise.resolve();
      yield bytes;
    })(),
  });
}

function responseBody(
  bytes = png,
  mediaType: "image/png" | "image/jpeg" = "image/png",
) {
  return {
    responseId: "gemini-response-1",
    candidates: [
      {
        content: {
          parts: [
            {
              text: "Generated image.",
            },
            {
              inlineData: {
                mimeType: mediaType,
                data: bytes.toString("base64"),
              },
            },
          ],
        },
      },
    ],
    usageMetadata: {
      promptTokenCount: 13,
      candidatesTokenCount: 21,
      totalTokenCount: 34,
      promptTokensDetails: [
        {
          modality: "TEXT",
          tokenCount: 5,
        },
        {
          modality: "IMAGE",
          tokenCount: 8,
        },
      ],
      candidatesTokensDetails: [
        {
          modality: "IMAGE",
          tokenCount: 21,
        },
      ],
    },
  };
}

function authorizedRequest(
  adapter: GeminiImageProviderAdapter,
  preparedRequest: ProviderRequestPreparationRequest,
  options?: {
    readonly input?: unknown;
    readonly effectiveParameters?: Readonly<
      Record<string, string | number | boolean>
    >;
    readonly open?: AuthorizedProviderInvocationRequest["inputArtifacts"];
  },
): AuthorizedProviderInvocationRequest {
  if (!preparedRequest.executionContext) {
    throw new Error("Test execution context is missing.");
  }
  const prepared = adapter.prepare(preparedRequest);
  return Object.freeze({
    ...preparedRequest,
    executionContext: preparedRequest.executionContext,
    ...(options && "input" in options ? { input: options.input } : {}),
    ...(options?.effectiveParameters
      ? {
          effectiveParameters: options.effectiveParameters,
        }
      : {}),
    preparedRequestSnapshot: prepared.snapshot,
    preparedRequestDigest: digestProviderValue(prepared.snapshot),
    credential: Buffer.from("gemini-test-key", "utf8"),
    inputArtifacts: options?.open ?? {
      open: vi.fn(),
    },
  });
}

describe("Gemini native image Provider Adapter", () => {
  it("prepares a deterministic, sanitized generateContent request mapping", () => {
    const adapter = new GeminiImageProviderAdapter({
      request: vi.fn(),
    });
    const request = preparationRequest({
      operation: "image.generate",
      input: {
        prompt: "Draw a glass pear.",
        referenceArtifactIds: [id(20), id(21)],
        aspectRatio: "16:9",
        resolution: "2k",
        outputFormat: "jpeg",
      },
      effectiveParameters: {
        aspectRatio: "16:9",
        resolution: "2k",
        outputFormat: "jpeg",
      },
    });

    const first = adapter.prepare(request);
    const second = adapter.prepare(request);

    expect(first).toEqual(second);
    expect(first.snapshot).toEqual({
      schemaVersion: "kanvas.gemini-generate-content-request/v1",
      adapterKey: "gemini.generate-content.image.v1",
      method: "POST",
      path: "/models/gemini-3.1-flash-image-preview:generateContent",
      model: "gemini-3.1-flash-image-preview",
      operation: "image.generate",
      requestFingerprint: digest("9"),
      parts: [
        {
          text: "Art direction:\nDraw a glass pear.",
        },
        {
          inputArtifact: {
            artifactId: id(20),
            inputPointer: "/referenceArtifactIds/0",
          },
        },
        {
          inputArtifact: {
            artifactId: id(21),
            inputPointer: "/referenceArtifactIds/1",
          },
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        responseFormat: {
          image: {
            delivery: "INLINE",
            aspectRatio: "16:9",
            imageSize: "2K",
            mimeType: "IMAGE_JPEG",
          },
        },
      },
      result: {
        outputRole: "generated",
        artifactType: "image.generated",
        outputFormat: "jpeg",
      },
    });
    const serialized = JSON.stringify(first.snapshot);
    expect(serialized).not.toContain("gemini-test-key");
    expect(serialized).not.toContain("inlineData");
    expect(serialized).not.toContain(png.toString("base64"));
  });

  it("submits prompt and authorized reference images, then materializes inlineData and usage", async () => {
    const requestHttp = vi.fn((httpRequest: ProviderHttpRequest) => {
      void httpRequest;
      return Promise.resolve({
        statusCode: 200,
        headers: {
          "x-goog-request-id": "transport-request-1",
        },
        body: responseBody(),
      });
    });
    const adapter = new GeminiImageProviderAdapter({
      request: requestHttp,
    } satisfies ProviderHttpTransport);
    const sourceId = id(20);
    const referenceId = id(21);
    const request = preparationRequest({
      operation: "image.edit",
      input: {
        sourceArtifactId: sourceId,
        referenceArtifactIds: [referenceId],
        prompt: "Replace the vase with a pear.",
        outputFormat: "png",
      },
      effectiveParameters: {
        aspectRatio: "4:3",
        resolution: "1k",
        outputFormat: "png",
      },
    });
    const open = vi.fn(
      ({ inputPointer }: { readonly inputPointer: string }) => {
        if (inputPointer === "/sourceArtifactId") {
          return Promise.resolve(artifact(sourceId, png));
        }
        return Promise.resolve(artifact(referenceId, jpeg, "image/jpeg"));
      },
    );
    const authorized = authorizedRequest(adapter, request, {
      open: { open },
    });

    const observation = await adapter.submit(
      authorized,
      new AbortController().signal,
    );

    expect(open.mock.calls.map(([value]) => value)).toEqual([
      {
        inputPointer: "/sourceArtifactId",
      },
      {
        inputPointer: "/referenceArtifactIds/0",
      },
    ]);
    const outbound = requestHttp.mock.calls[0]?.[0];
    expect(outbound).toMatchObject({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      path: "/models/gemini-3.1-flash-image-preview:generateContent",
      method: "POST",
      headers: {
        "x-goog-api-key": "gemini-test-key",
        accept: "application/json",
      },
    });
    expect(outbound?.body).toEqual({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Art direction:\nReplace the vase with a pear.",
            },
            {
              inlineData: {
                mimeType: "image/png",
                data: png.toString("base64"),
              },
            },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: jpeg.toString("base64"),
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        responseFormat: {
          image: {
            delivery: "INLINE",
            aspectRatio: "4:3",
            imageSize: "1K",
          },
        },
      },
    });
    expect(observation).toMatchObject({
      status: "succeeded",
      providerRequestId: "gemini-response-1",
      output: {
        schemaVersion: "kanvas.image-edit-result/v1",
        imageArtifactId: {
          $kanvas: "attempt-output-artifact/v1",
          outputRole: "edited",
          outputIndex: 0,
        },
        sourceArtifactId: sourceId,
        mediaType: "image/png",
      },
    });
    expect(observation.usage).toEqual(
      expect.arrayContaining([
        {
          metricKey: "input_image_tokens",
          numericValue: "8",
          unitCode: "token",
        },
        {
          metricKey: "output_image_tokens",
          numericValue: "21",
          unitCode: "token",
        },
        {
          metricKey: "total_tokens",
          numericValue: "34",
          unitCode: "token",
        },
      ]),
    );
    expect(observation.outputs).toHaveLength(1);
    const observedBytes: Buffer[] = [];
    for await (const chunk of observation.outputs![0]!.body) {
      observedBytes.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(observedBytes)).toEqual(png);
  });

  it("consumes the persisted mapping instead of remapping changed caller fields during submit", async () => {
    const requestHttp = vi.fn((httpRequest: ProviderHttpRequest) => {
      void httpRequest;
      return Promise.resolve({
        statusCode: 200,
        headers: {},
        body: responseBody(),
      });
    });
    const adapter = new GeminiImageProviderAdapter({
      request: requestHttp,
    });
    const preparedRequest = preparationRequest({
      operation: "image.generate",
      input: {
        prompt: "Original prompt.",
        aspectRatio: "1:1",
      },
      effectiveParameters: {
        aspectRatio: "1:1",
        outputFormat: "png",
      },
    });
    const authorized = authorizedRequest(adapter, preparedRequest, {
      input: {
        prompt: "Changed prompt.",
        aspectRatio: "16:9",
      },
      effectiveParameters: {
        aspectRatio: "16:9",
        outputFormat: "png",
      },
    });

    await adapter.submit(authorized, new AbortController().signal);

    const body = requestHttp.mock.calls[0]?.[0].body as {
      readonly contents: readonly {
        readonly parts: readonly Record<string, unknown>[];
      }[];
      readonly generationConfig: Readonly<Record<string, unknown>>;
    };
    expect(body.contents[0]?.parts[0]).toEqual({
      text: "Art direction:\nOriginal prompt.",
    });
    expect(body.generationConfig).toMatchObject({
      responseFormat: {
        image: {
          aspectRatio: "1:1",
        },
      },
    });
  });

  it("fails closed when the prepared request is absent, tampered, or points at a different Artifact", async () => {
    const transport = {
      request: vi.fn(),
    };
    const adapter = new GeminiImageProviderAdapter(transport);
    const preparedRequest = preparationRequest({
      operation: "image.edit",
      input: {
        sourceArtifactId: id(20),
        prompt: "Retouch.",
      },
    });
    const valid = authorizedRequest(adapter, preparedRequest, {
      open: {
        open: vi.fn().mockResolvedValue(artifact(id(21), png)),
      },
    });
    const {
      preparedRequestSnapshot,
      preparedRequestDigest,
      ...withoutPrepared
    } = valid;
    expect(preparedRequestSnapshot).toBeDefined();
    expect(preparedRequestDigest).toBeDefined();

    await expect(
      adapter.submit(withoutPrepared, new AbortController().signal),
    ).rejects.toBeInstanceOf(ProviderAdapterContractError);

    const tamperedSnapshot = {
      ...valid.preparedRequestSnapshot,
      path: "/models/other:generateContent",
    };
    await expect(
      adapter.submit(
        {
          ...valid,
          preparedRequestSnapshot: tamperedSnapshot,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("differs from its immutable digest");

    await expect(
      adapter.submit(valid, new AbortController().signal),
    ).rejects.toThrow("differs from the authorized input");
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("rejects malformed inline image responses and normalizes remote throttling", async () => {
    const malformedTransport = {
      request: vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: responseBody(jpeg, "image/png"),
      }),
    };
    const malformedAdapter = new GeminiImageProviderAdapter(malformedTransport);
    const request = preparationRequest({
      operation: "image.generate",
      input: {
        prompt: "Draw a pear.",
        outputFormat: "png",
      },
      effectiveParameters: {
        outputFormat: "png",
      },
    });

    await expect(
      malformedAdapter.submit(
        authorizedRequest(malformedAdapter, request),
        new AbortController().signal,
      ),
    ).rejects.toThrow("Base64 or media signature is invalid");

    const throttledAdapter = new GeminiImageProviderAdapter({
      request: vi.fn().mockResolvedValue({
        statusCode: 429,
        headers: {},
        body: {
          error: {
            status: "RESOURCE_EXHAUSTED",
          },
        },
      }),
    });
    await expect(
      throttledAdapter.submit(
        authorizedRequest(throttledAdapter, request),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "failed",
      stableErrorCode: "provider.remote_rate_limited",
    });
  });
});
