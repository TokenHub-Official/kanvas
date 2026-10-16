import type {
  ClaimBrowserAttemptResponse,
  CompleteBrowserAttemptBody,
  BrowserRuntimeCapability,
  BrowserRuntimeManifest,
  RegisterBrowserExecutorBody,
} from "@kanvas/contracts/api";

import {
  downloadArtifact,
  type WorkspaceApiContext,
} from "../../api/transport.js";
import {
  BROWSER_ATTEMPT_HEARTBEAT_INTERVAL_MS,
  BROWSER_EXECUTION_DURATION_DECIMAL_PLACES,
  SHA256_BYTE_HEX_LENGTH,
  SHA256_HEX_RADIX,
} from "./browser-executor-constants.js";
import {
  acknowledgeBrowserAttemptCancellation,
  allocateBrowserAttemptOutput,
  completeBrowserAttempt,
  heartbeatBrowserAttempt,
  uploadBrowserAttemptOutput,
  type BrowserAttemptGrantContext,
} from "./browser-executor-transport.js";
import {
  startBrowserExecutorRuntime,
  type BrowserExecutorRuntime,
} from "./browser-executor-runtime.js";
import {
  parseBrowserDenoiseInput,
  parseBrowserLightEnhanceInput,
} from "./browser-image-adjustments.js";
import { runBrowserImageAdjustment } from "./browser-image-adjustments-worker-client.js";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
type ClaimedBrowserAttempt = NonNullable<
  ClaimBrowserAttemptResponse["assignment"]
>;

export interface BrowserImageAdjustmentRuntimeConfig {
  readonly runtimeReleaseId: string;
  readonly runtimeReleaseDigest: string;
  readonly capabilities: readonly BrowserRuntimeCapability[];
}

export function browserImageAdjustmentRuntimeConfig(
  manifest: BrowserRuntimeManifest,
  requiredCapabilityKeys?: readonly string[],
): BrowserImageAdjustmentRuntimeConfig | undefined {
  const capabilities = manifest.capabilities.filter(
    (capability) =>
      capability.runtimeProfileKind === "browser.image-adjustment.v1" &&
      (requiredCapabilityKeys === undefined ||
        requiredCapabilityKeys.includes(capability.capabilityKey)),
  );
  if (capabilities.length === 0) return undefined;
  if (
    capabilities.some(
      (capability) =>
        capability.backend !== "javascript" ||
        capability.runtimeProfileVersion !== 1 ||
        !["image_denoise", "light_enhance"].includes(capability.runtimeRole) ||
        !digestPattern.test(capability.probeResultDigest),
    ) ||
    new Set(capabilities.map((capability) => capability.runtimeRole)).size !==
      capabilities.length
  ) {
    throw new Error("Browser image-adjustment manifest is invalid.");
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
  throw new TypeError(
    "Browser image-adjustment manifest contains a non-JSON value.",
  );
}

async function digest(value: unknown): Promise<string> {
  const result = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return `sha256:${[...new Uint8Array(result)]
    .map((part) =>
      part.toString(SHA256_HEX_RADIX).padStart(SHA256_BYTE_HEX_LENGTH, "0"),
    )
    .join("")}`;
}

async function blobSha256(value: Blob): Promise<string> {
  const result = await crypto.subtle.digest(
    "SHA-256",
    await value.arrayBuffer(),
  );
  return [...new Uint8Array(result)]
    .map((part) =>
      part.toString(SHA256_HEX_RADIX).padStart(SHA256_BYTE_HEX_LENGTH, "0"),
    )
    .join("");
}

async function registrationBody(
  configuration: BrowserImageAdjustmentRuntimeConfig,
): Promise<RegisterBrowserExecutorBody> {
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

function outputReference(outputRole: string) {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1" as const,
    outputRole,
    outputIndex: 0,
  });
}

async function decodeSource(source: Blob): Promise<{
  readonly canvas: HTMLCanvasElement;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
}> {
  const bitmap = await createImageBitmap(source, {
    imageOrientation: "from-image",
  });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    });
    if (!context) {
      throw new Error("Browser image-adjustment Canvas 2D is unavailable.");
    }
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return Object.freeze({
      canvas,
      width: bitmap.width,
      height: bitmap.height,
      pixels: image.data,
    });
  } finally {
    bitmap.close();
  }
}

function encodePng(
  canvas: HTMLCanvasElement,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Blob> {
  const context = canvas.getContext("2d", {
    alpha: true,
  });
  if (!context) {
    return Promise.reject(
      new Error("Browser image-adjustment Canvas 2D is unavailable."),
    );
  }
  const imagePixels = new Uint8ClampedArray(pixels.length);
  imagePixels.set(pixels);
  context.putImageData(new ImageData(imagePixels, width, height), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Browser image-adjustment PNG encoding failed."));
      }
    }, "image/png");
  });
}

async function executeAssignment(options: {
  readonly assignment: ClaimedBrowserAttempt;
  readonly configuration: BrowserImageAdjustmentRuntimeConfig;
  readonly rootSignal: AbortSignal;
}): Promise<void> {
  const { assignment } = options;
  const release = options.configuration.capabilities.find(
    (capability) => capability.adapterKey === assignment.adapterKey,
  );
  if (
    !release ||
    assignment.implementationRevisionId !== release.implementationRevisionId ||
    assignment.implementationDigest !== release.implementationDigest ||
    assignment.backend !== "javascript"
  ) {
    throw new Error(
      "Claimed Browser Attempt does not match the admitted image-adjustment release.",
    );
  }
  const denoise = release.runtimeRole === "image_denoise";
  const denoiseInput = denoise
    ? parseBrowserDenoiseInput(assignment.input)
    : undefined;
  const lightInput = denoise
    ? undefined
    : parseBrowserLightEnhanceInput(assignment.input);
  const sourceArtifactId =
    denoiseInput?.sourceArtifactId ?? lightInput?.sourceArtifactId;
  if (!sourceArtifactId) {
    throw new Error("Browser image-adjustment Attempt has no source Artifact.");
  }
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
  }, BROWSER_ATTEMPT_HEARTBEAT_INTERVAL_MS);
  try {
    const startedAt = performance.now();
    const source = await downloadArtifact(
      assignment.workspaceId,
      sourceArtifactId,
      fetch,
      execution.signal,
    );
    const decoded = await decodeSource(source);
    const adjusted = await runBrowserImageAdjustment({
      adjustment: denoiseInput
        ? {
            operation: "denoise",
            input: denoiseInput,
          }
        : {
            operation: "light_enhance",
            input: lightInput!,
          },
      pixels: decoded.pixels,
      width: decoded.width,
      height: decoded.height,
      signal: execution.signal,
    });
    const outputBlob = await encodePng(
      decoded.canvas,
      adjusted.pixels,
      decoded.width,
      decoded.height,
    );
    execution.signal.throwIfAborted();
    const outputRole = denoise ? "denoised" : "enhanced";
    const outputSha256 = await blobSha256(outputBlob);
    const allocation = await allocateBrowserAttemptOutput(
      grant,
      {
        controlPlaneVersion: 1,
        attemptId: assignment.attemptId,
        leaseGeneration: assignment.leaseGeneration,
        executionGeneration: assignment.executionGeneration,
        outputRole,
        outputIndex: 0,
        expectedSize: String(outputBlob.size),
        expectedMediaType: "image/png",
        expectedSha256: outputSha256,
      },
      `${assignment.attemptId}:${outputRole}:0`,
      execution.signal,
    );
    await uploadBrowserAttemptOutput(
      grant,
      {
        attemptId: assignment.attemptId,
        leaseGeneration: assignment.leaseGeneration,
        executionGeneration: assignment.executionGeneration,
        outputRole,
        outputIndex: 0,
        uploadSessionId: allocation.uploadSessionId,
        blob: outputBlob,
      },
      execution.signal,
    );
    const parameters = lightInput
      ? Object.freeze({
          exposureStops: lightInput.exposureStops,
          shadows: lightInput.shadows,
          highlights: lightInput.highlights,
          temperature: lightInput.temperature,
          tint: lightInput.tint,
        })
      : undefined;
    const capabilityOutput = denoiseInput
      ? {
          schemaVersion: "kanvas.image-denoise-result/v1",
          imageArtifactId: outputReference(outputRole),
          noiseEstimate: adjusted.noiseEstimate ?? 0,
          method: "median_blend",
          strength: denoiseInput.strength,
          qualitySignals: {
            schemaVersion: "kanvas.image-denoise-quality/v1",
            qualityIntent: "faithful",
            generative: false,
            alphaPreserved: true,
            kernelSize: 3,
          },
        }
      : {
          schemaVersion: "kanvas.image-light-enhance-result/v1",
          imageArtifactId: outputReference(outputRole),
          parameters: parameters!,
          qualitySignals: {
            schemaVersion: "kanvas.image-light-enhance-quality/v1",
            method: "deterministic_tone_curve",
            generative: false,
            alphaPreserved: true,
            clippedLowRatio: adjusted.clippedLowRatio ?? 0,
            clippedHighRatio: adjusted.clippedHighRatio ?? 0,
          },
        };
    const elapsedMilliseconds = Math.max(
      0,
      performance.now() - startedAt,
    ).toFixed(BROWSER_EXECUTION_DURATION_DECIMAL_PLACES);
    const operation = denoise ? "image.denoise" : "image.light.enhance";
    const completion: CompleteBrowserAttemptBody = {
      controlPlaneVersion: 1,
      attemptId: assignment.attemptId,
      capabilityRunId: assignment.capabilityRunId,
      leaseGeneration: assignment.leaseGeneration,
      executionGeneration: assignment.executionGeneration,
      implementationRevisionId: assignment.implementationRevisionId,
      implementationDigest: assignment.implementationDigest,
      adapterKey: assignment.adapterKey,
      capabilityOutput,
      outputs: [
        {
          uploadSessionId: allocation.uploadSessionId,
          outputRole,
          outputIndex: 0,
          artifactType: denoise ? "image.denoised" : "image.light-enhanced",
          metadata: {
            operation,
            sourceArtifactId,
            backend: "javascript",
            generative: false,
            alphaPreserved: true,
            ...(denoiseInput
              ? {
                  method: "median_blend",
                  strength: denoiseInput.strength,
                  noiseEstimate: adjusted.noiseEstimate ?? 0,
                }
              : {
                  method: "deterministic_tone_curve",
                  parameters,
                }),
          },
        },
      ],
      initialUsage: [
        {
          entryKey: `${operation}.browser.wall_time`,
          metricKey: "compute.wall_time",
          valueDimension: "quantity",
          unitCode: "millisecond",
          entryKind: "observation",
          numericValue: elapsedMilliseconds,
          evidenceDigest: await digest({
            schemaVersion: "kanvas.browser-image-adjustment-usage/v1",
            attemptId: assignment.attemptId,
            operation,
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

export function startBrowserImageAdjustmentRuntime(options: {
  readonly configuration: BrowserImageAdjustmentRuntimeConfig;
  readonly context: WorkspaceApiContext;
  readonly onError?: (error: unknown) => void;
  readonly onReady?: () => void;
}): BrowserExecutorRuntime {
  return startBrowserExecutorRuntime({
    context: options.context,
    runtimeLabel: "Browser image-adjustment runtime",
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
          "Browser image-adjustment runtime requires Worker, ImageBitmap, ImageData, Canvas 2D and Web Crypto.",
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
