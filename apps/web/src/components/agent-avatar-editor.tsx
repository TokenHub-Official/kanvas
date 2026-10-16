import { EditOutlined } from "@ant-design/icons";
import type { AgentHubAgentAvatar } from "@kanvas/contracts/api";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  allocateUserImport,
  commitUserImport,
  uploadUserImport,
} from "../api/transport.js";
import { AgentAvatar } from "./agent-avatar.js";
import { VisualIdentityModal } from "./visual-identity-modal.js";
import {
  VisualIdentityPicker,
  type CropPosition,
} from "./visual-identity-picker.js";

const defaultAvatarColor = "#EEF2FF";
import { squareAvatarFile } from "./visual-identity-image.js";
export { centeredSquareCrop } from "./visual-identity-image.js";

export function AgentAvatarEditor({
  canUpload,
  canReadAssets,
  csrfToken,
  disabled = false,
  onChange,
  value,
  workspaceId,
}: {
  readonly canUpload: boolean;
  readonly canReadAssets: boolean;
  readonly csrfToken: string;
  readonly disabled?: boolean;
  readonly onChange?: (value: AgentHubAgentAvatar) => void;
  readonly value?: AgentHubAgentAvatar;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const choicesRef = useRef<
    Partial<Record<"emoji" | "icon" | "image", AgentHubAgentAvatar>>
  >({});
  const [uploading, setUploading] = useState(false);
  const [pendingImage, setPendingImage] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AgentHubAgentAvatar>();
  const [activeKind, setActiveKind] = useState<"emoji" | "icon" | "image">(
    "icon",
  );
  const [error, setError] = useState<string>();
  const visualAvatar =
    draft ??
    value ??
    ({
      kind: "icon",
      value: "robot",
      backgroundColor: defaultAvatarColor,
    } as const);
  const avatarChanged =
    Boolean(draft) && JSON.stringify(draft) !== JSON.stringify(value);
  const backgroundColor =
    visualAvatar.kind === "image"
      ? defaultAvatarColor
      : visualAvatar.backgroundColor;

  function showEditor(): void {
    setDraft(value);
    setPendingImage(false);
    choicesRef.current = value ? { [value.kind]: value } : {};
    setActiveKind(value?.kind ?? "icon");
    setError(undefined);
    setOpen(true);
  }
  function closeEditor(): void {
    if (!uploading) setOpen(false);
  }
  function applyAvatar(): void {
    if (
      disabled ||
      uploading ||
      (activeKind === "image" && (pendingImage || !canUpload))
    )
      return;
    if (draft && avatarChanged) onChange?.(draft);
    setOpen(false);
  }
  function selectKind(nextKind: "emoji" | "icon" | "image"): void {
    setActiveKind(nextKind);
    const previous = choicesRef.current[nextKind];
    if (previous) {
      setDraft(previous);
    } else if (nextKind === "icon") {
      setDraft({ kind: "icon", value: "robot", backgroundColor });
    } else if (nextKind === "emoji") {
      setDraft({ kind: "emoji", value: "✨", backgroundColor });
    } else {
      setDraft(value?.kind === "image" ? value : undefined);
    }
  }
  function selectAvatar(next: AgentHubAgentAvatar): void {
    choicesRef.current[next.kind] = next;
    setDraft(next);
  }

  async function upload(file: File, position: CropPosition): Promise<boolean> {
    if (!canUpload || disabled) return false;
    setUploading(true);
    setError(undefined);
    try {
      const cropped = await squareAvatarFile(file, position);
      const idempotencyKey = `agent-avatar:${crypto.randomUUID()}`;
      const allocation = await allocateUserImport(
        { csrfToken, workspaceId },
        {
          expectedMediaType: "image/webp",
          expectedSize: String(cropped.size),
        },
        idempotencyKey,
      );
      await uploadUserImport(
        { csrfToken, workspaceId },
        allocation.uploadSessionId,
        cropped,
      );
      const committed = await commitUserImport(
        { csrfToken, workspaceId },
        allocation.uploadSessionId,
        {
          artifactType: "image.agent-avatar",
          dataClassification: "internal",
          displayFilename: cropped.name,
          metadata: { importedFrom: "agent-profile" },
          asset: {
            name: t("agent.hub.avatarAssetName"),
            assetType: "image.agent-avatar",
          },
        },
      );
      if (!committed.assetId) throw new Error("Avatar asset was not created.");
      selectAvatar({ kind: "image", assetId: committed.assetId });
      return true;
    } catch {
      setError(t("agent.hub.avatarUploadError"));
      return false;
    } finally {
      setUploading(false);
    }
  }
  return (
    <>
      <button
        type="button"
        aria-label={t("agent.editor.editAvatar")}
        aria-haspopup="dialog"
        disabled={disabled || uploading}
        onClick={showEditor}
        className="group relative cursor-pointer rounded-[16px] border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:cursor-default"
      >
        <AgentAvatar
          alt={t("agent.hub.avatar")}
          {...(value ? { avatar: value } : {})}
          canReadAssets={canReadAssets}
          workspaceId={workspaceId}
          className="size-16 rounded-[16px] text-2xl"
        />
        {!disabled && (
          <span className="absolute -right-1 -bottom-1 grid size-6 place-items-center rounded-full bg-paper text-xs text-muted shadow-sm transition-colors group-hover:bg-primary group-hover:text-white">
            <EditOutlined />
          </span>
        )}
      </button>
      <VisualIdentityModal
        applyDisabled={
          disabled || !avatarChanged || (activeKind === "image" && pendingImage)
        }
        applyLabel={t("agent.editor.apply")}
        busy={uploading}
        cancelLabel={t("agent.cancel")}
        open={open}
        onCancel={closeEditor}
        onApply={applyAvatar}
        title={t("agent.editor.editAvatar")}
        width={520}
      >
        <div className="py-1">
          <VisualIdentityPicker
            canUpload={canUpload}
            disabled={disabled}
            kind={activeKind}
            onChange={selectAvatar}
            onKindChange={selectKind}
            onPendingImageChange={setPendingImage}
            onUpload={upload}
            uploading={uploading}
            value={visualAvatar}
            preview={
              <AgentAvatar
                alt={t("agent.hub.avatarPreview")}
                avatar={visualAvatar}
                canReadAssets={canReadAssets}
                workspaceId={workspaceId}
                className="size-[72px] rounded-2xl text-4xl"
              />
            }
          />
          {error ? (
            <div role="alert" className="mt-3 text-sm text-danger">
              {error}
            </div>
          ) : null}
        </div>
      </VisualIdentityModal>
    </>
  );
}
