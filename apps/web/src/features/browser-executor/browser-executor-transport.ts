import type {
  AcknowledgeBrowserAttemptCancellationBody,
  AllocateBrowserAttemptOutputBody,
  BrowserAttemptCancellationAcknowledgement,
  BrowserAttemptCompletionResponse,
  BrowserAttemptHeartbeatResponse,
  BrowserAttemptOutputIngestion,
  BrowserAttemptOutputUploadSession,
  BrowserExecutorSessionTransition,
  BrowserRuntimeManifest,
  ClaimBrowserAttemptResponse,
  CompleteBrowserAttemptBody,
  HeartbeatBrowserAttemptBody,
  RegisteredBrowserExecutor,
  RegisterBrowserExecutorBody,
} from "@kanvas/contracts/api";

import { ApiProblem, type WorkspaceApiContext } from "../../api/transport.js";

export interface BrowserAttemptGrantContext {
  readonly assignmentId: string;
  readonly attemptGrant: string;
  readonly sessionId: string;
  readonly workspaceId: string;
}

async function problem(response: Response): Promise<ApiProblem> {
  const value = (await response.json().catch(() => undefined)) as
    | {
        readonly code?: unknown;
        readonly detail?: unknown;
        readonly message?: unknown;
      }
    | undefined;
  let detail = `Browser Executor request failed with status ${String(response.status)}.`;
  if (typeof value?.detail === "string") {
    detail = value.detail;
  } else if (typeof value?.message === "string") {
    detail = value.message;
  }
  return new ApiProblem(
    response.status,
    typeof value?.code === "string"
      ? value.code
      : "browser_executor_request_failed",
    detail,
  );
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await problem(response);
  }
  return (await response.json()) as T;
}

function workspaceHeaders(
  context: WorkspaceApiContext,
): Record<string, string> {
  return {
    "x-kanvas-workspace-id": context.workspaceId,
    "x-kanvas-csrf": context.csrfToken,
  };
}

function grantHeaders(
  context: BrowserAttemptGrantContext,
): Record<string, string> {
  return {
    "x-kanvas-workspace-id": context.workspaceId,
    "x-kanvas-attempt-grant": context.attemptGrant,
  };
}

function assignmentPath(context: BrowserAttemptGrantContext): string {
  return `/api/v1/browser-executor-sessions/${encodeURIComponent(context.sessionId)}/assignments/${encodeURIComponent(context.assignmentId)}`;
}

export async function registerBrowserExecutor(
  context: WorkspaceApiContext,
  body: RegisterBrowserExecutorBody,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<RegisteredBrowserExecutor> {
  return json(
    await fetcher("/api/v1/browser-executor-sessions", {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }),
  );
}

export async function fetchBrowserRuntimeManifest(
  context: WorkspaceApiContext,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<BrowserRuntimeManifest> {
  const response = await fetcher("/api/v1/browser-runtime-manifest", {
    method: "GET",
    credentials: "include",
    headers: {
      accept: "application/json",
      ...workspaceHeaders(context),
    },
    ...(signal ? { signal } : {}),
  });
  return json(response);
}

export async function claimBrowserAttempt(
  context: WorkspaceApiContext,
  sessionId: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ClaimBrowserAttemptResponse> {
  return json(
    await fetcher(
      `/api/v1/browser-executor-sessions/${encodeURIComponent(sessionId)}/claim`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...workspaceHeaders(context),
        },
        body: JSON.stringify({ controlPlaneVersion: 1 }),
        ...(signal ? { signal } : {}),
      },
    ),
  );
}

export async function heartbeatBrowserAttempt(
  context: BrowserAttemptGrantContext,
  body: HeartbeatBrowserAttemptBody,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<BrowserAttemptHeartbeatResponse> {
  return json(
    await fetcher(`${assignmentPath(context)}/heartbeat`, {
      method: "POST",
      credentials: "omit",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...grantHeaders(context),
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }),
  );
}

export async function allocateBrowserAttemptOutput(
  context: BrowserAttemptGrantContext,
  body: AllocateBrowserAttemptOutputBody,
  idempotencyKey: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<BrowserAttemptOutputUploadSession> {
  return json(
    await fetcher(`${assignmentPath(context)}/output-upload-sessions`, {
      method: "POST",
      credentials: "omit",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        ...grantHeaders(context),
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }),
  );
}

export async function uploadBrowserAttemptOutput(
  context: BrowserAttemptGrantContext,
  options: {
    readonly attemptId: string;
    readonly blob: Blob;
    readonly executionGeneration: number;
    readonly leaseGeneration: number;
    readonly outputIndex: number;
    readonly outputRole: string;
    readonly uploadSessionId: string;
  },
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<BrowserAttemptOutputIngestion> {
  return json(
    await fetcher(
      `${assignmentPath(context)}/output-upload-sessions/${encodeURIComponent(options.uploadSessionId)}/content`,
      {
        method: "PUT",
        credentials: "omit",
        headers: {
          accept: "application/json",
          "content-type": options.blob.type || "application/octet-stream",
          "x-kanvas-attempt-id": options.attemptId,
          "x-kanvas-attempt-lease-generation": String(options.leaseGeneration),
          "x-kanvas-execution-generation": String(options.executionGeneration),
          "x-kanvas-output-role": options.outputRole,
          "x-kanvas-output-index": String(options.outputIndex),
          ...grantHeaders(context),
        },
        body: options.blob,
        ...(signal ? { signal } : {}),
      },
    ),
  );
}

export async function completeBrowserAttempt(
  context: BrowserAttemptGrantContext,
  body: CompleteBrowserAttemptBody,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<BrowserAttemptCompletionResponse> {
  return json(
    await fetcher(`${assignmentPath(context)}/complete`, {
      method: "POST",
      credentials: "omit",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...grantHeaders(context),
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }),
  );
}

export async function acknowledgeBrowserAttemptCancellation(
  context: BrowserAttemptGrantContext,
  body: AcknowledgeBrowserAttemptCancellationBody,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<BrowserAttemptCancellationAcknowledgement> {
  return json(
    await fetcher(`${assignmentPath(context)}/cancellation-acknowledgement`, {
      method: "POST",
      credentials: "omit",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...grantHeaders(context),
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }),
  );
}

export async function drainBrowserExecutor(
  context: WorkspaceApiContext,
  sessionId: string,
  fetcher: typeof fetch = fetch,
): Promise<BrowserExecutorSessionTransition> {
  return json(
    await fetcher(
      `/api/v1/browser-executor-sessions/${encodeURIComponent(sessionId)}/drain`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...workspaceHeaders(context),
        },
        body: JSON.stringify({}),
      },
    ),
  );
}
