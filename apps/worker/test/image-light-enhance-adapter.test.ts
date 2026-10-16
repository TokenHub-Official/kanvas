import { createHash } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { imageLightEnhanceAdapter } from "../src/adapter/image-light-enhance-adapter.js";
import type {
  WorkerAdapterExecutionContext,
  WorkerAdapterExecutionResult,
} from "../src/adapter/worker-adapter.js";

const sourceArtifactId = "01K0000000000000000000007A";

function context(bytes: Buffer): WorkerAdapterExecutionContext {
  return {
    workspaceId: "01K00000000000000000000000",
    workflowRunId: "01K00000000000000000000001",
    nodeRunId: "01K00000000000000000000002",
    capabilityRunId: "01K00000000000000000000003",
    attemptId: "01K00000000000000000000004",
    inputArtifacts: {
      async open() {
        await Promise.resolve();
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

describe("image light-enhance Worker Adapter", () => {
  it("applies deterministic traceable parameters without changing alpha or transparent RGB", async () => {
    const pixels = Buffer.from([40, 50, 60, 255, 7, 8, 9, 0]);
    const source = await sharp(pixels, {
      raw: {
        width: 2,
        height: 1,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
    const result = (await imageLightEnhanceAdapter.execute(
      {
        sourceArtifactId,
        exposureStops: 1,
        shadows: 0.25,
        highlights: -0.1,
        temperature: 0.2,
        tint: -0.1,
      },
      new AbortController().signal,
      context(source),
    )) as WorkerAdapterExecutionResult;

    expect(result.capabilityOutput).toMatchObject({
      schemaVersion: "kanvas.image-light-enhance-result/v1",
      parameters: {
        exposureStops: 1,
        shadows: 0.25,
        highlights: -0.1,
        temperature: 0.2,
        tint: -0.1,
      },
      qualitySignals: {
        method: "deterministic_tone_curve",
        generative: false,
        alphaPreserved: true,
      },
    });
    const output = await outputBody(result);
    const outputRaw = await sharp(output).ensureAlpha().raw().toBuffer();
    expect(outputRaw[3]).toBe(255);
    expect([...outputRaw.subarray(4, 8)]).toEqual([7, 8, 9, 0]);
    expect(outputRaw[0]).toBeGreaterThan(40);
    expect(result.outputs[0]).toMatchObject({
      artifactType: "image.light-enhanced",
      metadata: {
        sourceArtifactId,
        method: "deterministic_tone_curve",
        generative: false,
      },
    });
  });
});
