import type {
  AsyncProviderAdapter,
  AuthorizedProviderInvocationRequest,
  PreparedProviderRequest,
  ProviderInvocationRequest,
  ProviderObservation,
  ProviderQueryRequest,
  ProviderRequestPreparationRequest,
} from "./provider-adapter.js";
import {
  GenerationTasksImageProtocol,
  generationTasksFailureRetryability,
} from "./generation-tasks-image-protocol.js";
import {
  mapObjectRemoveObservation,
  objectRemovePrompt,
  parseObjectRemoveInput,
  prepareObjectRemove,
} from "./image-object-remove-core.js";
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

export const generationTasksObjectRemoveAdapterKey =
  "generation-tasks.image.object-remove.v1";
const supportedParameterKeys = new Set([
  "resolution",
  "quality",
  "outputFormat",
]);

function outputDescriptor(sourceArtifactId: string) {
  return Object.freeze({
    outputRole: "repaired",
    artifactType: "image.object-removed",
    metadata: Object.freeze({
      operation: "image.object.remove",
      sourceArtifactId,
      generative: true,
      protocol: "generation.tasks.v1",
    }),
  });
}

export class GenerationTasksObjectRemoveProviderAdapter implements AsyncProviderAdapter {
  readonly adapterKey = generationTasksObjectRemoveAdapterKey;
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
    const input = parseObjectRemoveInput(request.input);
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
        prompt: objectRemovePrompt(request, input),
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
        outputRole: "repaired",
        artifactType: "image.object-removed",
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
      "Generation Tasks object remove",
    );
    const snapshot = consumeGenerationTasksImageRequest(request, {
      adapterKey: this.adapterKey,
      operation: "image.edit",
    });
    const input = parseObjectRemoveInput(snapshot.adapterState);
    const replayRequest: AuthorizedProviderInvocationRequest = {
      ...request,
      input: snapshot.adapterState,
      inputArtifacts: pinnedDerivedImageEditArtifactAccess(request, {
        "/sourceArtifactId": input.sourceArtifactId,
        ...(input.maskArtifactId
          ? {
              "/maskArtifactId": input.maskArtifactId,
            }
          : {}),
      }),
    };
    const prepared = await prepareObjectRemove(replayRequest, input, signal);
    try {
      return await this.#protocol.submit(
        request,
        {
          ...generationTasksCommandFromSnapshot(snapshot, Object.freeze([])),
          images: Object.freeze([
            `data:image/png;base64,${prepared.normalizedSource.toString(
              "base64",
            )}`,
            `data:image/png;base64,${prepared.canonicalRemovedMask.toString(
              "base64",
            )}`,
          ]),
        },
        signal,
      );
    } finally {
      prepared.dispose();
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
    const input = parseObjectRemoveInput(snapshot.adapterState);
    const observation = await this.#protocol.query(
      request,
      outputDescriptor(input.sourceArtifactId),
      signal,
    );
    if (observation.status !== "succeeded") {
      return observation;
    }
    authorizedDerivedImageEditRequest(
      request,
      "Generation Tasks object remove",
    );
    const replayRequest: AuthorizedProviderInvocationRequest = {
      ...request,
      input: snapshot.adapterState,
      inputArtifacts: pinnedDerivedImageEditArtifactAccess(request, {
        "/sourceArtifactId": input.sourceArtifactId,
        ...(input.maskArtifactId
          ? {
              "/maskArtifactId": input.maskArtifactId,
            }
          : {}),
      }),
    };
    const prepared = await prepareObjectRemove(replayRequest, input, signal);
    try {
      return await mapObjectRemoveObservation(
        observation,
        input,
        prepared,
        signal,
      );
    } finally {
      prepared.dispose();
    }
  }
}
