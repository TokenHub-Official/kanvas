import type {
  CapabilityRunAccepted,
  CapabilityRunDetails,
  ToolSession,
  UserCapabilityCatalog,
} from "@kanvas/contracts/api";
import { ApiProblem, readProblem } from "../../api/transport.js";

export type ToolApiScope =
  { kind: "use"; workspaceId: string } | { kind: "preview" };
export function createToolRuntimeApi(options: {
  scope: ToolApiScope;
  csrfToken: string;
  locale: string;
  fetcher?: typeof fetch;
}) {
  const fetcher = options.fetcher ?? fetch;
  const scope = options.scope;
  const root =
    scope.kind === "use"
      ? "/api/v1/tool-sessions"
      : "/api/v1/instance/tool-previews";
  async function request<T>(
    path: string,
    body?: unknown,
    key?: string,
  ): Promise<T> {
    const response = await fetcher(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: "application/json",
        "accept-language": options.locale,
        ...(scope.kind === "use"
          ? { "x-kanvas-workspace-id": scope.workspaceId }
          : {}),
        ...(body === undefined
          ? {}
          : {
              "content-type": "application/json",
              "x-kanvas-csrf": options.csrfToken,
            }),
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw await readProblem(response);
    return (await response.json()) as T;
  }
  function usagePath(sessionId: string): string {
    if (scope.kind !== "use")
      throw new ApiProblem(
        403,
        "preview_execution_disabled",
        "Previews cannot invoke capabilities.",
      );
    return `${root}/${encodeURIComponent(sessionId)}`;
  }
  return {
    create(toolId: string, revisionId: string, key: string) {
      const path =
        scope.kind === "use"
          ? `/api/v1/tools/${encodeURIComponent(toolId)}/sessions`
          : `/api/v1/instance/tools/${encodeURIComponent(toolId)}/previews`;
      return request<ToolSession>(
        path,
        { expectedRevisionId: revisionId },
        key,
      );
    },
    get(sessionId: string) {
      return request<ToolSession>(`${root}/${encodeURIComponent(sessionId)}`);
    },
    close(sessionId: string) {
      return request<ToolSession>(
        `${root}/${encodeURIComponent(sessionId)}/close`,
        {},
      );
    },
    hostUrl(sessionId: string) {
      return scope.kind === "use"
        ? `/api/v1/tool-runtime/workspaces/${encodeURIComponent(scope.workspaceId)}/sessions/${encodeURIComponent(sessionId)}/host`
        : `/api/v1/instance/tool-runtime/${encodeURIComponent(sessionId)}/host`;
    },
    list(sessionId: string) {
      return request<UserCapabilityCatalog>(
        `${usagePath(sessionId)}/capabilities`,
      );
    },
    start(
      sessionId: string,
      body: { contractRevisionId: string; input: Record<string, unknown> },
      requestKey: string,
    ) {
      return request<CapabilityRunAccepted>(`${usagePath(sessionId)}/runs`, {
        ...body,
        requestKey,
      });
    },
    status(sessionId: string, runId: string) {
      return request<CapabilityRunDetails>(
        `${usagePath(sessionId)}/runs/${encodeURIComponent(runId)}`,
      );
    },
    cancel(sessionId: string, runId: string) {
      return request<CapabilityRunDetails>(
        `${usagePath(sessionId)}/runs/${encodeURIComponent(runId)}/cancel`,
        {},
      );
    },
  };
}
export type ToolRuntimeApi = ReturnType<typeof createToolRuntimeApi>;

/** A failed transport cannot establish revocation. Other HTTP rejections are definitive. */
export function isTransientToolError(error: unknown): boolean {
  return (
    !(error instanceof ApiProblem) ||
    error.status >= 500 ||
    [408, 429].includes(error.status)
  );
}
