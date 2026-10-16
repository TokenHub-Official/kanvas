import type { CurrentProviderRouteSnapshot } from "@kanvas/application";
import type { ProviderInvocationExecutionContext } from "@kanvas/database/runtime";
import { digestProviderValue } from "@kanvas/database/runtime";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { GenerationTasksReconstructiveUpscaleProviderAdapter } from "../src/provider/generation-tasks-image-upscale-provider.js";
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
  presetKind: "newapi" | "tokenhub" = "tokenhub",
): ProviderInvocationExecutionContext {
  return {
    invocationId: id(11),
    workspaceId: id(12),
    route: currentRoute,
    implementationConfiguration: {
      promptTemplate:
        "Reconstruct this image at {{scaleFactor}}x fidelity.{{guidanceBlock}}",
      providerParameters: {
        resolution: "auto",
        quality: "high",
        outputFormat: "png",
      },
    },
    endpoint: {
      id: currentRoute.providerEndpointId,
      adapterKind: "openai_compatible",
      presetKind,
      baseUrl: "https://us-api.tokenhub.test",
      canonicalOrigin: "https://us-api.tokenhub.test",
      regionCode: "us",
      networkPolicy: {},
      dataPolicy: {},
    },
    model: {
      deploymentId: currentRoute.modelDeploymentId,
      providerModelId: "gpt-image-2",
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
  adapter: GenerationTasksReconstructiveUpscaleProviderAdapter,
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

describe("Generation Tasks reconstructive upscale Provider Adapter", () => {
  it.each(["tokenhub", "newapi"] as const)(
    "submits through the shared %s generation/tasks protocol and reconciles a trusted image output",
    async (presetKind) => {
      const source = await sharp({
        create: {
          width: 4,
          height: 3,
          channels: 3,
          background: {
            r: 20,
            g: 90,
            b: 180,
          },
        },
      })
        .png()
        .toBuffer();
      const generated = await sharp({
        create: {
          width: 8,
          height: 6,
          channels: 3,
          background: {
            r: 25,
            g: 95,
            b: 185,
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
          if (
            request.method === "POST" &&
            request.path === "/generation/tasks"
          ) {
            return Promise.resolve({
              statusCode: 200,
              headers: {},
              body: {
                code: "success",
                message: "",
                data: {
                  task_id: "task_upscale_1",
                  status: "queued",
                  media_type: "image",
                  model: "gpt-image-2",
                  created_at: 100,
                },
              },
            });
          }
          if (
            request.method === "GET" &&
            request.path === "/generation/tasks/task_upscale_1"
          ) {
            return Promise.resolve({
              statusCode: 200,
              headers: {},
              body: {
                code: "success",
                message: "",
                data: {
                  task_id: "task_upscale_1",
                  status: "succeeded",
                  progress: "100%",
                  result_urls: [
                    "https://assets.tokenhub.test/output.png?signature=redacted",
                  ],
                  ...(presetKind === "tokenhub"
                    ? { quota: 360_000, amount: 5.18, currency: "CNY" }
                    : {}),
                  updated_at: 200,
                },
              },
            });
          }
          if (
            request.method === "GET" &&
            request.baseUrl === "https://assets.tokenhub.test"
          ) {
            expect(request.responseMode).toBe("binary");
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
      const adapter = new GenerationTasksReconstructiveUpscaleProviderAdapter({
        request: requestHttp,
      } satisfies ProviderHttpTransport);
      const currentRoute = route();
      const executionContext = context(currentRoute, presetKind);
      const baseRequest: AuthorizedProviderInvocationRequest = {
        route: currentRoute,
        stableRequestKey: "kanvas:v1:upscale",
        requestFingerprint: digest("f"),
        input: {
          sourceArtifactId: id(20),
          qualityIntent: "reconstructive",
          scaleFactor: 2,
          guidance: "Preserve the product label.",
          resolution: "1k",
          quality: "low",
          outputFormat: "jpeg",
        },
        effectiveParameters: {
          resolution: "2k",
          quality: "high",
          outputFormat: "png",
        },
        deadlineAt: new Date(Date.now() + 10_000),
        executionContext,
        credential: Buffer.from("sk-test-only"),
        inputArtifacts: {
          open: vi.fn().mockResolvedValue({
            artifactId: id(20),
            storedObjectId: id(21),
            artifactType: "image.source",
            dataClassification: "confidential",
            byteSize: String(source.byteLength),
            sha256: digest("1").slice(7),
            mediaType: "image/png",
            ...(presetKind === "tokenhub"
              ? {
                  createProviderReadUrl: vi
                    .fn()
                    .mockResolvedValue(
                      "https://example-bucket.s3.us-west-1.amazonaws.com/objects/source.png?X-Amz-Signature=redacted",
                    ),
                }
              : {}),
            body: (async function* () {
              await Promise.resolve();
              yield source;
            })(),
          }),
        },
      };

      const preparedRequest = withPrepared(adapter, baseRequest);
      const submitted = await adapter.submit(
        {
          ...preparedRequest,
          input: {
            sourceArtifactId: id(99),
            qualityIntent: "reconstructive",
            scaleFactor: 2,
            guidance: "Changed after prepare.",
            quality: "low",
          },
          effectiveParameters: {
            resolution: "1k",
            quality: "low",
            outputFormat: "jpeg",
          },
        },
        new AbortController().signal,
      );

      expect(submitted).toMatchObject({
        status: "accepted",
        providerRequestId: "task_upscale_1",
      });
      const submitBody = calls[0]?.body as
        Readonly<Record<string, unknown>> | undefined;
      expect(submitBody).toMatchObject({
        model: "gpt-image-2",
        aspect_ratio: "4:3",
        resolution: "2k",
        quality: "high",
        output_format: "png",
        response_format: "url",
      });
      expect(submitBody?.images).toEqual([
        presetKind === "tokenhub"
          ? "https://example-bucket.s3.us-west-1.amazonaws.com/objects/source.png?X-Amz-Signature=redacted"
          : expect.stringMatching(/^data:image\/png;base64,/u),
      ]);
      expect(submitBody).not.toHaveProperty("image");
      expect(submitBody).not.toHaveProperty("size");
      expect(JSON.stringify(submitBody)).not.toContain("sourceArtifactId");
      expect(JSON.stringify(submitBody)).not.toContain("Changed after prepare");

      const confirmed = vi.fn(() => Promise.resolve());
      const queried = await adapter.query(
        withPrepared(adapter, {
          ...baseRequest,
          providerRequestId: "task_upscale_1",
          onResultConfirmed: confirmed,
        } satisfies AuthorizedProviderQueryRequest),
        new AbortController().signal,
      );

      expect(confirmed).toHaveBeenCalledWith(
        expect.objectContaining({ providerRequestId: "task_upscale_1" }),
      );
      // A failed result GET must not lose the already confirmed billing facts.
      const previousCalls = confirmed.mock.calls.length;
      requestHttp.mockImplementationOnce(() =>
        Promise.resolve({
          statusCode: 200,
          headers: {},
          body: {
            code: "success",
            data: {
              task_id: "task_upscale_1",
              status: "succeeded",
              result_urls: ["https://assets.tokenhub.test/output.png"],
              ...(presetKind === "tokenhub"
                ? { quota: 360000, amount: 5.18, currency: "CNY" }
                : {}),
            },
          },
        }),
      );
      requestHttp.mockRejectedValueOnce(new Error("result GET interrupted"));
      await expect(
        adapter.query(
          withPrepared(adapter, {
            ...baseRequest,
            providerRequestId: "task_upscale_1",
            onResultConfirmed: confirmed,
          }),
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      expect(confirmed).toHaveBeenCalledTimes(previousCalls + 1);
      expect(confirmed).toHaveBeenLastCalledWith(
        expect.objectContaining({
          resultEvidence: {
            urls: ["https://assets.tokenhub.test/output.png"],
            totalCount: 1,
            omittedCount: 0,
          },
        }),
      );
      expect(queried.status).toBe("succeeded");
      expect(queried.reportedCharge).toEqual(
        presetKind === "tokenhub"
          ? {
              source: "provider_reported",
              currencyCode: "USD",
              amount: "0.72",
            }
          : undefined,
      );
      expect(queried.usage).toEqual(
        presetKind === "tokenhub"
          ? [
              {
                metricKey: "tokenhub_quota",
                numericValue: "360000",
                unitCode: "quota",
              },
            ]
          : undefined,
      );
      expect(queried.output).toMatchObject({
        schemaVersion: "kanvas.image-upscale-result/v1",
        qualityIntent: "reconstructive",
        scaleFactor: 2,
      });
      expect(queried.outputs?.[0]).toMatchObject({
        outputRole: "upscaled",
        artifactType: "image.upscaled",
        mediaType: "image/png",
        byteSize: String(generated.byteLength),
        metadata: {
          operation: "image.upscale",
          sourceArtifactId: id(20),
          generationTaskId: "task_upscale_1",
        },
      });
      expect(await readBody(queried.outputs![0]!.body)).toEqual(generated);
      expect(calls[2]?.path).toBe("/output.png?signature=redacted");
    },
  );

  it("keeps queued and processing responses recoverable by provider request ID", async () => {
    const requestHttp = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: {
          code: "success",
          data: {
            task_id: "task_waiting_1",
            status: "queued",
            updated_at: 100,
          },
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: {
          code: "success",
          data: {
            task_id: "task_waiting_1",
            status: "processing",
            updated_at: 101,
          },
        },
      });
    const adapter = new GenerationTasksReconstructiveUpscaleProviderAdapter({
      request: requestHttp,
    });
    const currentRoute = route();
    const queryRequest = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:upscale",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        qualityIntent: "reconstructive",
        scaleFactor: 2,
      },
      effectiveParameters: {
        resolution: "2k",
        quality: "high",
        outputFormat: "png",
      },
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext: context(currentRoute),
      credential: Buffer.from("sk-test-only"),
      providerRequestId: "task_waiting_1",
    } satisfies AuthorizedProviderQueryRequest;

    await expect(
      adapter.query(
        withPrepared(adapter, queryRequest),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "accepted",
      providerRequestId: "task_waiting_1",
    });
    await expect(
      adapter.query(
        withPrepared(adapter, queryRequest),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "running",
      providerRequestId: "task_waiting_1",
    });
  });

  it.each([
    {
      name: "non-object body",
      body: null,
      stableErrorCode: "provider.response_body_invalid",
      diagnosticKey: "r-n",
    },
    {
      name: "unsupported envelope code",
      body: {
        code: "ok",
        data: {},
      },
      stableErrorCode: "provider.response_code_unsupported",
      diagnosticKey: "r-o.c-s.d-o.e-u.m-u.t-u.s-u.x-0",
    },
    {
      name: "unknown root field without its name or value",
      body: {
        code: "ok",
        data: {},
        "private-field-name": "private-field-value",
      },
      stableErrorCode: "provider.response_code_unsupported",
      diagnosticKey: "r-o.c-s.d-o.e-u.m-u.t-u.s-u.x-1",
    },
    {
      name: "missing data object",
      body: {
        code: "success",
      },
      stableErrorCode: "provider.response_data_invalid",
      diagnosticKey: "r-o.c-s.d-u.e-u.m-u.t-u.s-u.x-0",
    },
    {
      name: "invalid task ID",
      body: {
        code: "success",
        data: {
          status: "queued",
        },
      },
      stableErrorCode: "provider.response_task_id_invalid",
      diagnosticKey: "d-o.t-u.s-s.r-u.u-u.c-u.e-u.m-u.x-0",
    },
    {
      name: "different task ID",
      body: {
        code: "success",
        data: {
          task_id: "task_different",
          status: "queued",
        },
      },
      stableErrorCode: "provider.response_task_id_mismatch",
      diagnosticKey: "d-o.t-s.s-s.r-u.u-u.c-u.e-u.m-u.x-0",
    },
    {
      name: "unsupported status",
      body: {
        code: "success",
        data: {
          task_id: "task_contract_probe",
          status: "pending",
        },
      },
      stableErrorCode: "provider.response_status_unsupported",
      diagnosticKey: "d-o.t-s.s-s.r-u.u-u.c-u.e-u.m-u.x-0",
    },
    {
      name: "invalid result URLs",
      body: {
        code: "success",
        data: {
          task_id: "task_contract_probe",
          status: "succeeded",
          result_urls: null,
        },
      },
      stableErrorCode: "provider.response_result_urls_invalid",
      diagnosticKey: "d-o.t-s.s-s.r-n.u-u.c-u.e-u.m-u.x-0",
    },
  ])(
    "classifies $name without persisting the remote response",
    async ({ body, stableErrorCode, diagnosticKey }) => {
      const adapter = new GenerationTasksReconstructiveUpscaleProviderAdapter({
        request: vi.fn().mockResolvedValue({
          statusCode: 200,
          headers: {},
          body,
        }),
      });
      const currentRoute = route();
      const queryRequest = {
        route: currentRoute,
        stableRequestKey: "kanvas:v1:upscale",
        requestFingerprint: digest("f"),
        input: {
          sourceArtifactId: id(20),
          qualityIntent: "reconstructive",
          scaleFactor: 2,
        },
        effectiveParameters: {
          resolution: "2k",
          quality: "high",
          outputFormat: "png",
        },
        deadlineAt: new Date(Date.now() + 10_000),
        executionContext: context(currentRoute),
        credential: Buffer.from("sk-test-only"),
        providerRequestId: "task_contract_probe",
      } satisfies AuthorizedProviderQueryRequest;

      await expect(
        adapter.query(
          withPrepared(adapter, queryRequest),
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        stableErrorCode,
        effect: "unknown",
        diagnosticKey,
      });
    },
  );

  it("keeps transient query failures attached to the existing task instead of permitting resubmission", async () => {
    const adapter = new GenerationTasksReconstructiveUpscaleProviderAdapter({
      request: vi.fn().mockResolvedValue({
        statusCode: 429,
        headers: {},
        body: {
          code: "rate_limited",
          message: "retry later",
        },
      }),
    });
    const currentRoute = route();
    const queryRequest = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:upscale",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        qualityIntent: "reconstructive",
        scaleFactor: 2,
      },
      effectiveParameters: {
        resolution: "2k",
        quality: "high",
        outputFormat: "png",
      },
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext: context(currentRoute),
      credential: Buffer.from("sk-test-only"),
      providerRequestId: "task_existing_1",
    } satisfies AuthorizedProviderQueryRequest;

    await expect(
      adapter.query(
        withPrepared(adapter, queryRequest),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "unknown",
      providerRequestId: "task_existing_1",
      stableErrorCode: "provider.remote_rate_limited",
    });
  });

  it("holds an ambiguous submit-side 5xx without authorizing another paid task", async () => {
    const source = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: {
          r: 20,
          g: 40,
          b: 60,
        },
      },
    })
      .png()
      .toBuffer();
    const adapter = new GenerationTasksReconstructiveUpscaleProviderAdapter({
      request: vi.fn().mockResolvedValue({
        statusCode: 503,
        headers: {},
        body: {
          code: "upstream_unavailable",
        },
      }),
    });
    const currentRoute = route();
    const submitRequest = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:upscale",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        qualityIntent: "reconstructive",
        scaleFactor: 2,
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
        open: vi.fn().mockResolvedValue({
          artifactId: id(20),
          storedObjectId: id(21),
          artifactType: "image.source",
          dataClassification: "confidential",
          byteSize: String(source.byteLength),
          sha256: digest("1").slice(7),
          mediaType: "image/png",
          createProviderReadUrl: vi
            .fn()
            .mockResolvedValue(
              "https://example-bucket.s3.us-west-1.amazonaws.com/objects/source.png?X-Amz-Signature=redacted",
            ),
          body: (async function* () {
            await Promise.resolve();
            yield source;
          })(),
        }),
      },
    } satisfies AuthorizedProviderInvocationRequest;

    await expect(
      adapter.submit(
        withPrepared(adapter, submitRequest),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "unknown",
      stableErrorCode: "provider.remote_unavailable",
    });
  });

  it("fails closed before preparation when effective parameters are unknown or unpinned", () => {
    const adapter = new GenerationTasksReconstructiveUpscaleProviderAdapter({
      request: vi.fn(),
    });
    const currentRoute = route();
    const request = {
      route: currentRoute,
      stableRequestKey: "kanvas:v1:upscale-invalid",
      requestFingerprint: digest("f"),
      input: {
        sourceArtifactId: id(20),
        qualityIntent: "reconstructive",
        scaleFactor: 2,
      },
      effectiveParameters: {
        seed: 7,
      },
      deadlineAt: new Date(Date.now() + 10_000),
      executionContext: context(currentRoute),
    };

    expect(() => adapter.prepare(request)).toThrow(/unknown or unpinned/u);
  });
});
