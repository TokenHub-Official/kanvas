import type { CurrentProviderRouteSnapshot } from "@kanvas/application";
import type { ProviderInvocationExecutionContext } from "@kanvas/database/runtime";
import { digestProviderValue } from "@kanvas/database/runtime";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { GenerationTasksCanvasExpandProviderAdapter } from "../src/provider/generation-tasks-image-expand-provider.js";
import type {
  AuthorizedProviderInvocationRequest,
  AuthorizedProviderQueryRequest,
} from "../src/provider/provider-adapter.js";
import type {
  ProviderHttpRequest,
  ProviderHttpTransport,
} from "../src/provider/provider-http-transport.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const parameterPolicies = Object.freeze({
  resolution: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  quality: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  outputFormat: Object.freeze({
    callerPolicy: "optional" as const,
  }),
});

function route(): CurrentProviderRouteSnapshot {
  return {
    providerProtocolVersion: 1,
    providerKey: "tokenhub",
    apiSurface: "generation.tasks.v1",
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
    executionTransparency: "partial",
    maximumCharge: {
      currencyCode: "USD",
      amount: "1",
    },
    routeCandidateDigest: digest("b"),
    requestScopeDigest: digest("c"),
    queryMode: "provider_request_id",
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
        "Outpaint to {{targetWidth}}x{{targetHeight}}. Generate content only in the transparent region.{{promptBlock}}",
      providerParameters: {
        resolution: "2k",
        quality: "high",
        outputFormat: "png",
      },
    },
    endpoint: {
      id: currentRoute.providerEndpointId,
      adapterKind: "openai_compatible",
      presetKind: "tokenhub",
      baseUrl: "https://us-api.tokenhub.test",
      canonicalOrigin: "https://us-api.tokenhub.test",
      regionCode: "us",
      networkPolicy: {},
      dataPolicy: {},
    },
    model: {
      deploymentId: currentRoute.modelDeploymentId,
      providerModelId: "gpt-image-2-edit",
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
      deploymentReference: "deployment://provider/tokenhub",
    },
  };
}

function withPrepared<TRequest extends AuthorizedProviderInvocationRequest>(
  adapter: GenerationTasksCanvasExpandProviderAdapter,
  request: TRequest,
): TRequest & {
  readonly preparedRequestSnapshot: Readonly<Record<string, unknown>>;
  readonly preparedRequestDigest: string;
} {
  const prepared = adapter.prepare(request);
  return {
    ...request,
    preparedRequestSnapshot: prepared.snapshot,
    preparedRequestDigest: digestProviderValue(prepared.snapshot),
  };
}

async function readBody(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("Generation Tasks canvas expand Provider Adapter", () => {
  it("shares canvas geometry with OpenAI while using asynchronous task submit/query", async () => {
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
    const calls: ProviderHttpRequest[] = [];
    const requestHttp = vi.fn(
      (
        request: ProviderHttpRequest,
      ): Promise<{
        statusCode: number;
        headers: Readonly<Record<string, string>>;
        body: unknown;
      }> => {
        calls.push(request);
        if (request.method === "POST" && request.path === "/generation/tasks") {
          return Promise.resolve({
            statusCode: 200,
            headers: {},
            body: {
              code: "success",
              data: {
                task_id: "task_expand_1",
                status: "queued",
                created_at: 100,
              },
            },
          });
        }
        if (
          request.method === "GET" &&
          request.path === "/generation/tasks/task_expand_1"
        ) {
          return Promise.resolve({
            statusCode: 200,
            headers: {},
            body: {
              code: "success",
              data: {
                task_id: "task_expand_1",
                status: "succeeded",
                result_urls: [
                  "https://assets.tokenhub.test/expand.png?signature=redacted",
                ],
                updated_at: 200,
              },
            },
          });
        }
        if (
          request.method === "GET" &&
          request.baseUrl === "https://assets.tokenhub.test"
        ) {
          return Promise.resolve({
            statusCode: 200,
            headers: {
              "content-type": "image/png",
            },
            body: Buffer.from(generated),
          });
        }
        throw new Error("Unexpected Provider HTTP request.");
      },
    );
    const adapter = new GenerationTasksCanvasExpandProviderAdapter({
      request: requestHttp,
    } satisfies ProviderHttpTransport);
    const currentRoute = route();
    const open = vi.fn().mockImplementation(() =>
      Promise.resolve({
        artifactId: id(20),
        storedObjectId: id(21),
        artifactType: "image.source",
        dataClassification: "confidential",
        byteSize: String(source.byteLength),
        sha256: digest("1").slice(7),
        mediaType: "image/png",
        body: (async function* () {
          await Promise.resolve();
          yield source;
        })(),
      }),
    );
    const baseRequest: AuthorizedProviderInvocationRequest = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:expand",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        targetWidth: 1024,
        targetHeight: 1024,
        sourcePlacement: {
          x: 100,
          y: 200,
        },
        generatedRegion: {
          left: 100,
          top: 200,
          right: 920,
          bottom: 821,
        },
        prompt: "Continue a clean blue studio background.",
      },
      effectiveParameters: {
        resolution: "2k",
        quality: "high",
        outputFormat: "png",
      },
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext: context(currentRoute),
      credential: Buffer.from("sk-test-only"),
      inputArtifacts: {
        open,
      },
    };

    const submitted = await adapter.submit(
      withPrepared(adapter, baseRequest),
      new AbortController().signal,
    );

    expect(submitted).toMatchObject({
      status: "accepted",
      providerRequestId: "task_expand_1",
    });
    const submitBody = calls[0]?.body as
      Readonly<Record<string, unknown>> | undefined;
    expect(submitBody).toMatchObject({
      model: "gpt-image-2-edit",
      size: "1024x1024",
      resolution: "2k",
      quality: "high",
      output_format: "png",
      response_format: "url",
    });
    expect(submitBody?.image).toMatch(/^data:image\/png;base64,/u);
    expect(String(submitBody?.prompt)).toContain(
      "Generate content only in the transparent region",
    );

    const queried = await adapter.query(
      {
        ...withPrepared(adapter, baseRequest),
        providerRequestId: "task_expand_1",
      } satisfies AuthorizedProviderQueryRequest,
      new AbortController().signal,
    );

    expect(queried.status).toBe("succeeded");
    expect(queried.output).toMatchObject({
      schemaVersion: "kanvas.image-canvas-expand-result/v1",
      targetWidth: 1024,
      targetHeight: 1024,
      qualitySignals: {
        method: "generative_outpaint",
        originalPixelsPreserved: true,
      },
    });
    expect(queried.outputs).toHaveLength(2);
    const expanded = await readBody(queried.outputs![0]!.body);
    const mask = await readBody(queried.outputs![1]!.body);
    const normalizedSource = await sharp(source)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer();
    const restoredRegion = await sharp(expanded)
      .extract({
        left: 100,
        top: 200,
        width: 4,
        height: 3,
      })
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(restoredRegion).toEqual(normalizedSource);
    const preservedMaskPixel = await sharp(mask)
      .extract({
        left: 100,
        top: 200,
        width: 1,
        height: 1,
      })
      .raw()
      .toBuffer();
    const generatedMaskPixel = await sharp(mask)
      .extract({
        left: 0,
        top: 0,
        width: 1,
        height: 1,
      })
      .raw()
      .toBuffer();
    expect([...preservedMaskPixel.subarray(0, 3)]).toEqual([0, 0, 0]);
    expect([...generatedMaskPixel.subarray(0, 3)]).toEqual([255, 255, 255]);
    expect(queried.outputs?.[0]).toMatchObject({
      outputRole: "expanded",
      artifactType: "image.expanded",
      metadata: {
        sourceArtifactId: id(20),
        originalPixelsPreserved: true,
        generationTaskId: "task_expand_1",
      },
    });
    expect(queried.outputs?.[1]).toMatchObject({
      outputRole: "generated_region_mask",
      artifactType: "image.generated-region-mask",
    });
  });

  it("does not decode or prepare the source again while the remote task is still queued", async () => {
    const adapter = new GenerationTasksCanvasExpandProviderAdapter({
      request: vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: {
          code: "success",
          data: {
            task_id: "task_expand_waiting",
            status: "queued",
            progress: "10%",
            updated_at: 100,
          },
        },
      }),
    });
    const currentRoute = route();
    const open = vi.fn();
    const request = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:expand",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        targetWidth: 1024,
        targetHeight: 1024,
        sourcePlacement: {
          x: 100,
          y: 200,
        },
        generatedRegion: {
          left: 100,
          top: 200,
          right: 920,
          bottom: 821,
        },
      },
      effectiveParameters: {
        resolution: "2k",
        quality: "high",
        outputFormat: "png",
      },
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext: context(currentRoute),
      credential: Buffer.from("sk-test-only"),
      inputArtifacts: {
        open,
      },
      providerRequestId: "task_expand_waiting",
    } satisfies AuthorizedProviderQueryRequest;

    await expect(
      adapter.query(
        withPrepared(adapter, request),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "accepted",
      providerRequestId: "task_expand_waiting",
    });
    expect(open).not.toHaveBeenCalled();
  });
});
