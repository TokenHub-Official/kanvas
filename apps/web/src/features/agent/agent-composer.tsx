import {
  ReadOutlined,
  ArrowUpOutlined,
  BgColorsOutlined,
  BranchesOutlined,
  CloseOutlined,
  ExclamationCircleOutlined,
  FileImageOutlined,
  LayoutOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Button, Image, Popover } from "antd";
import { useTranslation } from "react-i18next";
import { ArtifactPreview } from "../../components/artifact-preview.js";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { cn } from "../../lib/cn.js";
import { focusAgentComposer } from "./agent-focus.js";
import type {
  AgentComposerReference,
  AgentComposerReferenceKind,
} from "./agent-composer-reference-picker.js";

export interface AgentComposerAttachment {
  readonly id: string;
  readonly artifactId?: string;
  readonly name: string;
  readonly previewUrl: string;
  readonly progress: number;
  readonly status: "error" | "ready" | "uploading";
}

const acceptedImageTypes = "image/jpeg,image/png,image/webp";
const imeProcessingKeyCode = 229;

export function agentComposerKeyboardAction(input: {
  readonly key: string;
  readonly keyCode: number;
  readonly composing: boolean;
  readonly control: boolean;
  readonly meta: boolean;
  readonly shift?: boolean;
}): "none" | "newline" | "send" {
  if (
    input.key !== "Enter" ||
    input.composing ||
    input.keyCode === imeProcessingKeyCode
  ) {
    return "none";
  }
  return input.shift || input.meta || input.control ? "newline" : "send";
}

function attachmentLabel(
  attachment: AgentComposerAttachment,
  uploadingLabel: string,
  errorLabel: string,
): string {
  if (attachment.status === "uploading") {
    return `${uploadingLabel} ${String(attachment.progress)}%`;
  }
  return attachment.status === "error" ? errorLabel : attachment.name;
}

export function agentComposerImageFiles(files: FileList | readonly File[]) {
  return [...files].filter(
    (file) =>
      file.size > 0 &&
      ["image/jpeg", "image/png", "image/webp"].includes(file.type),
  );
}

export function agentComposerHasFilePayload(
  dataTransfer: Pick<DataTransfer, "types">,
): boolean {
  return Array.from(dataTransfer.types).includes("Files");
}

export function agentComposerCanSubmit(input: {
  readonly attachmentBusy: boolean;
  readonly queueMode: boolean;
  readonly running: boolean;
  readonly sendBlocked: boolean;
  readonly value: string;
}): boolean {
  return (
    (!input.running || input.queueMode) &&
    !input.sendBlocked &&
    input.value.trim().length > 0
  );
}

export function AgentComposer({
  workspaceId,
  addAttachmentLabel,
  addFileLabel,
  ariaLabel,
  attachments = [],
  availableReferenceKinds = [],
  className,
  disabled = false,
  errorLabel,
  inputRef: controlledInputRef,
  onChange,
  onFiles,
  onOpenReferencePicker,
  onRemoveAttachment,
  onRemoveReference,
  onSend,
  onStop,
  placeholder,
  queueMode = false,
  removeAttachmentLabel,
  removeReferenceLabel,
  references = [],
  referenceKindLabels,
  sendBlocked = false,
  sendLabel,
  stopLabel,
  running = false,
  uploadingLabel,
  value,
}: {
  readonly workspaceId?: string;
  readonly addAttachmentLabel: string;
  readonly addFileLabel?: string;
  readonly ariaLabel: string;
  readonly attachments?: readonly AgentComposerAttachment[];
  readonly availableReferenceKinds?: readonly AgentComposerReferenceKind[];
  readonly className?: string;
  readonly disabled?: boolean;
  readonly errorLabel: string;
  readonly inputRef?: RefObject<HTMLTextAreaElement | null>;
  readonly onChange: (value: string) => void;
  readonly onFiles?: (files: readonly File[]) => void;
  readonly onOpenReferencePicker?: (kind: AgentComposerReferenceKind) => void;
  readonly onRemoveAttachment?: (id: string) => void;
  readonly onRemoveReference?: (id: string) => void;
  readonly onSend: () => void;
  readonly onStop?: () => void;
  readonly placeholder: string;
  readonly queueMode?: boolean;
  readonly removeAttachmentLabel: string;
  readonly removeReferenceLabel?: string;
  readonly references?: readonly AgentComposerReference[];
  readonly referenceKindLabels?: Readonly<
    Partial<Record<AgentComposerReferenceKind, string>>
  >;
  readonly sendBlocked?: boolean;
  readonly sendLabel: string;
  readonly stopLabel?: string;
  readonly running?: boolean;
  readonly uploadingLabel: string;
  readonly value: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const fallbackInputRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = controlledInputRef ?? fallbackInputRef;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<string>();
  const pendingDraftRef = useRef<string | undefined>(undefined);
  const draftIdentity = JSON.stringify([
    workspaceId,
    value,
    attachments.map(({ id }) => id),
    references,
  ]);
  const attachmentError = attachments.some(
    (attachment) => attachment.status === "error",
  );
  const waitingForUploads = pendingDraft !== undefined;
  const attachmentBusy = attachments.some(
    (attachment) => attachment.status === "uploading",
  );
  const canSubmit = agentComposerCanSubmit({
    attachmentBusy,
    queueMode,
    running,
    sendBlocked: sendBlocked || disabled || attachmentError,
    value,
  });

  function cancelPendingSend(): void {
    pendingDraftRef.current = undefined;
    setPendingDraft(undefined);
  }

  function requestSend(): void {
    if (!canSubmit || pendingDraftRef.current !== undefined) return;
    if (attachmentBusy) {
      pendingDraftRef.current = draftIdentity;
      setPendingDraft(draftIdentity);
      setAddMenuOpen(false);
      return;
    }
    onSend();
  }

  useEffect(() => {
    if (pendingDraft === undefined) return;
    // Schedule after the host has committed the latest attachment references.
    // Cleanup cancels a stale send when the draft, permissions or route changes.
    const timer = window.setTimeout(() => {
      if (pendingDraftRef.current === undefined) return;
      if (pendingDraftRef.current !== draftIdentity || !canSubmit) {
        cancelPendingSend();
        return;
      }
      if (attachmentBusy) return;
      // Consume before invoking the host so rerenders cannot resend.
      cancelPendingSend();
      onSend();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [attachmentBusy, canSubmit, draftIdentity, onSend, pendingDraft]);

  useEffect(() => {
    if (!addMenuOpen) return;
    requestAnimationFrame(() =>
      menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus(),
    );
  }, [addMenuOpen]);

  function referenceIcon(kind: AgentComposerReference["kind"]) {
    if (kind === "library") return <ReadOutlined aria-hidden="true" />;
    if (kind === "brand") return <BgColorsOutlined aria-hidden="true" />;
    if (kind === "canvas") return <LayoutOutlined aria-hidden="true" />;
    if (kind === "workflow") return <BranchesOutlined aria-hidden="true" />;
    if (kind === "skill") return <ReadOutlined aria-hidden="true" />;
    return <FileImageOutlined aria-hidden="true" />;
  }

  function openReferencePicker(kind: AgentComposerReferenceKind): void {
    cancelPendingSend();
    setAddMenuOpen(false);
    if (value === "/") onChange("");
    onOpenReferencePicker?.(kind);
  }

  function moveAddMenuFocus(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    const items = [...(menuRef.current?.querySelectorAll("button") ?? [])];
    if (items.length === 0) return;
    if (event.key === "Escape") {
      setAddMenuOpen(false);
      focusAgentComposer(inputRef.current);
      event.preventDefault();
      return;
    }
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = (index + 1) % items.length;
        break;
      case "ArrowUp":
        next = (index - 1 + items.length) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    items[next]?.focus();
    event.preventDefault();
  }

  function insertNewline(event: KeyboardEvent<HTMLTextAreaElement>): void {
    cancelPendingSend();
    const input = event.currentTarget;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    onChange(`${value.slice(0, start)}\n${value.slice(end)}`);
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(start + 1, start + 1);
    });
  }

  function selectImageFiles(event: ChangeEvent<HTMLInputElement>): void {
    const files = agentComposerImageFiles(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) {
      cancelPendingSend();
      onFiles?.(files);
    }
  }

  function removeAttachment(id: string) {
    cancelPendingSend();
    onRemoveAttachment?.(id);
  }
  function removeReference(id: string) {
    cancelPendingSend();
    onRemoveReference?.(id);
  }
  function chooseImageFiles() {
    setAddMenuOpen(false);
    if (value === "/") onChange("");
    fileInputRef.current?.click();
  }
  function changeMessage(event: React.ChangeEvent<HTMLTextAreaElement>) {
    cancelPendingSend();
    const nextValue = event.target.value;
    onChange(nextValue);
    if (nextValue === "/") setAddMenuOpen(true);
    else if (addMenuOpen) setAddMenuOpen(false);
  }
  function handleMessageKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (event.key === "Escape" && waitingForUploads) {
      event.preventDefault();
      cancelPendingSend();
      return;
    }
    if (event.key === "Escape" && addMenuOpen) {
      event.preventDefault();
      setAddMenuOpen(false);
      return;
    }
    const action = agentComposerKeyboardAction({
      key: event.key,
      keyCode: event.keyCode,
      composing: event.nativeEvent.isComposing,
      control: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
    });
    if (action === "none") return;
    event.preventDefault();
    if (action === "newline") {
      insertNewline(event);
      return;
    }
    requestSend();
  }
  function pasteImages(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = agentComposerImageFiles(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    cancelPendingSend();
    onFiles?.(files);
  }
  function stopRun() {
    onStop?.();
    requestAnimationFrame(() => focusAgentComposer(inputRef.current));
  }
  return (
    <div
      aria-busy={attachmentBusy}
      className={cn(
        "grid w-full gap-1 rounded-[16px] border border-line bg-paper p-2 shadow-[0_1px_2px_rgb(35_32_68_/_6%)] transition-[border-color,box-shadow] duration-160 focus-within:border-primary focus-within:shadow-[0_0_0_2px_rgb(48_72_245_/_10%)] motion-reduce:transition-none",
        className,
      )}
    >
      <div className="grid max-h-48 gap-2 overflow-y-auto px-1 pt-1 pb-0.5 empty:hidden">
        {attachments.length > 0 ? (
          <div className="flex flex-wrap items-start gap-2">
            {attachments.map((attachment) => (
              <div
                aria-label={attachmentLabel(
                  attachment,
                  uploadingLabel,
                  errorLabel,
                )}
                className={cn(
                  "group relative grid w-28 shrink-0 overflow-hidden rounded-control bg-mist ring-1 ring-line",
                  attachment.status === "error" && "ring-danger-border",
                )}
                key={attachment.id}
                role="group"
                title={attachment.name}
              >
                {attachment.previewUrl ? (
                  <Image
                    alt={attachment.name}
                    classNames={{
                      root: "!block !h-18 !w-full",
                      image: "!h-full !w-full object-cover",
                    }}
                    src={attachment.previewUrl}
                  />
                ) : null}
                {!attachment.previewUrl &&
                attachment.artifactId &&
                workspaceId ? (
                  <ArtifactPreview
                    alt={attachment.name}
                    artifactId={attachment.artifactId}
                    workspaceId={workspaceId}
                    thumbnail
                    previewable
                    className="block h-18 w-full"
                    imageClassName="size-full object-cover"
                  />
                ) : null}
                {!attachment.previewUrl &&
                (!attachment.artifactId || !workspaceId) ? (
                  <span className="grid h-18 w-full place-items-center bg-paper text-lg text-primary">
                    <FileImageOutlined aria-hidden="true" />
                  </span>
                ) : null}
                {attachment.status === "uploading" ? (
                  <span className="absolute inset-x-0 top-0 grid h-18 place-items-center bg-ink/12 text-white">
                    <LoadingOutlined aria-hidden="true" spin />
                  </span>
                ) : null}
                {attachment.status === "error" ? (
                  <span className="absolute inset-x-0 top-0 grid h-18 place-items-center bg-danger-surface/85 text-danger">
                    <ExclamationCircleOutlined aria-hidden="true" />
                  </span>
                ) : null}
                {attachment.status === "uploading" ? (
                  <span
                    role="progressbar"
                    aria-label={uploadingLabel}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={attachment.progress}
                    className="relative h-1 overflow-hidden bg-primary/15"
                  >
                    <span
                      className="block h-full origin-left bg-primary transition-transform duration-120 motion-reduce:transition-none"
                      style={{
                        transform: `scaleX(${String(attachment.progress / 100)})`,
                      }}
                    />
                  </span>
                ) : null}
                <span
                  className={cn(
                    "bg-paper px-2 py-1 text-[11px] leading-4 text-ink",
                    attachment.status === "ready"
                      ? "truncate"
                      : "whitespace-normal break-words",
                  )}
                  role="status"
                >
                  {attachmentLabel(attachment, uploadingLabel, errorLabel)}
                </span>
                <button
                  aria-label={`${removeAttachmentLabel}: ${attachment.name}`}
                  className="absolute top-1 right-1 z-20 grid size-6 place-items-center rounded-full border-0 bg-paper/92 p-0 text-ink shadow-[0_1px_4px_rgb(35_32_68_/_18%)] transition-transform active:scale-[0.92] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary motion-reduce:transform-none"
                  onClick={() => removeAttachment(attachment.id)}
                  title={removeAttachmentLabel}
                  type="button"
                >
                  <CloseOutlined aria-hidden="true" className="text-[8px]" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {references.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-1 pt-1">
            {references.map((reference) => (
              <div
                className={cn(
                  "inline-flex max-w-full items-center gap-2 rounded-control bg-mist px-2 py-1.5 text-sm text-ink",
                  (reference.kind === "asset" ||
                    reference.kind === "artifact") &&
                    "w-60",
                )}
                key={reference.id}
              >
                {(reference.kind === "asset" ||
                  reference.kind === "artifact") &&
                workspaceId ? (
                  <ArtifactPreview
                    alt={reference.title}
                    artifactId={reference.artifactId}
                    workspaceId={workspaceId}
                    thumbnail
                    previewable
                    className="block size-12 shrink-0 overflow-hidden rounded-[6px]"
                    imageClassName="size-full object-cover"
                  />
                ) : (
                  <span className="shrink-0 text-primary">
                    {referenceIcon(reference.kind)}
                  </span>
                )}
                <Popover
                  trigger="click"
                  title={reference.title}
                  content={
                    <div className="max-w-72 whitespace-pre-wrap break-words text-sm">
                      {reference.description ??
                        (reference.kind === "artifact"
                          ? reference.title
                          : referenceKindLabels?.[reference.kind])}
                    </div>
                  }
                >
                  <button
                    type="button"
                    className="min-w-0 max-w-80 border-0 bg-transparent p-0 text-left text-ink focus-visible:outline-2 focus-visible:outline-primary"
                    title={reference.title}
                  >
                    {reference.kind !== "asset" &&
                    reference.kind !== "artifact" ? (
                      <span className="mr-1.5 text-xs text-muted">
                        {referenceKindLabels?.[reference.kind]}
                      </span>
                    ) : null}
                    <span className="break-words">{reference.title}</span>
                  </button>
                </Popover>
                <button
                  aria-label={`${removeReferenceLabel ?? removeAttachmentLabel}: ${reference.title}`}
                  className="ml-auto grid size-6 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0 text-muted hover:bg-mist-deep hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
                  onClick={() => removeReference(reference.id)}
                  type="button"
                >
                  <CloseOutlined aria-hidden="true" className="text-[10px]" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <span className="sr-only" role="status">
        {waitingForUploads ? t("agent.waitingForUploads") : ""}
      </span>
      <div className="relative flex min-w-0 items-end gap-1">
        <input
          accept={acceptedImageTypes}
          hidden
          multiple
          onChange={selectImageFiles}
          ref={fileInputRef}
          type="file"
        />
        <Button
          aria-label={addAttachmentLabel}
          className="grid size-10 min-w-10 place-items-center rounded-[10px] p-0"
          aria-expanded={addMenuOpen}
          aria-haspopup="menu"
          disabled={
            disabled || (!onFiles && availableReferenceKinds.length === 0)
          }
          icon={<PlusOutlined />}
          onClick={() => setAddMenuOpen((open) => !open)}
          type="text"
        />
        {addMenuOpen ? (
          <div
            className="absolute bottom-12 left-0 z-20 grid min-w-56 gap-0.5 rounded-[14px] bg-paper p-1.5 shadow-[0_12px_36px_rgb(35_32_68_/_16%)] ring-1 ring-line"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setAddMenuOpen(false);
              }
            }}
            ref={menuRef}
            role="menu"
          >
            {onFiles ? (
              <button
                className="flex items-center gap-3 rounded-[10px] border-0 bg-transparent px-3 py-2.5 text-left text-sm text-ink hover:bg-mist focus-visible:bg-mist focus-visible:outline-3 focus-visible:outline-primary"
                onClick={chooseImageFiles}
                onKeyDown={(event) => moveAddMenuFocus(event, 0)}
                role="menuitem"
                type="button"
              >
                <PaperClipOutlined aria-hidden="true" />
                {addFileLabel ?? addAttachmentLabel}
              </button>
            ) : null}
            {availableReferenceKinds.map((kind, kindIndex) => (
              <button
                className="flex items-center gap-3 rounded-[10px] border-0 bg-transparent px-3 py-2.5 text-left text-sm text-ink hover:bg-mist focus-visible:bg-mist focus-visible:outline-3 focus-visible:outline-primary"
                key={kind}
                onClick={() => openReferencePicker(kind)}
                onKeyDown={(event) =>
                  moveAddMenuFocus(event, kindIndex + (onFiles ? 1 : 0))
                }
                role="menuitem"
                type="button"
              >
                {referenceIcon(kind)}
                {referenceKindLabels?.[kind] ?? kind}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          id="agent-composer-input"
          aria-label={ariaLabel}
          className="max-h-44 min-h-10 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-2.5 text-sm leading-5.5 text-ink outline-none [field-sizing:content] placeholder:text-muted"
          disabled={disabled}
          onChange={changeMessage}
          onKeyDown={handleMessageKeyDown}
          onPaste={pasteImages}
          placeholder={placeholder}
          ref={inputRef}
          rows={1}
          value={value}
        />
        {running ? (
          <Button
            aria-label={stopLabel ?? sendLabel}
            className="grid size-10 min-w-10 place-items-center rounded-[10px] p-0"
            disabled={!onStop}
            icon={
              <span
                aria-hidden="true"
                className="size-3 rounded-[2px] bg-current"
              />
            }
            onClick={stopRun}
            title={stopLabel ?? sendLabel}
            type="text"
          />
        ) : null}
        {waitingForUploads ? (
          <Button
            aria-label={t("agent.cancelPendingSend")}
            className="h-10 min-w-10 shrink-0 rounded-control p-0"
            icon={<CloseOutlined />}
            onClick={cancelPendingSend}
            title={t("agent.cancelPendingSend")}
            type="primary"
          />
        ) : null}
        {!waitingForUploads &&
        (!running || (queueMode && value.trim().length > 0)) ? (
          <Button
            aria-label={sendLabel}
            className="h-10 min-w-10 shrink-0 rounded-control p-0"
            disabled={disabled || !canSubmit}
            icon={<ArrowUpOutlined />}
            onClick={requestSend}
            title={sendLabel}
            type="primary"
          />
        ) : null}
      </div>
    </div>
  );
}
