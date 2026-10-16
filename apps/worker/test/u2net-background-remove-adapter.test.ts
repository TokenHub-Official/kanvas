import { describe, expect, it } from "vitest";

import { createDeterministicRgbaPng } from "../src/adapter/nonproduction-deterministic-image-adapter.js";
import {
  createU2NetBackgroundRemoveAdapter,
  renderU2NetMask,
  u2netBackgroundRemoveWebpAdapterKey,
} from "../src/adapter/u2net-background-remove-adapter.js";

const sourceArtifactId = "01K00000000000000000000001";
const source = createDeterministicRgbaPng({
  width: 8,
  height: 8,
  rgba: [200, 40, 20, 255],
});

async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("U-2-Net background-removal Worker Adapter", () => {
  it("keeps resized masks single-channel and quality ratios bounded", async () => {
    const inputSize = 8;
    const mask = Uint8Array.from(
      { length: inputSize * inputSize },
      (_, index) => (index % 3 === 0 ? 255 : 0),
    );
    const rendered = await renderU2NetMask({
      mask,
      refinement: "standard",
      inputSize,
      width: 13,
      height: 7,
      signal: new AbortController().signal,
    });

    expect(rendered.pixels).toHaveLength(13 * 7);
    expect(rendered.foregroundRatio).toBeGreaterThanOrEqual(0);
    expect(rendered.foregroundRatio).toBeLessThanOrEqual(1);
    expect(rendered.uncertainEdgeRatio).toBeGreaterThanOrEqual(0);
    expect(rendered.uncertainEdgeRatio).toBeLessThanOrEqual(1);
  });

  it("reads the authorized source and emits adopted foreground and mask coordinates", async () => {
    let observedInputLength = 0;
    const adapter = createU2NetBackgroundRemoveAdapter({
      inference: {
        infer(input) {
          observedInputLength = input.length;
          const mask = new Float32Array(320 * 320);
          for (let y = 0; y < 320; y += 1) {
            for (let x = 0; x < 320; x += 1) {
              mask[y * 320 + x] =
                x >= 80 && x < 240 && y >= 80 && y < 240 ? 1 : 0;
            }
          }
          return Promise.resolve(mask);
        },
      },
      model: {
        variant: "u2net",
        sha256: "a".repeat(64),
        inputSize: 320,
        normalization: "imagenet",
      },
    });
    const result = (await adapter.execute(
      {
        sourceArtifactId,
        refinement: "fine",
        subjectHint: "red square",
      },
      new AbortController().signal,
      {
        workspaceId: "01K00000000000000000000002",
        workflowRunId: "01K00000000000000000000003",
        nodeRunId: "01K00000000000000000000004",
        capabilityRunId: "01K00000000000000000000005",
        attemptId: "01K00000000000000000000006",
        inputArtifacts: {
          open(request) {
            expect(request.inputPointer).toBe("/sourceArtifactId");
            return Promise.resolve({
              artifactId: sourceArtifactId,
              storedObjectId: "01K00000000000000000000007",
              artifactType: "image",
              dataClassification: "internal",
              byteSize: String(source.byteLength),
              sha256:
                "161bd7070d539e072554ca6c24ba2ad406507d46bef3c2b2b7d19316dd5961f7",
              mediaType: "image/png",
              body: (async function* () {
                await Promise.resolve();
                yield source;
              })(),
            });
          },
        },
      },
    )) as {
      readonly capabilityOutput: {
        readonly foregroundArtifactId: unknown;
        readonly maskArtifactId: unknown;
        readonly qualitySignals: {
          readonly modelDigest: string;
        };
      };
      readonly outputs: readonly {
        readonly outputRole: string;
        readonly mediaType: string;
        readonly body: AsyncIterable<Uint8Array>;
      }[];
    };

    expect(observedInputLength).toBe(3 * 320 * 320);
    expect(result.capabilityOutput).toMatchObject({
      foregroundArtifactId: {
        $kanvas: "attempt-output-artifact/v1",
        outputRole: "foreground",
        outputIndex: 0,
      },
      maskArtifactId: {
        $kanvas: "attempt-output-artifact/v1",
        outputRole: "mask",
        outputIndex: 0,
      },
      qualitySignals: {
        modelDigest: `sha256:${"a".repeat(64)}`,
      },
    });
    expect(result.outputs.map((output) => output.outputRole)).toEqual([
      "foreground",
      "mask",
    ]);
    for (const output of result.outputs) {
      expect(output.mediaType).toBe("image/png");
      expect((await collect(output.body)).subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  });

  it("emits a lossless WebP foreground from the versioned v2 Adapter", async () => {
    const adapter = createU2NetBackgroundRemoveAdapter({
      adapterKey: u2netBackgroundRemoveWebpAdapterKey,
      foregroundEncoding: "webp_lossless",
      inference: {
        infer() {
          return Promise.resolve(
            Float32Array.from({ length: 320 * 320 }, (_, index) =>
              index % 2 === 0 ? 1 : 0,
            ),
          );
        },
      },
      model: {
        variant: "u2net",
        sha256: "a".repeat(64),
        inputSize: 320,
        normalization: "imagenet",
      },
    });
    const result = (await adapter.execute(
      { sourceArtifactId, refinement: "standard" },
      new AbortController().signal,
      {
        workspaceId: "01K00000000000000000000002",
        workflowRunId: "01K00000000000000000000003",
        nodeRunId: "01K00000000000000000000004",
        capabilityRunId: "01K00000000000000000000005",
        attemptId: "01K00000000000000000000006",
        inputArtifacts: {
          open() {
            return Promise.resolve({
              artifactId: sourceArtifactId,
              storedObjectId: "01K00000000000000000000007",
              artifactType: "image",
              dataClassification: "internal",
              byteSize: String(source.byteLength),
              sha256:
                "161bd7070d539e072554ca6c24ba2ad406507d46bef3c2b2b7d19316dd5961f7",
              mediaType: "image/png",
              body: (async function* () {
                await Promise.resolve();
                yield source;
              })(),
            });
          },
        },
      },
    )) as {
      readonly outputs: readonly {
        readonly outputRole: string;
        readonly mediaType: string;
        readonly body: AsyncIterable<Uint8Array>;
      }[];
    };
    const foreground = result.outputs.find(
      (output) => output.outputRole === "foreground",
    );

    expect(foreground?.mediaType).toBe("image/webp");
    if (!foreground) throw new Error("Missing WebP foreground output.");
    const bytes = await collect(foreground.body);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("rejects inputs outside the versioned contract", async () => {
    const adapter = createU2NetBackgroundRemoveAdapter({
      inference: {
        infer() {
          throw new Error("must not infer");
        },
      },
      model: {
        variant: "u2netp",
        sha256: "b".repeat(64),
        inputSize: 320,
        normalization: "imagenet",
      },
    });
    await expect(
      adapter.execute(
        {
          sourceArtifactId,
          refinement: "unknown",
        },
        new AbortController().signal,
        {
          workspaceId: sourceArtifactId,
          workflowRunId: sourceArtifactId,
          nodeRunId: sourceArtifactId,
          capabilityRunId: sourceArtifactId,
          attemptId: sourceArtifactId,
          inputArtifacts: {
            open() {
              throw new Error("must not open");
            },
          },
        },
      ),
    ).rejects.toThrow(/does not match/u);
  });
});
