import type {
  ClaimBrowserAttemptResponse,
  CompleteBrowserAttemptBody,
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
  detectBrowserSubjects,
  parseBrowserBackgroundRemoveInput,
  parseBrowserSubjectDetectInput,
} from "./u2net-browser-background-remove.js";
import { createBrowserU2NetBackgroundRemover } from "./u2net-browser-background-remove-worker-client.js";
import type { BrowserBackgroundRemoveRuntimeConfig } from "./browser-background-remove-runtime-config.js";

type BrowserCapabilityDeclaration =
  RegisterBrowserExecutorBody["capabilities"][number];
type ClaimedBrowserAttempt = NonNullable<
  ClaimBrowserAttemptResponse["assignment"]
>;

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
      .sort(([left], [right]) => {
        if (left < right) {
          return -1;
        }
        return left > right ? 1 : 0;
      })
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new TypeError("Browser capability manifest contains a non-JSON value.");
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const result = await crypto.subtle.digest("SHA-256", bytes);
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
  configuration: BrowserBackgroundRemoveRuntimeConfig,
): Promise<RegisterBrowserExecutorBody> {
  const capabilities: BrowserCapabilityDeclaration[] =
    configuration.capabilities.map((capability) =>
      Object.freeze({
        implementationRevisionId: capability.implementationRevisionId,
        implementationDigest: capability.implementationDigest,
        adapterKey: capability.adapterKey,
        backend: capability.backend,
        probeProfileVersion: capability.probeProfileVersion,
        probeResultDigest: capability.probeResultDigest,
      }),
    );
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

function outputReference(outputRole: string, outputIndex: number) {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1" as const,
    outputRole,
    outputIndex,
  });
}

async function executeAssignment(options: {
  readonly assignment: ClaimedBrowserAttempt;
  readonly configuration: BrowserBackgroundRemoveRuntimeConfig;
  readonly rootSignal: AbortSignal;
  readonly remover: ReturnType<typeof createBrowserU2NetBackgroundRemover>;
}): Promise<void> {
  const { assignment, configuration } = options;
  const capabilityRelease = configuration.capabilities.find(
    (capability) => capability.adapterKey === assignment.adapterKey,
  );
  if (
    !capabilityRelease ||
    assignment.implementationRevisionId !==
      capabilityRelease.implementationRevisionId ||
    assignment.implementationDigest !==
      capabilityRelease.implementationDigest ||
    assignment.backend !== "wasm"
  ) {
    throw new Error(
      "Claimed Browser Attempt does not match a pinned image-analysis release.",
    );
  }
  const backgroundRemove =
    capabilityRelease.runtimeRole === "background_remove";
  const backgroundRemoveInput = backgroundRemove
    ? parseBrowserBackgroundRemoveInput(assignment.input)
    : undefined;
  const subjectDetectInput = !backgroundRemove
    ? parseBrowserSubjectDetectInput(assignment.input)
    : undefined;
  const sourceArtifactId =
    backgroundRemoveInput?.sourceArtifactId ??
    subjectDetectInput?.sourceArtifactId;
  if (!sourceArtifactId) {
    throw new Error(
      "Claimed Browser image-analysis Attempt has no valid source Artifact.",
    );
  }
  const grant = attemptContext(assignment);
  const execution = new AbortController();
  const abortFromRoot = () => execution.abort(options.rootSignal.reason);
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
    const executionStartedAt = performance.now();
    const sourceDownloadStartedAt = performance.now();
    const source = await downloadArtifact(
      assignment.workspaceId,
      sourceArtifactId,
      fetch,
      execution.signal,
    );
    const sourceDownloadMilliseconds = Math.max(
      0,
      performance.now() - sourceDownloadStartedAt,
    );
    const modelExecutionStartedAt = performance.now();
    const result = await options.remover.execute(
      source,
      backgroundRemoveInput ?? {
        sourceArtifactId,
        refinement: "standard",
      },
      execution.signal,
    );
    const candidates = subjectDetectInput
      ? detectBrowserSubjects(result, subjectDetectInput, execution.signal)
      : undefined;
    const modelExecutionMilliseconds = Math.max(
      0,
      performance.now() - modelExecutionStartedAt,
    );
    let outputDefinitions: {
      readonly artifactType: string;
      readonly blob: Blob;
      readonly outputIndex: number;
      readonly outputRole: string;
    }[] = [];
    if (backgroundRemoveInput) {
      outputDefinitions = [
        {
          outputRole: "foreground",
          outputIndex: 0,
          artifactType: "image",
          blob: result.foreground,
        },
        {
          outputRole: "mask",
          outputIndex: 0,
          artifactType: "image",
          blob: result.mask,
        },
      ];
    } else if (subjectDetectInput?.includeMask) {
      outputDefinitions = [
        {
          outputRole: "mask",
          outputIndex: 0,
          artifactType: "image.mask",
          blob: result.mask,
        },
      ];
    }
    const uploaded = [];
    const outputUploadStartedAt = performance.now();
    for (const output of outputDefinitions) {
      execution.signal.throwIfAborted();
      const outputSha256 = await blobSha256(output.blob);
      const allocation = await allocateBrowserAttemptOutput(
        grant,
        {
          controlPlaneVersion: 1,
          attemptId: assignment.attemptId,
          leaseGeneration: assignment.leaseGeneration,
          executionGeneration: assignment.executionGeneration,
          outputRole: output.outputRole,
          outputIndex: output.outputIndex,
          expectedSize: String(output.blob.size),
          expectedMediaType: "image/png",
          expectedSha256: outputSha256,
        },
        `${assignment.attemptId}:${output.outputRole}:${String(output.outputIndex)}`,
        execution.signal,
      );
      await uploadBrowserAttemptOutput(
        grant,
        {
          attemptId: assignment.attemptId,
          leaseGeneration: assignment.leaseGeneration,
          executionGeneration: assignment.executionGeneration,
          outputRole: output.outputRole,
          outputIndex: output.outputIndex,
          uploadSessionId: allocation.uploadSessionId,
          blob: output.blob,
        },
        execution.signal,
      );
      uploaded.push({
        uploadSessionId: allocation.uploadSessionId,
        outputRole: output.outputRole,
        outputIndex: output.outputIndex,
        artifactType: output.artifactType,
        metadata: {
          operation: backgroundRemoveInput
            ? "image.background.remove"
            : "image.subject.detect",
          sourceArtifactId,
          modelVariant: configuration.modelVariant,
          modelDigest: configuration.modelDigest,
          ...(backgroundRemoveInput
            ? {
                refinement: backgroundRemoveInput.refinement,
              }
            : {
                taxonomy: "class_agnostic_isnet",
              }),
          width: result.width,
          height: result.height,
          executionTimings: {
            runtimeColdStart: result.runtimeColdStart,
            modelInitializationMilliseconds: Number(
              result.modelInitializationMilliseconds.toFixed(
                BROWSER_EXECUTION_DURATION_DECIMAL_PLACES,
              ),
            ),
            sourceDownloadMilliseconds: Number(
              sourceDownloadMilliseconds.toFixed(
                BROWSER_EXECUTION_DURATION_DECIMAL_PLACES,
              ),
            ),
            modelExecutionMilliseconds: Number(
              modelExecutionMilliseconds.toFixed(
                BROWSER_EXECUTION_DURATION_DECIMAL_PLACES,
              ),
            ),
            outputUploadMilliseconds: Number(
              Math.max(0, performance.now() - outputUploadStartedAt).toFixed(
                BROWSER_EXECUTION_DURATION_DECIMAL_PLACES,
              ),
            ),
          },
        },
      });
    }
    const elapsedMilliseconds = Math.max(
      0,
      performance.now() - executionStartedAt,
    ).toFixed(BROWSER_EXECUTION_DURATION_DECIMAL_PLACES);
    const completion: CompleteBrowserAttemptBody = {
      controlPlaneVersion: 1,
      attemptId: assignment.attemptId,
      capabilityRunId: assignment.capabilityRunId,
      leaseGeneration: assignment.leaseGeneration,
      executionGeneration: assignment.executionGeneration,
      implementationRevisionId: assignment.implementationRevisionId,
      implementationDigest: assignment.implementationDigest,
      adapterKey: assignment.adapterKey,
      capabilityOutput: backgroundRemoveInput
        ? {
            schemaVersion: "kanvas.image-background-remove-result/v1",
            foregroundArtifactId: outputReference("foreground", 0),
            maskArtifactId: outputReference("mask", 0),
            qualitySignals: {
              schemaVersion: "kanvas.image-background-remove-quality/v1",
              foregroundRatio: result.foregroundRatio,
              uncertainEdgeRatio: result.uncertainEdgeRatio,
              modelVariant: configuration.modelVariant,
              modelDigest: configuration.modelDigest,
              refinement: backgroundRemoveInput.refinement,
            },
          }
        : {
            schemaVersion: "kanvas.image-subject-detect-result/v1",
            sourceWidth: result.width,
            sourceHeight: result.height,
            candidates: candidates ?? [],
            maskArtifactId:
              subjectDetectInput?.includeMask === true
                ? outputReference("mask", 0)
                : null,
            qualitySignals: {
              schemaVersion: "kanvas.image-subject-detect-quality/v1",
              candidateCount: candidates?.length ?? 0,
              foregroundRatio: result.foregroundRatio,
              uncertainEdgeRatio: result.uncertainEdgeRatio,
              taxonomy: "class_agnostic_isnet",
              modelVariant: configuration.modelVariant,
              modelDigest: configuration.modelDigest,
            },
          },
      outputs: uploaded,
      initialUsage: [
        {
          entryKey: `${
            backgroundRemoveInput
              ? "image.background.remove"
              : "image.subject.detect"
          }.browser.wall_time`,
          metricKey: "compute.wall_time",
          valueDimension: "quantity",
          unitCode: "millisecond",
          entryKind: "observation",
          numericValue: elapsedMilliseconds,
          evidenceDigest: await digest({
            schemaVersion: backgroundRemoveInput
              ? "kanvas.image-background-remove-browser-usage/v1"
              : "kanvas.image-subject-detect-browser-usage/v1",
            attemptId: assignment.attemptId,
            metricKey: "compute.wall_time",
            unitCode: "millisecond",
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

export type BrowserBackgroundRemoveRuntime = BrowserExecutorRuntime;

export function startBrowserBackgroundRemoveRuntime(options: {
  readonly configuration: BrowserBackgroundRemoveRuntimeConfig;
  readonly context: WorkspaceApiContext;
  readonly onError?: (error: unknown) => void;
  readonly onReady?: () => void;
}): BrowserBackgroundRemoveRuntime {
  const remover = createBrowserU2NetBackgroundRemover({
    modelUrl: options.configuration.modelUrl,
    ...(options.configuration.modelWorkspaceId
      ? { modelWorkspaceId: options.configuration.modelWorkspaceId }
      : {}),
    modelDigest: options.configuration.modelDigest,
    inputSize: options.configuration.inputSize,
    modelVariant: options.configuration.modelVariant,
    normalization: options.configuration.normalization,
    wasmPaths: options.configuration.wasmPaths,
  });
  const runtime = startBrowserExecutorRuntime({
    context: options.context,
    runtimeLabel: "Browser background-removal runtime",
    ...(options.onError
      ? {
          onError: options.onError,
        }
      : {}),
    ...(options.onReady ? { onReady: options.onReady } : {}),
    featureProbe() {
      if (
        typeof Worker === "undefined" ||
        typeof OffscreenCanvas === "undefined" ||
        typeof createImageBitmap !== "function" ||
        !crypto.subtle
      ) {
        throw new Error(
          "Browser background-removal runtime requires Worker, OffscreenCanvas, ImageBitmap and Web Crypto support.",
        );
      }
    },
    registrationBody: () => registrationBody(options.configuration),
    executeAssignment: (assignment, rootSignal) =>
      executeAssignment({
        assignment,
        configuration: options.configuration,
        remover,
        rootSignal,
      }),
  });
  return Object.freeze({
    done: runtime.done,
    stop() {
      runtime.stop();
      remover.dispose();
    },
  });
}
