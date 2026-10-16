import { Alert, App, Button, Modal, Segmented } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KanvasInput, KanvasTextArea } from "../../components/kanvas-input.js";
import { LibraryTextContent } from "./library-content.js";

export const maximumDocumentBytes = 131072;
export function documentFile(
  name: string,
  text: string,
  mediaType: "text/plain" | "text/markdown",
): File {
  const extension = mediaType === "text/plain" ? ".txt" : ".md";
  const filename =
    name.trim().replace(/\.(?:txt|md|markdown)$/iu, "") + extension;
  return new File([text], filename, { type: mediaType });
}

export function LibraryDocumentEditor({
  initial,
  onApply,
  onClose,
}: {
  readonly initial: {
    name: string;
    text: string;
    mediaType: "text/plain" | "text/markdown";
    entryId?: string;
  };
  readonly onApply: (file: File, key: string) => Promise<void>;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const { modal } = App.useApp();
  const [name, setName] = useState(initial.name);
  const [text, setText] = useState(initial.text);
  const [mode, setMode] = useState("edit");
  const [mediaType, setMediaType] = useState(initial.mediaType);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const attemptRef = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  const bytes = new TextEncoder().encode(text).byteLength;
  const dirty =
    name !== initial.name ||
    text !== initial.text ||
    mediaType !== initial.mediaType;
  const tooLarge = bytes > maximumDocumentBytes;
  function close() {
    if (pending) return;
    if (!dirty) return onClose();
    modal.confirm({
      title: t("libraries.discard"),
      content: t("libraries.documentDiscard"),
      okText: t("libraries.leave"),
      cancelText: t("libraries.keepEditing"),
      onOk: onClose,
    });
  }
  async function apply() {
    setPending(true);
    setFailed(false);
    try {
      const signature = JSON.stringify([name, text, mediaType]);
      if (attemptRef.current?.signature !== signature)
        attemptRef.current = { signature, key: crypto.randomUUID() };
      await onApply(
        documentFile(name, text, mediaType),
        attemptRef.current.key,
      );
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      open
      title={t(
        initial.entryId ? "libraries.editContent" : "libraries.newDocument",
      )}
      width={800}
      onCancel={close}
      closable={!pending}
      mask={{ closable: false }}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {t("libraries.documentDraftHint")}
          </span>
          <div className="flex gap-2">
            <Button disabled={pending} onClick={close}>
              {t("libraries.cancel")}
            </Button>
            <Button
              type="primary"
              loading={pending}
              disabled={!name.trim() || !text.trim() || tooLarge || !dirty}
              onClick={() => void apply()}
            >
              {t("libraries.applyDocument")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3 py-2">
        {!initial.entryId && (
          <label className="grid gap-2 text-sm">
            {t("libraries.documentName")}
            <KanvasInput
              autoFocus
              value={name}
              maxLength={230}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {initial.entryId ? (
            <span className="truncate text-sm text-muted">{initial.name}</span>
          ) : (
            <Segmented
              disabled={pending}
              value={mediaType}
              onChange={setMediaType}
              options={[
                { value: "text/markdown", label: "Markdown" },
                { value: "text/plain", label: t("libraries.plainText") },
              ]}
            />
          )}
          <Segmented
            size="small"
            value={mode}
            onChange={setMode}
            options={[
              { value: "edit", label: t("agent.authoring.write") },
              { value: "preview", label: t("agent.authoring.preview") },
            ]}
          />
        </div>
        {mode === "edit" ? (
          <KanvasTextArea
            aria-label={t("libraries.documentContent")}
            value={text}
            disabled={pending}
            onChange={(event) => setText(event.target.value)}
            autoSize={{ minRows: 14, maxRows: 22 }}
          />
        ) : (
          <div className="min-h-64 max-h-[55vh] overflow-auto p-2">
            <LibraryTextContent
              text={text}
              markdown={mediaType === "text/markdown"}
            />
          </div>
        )}
        {tooLarge && (
          <Alert
            type="error"
            showIcon
            title={t("libraries.documentTooLarge")}
          />
        )}
        {failed && (
          <Alert type="error" showIcon title={t("libraries.documentFailed")} />
        )}
      </div>
    </Modal>
  );
}
