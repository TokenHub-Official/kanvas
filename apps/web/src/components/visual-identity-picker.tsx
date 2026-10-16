import {
  BgColorsOutlined,
  SearchOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type { AgentHubAgentAvatar } from "@kanvas/contracts/api";
import { Button, ColorPicker, Empty, Input, Segmented, Spin } from "antd";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { visualIdentityIconOptions } from "./visual-identity-symbol.js";

const EmojiPicker = lazy(() => import("./agent-emoji-picker.js"));

export const identityBackgroundColors = [
  "#EEF2FF",
  "#E8E5FF",
  "#FBE6EF",
  "#FFE8D8",
  "#FFF3D6",
  "#E3F4E8",
  "#DDF3F5",
  "#EAECEF",
  "#202437",
] as const;

export const identityForegroundColors = [
  "#3048F5",
  "#7451CC",
  "#D34C77",
  "#B05E22",
  "#18795B",
  "#151515",
  "#FFFFFF",
] as const;

export type CropPosition = "top" | "center" | "bottom" | "left" | "right";

const cropPositions: readonly CropPosition[] = [
  "top",
  "left",
  "center",
  "right",
  "bottom",
];

/** Reusable visual mark controls. Persistence and upload authority belong to the caller. */
export function VisualIdentityPicker({
  canUpload,
  disabled,
  kind,
  onChange,
  onKindChange,
  onPendingImageChange,
  onUpload,
  uploading,
  value,
  preview,
}: {
  readonly canUpload: boolean;
  readonly disabled: boolean;
  readonly kind: "emoji" | "icon" | "image";
  readonly onChange: (value: AgentHubAgentAvatar) => void;
  readonly onKindChange: (kind: "emoji" | "icon" | "image") => void;
  readonly onPendingImageChange: (pending: boolean) => void;
  readonly onUpload: (file: File, position: CropPosition) => Promise<boolean>;
  readonly uploading: boolean;
  readonly value: AgentHubAgentAvatar;
  readonly preview: ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [file, setFile] = useState<File>();
  const [fileUrl, setFileUrl] = useState<string>();
  const [cropPosition, setCropPosition] = useState<CropPosition>("center");
  const backgroundColor =
    value.kind === "image"
      ? identityBackgroundColors[0]
      : value.backgroundColor;
  const foregroundColor =
    value.kind === "icon" ? (value.foregroundColor ?? "#3048F5") : "#3048F5";

  useEffect(() => {
    if (fileUrl) return () => URL.revokeObjectURL(fileUrl);
    return undefined;
  }, [fileUrl]);

  function changeBackground(color: string): void {
    if (value.kind === "icon") {
      const wasDark = value.backgroundColor.toUpperCase() === "#202437";
      const isDark = color.toUpperCase() === "#202437";
      const usesDefaultColor =
        value.foregroundColor === undefined ||
        value.foregroundColor.toUpperCase() ===
          (wasDark ? "#FFFFFF" : "#3048F5");
      onChange({
        ...value,
        backgroundColor: color,
        ...(usesDefaultColor
          ? { foregroundColor: isDark ? "#FFFFFF" : "#3048F5" }
          : {}),
      });
    } else if (value.kind === "emoji") {
      onChange({ ...value, backgroundColor: color });
    }
  }
  function changeForeground(color: string): void {
    if (value.kind === "icon") onChange({ ...value, foregroundColor: color });
  }
  function selectFile(event: ChangeEvent<HTMLInputElement>): void {
    const nextFile = event.target.files?.[0];
    setFile(nextFile);
    onPendingImageChange(Boolean(nextFile));
    setFileUrl(nextFile ? URL.createObjectURL(nextFile) : undefined);
    setCropPosition("center");
    event.target.value = "";
  }
  const filteredIcons = visualIdentityIconOptions.filter((option) =>
    `${option.value} ${t(`agent.hub.avatarIcon.${option.value}`)}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-4 py-1">
        {preview}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">
            {t("agent.editor.avatarLivePreview")}
          </div>
          <div className="mt-1 text-xs text-muted">
            {t("agent.editor.avatarPreviewHint")}
          </div>
        </div>
      </div>

      <Segmented
        block
        disabled={disabled || uploading}
        options={[
          { label: t("agent.hub.avatarKind.emoji"), value: "emoji" },
          { label: t("agent.hub.avatarKind.icon"), value: "icon" },
          ...(canUpload
            ? [{ label: t("agent.hub.avatarKind.image"), value: "image" }]
            : []),
        ]}
        value={kind}
        onChange={(next) => onKindChange(next as "emoji" | "icon" | "image")}
      />

      {kind !== "image" && value.kind !== "image" ? (
        <div className="grid gap-4">
          <ColorRow
            color={backgroundColor}
            colors={identityBackgroundColors}
            disabled={disabled || uploading}
            label={t("agent.hub.avatarBackground")}
            onChange={changeBackground}
          />
          {kind === "icon" && value.kind === "icon" ? (
            <ColorRow
              color={foregroundColor}
              colors={identityForegroundColors}
              disabled={disabled || uploading}
              label={t("agent.editor.avatarIconColor")}
              onChange={changeForeground}
            />
          ) : null}
        </div>
      ) : null}

      {kind === "emoji" ? (
        <Suspense
          fallback={
            <div className="grid h-72 place-items-center">
              <Spin />
            </div>
          }
        >
          <EmojiPicker
            {...(value.kind === "emoji" ? { selectedEmoji: value.value } : {})}
            disabled={disabled || uploading}
            onSelect={(emoji) =>
              onChange({ kind: "emoji", value: emoji, backgroundColor })
            }
          />
        </Suspense>
      ) : null}

      {kind === "icon" ? (
        <div className="grid gap-3">
          <div className="sticky top-0 z-10 bg-paper pb-2">
            <Input
              allowClear
              aria-label={t("agent.editor.searchAvatarIcons")}
              placeholder={t("agent.editor.searchAvatarIcons")}
              prefix={<SearchOutlined />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {value.kind === "icon" &&
            !filteredIcons.some((item) => item.value === value.value) ? (
              <Button type="link" size="small" onClick={() => setSearch("")}>
                {t("common.visualPicker.locate")}
              </Button>
            ) : null}
          </div>
          {filteredIcons.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-1 p-1">
              {filteredIcons.map((option) => {
                const selected =
                  value.kind === "icon" && value.value === option.value;
                return (
                  <button
                    aria-label={t(`agent.hub.avatarIcon.${option.value}`)}
                    aria-pressed={selected}
                    className="grid size-12 cursor-pointer place-items-center rounded-xl border-0 bg-transparent text-2xl text-muted transition-colors hover:bg-mist hover:text-ink focus-visible:outline-2 focus-visible:outline-primary data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
                    data-active={selected}
                    disabled={disabled || uploading}
                    key={option.value}
                    title={t(`agent.hub.avatarIcon.${option.value}`)}
                    type="button"
                    onClick={() =>
                      onChange({
                        kind: "icon",
                        value: option.value,
                        backgroundColor,
                        ...(value.kind === "icon" && value.foregroundColor
                          ? { foregroundColor: value.foregroundColor }
                          : {}),
                      })
                    }
                  >
                    {option.icon}
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("agent.editor.noMatches")}
            />
          )}
        </div>
      ) : null}

      {canUpload && kind === "image" ? (
        <div className="grid gap-3">
          <input
            accept="image/jpeg,image/png,image/webp"
            hidden
            ref={inputRef}
            type="file"
            onChange={selectFile}
          />
          <div className="grid justify-items-center gap-2 rounded-xl border border-dashed border-line bg-mist/30 px-4 py-5 text-center">
            <UploadOutlined
              className="text-2xl text-muted"
              aria-hidden="true"
            />
            <Button
              disabled={disabled || uploading}
              onClick={() => inputRef.current?.click()}
            >
              {t(
                file
                  ? "agent.hub.replaceAvatar"
                  : "agent.editor.chooseAvatarImage",
              )}
            </Button>
            <span className="text-xs text-muted">
              {t("agent.hub.avatarCropHint")}
            </span>
          </div>
          {fileUrl ? (
            <div className="grid gap-3 rounded-xl border border-line p-3">
              <div className="flex items-center gap-4">
                <img
                  alt={t("agent.editor.avatarCropPreview")}
                  className="size-24 rounded-xl object-cover"
                  src={fileUrl}
                  style={{ objectPosition: cropPosition }}
                />
                <div className="grid gap-2">
                  <span className="text-sm font-semibold text-ink">
                    {t("agent.editor.avatarCropPosition")}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {cropPositions.map((position) => (
                      <button
                        aria-label={t(`agent.editor.avatarCrop.${position}`)}
                        aria-pressed={cropPosition === position}
                        className="cursor-pointer rounded-lg border border-line bg-paper px-2 py-1 text-xs text-muted hover:bg-mist focus-visible:outline-2 focus-visible:outline-primary data-[active=true]:border-primary data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
                        data-active={cropPosition === position}
                        disabled={disabled || uploading}
                        key={position}
                        onClick={() => setCropPosition(position)}
                        type="button"
                      >
                        {t(`agent.editor.avatarCrop.${position}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <Button
                type="primary"
                loading={uploading}
                disabled={disabled || uploading}
                onClick={() => {
                  if (file)
                    void onUpload(file, cropPosition).then((saved) => {
                      if (saved) {
                        setFile(undefined);
                        setFileUrl(undefined);
                        onPendingImageChange(false);
                      }
                    });
                }}
              >
                {t("agent.editor.useAvatarImage")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ColorRow({
  color,
  colors,
  disabled,
  label,
  onChange,
}: {
  readonly color: string;
  readonly colors: readonly string[];
  readonly disabled: boolean;
  readonly label: string;
  readonly onChange: (color: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2">
      <span className="text-xs font-semibold text-ink">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        {colors.map((option) => (
          <button
            aria-label={`${label} ${option}`}
            aria-pressed={color.toUpperCase() === option}
            className="grid size-8 cursor-pointer place-items-center rounded-full border border-black/10 bg-paper p-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary data-[active=true]:border-primary"
            data-active={color.toUpperCase() === option}
            disabled={disabled}
            key={option}
            onClick={() => onChange(option)}
            type="button"
          >
            <span
              className="size-full rounded-full"
              style={{ backgroundColor: option }}
            />
          </button>
        ))}
        <ColorPicker
          disabled={disabled}
          value={color}
          onChangeComplete={(next) =>
            onChange(next.toHexString().toUpperCase())
          }
        >
          <Button
            aria-label={`${t("agent.editor.avatarCustomColor")} ${label}`}
            disabled={disabled}
            icon={<BgColorsOutlined />}
            size="small"
          />
        </ColorPicker>
      </div>
    </div>
  );
}
