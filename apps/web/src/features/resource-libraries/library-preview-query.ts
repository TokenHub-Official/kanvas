import { queryOptions } from "@tanstack/react-query";
import { downloadArtifact } from "../../api/transport.js";
import { fetchLibraryText } from "./api.js";
const maximumTextBytes = 131072;
// Briefly reuse immutable content while browsing, then revalidate through the server.
const previewFreshnessMs = 30_000;
const previewRetentionMs = 5 * 60_000;
export function libraryPreviewQueryOptions(
  workspaceId: string,
  artifactId: string,
  unsupportedMessage: string,
) {
  return queryOptions({
    queryKey: ["library-preview", workspaceId, artifactId],
    queryFn: async ({ signal }) => {
      const blob = await downloadArtifact(
        workspaceId,
        artifactId,
        fetch,
        signal,
      );
      if (blob.type.startsWith("text/")) {
        if (blob.size > maximumTextBytes) throw new Error(unsupportedMessage);
        return {
          blob,
          text: new TextDecoder("utf-8", { fatal: true }).decode(
            await blob.arrayBuffer(),
          ),
        };
      }
      if (
        ![
          "image/png",
          "image/jpeg",
          "image/webp",
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ].includes(blob.type)
      )
        throw new Error(unsupportedMessage);
      return { blob, text: undefined };
    },

    staleTime: previewFreshnessMs,
    gcTime: previewRetentionMs,
    retry: false,
  });
}
export function libraryTextQueryOptions(
  workspaceId: string,
  libraryId: string,
  artifactId: string,
  enabled: boolean,
) {
  return queryOptions({
    queryKey: ["library-text", workspaceId, libraryId, artifactId],
    queryFn: ({ signal }) =>
      fetchLibraryText(workspaceId, libraryId, artifactId, signal),
    enabled,
    staleTime: previewFreshnessMs,
    gcTime: previewRetentionMs,
    retry: false,
  });
}
