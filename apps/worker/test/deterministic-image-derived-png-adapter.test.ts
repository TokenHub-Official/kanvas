import { createHash } from "node:crypto";

import {
  verifyTrustedImage,
  type TrustedImageVerificationLimits,
} from "@kanvas/storage";
import { describe, expect, it, vi } from "vitest";

import {
  createWorkerAdapterRegistry,
  type WorkerAdapterExecutionContext,
  type WorkerAdapterExecutionResult,
} from "../src/adapter/worker-adapter.js";
import type { WorkerInputArtifactAccess } from "../src/storage/worker-input-artifact-resolver.js";
import {
  deterministicImageDerivedPngAdapter,
  deterministicImageDerivedPngAdapterKey,
} from "./support/deterministic-image-derived-png-adapter.js";

function ulid(suffix: string): string {
  return `01K${"0".repeat(23 - suffix.length)}${suffix}`;
}

const ids = Object.freeze({
  workspace: ulid("1"),
  workflowRun: ulid("2"),
  nodeRun: ulid("3"),
  capabilityRun: ulid("4"),
  attempt: ulid("5"),
  sourceArtifact: ulid("7"),
  storedObject: ulid("12"),
});

const verificationLimits: TrustedImageVerificationLimits = Object.freeze({
  maximumInputBytes: 1_048_576,
  maximumWidth: 256,
  maximumHeight: 256,
  maximumPixels: 65_536,
  maximumDecodedBytes: 262_144,
  maximumExpansionRatio: 100_000,
  requireDecodedVerification: false,
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function adapterInput() {
  return {
    sourceArtifactId: ids.sourceArtifact,
  };
}

function executionContext(
  sourceBytes: Uint8Array,
  consumed?: () => void,
): WorkerAdapterExecutionContext {
  const inputArtifacts: WorkerInputArtifactAccess = {
    open: vi.fn().mockResolvedValue({
      artifactId: ids.sourceArtifact,
      storedObjectId: ids.storedObject,
      artifactType: "image",
      dataClassification: "internal",
      byteSize: sourceBytes.byteLength.toString(),
      sha256: sha256(sourceBytes),
      mediaType: "image/png",
      body: (async function* () {
        await Promise.resolve();
        const midpoint = Math.floor(sourceBytes.byteLength / 2);
        yield sourceBytes.subarray(0, midpoint);
        yield sourceBytes.subarray(midpoint);
        consumed?.();
      })(),
    }),
  };
  return {
    workspaceId: ids.workspace,
    workflowRunId: ids.workflowRun,
    nodeRunId: ids.nodeRun,
    capabilityRunId: ids.capabilityRun,
    attemptId: ids.attempt,
    runtimeAdapterRevisionId: ulid("13"),
    runtimeAdapterRevisionDigest: `sha256:${"a".repeat(64)}`,
    runtimeAdapter: {
      schemaVersion: "kanvas.runtime-adapter-definition/v1",
      adapterKey: deterministicImageDerivedPngAdapterKey,
      revision: 1,
      displayName: {
        defaultLocale: "en-US",
        values: {
          "zh-CN": "确定性图片测试运行器",
          "en-US": "Deterministic image test runtime",
        },
      },
      executionTarget: "worker",
      sourceKinds: ["plugin"],
      supportedModelFormats: [],
      invocationInputSchema: {},
      invocationOutputSchema: {},
      configurationSchema: {},
      artifactInputs: [],
      executable: {
        kind: "built_in",
        packageKey: "kanvas.test-runtime",
        packageVersion: "1.0.0",
        entrypoint: deterministicImageDerivedPngAdapterKey,
        releaseDigest: `sha256:${"b".repeat(64)}`,
      },
    },
    inputArtifacts,
  };
}

async function execute(
  sourceBytes: Uint8Array,
  consumed?: () => void,
): Promise<WorkerAdapterExecutionResult> {
  const registry = createWorkerAdapterRegistry([
    deterministicImageDerivedPngAdapter,
  ]);
  const result = await registry.execute(
    deterministicImageDerivedPngAdapterKey,
    adapterInput(),
    new AbortController().signal,
    executionContext(sourceBytes, consumed),
  );
  if (
    !result ||
    typeof result !== "object" ||
    !("protocol" in result) ||
    result.protocol !== "kanvas.worker-adapter-result/v1"
  ) {
    throw new Error("Deterministic image Adapter returned an invalid result.");
  }
  return result as WorkerAdapterExecutionResult;
}

async function outputBytes(
  result: WorkerAdapterExecutionResult,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of result.outputs[0]?.body ?? []) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

describe("deterministic image-derived PNG Adapter", () => {
  it("fully consumes input and emits a structurally valid transparent PNG", async () => {
    const consumed = vi.fn();
    const result = await execute(new Uint8Array([1, 2, 3, 4, 5]), consumed);
    const bytes = await outputBytes(result);

    expect(consumed).toHaveBeenCalledOnce();
    expect(result.capabilityOutput).toEqual({
      schemaVersion: "kanvas.deterministic-image-result/v1",
      imageArtifactId: {
        $kanvas: "attempt-output-artifact/v1",
        outputRole: "primary",
        outputIndex: 0,
      },
      sourceArtifactId: ids.sourceArtifact,
      capabilityRunId: ids.capabilityRun,
    });
    expect(result.outputs[0]).toMatchObject({
      outputRole: "primary",
      outputIndex: 0,
      artifactType: "image",
      mediaType: "image/png",
      byteSize: bytes.byteLength.toString(),
      sha256: sha256(bytes),
      metadata: {
        nonProduction: true,
        generator: "sha256-swatch/v1",
        width: 8,
        height: 8,
        alpha: "transparent",
      },
    });
    await expect(
      verifyTrustedImage({
        body: (async function* () {
          await Promise.resolve();
          yield bytes;
        })(),
        declaredMediaType: "image/png",
        limits: verificationLimits,
        verificationProfileVersion: "deterministic-canary-v1",
      }),
    ).resolves.toMatchObject({
      detectedMediaType: "image/png",
      width: 8,
      height: 8,
      frameCount: 1,
      assurance: "structural_only",
    });
  });

  it("is byte-deterministic and derives different output from different inputs", async () => {
    const first = await outputBytes(await execute(new Uint8Array([1, 2, 3])));
    const replay = await outputBytes(await execute(new Uint8Array([1, 2, 3])));
    const changed = await outputBytes(await execute(new Uint8Array([1, 2, 4])));

    expect(replay).toEqual(first);
    expect(changed).not.toEqual(first);
  });

  it("fails closed for invalid input, cancellation, unknown keys and duplicate registration", async () => {
    const registry = createWorkerAdapterRegistry([
      deterministicImageDerivedPngAdapter,
    ]);
    const context = executionContext(new Uint8Array([1, 2, 3]));
    await expect(
      registry.execute(
        deterministicImageDerivedPngAdapterKey,
        {},
        new AbortController().signal,
        context,
      ),
    ).rejects.toThrow(/one source Artifact/u);
    await expect(
      registry.execute(
        "test.missing",
        adapterInput(),
        new AbortController().signal,
        context,
      ),
    ).rejects.toThrow(/Unsupported worker capability adapter/u);
    expect(() =>
      createWorkerAdapterRegistry([
        deterministicImageDerivedPngAdapter,
        deterministicImageDerivedPngAdapter,
      ]),
    ).toThrow(/valid and unique/u);

    const cancellation = new AbortController();
    const cancellingContext = executionContext(new Uint8Array([1, 2, 3]));
    cancellation.abort(new Error("attempt cancelled"));
    await expect(
      registry.execute(
        deterministicImageDerivedPngAdapterKey,
        adapterInput(),
        cancellation.signal,
        cancellingContext,
      ),
    ).rejects.toThrow("attempt cancelled");
  });
});
