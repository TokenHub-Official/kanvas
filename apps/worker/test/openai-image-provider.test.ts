import type { CurrentProviderRouteSnapshot } from "@kanvas/application";
import type { ProviderInvocationExecutionContext } from "@kanvas/database/runtime";
import { digestProviderValue } from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import { OpenAiImageEditProviderAdapter } from "../src/provider/openai-image-provider.js";
import type { AuthorizedProviderInvocationRequest } from "../src/provider/provider-adapter.js";
import type {
  ProviderHttpRequest,
  ProviderHttpTransport,
} from "../src/provider/provider-http-transport.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function route(): CurrentProviderRouteSnapshot {
  return Object.freeze({
    providerProtocolVersion: 1,
    providerKey: "openai",
    apiSurface: "images.edits.v1",
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
      amount: "1",
    },
    routeCandidateDigest: digest("b"),
    requestScopeDigest: digest("c"),
    queryMode: "none",
    notFoundIsAuthoritative: false,
    modelOperation: "image.edit",
    parameterPolicies: Object.freeze({
      size: Object.freeze({
        callerPolicy: "optional" as const,
      }),
      quality: Object.freeze({
        callerPolicy: "optional" as const,
      }),
      outputFormat: Object.freeze({
        callerPolicy: "optional" as const,
      }),
      outputCompression: Object.freeze({
        callerPolicy: "optional" as const,
      }),
      background: Object.freeze({
        callerPolicy: "optional" as const,
      }),
    }),
    parameterPolicyDigest: digest("7"),
  });
}

function context(
  currentRoute: CurrentProviderRouteSnapshot,
): ProviderInvocationExecutionContext {
  return Object.freeze({
    invocationId: id(11),
    workspaceId: id(12),
    route: currentRoute,
    implementationConfiguration: {
      promptTemplate: "{{prompt}}",
      providerParameters: {},
    },
    endpoint: Object.freeze({
      id: currentRoute.providerEndpointId,
      adapterKind: "openai_native",
      presetKind: "openai",
      baseUrl: "https://api.openai.com/v1",
      canonicalOrigin: "https://api.openai.com",
      regionCode: "global",
      networkPolicy: {},
      dataPolicy: {},
    }),
    model: Object.freeze({
      deploymentId: currentRoute.modelDeploymentId,
      providerModelId: "gpt-image-test",
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
      aadDigest: digest("d"),
      materialFingerprint: digest("e"),
      formatVersion: 1,
      drainDeadlineAt: null,
      deploymentReference: "deployment://provider/openai",
    }),
  });
}

function artifactBody(bytes: Uint8Array) {
  return Object.freeze({
    artifactId: id(20),
    storedObjectId: id(21),
    artifactType: "image.source",
    dataClassification: "confidential" as const,
    byteSize: String(bytes.byteLength),
    sha256: createDigest(bytes),
    mediaType: "image/png" as const,
    body: (async function* () {
      await Promise.resolve();
      yield bytes;
    })(),
  });
}

function createDigest(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex").padEnd(64, "0").slice(0, 64);
}

function withPrepared(
  adapter: OpenAiImageEditProviderAdapter,
  request: AuthorizedProviderInvocationRequest,
): AuthorizedProviderInvocationRequest {
  const prepared = adapter.prepare(request);
  return Object.freeze({
    ...request,
    preparedRequestSnapshot: prepared.snapshot,
    preparedRequestDigest: digestProviderValue(prepared.snapshot),
  });
}

describe("OpenAI image edit Provider Adapter", () => {
  it("sends authorized Artifact bytes as multipart and returns a Storage-bound output descriptor", async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    let sentBody: Buffer | undefined;
    const requestHttp = vi.fn((httpRequest: ProviderHttpRequest) => {
      sentBody = Buffer.from(httpRequest.binaryBody ?? []);
      return Promise.resolve({
        statusCode: 200,
        headers: {
          "x-request-id": "req_image_1",
        },
        body: {
          data: [
            {
              b64_json: png.toString("base64"),
            },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 8,
            total_tokens: 20,
            input_tokens_details: {
              text_tokens: 4,
              image_tokens: 8,
            },
          },
        },
      });
    });
    const adapter = new OpenAiImageEditProviderAdapter({
      request: requestHttp,
    } satisfies ProviderHttpTransport);
    const currentRoute = route();
    const executionContext = context(currentRoute);
    const open = vi.fn().mockResolvedValue(artifactBody(png));
    const request: AuthorizedProviderInvocationRequest = Object.freeze({
      route: currentRoute,
      stableRequestKey: "kanvas:v1:image-edit",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        prompt: "Extend the studio background.",
        size: "1536x1024",
        outputFormat: "png",
      },
      effectiveParameters: {
        size: "1536x1024",
        quality: "high",
        outputFormat: "png",
        background: "auto",
      },
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext,
      credential: Buffer.from("sk-test-only", "utf8"),
      inputArtifacts: {
        open,
      },
    });

    const observation = await adapter.submit(
      withPrepared(adapter, request),
      new AbortController().signal,
    );

    expect(open).toHaveBeenCalledWith({
      inputPointer: "/sourceArtifactId",
    });
    const outbound = requestHttp.mock.calls[0]?.[0];
    expect(outbound?.path).toBe("/images/edits");
    expect(outbound?.method).toBe("POST");
    expect(outbound?.contentType).toMatch(
      /^multipart\/form-data; boundary=kanvas-/u,
    );
    expect(outbound?.binaryBody).toBeInstanceOf(Uint8Array);
    expect(sentBody?.toString("utf8")).toContain('name="model"');
    expect(observation.status).toBe("succeeded");
    expect(observation.output).toEqual(
      expect.objectContaining({
        imageArtifactId: {
          $kanvas: "attempt-output-artifact/v1",
          outputRole: "edited",
          outputIndex: 0,
        },
        sourceArtifactId: id(20),
      }),
    );
    expect(observation.outputs).toHaveLength(1);
    expect(observation.usage).toEqual(
      expect.arrayContaining([
        {
          metricKey: "input_image_tokens",
          numericValue: "8",
          unitCode: "token",
        },
        {
          metricKey: "output_tokens",
          numericValue: "8",
          unitCode: "token",
        },
      ]),
    );
    expect(JSON.stringify(observation.output)).not.toContain("b64_json");
  });

  it("normalizes remote throttling without returning image bytes", async () => {
    const adapter = new OpenAiImageEditProviderAdapter({
      request: vi.fn().mockResolvedValue({
        statusCode: 429,
        headers: {},
        body: {
          error: {
            type: "rate_limit_error",
          },
        },
      }),
    });
    const currentRoute = route();
    const request = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:image-edit",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        prompt: "Retouch.",
      },
      effectiveParameters: {
        outputFormat: "png",
      },
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext: context(currentRoute),
      credential: Buffer.from("sk-test-only"),
      inputArtifacts: {
        open: vi
          .fn()
          .mockResolvedValue(
            artifactBody(
              Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
            ),
          ),
      },
    } satisfies AuthorizedProviderInvocationRequest;

    await expect(
      adapter.submit(
        withPrepared(adapter, request),
        new AbortController().signal,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "failed",
        stableErrorCode: "provider.remote_rate_limited",
      }),
    );
  });

  it("persists a secret-free effective-parameter mapping and consumes it after raw input changes", async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    let multipart = "";
    const requestHttp = vi.fn((request: ProviderHttpRequest) => {
      multipart = Buffer.from(request.binaryBody ?? []).toString("utf8");
      return Promise.resolve({
        statusCode: 200,
        headers: {},
        body: {
          data: [
            {
              b64_json: png.toString("base64"),
            },
          ],
        },
      });
    });
    const adapter = new OpenAiImageEditProviderAdapter({
      request: requestHttp,
    });
    const currentRoute = route();
    const baseRequest: AuthorizedProviderInvocationRequest = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:image-edit-prepared",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        prompt: "Original instruction.",
        size: "1024x1024",
      },
      effectiveParameters: {
        size: "1536x1024",
        quality: "medium",
        outputFormat: "png",
        background: "opaque",
      },
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext: context(currentRoute),
      credential: Buffer.from("sk-test-only"),
      inputArtifacts: {
        open: vi.fn().mockResolvedValue(artifactBody(png)),
      },
    };
    const prepared = adapter.prepare(baseRequest);
    const serialized = JSON.stringify(prepared.snapshot);
    expect(serialized).not.toContain("sk-test-only");
    expect(serialized).not.toContain(png.toString("base64"));
    expect(adapter.prepare(baseRequest)).toEqual(prepared);

    await adapter.submit(
      {
        ...baseRequest,
        input: {
          sourceArtifactId: id(20),
          prompt: "Changed instruction.",
          size: "1024x1536",
        },
        effectiveParameters: {
          size: "1024x1536",
          quality: "low",
          outputFormat: "png",
          background: "transparent",
        },
        preparedRequestSnapshot: prepared.snapshot,
        preparedRequestDigest: digestProviderValue(prepared.snapshot),
      },
      new AbortController().signal,
    );

    expect(multipart).toContain("Original instruction.");
    expect(multipart).not.toContain("Changed instruction.");
    expect(multipart).toContain("1536x1024");
    expect(multipart).toContain("medium");
    expect(multipart).toContain("opaque");
  });

  it("rejects unknown or unpinned effective parameters during prepare", () => {
    const adapter = new OpenAiImageEditProviderAdapter({
      request: vi.fn(),
    });
    const currentRoute = route();
    const request = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:image-edit-invalid",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        prompt: "Retouch.",
      },
      effectiveParameters: {
        aspectRatio: "16:9",
      },
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext: context(currentRoute),
    };

    expect(() => adapter.prepare(request)).toThrow("unknown or unpinned");
  });

  it("fails missing, tampered, or Artifact-mismatched snapshots before remote HTTP", async () => {
    const requestHttp = vi.fn();
    const open = vi
      .fn()
      .mockResolvedValue(
        artifactBody(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
        ),
      );
    const adapter = new OpenAiImageEditProviderAdapter({
      request: requestHttp,
    });
    const currentRoute = route();
    const request: AuthorizedProviderInvocationRequest = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:image-edit-guard",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        prompt: "Retouch.",
      },
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext: context(currentRoute),
      credential: Buffer.from("sk-test-only"),
      inputArtifacts: {
        open,
      },
    };

    await expect(
      adapter.submit(request, new AbortController().signal),
    ).rejects.toThrow("prepared request is missing");
    expect(open).not.toHaveBeenCalled();

    const prepared = adapter.prepare(request);
    await expect(
      adapter.submit(
        {
          ...request,
          preparedRequestSnapshot: {
            ...prepared.snapshot,
            path: "/images/generations",
          },
          preparedRequestDigest: digestProviderValue(prepared.snapshot),
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("immutable digest");
    expect(open).not.toHaveBeenCalled();

    open.mockResolvedValueOnce({
      ...artifactBody(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
      ),
      artifactId: id(21),
    });
    await expect(
      adapter.submit(
        {
          ...request,
          preparedRequestSnapshot: prepared.snapshot,
          preparedRequestDigest: digestProviderValue(prepared.snapshot),
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("differs from the prepared request");
    expect(requestHttp).not.toHaveBeenCalled();
  });
});
