import { CloseOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

const noticeBaseClassName =
  "fixed top-[72px] right-[18px] z-[220] grid min-w-[min(360px,calc(100vw-36px))] max-w-[380px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 rounded-[10px] border px-3.5 py-3 text-left text-xs shadow-[0_8px_25px_rgb(75_24_32_/_12%)] [&_p]:m-0 [&_p]:leading-normal [&_strong]:m-0 [&_strong+_p]:mt-[3px]";

export function CanvasWorkspaceNoticeV1({
  draftSaveError,
  operationMessage,
  saveConflictActive,
  saveError,
  sourceDeletionCancellationPending,
  onDismissOperationMessage,
  onDismissSaveError,
  onResolveSaveConflict,
  onRetryDraftSave,
}: {
  readonly draftSaveError?: string;
  readonly operationMessage?: string;
  readonly saveConflictActive: boolean;
  readonly saveError?: string;
  readonly sourceDeletionCancellationPending: boolean;
  readonly onDismissOperationMessage: () => void;
  readonly onDismissSaveError: () => void;
  readonly onResolveSaveConflict: () => void;
  readonly onRetryDraftSave: () => void;
}) {
  const { t } = useTranslation();

  if (draftSaveError) {
    return (
      <section
        aria-atomic="true"
        className={`${noticeBaseClassName} border-danger-border bg-danger-surface text-danger`}
        role="alert"
      >
        <div>
          <strong>{t("canvas.editor.unsavedTitle")}</strong>
          <p>{draftSaveError}</p>
        </div>
        <Button
          color="danger"
          onClick={
            saveConflictActive ? onResolveSaveConflict : onRetryDraftSave
          }
          size="small"
          variant="filled"
        >
          {t(
            saveConflictActive
              ? "canvas.editor.resolveConflict"
              : "canvas.editor.retrySave",
          )}
        </Button>
      </section>
    );
  }

  if (saveError) {
    return (
      <section
        aria-atomic="true"
        className={`${noticeBaseClassName} border-danger-border bg-danger-surface text-danger`}
        role="alert"
      >
        <p>{saveError}</p>
        <Button
          aria-label={t("canvas.editor.closeError")}
          color="danger"
          icon={<CloseOutlined aria-hidden="true" />}
          onClick={onDismissSaveError}
          shape="circle"
          size="small"
          variant="text"
        />
      </section>
    );
  }

  if (!sourceDeletionCancellationPending && !operationMessage) {
    return null;
  }

  return (
    <section
      aria-atomic="true"
      aria-live="polite"
      className={`${noticeBaseClassName} border-[var(--line)] bg-[var(--paper)] text-[var(--ink)]`}
      role="status"
    >
      <p>
        {sourceDeletionCancellationPending
          ? t("canvas.messages.sourceDeletedCancelling")
          : operationMessage}
      </p>
      <Button
        aria-label={t("canvas.editor.closeMessage")}
        color="default"
        icon={<CloseOutlined aria-hidden="true" />}
        onClick={onDismissOperationMessage}
        shape="circle"
        size="small"
        variant="text"
      />
    </section>
  );
}
