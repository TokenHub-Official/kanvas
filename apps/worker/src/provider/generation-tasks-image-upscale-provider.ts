import sharp from "sharp";

import {
  type AsyncProviderAdapter,
  type PreparedProviderRequest,
  type ProviderInvocationRequest,
  type ProviderObservation,
  type ProviderQueryRequest,
  type ProviderRequestPreparationRequest,
  ProviderAdapterContractError,
} from "./provider-adapter.js";
import {
  GenerationTasksImageProtocol,
  generationTasksFailureRetryability,
} from "./generation-tasks-image-protocol.js";
import {
  mapReconstructiveUpscaleObservation,
  parseReconstructiveUpscaleInput,
  reconstructiveUpscalePrompt,
} from "./openai-image-upscale-provider.js";
import type { ProviderHttpTransport } from "./provider-http-transport.js";
import {
  consumeGenerationTasksImageRequest,
  generationTasksCommandFromSnapshot,
  prepareGenerationTasksImageRequest,
} from "./generation-tasks-image-request-snapshot.js";
import {
  assertDerivedImageEditParameters,
  authorizedDerivedImageEditRequest,
  optionalDerivedImageEditEnumParameter,
  pinnedDerivedImageEditArtifactAccess,
} from "./derived-image-edit-parameters.js";
import type { WorkerInputArtifactRead } from "../storage/worker-input-artifact-resolver.js";

export const generationTasksReconstructiveUpscaleAdapterKey =
  "generation-tasks.image.upscale.reconstructive.v1";

const maximumSourceBytes = 37_748_736;
const providerReadUrlLifetimeSeconds = 900;
const supportedParameterKeys = new Set([
  "resolution",
  "quality",
  "outputFormat",
]);

function contract(message: string): never {
  throw new ProviderAdapterContractError(message);
}

async function readBounded(
  artifact: WorkerInputArtifactRead,
  signal: AbortSignal,
): Promise<Buffer> {
  if (!/^[1-9][0-9]{0,19}$/u.test(artifact.byteSize)) {
    return contract("Generation Tasks source Artifact byte size is invalid.");
  }
  const expectedBytes = BigInt(artifact.byteSize);
  if (expectedBytes > BigInt(maximumSourceBytes)) {
    return contract(
      "Generation Tasks source Artifact exceeds the base64 request limit.",
    );
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of artifact.body) {
    signal.throwIfAborted();
    total += chunk.byteLength;
    if (total > maximumSourceBytes) {
      for (const buffered of chunks) {
        buffered.fill(0);
      }
      return contract(
        "Generation Tasks source Artifact exceeded its bounded read limit.",
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  if (BigInt(total) !== expectedBytes) {
    for (const buffered of chunks) {
      buffered.fill(0);
    }
    return contract(
      "Generation Tasks source Artifact body length differs from its immutable metadata.",
    );
  }
  const result = Buffer.concat(chunks, total);
  for (const buffered of chunks) {
    buffered.fill(0);
  }
  return result;
}

function sourceMediaType(
  artifact: WorkerInputArtifactRead,
): "image/png" | "image/jpeg" | "image/webp" {
  if (
    artifact.mediaType === "image/png" ||
    artifact.mediaType === "image/jpeg" ||
    artifact.mediaType === "image/webp"
  ) {
    return artifact.mediaType;
  }
  return contract(
    "Generation Tasks source Artifact has an unsupported image media type.",
  );
}

function providerHttpsReference(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return contract(
      "TokenHub source Artifact reference is not an absolute URL.",
    );
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return contract(
      "TokenHub source Artifact reference must use HTTPS without embedded credentials.",
    );
  }
  return parsed.toString();
}

const supportedAspectRatios: readonly (readonly [string, number, number])[] =
  Object.freeze([
    ["1:1", 1, 1],
    ["3:2", 3, 2],
    ["2:3", 2, 3],
    ["4:3", 4, 3],
    ["3:4", 3, 4],
    ["4:5", 4, 5],
    ["5:4", 5, 4],
    ["16:9", 16, 9],
    ["9:16", 9, 16],
    ["21:9", 21, 9],
  ]);

function sourceAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  let nearest = supportedAspectRatios[0];
  if (!nearest) {
    return "1:1";
  }
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of supportedAspectRatios) {
    const candidateRatio = candidate[1] / candidate[2];
    const distance = Math.abs(Math.log(ratio / candidateRatio));
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest[0];
}

function outputDescriptor(sourceArtifactId: string) {
  return Object.freeze({
    outputRole: "upscaled",
    artifactType: "image.upscaled",
    metadata: Object.freeze({
      operation: "image.upscale",
      sourceArtifactId,
      qualityIntent: "reconstructive",
      scaleFactor: 2,
      generative: true,
    }),
  });
}

export class GenerationTasksReconstructiveUpscaleProviderAdapter implements AsyncProviderAdapter {
  readonly adapterKey = generationTasksReconstructiveUpscaleAdapterKey;
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
    const input = parseReconstructiveUpscaleInput(request.input);
    assertDerivedImageEditParameters(request, supportedParameterKeys);
    const resolution = optionalDerivedImageEditEnumParameter(
      request,
      "resolution",
      ["1k", "2k", "4k"],
    );
    const quality = optionalDerivedImageEditEnumParameter(request, "quality", [
      "auto",
      "low",
      "medium",
      "high",
    ]);
    const outputFormat = optionalDerivedImageEditEnumParameter(
      request,
      "outputFormat",
      ["png", "jpeg", "webp"],
    );
    return prepareGenerationTasksImageRequest(request, {
      adapterKey: this.adapterKey,
      operation: "image.edit",
      command: Object.freeze({
        prompt: reconstructiveUpscalePrompt(request, input),
        ...(resolution ? { resolution } : {}),
        ...(quality ? { quality } : {}),
        ...(outputFormat ? { outputFormat } : {}),
      }),
      adapterState: Object.freeze({ ...input }),
      inputArtifacts: Object.freeze([
        Object.freeze({
          role: "source",
          artifactId: input.sourceArtifactId,
          inputPointer: "/sourceArtifactId",
        }),
      ]),
      result: Object.freeze({
        outputRole: "upscaled",
        artifactType: "image.upscaled",
        sourceArtifactId: input.sourceArtifactId,
      }),
    });
  }

  public async submit(
    request: ProviderInvocationRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    authorizedDerivedImageEditRequest(
      request,
      "Generation Tasks reconstructive upscale",
    );
    const snapshot = consumeGenerationTasksImageRequest(request, {
      adapterKey: this.adapterKey,
      operation: "image.edit",
    });
    const input = parseReconstructiveUpscaleInput(snapshot.adapterState);
    const inputArtifacts = pinnedDerivedImageEditArtifactAccess(request, {
      "/sourceArtifactId": input.sourceArtifactId,
    });
    const source = await inputArtifacts.open({
      inputPointer: "/sourceArtifactId",
    });
    const sourceBytes = await readBounded(source, signal);
    try {
      const metadata = await sharp(sourceBytes).metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width > 2_048 ||
        metadata.height > 2_048
      ) {
        return contract(
          "Generation Tasks reconstructive upscale source dimensions are invalid or exceed the 2x output bound.",
        );
      }
      const mediaType = sourceMediaType(source);
      const sourceReference =
        request.executionContext.endpoint.presetKind === "tokenhub"
          ? await source.createProviderReadUrl?.(providerReadUrlLifetimeSeconds)
          : undefined;
      if (
        request.executionContext.endpoint.presetKind === "tokenhub" &&
        !sourceReference
      ) {
        return contract(
          "TokenHub Generation Tasks requires a short-lived HTTPS source Artifact URL.",
        );
      }
      return await this.#protocol.submit(
        request,
        {
          ...generationTasksCommandFromSnapshot(snapshot, Object.freeze([])),
          images: Object.freeze([
            (sourceReference
              ? providerHttpsReference(sourceReference)
              : undefined) ??
              `data:${mediaType};base64,${sourceBytes.toString("base64")}`,
          ]),
          aspectRatio: sourceAspectRatio(metadata.width, metadata.height),
          resolution: (() => {
            const configured = snapshot.body.resolution;
            if (
              configured === "1k" ||
              configured === "2k" ||
              configured === "4k"
            ) {
              return configured;
            }
            return metadata.width > 1_024 || metadata.height > 1_024
              ? "4k"
              : "2k";
          })(),
        },
        signal,
      );
    } finally {
      sourceBytes.fill(0);
    }
  }

  public async query(
    request: ProviderQueryRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    const snapshot = consumeGenerationTasksImageRequest(request, {
      adapterKey: this.adapterKey,
      operation: "image.edit",
    });
    const input = parseReconstructiveUpscaleInput(snapshot.adapterState);
    const observation = await this.#protocol.query(
      request,
      outputDescriptor(input.sourceArtifactId),
      signal,
    );
    return mapReconstructiveUpscaleObservation(observation, input);
  }
}
