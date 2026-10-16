import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  ProviderAdapterContractError,
  type AuthorizedProviderInvocationRequest,
  type ProviderImageOutput,
  type ProviderInvocationRequest,
  type ProviderObservation,
} from "./provider-adapter.js";
import { configuredPrompt } from "./image-implementation-configuration.js";
import { derivedImageEditParameterKeys } from "./derived-image-edit-parameters.js";
import type {
  OpenWorkerInputArtifactRequest,
  WorkerInputArtifactAccess,
  WorkerInputArtifactRead,
} from "../storage/worker-input-artifact-resolver.js";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const maximumImageBytes = 52_428_800;
const allowedTargets = new Set(["1024x1024", "1536x1024", "1024x1536"]);

export interface CanvasExpandInput {
  readonly sourceArtifactId: string;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly sourcePlacement: {
    readonly x: number;
    readonly y: number;
  };
  readonly generatedRegion: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
  readonly prompt?: string;
}

export interface PreparedCanvasExpand {
  readonly sourceArtifact: WorkerInputArtifactRead;
  readonly normalizedSource: Buffer;
  readonly preparedCanvas: Buffer;
  readonly providerEditMask: Buffer;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  dispose(): void;
}

function contract(message: string): never {
  throw new ProviderAdapterContractError(message);
}

function plainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseCanvasExpandInput(value: unknown): CanvasExpandInput {
  if (
    !plainRecord(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "sourceArtifactId",
          "targetWidth",
          "targetHeight",
          "sourcePlacement",
          "generatedRegion",
          "prompt",
        ].includes(key) &&
        !derivedImageEditParameterKeys.includes(
          key as (typeof derivedImageEditParameterKeys)[number],
        ),
    ) ||
    typeof value.sourceArtifactId !== "string" ||
    !artifactIdPattern.test(value.sourceArtifactId) ||
    !nonNegativeInteger(value.targetWidth) ||
    !nonNegativeInteger(value.targetHeight) ||
    !allowedTargets.has(
      `${String(value.targetWidth)}x${String(value.targetHeight)}`,
    ) ||
    !plainRecord(value.sourcePlacement) ||
    Object.keys(value.sourcePlacement).some(
      (key) => key !== "x" && key !== "y",
    ) ||
    !nonNegativeInteger(value.sourcePlacement.x) ||
    !nonNegativeInteger(value.sourcePlacement.y) ||
    !plainRecord(value.generatedRegion) ||
    Object.keys(value.generatedRegion).some(
      (key) => !["left", "top", "right", "bottom"].includes(key),
    ) ||
    !nonNegativeInteger(value.generatedRegion.left) ||
    !nonNegativeInteger(value.generatedRegion.top) ||
    !nonNegativeInteger(value.generatedRegion.right) ||
    !nonNegativeInteger(value.generatedRegion.bottom) ||
    value.generatedRegion.left !== value.sourcePlacement.x ||
    value.generatedRegion.top !== value.sourcePlacement.y ||
    (value.prompt !== undefined &&
      (typeof value.prompt !== "string" ||
        value.prompt.trim().length < 1 ||
        value.prompt.length > 4_000))
  ) {
    return contract(
      "Canvas expand input does not match kanvas.image-canvas-expand-input/v1.",
    );
  }
  return Object.freeze({
    sourceArtifactId: value.sourceArtifactId,
    targetWidth: value.targetWidth,
    targetHeight: value.targetHeight,
    sourcePlacement: Object.freeze({
      x: value.sourcePlacement.x,
      y: value.sourcePlacement.y,
    }),
    generatedRegion: Object.freeze({
      left: value.generatedRegion.left,
      top: value.generatedRegion.top,
      right: value.generatedRegion.right,
      bottom: value.generatedRegion.bottom,
    }),
    ...(typeof value.prompt === "string"
      ? { prompt: value.prompt.trim() }
      : {}),
  });
}

function authorized(
  request: ProviderInvocationRequest,
): asserts request is AuthorizedProviderInvocationRequest & {
  readonly inputArtifacts: WorkerInputArtifactAccess;
} {
  const candidate = request as Partial<AuthorizedProviderInvocationRequest>;
  if (
    !candidate.executionContext ||
    !(candidate.credential instanceof Uint8Array) ||
    !candidate.inputArtifacts
  ) {
    contract("Canvas expand requires an authorized Provider invocation.");
  }
}

export async function readCanvasExpandBytes(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    signal.throwIfAborted();
    total += chunk.byteLength;
    if (total > maximumImageBytes) {
      for (const buffered of chunks) {
        buffered.fill(0);
      }
      return contract("Canvas expand image exceeded its bounded read limit.");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

export function canvasExpandPrompt(
  request: ProviderInvocationRequest,
  input: CanvasExpandInput,
): string {
  return configuredPrompt(request, {
    prompt: input.prompt ?? "",
    promptBlock: input.prompt
      ? `\nArt direction for the generated region: ${input.prompt}`
      : "",
    targetWidth: String(input.targetWidth),
    targetHeight: String(input.targetHeight),
  });
}

export async function prepareCanvasExpand(
  request: ProviderInvocationRequest,
  input: CanvasExpandInput,
  signal: AbortSignal,
): Promise<PreparedCanvasExpand> {
  authorized(request);
  const sourceArtifact = await request.inputArtifacts.open({
    inputPointer: "/sourceArtifactId",
  });
  const sourceBytes = await readCanvasExpandBytes(sourceArtifact.body, signal);
  let normalizedSource: Buffer | undefined;
  let preparedCanvas: Buffer | undefined;
  let providerEditMask: Buffer | undefined;
  try {
    const normalized = await sharp(sourceBytes)
      .rotate()
      .ensureAlpha()
      .png()
      .toBuffer({ resolveWithObject: true });
    normalizedSource = normalized.data;
    const sourceWidth = normalized.info.width;
    const sourceHeight = normalized.info.height;
    if (
      input.generatedRegion.left + sourceWidth + input.generatedRegion.right !==
        input.targetWidth ||
      input.generatedRegion.top +
        sourceHeight +
        input.generatedRegion.bottom !==
        input.targetHeight ||
      (input.generatedRegion.left === 0 &&
        input.generatedRegion.top === 0 &&
        input.generatedRegion.right === 0 &&
        input.generatedRegion.bottom === 0)
    ) {
      return contract(
        "Canvas expand target, source placement and generated region do not form one exact canvas.",
      );
    }
    preparedCanvas = await sharp({
      create: {
        width: input.targetWidth,
        height: input.targetHeight,
        channels: 4,
        background: {
          r: 0,
          g: 0,
          b: 0,
          alpha: 0,
        },
      },
    })
      .composite([
        {
          input: normalizedSource,
          left: input.sourcePlacement.x,
          top: input.sourcePlacement.y,
          blend: "source",
        },
      ])
      .png()
      .toBuffer();
    const opaqueSourceRegion = await sharp({
      create: {
        width: sourceWidth,
        height: sourceHeight,
        channels: 4,
        background: {
          r: 255,
          g: 255,
          b: 255,
          alpha: 1,
        },
      },
    })
      .png()
      .toBuffer();
    try {
      providerEditMask = await sharp({
        create: {
          width: input.targetWidth,
          height: input.targetHeight,
          channels: 4,
          background: {
            r: 0,
            g: 0,
            b: 0,
            alpha: 0,
          },
        },
      })
        .composite([
          {
            input: opaqueSourceRegion,
            left: input.sourcePlacement.x,
            top: input.sourcePlacement.y,
          },
        ])
        .png()
        .toBuffer();
    } finally {
      opaqueSourceRegion.fill(0);
    }
    const ownedNormalizedSource = normalizedSource;
    const ownedPreparedCanvas = preparedCanvas;
    const ownedProviderEditMask = providerEditMask;
    const prepared = Object.freeze({
      sourceArtifact,
      normalizedSource: ownedNormalizedSource,
      preparedCanvas: ownedPreparedCanvas,
      providerEditMask: ownedProviderEditMask,
      sourceWidth,
      sourceHeight,
      dispose(): void {
        ownedNormalizedSource.fill(0);
        ownedPreparedCanvas.fill(0);
        ownedProviderEditMask.fill(0);
      },
    });
    normalizedSource = undefined;
    preparedCanvas = undefined;
    providerEditMask = undefined;
    return prepared;
  } finally {
    sourceBytes.fill(0);
    normalizedSource?.fill(0);
    preparedCanvas?.fill(0);
    providerEditMask?.fill(0);
  }
}

function bufferedArtifact(
  source: WorkerInputArtifactRead,
  artifactType: string,
  bytes: Buffer,
): WorkerInputArtifactRead {
  return Object.freeze({
    ...source,
    artifactType,
    mediaType: "image/png",
    byteSize: String(bytes.byteLength),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    body: (async function* () {
      await Promise.resolve();
      yield bytes;
    })(),
  });
}

export function canvasExpandArtifactAccess(
  prepared: PreparedCanvasExpand,
): WorkerInputArtifactAccess {
  return Object.freeze({
    open: ({ inputPointer }: OpenWorkerInputArtifactRequest) => {
      if (inputPointer === "/sourceArtifactId") {
        return Promise.resolve(
          bufferedArtifact(
            prepared.sourceArtifact,
            "image.expand-prepared",
            prepared.preparedCanvas,
          ),
        );
      }
      if (inputPointer === "/maskArtifactId") {
        return Promise.resolve(
          bufferedArtifact(
            prepared.sourceArtifact,
            "image.mask",
            prepared.providerEditMask,
          ),
        );
      }
      return Promise.reject(
        new ProviderAdapterContractError(
          "Canvas expand synthetic Artifact pointer is invalid.",
        ),
      );
    },
  });
}

function outputReference(outputRole: "expanded" | "generated_region_mask") {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1" as const,
    outputRole,
    outputIndex: 0,
  });
}

function imageOutput(options: {
  readonly artifactType: string;
  readonly bytes: Buffer;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly outputRole: string;
}): ProviderImageOutput {
  return Object.freeze({
    outputRole: options.outputRole,
    outputIndex: 0,
    artifactType: options.artifactType,
    metadata: options.metadata,
    mediaType: "image/png",
    byteSize: String(options.bytes.byteLength),
    sha256: createHash("sha256").update(options.bytes).digest("hex"),
    body: (async function* () {
      try {
        await Promise.resolve();
        yield options.bytes;
      } finally {
        options.bytes.fill(0);
      }
    })(),
  });
}

export async function mapCanvasExpandObservation(
  observation: ProviderObservation,
  input: CanvasExpandInput,
  prepared: PreparedCanvasExpand,
  signal: AbortSignal,
): Promise<ProviderObservation> {
  if (observation.status !== "succeeded") {
    return observation;
  }
  const providerOutput = observation.outputs?.[0];
  if (
    observation.outputs?.length !== 1 ||
    !providerOutput ||
    providerOutput.mediaType !== "image/png"
  ) {
    return contract("Canvas expand Provider output is incomplete.");
  }
  const generatedBytes = await readCanvasExpandBytes(
    providerOutput.body,
    signal,
  );
  try {
    const generatedMetadata = await sharp(generatedBytes).metadata();
    if (
      generatedMetadata.width !== input.targetWidth ||
      generatedMetadata.height !== input.targetHeight
    ) {
      return contract(
        "Canvas expand Provider output dimensions do not match the target canvas.",
      );
    }
    const expandedBytes = await sharp(generatedBytes)
      .composite([
        {
          input: prepared.normalizedSource,
          left: input.sourcePlacement.x,
          top: input.sourcePlacement.y,
          blend: "source",
        },
      ])
      .png()
      .toBuffer();
    const preservedRegion = await sharp({
      create: {
        width: prepared.sourceWidth,
        height: prepared.sourceHeight,
        channels: 3,
        background: {
          r: 0,
          g: 0,
          b: 0,
        },
      },
    })
      .png()
      .toBuffer();
    let generatedRegionMask: Buffer;
    try {
      generatedRegionMask = await sharp({
        create: {
          width: input.targetWidth,
          height: input.targetHeight,
          channels: 3,
          background: {
            r: 255,
            g: 255,
            b: 255,
          },
        },
      })
        .composite([
          {
            input: preservedRegion,
            left: input.sourcePlacement.x,
            top: input.sourcePlacement.y,
          },
        ])
        .png()
        .toBuffer();
    } finally {
      preservedRegion.fill(0);
    }
    const sourcePlacement = Object.freeze({
      x: input.sourcePlacement.x,
      y: input.sourcePlacement.y,
      width: prepared.sourceWidth,
      height: prepared.sourceHeight,
    });
    const expandedOutput = imageOutput({
      outputRole: "expanded",
      artifactType: "image.expanded",
      bytes: expandedBytes,
      metadata: Object.freeze({
        ...providerOutput.metadata,
        operation: "image.canvas.expand",
        sourceArtifactId: input.sourceArtifactId,
        sourcePlacement,
        generatedRegion: input.generatedRegion,
        originalPixelsPreserved: true,
        composedFrom: Object.freeze([input.sourceArtifactId]),
      }),
    });
    const maskOutput = imageOutput({
      outputRole: "generated_region_mask",
      artifactType: "image.generated-region-mask",
      bytes: generatedRegionMask,
      metadata: Object.freeze({
        operation: "image.canvas.expand",
        sourceArtifactId: input.sourceArtifactId,
        sourcePlacement,
        generatedRegion: input.generatedRegion,
        maskSemantics: "white_generated_black_preserved",
      }),
    });
    return Object.freeze({
      ...observation,
      observationKey: `${observation.observationKey}:${createHash("sha256")
        .update(expandedBytes)
        .update(generatedRegionMask)
        .digest("hex")}`,
      output: Object.freeze({
        schemaVersion: "kanvas.image-canvas-expand-result/v1",
        expandedArtifactId: outputReference("expanded"),
        generatedRegionMaskArtifactId: outputReference("generated_region_mask"),
        targetWidth: input.targetWidth,
        targetHeight: input.targetHeight,
        sourcePlacement,
        generatedRegion: input.generatedRegion,
        qualitySignals: Object.freeze({
          schemaVersion: "kanvas.image-canvas-expand-quality/v1",
          method: "generative_outpaint",
          generative: true,
          originalPixelsPreserved: true,
        }),
      }),
      outputs: Object.freeze([expandedOutput, maskOutput]),
    });
  } finally {
    generatedBytes.fill(0);
  }
}
