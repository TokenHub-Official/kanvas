import type { CapabilityRunDetails } from "@kanvas/contracts/api";
import { Alert, Button } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { downloadArtifact } from "../../api/transport.js";
import { ArtifactPreview } from "../../components/artifact-preview.js";
import { RunOutputValue } from "../../components/run-output-value.js";
import { record } from "./bridge.js";

const downloadUrlLifetimeMilliseconds = 1000;

function ArtifactResult({
  artifactId,
  label,
  workspaceId,
  canDownload,
}: {
  readonly artifactId: string;
  readonly label: string;
  readonly workspaceId: string;
  readonly canDownload: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function download(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const blob = await downloadArtifact(workspaceId, artifactId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const extension =
        (
          {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
            "image/svg+xml": "svg",
            "application/pdf": "pdf",
          } as Record<string, string>
        )[blob.type] ?? "bin";
      link.href = url;
      link.download = `kanvas-result.${extension}`;
      link.click();
      setTimeout(
        () => URL.revokeObjectURL(url),
        downloadUrlLifetimeMilliseconds,
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  if (!canDownload)
    return (
      <Alert
        type="info"
        title={t("studio.externalTools.noDownloadPermission")}
      />
    );
  return (
    <div className="grid gap-3">
      <ArtifactPreview
        alt={label}
        artifactId={artifactId}
        workspaceId={workspaceId}
        className="min-h-40"
        imageClassName="max-h-[480px] w-auto max-w-full rounded-control object-contain"
        loadingLabel={t("studio.externalTools.previewLoading")}
        unavailableLabel={t("studio.externalTools.previewUnavailable")}
        retryLabel={t("studio.externalTools.retryPreview")}
      />
      {failed ? (
        <Alert type="error" title={t("studio.externalTools.downloadFailed")} />
      ) : null}
      <Button className="w-fit" loading={busy} onClick={() => void download()}>
        {t("studio.externalTools.download")}
      </Button>
    </div>
  );
}

export function ToolResult({
  run,
  workspaceId,
  canDownload,
}: {
  readonly run: CapabilityRunDetails;
  readonly workspaceId: string;
  readonly canDownload: boolean;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.startsWith("en") ? "en-US" : "zh-CN";
  const output = record(run.output);
  const fields =
    run.outputDeclarations?.filter(
      (field) =>
        field.visibility !== "hidden" &&
        output &&
        Object.hasOwn(output, field.key),
    ) ?? [];
  function renderValue(value: unknown): React.JSX.Element {
    return (
      <RunOutputValue
        value={value}
        emptyLabel={t("studio.externalTools.emptyResult")}
        yesLabel={t("studio.externalTools.yes")}
        noLabel={t("studio.externalTools.no")}
      />
    );
  }
  return (
    <section
      aria-label={t("studio.externalTools.result")}
      className="grid gap-5 border-t border-line p-6"
    >
      <h2 className="m-0 text-lg font-semibold">
        {t("studio.externalTools.result")}
      </h2>
      {fields.length
        ? fields.map((field) => {
            const value = output?.[field.key];
            const label = field.label?.[language] ?? field.key;
            const artifactIds = field.semanticType.startsWith("artifact.")
              ? (Array.isArray(value) ? value : [value]).filter(
                  (item): item is string =>
                    typeof item === "string" &&
                    /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(item),
                )
              : [];
            return (
              <div key={field.key} className="grid gap-2">
                <h3 className="m-0 text-sm font-medium text-muted">{label}</h3>
                {artifactIds.length
                  ? artifactIds.map((artifactId) => (
                      <ArtifactResult
                        key={artifactId}
                        artifactId={artifactId}
                        label={label}
                        workspaceId={workspaceId}
                        canDownload={canDownload}
                      />
                    ))
                  : renderValue(value)}
              </div>
            );
          })
        : renderValue(run.output)}
    </section>
  );
}
