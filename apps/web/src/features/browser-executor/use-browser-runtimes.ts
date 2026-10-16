import { useEffect, useRef, useState } from "react";

import { ApiProblem } from "../../api/transport.js";
import { browserBackgroundRemoveRuntimeConfigFromManifest } from "./browser-background-remove-runtime-config.js";
import {
  browserBatchCRuntimeConfig,
  startBrowserBatchCRuntime,
} from "./browser-batch-c-runtime.js";
import { fetchBrowserRuntimeManifest } from "./browser-executor-transport.js";
import {
  browserImageAdjustmentRuntimeConfig,
  startBrowserImageAdjustmentRuntime,
} from "./browser-image-adjustment-runtime.js";
import { BrowserExecutorStartupError } from "./browser-executor-runtime.js";

export interface BrowserRuntimeControl {
  readonly done: Promise<unknown>;
  stop(): void;
}

export type BrowserRuntimeConnectionState =
  "connecting" | "ready" | "reconnecting" | "unavailable";

export type BrowserRuntimeFailureStage =
  "manifest" | "probe" | "register" | "runtime";

export interface BrowserRuntimeFailure {
  readonly stage: BrowserRuntimeFailureStage;
  readonly httpStatus?: number;
  readonly code?: string;
}

export function browserRuntimeFailure(
  stage: BrowserRuntimeFailureStage,
  error: unknown,
): BrowserRuntimeFailure {
  let source = error;
  let resolvedStage = stage;
  if (error instanceof BrowserExecutorStartupError) {
    resolvedStage = error.stage;
    source = error.cause;
  }
  return Object.freeze({
    stage: resolvedStage,
    ...(source instanceof ApiProblem
      ? { httpStatus: source.status, code: source.code }
      : {}),
  });
}

export function trackBrowserRuntime(
  runtime: BrowserRuntimeControl,
  disposed: boolean,
  runtimes: Set<BrowserRuntimeControl>,
  onFailure: (error: unknown) => void = () => undefined,
): void {
  void runtime.done.catch(onFailure);
  if (disposed) {
    runtime.stop();
    return;
  }
  runtimes.add(runtime);
}

export function browserRuntimeCoversCapabilities(
  requiredCapabilityKeys: readonly string[] | undefined,
  supportedCapabilityKeys: readonly string[],
): boolean {
  if (requiredCapabilityKeys === undefined) return true;
  const supported = new Set(supportedCapabilityKeys);
  return requiredCapabilityKeys.every((key) => supported.has(key));
}

export function useBrowserRuntimes({
  csrfToken,
  enabled,
  onFailure,
  requiredCapabilityKeys,
  restartKey = 0,
  workspaceId,
}: {
  readonly csrfToken: string;
  readonly enabled: boolean;
  readonly onFailure?: (failure: BrowserRuntimeFailure) => void;
  readonly requiredCapabilityKeys?: readonly string[];
  readonly restartKey?: number;
  readonly workspaceId: string;
}): BrowserRuntimeConnectionState {
  const [state, setState] =
    useState<BrowserRuntimeConnectionState>("connecting");
  const onFailureRef = useRef(onFailure);
  useEffect(() => {
    onFailureRef.current = onFailure;
  }, [onFailure]);
  useEffect(() => {
    if (!enabled) return;
    setState("connecting");
    let disposed = false;
    const admission = new AbortController();
    const runtimes = new Set<BrowserRuntimeControl>();
    const context = { csrfToken, workspaceId };
    let requiredCoverageComplete = requiredCapabilityKeys === undefined;
    const reportFailure = (
      stage: BrowserRuntimeFailureStage,
      error?: unknown,
      fallbackCode?: string,
    ): void => {
      const classified = browserRuntimeFailure(stage, error);
      const failure =
        fallbackCode && !classified.code
          ? Object.freeze({ ...classified, code: fallbackCode })
          : classified;
      onFailureRef.current?.(failure);
      if (import.meta.env.DEV) {
        console.warn(
          "[Kanvas browser runtime] connection failure",
          JSON.stringify(failure),
        );
      }
    };
    const onReady = () => {
      if (!disposed) {
        setState(requiredCoverageComplete ? "ready" : "unavailable");
      }
    };
    const onError = (error: unknown) => {
      if (!disposed) {
        setState(requiredCoverageComplete ? "reconnecting" : "unavailable");
        reportFailure("runtime", error);
      }
    };
    const track = (runtime: BrowserRuntimeControl) => {
      trackBrowserRuntime(runtime, disposed, runtimes, (error) => {
        if (!disposed) {
          setState("unavailable");
          reportFailure("runtime", error);
        }
      });
    };

    void fetchBrowserRuntimeManifest(context, admission.signal)
      .then(async (manifest) => {
        let configured = 0;
        let imageAdjustmentConfiguration:
          ReturnType<typeof browserImageAdjustmentRuntimeConfig> | undefined;
        let batchConfiguration:
          ReturnType<typeof browserBatchCRuntimeConfig> | undefined;
        let backgroundRemoveConfiguration:
          | ReturnType<typeof browserBackgroundRemoveRuntimeConfigFromManifest>
          | undefined;
        try {
          imageAdjustmentConfiguration = browserImageAdjustmentRuntimeConfig(
            manifest,
            requiredCapabilityKeys,
          );
        } catch (error) {
          // Unsupported or invalid manifest entries remain unavailable.
          reportFailure("manifest", error, "runtime_configuration_invalid");
        }
        try {
          batchConfiguration = browserBatchCRuntimeConfig(
            manifest,
            requiredCapabilityKeys,
          );
        } catch (error) {
          // Unsupported or invalid manifest entries remain unavailable.
          reportFailure("manifest", error, "runtime_configuration_invalid");
        }
        try {
          backgroundRemoveConfiguration =
            browserBackgroundRemoveRuntimeConfigFromManifest(
              manifest,
              workspaceId,
              requiredCapabilityKeys,
            );
        } catch (error) {
          // Unsupported or invalid manifest entries remain unavailable.
          reportFailure("manifest", error, "runtime_configuration_invalid");
        }
        requiredCoverageComplete = browserRuntimeCoversCapabilities(
          requiredCapabilityKeys,
          [
            ...(imageAdjustmentConfiguration?.capabilities ?? []),
            ...(batchConfiguration?.capabilities ?? []),
            ...(backgroundRemoveConfiguration?.capabilities ?? []),
          ].map((capability) => capability.capabilityKey),
        );

        if (imageAdjustmentConfiguration) {
          try {
            const runtime = startBrowserImageAdjustmentRuntime({
              configuration: imageAdjustmentConfiguration,
              context,
              onError,
              onReady,
            });
            track(runtime);
            configured += 1;
          } catch (error) {
            if (requiredCapabilityKeys !== undefined) {
              requiredCoverageComplete = false;
            }
            reportFailure("probe", error);
          }
        }

        if (batchConfiguration) {
          try {
            const runtime = startBrowserBatchCRuntime({
              configuration: batchConfiguration,
              context,
              onError,
              onReady,
            });
            track(runtime);
            configured += 1;
          } catch (error) {
            if (requiredCapabilityKeys !== undefined) {
              requiredCoverageComplete = false;
            }
            reportFailure("probe", error);
          }
        }

        if (backgroundRemoveConfiguration) {
          try {
            const { startBrowserBackgroundRemoveRuntime } =
              await import("./browser-background-remove-runtime.js");
            if (!disposed) {
              const runtime = startBrowserBackgroundRemoveRuntime({
                configuration: backgroundRemoveConfiguration,
                context,
                onError,
                onReady,
              });
              track(runtime);
              configured += 1;
            }
          } catch (error) {
            if (requiredCapabilityKeys !== undefined) {
              requiredCoverageComplete = false;
            }
            reportFailure("probe", error);
          }
        }

        if (!disposed && (configured === 0 || !requiredCoverageComplete)) {
          setState("unavailable");
          reportFailure(
            "manifest",
            undefined,
            "required_capability_not_admitted",
          );
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setState("unavailable");
          reportFailure("manifest", error);
        }
      });

    return () => {
      disposed = true;
      admission.abort();
      for (const runtime of runtimes) runtime.stop();
      runtimes.clear();
    };
  }, [csrfToken, enabled, requiredCapabilityKeys, restartKey, workspaceId]);
  return state;
}
