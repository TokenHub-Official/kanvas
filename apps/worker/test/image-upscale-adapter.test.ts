import { createHash } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { sharpImageResizeAdapter } from "../src/adapter/image-upscale-adapter.js";
import type {
  WorkerAdapterExecutionContext,
  WorkerAdapterExecutionResult,
} from "../src/adapter/worker-adapter.js";

const sourceArtifactId = "01K0000000000000000000003A";

async function sourcePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 3,
      height: 2,
      channels: 4,
      background: {
        r: 21,
        g: 42,
        b: 84,
        alpha: 0.5,
      },
    },
  })
    .png()
    .toBuffer();
}

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

describe("Sharp image resize Worker Adapter", () => {
  it("produces a deterministic native 2x PNG result", async () => {
    const bytes = await sourcePng();
    const result = (await sharpImageResizeAdapter.execute(
      {
        sourceArtifactId,
        scaleFactor: 2,
        resamplingKernel: "lanczos3",
        outputFormat: "png",
      },
      new AbortController().signal,
      context(bytes),
    )) as WorkerAdapterExecutionResult;

    expect(result.capabilityOutput).toMatchObject({
      imageArtifact: {
        $kanvas: "attempt-output-artifact/v1",
        outputRole: "upscaled",
        outputIndex: 0,
      },
      scaleFactor: 2,
      sourceWidth: 3,
      sourceHeight: 2,
      outputWidth: 6,
      outputHeight: 4,
      resamplingKernel: "lanczos3",
    });
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]).toMatchObject({
      outputRole: "upscaled",
      artifactType: "image.resized",
      mediaType: "image/png",
      metadata: {
        sourceArtifactId,
        outputWidth: 6,
        outputHeight: 4,
      },
    });
    const output = await outputBody(result);
    await expect(sharp(output).metadata()).resolves.toMatchObject({
      width: 6,
      height: 4,
      format: "png",
      hasAlpha: true,
    });
    expect(result.outputs[0]!.sha256).toBe(
      createHash("sha256").update(output).digest("hex"),
    );
  });

  it("rejects capability-specific fields at the Adapter boundary", async () => {
    const bytes = await sourcePng();
    await expect(
      sharpImageResizeAdapter.execute(
        {
          sourceArtifactId,
          qualityIntent: "reconstructive",
          scaleFactor: 2,
          resamplingKernel: "lanczos3",
          outputFormat: "png",
        },
        new AbortController().signal,
        context(bytes),
      ),
    ).rejects.toThrow("Sharp image resize input is invalid");
  });
});
