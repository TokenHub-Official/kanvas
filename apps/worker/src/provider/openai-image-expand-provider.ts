import type {
  AsyncProviderAdapter,
  AuthorizedProviderInvocationRequest,
  PreparedProviderRequest,
  ProviderInvocationRequest,
  ProviderObservation,
  ProviderRequestPreparationRequest,
} from "./provider-adapter.js";
import {
  canvasExpandArtifactAccess,
  canvasExpandPrompt,
  mapCanvasExpandObservation,
  parseCanvasExpandInput,
  prepareCanvasExpand,
} from "./image-canvas-expand-core.js";
import {
  openAiImageEditFailureRetryability,
  prepareOpenAiImageEditRequest,
  readPreparedOpenAiImageEditRequest,
  submitPreparedOpenAiImageEdit,
} from "./openai-image-provider.js";
import type { ProviderHttpTransport } from "./provider-http-transport.js";
import {
  assertDerivedImageEditParameters,
  authorizedDerivedImageEditRequest,
  derivedImageEditEnumParameter,
  derivedImageEditIntegerParameter,
  derivedImageEditRouteRequiresPinnedOperation,
  pinnedDerivedImageEditArtifactAccess,
} from "./derived-image-edit-parameters.js";
import { ProviderAdapterContractError } from "./provider-adapter.js";

/** OpenAI-native transport binding for the shared canvas-expand core. */
export const openAiCanvasExpandAdapterKey = "openai.image.canvas-expand.v1";

const openAiCanvasExpandParameterKeys = new Set([
  "size",
  "quality",
  "outputFormat",
  "background",
  "outputCompression",
]);

export class OpenAiCanvasExpandProviderAdapter implements AsyncProviderAdapter {
  readonly adapterKey = openAiCanvasExpandAdapterKey;
  readonly queryMode = "none" as const;
  readonly notFoundIsAuthoritative = false;
  readonly credentialMode = "provider-secret" as const;
  readonly failureRetryability = openAiImageEditFailureRetryability;

  public constructor(readonly transport: ProviderHttpTransport) {}

  public prepare(
    request: ProviderRequestPreparationRequest,
  ): PreparedProviderRequest {
    const input = parseCanvasExpandInput(request.input);
    const requireImageEditOperation = assertDerivedImageEditParameters(
      request,
      openAiCanvasExpandParameterKeys,
    );
    const targetSize = `${String(input.targetWidth)}x${String(
      input.targetHeight,
    )}` as "1024x1024" | "1536x1024" | "1024x1536";
    const size = derivedImageEditEnumParameter(
      request,
      "size",
      ["1024x1024", "1536x1024", "1024x1536"],
      targetSize,
    );
    if (size !== targetSize) {
      throw new ProviderAdapterContractError(
        "Canvas expand Provider size must match the requested target canvas.",
      );
    }
    return prepareOpenAiImageEditRequest(request, {
      adapterKey: this.adapterKey,
      command: {
        sourceArtifactId: input.sourceArtifactId,
        sourceInputPointer: "/sourceArtifactId",
        maskArtifactId: input.sourceArtifactId,
        maskInputPointer: "/maskArtifactId",
        prompt: canvasExpandPrompt(request, input),
        size,
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
          "opaque",
        ),
        outputArtifactType: "image.expanded",
        outputRole: "expanded",
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
    authorizedDerivedImageEditRequest(request, "OpenAI canvas expand");
    const requireImageEditOperation =
      derivedImageEditRouteRequiresPinnedOperation(request);
    const snapshot = readPreparedOpenAiImageEditRequest(request, {
      adapterKey: this.adapterKey,
      requireImageEditOperation,
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
      const { observation } = await submitPreparedOpenAiImageEdit(
        request,
        signal,
        {
          adapterKey: this.adapterKey,
          inputArtifacts: canvasExpandArtifactAccess(prepared),
          requireImageEditOperation,
          transport: this.transport,
        },
      );
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

  public query(): Promise<ProviderObservation> {
    return Promise.reject(
      new ProviderAdapterContractError(
        "OpenAI canvas expand does not expose a status query.",
      ),
    );
  }
}
