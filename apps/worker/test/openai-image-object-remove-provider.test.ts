import type { CurrentProviderRouteSnapshot } from "@kanvas/application";
import type { ProviderInvocationExecutionContext } from "@kanvas/database/runtime";
import { digestProviderValue } from "@kanvas/database/runtime";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { OpenAiObjectRemoveProviderAdapter } from "../src/provider/openai-image-object-remove-provider.js";
import {
  parseObjectRemoveInput,
  prepareObjectRemove,
} from "../src/provider/image-object-remove-core.js";
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
      promptTemplate: "Remove only the selected object.{{guidanceBlock}}",
      providerParameters: {
        quality: "high",
        outputFormat: "png",
        background: "auto",
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

async function body(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("OpenAI object-remove Provider Adapter", () => {
  it("normalizes explicit Polygon Regions without requiring a Mask Artifact", async () => {
    const source = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: {
          r: 20,
          g: 30,
          b: 40,
        },
      },
    })
      .png()
      .toBuffer();
    const currentRoute = route();
    const input = parseObjectRemoveInput({
      sourceArtifactId: id(20),
      regions: [
        {
          points: [
            { x: 1, y: 1 },
            { x: 3, y: 1 },
            { x: 3, y: 3 },
            { x: 1, y: 3 },
          ],
        },
      ],
    });
    const open = vi.fn().mockResolvedValue({
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
    });
    const request: AuthorizedProviderInvocationRequest = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:object-remove-regions",
      requestFingerprint: digest("f"),
      input,
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext: context(currentRoute),
      credential: Buffer.from("sk-test-only"),
      inputArtifacts: {
        open,
      },
    };
    const prepared = await prepareObjectRemove(
      request,
      input,
      new AbortController().signal,
    );
    try {
      expect(open).toHaveBeenCalledTimes(1);
      expect(prepared.removedPixelRatio).toBeGreaterThan(0);
      expect(prepared.removedPixelRatio).toBeLessThan(1);
      const mask = await sharp(prepared.canonicalRemovedMask)
        .greyscale()
        .raw()
        .toBuffer();
      expect(mask).toContain(255);
      expect(mask).toContain(0);
    } finally {
      prepared.dispose();
    }
  });

  it("uses an explicit mask, preserves outside pixels, and emits the canonical removed-region mask", async () => {
    const sourcePixels = Buffer.from([
      20, 30, 40, 255, 50, 60, 70, 128, 80, 90, 100, 255, 110, 120, 130, 255,
      140, 150, 160, 255, 170, 180, 190, 255,
    ]);
    const source = await sharp(sourcePixels, {
      raw: {
        width: 3,
        height: 2,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
    const mask = await sharp(Buffer.from([0, 255, 0, 0, 0, 0]), {
      raw: {
        width: 3,
        height: 2,
        channels: 1,
      },
    })
      .png()
      .toBuffer();
    const generated = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 4,
        background: {
          r: 240,
          g: 10,
          b: 20,
          alpha: 1,
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
          "x-request-id": "req_remove_1",
        },
        body: {
          data: [
            {
              b64_json: generated.toString("base64"),
            },
          ],
        },
      });
    });
    const currentRoute = route();
    const request: AuthorizedProviderInvocationRequest = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:object-remove",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        maskArtifactId: id(22),
        guidance: "Continue the neutral background.",
      },
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext: context(currentRoute),
      credential: Buffer.from("sk-test-only"),
      inputArtifacts: {
        open: vi.fn(({ inputPointer }) => {
          const bytes = inputPointer === "/maskArtifactId" ? mask : source;
          return Promise.resolve({
            artifactId: inputPointer === "/maskArtifactId" ? id(22) : id(20),
            storedObjectId: id(21),
            artifactType: "image",
            dataClassification: "confidential" as const,
            byteSize: String(bytes.byteLength),
            sha256: "1".repeat(64),
            mediaType: "image/png" as const,
            body: (async function* () {
              await Promise.resolve();
              yield bytes;
            })(),
          });
        }),
      },
    };
    const adapter = new OpenAiObjectRemoveProviderAdapter({
      request: requestHttp,
    });

    const preparedRequest = adapter.prepare(request);
    expect(preparedRequest.snapshot).toMatchObject({
      adapterKey: "openai.image.object-remove.v1",
      adapterState: {
        sourceArtifactId: id(20),
        maskArtifactId: id(22),
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
    expect(observation.output).toMatchObject({
      schemaVersion: "kanvas.image-object-remove-result/v1",
      qualitySignals: {
        method: "generative_inpaint",
        generative: true,
        outsideMaskPixelsPreserved: true,
        removedPixelRatio: 0.166667,
      },
    });
    expect(multipart).toContain('name="image[]"');
    expect(multipart).toContain('name="mask"');
    expect(multipart).toContain("Continue the neutral background.");
    expect(observation.outputs).toHaveLength(2);
    const repaired = await sharp(await body(observation.outputs![0]!.body))
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect([...repaired.subarray(0, 4)]).toEqual([20, 30, 40, 255]);
    expect([...repaired.subarray(4, 8)]).toEqual([240, 10, 20, 255]);
    expect([...repaired.subarray(8)]).toEqual([...sourcePixels.subarray(8)]);
    const canonicalMask = await sharp(await body(observation.outputs![1]!.body))
      .greyscale()
      .raw()
      .toBuffer();
    expect([...canonicalMask]).toEqual([0, 255, 0, 0, 0, 0]);
    expect(observation.outputs?.[0]).toMatchObject({
      artifactType: "image.object-removed",
      metadata: {
        sourceArtifactId: id(20),
        inputMaskArtifactId: id(22),
        outsideMaskPixelsPreserved: true,
        composedFrom: [id(20), id(22)],
      },
    });
  });
});
