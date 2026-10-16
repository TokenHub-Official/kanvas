import {
  type AsyncProviderAdapter,
  type AuthorizedProviderInvocationRequest,
  type PreparedProviderRequest,
  type ProviderInvocationRequest,
  type ProviderObservation,
  type ProviderQueryRequest,
  ProviderAdapterContractError,
  type ProviderRequestPreparationRequest,
} from "./provider-adapter.js";
import {
  GenerationTasksImageProtocol,
  generationTasksFailureRetryability,
} from "./generation-tasks-image-protocol.js";
import {
  assertGenerationTasksEffectiveParameters,
  consumeGenerationTasksImageRequest,
  generationTasksCommandFromSnapshot,
  materializeGenerationTasksInputArtifacts,
  prepareGenerationTasksImageRequest,
} from "./generation-tasks-image-request-snapshot.js";
import {
  configuredPrompt,
  effectiveIntegerProviderParameter,
  effectiveProviderParameter,
} from "./image-implementation-configuration.js";
import type { ProviderHttpTransport } from "./provider-http-transport.js";

export const generationTasksImageGenerateAdapterKey =
  "generation-tasks.image.generate.v1";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const aspectRatios = [
  "auto",
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "4:5",
  "5:4",
  "16:9",
  "9:16",
  "21:9",
] as const;
const allowedInputKeys = new Set([
  "prompt",
  "referenceArtifactIds",
  "aspectRatio",
  "resolution",
  "size",
  "quality",
  "outputFormat",
  "background",
  "outputCompression",
  "numberOfImages",
  "seed",
]);
const supportedParameterKeys = new Set([
  "aspectRatio",
  "resolution",
  "size",
  "quality",
  "outputFormat",
  "outputCompression",
  "numberOfImages",
  "seed",
]);

interface ImageGenerateInput {
  readonly prompt: string;
  readonly referenceArtifactIds: readonly string[];
}

function contract(message: string): never {
  throw new ProviderAdapterContractError(message);
}

function parseInput(value: unknown): ImageGenerateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return contract("Image generate input must be an object.");
  }
  const input = value as Readonly<Record<string, unknown>>;
  const referenceArtifactIds = input.referenceArtifactIds;
  if (
    typeof input.prompt !== "string" ||
    input.prompt.trim().length < 1 ||
    input.prompt.length > 8_000 ||
    (referenceArtifactIds !== undefined &&
      (!Array.isArray(referenceArtifactIds) ||
        referenceArtifactIds.length < 1 ||
        referenceArtifactIds.length > 14 ||
        referenceArtifactIds.some(
          (candidate) =>
            typeof candidate !== "string" || !artifactIdPattern.test(candidate),
        ) ||
        new Set(referenceArtifactIds).size !== referenceArtifactIds.length)) ||
    Object.keys(input).some((key) => !allowedInputKeys.has(key))
  ) {
    return contract(
      "Image generate input does not match kanvas.image-generate-input/v1.",
    );
  }
  return Object.freeze({
    prompt: input.prompt.trim(),
    referenceArtifactIds: Object.freeze(
      Array.isArray(referenceArtifactIds)
        ? referenceArtifactIds.map((candidate) => String(candidate))
        : [],
    ),
  });
}

function authorized(
  request: ProviderInvocationRequest,
): asserts request is AuthorizedProviderInvocationRequest {
  const candidate = request as Partial<AuthorizedProviderInvocationRequest>;
  if (
    !candidate.executionContext ||
    !(candidate.credential instanceof Uint8Array) ||
    candidate.credential.byteLength < 1
  ) {
    return contract(
      "Generation Tasks image generate requires pinned execution context and callback-scoped credential.",
    );
  }
}

function commandFor(
  request: ProviderInvocationRequest | ProviderRequestPreparationRequest,
) {
  assertGenerationTasksEffectiveParameters(
    request,
    "image.generate",
    supportedParameterKeys,
  );
  const input = parseInput(request.input);
  const aspectRatio = effectiveProviderParameter(
    request,
    "aspectRatio",
    aspectRatios,
  );
  const resolution = effectiveProviderParameter(request, "resolution", [
    "1k",
    "2k",
    "4k",
  ] as const);
  const size =
    request.route.providerProtocolVersion === 1 &&
    request.route.parameterPolicies
      ? effectiveProviderParameter(request, "size", [
          "auto",
          "1024x1024",
          "1536x1024",
          "1024x1536",
        ] as const)
      : undefined;
  const quality = effectiveProviderParameter(request, "quality", [
    "auto",
    "low",
    "medium",
    "high",
  ] as const);
  const outputFormat = effectiveProviderParameter(request, "outputFormat", [
    "png",
    "jpeg",
    "webp",
  ] as const);
  const outputCompression = effectiveIntegerProviderParameter(
    request,
    "outputCompression",
    0,
    100,
  );
  const numberOfImages = effectiveIntegerProviderParameter(
    request,
    "numberOfImages",
    1,
    4,
  );
  const seed = effectiveIntegerProviderParameter(
    request,
    "seed",
    0,
    4_294_967_295,
  );
  return Object.freeze({
    input,
    command: Object.freeze({
      prompt: configuredPrompt(request, {
        prompt: input.prompt,
      }),
      ...(aspectRatio === "auto" || aspectRatio === undefined
        ? {}
        : { aspectRatio }),
      ...(resolution ? { resolution } : {}),
      ...(size && size !== "auto" ? { size } : {}),
      ...(quality ? { quality } : {}),
      ...(outputFormat ? { outputFormat } : {}),
      ...(outputCompression === undefined ? {} : { outputCompression }),
      ...(numberOfImages === undefined ? {} : { numberOfImages }),
      ...(seed === undefined ? {} : { seed }),
    }),
  });
}

function outputReference() {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1" as const,
    outputRole: "generated",
    outputIndex: 0,
  });
}

function mapObservation(observation: ProviderObservation): ProviderObservation {
  if (observation.status !== "succeeded") {
    return observation;
  }
  if (!observation.outputs || observation.outputs.length < 1) {
    return contract("Image generate Provider output is incomplete.");
  }
  return Object.freeze({
    ...observation,
    output: Object.freeze({
      schemaVersion: "kanvas.image-generate-result/v1",
      imageArtifactId: outputReference(),
    }),
  });
}

export class GenerationTasksImageGenerateProviderAdapter implements AsyncProviderAdapter {
  readonly adapterKey = generationTasksImageGenerateAdapterKey;
  readonly queryMode = "provider_request_id" as const;
  readonly notFoundIsAuthoritative = false;
  readonly credentialMode = "provider-secret" as const;
  readonly failureRetryability = generationTasksFailureRetryability;
  readonly #protocol: GenerationTasksImageProtocol;

  public constructor(transport: ProviderHttpTransport) {
    this.#protocol = new GenerationTasksImageProtocol(transport);
  }

  public prepare(
    request: ProviderRequestPreparationRequest,
  ): PreparedProviderRequest {
    const { input, command } = commandFor(request);
    return prepareGenerationTasksImageRequest(request, {
      adapterKey: this.adapterKey,
      operation: "image.generate",
      command,
      inputArtifacts: input.referenceArtifactIds.map((artifactId, index) =>
        Object.freeze({
          role: "reference" as const,
          artifactId,
          inputPointer: `/referenceArtifactIds/${String(index)}`,
        }),
      ),
      result: Object.freeze({
        outputRole: "generated",
        artifactType: "image.generated",
      }),
    });
  }

  public async submit(
    request: ProviderInvocationRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    const snapshot = consumeGenerationTasksImageRequest(request, {
      adapterKey: this.adapterKey,
      operation: "image.generate",
    });
    authorized(request);
    const materialized = await materializeGenerationTasksInputArtifacts(
      request,
      snapshot,
      signal,
    );
    try {
      return await this.#protocol.submit(
        request,
        generationTasksCommandFromSnapshot(snapshot, materialized.references),
        signal,
      );
    } finally {
      materialized.dispose();
    }
  }

  public async query(
    request: ProviderQueryRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    return mapObservation(
      await this.#protocol.query(
        request,
        {
          outputRole: "generated",
          artifactType: "image.generated",
          metadata: Object.freeze({
            operation: "image.generate",
            generative: true,
          }),
        },
        signal,
      ),
    );
  }
}
