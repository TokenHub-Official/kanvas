import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserU2NetBackgroundRemover } from "./u2net-browser-background-remove-worker-client.js";

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly listeners = new Map<string, Array<(event: never) => void>>();
  terminated = false;

  public constructor() {
    FakeWorker.instances.push(this);
  }

  public addEventListener(type: string, listener: (event: never) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  public postMessage(message: {
    readonly requestId: string;
    readonly type: string;
  }) {
    if (message.type !== "execute") return;
    queueMicrotask(() => {
      for (const listener of this.listeners.get("message") ?? []) {
        listener({
          data: {
            requestId: message.requestId,
            type: "completed",
            result: {
              analysisMask: new Uint8Array([255]),
              analysisSize: 1,
              foreground: new Blob(),
              mask: new Blob(),
              width: 1,
              height: 1,
              foregroundRatio: 1,
              uncertainEdgeRatio: 0,
              runtimeColdStart: FakeWorker.instances.length === 1,
              modelInitializationMilliseconds: 10,
            },
          },
        } as never);
      }
    });
  }

  public terminate() {
    this.terminated = true;
  }

  public emitError(message = "worker crashed") {
    for (const listener of this.listeners.get("error") ?? []) {
      listener({ message } as never);
    }
  }
}

afterEach(() => {
  FakeWorker.instances = [];
  vi.unstubAllGlobals();
});

describe("Browser U2Net Worker client", () => {
  it("reuses one Worker across hot executions and disposes it explicitly", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const remover = createBrowserU2NetBackgroundRemover({
      modelUrl: "/model.onnx",
      modelDigest: `sha256:${"a".repeat(64)}`,
      inputSize: 320,
      modelVariant: "u2netp",
      normalization: "imagenet",
      wasmPaths: "/wasm/",
    });

    for (let index = 0; index < 2; index += 1) {
      await remover.execute(
        new Blob(),
        {
          sourceArtifactId: "01K00000000000000000000001",
          refinement: "standard",
        },
        new AbortController().signal,
      );
    }

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]?.terminated).toBe(false);
    remover.dispose();
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });

  it("recreates the Worker after a runtime crash", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const remover = createBrowserU2NetBackgroundRemover({
      modelUrl: "/model.onnx",
      modelDigest: `sha256:${"a".repeat(64)}`,
      inputSize: 320,
      modelVariant: "u2netp",
      normalization: "imagenet",
      wasmPaths: "/wasm/",
    });
    const first = remover.execute(
      new Blob(),
      {
        sourceArtifactId: "01K00000000000000000000001",
        refinement: "standard",
      },
      new AbortController().signal,
    );
    FakeWorker.instances[0]?.emitError();

    await expect(first).rejects.toThrow("worker crashed");
    await remover.execute(
      new Blob(),
      {
        sourceArtifactId: "01K00000000000000000000001",
        refinement: "standard",
      },
      new AbortController().signal,
    );

    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
    remover.dispose();
  });

  it("cancels one execution without discarding the reusable Worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const remover = createBrowserU2NetBackgroundRemover({
      modelUrl: "/model.onnx",
      modelDigest: `sha256:${"a".repeat(64)}`,
      inputSize: 320,
      modelVariant: "u2netp",
      normalization: "imagenet",
      wasmPaths: "/wasm/",
    });
    const controller = new AbortController();
    const cancelled = remover.execute(
      new Blob(),
      {
        sourceArtifactId: "01K00000000000000000000001",
        refinement: "standard",
      },
      controller.signal,
    );
    controller.abort();

    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await remover.execute(
      new Blob(),
      {
        sourceArtifactId: "01K00000000000000000000001",
        refinement: "standard",
      },
      new AbortController().signal,
    );

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]?.terminated).toBe(false);
    remover.dispose();
  });
});
