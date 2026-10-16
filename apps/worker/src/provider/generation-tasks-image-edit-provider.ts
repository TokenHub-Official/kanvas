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
import type { WorkerInputArtifactAccess } from "../storage/worker-input-artifact-resolver.js";

export const generationTasksImageEditAdapterKey =
  "generation-tasks.image.edit.v1";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const allowedInputKeys = new Set([
  "sourceArtifactId",
  "referenceArtifactIds",
  "prompt",
  "maskArtifactId",
  "aspectRatio",
  "resolution",
  "size",
  "quality",
  "outputFormat",
  "background",
  "outputCompression",
  "seed",
]);
const supportedParameterKeys = new Set([
  "aspectRatio",
  "resolution",
  "quality",
  "outputFormat",
  "outputCompression",
  "seed",
]);

interface ImageEditInput {
  readonly sourceArtifactId: string;
  readonly referenceArtifactIds: readonly string[];
  readonly prompt: string;
}

function contract(message: string): never {
  throw new ProviderAdapterContractError(message);
}

function authorized(
  request: ProviderInvocationRequest,
): asserts request is AuthorizedProviderInvocationRequest & {
  readonly inputArtifacts: WorkerInputArtifactAccess;
} {
  const candidate = request as Partial<AuthorizedProviderInvocationRequest>;
  if (
    !candidate.executionContext ||
    !candidate.inputArtifacts ||
    !(candidate.credential instanceof Uint8Array)
  ) {
    return contract(
      "Image edit requires an authorized invocation and Artifact access.",
    );
  }
}

function parseInput(value: unknown): ImageEditInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return contract("Image edit input must be an object.");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    typeof input.sourceArtifactId !== "string" ||
    !artifactIdPattern.test(input.sourceArtifactId) ||
    typeof input.prompt !== "string" ||
    input.prompt.trim().length < 1 ||
    input.prompt.length > 8_000 ||
    (input.referenceArtifactIds !== undefined &&
      (!Array.isArray(input.referenceArtifactIds) ||
        input.referenceArtifactIds.length < 1 ||
        input.referenceArtifactIds.length > 13 ||
        input.referenceArtifactIds.some(
          (value) =>
            typeof value !== "string" || !artifactIdPattern.test(value),
        ) ||
        new Set([
          input.sourceArtifactId,
          ...(input.referenceArtifactIds as readonly unknown[]),
        ]).size !==
          input.referenceArtifactIds.length + 1)) ||
    input.maskArtifactId !== undefined ||
    Object.keys(input).some((key) => !allowedInputKeys.has(key))
  ) {
    return contract(
      "Image edit input does not match kanvas.image-edit-input/v1.",
    );
  }
  return Object.freeze({
    sourceArtifactId: input.sourceArtifactId,
    referenceArtifactIds: Object.freeze(
      Array.isArray(input.referenceArtifactIds)
        ? input.referenceArtifactIds.map(String)
        : [],
    ),
    prompt: input.prompt.trim(),
  });
}

function commandFor(
  request: ProviderInvocationRequest | ProviderRequestPreparationRequest,
) {
  assertGenerationTasksEffectiveParameters(
    request,
    "image.edit",
    supportedParameterKeys,
  );
  const input = parseInput(request.input);
  const aspectRatio = effectiveProviderParameter(request, "aspectRatio", [
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
  ] as const);
  const resolution = effectiveProviderParameter(request, "resolution", [
    "1k",
    "2k",
    "4k",
  ] as const);
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
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(resolution ? { resolution } : {}),
      ...(quality ? { quality } : {}),
      ...(outputFormat ? { outputFormat } : {}),
      ...(outputCompression === undefined ? {} : { outputCompression }),
      ...(seed === undefined ? {} : { seed }),
    }),
  });
}

function outputReference() {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1" as const,
    outputRole: "edited",
    outputIndex: 0,
  });
}

function mapObservation(
  observation: ProviderObservation,
  input: ImageEditInput,
): ProviderObservation {
  if (observation.status !== "succeeded") {
    return observation;
  }
  if (observation.outputs?.length !== 1) {
    return contract("Image edit Provider output is incomplete.");
  }
  return Object.freeze({
    ...observation,
    output: Object.freeze({
      schemaVersion: "kanvas.image-edit-result/v1",
      imageArtifactId: outputReference(),
      sourceArtifactId: input.sourceArtifactId,
    }),
  });
}

export class GenerationTasksImageEditProviderAdapter implements AsyncProviderAdapter {
  readonly adapterKey = generationTasksImageEditAdapterKey;
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
      operation: "image.edit",
      command,
      inputArtifacts: Object.freeze([
        Object.freeze({
          role: "source",
          artifactId: input.sourceArtifactId,
          inputPointer: "/sourceArtifactId",
        }),
        ...input.referenceArtifactIds.map((artifactId, index) =>
          Object.freeze({
            role: "reference" as const,
            artifactId,
            inputPointer: `/referenceArtifactIds/${String(index)}`,
          }),
        ),
      ]),
      result: Object.freeze({
        outputRole: "edited",
        artifactType: "image.edited",
        sourceArtifactId: input.sourceArtifactId,
      }),
    });
  }

  public async submit(
    request: ProviderInvocationRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    const snapshot = consumeGenerationTasksImageRequest(request, {
      adapterKey: this.adapterKey,
      operation: "image.edit",
    });
    authorized(request);
    const materialized = await materializeGenerationTasksInputArtifacts(
      request,
      snapshot,
      signal,
    );
    try {
      if (materialized.references.length !== snapshot.inputArtifacts.length) {
        return contract(
          "Generation Tasks image.edit did not materialize its source Artifact.",
        );
      }
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
    const input = parseInput(request.input);
    return mapObservation(
      await this.#protocol.query(
        request,
        {
          outputRole: "edited",
          artifactType: "image.edited",
          metadata: Object.freeze({
            operation: "image.edit",
            sourceArtifactId: input.sourceArtifactId,
            generative: true,
          }),
        },
        signal,
      ),
      input,
    );
  }
}
