import { createHash } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import {
  createU2NetSubjectDetectAdapter,
  u2netSubjectDetectAdapterKey,
} from "../src/adapter/u2net-subject-detect-adapter.js";
import type { WorkerAdapterExecutionContext } from "../src/adapter/worker-adapter.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;

async function sourcePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 640,
      height: 320,
      channels: 3,
      background: {
        r: 230,
        g: 230,
        b: 230,
      },
    },
  })
    .png()
    .toBuffer();
}

function body(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    await Promise.resolve();
    yield bytes;
  })();
}

function context(bytes: Buffer): WorkerAdapterExecutionContext {
  return Object.freeze({
    workspaceId: id(1),
    workflowRunId: id(2),
    nodeRunId: id(3),
    capabilityRunId: id(4),
    attemptId: id(5),
    inputArtifacts: {
      open: vi.fn().mockResolvedValue({
        artifactId: id(6),
        storedObjectId: id(7),
        artifactType: "image.source",
        dataClassification: "confidential",
        byteSize: String(bytes.byteLength),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mediaType: "image/png",
        body: body(bytes),
      }),
    },
  });
}

function modelMask(): Float32Array {
  const size = 320;
  const values = new Float32Array(size * size);
  for (let y = 40; y < 180; y += 1) {
    for (let x = 30; x < 150; x += 1) {
      values[y * size + x] = 0.9;
    }
  }
  for (let y = 220; y < 270; y += 1) {
    for (let x = 250; x < 290; x += 1) {
      values[y * size + x] = 0.7;
    }
  }
  values[0] = 0;
  values[values.length - 1] = 1;
  return values;
}

describe("IS-Net subject detection Worker Adapter", () => {
  it("returns deterministic class-agnostic candidates, bounds and an optional mask", async () => {
    const source = await sourcePng();
    const infer = vi.fn().mockResolvedValue(modelMask());
    const adapter = createU2NetSubjectDetectAdapter({
      inference: {
        infer,
      },
      model: {
        inputSize: 320,
        normalization: "imagenet",
        variant: "u2net",
        sha256: "a".repeat(64),
      },
    });

    const result = await adapter.execute(
      {
        sourceArtifactId: id(6),
        maxSubjects: 4,
        minimumAreaRatio: 0.001,
        minimumConfidence: 0.5,
        includeMask: true,
      },
      new AbortController().signal,
      context(source),
    );

    expect(adapter.adapterKey).toBe(u2netSubjectDetectAdapterKey);
    const output = result as {
      readonly protocol: string;
      readonly capabilityOutput: {
        readonly schemaVersion: string;
        readonly sourceWidth: number;
        readonly sourceHeight: number;
        readonly maskArtifactId: unknown;
        readonly qualitySignals: {
          readonly candidateCount: number;
          readonly taxonomy: string;
        };
        readonly candidates: readonly {
          readonly subjectId: string;
          readonly bounds: {
            readonly x: number;
            readonly y: number;
            readonly width: number;
            readonly height: number;
          };
        }[];
      };
      readonly outputs: readonly {
        readonly artifactType: string;
        readonly outputRole: string;
      }[];
    };
    expect(output.protocol).toBe("kanvas.worker-adapter-result/v1");
    expect(output.capabilityOutput).toMatchObject({
      schemaVersion: "kanvas.image-subject-detect-result/v1",
      sourceWidth: 640,
      sourceHeight: 320,
      maskArtifactId: {
        $kanvas: "attempt-output-artifact/v1",
        outputRole: "mask",
        outputIndex: 0,
      },
      qualitySignals: {
        candidateCount: 2,
        taxonomy: "class_agnostic_isnet",
      },
    });
    expect(output.capabilityOutput.candidates).toHaveLength(2);
    expect(output.capabilityOutput.candidates[0]).toEqual(
      expect.objectContaining({
        subjectId: "subject-1",
        bounds: {
          x: 60,
          y: 40,
          width: 240,
          height: 140,
        },
      }),
    );
    expect(output.outputs).toEqual([
      expect.objectContaining({
        outputRole: "mask",
        artifactType: "image.mask",
      }),
    ]);
    expect(infer).toHaveBeenCalledOnce();
  });

  it("does not create an Artifact when mask output is disabled", async () => {
    const source = await sourcePng();
    const adapter = createU2NetSubjectDetectAdapter({
      inference: {
        infer: vi.fn().mockResolvedValue(modelMask()),
      },
      model: {
        inputSize: 320,
        normalization: "imagenet",
        variant: "u2net",
        sha256: "b".repeat(64),
      },
    });

    const result = (await adapter.execute(
      {
        sourceArtifactId: id(6),
        includeMask: false,
      },
      new AbortController().signal,
      context(source),
    )) as {
      readonly capabilityOutput: {
        readonly maskArtifactId: string | null;
      };
      readonly outputs: readonly unknown[];
    };

    expect(result.capabilityOutput.maskArtifactId).toBeNull();
    expect(result.outputs).toEqual([]);
  });
});
