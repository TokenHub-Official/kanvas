import { createHash } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { faithfulImageDenoiseAdapter } from "../src/adapter/image-denoise-adapter.js";
import type {
  WorkerAdapterExecutionContext,
  WorkerAdapterExecutionResult,
} from "../src/adapter/worker-adapter.js";

const sourceArtifactId = "01K0000000000000000000005A";

function context(bytes: Buffer): WorkerAdapterExecutionContext {
  return {
    workspaceId: "01K00000000000000000000000",
    workflowRunId: "01K00000000000000000000001",
    nodeRunId: "01K00000000000000000000002",
    capabilityRunId: "01K00000000000000000000003",
    attemptId: "01K00000000000000000000004",
    inputArtifacts: {
      async open({ inputPointer }) {
        await Promise.resolve();
        expect(inputPointer).toBe("/sourceArtifactId");
        return {
          artifactId: sourceArtifactId,
          storedObjectId: "01K00000000000000000000005",
          artifactType: "image",
          dataClassification: "internal",
          byteSize: String(bytes.byteLength),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          mediaType: "image/png",
          body: (async function* () {
            await Promise.resolve();
            yield bytes;
          })(),
        };
      },
    },
  };
}

async function outputBody(
  result: WorkerAdapterExecutionResult,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of result.outputs[0]!.body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("faithful image denoise Worker Adapter", () => {
  it("blends a median filter while preserving every alpha byte", async () => {
    const pixels = Buffer.from([
      30, 30, 30, 255, 30, 30, 30, 128, 30, 30, 30, 255, 30, 30, 30, 255, 255,
      255, 255, 64, 30, 30, 30, 255, 30, 30, 30, 255, 30, 30, 30, 0, 30, 30, 30,
      255,
    ]);
    const source = await sharp(pixels, {
      raw: {
        width: 3,
        height: 3,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
    const result = (await faithfulImageDenoiseAdapter.execute(
      {
        sourceArtifactId,
        strength: 1,
      },
      new AbortController().signal,
      context(source),
    )) as WorkerAdapterExecutionResult;

    expect(result.capabilityOutput).toMatchObject({
      schemaVersion: "kanvas.image-denoise-result/v1",
      method: "median_blend",
      strength: 1,
      qualitySignals: {
        qualityIntent: "faithful",
        generative: false,
        alphaPreserved: true,
        kernelSize: 3,
      },
    });
    const output = await outputBody(result);
    const sourceRaw = await sharp(source).ensureAlpha().raw().toBuffer();
    const outputRaw = await sharp(output).ensureAlpha().raw().toBuffer();
    expect([...outputRaw.filter((_, index) => index % 4 === 3)]).toEqual([
      ...sourceRaw.filter((_, index) => index % 4 === 3),
    ]);
    expect([...outputRaw.subarray(16, 19)]).toEqual([30, 30, 30]);
    expect(result.outputs[0]).toMatchObject({
      artifactType: "image.denoised",
      metadata: {
        sourceArtifactId,
        generative: false,
        alphaPreserved: true,
      },
    });
  });
});
