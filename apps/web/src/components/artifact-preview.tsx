import { FileImageOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Button, Image } from "antd";
import { useEffect, useRef, useState } from "react";

import { downloadArtifact } from "../api/transport.js";
import { cn } from "../lib/cn.js";
import { useObjectUrl } from "./use-object-url.js";
import { artifactPreviewQueryOptionsV1 } from "./artifact-preview-query.js";

export interface ArtifactImageMetadata {
  readonly byteSize: number;
  readonly height: number;
  readonly mediaType: string;
  readonly width: number;
}

export type ArtifactPreviewVisualState =
  "error" | "image" | "loading" | "placeholder";

export function artifactPreviewAccessibilityV1(
  state: Exclude<ArtifactPreviewVisualState, "image">,
  alt: string,
  labels?: {
    readonly loading?: string;
    readonly unavailable?: string;
  },
):
  | {
      readonly "aria-hidden": true;
    }
  | {
      readonly "aria-label": string;
      readonly role: "img";
    } {
  if (!alt.trim() || state === "placeholder") {
    return { "aria-hidden": true };
  }
  return {
    "aria-label":
      state === "loading"
        ? (labels?.loading ?? `${alt}，正在载入`)
        : (labels?.unavailable ?? `${alt}，暂时无法预览`),
    role: "img",
  };
}

export function artifactPreviewClassNameV1(
  state: ArtifactPreviewVisualState,
  imageClassName?: string,
  className?: string,
): string {
  return cn(
    state === "image" ? undefined : "artifact-image-state",
    state === "placeholder" ? "artifact-image-placeholder" : undefined,
    state === "loading" ? "artifact-image-loading" : undefined,
    state === "error" ? "artifact-image-error" : undefined,
    imageClassName,
    state === "image" ? undefined : className,
  );
}

function useArtifactPreview(
  workspaceId: string,
  artifactId: string,
  enabled = true,
  thumbnail = false,
): {
  readonly blob: Blob | undefined;
  readonly error: Error | null;
  readonly pending: boolean;
  readonly retry: () => void;
  readonly retrying: boolean;
  readonly url: string | undefined;
} {
  const thumbnailArtifact = useQuery(
    artifactPreviewQueryOptionsV1(
      workspaceId,
      artifactId,
      enabled && thumbnail,
    ),
  );
  const contentArtifact = useQuery({
    queryKey: ["artifacts", workspaceId, artifactId, "content"],
    queryFn: () => downloadArtifact(workspaceId, artifactId),
    enabled: enabled && !thumbnail,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const artifact = thumbnail ? thumbnailArtifact : contentArtifact;
  const url = useObjectUrl(artifact.data);

  return {
    blob: artifact.data,
    error: artifact.error,
    pending: artifact.isPending,
    retry: () => {
      void artifact.refetch();
    },
    retrying: artifact.isFetching,
    url,
  };
}

export function ArtifactPreview({
  alt,
  artifactId,
  className,
  imageClassName,
  lazy = false,
  loadingLabel,
  onMetadata,
  previewable = false,
  retryLabel,
  thumbnail = false,
  unavailableLabel,
  workspaceId,
}: {
  readonly alt: string;
  readonly artifactId: string;
  readonly className?: string;
  readonly imageClassName?: string;
  readonly lazy?: boolean;
  readonly loadingLabel?: string;
  readonly onMetadata?: (metadata: ArtifactImageMetadata) => void;
  readonly previewable?: boolean;
  readonly retryLabel?: string;
  readonly thumbnail?: boolean;
  readonly unavailableLabel?: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const targetRef = useRef<HTMLElement | null>(null);
  const [failedUrl, setFailedUrl] = useState<string>();
  const [visible, setVisible] = useState(
    () => !lazy || typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (visible || !lazy) {
      return;
    }
    const element = targetRef.current;
    if (!element) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: "240px",
      },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [lazy, visible]);

  const preview = useArtifactPreview(
    workspaceId,
    artifactId,
    visible,
    thumbnail,
  );
  const accessibilityLabels = {
    ...(loadingLabel ? { loading: loadingLabel } : {}),
    ...(unavailableLabel ? { unavailable: unavailableLabel } : {}),
  };

  if (!visible) {
    return (
      <div
        {...artifactPreviewAccessibilityV1(
          "placeholder",
          alt,
          accessibilityLabels,
        )}
        className={artifactPreviewClassNameV1(
          "placeholder",
          imageClassName,
          className,
        )}
        ref={(element) => {
          targetRef.current = element;
        }}
      />
    );
  }

  if (preview.pending) {
    return (
      <div
        {...artifactPreviewAccessibilityV1("loading", alt, accessibilityLabels)}
        className={artifactPreviewClassNameV1(
          "loading",
          imageClassName,
          className,
        )}
        ref={(element) => {
          targetRef.current = element;
        }}
      />
    );
  }
  if (
    preview.error ||
    !preview.url ||
    !preview.blob ||
    failedUrl === preview.url
  ) {
    return (
      <div
        {...(retryLabel
          ? {}
          : artifactPreviewAccessibilityV1("error", alt, accessibilityLabels))}
        className={artifactPreviewClassNameV1(
          "error",
          imageClassName,
          className,
        )}
        ref={(element) => {
          targetRef.current = element;
        }}
      >
        <FileImageOutlined aria-hidden="true" className="text-xl" />
        {unavailableLabel ?? "暂时无法预览"}
        {retryLabel ? (
          <Button
            size="small"
            loading={preview.retrying}
            onClick={retryPreview}
          >
            {retryLabel}
          </Button>
        ) : null}
      </div>
    );
  }

  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    onMetadata?.({
      byteSize: preview.blob?.size ?? 0,
      height: event.currentTarget.naturalHeight,
      mediaType: preview.blob?.type || "application/octet-stream",
      width: event.currentTarget.naturalWidth,
    });
  };
  if (previewable) {
    return (
      <span className={className}>
        <Image
          alt={alt}
          classNames={{
            image: artifactPreviewClassNameV1("image", imageClassName),
            popup: {
              root: "[&_.ant-image-preview-img]:max-h-[88dvh] [&_.ant-image-preview-img]:max-w-[92vw] [&_.ant-image-preview-operations]:!rounded-[14px]",
            },
            root: "size-full",
          }}
          fallback=""
          onLoad={handleLoad}
          onError={() => setFailedUrl(preview.url)}
          preview={{}}
          src={preview.url}
          styles={{
            popup: {
              mask: { backgroundColor: "rgb(15 16 20 / 86%)" },
            },
          }}
        />
      </span>
    );
  }

  function retryPreview() {
    setFailedUrl(undefined);
    preview.retry();
  }
  return (
    <img
      alt={alt}
      className={artifactPreviewClassNameV1("image", imageClassName, className)}
      decoding="async"
      loading={lazy ? "lazy" : "eager"}
      onLoad={handleLoad}
      onError={() => setFailedUrl(preview.url)}
      ref={(element) => {
        targetRef.current = element;
      }}
      src={preview.url}
    />
  );
}
