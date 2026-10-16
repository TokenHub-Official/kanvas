import { describe, expect, it } from "vitest";

import {
  CapabilityRunStoreError,
  directCapabilityBrowserExecution,
} from "../src/runtime/capability-run-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";

const routeSnapshot = {
  contractKey: "browser.image.palette.extract",
  candidates: [
    { candidateIndex: 0, executionTarget: "browser" },
    { candidateIndex: 1, executionTarget: "worker" },
  ],
};
const routeSnapshotHash = digestProviderValue(routeSnapshot);

describe("direct Capability browser execution projection", () => {
  it("uses only the pinned key and current browser attempt", () => {
    expect(
      directCapabilityBrowserExecution({
        executionTarget: "browser",
        routeCandidateIndex: 0,
        routeSnapshot,
        routeSnapshotHash,
      }),
    ).toEqual({
      requiredCapabilityKeys: ["browser.image.palette.extract"],
    });
    expect(
      directCapabilityBrowserExecution({
        executionTarget: "worker",
        routeCandidateIndex: 1,
        routeSnapshot,
        routeSnapshotHash,
      }),
    ).toBeUndefined();
  });

  it("fails closed for a mismatched snapshot or current candidate", () => {
    expect(() =>
      directCapabilityBrowserExecution({
        executionTarget: "browser",
        routeCandidateIndex: 0,
        routeSnapshot,
        routeSnapshotHash: `sha256:${"0".repeat(64)}`,
      }),
    ).toThrow(CapabilityRunStoreError);
    expect(() =>
      directCapabilityBrowserExecution({
        executionTarget: "browser",
        routeCandidateIndex: 1,
        routeSnapshot,
        routeSnapshotHash,
      }),
    ).toThrow("Capability browser route projection is invalid.");
  });
});
