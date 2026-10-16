import type { CurrentProviderRouteSnapshot } from "@kanvas/application";
import type { ProviderInvocationExecutionContext } from "@kanvas/database/runtime";
import { digestProviderValue } from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import { OpenAiReconstructiveUpscaleProviderAdapter } from "../src/provider/openai-image-upscale-provider.js";
import type { AuthorizedProviderInvocationRequest } from "../src/provider/provider-adapter.js";
import type { ProviderHttpRequest } from "../src/provider/provider-http-transport.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const parameterPolicies = Object.freeze({
  size: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  quality: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  outputFormat: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  background: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  outputCompression: Object.freeze({
    callerPolicy: "optional" as const,
  }),
});

function route(): CurrentProviderRouteSnapshot {
  return {
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
    parameterPolicies,
    parameterPolicyDigest: digest("d"),
  };
}

function context(
  currentRoute: CurrentProviderRouteSnapshot,
): ProviderInvocationExecutionContext {
  return {
    invocationId: id(11),
    workspaceId: id(12),
    route: currentRoute,
    implementationConfiguration: {
      promptTemplate:
        "Reconstruct this image at {{scaleFactor}}x fidelity.{{guidanceBlock}}",
      providerParameters: {
        size: "1024x1024",
        quality: "low",
        outputFormat: "jpeg",
        background: "transparent",
      },
    },
    endpoint: {
      id: currentRoute.providerEndpointId,
      adapterKind: "openai_native",
      presetKind: "openai",
      baseUrl: "https://api.openai.com/v1",
      canonicalOrigin: "https://api.openai.com",
      regionCode: "global",
      networkPolicy: {},
      dataPolicy: {},
    },
    model: {
      deploymentId: currentRoute.modelDeploymentId,
      providerModelId: "gpt-image-test",
      modelProfileRevisionId: currentRoute.modelProfileRevisionId,
      modelProfile: {},
    },
    pricing: {
      revisionId: currentRoute.pricingRevisionId,
      currencyCode: "USD",
      pricing: {},
    },
    secret: {
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
    },
  };
}

describe("OpenAI reconstructive upscale Provider Adapter", () => {
  it("maps business intent to an image edit without leaking Provider identity into capability output", async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    let sentMultipart: Buffer | undefined;
    const requestHttp = vi.fn((request: ProviderHttpRequest) => {
      expect(request.path).toBe("/images/edits");
      sentMultipart = Buffer.from(request.binaryBody ?? []);
      return Promise.resolve({
        statusCode: 200,
        headers: {
          "x-request-id": "req_upscale_1",
        },
        body: {
          data: [
            {
              b64_json: png.toString("base64"),
            },
          ],
          usage: {
            input_image_tokens: 8,
            output_tokens: 10,
          },
        },
      });
    });
    const adapter = new OpenAiReconstructiveUpscaleProviderAdapter({
      request: requestHttp,
    });
    const currentRoute = route();
    const request: AuthorizedProviderInvocationRequest = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:upscale",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        qualityIntent: "reconstructive",
        scaleFactor: 2,
        guidance: "Keep the package typography unchanged.",
        size: "auto",
        quality: "low",
        outputFormat: "jpeg",
        background: "transparent",
      },
      effectiveParameters: {
        size: "auto",
        quality: "high",
        outputFormat: "png",
        background: "auto",
        outputCompression: 88,
      },
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext: context(currentRoute),
      credential: Buffer.from("sk-test-only"),
      inputArtifacts: {
        open: vi.fn().mockResolvedValue({
          artifactId: id(20),
          storedObjectId: id(21),
          artifactType: "image.source",
          dataClassification: "confidential",
          byteSize: String(png.byteLength),
          sha256: digest("1").slice(7),
          mediaType: "image/png",
          body: (async function* () {
            await Promise.resolve();
            yield png;
          })(),
        }),
      },
    };

    const prepared = adapter.prepare(request);
    expect(JSON.stringify(prepared.snapshot)).not.toContain("sk-test-only");
    expect(prepared.snapshot).toMatchObject({
      adapterKey: "openai.image.upscale.reconstructive.v1",
      adapterState: {
        sourceArtifactId: id(20),
        qualityIntent: "reconstructive",
        scaleFactor: 2,
        guidance: "Keep the package typography unchanged.",
      },
      result: {
        outputRole: "upscaled",
        outputArtifactType: "image.upscaled",
      },
    });
    expect(
      (prepared.snapshot.adapterState as Readonly<Record<string, unknown>>)
        .quality,
    ).toBeUndefined();
    const observation = await adapter.submit(
      {
        ...request,
        input: {
          sourceArtifactId: id(99),
          qualityIntent: "reconstructive",
          scaleFactor: 2,
          guidance: "Changed after prepare.",
          quality: "low",
        },
        effectiveParameters: {
          size: "1024x1024",
          quality: "low",
          outputFormat: "jpeg",
          background: "transparent",
        },
        preparedRequestSnapshot: prepared.snapshot,
        preparedRequestDigest: digestProviderValue(prepared.snapshot),
      },
      new AbortController().signal,
    );

    expect(observation.status).toBe("succeeded");
    expect(observation.output).toEqual({
      schemaVersion: "kanvas.image-upscale-result/v1",
      imageArtifactId: {
        $kanvas: "attempt-output-artifact/v1",
        outputRole: "upscaled",
        outputIndex: 0,
      },
      qualityIntent: "reconstructive",
      scaleFactor: 2,
      sourceWidth: null,
      sourceHeight: null,
      outputWidth: null,
      outputHeight: null,
      qualitySignals: {
        schemaVersion: "kanvas.image-upscale-quality/v1",
        method: "generative_reconstruction",
        generative: true,
        resamplingKernel: null,
      },
    });
    expect(JSON.stringify(observation.output)).not.toMatch(/openai|gpt-image/u);
    expect(observation.outputs?.[0]).toMatchObject({
      outputRole: "upscaled",
      artifactType: "image.upscaled",
      metadata: {
        operation: "image.upscale",
        qualityIntent: "reconstructive",
        scaleFactor: 2,
        generative: true,
      },
    });
    const multipart = sentMultipart?.toString("utf8") ?? "";
    expect(multipart).toContain("Keep the package typography unchanged.");
    expect(multipart).toContain('name="quality"');
    expect(multipart).toContain("high");
    expect(multipart).toContain('name="output_compression"');
    expect(multipart).toContain("88");
    expect(multipart).not.toContain("Changed after prepare.");
  });

  it("fails closed for unknown, unpinned, or wrong-operation parameters", () => {
    const adapter = new OpenAiReconstructiveUpscaleProviderAdapter({
      request: vi.fn(),
    });
    const currentRoute = route();
    const baseRequest = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:upscale-invalid",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        qualityIntent: "reconstructive",
        scaleFactor: 2,
      },
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext: context(currentRoute),
    };

    expect(() =>
      adapter.prepare({
        ...baseRequest,
        effectiveParameters: {
          seed: 42,
        },
      }),
    ).toThrow(/unknown or unpinned/u);

    const wrongRoute = {
      ...currentRoute,
      modelOperation: "image.generate" as const,
    };
    expect(() =>
      adapter.prepare({
        ...baseRequest,
        route: wrongRoute,
        executionContext: {
          ...baseRequest.executionContext,
          route: wrongRoute,
        },
      }),
    ).toThrow(/image\.edit/u);
  });
});
