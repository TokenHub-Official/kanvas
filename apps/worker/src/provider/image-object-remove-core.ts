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
const maximumPixels = 16_777_216;

export interface ObjectRemoveInput {
  readonly sourceArtifactId: string;
  readonly maskArtifactId?: string;
  readonly regions?: readonly {
    readonly points: readonly {
      readonly x: number;
      readonly y: number;
    }[];
  }[];
  readonly guidance?: string;
}

export interface PreparedObjectRemove {
  readonly sourceArtifact: WorkerInputArtifactRead;
  readonly normalizedSource: Buffer;
  readonly canonicalRemovedMask: Buffer;
  readonly providerEditMask: Buffer;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly removedPixelRatio: number;
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

export function parseObjectRemoveInput(value: unknown): ObjectRemoveInput {
  if (
    !plainRecord(value) ||
    Object.keys(value).some(
      (key) =>
        !["sourceArtifactId", "maskArtifactId", "regions", "guidance"].includes(
          key,
        ) &&
        !derivedImageEditParameterKeys.includes(
          key as (typeof derivedImageEditParameterKeys)[number],
        ),
    ) ||
    typeof value.sourceArtifactId !== "string" ||
    !artifactIdPattern.test(value.sourceArtifactId) ||
    (value.maskArtifactId !== undefined &&
      (typeof value.maskArtifactId !== "string" ||
        !artifactIdPattern.test(value.maskArtifactId) ||
        value.sourceArtifactId === value.maskArtifactId)) ||
    (value.maskArtifactId === undefined) === (value.regions === undefined) ||
    (value.guidance !== undefined &&
      (typeof value.guidance !== "string" ||
        value.guidance.trim().length < 1 ||
        value.guidance.length > 4_000))
  ) {
    return contract(
      "Object remove input does not match kanvas.image-object-remove-input/v1.",
    );
  }
  let regions: ObjectRemoveInput["regions"];
  if (value.regions !== undefined) {
    if (
      !Array.isArray(value.regions) ||
      value.regions.length < 1 ||
      value.regions.length > 128
    ) {
      return contract("Object remove Regions are invalid.");
    }
    regions = Object.freeze(
      value.regions.map((region) => {
        if (
          !plainRecord(region) ||
          Object.keys(region).some((key) => key !== "points") ||
          !Array.isArray(region.points) ||
          region.points.length < 3 ||
          region.points.length > 64
        ) {
          return contract("Object remove Region polygon is invalid.");
        }
        return Object.freeze({
          points: Object.freeze(
            region.points.map((point) => {
              if (
                !plainRecord(point) ||
                Object.keys(point).some((key) => key !== "x" && key !== "y") ||
                typeof point.x !== "number" ||
                !Number.isFinite(point.x) ||
                point.x < 0 ||
                point.x > 16_384 ||
                typeof point.y !== "number" ||
                !Number.isFinite(point.y) ||
                point.y < 0 ||
                point.y > 16_384
              ) {
                return contract("Object remove Region point is invalid.");
              }
              return Object.freeze({
                x: point.x,
                y: point.y,
              });
            }),
          ),
        });
      }),
    );
  }
  return Object.freeze({
    sourceArtifactId: value.sourceArtifactId,
    ...(typeof value.maskArtifactId === "string"
      ? { maskArtifactId: value.maskArtifactId }
      : {}),
    ...(regions ? { regions } : {}),
    ...(typeof value.guidance === "string"
      ? { guidance: value.guidance.trim() }
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
    contract("Object remove requires an authorized Provider invocation.");
  }
}

export async function readObjectRemoveBytes(
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
      return contract("Object remove image exceeded its bounded read limit.");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

export function objectRemovePrompt(
  request: ProviderInvocationRequest,
  input: ObjectRemoveInput,
): string {
  return configuredPrompt(request, {
    guidance: input.guidance ?? "",
    guidanceBlock: input.guidance
      ? `\nRemoval guidance: ${input.guidance}`
      : "",
  });
}

export async function prepareObjectRemove(
  request: ProviderInvocationRequest,
  input: ObjectRemoveInput,
  signal: AbortSignal,
): Promise<PreparedObjectRemove> {
  authorized(request);
  const sourceArtifact = await request.inputArtifacts.open({
    inputPointer: "/sourceArtifactId",
  });
  const maskArtifact = input.maskArtifactId
    ? await request.inputArtifacts.open({
        inputPointer: "/maskArtifactId",
      })
    : undefined;
  const sourceBytes = await readObjectRemoveBytes(sourceArtifact.body, signal);
  const maskBytes = maskArtifact
    ? await readObjectRemoveBytes(maskArtifact.body, signal)
    : undefined;
  let normalizedSource: Buffer | undefined;
  let canonicalRemovedMask: Buffer | undefined;
  let providerEditMask: Buffer | undefined;
  try {
    const normalized = await sharp(sourceBytes, {
      failOn: "warning",
      limitInputPixels: maximumPixels,
    })
      .rotate()
      .ensureAlpha()
      .png()
      .toBuffer({ resolveWithObject: true });
    normalizedSource = normalized.data;
    const sourceWidth = normalized.info.width;
    const sourceHeight = normalized.info.height;
    if (sourceWidth * sourceHeight > maximumPixels) {
      return contract("Object remove source dimensions exceed the limit.");
    }
    let regionMaskSvg: Buffer | undefined;
    if (input.regions) {
      for (const region of input.regions) {
        if (
          region.points.some(
            (point) => point.x > sourceWidth || point.y > sourceHeight,
          )
        ) {
          return contract(
            "Object remove Region lies outside the normalized source.",
          );
        }
      }
      const polygons = input.regions
        .map(
          (region) =>
            `<polygon points="${region.points
              .map((point) => `${String(point.x)},${String(point.y)}`)
              .join(" ")}" fill="white"/>`,
        )
        .join("");
      regionMaskSvg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${String(
          sourceWidth,
        )}" height="${String(
          sourceHeight,
        )}" viewBox="0 0 ${String(sourceWidth)} ${String(
          sourceHeight,
        )}"><rect width="100%" height="100%" fill="black"/>${polygons}</svg>`,
        "utf8",
      );
    }
    const mask = await sharp(maskBytes ?? regionMaskSvg!, {
      failOn: "warning",
      limitInputPixels: maximumPixels,
    })
      .rotate()
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    regionMaskSvg?.fill(0);
    if (
      mask.info.width !== sourceWidth ||
      mask.info.height !== sourceHeight ||
      mask.info.channels !== 1
    ) {
      mask.data.fill(0);
      return contract(
        "Object remove Mask dimensions must exactly match the normalized source.",
      );
    }
    let removedPixels = 0;
    for (let index = 0; index < mask.data.length; index += 1) {
      signal.throwIfAborted();
      const removed = mask.data[index]! >= 128;
      mask.data[index] = removed ? 255 : 0;
      if (removed) {
        removedPixels += 1;
      }
    }
    if (removedPixels === 0 || removedPixels === sourceWidth * sourceHeight) {
      mask.data.fill(0);
      return contract(
        "Object remove Mask must select a non-empty proper subset of the source.",
      );
    }
    const removedPixelRatio = Number(
      (removedPixels / (sourceWidth * sourceHeight)).toFixed(6),
    );
    canonicalRemovedMask = await sharp(mask.data, {
      raw: {
        width: sourceWidth,
        height: sourceHeight,
        channels: 1,
      },
    })
      .png()
      .toBuffer();
    const editMaskRgba = Buffer.allocUnsafe(sourceWidth * sourceHeight * 4);
    for (let index = 0; index < mask.data.length; index += 1) {
      const offset = index * 4;
      editMaskRgba[offset] = 255;
      editMaskRgba[offset + 1] = 255;
      editMaskRgba[offset + 2] = 255;
      editMaskRgba[offset + 3] = mask.data[index] === 255 ? 0 : 255;
    }
    try {
      providerEditMask = await sharp(editMaskRgba, {
        raw: {
          width: sourceWidth,
          height: sourceHeight,
          channels: 4,
        },
      })
        .png()
        .toBuffer();
    } finally {
      editMaskRgba.fill(0);
      mask.data.fill(0);
    }
    const ownedNormalizedSource = normalizedSource;
    const ownedCanonicalMask = canonicalRemovedMask;
    const ownedProviderEditMask = providerEditMask;
    const prepared = Object.freeze({
      sourceArtifact,
      normalizedSource: ownedNormalizedSource,
      canonicalRemovedMask: ownedCanonicalMask,
      providerEditMask: ownedProviderEditMask,
      sourceWidth,
      sourceHeight,
      removedPixelRatio,
      dispose(): void {
        ownedNormalizedSource.fill(0);
        ownedCanonicalMask.fill(0);
        ownedProviderEditMask.fill(0);
      },
    });
    normalizedSource = undefined;
    canonicalRemovedMask = undefined;
    providerEditMask = undefined;
    return prepared;
  } finally {
    sourceBytes.fill(0);
    maskBytes?.fill(0);
    normalizedSource?.fill(0);
    canonicalRemovedMask?.fill(0);
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

export function objectRemoveArtifactAccess(
  prepared: PreparedObjectRemove,
): WorkerInputArtifactAccess {
  return Object.freeze({
    open: ({ inputPointer }: OpenWorkerInputArtifactRequest) => {
      if (inputPointer === "/sourceArtifactId") {
        return Promise.resolve(
          bufferedArtifact(
            prepared.sourceArtifact,
            "image.object-remove-prepared",
            prepared.normalizedSource,
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
          "Object remove synthetic Artifact pointer is invalid.",
        ),
      );
    },
  });
}

function outputReference(outputRole: "repaired" | "removed_region_mask") {
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

export async function mapObjectRemoveObservation(
  observation: ProviderObservation,
  input: ObjectRemoveInput,
  prepared: PreparedObjectRemove,
  signal: AbortSignal,
): Promise<ProviderObservation> {
  if (observation.status !== "succeeded") {
    return observation;
  }
  const providerOutput = observation.outputs?.[0];
  if (observation.outputs?.length !== 1 || !providerOutput) {
    return contract("Object remove Provider output is incomplete.");
  }
  const generatedBytes = await readObjectRemoveBytes(
    providerOutput.body,
    signal,
  );
  let sourceRaw: Buffer | undefined;
  let resultRaw: Buffer | undefined;
  let maskRaw: Buffer | undefined;
  let repairedRaw: Buffer | undefined;
  try {
    const [source, result, mask] = await Promise.all([
      sharp(prepared.normalizedSource)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      sharp(generatedBytes)
        .rotate()
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      sharp(prepared.canonicalRemovedMask)
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true }),
    ]);
    sourceRaw = source.data;
    resultRaw = result.data;
    maskRaw = mask.data;
    if (
      result.info.width !== prepared.sourceWidth ||
      result.info.height !== prepared.sourceHeight ||
      result.info.channels !== 4
    ) {
      return contract(
        "Object remove Provider output dimensions do not match the source.",
      );
    }
    repairedRaw = Buffer.allocUnsafe(sourceRaw.length);
    for (
      let pixel = 0, offset = 0;
      pixel < maskRaw.length;
      pixel += 1, offset += 4
    ) {
      signal.throwIfAborted();
      const useGenerated = maskRaw[pixel] === 255;
      for (let channel = 0; channel < 4; channel += 1) {
        repairedRaw[offset + channel] = useGenerated
          ? resultRaw[offset + channel]!
          : sourceRaw[offset + channel]!;
      }
    }
    const repairedBytes = await sharp(repairedRaw, {
      raw: {
        width: prepared.sourceWidth,
        height: prepared.sourceHeight,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
    const maskBytes = Buffer.from(prepared.canonicalRemovedMask);
    const repairedOutput = imageOutput({
      outputRole: "repaired",
      artifactType: "image.object-removed",
      bytes: repairedBytes,
      metadata: Object.freeze({
        ...providerOutput.metadata,
        operation: "image.object.remove",
        sourceArtifactId: input.sourceArtifactId,
        ...(input.maskArtifactId
          ? { inputMaskArtifactId: input.maskArtifactId }
          : { inputRegionCount: input.regions?.length ?? 0 }),
        removedPixelRatio: prepared.removedPixelRatio,
        outsideMaskPixelsPreserved: true,
        composedFrom: Object.freeze([
          input.sourceArtifactId,
          ...(input.maskArtifactId ? [input.maskArtifactId] : []),
        ]),
      }),
    });
    const maskOutput = imageOutput({
      outputRole: "removed_region_mask",
      artifactType: "image.removed-region-mask",
      bytes: maskBytes,
      metadata: Object.freeze({
        operation: "image.object.remove",
        sourceArtifactId: input.sourceArtifactId,
        ...(input.maskArtifactId
          ? { inputMaskArtifactId: input.maskArtifactId }
          : { inputRegionCount: input.regions?.length ?? 0 }),
        removedPixelRatio: prepared.removedPixelRatio,
        maskSemantics: "white_removed_black_preserved",
      }),
    });
    return Object.freeze({
      ...observation,
      observationKey: `${observation.observationKey}:${createHash("sha256")
        .update(repairedBytes)
        .update(maskBytes)
        .digest("hex")}`,
      output: Object.freeze({
        schemaVersion: "kanvas.image-object-remove-result/v1",
        repairedArtifactId: outputReference("repaired"),
        removedRegionMaskArtifactId: outputReference("removed_region_mask"),
        qualitySignals: Object.freeze({
          schemaVersion: "kanvas.image-object-remove-quality/v1",
          method: "generative_inpaint",
          generative: true,
          outsideMaskPixelsPreserved: true,
          removedPixelRatio: prepared.removedPixelRatio,
        }),
      }),
      outputs: Object.freeze([repairedOutput, maskOutput]),
    });
  } finally {
    generatedBytes.fill(0);
    sourceRaw?.fill(0);
    resultRaw?.fill(0);
    maskRaw?.fill(0);
    repairedRaw?.fill(0);
  }
}
