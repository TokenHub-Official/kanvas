import type {
  AsyncProviderAdapter,
  AuthorizedProviderInvocationRequest,
  PreparedProviderRequest,
  ProviderInvocationRequest,
  ProviderObservation,
  ProviderRequestPreparationRequest,
} from "./provider-adapter.js";
import {
  mapObjectRemoveObservation,
  objectRemoveArtifactAccess,
  objectRemovePrompt,
  parseObjectRemoveInput,
  prepareObjectRemove,
} from "./image-object-remove-core.js";
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

export const openAiObjectRemoveAdapterKey = "openai.image.object-remove.v1";

const openAiObjectRemoveParameterKeys = new Set([
  "size",
  "quality",
  "outputFormat",
  "background",
  "outputCompression",
]);

export class OpenAiObjectRemoveProviderAdapter implements AsyncProviderAdapter {
  readonly adapterKey = openAiObjectRemoveAdapterKey;
  readonly queryMode = "none" as const;
  readonly notFoundIsAuthoritative = false;
  readonly credentialMode = "provider-secret" as const;
  readonly failureRetryability = openAiImageEditFailureRetryability;

  public constructor(readonly transport: ProviderHttpTransport) {}

  public prepare(
    request: ProviderRequestPreparationRequest,
  ): PreparedProviderRequest {
    const input = parseObjectRemoveInput(request.input);
    const requireImageEditOperation = assertDerivedImageEditParameters(
      request,
      openAiObjectRemoveParameterKeys,
    );
    return prepareOpenAiImageEditRequest(request, {
      adapterKey: this.adapterKey,
      command: {
        sourceArtifactId: input.sourceArtifactId,
        sourceInputPointer: "/sourceArtifactId",
        maskArtifactId: input.sourceArtifactId,
        maskInputPointer: "/maskArtifactId",
        prompt: objectRemovePrompt(request, input),
        size: derivedImageEditEnumParameter(request, "size", ["auto"], "auto"),
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
        outputArtifactType: "image.object-removed",
        outputRole: "repaired",
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
    authorizedDerivedImageEditRequest(request, "OpenAI object remove");
    const requireImageEditOperation =
      derivedImageEditRouteRequiresPinnedOperation(request);
    const snapshot = readPreparedOpenAiImageEditRequest(request, {
      adapterKey: this.adapterKey,
      requireImageEditOperation,
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
      const { observation } = await submitPreparedOpenAiImageEdit(
        request,
        signal,
        {
          adapterKey: this.adapterKey,
          inputArtifacts: objectRemoveArtifactAccess(prepared),
          requireImageEditOperation,
          transport: this.transport,
        },
      );
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

  public query(): Promise<ProviderObservation> {
    return Promise.reject(
      new ProviderAdapterContractError(
        "OpenAI object remove does not expose a status query.",
      ),
    );
  }
}
