import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadCanvasRuntimeRecoveryV1,
  removeCanvasRuntimeRecoveryV1,
  saveCanvasRuntimeRecoveryV1,
} from "./canvas-runtime-recovery-v1.js";
import { createEditorDocumentV1 } from "./editor-document-factory-v1.js";

const workspaceId = "01K00000000000000000000000";
const recoveryId = "draft-1";

afterEach(async () => {
  await removeCanvasRuntimeRecoveryV1(workspaceId, recoveryId);
});

describe("Canvas Core V1 runtime recovery", () => {
  it("round-trips a document snapshot with local files", async () => {
    const file = new File(["image"], "商品.png", {
      type: "image/png",
    });
    const document = createEditorDocumentV1(workspaceId);

    await saveCanvasRuntimeRecoveryV1({
      workspaceId,
      recoveryId,
      document,
      files: [
        {
          localId: "local-1",
          name: "商品.png",
          file,
          uploadCompleted: true,
          uploadSessionId: "01K00000000000000000000001",
        },
      ],
    });

    const recovered = await loadCanvasRuntimeRecoveryV1(
      workspaceId,
      recoveryId,
    );
    expect(recovered?.document).toEqual(document);
    expect(recovered?.files[0]?.name).toBe("商品.png");
    expect(recovered?.files[0]?.file).toBeInstanceOf(Blob);
    expect(recovered?.files[0]?.uploadCompleted).toBe(true);
    expect(recovered?.files[0]?.uploadSessionId).toBe(
      "01K00000000000000000000001",
    );
  });
});
