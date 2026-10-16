import type { CurrentProviderRouteSnapshot } from "@kanvas/application";
import type { ProviderInvocationExecutionContext } from "@kanvas/database/runtime";
import { digestProviderValue } from "@kanvas/database/runtime";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { OpenAiCanvasExpandProviderAdapter } from "../src/provider/openai-image-expand-provider.js";
import type { AuthorizedProviderInvocationRequest } from "../src/provider/provider-adapter.js";
import type { ProviderHttpRequest } from "../src/provider/provider-http-transport.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const parameterPolicies = Object.freeze({
  size: Object.freeze({ callerPolicy: "optional" as const }),
  quality: Object.freeze({ callerPolicy: "optional" as const }),
  outputFormat: Object.freeze({ callerPolicy: "optional" as const }),
  outputCompression: Object.freeze({ callerPolicy: "optional" as const }),
  background: Object.freeze({ callerPolicy: "optional" as const }),
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
      amount: "2",
    },
    routeCandidateDigest: digest("b"),
    requestScopeDigest: digest("c"),
    queryMode: "none",
    notFoundIsAuthoritative: false,
    modelOperation: "image.edit",
    parameterPolicies,
    parameterPolicyDigest: digest("f"),
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
        "Outpaint to {{targetWidth}}x{{targetHeight}}. Generate content only in the transparent region.{{promptBlock}}",
      providerParameters: {
        quality: "high",
        outputFormat: "png",
        background: "opaque",
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

async function readBody(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("OpenAI canvas expand Provider Adapter", () => {
  it("sends a padded image and edit mask, restores exact source pixels, and emits a generated-region mask", async () => {
    const source = await sharp({
      create: {
        width: 4,
        height: 3,
        channels: 4,
        background: {
          r: 240,
          g: 30,
          b: 20,
          alpha: 0.5,
        },
      },
    })
      .png()
      .toBuffer();
    const generated = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 3,
        background: {
          r: 10,
          g: 80,
          b: 200,
        },
      },
    })
      .png()
      .toBuffer();
    let multipart = "";
    const requestHttp = vi.fn((httpRequest: ProviderHttpRequest) => {
      multipart = Buffer.from(httpRequest.binaryBody ?? []).toString("latin1");
      return Promise.resolve({
        statusCode: 200,
        headers: {
          "x-request-id": "req_expand_1",
        },
        body: {
          data: [
            {
              b64_json: generated.toString("base64"),
            },
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 200,
            total_tokens: 300,
            input_tokens_details: {
              text_tokens: 20,
              image_tokens: 80,
            },
          },
        },
      });
    });
    const currentRoute = route();
    const request: AuthorizedProviderInvocationRequest = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:canvas-expand",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        targetWidth: 1024,
        targetHeight: 1024,
        sourcePlacement: {
          x: 10,
          y: 20,
        },
        generatedRegion: {
          left: 10,
          top: 20,
          right: 1010,
          bottom: 1001,
        },
        prompt: "Continue the blue studio background.",
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
          byteSize: String(source.byteLength),
          sha256: "1".repeat(64),
          mediaType: "image/png",
          body: (async function* () {
            await Promise.resolve();
            yield source;
          })(),
        }),
      },
    };
    const adapter = new OpenAiCanvasExpandProviderAdapter({
      request: requestHttp,
    });

    const preparedRequest = adapter.prepare(request);
    expect(preparedRequest.snapshot).toMatchObject({
      adapterKey: "openai.image.canvas-expand.v1",
      multipart: {
        source: {
          artifactId: id(20),
        },
        mask: {
          artifactId: id(20),
        },
      },
    });
    const observation = await adapter.submit(
      {
        ...request,
        preparedRequestSnapshot: preparedRequest.snapshot,
        preparedRequestDigest: digestProviderValue(preparedRequest.snapshot),
      },
      new AbortController().signal,
    );

    expect(observation.status).toBe("succeeded");
    expect(observation.output).toEqual({
      schemaVersion: "kanvas.image-canvas-expand-result/v1",
      expandedArtifactId: {
        $kanvas: "attempt-output-artifact/v1",
        outputRole: "expanded",
        outputIndex: 0,
      },
      generatedRegionMaskArtifactId: {
        $kanvas: "attempt-output-artifact/v1",
        outputRole: "generated_region_mask",
        outputIndex: 0,
      },
      targetWidth: 1024,
      targetHeight: 1024,
      sourcePlacement: {
        x: 10,
        y: 20,
        width: 4,
        height: 3,
      },
      generatedRegion: {
        left: 10,
        top: 20,
        right: 1010,
        bottom: 1001,
      },
      qualitySignals: {
        schemaVersion: "kanvas.image-canvas-expand-quality/v1",
        method: "generative_outpaint",
        generative: true,
        originalPixelsPreserved: true,
      },
    });
    expect(observation.outputs).toHaveLength(2);
    expect(multipart).toContain('name="image[]"');
    expect(multipart).toContain('name="mask"');
    expect(multipart).toContain("1024x1024");
    expect(multipart).toContain("Continue the blue studio background.");
    const expanded = await readBody(observation.outputs![0]!.body);
    const mask = await readBody(observation.outputs![1]!.body);
    const sourcePixels = await sharp(source).ensureAlpha().raw().toBuffer();
    const restoredPixels = await sharp(expanded)
      .extract({
        left: 10,
        top: 20,
        width: 4,
        height: 3,
      })
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(restoredPixels).toEqual(sourcePixels);
    const outsideMaskPixel = await sharp(mask)
      .extract({
        left: 0,
        top: 0,
        width: 1,
        height: 1,
      })
      .raw()
      .toBuffer();
    const sourceMaskPixel = await sharp(mask)
      .extract({
        left: 10,
        top: 20,
        width: 1,
        height: 1,
      })
      .raw()
      .toBuffer();
    expect([...outsideMaskPixel]).toEqual([255, 255, 255, 255]);
    expect([...sourceMaskPixel]).toEqual([0, 0, 0, 255]);
    expect(observation.outputs?.[0]).toMatchObject({
      artifactType: "image.expanded",
      metadata: {
        sourceArtifactId: id(20),
        originalPixelsPreserved: true,
        composedFrom: [id(20)],
      },
    });
    expect(observation.outputs?.[1]).toMatchObject({
      artifactType: "image.generated-region-mask",
      metadata: {
        maskSemantics: "white_generated_black_preserved",
      },
    });
  });
});
