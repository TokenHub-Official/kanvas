import type {
  BrowserRuntimeCapability,
  BrowserRuntimeManifest,
  ClaimBrowserAttemptResponse,
  CompleteBrowserAttemptBody,
  RegisterBrowserExecutorBody,
} from "@kanvas/contracts/api";
import {
  parseBackgroundComposeInput,
  parseCropSuggestInput,
  parsePaletteExtractInput,
  parseQualityAssessInput,
  type BackgroundComposeInput,
  type CropSuggestInput,
  type PaletteExtractInput,
  type PixelBounds,
  type QualityAssessInput,
} from "@kanvas/image-atomic-core";

import {
  downloadArtifact,
  type WorkspaceApiContext,
} from "../../api/transport.js";
import {
  acknowledgeBrowserAttemptCancellation,
  allocateBrowserAttemptOutput,
  completeBrowserAttempt,
  heartbeatBrowserAttempt,
  uploadBrowserAttemptOutput,
  type BrowserAttemptGrantContext,
} from "./browser-executor-transport.js";
import {
  runBrowserBatchCOperation,
  type BrowserRgbaImage,
} from "./browser-batch-c-worker-client.js";
import {
  startBrowserExecutorRuntime,
  type BrowserExecutorRuntime,
} from "./browser-executor-runtime.js";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
type ClaimedBrowserAttempt = NonNullable<
  ClaimBrowserAttemptResponse["assignment"]
>;
type BrowserBatchCRuntimeRole =
  "crop_suggest" | "palette_extract" | "quality_assess" | "background_compose";

export interface BrowserBatchCRuntimeConfig {
  readonly runtimeReleaseId: string;
  readonly runtimeReleaseDigest: string;
  readonly capabilities: readonly BrowserRuntimeCapability[];
}

const browserBatchCRuntimeRoles = new Set<BrowserBatchCRuntimeRole>([
  "crop_suggest",
  "palette_extract",
  "quality_assess",
  "background_compose",
]);

function isBrowserBatchCRuntimeRole(
  value: string,
): value is BrowserBatchCRuntimeRole {
  return browserBatchCRuntimeRoles.has(value as BrowserBatchCRuntimeRole);
}

export function browserBatchCRuntimeConfig(
  manifest: BrowserRuntimeManifest,
  requiredCapabilityKeys?: readonly string[],
): BrowserBatchCRuntimeConfig | undefined {
  const capabilities = manifest.capabilities.filter(
    (capability) =>
      capability.runtimeProfileKind === "browser.image-analysis.v1" &&
      (requiredCapabilityKeys === undefined ||
        requiredCapabilityKeys.includes(capability.capabilityKey)),
  );
  if (capabilities.length === 0) return undefined;
  if (
    capabilities.some(
      (capability) =>
        capability.backend !== "javascript" ||
        capability.runtimeProfileVersion !== 1 ||
        !isBrowserBatchCRuntimeRole(capability.runtimeRole) ||
        !digestPattern.test(capability.probeResultDigest),
    ) ||
    new Set(capabilities.map((capability) => capability.runtimeRole)).size !==
      capabilities.length
  ) {
    throw new Error("Browser image-analysis manifest is invalid.");
  }
  return Object.freeze({
    runtimeReleaseId: manifest.runtimeReleaseId,
    runtimeReleaseDigest: manifest.runtimeReleaseDigest,
    capabilities: Object.freeze(capabilities),
  });
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new TypeError("Browser Batch C evidence contains non-JSON data.");
}

async function digest(value: unknown): Promise<string> {
  const result = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return `sha256:${[...new Uint8Array(result)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function blobSha256(value: Blob): Promise<string> {
  const result = await crypto.subtle.digest(
    "SHA-256",
    await value.arrayBuffer(),
  );
  return [...new Uint8Array(result)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

async function registrationBody(
  configuration: BrowserBatchCRuntimeConfig,
): Promise<RegisterBrowserExecutorBody> {
  await browserBatchCProbeDigests();
  const capabilities = configuration.capabilities.map((capability) => ({
    implementationRevisionId: capability.implementationRevisionId,
    implementationDigest: capability.implementationDigest,
    adapterKey: capability.adapterKey,
    backend: capability.backend,
    probeProfileVersion: capability.probeProfileVersion,
    probeResultDigest: capability.probeResultDigest,
  }));
  const manifest = {
    capabilityManifestVersion: 1,
    capabilities,
  };
  return {
    controlPlaneVersion: 1,
    runtimeReleaseId: configuration.runtimeReleaseId,
    runtimeReleaseDigest: configuration.runtimeReleaseDigest,
    ...manifest,
    capabilityManifestDigest: await digest(manifest),
  };
}

function probeImage(
  pixels: readonly number[],
  width: number,
  height: number,
): BrowserRgbaImage {
  return Object.freeze({
    data: Uint8ClampedArray.from(pixels),
    width,
    height,
  });
}

export async function browserBatchCProbeDigests() {
  const artifactId = "01K00000000000000000000000";
  const sourcePixels = [
    20, 20, 20, 255, 20, 20, 20, 255, 220, 30, 30, 255, 220, 30, 30, 255, 20,
    20, 20, 255, 20, 20, 20, 255, 220, 30, 30, 255, 220, 30, 30, 255,
  ];
  const crop = await runBrowserBatchCOperation<unknown>(
    {
      operation: "crop_suggest",
      image: probeImage(sourcePixels, 4, 2),
      input: parseCropSuggestInput({
        sourceArtifactId: artifactId,
        aspectRatios: ["1:1", "16:9"],
        maxSuggestionsPerRatio: 2,
        subjectBounds: [
          {
            x: 2,
            y: 0,
            width: 2,
            height: 2,
          },
        ],
      }),
    },
    new AbortController().signal,
  );
  const palette = await runBrowserBatchCOperation<unknown>(
    {
      operation: "palette_extract",
      image: probeImage(sourcePixels, 4, 2),
      input: parsePaletteExtractInput({
        sourceArtifactId: artifactId,
        colorCount: 3,
        alphaThreshold: 16,
        sampleSize: 32,
      }),
    },
    new AbortController().signal,
  );
  const quality = await runBrowserBatchCOperation<unknown>(
    {
      operation: "quality_assess",
      image: probeImage(sourcePixels, 4, 2),
      input: parseQualityAssessInput({
        sourceArtifactId: artifactId,
        subjectBounds: [
          {
            x: 2,
            y: 0,
            width: 2,
            height: 2,
          },
        ],
        sampleSize: 64,
      }),
    },
    new AbortController().signal,
  );
  const compose = await runBrowserBatchCOperation<{
    readonly image: {
      readonly data: ArrayBuffer;
      readonly height: number;
      readonly width: number;
    };
    readonly mask: {
      readonly data: ArrayBuffer;
      readonly height: number;
      readonly width: number;
    };
    readonly resolvedPlacement: PixelBounds;
  }>(
    {
      operation: "background_compose",
      foreground: probeImage([255, 0, 0, 255], 1, 1),
      input: parseBackgroundComposeInput({
        foregroundArtifactId: artifactId,
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
      }),
    },
    new AbortController().signal,
  );
  return Object.freeze({
    cropSuggest: await digest({
      schemaVersion: "kanvas.browser-batch-c-probe/v1",
      operation: "image.crop.suggest",
      result: crop,
    }),
    paletteExtract: await digest({
      schemaVersion: "kanvas.browser-batch-c-probe/v1",
      operation: "image.palette.extract",
      result: palette,
    }),
    qualityAssess: await digest({
      schemaVersion: "kanvas.browser-batch-c-probe/v1",
      operation: "image.quality.assess",
      result: quality,
    }),
    backgroundCompose: await digest({
      schemaVersion: "kanvas.browser-batch-c-probe/v1",
      operation: "image.background.compose",
      result: {
        image: {
          width: compose.image.width,
          height: compose.image.height,
          data: [...new Uint8Array(compose.image.data)],
        },
        mask: {
          width: compose.mask.width,
          height: compose.mask.height,
          data: [...new Uint8Array(compose.mask.data)],
        },
        resolvedPlacement: compose.resolvedPlacement,
      },
    }),
  });
}

function admittedImplementation(
  configuration: BrowserBatchCRuntimeConfig,
  assignment: ClaimedBrowserAttempt,
): BrowserRuntimeCapability {
  const release = configuration.capabilities.find(
    (candidate) => candidate.adapterKey === assignment.adapterKey,
  );
  if (
    !release ||
    assignment.implementationRevisionId !== release.implementationRevisionId ||
    assignment.implementationDigest !== release.implementationDigest ||
    assignment.backend !== "javascript"
  ) {
    throw new Error(
      "Claimed Browser Attempt does not match the admitted Batch C release.",
    );
  }
  return release;
}

function attemptContext(
  assignment: ClaimedBrowserAttempt,
): BrowserAttemptGrantContext {
  return Object.freeze({
    assignmentId: assignment.assignmentId,
    attemptGrant: assignment.attemptGrant,
    sessionId: assignment.sessionId,
    workspaceId: assignment.workspaceId,
  });
}

function heartbeatBody(assignment: ClaimedBrowserAttempt) {
  return Object.freeze({
    controlPlaneVersion: 1 as const,
    attemptId: assignment.attemptId,
    leaseGeneration: assignment.leaseGeneration,
    executionGeneration: assignment.executionGeneration,
  });
}

async function decodeSource(source: Blob): Promise<BrowserRgbaImage> {
  if (source.size > 64 * 1024 * 1024) {
    throw new RangeError("Browser Batch C source exceeds the byte limit.");
  }
  const bitmap = await createImageBitmap(source, {
    imageOrientation: "from-image",
  });
  try {
    if (
      bitmap.width * bitmap.height > 32_000_000 ||
      bitmap.width < 1 ||
      bitmap.height < 1
    ) {
      throw new RangeError("Browser Batch C source exceeds the pixel limit.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    });
    if (!context) {
      throw new Error("Browser Batch C Canvas 2D is unavailable.");
    }
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const owned = new Uint8ClampedArray(pixels.length);
    owned.set(pixels);
    return Object.freeze({
      data: owned,
      width: bitmap.width,
      height: bitmap.height,
    });
  } finally {
    bitmap.close();
  }
}

function encodePng(image: {
  readonly data: ArrayBuffer;
  readonly height: number;
  readonly width: number;
}): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", {
    alpha: true,
  });
  if (!context) {
    return Promise.reject(
      new Error("Browser Batch C PNG Canvas 2D is unavailable."),
    );
  }
  context.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Browser Batch C PNG encoding failed."));
      }
    }, "image/png");
  });
}

function outputReference(outputRole: string) {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1" as const,
    outputRole,
    outputIndex: 0,
  });
}

async function materializeOutput(options: {
  readonly assignment: ClaimedBrowserAttempt;
  readonly artifactType: string;
  readonly blob: Blob;
  readonly grant: BrowserAttemptGrantContext;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly outputRole: string;
  readonly signal: AbortSignal;
}) {
  const sha256 = await blobSha256(options.blob);
  const allocation = await allocateBrowserAttemptOutput(
    options.grant,
    {
      controlPlaneVersion: 1,
      attemptId: options.assignment.attemptId,
      leaseGeneration: options.assignment.leaseGeneration,
      executionGeneration: options.assignment.executionGeneration,
      outputRole: options.outputRole,
      outputIndex: 0,
      expectedSize: String(options.blob.size),
      expectedMediaType: "image/png",
      expectedSha256: sha256,
    },
    `${options.assignment.attemptId}:${options.outputRole}:0`,
    options.signal,
  );
  await uploadBrowserAttemptOutput(
    options.grant,
    {
      attemptId: options.assignment.attemptId,
      leaseGeneration: options.assignment.leaseGeneration,
      executionGeneration: options.assignment.executionGeneration,
      outputRole: options.outputRole,
      outputIndex: 0,
      uploadSessionId: allocation.uploadSessionId,
      blob: options.blob,
    },
    options.signal,
  );
  return Object.freeze({
    uploadSessionId: allocation.uploadSessionId,
    outputRole: options.outputRole,
    outputIndex: 0,
    artifactType: options.artifactType,
    metadata: options.metadata,
  });
}

async function analysisExecution(options: {
  readonly assignment: ClaimedBrowserAttempt;
  readonly runtimeRole: Exclude<BrowserBatchCRuntimeRole, "background_compose">;
  readonly signal: AbortSignal;
}) {
  const { assignment } = options;
  const sourceArtifactId = (
    assignment.input as Readonly<Record<string, unknown>>
  ).sourceArtifactId;
  if (typeof sourceArtifactId !== "string") {
    throw new TypeError("Browser Batch C analysis has no source Artifact.");
  }
  const source = await decodeSource(
    await downloadArtifact(
      assignment.workspaceId,
      sourceArtifactId,
      fetch,
      options.signal,
    ),
  );
  if (options.runtimeRole === "crop_suggest") {
    const input: CropSuggestInput = parseCropSuggestInput(assignment.input);
    const suggestions = await runBrowserBatchCOperation<
      readonly Readonly<Record<string, unknown>>[]
    >(
      {
        operation: "crop_suggest",
        image: source,
        input,
      },
      options.signal,
    );
    return {
      operation: "image.crop.suggest",
      outputs: [],
      capabilityOutput: {
        schemaVersion: "kanvas.image-crop-suggest-result/v1",
        sourceWidth: source.width,
        sourceHeight: source.height,
        suggestions,
        qualitySignals: {
          schemaVersion: "kanvas.image-crop-suggest-quality/v1",
          generative: false,
          sourceModified: false,
          saliencyMethod: "alpha_luminance_projection",
          subjectBoundsProvided: input.subjectBounds.length > 0,
        },
      },
    };
  }
  if (options.runtimeRole === "palette_extract") {
    const input: PaletteExtractInput = parsePaletteExtractInput(
      assignment.input,
    );
    const result = await runBrowserBatchCOperation<{
      readonly colors: readonly unknown[];
      readonly sampledPixelCount: number;
      readonly transparentRatio: number;
    }>(
      {
        operation: "palette_extract",
        image: source,
        input,
      },
      options.signal,
    );
    return {
      operation: "image.palette.extract",
      outputs: [],
      capabilityOutput: {
        schemaVersion: "kanvas.image-palette-extract-result/v1",
        sourceWidth: source.width,
        sourceHeight: source.height,
        colorSpace: "srgb",
        colors: result.colors,
        transparentRatio: result.transparentRatio,
        qualitySignals: {
          schemaVersion: "kanvas.image-palette-extract-quality/v1",
          generative: false,
          sourceModified: false,
          deterministic: true,
          quantizationBits: 5,
          sampledPixelCount: result.sampledPixelCount,
        },
      },
    };
  }
  const input: QualityAssessInput = parseQualityAssessInput(assignment.input);
  const result = await runBrowserBatchCOperation<
    Readonly<Record<string, unknown>>
  >(
    {
      operation: "quality_assess",
      image: source,
      input,
    },
    options.signal,
  );
  return {
    operation: "image.quality.assess",
    outputs: [],
    capabilityOutput: {
      schemaVersion: "kanvas.image-quality-assess-result/v1",
      sourceWidth: source.width,
      sourceHeight: source.height,
      ...result,
      qualitySignals: {
        schemaVersion: "kanvas.image-quality-assess-quality/v1",
        generative: false,
        sourceModified: false,
        method: "deterministic_pixel_diagnostics",
        subjectBoundsProvided: input.subjectBounds.length > 0,
      },
    },
  };
}

async function composeExecution(options: {
  readonly assignment: ClaimedBrowserAttempt;
  readonly grant: BrowserAttemptGrantContext;
  readonly signal: AbortSignal;
}) {
  const input: BackgroundComposeInput = parseBackgroundComposeInput(
    options.assignment.input,
  );
  const [foreground, mask, background] = await Promise.all([
    downloadArtifact(
      options.assignment.workspaceId,
      input.foregroundArtifactId,
      fetch,
      options.signal,
    ).then(decodeSource),
    input.maskArtifactId
      ? downloadArtifact(
          options.assignment.workspaceId,
          input.maskArtifactId,
          fetch,
          options.signal,
        ).then(decodeSource)
      : undefined,
    input.background.kind === "artifact"
      ? downloadArtifact(
          options.assignment.workspaceId,
          input.background.artifactId,
          fetch,
          options.signal,
        ).then(decodeSource)
      : undefined,
  ]);
  const result = await runBrowserBatchCOperation<{
    readonly image: {
      readonly data: ArrayBuffer;
      readonly height: number;
      readonly width: number;
    };
    readonly mask: {
      readonly data: ArrayBuffer;
      readonly height: number;
      readonly width: number;
    };
    readonly resolvedPlacement: PixelBounds;
  }>(
    {
      operation: "background_compose",
      input,
      foreground,
      ...(mask ? { mask } : {}),
      ...(background ? { background } : {}),
    },
    options.signal,
  );
  const [imageBlob, maskBlob] = await Promise.all([
    encodePng(result.image),
    encodePng(result.mask),
  ]);
  const inputArtifactIds = Object.freeze([
    input.foregroundArtifactId,
    ...(input.maskArtifactId ? [input.maskArtifactId] : []),
    ...(input.background.kind === "artifact"
      ? [input.background.artifactId]
      : []),
  ]);
  const metadata = Object.freeze({
    operation: "image.background.compose",
    inputArtifactIds,
    canvas: input.canvas,
    requestedPlacement: input.placement,
    resolvedPlacement: result.resolvedPlacement,
    background: input.background,
    generative: false,
    deterministic: true,
    colorSpace: "srgb",
    backend: "javascript",
  });
  const [composedOutput, maskOutput] = await Promise.all([
    materializeOutput({
      assignment: options.assignment,
      grant: options.grant,
      signal: options.signal,
      outputRole: "composed",
      artifactType: "image.background-composed",
      blob: imageBlob,
      metadata,
    }),
    materializeOutput({
      assignment: options.assignment,
      grant: options.grant,
      signal: options.signal,
      outputRole: "composition_mask",
      artifactType: "image.composition-mask",
      blob: maskBlob,
      metadata: Object.freeze({
        ...metadata,
        maskConvention: "white_foreground_black_background",
      }),
    }),
  ]);
  return {
    operation: "image.background.compose",
    capabilityOutput: {
      schemaVersion: "kanvas.image-background-compose-result/v1",
      imageArtifactId: outputReference("composed"),
      compositionMaskArtifactId: outputReference("composition_mask"),
      canvas: input.canvas,
      resolvedPlacement: result.resolvedPlacement,
      inputArtifactIds,
      qualitySignals: {
        schemaVersion: "kanvas.image-background-compose-quality/v1",
        generative: false,
        deterministic: true,
        alphaComposited: true,
        colorSpace: "srgb",
      },
    },
    outputs: [composedOutput, maskOutput],
  };
}

async function executeAssignment(options: {
  readonly assignment: ClaimedBrowserAttempt;
  readonly configuration: BrowserBatchCRuntimeConfig;
  readonly rootSignal: AbortSignal;
}): Promise<void> {
  const { assignment } = options;
  const release = admittedImplementation(options.configuration, assignment);
  const runtimeRole = release.runtimeRole as BrowserBatchCRuntimeRole;
  const grant = attemptContext(assignment);
  const execution = new AbortController();
  const abortFromRoot = (): void => execution.abort(options.rootSignal.reason);
  options.rootSignal.addEventListener("abort", abortFromRoot, { once: true });
  let cancellationRequested = false;
  const heartbeat = window.setInterval(() => {
    void heartbeatBrowserAttempt(grant, heartbeatBody(assignment))
      .then((result) => {
        if (
          result.result === "cancel_requested" ||
          result.result === "revoked" ||
          result.result === "rejected"
        ) {
          cancellationRequested = result.result === "cancel_requested";
          execution.abort(
            new DOMException(`Browser Attempt ${result.result}.`, "AbortError"),
          );
        }
      })
      .catch(() => {
        execution.abort(
          new DOMException("Browser Attempt heartbeat failed.", "AbortError"),
        );
      });
  }, 10_000);
  try {
    const startedAt = performance.now();
    const result =
      runtimeRole === "background_compose"
        ? await composeExecution({
            assignment,
            grant,
            signal: execution.signal,
          })
        : await analysisExecution({
            assignment,
            runtimeRole,
            signal: execution.signal,
          });
    const elapsedMilliseconds = Math.max(
      0,
      performance.now() - startedAt,
    ).toFixed(3);
    const completion: CompleteBrowserAttemptBody = {
      controlPlaneVersion: 1,
      attemptId: assignment.attemptId,
      capabilityRunId: assignment.capabilityRunId,
      leaseGeneration: assignment.leaseGeneration,
      executionGeneration: assignment.executionGeneration,
      implementationRevisionId: assignment.implementationRevisionId,
      implementationDigest: assignment.implementationDigest,
      adapterKey: assignment.adapterKey,
      capabilityOutput: result.capabilityOutput,
      outputs: result.outputs ?? [],
      initialUsage: [
        {
          entryKey: `${result.operation}.browser.wall_time`,
          metricKey: "compute.wall_time",
          valueDimension: "quantity",
          unitCode: "millisecond",
          entryKind: "observation",
          numericValue: elapsedMilliseconds,
          evidenceDigest: await digest({
            schemaVersion: "kanvas.browser-batch-c-usage/v1",
            attemptId: assignment.attemptId,
            operation: result.operation,
            numericValue: elapsedMilliseconds,
          }),
          observedAt: new Date().toISOString(),
        },
      ],
    };
    await completeBrowserAttempt(grant, completion, execution.signal);
  } catch (error) {
    if (cancellationRequested) {
      await acknowledgeBrowserAttemptCancellation(grant, {
        controlPlaneVersion: 1,
        attemptId: assignment.attemptId,
        capabilityRunId: assignment.capabilityRunId,
        leaseGeneration: assignment.leaseGeneration,
        executionGeneration: assignment.executionGeneration,
      });
      return;
    }
    throw error;
  } finally {
    window.clearInterval(heartbeat);
    options.rootSignal.removeEventListener("abort", abortFromRoot);
  }
}

export function startBrowserBatchCRuntime(options: {
  readonly configuration: BrowserBatchCRuntimeConfig;
  readonly context: WorkspaceApiContext;
  readonly onError?: (error: unknown) => void;
  readonly onReady?: () => void;
}): BrowserExecutorRuntime {
  return startBrowserExecutorRuntime({
    context: options.context,
    runtimeLabel: "Browser Batch C runtime",
    ...(options.onError
      ? {
          onError: options.onError,
        }
      : {}),
    ...(options.onReady ? { onReady: options.onReady } : {}),
    featureProbe() {
      if (
        typeof Worker === "undefined" ||
        typeof createImageBitmap !== "function" ||
        typeof ImageData === "undefined" ||
        !crypto.subtle
      ) {
        throw new Error(
          "Browser Batch C runtime requires Worker, ImageBitmap, ImageData, Canvas 2D and Web Crypto.",
        );
      }
    },
    registrationBody: () => registrationBody(options.configuration),
    executeAssignment: (assignment, rootSignal) =>
      executeAssignment({
        assignment,
        configuration: options.configuration,
        rootSignal,
      }),
  });
}
