const chunkSize = 8192;
import type {
  ToolCatalogue,
  ToolSource,
  ToolUsageDetail,
  SiteToolList,
  SiteToolDetail,
  ToolPresentation,
  ToolImageContent,
  ToolIntegrationCatalog,
} from "@kanvas/contracts/api";
import { readProblem } from "../../api/transport.js";
export async function toolRequest<T>(
  path: string,
  options: {
    workspaceId?: string;
    csrfToken?: string;
    body?: unknown;
    key?: string;
    locale?: string;
  } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(options.locale ? { "accept-language": options.locale } : {}),
      ...(options.workspaceId
        ? { "x-kanvas-workspace-id": options.workspaceId }
        : {}),
      ...(options.body === undefined
        ? {}
        : {
            "content-type": "application/json",
            "x-kanvas-csrf": options.csrfToken ?? "",
            "idempotency-key": options.key ?? crypto.randomUUID(),
          }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as T;
}
export const toolLibrary = {
  list: (workspaceId: string) =>
    toolRequest<ToolCatalogue>("/api/v1/tools", { workspaceId }),
  usage: (workspaceId: string, slug: string) =>
    toolRequest<ToolUsageDetail>(`/api/v1/tools/${encodeURIComponent(slug)}`, {
      workspaceId,
    }),
  image: (imageId: string, workspaceId?: string) =>
    toolRequest<ToolImageContent>(
      `/api/v1/${workspaceId ? "" : "instance/"}tool-images/${imageId}`,
      workspaceId ? { workspaceId } : {},
    ),
  adminList: () => toolRequest<SiteToolList>("/api/v1/instance/tools"),
  detail: (id: string) =>
    toolRequest<SiteToolDetail>(`/api/v1/instance/tools/${id}`),
  source: (id: string, revisionId?: string) =>
    toolRequest<ToolSource>(
      `/api/v1/instance/tools/${id}/source${revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : ""}`,
    ),
  create: (csrfToken: string, body: ToolPresentation, key: string) =>
    toolRequest<{ toolId: string; version: number }>("/api/v1/instance/tools", {
      csrfToken,
      body,
      key,
    }),
  change: (
    csrfToken: string,
    id: string,
    action: string,
    body: unknown,
    key: string,
  ) =>
    toolRequest<{ toolId: string; version: number }>(
      `/api/v1/instance/tools/${id}/${action}`,
      { csrfToken, body, key },
    ),
  uploadImage: (csrfToken: string, contentBase64: string, key: string) =>
    toolRequest<{ imageId: string }>("/api/v1/instance/tool-images", {
      csrfToken,
      body: { contentBase64 },
      key,
    }),
  integrations: (locale: string) =>
    toolRequest<ToolIntegrationCatalog>("/api/v1/instance/tool-integrations", {
      locale,
    }),
};
export async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  return btoa(binary);
}
