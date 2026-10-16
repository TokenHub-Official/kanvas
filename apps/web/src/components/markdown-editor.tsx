import { Form, Input, Segmented } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Streamdown } from "streamdown";

export function MarkdownEditor({
  value = "",
  onChange,
  id,
  maxLength,
  ariaLabel,
  disabled = false,
  readOnly = false,
  defaultMode = "edit",
  compact = false,
}: {
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  readonly id?: string;
  readonly maxLength?: number;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly defaultMode?: "edit" | "preview";
  readonly compact?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [mode, setMode] = useState(defaultMode);
  const { status } = Form.Item.useStatus();
  const preview = readOnly || (mode === "preview" && status !== "error");
  return (
    <div className="overflow-hidden rounded-xl bg-paper">
      <div
        className={
          compact
            ? "mb-3 flex items-center justify-end"
            : "flex items-center justify-between gap-3 px-4 py-2"
        }
      >
        {!compact && (
          <span className="text-xs font-medium text-muted">
            {t("agent.authoring.markdownFormat")}
          </span>
        )}
        {!readOnly && (
          <Segmented
            size="small"
            value={preview ? "preview" : "edit"}
            onChange={setMode}
            options={[
              { value: "edit", label: t("agent.authoring.write") },
              { value: "preview", label: t("agent.authoring.preview") },
            ]}
          />
        )}
      </div>
      {preview ? (
        <div className="min-h-64 px-4 pb-4">
          <Streamdown mode="static" className="agent-markdown">
            {value || t("agent.authoring.emptyPreview")}
          </Streamdown>
        </div>
      ) : (
        <Input.TextArea
          disabled={disabled}
          id={id}
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          maxLength={maxLength}
          autoSize={{ minRows: 12, maxRows: 32 }}
          className={
            compact
              ? "!rounded-lg !bg-mist/40 !p-4 !font-mono !text-sm !leading-6"
              : "!rounded-none !bg-paper !px-5 !pb-5 font-mono !leading-7"
          }
          placeholder={t("agent.authoring.instructionPlaceholder")}
        />
      )}
    </div>
  );
}
