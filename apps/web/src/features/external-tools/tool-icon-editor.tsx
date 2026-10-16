import type {
  AgentHubAgentAvatar,
  VisualIdentitySymbol,
} from "@kanvas/contracts/api";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { VisualIdentityModal } from "../../components/visual-identity-modal.js";
import {
  VisualIdentityPicker,
  type CropPosition,
} from "../../components/visual-identity-picker.js";
import { VisualIdentityMark } from "../../components/visual-identity-symbol.js";
import { squareAvatarFile } from "../../components/visual-identity-image.js";

export type ToolIconSelection =
  | { readonly kind: "symbol"; readonly value: VisualIdentitySymbol }
  | { readonly kind: "file"; readonly file: File };

/** Mounted only while open; applying updates the tool draft, saving persists it. */
export function ToolIconEditor({
  symbol,
  hasImage,
  imagePreview,
  onCancel,
  onConfirm,
}: {
  readonly symbol: VisualIdentitySymbol | null | undefined;
  readonly hasImage: boolean;
  readonly imagePreview: ReactNode;
  readonly onCancel: () => void;
  readonly onConfirm: (selection: ToolIconSelection) => Promise<boolean>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const initial: AgentHubAgentAvatar =
    symbol ??
    (hasImage
      ? { kind: "image", assetId: "current" }
      : { kind: "icon", value: "robot", backgroundColor: "#EEF2FF" });
  const [draft, setDraft] = useState(initial);
  const [kind, setKind] = useState(initial.kind);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingImage, setPendingImage] = useState(false);
  const [imageFile, setImageFile] = useState<File>();
  const [imageUrl, setImageUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const choicesRef = useRef<
    Partial<Record<AgentHubAgentAvatar["kind"], AgentHubAgentAvatar>>
  >({ [initial.kind]: initial });
  useEffect(
    () => (imageUrl ? () => URL.revokeObjectURL(imageUrl) : undefined),
    [imageUrl],
  );
  function select(value: AgentHubAgentAvatar): void {
    choicesRef.current[value.kind] = value;
    setDraft(value);
    setChanged(true);
  }
  function changeKind(next: AgentHubAgentAvatar["kind"]): void {
    setKind(next);
    setError(undefined);
    const previous = choicesRef.current[next];
    if (previous) select(previous);
    else if (next === "image") setChanged(false);
    else
      select(
        next === "emoji"
          ? {
              kind: "emoji",
              value: "✨",
              backgroundColor:
                draft.kind === "image" ? "#EEF2FF" : draft.backgroundColor,
            }
          : {
              kind: "icon",
              value: "robot",
              backgroundColor:
                draft.kind === "image" ? "#EEF2FF" : draft.backgroundColor,
            },
      );
  }
  async function prepareImage(
    file: File,
    position: CropPosition,
  ): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      const cropped = await squareAvatarFile(file, position);
      setImageFile(cropped);
      setImageUrl(URL.createObjectURL(cropped));
      select({ kind: "image", assetId: "pending" });
      return true;
    } catch {
      setError(t("agent.hub.avatarUploadError"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const hasChange =
    changed &&
    (draft.kind === "image"
      ? Boolean(imageFile)
      : JSON.stringify(draft) !== JSON.stringify(initial));
  async function apply(): Promise<void> {
    if (busy || !hasChange || (kind === "image" && pendingImage)) return;
    if (draft.kind === "image" && !imageFile) return;
    setBusy(true);
    try {
      const saved = await onConfirm(
        draft.kind === "image"
          ? { kind: "file", file: imageFile! }
          : { kind: "symbol", value: draft },
      );
      if (saved) onCancel();
      else setError(t("agent.hub.avatarUploadError"));
    } catch {
      setError(t("agent.hub.avatarUploadError"));
    } finally {
      setBusy(false);
    }
  }
  const preview =
    draft.kind === "image" ? (
      <span className="grid size-[72px] shrink-0 overflow-hidden rounded-2xl bg-mist">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={t("studio.tools.logo")}
            className="size-full object-contain"
          />
        ) : (
          imagePreview
        )}
      </span>
    ) : (
      <VisualIdentityMark
        value={draft}
        alt={t("studio.tools.logo")}
        className="size-[72px] rounded-2xl text-4xl"
      />
    );
  return (
    <VisualIdentityModal
      open
      title={t("studio.tools.editor.changeIcon")}
      busy={busy}
      cancelLabel={t("common.cancel")}
      applyLabel={t("agent.editor.apply")}
      applyDisabled={
        !hasChange || (kind === "image" && (pendingImage || !imageFile))
      }
      onApply={() => void apply()}
      onCancel={() => {
        if (!busy) onCancel();
      }}
    >
      <VisualIdentityPicker
        canUpload
        disabled={false}
        kind={kind}
        onChange={select}
        onKindChange={changeKind}
        onPendingImageChange={setPendingImage}
        onUpload={prepareImage}
        uploading={busy}
        value={draft}
        preview={preview}
      />
      {error ? (
        <div role="alert" className="mt-3 text-sm text-danger">
          {error}
        </div>
      ) : null}
    </VisualIdentityModal>
  );
}
