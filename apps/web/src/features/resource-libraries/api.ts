import type {
  LibraryDocument,
  LibraryRevision,
  LibrarySummary,
} from "@kanvas/contracts/api";
import { readProblem, type WorkspaceApiContext } from "../../api/transport.js";

const root = (workspaceId: string) =>
  `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/resource-libraries`;
async function result<T>(response: Response): Promise<T> {
  if (!response.ok) throw await readProblem(response);
  return response.json() as Promise<T>;
}
function headers(
  context: WorkspaceApiContext,
  key?: string,
): Record<string, string> {
  return {
    "x-kanvas-csrf": context.csrfToken,
    "x-kanvas-workspace-id": context.workspaceId,
    ...(key ? { "idempotency-key": key } : {}),
  };
}
export function fetchLibraries(
  workspaceId: string,
  options: {
    query: string;
    lifecycleStatus: "active" | "archived";
    afterId?: string;
  },
  signal?: AbortSignal,
) {
  return fetch(`${root(workspaceId)}?${new URLSearchParams(options)}`, {
    credentials: "include",
    headers: { "x-kanvas-workspace-id": workspaceId },
    ...(signal ? { signal } : {}),
  }).then(result<{ items: LibrarySummary[]; nextCursor?: string }>);
}
export function fetchLibrary(
  workspaceId: string,
  libraryId: string,
  signal?: AbortSignal,
) {
  return fetch(`${root(workspaceId)}/${libraryId}`, {
    credentials: "include",
    headers: { "x-kanvas-workspace-id": workspaceId },
    ...(signal ? { signal } : {}),
  }).then(result<{ library: LibrarySummary; revision: LibraryRevision }>);
}
export function saveLibrary(
  context: WorkspaceApiContext,
  libraryId: string,
  expectedVersion: number,
  document: LibraryDocument,
  key: string,
) {
  return fetch(`${root(context.workspaceId)}/${libraryId}`, {
    method: "PUT",
    credentials: "include",
    headers: { ...headers(context, key), "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion, document }),
  }).then(result<{ revision: LibraryRevision; replayed: boolean }>);
}
export function changeLibraryLifecycle(
  context: WorkspaceApiContext,
  libraryId: string,
  expectedVersion: number,
  lifecycleStatus: "active" | "archived",
) {
  return fetch(`${root(context.workspaceId)}/${libraryId}/lifecycle`, {
    method: "PATCH",
    credentials: "include",
    headers: { ...headers(context), "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion, lifecycleStatus }),
  }).then(result<{ updated: true }>);
}
export function libraryFileMediaType(
  file: Pick<File, "name" | "type" | "size">,
): string | undefined {
  const name = file.name.toLowerCase();
  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown")
  ) {
    if (file.size <= 0 || file.size > 131072) return undefined;
    return name.endsWith(".txt") ? "text/plain" : "text/markdown";
  }
  if (name.endsWith(".pdf") || name.endsWith(".docx")) {
    if (file.size <= 0 || file.size > 16 * 1024 * 1024) return undefined;
    return name.endsWith(".pdf")
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (file.size <= 0 || file.size > 134217728) return undefined;
  const extensions: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  const expected = extensions[name.split(".").at(-1) ?? ""];
  return expected && (!file.type || file.type === expected)
    ? expected
    : undefined;
}
export async function uploadLibraryFile(
  context: WorkspaceApiContext,
  libraryId: string,
  file: File,
  key: string,
) {
  const mediaType = libraryFileMediaType(file);
  if (!mediaType) throw new Error("Unsupported library file type or size.");
  const sha256 = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
    ),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  const query = new URLSearchParams({
    filename: file.name,
    byteSize: String(file.size),
    mediaType,
    sha256,
  });
  return fetch(`${root(context.workspaceId)}/${libraryId}/files?${query}`, {
    method: "POST",
    credentials: "include",
    headers: {
      ...headers(context, key),
      "content-type": "application/octet-stream",
    },
    body: file,
  }).then(
    result<{
      artifactId: string;
      mediaType: string;
      byteSize: string;
      replayed: boolean;
    }>,
  );
}

export function fetchLibraryText(
  workspaceId: string,
  libraryId: string,
  artifactId: string,
  signal?: AbortSignal,
) {
  return fetch(`${root(workspaceId)}/${libraryId}/files/${artifactId}/text`, {
    credentials: "include",
    headers: { "x-kanvas-workspace-id": workspaceId },
    ...(signal ? { signal } : {}),
  }).then(
    result<{
      text: string;
      contentDigest: string;
      extractorVersion: string;
      pageRanges: { page: number; startOffset: number; endOffset: number }[];
    }>,
  );
}
