import { useCallback, useEffect, useRef, useState } from "react";

import {
  allocateUserImport,
  commitUserImport,
  uploadUserImport,
} from "../../api/transport.js";
import type { AgentComposerAttachment } from "./agent-composer.js";

const maximumAgentAttachments = 8;

interface UploadedAgentAttachment extends AgentComposerAttachment {
  readonly artifactId?: string;
  readonly assetId?: string;
}

function attachmentStorageKey(draftKey: string): string {
  return `${draftKey}:attachments`;
}

function storedAttachments(draftKey: string): UploadedAgentAttachment[] {
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(attachmentStorageKey(draftKey)) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
      }
      const item = value as Readonly<Record<string, unknown>>;
      return typeof item.id === "string" && typeof item.name === "string"
        ? [
            {
              id: item.id,
              name: item.name,
              ...(typeof item.assetId === "string"
                ? { assetId: item.assetId }
                : {}),
              ...(typeof item.artifactId === "string"
                ? { artifactId: item.artifactId }
                : {}),
              previewUrl: "",
              progress: 100,
              status: typeof item.artifactId === "string" ? "ready" : "error",
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}

function persistAttachments(
  draftKey: string,
  attachments: readonly UploadedAgentAttachment[],
): void {
  try {
    const ready = attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      ...(attachment.assetId ? { assetId: attachment.assetId } : {}),
      ...(attachment.artifactId ? { artifactId: attachment.artifactId } : {}),
    }));
    if (ready.length > 0) {
      sessionStorage.setItem(
        attachmentStorageKey(draftKey),
        JSON.stringify(ready),
      );
    } else {
      sessionStorage.removeItem(attachmentStorageKey(draftKey));
    }
  } catch {
    // The current tab still keeps attachments when browser storage is blocked.
  }
}

export function useAgentComposerAttachments(options: {
  readonly csrfToken: string;
  readonly draftKey: string;
  readonly onError: () => void;
  readonly workspaceId: string;
}) {
  const { csrfToken, draftKey, onError, workspaceId } = options;
  const [attachments, setAttachments] = useState<UploadedAgentAttachment[]>(
    () => storedAttachments(draftKey),
  );
  const abortControllers = useRef(new Map<string, AbortController>());
  const previewUrls = useRef(new Set<string>());

  useEffect(
    () => () => {
      abortControllers.current.forEach((controller) => controller.abort());
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  useEffect(() => {
    abortControllers.current.forEach((controller) => controller.abort());
    abortControllers.current.clear();
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
    setAttachments(storedAttachments(draftKey));
  }, [draftKey]);

  const update = useCallback(
    (id: string, patch: Partial<UploadedAgentAttachment>) => {
      setAttachments((current) => {
        const next = current.map((attachment) =>
          attachment.id === id ? { ...attachment, ...patch } : attachment,
        );
        persistAttachments(draftKey, next);
        return next;
      });
    },
    [draftKey],
  );

  const upload = useCallback(
    async (attachment: UploadedAgentAttachment, file: File) => {
      const controller = new AbortController();
      abortControllers.current.set(attachment.id, controller);
      try {
        const allocation = await allocateUserImport(
          { csrfToken, workspaceId },
          {
            expectedMediaType: file.type as
              "image/jpeg" | "image/png" | "image/webp",
            expectedSize: String(file.size),
          },
          `agent-attachment:${attachment.id}`,
          { signal: controller.signal },
        );
        await uploadUserImport(
          { csrfToken, workspaceId },
          allocation.uploadSessionId,
          file,
          {
            signal: controller.signal,
            onProgress: ({ loadedBytes, totalBytes }) => {
              update(
                attachment.id,
                totalBytes > 0
                  ? { progress: Math.round((loadedBytes / totalBytes) * 100) }
                  : {},
              );
            },
          },
        );
        const committed = await commitUserImport(
          { csrfToken, workspaceId },
          allocation.uploadSessionId,
          {
            artifactType: "image.source",
            dataClassification: "internal",
            displayFilename: file.name,
            metadata: { importedFrom: "agent-composer" },
          },
          fetch,
          controller.signal,
        );
        update(attachment.id, {
          artifactId: committed.artifactId,
          progress: 100,
          status: "ready",
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          update(attachment.id, { status: "error" });
          onError();
        }
      } finally {
        abortControllers.current.delete(attachment.id);
      }
    },
    [csrfToken, onError, update, workspaceId],
  );

  const addFiles = useCallback(
    (files: readonly File[]) => {
      const accepted = files.slice(
        0,
        Math.max(0, maximumAgentAttachments - attachments.length),
      );
      const next = accepted.map((file) => {
        const previewUrl = URL.createObjectURL(file);
        previewUrls.current.add(previewUrl);
        return {
          attachment: {
            id: crypto.randomUUID(),
            name: file.name,
            previewUrl,
            progress: 0,
            status: "uploading" as const,
          },
          file,
        };
      });
      setAttachments((current) => {
        const combined = [...current, ...next.map((item) => item.attachment)];
        persistAttachments(draftKey, combined);
        return combined;
      });
      next.forEach((item) => void upload(item.attachment, item.file));
    },
    [attachments.length, draftKey, upload],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      abortControllers.current.get(id)?.abort();
      setAttachments((current) => {
        const removed = current.find((attachment) => attachment.id === id);
        if (removed) {
          URL.revokeObjectURL(removed.previewUrl);
          previewUrls.current.delete(removed.previewUrl);
        }
        const next = current.filter((attachment) => attachment.id !== id);
        persistAttachments(draftKey, next);
        return next;
      });
    },
    [draftKey],
  );

  const clearAttachments = useCallback(() => {
    abortControllers.current.forEach((controller) => controller.abort());
    abortControllers.current.clear();
    setAttachments((current) => {
      current.forEach((attachment) => {
        URL.revokeObjectURL(attachment.previewUrl);
        previewUrls.current.delete(attachment.previewUrl);
      });
      persistAttachments(draftKey, []);
      return [];
    });
  }, [draftKey]);

  return {
    addFiles,
    attachments,
    busy: attachments.some((attachment) => attachment.status === "uploading"),
    clearAttachments,
    hasError: attachments.some((attachment) => attachment.status === "error"),
    removeAttachment,
    references: attachments.flatMap((attachment) =>
      attachment.status === "ready" && attachment.artifactId
        ? [
            {
              ...(attachment.assetId ? { assetId: attachment.assetId } : {}),
              artifactId: attachment.artifactId,
            },
          ]
        : [],
    ),
  };
}
