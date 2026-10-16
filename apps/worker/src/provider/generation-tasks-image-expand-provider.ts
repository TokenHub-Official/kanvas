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
  canvasExpandPrompt,
  mapCanvasExpandObservation,
  parseCanvasExpandInput,
  prepareCanvasExpand,
} from "./image-canvas-expand-core.js";
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

export const generationTasksCanvasExpandAdapterKey =
  "generation-tasks.image.canvas-expand.v1";
const supportedParameterKeys = new Set([
  "resolution",
  "quality",
  "outputFormat",
]);

function outputDescriptor(sourceArtifactId: string) {
  return Object.freeze({
    outputRole: "expanded",
    artifactType: "image.expanded",
    metadata: Object.freeze({
      operation: "image.canvas.expand",
      sourceArtifactId,
      generative: true,
      protocol: "generation.tasks.v1",
    }),
  });
}

export class GenerationTasksCanvasExpandProviderAdapter implements AsyncProviderAdapter {
  readonly adapterKey = generationTasksCanvasExpandAdapterKey;
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
    const input = parseCanvasExpandInput(request.input);
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
        prompt: canvasExpandPrompt(request, input),
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
        outputRole: "expanded",
        artifactType: "image.expanded",
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
      "Generation Tasks canvas expand",
    );
    const snapshot = consumeGenerationTasksImageRequest(request, {
      adapterKey: this.adapterKey,
      operation: "image.edit",
    });
    const input = parseCanvasExpandInput(snapshot.adapterState);
    const replayRequest: AuthorizedProviderInvocationRequest = {
      ...request,
      input: snapshot.adapterState,
      inputArtifacts: pinnedDerivedImageEditArtifactAccess(request, {
        "/sourceArtifactId": input.sourceArtifactId,
      }),
    };
    const prepared = await prepareCanvasExpand(replayRequest, input, signal);
    try {
      return await this.#protocol.submit(
        request,
        {
          ...generationTasksCommandFromSnapshot(snapshot, Object.freeze([])),
          image: `data:image/png;base64,${prepared.preparedCanvas.toString(
            "base64",
          )}`,
          size: `${String(input.targetWidth)}x${String(input.targetHeight)}`,
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
    const input = parseCanvasExpandInput(snapshot.adapterState);
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
      "Generation Tasks canvas expand",
    );
    const replayRequest: AuthorizedProviderInvocationRequest = {
      ...request,
      input: snapshot.adapterState,
      inputArtifacts: pinnedDerivedImageEditArtifactAccess(request, {
        "/sourceArtifactId": input.sourceArtifactId,
      }),
    };
    const prepared = await prepareCanvasExpand(replayRequest, input, signal);
    try {
      return await mapCanvasExpandObservation(
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
