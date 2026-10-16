import type { ContentTransferStore } from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import { ContentEventProcessor } from "../src/queue/content-event.processor.js";
import type { ArtifactPreviewMaterializer } from "../src/storage/artifact-preview-materializer.js";

describe("ContentEventProcessor", () => {
  it.each(["artifact.user_imported", "artifact.canvas_exported"] as const)(
    "hands the trusted %s envelope to the idempotent database consumer",
    async (messageType) => {
      const consumeArtifactContentEvent = vi
        .fn<ContentTransferStore["consumeArtifactContentEvent"]>()
        .mockResolvedValue({
          deliveryStatus: "processed",
          event: {
            eventId: "01K00000000000000000000001",
            workspaceId: "01K00000000000000000000002",
            messageType,
            schemaVersion: 1,
            aggregateType: "artifact",
            aggregateId: "01K00000000000000000000003",
            aggregateVersion: 1,
            expectedGeneration: 7,
            payload: {},
          },
          outcome: "noop",
          resultCode:
            messageType === "artifact.user_imported"
              ? "artifact.import_recorded"
              : "artifact.export_recorded",
          value: {
            artifactId: "01K00000000000000000000003",
          },
        });
      const processor = new ContentEventProcessor({
        store: {
          consumeArtifactContentEvent,
        },
      });

      await expect(
        processor.handle({
          schemaVersion: 1,
          outboxEventId: "01K00000000000000000000001",
          workspaceId: "01K00000000000000000000002",
          messageType,
          aggregateType: "artifact",
          aggregateId: "01K00000000000000000000003",
          aggregateVersion: 1,
          expectedGeneration: 7,
          artifactId: "01K00000000000000000000003",
          storedObjectId: "01K00000000000000000000004",
          uploadSessionId: "01K00000000000000000000005",
        }),
      ).resolves.toMatchObject({
        deliveryStatus: "processed",
      });

      expect(consumeArtifactContentEvent).toHaveBeenCalledOnce();
      const delivery = consumeArtifactContentEvent.mock.calls[0]?.[0];
      expect(delivery).toMatchObject({
        consumerName: "content-event.v1",
        eventId: "01K00000000000000000000001",
        workspaceId: "01K00000000000000000000002",
        schemaVersion: 1,
        messageType,
        aggregateType: "artifact",
        aggregateId: "01K00000000000000000000003",
        aggregateVersion: 1,
        expectedGeneration: 7,
      });
      expect(delivery?.receivedAt).toBeInstanceOf(Date);
    },
  );

  it("materializes the preview before acknowledging the content event", async () => {
    const order: string[] = [];
    const materialize = vi
      .fn<ArtifactPreviewMaterializer["materialize"]>()
      .mockImplementation(() => {
        order.push("preview");
        return Promise.resolve({ status: "created" });
      });
    const consumeArtifactContentEvent = vi
      .fn<ContentTransferStore["consumeArtifactContentEvent"]>()
      .mockImplementation(() => {
        order.push("consume");
        return Promise.resolve({
          deliveryStatus: "processed",
          event: {
            eventId: "01K00000000000000000000001",
            workspaceId: "01K00000000000000000000002",
            messageType: "artifact.user_imported",
            schemaVersion: 1,
            aggregateType: "artifact",
            aggregateId: "01K00000000000000000000003",
            aggregateVersion: 1,
            expectedGeneration: 7,
            payload: {},
          },
          outcome: "noop",
          resultCode: "artifact.import_recorded",
          value: { artifactId: "01K00000000000000000000003" },
        });
      });
    const processor = new ContentEventProcessor({
      store: { consumeArtifactContentEvent },
      previewMaterializer: { materialize },
    });

    await processor.handle({
      schemaVersion: 1,
      outboxEventId: "01K00000000000000000000001",
      workspaceId: "01K00000000000000000000002",
      messageType: "artifact.user_imported",
      aggregateType: "artifact",
      aggregateId: "01K00000000000000000000003",
      aggregateVersion: 1,
      expectedGeneration: 7,
      artifactId: "01K00000000000000000000003",
      storedObjectId: "01K00000000000000000000004",
      uploadSessionId: "01K00000000000000000000005",
    });

    expect(materialize).toHaveBeenCalledWith({
      workspaceId: "01K00000000000000000000002",
      artifactId: "01K00000000000000000000003",
    });
    expect(order).toEqual(["preview", "consume"]);
  });
});
