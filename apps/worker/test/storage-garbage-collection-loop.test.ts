import type {
  ApplicationRuntime,
  RuntimeStateReader,
} from "@kanvas/application";
import type { StorageGarbageCollectionCoordinator } from "@kanvas/storage";
import { describe, expect, it, vi } from "vitest";

import { StorageGarbageCollectionLoop } from "../src/storage/storage-garbage-collection-loop.js";

describe("StorageGarbageCollectionLoop", () => {
  it("runs one exact cleanup only under the current garbage-collection fence", async () => {
    const assertAllowed = vi.fn(() =>
      Promise.resolve({
        state: "ACTIVE" as const,
        executionGeneration: 7,
        stateVersion: 1,
      }),
    );
    const runtime = {
      runtimeFence: {
        assertAllowed,
      },
    } as unknown as ApplicationRuntime;
    const runtimeStateReader: RuntimeStateReader = {
      read: () =>
        Promise.resolve({
          state: "ACTIVE",
          executionGeneration: 7,
          stateVersion: 1,
        }),
    };
    const runNext = vi.fn(() =>
      Promise.resolve({
        status: "completed" as const,
        uploadSessionId: "01K00000000000000000000001",
        disposition: "deleted" as const,
      }),
    );
    const loop = new StorageGarbageCollectionLoop({
      runtime,
      runtimeStateReader,
      coordinator: {
        runNext,
      } satisfies StorageGarbageCollectionCoordinator,
      logger: {
        error: vi.fn(),
      },
      pollIntervalMs: 5_000,
    });

    await expect(loop.runOnce()).resolves.toBeUndefined();
    expect(assertAllowed).toHaveBeenCalledWith({
      action: "garbage-collect",
      expectedGeneration: 7,
    });
    expect(runNext).toHaveBeenCalledOnce();
  });

  it("does not claim storage cleanup when the runtime fence rejects", async () => {
    const runNext = vi.fn();
    const loop = new StorageGarbageCollectionLoop({
      runtime: {
        runtimeFence: {
          assertAllowed: () => Promise.reject(new Error("runtime fenced")),
        },
      } as unknown as ApplicationRuntime,
      runtimeStateReader: {
        read: () =>
          Promise.resolve({
            state: "MAINTENANCE",
            executionGeneration: 8,
            stateVersion: 2,
          }),
      },
      coordinator: {
        runNext,
      },
      logger: {
        error: vi.fn(),
      },
      pollIntervalMs: 5_000,
    });

    await expect(loop.runOnce()).rejects.toThrow("runtime fenced");
    expect(runNext).not.toHaveBeenCalled();
  });
});
