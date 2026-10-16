import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Image, Modal, Spin } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentThreadView } from "@kanvas/contracts/api";
import { downloadArtifact } from "../../api/transport.js";
import { useObjectUrl } from "../../components/use-object-url.js";
import { fetchLibraryText } from "./api.js";
import { LibraryTextContent } from "./library-content.js";
type Use = NonNullable<
  AgentThreadView["messages"][number]["libraryUses"]
>[number];

export function LibraryReferenceDialog({
  item,
  workspaceId,
  onClose,
}: {
  readonly item: Use;
  readonly workspaceId: string;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const [full, setFull] = useState(false);
  const source = useQuery({
    queryKey: [
      "library-source-reference",
      workspaceId,
      item.libraryId,
      item.artifactId,
    ],
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const blob = await downloadArtifact(
        workspaceId,
        item.artifactId!,
        fetch,
        signal,
      );
      const text = blob.type.startsWith("image/")
        ? undefined
        : await fetchLibraryText(
            workspaceId,
            item.libraryId,
            item.artifactId!,
            signal,
          );
      return { blob, text };
    },
  });
  const url = useObjectUrl(source.data?.blob);
  return (
    <Modal open title={item.name} onCancel={onClose} width={760} footer={null}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {item.libraryName} ·{" "}
          {t("libraries.revision", { number: item.revisionNumber })}
        </span>
        {url && (
          <Button type="text" size="small" href={url} download={item.name}>
            {t("libraries.download")}
          </Button>
        )}
      </div>
      {source.isPending && <Spin />}
      {source.isError && (
        <Alert
          type="error"
          title={t("libraries.previewFailed")}
          action={
            <Button onClick={() => void source.refetch()}>
              {t("libraries.retry")}
            </Button>
          }
        />
      )}
      {source.isSuccess && source.data.text && (
        <div className="max-h-[60vh] overflow-auto">
          {!full && item.locations?.length ? (
            <>
              {item.locations.map((location) => (
                <section
                  key={`${location.startOffset}:${location.endOffset}`}
                  className="mb-4"
                >
                  <div className="mb-1 text-xs text-muted">
                    {t("libraries.passage", { number: location.number })} ·{" "}
                    {location.page
                      ? t("libraries.page", { number: location.page })
                      : t("libraries.lines", {
                          from: location.startLine,
                          to: location.endLine,
                        })}
                  </div>
                  <LibraryTextContent
                    text={source.data.text!.text.slice(
                      location.startOffset,
                      location.endOffset,
                    )}
                    markdown={false}
                  />
                </section>
              ))}
              <Button size="small" type="text" onClick={() => setFull(true)}>
                {t("libraries.fullDocument")}
              </Button>
            </>
          ) : (
            <LibraryTextContent
              text={source.data.text.text}
              markdown={source.data.blob.type === "text/markdown"}
            />
          )}
        </div>
      )}
      {source.isSuccess && !source.data.text && url && (
        <Image
          src={url}
          alt={item.name}
          styles={{
            root: { width: "100%" },
            image: { maxHeight: "60vh", objectFit: "contain", width: "100%" },
          }}
        />
      )}
    </Modal>
  );
}
