import type { ContentTransferStore } from "@kanvas/database/runtime";

import type { ArtifactPreviewMaterializer } from "../storage/artifact-preview-materializer.js";
import { parseContentEventDelivery } from "./inbox-delivery.js";

export interface ContentEventProcessorOptions {
  readonly store: Pick<ContentTransferStore, "consumeArtifactContentEvent">;
  readonly previewMaterializer?: ArtifactPreviewMaterializer;
}

export class ContentEventProcessor {
  readonly #store: ContentEventProcessorOptions["store"];
  readonly #previewMaterializer: ArtifactPreviewMaterializer | undefined;

  public constructor(options: ContentEventProcessorOptions) {
    this.#store = options.store;
    this.#previewMaterializer = options.previewMaterializer;
  }

  public async handle(
    value: unknown,
  ): ReturnType<ContentTransferStore["consumeArtifactContentEvent"]> {
    const parsed = parseContentEventDelivery(value);
    await this.#previewMaterializer?.materialize({
      workspaceId: parsed.delivery.workspaceId,
      artifactId: parsed.payload.artifactId,
    });
    return await this.#store.consumeArtifactContentEvent({
      ...parsed.delivery,
      receivedAt: new Date(),
    });
  }
}
