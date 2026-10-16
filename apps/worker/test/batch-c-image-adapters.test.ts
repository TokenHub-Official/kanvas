import { createHash } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  imageCropSuggestAdapter,
  imageQualityAssessAdapter,
} from "../src/adapter/batch-c-image-analysis-adapters.js";
import { imageBackgroundComposeAdapter } from "../src/adapter/image-background-compose-adapter.js";
import type {
  WorkerAdapterExecutionContext,
  WorkerAdapterExecutionResult,
} from "../src/adapter/worker-adapter.js";

const sourceArtifactId = "01K00000000000000000000100";

function context(
  byPointer: Readonly<Record<string, Buffer>>,
): WorkerAdapterExecutionContext {
  return {
    workspaceId: "01K00000000000000000000000",
    workflowRunId: "01K00000000000000000000001",
    nodeRunId: "01K00000000000000000000002",
    capabilityRunId: "01K00000000000000000000003",
    attemptId: "01K00000000000000000000004",
    inputArtifacts: {
      async open({ inputPointer }) {
        await Promise.resolve();
        const bytes = byPointer[inputPointer];
        if (!bytes) {
          throw new Error(`Unexpected pointer ${inputPointer}.`);
        }
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

async function png(
  width: number,
  height: number,
  pixels: readonly number[],
): Promise<Buffer> {
  return sharp(Uint8Array.from(pixels), {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

async function output(
  result: WorkerAdapterExecutionResult,
  index: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of result.outputs[index]!.body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("Batch C Worker Adapters", () => {
  it("returns crop suggestions without modifying or materializing the source", async () => {
    const source = await png(
      4,
      2,
      Array.from({ length: 8 }, () => [100, 100, 100, 255]).flat(),
    );
    const result = (await imageCropSuggestAdapter.execute(
      {
        sourceArtifactId,
        aspectRatios: ["1:1"],
        subjectBounds: [
          {
            x: 2,
            y: 0,
            width: 2,
            height: 2,
          },
        ],
      },
      new AbortController().signal,
      context({
        "/sourceArtifactId": source,
      }),
    )) as WorkerAdapterExecutionResult;

    expect(result.outputs).toEqual([]);
    expect(result.capabilityOutput).toMatchObject({
      schemaVersion: "kanvas.image-crop-suggest-result/v1",
      sourceWidth: 4,
      sourceHeight: 2,
      suggestions: [
        {
          aspectRatio: "1:1",
          rank: 1,
          subjectRetention: 1,
        },
      ],
      qualitySignals: {
        generative: false,
        sourceModified: false,
        subjectBoundsProvided: true,
      },
    });
  });

  it("returns quality facts without turning findings into a repair", async () => {
    const source = await png(
      8,
      8,
      Array.from({ length: 64 }, () => [0, 0, 0, 255]).flat(),
    );
    const result = (await imageQualityAssessAdapter.execute(
      {
        sourceArtifactId,
      },
      new AbortController().signal,
      context({
        "/sourceArtifactId": source,
      }),
    )) as WorkerAdapterExecutionResult;

    expect(result.outputs).toEqual([]);
    expect(result.capabilityOutput).toMatchObject({
      schemaVersion: "kanvas.image-quality-assess-result/v1",
      underExposureRatio: 1,
      qualitySignals: {
        generative: false,
        sourceModified: false,
      },
    });
    const quality = result.capabilityOutput as {
      readonly findings: readonly string[];
    };
    expect(quality.findings.includes("blur")).toBe(true);
    expect(quality.findings.includes("under_exposed")).toBe(true);
  });

  it("materializes a deterministic composed image and Composition Mask", async () => {
    const foreground = await png(1, 1, [255, 0, 0, 255]);
    const result = (await imageBackgroundComposeAdapter.execute(
      {
        foregroundArtifactId: sourceArtifactId,
        background: {
          kind: "color",
          color: "#0000FFFF",
        },
        canvas: {
          width: 2,
          height: 1,
        },
        placement: {
          x: 0,
          y: 0,
          width: 2,
          height: 1,
          fit: "stretch",
          opacity: 0.5,
        },
      },
      new AbortController().signal,
      context({
        "/foregroundArtifactId": foreground,
      }),
    )) as WorkerAdapterExecutionResult;

    expect(result.outputs).toHaveLength(2);
    expect(result.outputs.map(({ artifactType }) => artifactType)).toEqual([
      "image.background-composed",
      "image.composition-mask",
    ]);
    expect(result.capabilityOutput).toMatchObject({
      schemaVersion: "kanvas.image-background-compose-result/v1",
      resolvedPlacement: {
        x: 0,
        y: 0,
        width: 2,
        height: 1,
      },
      qualitySignals: {
        generative: false,
        deterministic: true,
        alphaComposited: true,
      },
    });
    const composed = await sharp(await output(result, 0))
      .ensureAlpha()
      .raw()
      .toBuffer();
    const mask = await sharp(await output(result, 1))
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect([...composed]).toEqual([128, 0, 128, 255, 128, 0, 128, 255]);
    expect([...mask]).toEqual([128, 128, 128, 255, 128, 128, 128, 255]);
  });
});
