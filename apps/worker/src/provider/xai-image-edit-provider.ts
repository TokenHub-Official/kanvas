import {
  ProviderAdapterContractError,
  type AsyncProviderAdapter,
  type PreparedProviderRequest,
  type ProviderInvocationRequest,
  type ProviderObservation,
  type ProviderRequestPreparationRequest,
} from "./provider-adapter.js";
import type { ProviderHttpTransport } from "./provider-http-transport.js";
import {
  XaiImageEditProtocol,
  xaiImageEditAdapterKey,
  xaiImageEditFailureRetryability,
} from "./xai-image-edit-protocol.js";

export class XaiImageEditProviderAdapter implements AsyncProviderAdapter {
  readonly adapterKey = xaiImageEditAdapterKey;
  readonly queryMode = "none" as const;
  readonly notFoundIsAuthoritative = false;
  readonly credentialMode = "provider-secret" as const;
  readonly failureRetryability = xaiImageEditFailureRetryability;
  readonly #protocol: XaiImageEditProtocol;

  public constructor(transport: ProviderHttpTransport) {
    this.#protocol = new XaiImageEditProtocol(transport);
  }

  public prepare(
    request: ProviderRequestPreparationRequest,
  ): PreparedProviderRequest {
    return this.#protocol.prepare(request);
  }

  public submit(
    request: ProviderInvocationRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    return this.#protocol.submit(request, signal);
  }

  public query(): Promise<ProviderObservation> {
    return Promise.reject(
      new ProviderAdapterContractError(
        "xAI image edit does not expose a status query.",
      ),
    );
  }
}
