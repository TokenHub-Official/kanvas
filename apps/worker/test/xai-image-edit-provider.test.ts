import { createHash } from "node:crypto";

import type { CurrentProviderRouteSnapshot } from "@kanvas/application";
import {
  digestProviderValue,
  type ProviderInvocationExecutionContext,
} from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import { XaiImageEditProviderAdapter } from "../src/provider/xai-image-edit-provider.js";
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

function route(): CurrentProviderRouteSnapshot {
  return Object.freeze({
    providerProtocolVersion: 1,
    providerKey: "xai",
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
    parameterPolicies: Object.freeze({
      aspectRatio: Object.freeze({
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
      promptTemplate: "Edit precisely: {{prompt}}",
    }),
    endpoint: Object.freeze({
      id: currentRoute.providerEndpointId,
      adapterKind: "openai_compatible",
      presetKind: "xai",
      baseUrl: "https://api.x.ai/v1",
      canonicalOrigin: "https://api.x.ai",
      regionCode: "global",
      networkPolicy: {},
      dataPolicy: {},
    }),
    model: Object.freeze({
      deploymentId: currentRoute.modelDeploymentId,
      providerModelId: "grok-imagine-image-quality",
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
      deploymentReference: "deployment://provider/xai",
    }),
  });
}

function jpeg(marker = 0): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, marker, 0, 0, 0, 0, 0, 0, 0]);
}

function png(marker = 0): Buffer {
  return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, marker, 0, 0, 0]);
}

function artifact(
  artifactId: string,
  bytes: Buffer,
  createProviderReadUrl?: () => Promise<string>,
) {
  return Object.freeze({
    artifactId,
    storedObjectId: id(30),
    artifactType: "image.source",
    dataClassification: "confidential" as const,
    byteSize: String(bytes.byteLength),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mediaType:
      bytes[0] === 0xff ? ("image/jpeg" as const) : ("image/png" as const),
    ...(createProviderReadUrl ? { createProviderReadUrl } : {}),
    body: (async function* () {
      await Promise.resolve();
      yield Buffer.from(bytes);
    })(),
  });
}

function invocation(
  executionContext: ProviderInvocationExecutionContext,
  input: Readonly<Record<string, unknown>>,
  open = vi.fn(),
  effectiveParameters: Readonly<Record<string, string | number | boolean>> = {},
): AuthorizedProviderInvocationRequest {
  return Object.freeze({
    route: executionContext.route,
    stableRequestKey: "kanvas:v1:xai-image-edit",
    requestFingerprint: digest("9"),
    input,
    effectiveParameters,
    deadlineAt: new Date(Date.now() + 10_000),
    executionContext,
    credential: Buffer.from("xai-test-key", "utf8"),
    inputArtifacts: Object.freeze({ open }),
  });
}

function preparedRequest(
  adapter: XaiImageEditProviderAdapter,
  request: AuthorizedProviderInvocationRequest,
): AuthorizedProviderInvocationRequest {
  const prepared = adapter.prepare(request);
  return Object.freeze({
    ...request,
    preparedRequestSnapshot: prepared.snapshot,
    preparedRequestDigest: digestProviderValue(prepared.snapshot),
  });
}

async function outputBytes(output: ProviderImageOutput): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of output.body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("xAI JSON image edit Provider Adapter", () => {
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
            body: {
              data: [
                { url: "https://imgen.x.ai/edit.jpg", mime_type: "image/jpeg" },
              ],
              usage: { cost_in_usd_ticks: 220000000 },
            },
          });
        expect(confirmed).toHaveBeenCalledOnce();
        return Promise.reject(new Error("result GET interrupted"));
      },
    );
    const adapter = new XaiImageEditProviderAdapter({ request: transport });
    const input = invocation(
      context(route()),
      { sourceArtifactId: id(20), prompt: "Add a crown" },
      vi.fn(() => Promise.resolve(artifact(id(20), png(7)))),
    );
    const prepared: AuthorizedProviderInvocationRequest = {
      ...preparedRequest(adapter, input),
      onResultConfirmed: confirmed,
    };
    await expect(
      adapter.submit(prepared, new AbortController().signal),
    ).rejects.toThrow("result GET interrupted");
    expect(confirmed.mock.calls[0]?.[0].resultEvidence).toEqual({
      urls: ["https://imgen.x.ai/edit.jpg"],
      totalCount: 1,
      omittedCount: 0,
    });
    expect(confirmed.mock.calls[0]?.[0].usage).toContainEqual({
      metricKey: "xai_cost_in_usd_ticks",
      numericValue: "220000000",
      unitCode: "usd_tick",
    });
    expect(
      transport.mock.calls.filter(([call]) => call.method === "POST"),
    ).toHaveLength(1);
  });

  it("keeps the snapshot secret-free, sends a signed Artifact URL, and preserves provider-reported ticks as a quantity", async () => {
    const sourceId = id(20);
    const source = png(7);
    const edited = jpeg(9);
    const signedUrl =
      "https://storage.example.test/source.png?signature=test-only";
    const open = vi
      .fn()
      .mockResolvedValue(
        artifact(sourceId, source, () => Promise.resolve(signedUrl)),
      );
    const requestHttp = vi.fn(
      (request: ProviderHttpRequest): Promise<ProviderHttpResponse> => {
        if (request.method === "POST") {
          return Promise.resolve({
            statusCode: 200,
            headers: {
              "x-grok-request-id": "req_xai_edit_1",
            },
            body: {
              data: [
                {
                  url: "https://imgen.x.ai/xai-imgen/edited.jpeg",
                  mime_type: "image/jpeg",
                  revised_prompt: "",
                },
              ],
              usage: {
                cost_in_usd_ticks: 220_000_000,
              },
            },
          });
        }
        return Promise.resolve({
          statusCode: 200,
          headers: {
            "content-type": "image/jpeg",
          },
          body: Buffer.from(edited),
        });
      },
    );
    const adapter = new XaiImageEditProviderAdapter({
      request: requestHttp,
    });
    const executionContext = context(route());
    const request = invocation(
      executionContext,
      {
        sourceArtifactId: sourceId,
        prompt: "Add a paper crown",
        aspectRatio: "3:2",
      },
      open,
      { aspectRatio: "3:2" },
    );

    const prepared = adapter.prepare(request);

    expect(prepared.snapshot).toMatchObject({
      schemaVersion: "kanvas.xai-image-edit-request/v1",
      adapterKey: "xai.images.edits.v1",
      method: "POST",
      path: "/images/edits",
      body: {
        model: "grok-imagine-image-quality",
        prompt: "Edit precisely: Add a paper crown",
        aspect_ratio: "3:2",
      },
      inputArtifacts: [
        {
          artifactId: sourceId,
          inputPointer: "/sourceArtifactId",
        },
      ],
    });
    expect(JSON.stringify(prepared.snapshot)).not.toContain("xai-test-key");
    expect(JSON.stringify(prepared.snapshot)).not.toContain("signature");
    expect(JSON.stringify(prepared.snapshot)).not.toContain(
      source.toString("base64"),
    );
    expect(open).not.toHaveBeenCalled();

    const observation = await adapter.submit(
      preparedRequest(adapter, request),
      new AbortController().signal,
    );

    expect(open).toHaveBeenCalledWith({
      inputPointer: "/sourceArtifactId",
    });
    expect(requestHttp.mock.calls[0]?.[0]).toMatchObject({
      baseUrl: "https://api.x.ai/v1",
      path: "/images/edits",
      method: "POST",
      body: {
        model: "grok-imagine-image-quality",
        prompt: "Edit precisely: Add a paper crown",
        aspect_ratio: "3:2",
        image: {
          type: "image_url",
          url: signedUrl,
        },
      },
    });
    expect(requestHttp.mock.calls[1]?.[0]).toMatchObject({
      baseUrl: "https://imgen.x.ai",
      path: "/xai-imgen/edited.jpeg",
      method: "GET",
      responseMode: "binary",
    });
    expect(observation).toMatchObject({
      status: "succeeded",
      providerRequestId: "req_xai_edit_1",
      output: {
        schemaVersion: "kanvas.image-edit-result/v1",
        sourceArtifactId: sourceId,
        imageArtifactId: {
          $kanvas: "attempt-output-artifact/v1",
          outputRole: "edited",
          outputIndex: 0,
        },
      },
      usage: [
        {
          metricKey: "output_images",
          numericValue: "1",
          unitCode: "image",
        },
        {
          metricKey: "xai_cost_in_usd_ticks",
          numericValue: "220000000",
          unitCode: "usd_tick",
        },
      ],
    });
    expect(JSON.stringify(observation)).not.toContain("reportedCharge");
    expect(observation.outputs?.[0]?.metadata).toMatchObject({
      providerUsageEvidence: "provider_reported",
    });
    expect(await outputBytes(observation.outputs![0]!)).toEqual(edited);
  });

  it("materializes up to three verified Artifacts as bounded data URLs when signed reads are unavailable", async () => {
    const ids = [id(20), id(21), id(22)];
    const sources = [png(1), jpeg(2), png(3)];
    const edited = jpeg(4);
    const open = vi.fn(({ inputPointer }: { inputPointer: string }) => {
      const index =
        inputPointer === "/sourceArtifactId"
          ? 0
          : Number(inputPointer.split("/").at(-1)) + 1;
      return Promise.resolve(artifact(ids[index]!, sources[index]!));
    });
    const requestHttp = vi.fn(
      (request: ProviderHttpRequest): Promise<ProviderHttpResponse> =>
        Promise.resolve(
          request.method === "POST"
            ? {
                statusCode: 200,
                headers: {},
                body: {
                  data: [
                    {
                      url: "https://imgen.x.ai/edit.jpg",
                      mime_type: "image/jpeg",
                    },
                  ],
                },
              }
            : {
                statusCode: 200,
                headers: {
                  "content-type": "image/jpeg",
                },
                body: Buffer.from(edited),
              },
        ),
    );
    const adapter = new XaiImageEditProviderAdapter({
      request: requestHttp,
    });
    const request = invocation(
      context(route()),
      {
        sourceArtifactId: ids[0],
        referenceArtifactIds: [ids[1], ids[2]],
        prompt: "Combine these subjects",
      },
      open,
    );

    const observation = await adapter.submit(
      preparedRequest(adapter, request),
      new AbortController().signal,
    );

    expect(open.mock.calls.map(([value]) => value)).toEqual([
      { inputPointer: "/sourceArtifactId" },
      { inputPointer: "/referenceArtifactIds/0" },
      { inputPointer: "/referenceArtifactIds/1" },
    ]);
    const outboundBody = requestHttp.mock.calls[0]?.[0].body as {
      images: readonly { url: string; type: string }[];
    };
    expect(outboundBody.images).toHaveLength(3);
    expect(outboundBody.images[0]).toEqual({
      type: "image_url",
      url: `data:image/png;base64,${sources[0]!.toString("base64")}`,
    });
    expect(outboundBody.images[1]?.url).toMatch(/^data:image\/jpeg;base64,/u);
    expect(observation.status).toBe("succeeded");
  });

  it("rejects tampered snapshots, foreign output origins, and malformed provider cost quantities", async () => {
    const sourceId = id(20);
    const source = png();
    const open = vi
      .fn()
      .mockImplementation(() => Promise.resolve(artifact(sourceId, source)));
    const baseRequest = invocation(
      context(route()),
      {
        sourceArtifactId: sourceId,
        prompt: "Restyle",
      },
      open,
    );
    const adapter = new XaiImageEditProviderAdapter({
      request: vi.fn(),
    } satisfies ProviderHttpTransport);
    const prepared = adapter.prepare(baseRequest);

    await expect(
      adapter.submit(
        {
          ...baseRequest,
          preparedRequestSnapshot: prepared.snapshot,
          preparedRequestDigest: digest("0"),
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/snapshot is missing or invalid/u);
    expect(open).not.toHaveBeenCalled();

    const invalidOrigin = new XaiImageEditProviderAdapter({
      request: vi.fn(
        (request: ProviderHttpRequest): Promise<ProviderHttpResponse> =>
          Promise.resolve({
            statusCode: 200,
            headers: {},
            body:
              request.method === "POST"
                ? {
                    data: [
                      {
                        url: "https://evil.example/image.jpg",
                        mime_type: "image/jpeg",
                      },
                    ],
                  }
                : jpeg(),
          }),
      ),
    });
    await expect(
      invalidOrigin.submit(
        preparedRequest(invalidOrigin, baseRequest),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      stableErrorCode: "provider.response_url_invalid",
    });

    const invalidUsage = new XaiImageEditProviderAdapter({
      request: vi.fn((): Promise<ProviderHttpResponse> =>
        Promise.resolve({
          statusCode: 200,
          headers: {},
          body: {
            data: [
              {
                url: "https://imgen.x.ai/edit.jpg",
                mime_type: "image/jpeg",
              },
            ],
            usage: {
              cost_in_usd_ticks: -1,
            },
          },
        }),
      ),
    });
    await expect(
      invalidUsage.submit(
        preparedRequest(invalidUsage, baseRequest),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      stableErrorCode: "provider.response_usage_invalid",
    });
  });

  it("fails closed for masks and more than three input Artifacts", () => {
    const adapter = new XaiImageEditProviderAdapter({
      request: vi.fn(),
    } satisfies ProviderHttpTransport);
    const executionContext = context(route());
    expect(() =>
      adapter.prepare(
        invocation(executionContext, {
          sourceArtifactId: id(20),
          maskArtifactId: id(21),
          prompt: "Masked edit",
        }),
      ),
    ).toThrow(/bounded Adapter contract/u);
    expect(() =>
      adapter.prepare(
        invocation(executionContext, {
          sourceArtifactId: id(20),
          referenceArtifactIds: [id(21), id(22), id(23)],
          prompt: "Too many references",
        }),
      ),
    ).toThrow(/one or two Artifact IDs/u);
  });
});
