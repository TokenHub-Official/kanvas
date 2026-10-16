import { describe, expect, it } from "vitest";

import {
  createRuntimeFenceGuard,
  RuntimeFenceRejectedError,
  type Clock,
  type RuntimeStateReader,
} from "../src/index.js";

const fixedClock: Clock = {
  now: () => new Date("2026-07-27T12:00:00.000Z"),
};

describe("RuntimeFenceGuard", () => {
  it("permits active same-generation actions", async () => {
    const reader: RuntimeStateReader = {
      read: () =>
        Promise.resolve({
          state: "ACTIVE",
          executionGeneration: 7,
          stateVersion: 3,
        }),
    };
    const guard = createRuntimeFenceGuard(reader, fixedClock);

    await expect(
      guard.assertAllowed({
        action: "dispatch",
        expectedGeneration: 7,
      }),
    ).resolves.toMatchObject({
      state: "ACTIVE",
      executionGeneration: 7,
    });
  });

  it("allows only same-generation drain completion before deadline", async () => {
    const reader: RuntimeStateReader = {
      read: () =>
        Promise.resolve({
          state: "DRAINING",
          executionGeneration: 8,
          stateVersion: 4,
          deadline: new Date("2026-07-27T12:01:00.000Z"),
        }),
    };
    const guard = createRuntimeFenceGuard(reader, fixedClock);

    await expect(
      guard.assertAllowed({
        action: "complete",
        expectedGeneration: 8,
      }),
    ).resolves.toMatchObject({ state: "DRAINING" });
    await expect(
      guard.assertAllowed({
        action: "claim",
        expectedGeneration: 8,
      }),
    ).rejects.toMatchObject({
      reasonCode: "runtime_state_disallowed",
    });
    await expect(
      guard.assertAllowed({
        action: "complete",
        expectedGeneration: 7,
      }),
    ).rejects.toMatchObject({
      reasonCode: "stale_execution_generation",
    });
  });

  it("allows same-generation safety cancellation while draining or in maintenance", async () => {
    let state: "DRAINING" | "MAINTENANCE" = "DRAINING";
    const reader: RuntimeStateReader = {
      read: () =>
        Promise.resolve({
          state,
          executionGeneration: 8,
          stateVersion: 4,
          ...(state === "DRAINING"
            ? { deadline: new Date("2026-07-27T12:01:00.000Z") }
            : {}),
        }),
    };
    const guard = createRuntimeFenceGuard(reader, fixedClock);

    await expect(
      guard.assertAllowed({
        action: "cancel",
        expectedGeneration: 8,
      }),
    ).resolves.toMatchObject({ state: "DRAINING" });

    state = "MAINTENANCE";
    await expect(
      guard.assertAllowed({
        action: "cancel",
        expectedGeneration: 8,
      }),
    ).resolves.toMatchObject({ state: "MAINTENANCE" });
  });

  it("rejects draining cancellation after the runtime deadline", async () => {
    const reader: RuntimeStateReader = {
      read: () =>
        Promise.resolve({
          state: "DRAINING",
          executionGeneration: 8,
          stateVersion: 4,
          deadline: new Date("2026-07-27T11:59:59.999Z"),
        }),
    };
    const guard = createRuntimeFenceGuard(reader, fixedClock);

    await expect(
      guard.assertAllowed({
        action: "cancel",
        expectedGeneration: 8,
      }),
    ).rejects.toBeInstanceOf(RuntimeFenceRejectedError);
  });

  it("fails closed in strong isolation states", async () => {
    const reader: RuntimeStateReader = {
      read: () =>
        Promise.resolve({
          state: "RESTORING",
          executionGeneration: 9,
          stateVersion: 5,
        }),
    };
    const guard = createRuntimeFenceGuard(reader, fixedClock);

    await expect(
      guard.assertAllowed({
        action: "garbage-collect",
        expectedGeneration: 9,
      }),
    ).rejects.toBeInstanceOf(RuntimeFenceRejectedError);
  });
});
