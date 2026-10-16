import {
  ProviderAdapterContractError,
  type AsyncProviderAdapter,
  type AuthorizedProviderInvocationRequest,
  type PreparedProviderRequest,
  type ProviderInvocationRequest,
  type ProviderObservation,
  type ProviderRequestPreparationRequest,
} from "./provider-adapter.js";
import {
  openAiImageEditFailureRetryability,
  prepareOpenAiImageEditRequest,
  readPreparedOpenAiImageEditRequest,
  submitPreparedOpenAiImageEdit,
} from "./openai-image-provider.js";
import type { ProviderHttpTransport } from "./provider-http-transport.js";
import { configuredPrompt } from "./image-implementation-configuration.js";
import {
  assertDerivedImageEditParameters,
  derivedImageEditEnumParameter,
  derivedImageEditIntegerParameter,
  derivedImageEditParameterKeys,
  derivedImageEditRouteRequiresPinnedOperation,
} from "./derived-image-edit-parameters.js";

export const openAiReconstructiveUpscaleAdapterKey =
  "openai.image.upscale.reconstructive.v1";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const openAiUpscaleParameterKeys = new Set([
  "size",
  "quality",
  "outputFormat",
  "background",
  "outputCompression",
]);

export interface ReconstructiveUpscaleInput {
  readonly sourceArtifactId: string;
  readonly qualityIntent: "reconstructive";
  readonly scaleFactor: 2;
  readonly guidance?: string;
}

function contract(message: string): never {
  throw new ProviderAdapterContractError(message);
}

export function parseReconstructiveUpscaleInput(
  value: unknown,
): ReconstructiveUpscaleInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return contract("Reconstructive upscale input must be an object.");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const sourceArtifactId = record.sourceArtifactId;
  const qualityIntent = record.qualityIntent;
  const scaleFactor = record.scaleFactor ?? 2;
  const guidance = record.guidance;
  if (
    typeof sourceArtifactId !== "string" ||
    !artifactIdPattern.test(sourceArtifactId) ||
    qualityIntent !== "reconstructive" ||
    scaleFactor !== 2 ||
    (guidance !== undefined &&
      (typeof guidance !== "string" ||
        guidance.trim().length < 1 ||
        guidance.length > 1_000)) ||
    Object.keys(record).some(
      (key) =>
        key !== "sourceArtifactId" &&
        key !== "qualityIntent" &&
        key !== "scaleFactor" &&
        key !== "guidance" &&
        !derivedImageEditParameterKeys.includes(
          key as (typeof derivedImageEditParameterKeys)[number],
        ),
    )
  ) {
    return contract(
      "Reconstructive upscale input does not match kanvas.image-upscale-input/v1.",
    );
  }
  return Object.freeze({
    sourceArtifactId,
    qualityIntent,
    scaleFactor: 2,
    ...(typeof guidance === "string" ? { guidance: guidance.trim() } : {}),
  });
}

function authorized(
  request: ProviderInvocationRequest,
): asserts request is AuthorizedProviderInvocationRequest {
  const candidate = request as Partial<AuthorizedProviderInvocationRequest>;
  if (
    !candidate.executionContext ||
    !(candidate.credential instanceof Uint8Array) ||
    !candidate.inputArtifacts
  ) {
    contract(
      "Reconstructive upscale requires an authorized Provider invocation.",
    );
  }
}

export function reconstructiveUpscalePrompt(
  request: ProviderInvocationRequest,
  input: ReconstructiveUpscaleInput,
): string {
  return configuredPrompt(request, {
    guidance: input.guidance ?? "",
    guidanceBlock: input.guidance
      ? `\nAdditional art direction: ${input.guidance}`
      : "",
    scaleFactor: String(input.scaleFactor),
  });
}

function outputReference() {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1" as const,
    outputRole: "upscaled",
    outputIndex: 0,
  });
}

export function mapReconstructiveUpscaleObservation(
  observation: ProviderObservation,
  input: ReconstructiveUpscaleInput,
): ProviderObservation {
  if (observation.status !== "succeeded") {
    return observation;
  }
  if (observation.outputs?.length !== 1) {
    return contract("Reconstructive upscale Provider output is incomplete.");
  }
  const providerOutput = observation.outputs[0]!;
  return Object.freeze({
    ...observation,
    output: Object.freeze({
      schemaVersion: "kanvas.image-upscale-result/v1",
      imageArtifactId: outputReference(),
      qualityIntent: "reconstructive",
      scaleFactor: 2,
      sourceWidth: null,
      sourceHeight: null,
      outputWidth: null,
      outputHeight: null,
      qualitySignals: Object.freeze({
        schemaVersion: "kanvas.image-upscale-quality/v1",
        method: "generative_reconstruction",
        generative: true,
        resamplingKernel: null,
      }),
    }),
    outputs: Object.freeze([
      Object.freeze({
        ...providerOutput,
        outputRole: "upscaled",
        artifactType: "image.upscaled",
        metadata: Object.freeze({
          ...providerOutput.metadata,
          operation: "image.upscale",
          sourceArtifactId: input.sourceArtifactId,
          qualityIntent: "reconstructive",
          scaleFactor: 2,
          generative: true,
        }),
      }),
    ]),
  });
}

export class OpenAiReconstructiveUpscaleProviderAdapter implements AsyncProviderAdapter {
  readonly adapterKey = openAiReconstructiveUpscaleAdapterKey;
  readonly queryMode = "none" as const;
  readonly notFoundIsAuthoritative = false;
  readonly credentialMode = "provider-secret" as const;
  readonly failureRetryability = openAiImageEditFailureRetryability;

  public constructor(readonly transport: ProviderHttpTransport) {}

  public prepare(
    request: ProviderRequestPreparationRequest,
  ): PreparedProviderRequest {
    const input = parseReconstructiveUpscaleInput(request.input);
    const requireImageEditOperation = assertDerivedImageEditParameters(
      request,
      openAiUpscaleParameterKeys,
    );
    return prepareOpenAiImageEditRequest(request, {
      adapterKey: this.adapterKey,
      command: {
        sourceArtifactId: input.sourceArtifactId,
        sourceInputPointer: "/sourceArtifactId",
        prompt: reconstructiveUpscalePrompt(request, input),
        size: derivedImageEditEnumParameter(
          request,
          "size",
          ["auto", "1024x1024", "1536x1024", "1024x1536"],
          "auto",
        ),
        quality: derivedImageEditEnumParameter(
          request,
          "quality",
          ["auto", "low", "medium", "high"],
          "high",
        ),
        outputFormat: derivedImageEditEnumParameter(
          request,
          "outputFormat",
          ["png", "jpeg", "webp"],
          "png",
        ),
        ...(() => {
          const outputCompression = derivedImageEditIntegerParameter(
            request,
            "outputCompression",
            0,
            100,
          );
          return outputCompression === undefined ? {} : { outputCompression };
        })(),
        background: derivedImageEditEnumParameter(
          request,
          "background",
          ["auto", "opaque", "transparent"],
          "auto",
        ),
        outputArtifactType: "image.upscaled",
        outputRole: "upscaled",
        adapterState: Object.freeze({
          ...input,
        }),
      },
      requireImageEditOperation,
    });
  }

  public async submit(
    request: ProviderInvocationRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    authorized(request);
    const prepared = readPreparedOpenAiImageEditRequest(request, {
      adapterKey: this.adapterKey,
      requireImageEditOperation:
        derivedImageEditRouteRequiresPinnedOperation(request),
    });
    const input = parseReconstructiveUpscaleInput(prepared.adapterState);
    const { observation } = await submitPreparedOpenAiImageEdit(
      request,
      signal,
      {
        adapterKey: this.adapterKey,
        requireImageEditOperation:
          derivedImageEditRouteRequiresPinnedOperation(request),
        transport: this.transport,
      },
    );
    return mapReconstructiveUpscaleObservation(observation, input);
  }

  public query(): Promise<ProviderObservation> {
    return Promise.reject(
      new ProviderAdapterContractError(
        "OpenAI image upscale does not expose a status query.",
      ),
    );
  }
}
