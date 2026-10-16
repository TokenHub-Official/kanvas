import { describe, expect, it } from "vitest";

import {
  clearCapabilityTestRecovery,
  readCapabilityTestRecovery,
  writeCapabilityTestRecovery,
  type CapabilityTestRecovery,
  type CapabilityTestRecoveryScope,
} from "./capability-test-recovery.js";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

const scope: CapabilityTestRecoveryScope = {
  capabilityId: "capability-1",
  principalId: "principal-1",
  workspaceId: "workspace-1",
};

const recovery: CapabilityTestRecovery = {
  ...scope,
  schemaVersion: 1,
  browserRuntimeRequired: true,
  capabilityKey: "image.palette.extract",
  contractRevisionId: "contract-revision-1",
  runId: "run-1",
};

describe("Capability test Run recovery", () => {
  it("restores the accepted Run only inside the same principal, workspace, and capability", () => {
    const target = storage();
    writeCapabilityTestRecovery(recovery, target);

    expect(readCapabilityTestRecovery(scope, target)).toEqual(recovery);
    expect(
      readCapabilityTestRecovery(
        { ...scope, capabilityId: "capability-2" },
        target,
      ),
    ).toBeUndefined();
    expect(
      readCapabilityTestRecovery(
        { ...scope, principalId: "principal-2" },
        target,
      ),
    ).toBeUndefined();
    expect(
      readCapabilityTestRecovery(
        { ...scope, workspaceId: "workspace-2" },
        target,
      ),
    ).toBeUndefined();
  });

  it("clears one capability without removing another capability's Run", () => {
    const target = storage();
    const other = {
      ...recovery,
      capabilityId: "capability-2",
      runId: "run-2",
    };
    writeCapabilityTestRecovery(recovery, target);
    writeCapabilityTestRecovery(other, target);

    clearCapabilityTestRecovery(scope, target);

    expect(readCapabilityTestRecovery(scope, target)).toBeUndefined();
    expect(
      readCapabilityTestRecovery(
        { ...scope, capabilityId: "capability-2" },
        target,
      ),
    ).toEqual(other);
  });
});
