import { describe, expect, it } from "vitest";

import {
  completeWorkflowRunAssetAdoption,
  prepareWorkflowRunAssetAdoption,
} from "./workflow-run-asset-adoption.js";

describe("Workflow Run Asset adoption", () => {
  it("keeps idempotency and saved Asset identity scoped to each Artifact", () => {
    const first = prepareWorkflowRunAssetAdoption(
      {},
      "artifact-1",
      () => "asset-1",
    );
    const second = prepareWorkflowRunAssetAdoption(
      first.state,
      "artifact-2",
      () => "asset-2",
    );
    const savedFirst = completeWorkflowRunAssetAdoption(
      second.state,
      "artifact-1",
      "asset-1",
    );

    expect(savedFirst).toEqual({
      "artifact-1": { idempotencyKey: "asset-1", assetId: "asset-1" },
      "artifact-2": { idempotencyKey: "asset-2" },
    });
    expect(
      prepareWorkflowRunAssetAdoption(
        savedFirst,
        "artifact-2",
        () => "unexpected",
      ).adoption.idempotencyKey,
    ).toBe("asset-2");
  });
});
