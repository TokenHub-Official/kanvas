import { readFileSync } from "node:fs";
import type { CurrentProviderRouteSnapshot } from "@kanvas/application";
import {
  digestProviderValue,
  type ProviderInvocationExecutionContext,
} from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import { GenerationTasksImageEditProviderAdapter } from "../src/provider/generation-tasks-image-edit-provider.js";
import { GenerationTasksImageGenerateProviderAdapter } from "../src/provider/generation-tasks-image-generate-provider.js";
import type {
  AsyncProviderAdapter,
  AuthorizedProviderInvocationRequest,
  ProviderRequestPreparationRequest,
} from "../src/provider/provider-adapter.js";
import { ProviderAdapterCallError } from "../src/provider/provider-adapter.js";
import type {
  ProviderHttpRequest,
  ProviderHttpResponse,
  ProviderHttpTransport,
} from "../src/provider/provider-http-transport.js";
import type { WorkerInputArtifactRead } from "../src/storage/worker-input-artifact-resolver.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const generateParameterPolicies = Object.freeze({
  aspectRatio: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  resolution: Object.freeze({
    callerPolicy: "optional" as const,
  }),
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
  numberOfImages: Object.freeze({
    callerPolicy: "optional" as const,
  }),
  seed: Object.freeze({
    callerPolicy: "optional" as const,
  }),
});

const editParameterPolicies = Object.freeze({
  resolution: Object.freeze({
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
  seed: Object.freeze({
    callerPolicy: "optional" as const,
  }),
});

function route(
  operation: "image.generate" | "image.edit",
  preset: "newapi" | "tokenhub" = "newapi",
  overrides: Partial<CurrentProviderRouteSnapshot> = {},
): CurrentProviderRouteSnapshot {
  return Object.freeze({
    providerProtocolVersion: 1,
    providerKey: preset,
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
    modelOperation: operation,
    parameterPolicies:
      operation === "image.generate"
        ? generateParameterPolicies
        : editParameterPolicies,
    parameterPolicyDigest: digest("d"),
    ...overrides,
  });
}

function context(
  currentRoute: CurrentProviderRouteSnapshot,
  preset: "newapi" | "tokenhub",
): ProviderInvocationExecutionContext {
  return Object.freeze({
    invocationId: id(11),
    workspaceId: id(12),
    route: currentRoute,
    implementationConfiguration: Object.freeze({
      promptTemplate: "Prepared: {{prompt}}",
    }),
    endpoint: Object.freeze({
      id: currentRoute.providerEndpointId,
      adapterKind: "openai_compatible",
      presetKind: preset,
      baseUrl:
        preset === "tokenhub"
          ? "https://us-api.tokenhub.test"
          : "https://newapi.test/v1",
      canonicalOrigin:
        preset === "tokenhub"
          ? "https://us-api.tokenhub.test"
          : "https://newapi.test",
      regionCode: preset === "tokenhub" ? "us" : "private",
      networkPolicy: {},
      dataPolicy: {},
    }),
    model: Object.freeze({
      deploymentId: currentRoute.modelDeploymentId,
      providerModelId: "image-task-model",
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

function preparationRequest(options: {
  readonly operation: "image.generate" | "image.edit";
  readonly preset: "newapi" | "tokenhub";
  readonly input: Readonly<Record<string, unknown>>;
  readonly effectiveParameters: Readonly<
    Record<string, string | number | boolean>
  >;
  readonly route?: CurrentProviderRouteSnapshot;
}): ProviderRequestPreparationRequest {
  const currentRoute =
    options.route ?? route(options.operation, options.preset);
  return Object.freeze({
    route: currentRoute,
    stableRequestKey: `kanvas:v1:${options.operation}`,
    requestFingerprint: digest("9"),
    input: options.input,
    effectiveParameters: options.effectiveParameters,
    deadlineAt: new Date(Date.now() + 10_000),
    executionContext: context(currentRoute, options.preset),
  });
}

function authorizedRequest(
  adapter: AsyncProviderAdapter,
  preparedRequest: ProviderRequestPreparationRequest,
  open = vi.fn(),
): AuthorizedProviderInvocationRequest {
  if (!preparedRequest.executionContext || !adapter.prepare) {
    throw new Error("Test preparation context is missing.");
  }
  const prepared = adapter.prepare(preparedRequest);
  return Object.freeze({
    ...preparedRequest,
    executionContext: preparedRequest.executionContext,
    preparedRequestSnapshot: prepared.snapshot,
    preparedRequestDigest: digestProviderValue(prepared.snapshot),
    credential: Buffer.from("provider-test-key", "utf8"),
    inputArtifacts: {
      open,
    },
  });
}

function artifact(
  artifactId: string,
  bytes: Buffer,
  options: {
    readonly createProviderReadUrl?: () => Promise<string>;
    readonly mediaType?: "image/png" | "image/jpeg" | "image/webp";
  } = {},
): WorkerInputArtifactRead {
  return Object.freeze({
    artifactId,
    storedObjectId: id(30),
    artifactType: "image.source",
    dataClassification: "confidential",
    byteSize: String(bytes.byteLength),
    sha256: "0".repeat(64),
    mediaType: options.mediaType ?? "image/png",
    ...(options.createProviderReadUrl
      ? {
          createProviderReadUrl: options.createProviderReadUrl,
        }
      : {}),
    body: (async function* () {
      await Promise.resolve();
      yield bytes;
    })(),
  });
}

function queuedResponse(taskId: string): Promise<ProviderHttpResponse> {
  return Promise.resolve({
    statusCode: 200,
    headers: {},
    body: {
      code: "success",
      data: {
        task_id: taskId,
        status: "queued",
        created_at: 1,
      },
    },
  });
}

it("preserves an upstream rejection and request ID without leaking credentials", async () => {
  const adapter = new GenerationTasksImageGenerateProviderAdapter({
    request: vi.fn().mockResolvedValue({
      statusCode: 400,
      headers: { "x-oneapi-request-id": "upstream-request-123" },
      body: {
        code: "invalid_request",
        message: "image is not allowed",
        debug: "provider-test-key",
        token: "hidden",
      },
    }),
  });
  const request = authorizedRequest(
    adapter,
    preparationRequest({
      operation: "image.generate",
      preset: "tokenhub",
      input: { prompt: "A tree" },
      effectiveParameters: {},
    }),
  );
  const result = await adapter.submit(request, new AbortController().signal);
  expect(result).toMatchObject({
    status: "failed",
    stableErrorCode: "provider.remote_invalid_request",
    upstreamError: { statusCode: 400, requestId: "upstream-request-123" },
  });
  expect(result.upstreamError?.body).toContain("image is not allowed");
  expect(result.upstreamError?.body).not.toContain("provider-test-key");
  expect(result.upstreamError?.body).not.toContain("hidden");
});

it.each(["status_query", "result_download"] as const)(
  "identifies a Generation Tasks %s transport failure",
  async (stage) => {
    const taskId = "task_output_stage";
    const transport: ProviderHttpTransport = {
      isResultUrlAllowed: (value) =>
        value.startsWith("https://assets.example.test/"),
      request: vi.fn((request: ProviderHttpRequest) => {
        if (
          stage === "status_query" ||
          request.targetKind === "provider_result"
        ) {
          throw new ProviderAdapterCallError(
            "provider.transport_deadline_exceeded",
            "unknown",
            "sensitive-output-url",
          );
        }
        return Promise.resolve({
          statusCode: 200,
          headers: {},
          body: {
            code: "success",
            data: {
              task_id: taskId,
              status: "succeeded",
              result_urls: ["https://assets.example.test/result.png"],
              updated_at: 2,
            },
          },
        });
      }),
    };
    const adapter = new GenerationTasksImageGenerateProviderAdapter(transport);
    const prepared = preparationRequest({
      operation: "image.generate",
      preset: "tokenhub",
      input: { prompt: "Winter poster" },
      effectiveParameters: {},
    });

    const onResultConfirmed = vi.fn().mockResolvedValue(undefined);
    const queryRequest = {
      ...authorizedRequest(adapter, prepared),
      providerRequestId: taskId,
      onResultConfirmed,
    };
    await expect(
      adapter.query(queryRequest, new AbortController().signal),
    ).rejects.toMatchObject({
      stableErrorCode: "provider.transport_deadline_exceeded",
      message: "provider.transport_deadline_exceeded",
      stage,
    });
    if (stage === "result_download") {
      expect(onResultConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({
          resultUrls: ["https://assets.example.test/result.png"],
        }),
      );
    } else expect(onResultConfirmed).not.toHaveBeenCalled();
  },
);

describe("Generation Tasks atomic image request snapshots", () => {
  it("prepares effective generate parameters and reference lineage, then reuses the snapshot after caller input changes", async () => {
    const firstReferenceId = id(20);
    const secondReferenceId = id(21);
    const firstBytes = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10, 1, 0, 0, 0,
    ]);
    const secondBytes = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10, 2, 0, 0, 0,
    ]);
    const requestHttp = vi.fn((httpRequest: ProviderHttpRequest) => {
      void httpRequest;
      return queuedResponse("task_generate_snapshot");
    });
    const adapter = new GenerationTasksImageGenerateProviderAdapter({
      request: requestHttp,
    });
    const request = preparationRequest({
      operation: "image.generate",
      preset: "newapi",
      input: {
        prompt: "A glass pavilion",
        referenceArtifactIds: [firstReferenceId, secondReferenceId],
        quality: "low",
        aspectRatio: "1:1",
      },
      effectiveParameters: {
        aspectRatio: "16:9",
        resolution: "2k",
        quality: "high",
        outputFormat: "webp",
        outputCompression: 82,
        numberOfImages: 2,
        seed: 42,
      },
    });

    const first = adapter.prepare(request);
    const second = adapter.prepare(request);

    expect(first).toEqual(second);
    expect(first.snapshot).toMatchObject({
      schemaVersion: "kanvas.generation-tasks-image-request/v1",
      adapterKey: "generation-tasks.image.generate.v1",
      method: "POST",
      path: "/generation/tasks",
      operation: "image.generate",
      provider: {
        preset: "newapi",
        providerModelId: "image-task-model",
      },
      body: {
        model: "image-task-model",
        prompt: "Prepared: A glass pavilion",
        aspect_ratio: "16:9",
        resolution: "2k",
        quality: "high",
        output_format: "webp",
        output_compression: 82,
        n: 2,
        seed: 42,
        response_format: "url",
      },
      inputArtifacts: [
        {
          role: "reference",
          artifactId: firstReferenceId,
          inputPointer: "/referenceArtifactIds/0",
        },
        {
          role: "reference",
          artifactId: secondReferenceId,
          inputPointer: "/referenceArtifactIds/1",
        },
      ],
      result: {
        outputRole: "generated",
        artifactType: "image.generated",
      },
    });
    const serialized = JSON.stringify(first.snapshot);
    expect(serialized).not.toContain("provider-test-key");
    expect(serialized).not.toContain(firstBytes.toString("base64"));
    expect(serialized).not.toContain("data:image/");

    const open = vi.fn(({ inputPointer }: { readonly inputPointer: string }) =>
      Promise.resolve(
        inputPointer.endsWith("/0")
          ? artifact(firstReferenceId, firstBytes)
          : artifact(secondReferenceId, secondBytes),
      ),
    );
    if (!request.executionContext) {
      throw new Error("Test execution context is missing.");
    }
    const invocation: AuthorizedProviderInvocationRequest = Object.freeze({
      ...request,
      input: {
        prompt: "Changed after prepare",
        referenceArtifactIds: [id(22)],
      },
      effectiveParameters: {
        aspectRatio: "1:1",
        quality: "low",
      },
      executionContext: request.executionContext,
      preparedRequestSnapshot: first.snapshot,
      preparedRequestDigest: digestProviderValue(first.snapshot),
      credential: Buffer.from("provider-test-key", "utf8"),
      inputArtifacts: {
        open,
      },
    });

    await expect(
      adapter.submit(invocation, new AbortController().signal),
    ).resolves.toMatchObject({
      status: "accepted",
      providerRequestId: "task_generate_snapshot",
    });

    expect(open.mock.calls.map(([value]) => value)).toEqual([
      {
        inputPointer: "/referenceArtifactIds/0",
      },
      {
        inputPointer: "/referenceArtifactIds/1",
      },
    ]);
    expect(requestHttp.mock.calls[0]?.[0].body).toEqual({
      model: "image-task-model",
      prompt: "Prepared: A glass pavilion",
      n: 2,
      output_format: "webp",
      response_format: "url",
      images: [
        `data:image/png;base64,${firstBytes.toString("base64")}`,
        `data:image/png;base64,${secondBytes.toString("base64")}`,
      ],
      aspect_ratio: "16:9",
      resolution: "2k",
      quality: "high",
      output_compression: 82,
      seed: 42,
    });
    expect(JSON.stringify(requestHttp.mock.calls[0]?.[0].body)).not.toContain(
      "Changed after prepare",
    );
  });

  it("keeps TokenHub signed source URLs out of edit snapshots and refreshes them for retries", async () => {
    const sourceArtifactId = id(20);
    const createProviderReadUrl = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce(
        "https://assets.tokenhub.test/source.png?signature=first",
      )
      .mockResolvedValueOnce(
        "https://assets.tokenhub.test/source.png?signature=second",
      );
    const open = vi.fn().mockImplementation(() =>
      Promise.resolve(
        artifact(
          sourceArtifactId,
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
          {
            createProviderReadUrl,
          },
        ),
      ),
    );
    const requestHttp = vi.fn((httpRequest: ProviderHttpRequest) => {
      void httpRequest;
      return queuedResponse("task_edit_snapshot");
    });
    const adapter = new GenerationTasksImageEditProviderAdapter({
      request: requestHttp,
    });
    const request = preparationRequest({
      operation: "image.edit",
      preset: "tokenhub",
      input: {
        sourceArtifactId,
        prompt: "Replace the background",
        quality: "low",
      },
      effectiveParameters: {
        resolution: "4k",
        quality: "high",
        outputFormat: "png",
        outputCompression: 90,
        seed: 7,
      },
    });
    const prepared = adapter.prepare(request);
    const serialized = JSON.stringify(prepared.snapshot);

    expect(prepared.snapshot).toMatchObject({
      operation: "image.edit",
      provider: {
        preset: "tokenhub",
      },
      body: {
        prompt: "Prepared: Replace the background",
        resolution: "4k",
        quality: "high",
        output_format: "png",
        output_compression: 90,
        seed: 7,
      },
      inputArtifacts: [
        {
          role: "source",
          artifactId: sourceArtifactId,
          inputPointer: "/sourceArtifactId",
        },
      ],
      result: {
        outputRole: "edited",
        artifactType: "image.edited",
        sourceArtifactId,
      },
    });
    expect(serialized).not.toContain("signature=");
    expect(createProviderReadUrl).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    const invocation = authorizedRequest(adapter, request, open);
    const changedInvocation: AuthorizedProviderInvocationRequest =
      Object.freeze({
        ...invocation,
        input: {
          sourceArtifactId: id(99),
          prompt: "Changed after prepare",
        },
        effectiveParameters: {
          quality: "low",
        },
      });

    await adapter.submit(changedInvocation, new AbortController().signal);
    await adapter.submit(changedInvocation, new AbortController().signal);

    expect(createProviderReadUrl).toHaveBeenCalledTimes(2);
    expect(requestHttp).toHaveBeenCalledTimes(2);
    expect(requestHttp.mock.calls[0]?.[0].body).toMatchObject({
      prompt: "Prepared: Replace the background",
      images: ["https://assets.tokenhub.test/source.png?signature=first"],
      resolution: "4k",
      quality: "high",
      output_format: "png",
    });
    expect(requestHttp.mock.calls[1]?.[0].body).toMatchObject({
      prompt: "Prepared: Replace the background",
      images: ["https://assets.tokenhub.test/source.png?signature=second"],
    });
  });

  it("rejects missing, tampered, and wrong-context snapshots before Artifact or HTTP access", async () => {
    const sourceArtifactId = id(20);
    const open = vi.fn();
    const requestHttp = vi.fn();
    const adapter = new GenerationTasksImageEditProviderAdapter({
      request: requestHttp,
    } satisfies ProviderHttpTransport);
    const preparedRequest = preparationRequest({
      operation: "image.edit",
      preset: "newapi",
      input: {
        sourceArtifactId,
        prompt: "Retouch",
      },
      effectiveParameters: {
        quality: "high",
      },
    });
    if (!preparedRequest.executionContext) {
      throw new Error("Test execution context is missing.");
    }
    const missing: AuthorizedProviderInvocationRequest = {
      ...preparedRequest,
      executionContext: preparedRequest.executionContext,
      credential: Buffer.from("provider-test-key"),
      inputArtifacts: {
        open,
      },
    };

    await expect(
      adapter.submit(missing, new AbortController().signal),
    ).rejects.toThrow(/persisted|digest/iu);

    const prepared = adapter.prepare(preparedRequest);
    await expect(
      adapter.submit(
        {
          ...missing,
          preparedRequestSnapshot: prepared.snapshot,
          preparedRequestDigest: digest("0"),
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/differs from its digest/iu);

    const wrongRoute = route("image.edit", "newapi", {
      providerEndpointId: id(40),
    });
    const wrongContextRequest: AuthorizedProviderInvocationRequest = {
      ...missing,
      preparedRequestSnapshot: prepared.snapshot,
      preparedRequestDigest: digestProviderValue(prepared.snapshot),
      executionContext: context(wrongRoute, "newapi"),
    };
    await expect(
      adapter.submit(wrongContextRequest, new AbortController().signal),
    ).rejects.toThrow(/pinned|context|endpoint/iu);
    expect(open).not.toHaveBeenCalled();
    expect(requestHttp).not.toHaveBeenCalled();
  });

  it("rejects Artifact identity drift before Provider HTTP", async () => {
    const sourceArtifactId = id(20);
    const requestHttp = vi.fn();
    const adapter = new GenerationTasksImageEditProviderAdapter({
      request: requestHttp,
    } satisfies ProviderHttpTransport);
    const request = preparationRequest({
      operation: "image.edit",
      preset: "newapi",
      input: {
        sourceArtifactId,
        prompt: "Retouch",
      },
      effectiveParameters: {
        quality: "high",
      },
    });
    const invocation = authorizedRequest(
      adapter,
      request,
      vi
        .fn()
        .mockResolvedValue(
          artifact(
            id(21),
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
          ),
        ),
    );

    await expect(
      adapter.submit(invocation, new AbortController().signal),
    ).rejects.toThrow(/identity differs/iu);
    expect(requestHttp).not.toHaveBeenCalled();
  });

  it("rejects caller effective parameters outside the pinned atomic Adapter contract", () => {
    const adapter = new GenerationTasksImageEditProviderAdapter({
      request: vi.fn(),
    } satisfies ProviderHttpTransport);
    const request = preparationRequest({
      operation: "image.edit",
      preset: "newapi",
      input: {
        sourceArtifactId: id(20),
        prompt: "Retouch",
      },
      effectiveParameters: {
        aspectRatio: "16:9",
      },
    });

    expect(() => adapter.prepare(request)).toThrow(
      /outside the pinned Adapter contract/iu,
    );
  });
});

it("serializes a declared portrait aspect ratio for TokenHub image edits", async () => {
  const calls: ProviderHttpRequest[] = [];
  const adapter = new GenerationTasksImageEditProviderAdapter({
    request: async (request) => {
      calls.push(request);
      return queuedResponse("portrait-edit");
    },
  });
  const request = authorizedRequest(
    adapter,
    preparationRequest({
      operation: "image.edit",
      preset: "tokenhub",
      input: { sourceArtifactId: id(40), prompt: "A portrait poster" },
      effectiveParameters: { aspectRatio: "2:3" },
      route: route("image.edit", "tokenhub", {
        parameterPolicies: {
          ...editParameterPolicies,
          aspectRatio: { callerPolicy: "optional" },
        },
      }),
    }),
    vi.fn().mockResolvedValue(
      artifact(id(40), Buffer.from("image"), {
        createProviderReadUrl: () =>
          Promise.resolve("https://images.test/reference.png"),
      }),
    ),
  );
  await adapter.submit(request, new AbortController().signal);
  expect(calls[0]?.body).toMatchObject({ aspect_ratio: "2:3" });
});

it("sends the source followed by supplementary reference images without losing their order", async () => {
  const calls: ProviderHttpRequest[] = [];
  const adapter = new GenerationTasksImageEditProviderAdapter({
    request: async (request) => {
      calls.push(request);
      return queuedResponse("multi-reference-edit");
    },
  });
  const open = vi.fn(({ inputPointer }: { inputPointer: string }) =>
    Promise.resolve(
      artifact(
        inputPointer === "/sourceArtifactId" ? id(40) : id(41),
        Buffer.from("image"),
        {
          createProviderReadUrl: () =>
            Promise.resolve(
              inputPointer === "/sourceArtifactId"
                ? "https://images.test/ip.png"
                : "https://images.test/board.png",
            ),
        },
      ),
    ),
  );
  const request = authorizedRequest(
    adapter,
    preparationRequest({
      operation: "image.edit",
      preset: "tokenhub",
      input: {
        sourceArtifactId: id(40),
        referenceArtifactIds: [id(41)],
        prompt: "Follow the IP and reference board",
      },
      effectiveParameters: {},
    }),
    open,
  );
  await adapter.submit(request, new AbortController().signal);
  expect(calls[0]?.body).toMatchObject({
    images: ["https://images.test/ip.png", "https://images.test/board.png"],
  });
  expect(open.mock.calls.map(([input]) => input.inputPointer)).toEqual([
    "/sourceArtifactId",
    "/referenceArtifactIds/0",
  ]);
});

it("serializes every advertised TokenHub image parameter value before any paid call", async () => {
  const catalog = tokenHubImageParameters;
  const wireKeys: Record<string, string> = {
    aspectRatio: "aspect_ratio",
    quality: "quality",
    outputFormat: "output_format",
  };
  for (const model of catalog.models) {
    const operation = model.providerModelId.endsWith("-edit")
      ? "image.edit"
      : "image.generate";
    const parameters = model.operations[operation]!.parameters;
    const policies = Object.fromEntries(
      parameters.map((parameter) => [
        parameter.key,
        { callerPolicy: "optional" as const },
      ]),
    );
    for (const parameter of parameters) {
      expect(wireKeys[parameter.key]).toBeDefined();
      if (parameter.valueType !== "enum")
        throw new Error(`Add wire coverage for ${parameter.key}`);
      for (const value of parameter.values) {
        const calls: ProviderHttpRequest[] = [];
        const transport: ProviderHttpTransport = {
          request: async (request) => {
            calls.push(request);
            return queuedResponse("schema-contract-check");
          },
        };
        const adapter =
          operation === "image.edit"
            ? new GenerationTasksImageEditProviderAdapter(transport)
            : new GenerationTasksImageGenerateProviderAdapter(transport);
        const request = authorizedRequest(
          adapter,
          preparationRequest({
            operation,
            preset: "tokenhub",
            input: {
              prompt: "schema check",
              ...(operation === "image.edit"
                ? { sourceArtifactId: id(40) }
                : {}),
            },
            effectiveParameters: { [parameter.key]: value },
            route: route(operation, "tokenhub", {
              parameterPolicies: policies,
            }),
          }),
          vi.fn().mockResolvedValue(
            artifact(id(40), Buffer.from("image"), {
              createProviderReadUrl: () =>
                Promise.resolve("https://images.test/source.png"),
            }),
          ),
        );
        await adapter.submit(request, new AbortController().signal);
        const body = calls[0]?.body as Record<string, unknown>;
        expect(body[wireKeys[parameter.key]!]).toEqual(
          parameter.key === "aspectRatio" && value === "auto"
            ? undefined
            : value,
        );
      }
    }
  }
});

it.each(
  [
    [id(40)],
    [id(41), id(41)],
    Array.from({ length: 14 }, (_, i) => id(50 + i)),
  ].map((references) => ({ references })),
)(
  "rejects duplicate or excessive edit references before HTTP",
  ({ references }) => {
    const adapter = new GenerationTasksImageEditProviderAdapter({
      request: vi.fn(),
    });
    expect(() =>
      adapter.prepare(
        preparationRequest({
          operation: "image.edit",
          preset: "tokenhub",
          input: {
            sourceArtifactId: id(40),
            referenceArtifactIds: references,
            prompt: "validate",
          },
          effectiveParameters: {},
        }),
      ),
    ).toThrow();
  },
);

const tokenHubImageParameters = JSON.parse(
  readFileSync(
    new URL(
      "../../../packages/contracts/test/fixtures/tokenhub-image-parameters.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  models: readonly {
    providerModelId: string;
    operations: Partial<
      Record<
        "image.generate" | "image.edit",
        {
          parameters: readonly {
            key: string;
            valueType: string;
            values: readonly (string | number | boolean)[];
          }[];
        }
      >
    >;
  }[];
};
