import { describe, expect, it } from "vitest";

import { operationRecoveryIds } from "./use-canvas-operation-session-storage-v1.js";

describe("operationRecoveryIds", () => {
  it("writes to both pending and durable recovery identities", () => {
    expect(operationRecoveryIds("draft:01", "pending:01")).toEqual([
      "draft:01",
      "pending:01",
    ]);
  });

  it("deduplicates matching recovery identities", () => {
    expect(operationRecoveryIds("draft:01", "draft:01")).toEqual(["draft:01"]);
  });
});
