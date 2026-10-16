import {
  trackBrowserRuntime,
  useBrowserRuntimes,
  type BrowserRuntimeControl,
} from "../browser-executor/use-browser-runtimes.js";

export type CanvasBrowserRuntimeControlV1 = BrowserRuntimeControl;

export function trackCanvasBrowserRuntimeV1(
  runtime: CanvasBrowserRuntimeControlV1,
  disposed: boolean,
  runtimes: Set<CanvasBrowserRuntimeControlV1>,
): void {
  trackBrowserRuntime(runtime, disposed, runtimes);
}

export function useCanvasBrowserRuntimesV1({
  canEdit,
  csrfToken,
  requiredCapabilityKeys,
  workspaceId,
}: {
  readonly canEdit: boolean;
  readonly csrfToken: string;
  readonly requiredCapabilityKeys?: readonly string[];
  readonly workspaceId: string;
}): void {
  useBrowserRuntimes({
    csrfToken,
    enabled: canEdit,
    ...(requiredCapabilityKeys === undefined ? {} : { requiredCapabilityKeys }),
    workspaceId,
  });
}
