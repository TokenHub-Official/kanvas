import type {
  BrandKitRevision,
  EffectiveInvocationField,
} from "@kanvas/contracts/api";
import { ColorPicker, Input } from "antd";
import { useTranslation } from "react-i18next";

import { ArtifactPreview } from "../../components/artifact-preview.js";
import {
  effectiveInvocationArtifactWorkflowField,
  EffectiveInvocationFieldControl,
} from "./effective-invocation-field-control.js";
import type {
  EffectiveInvocationValue,
  EffectiveInvocationValues,
} from "./effective-invocation-input.js";
import { brandSocialStarterTitleStyleV1 } from "./brand-social-starter-v1.js";
import { WorkflowTestFileControl } from "./workflow-test-file-control.js";

const HEX_RGB_LENGTH = 7;
const HEADLINE_PREVIEW_MAX_SIZE = 26;

function field(
  fields: readonly EffectiveInvocationField[],
  key: string,
): EffectiveInvocationField | undefined {
  return fields.find((item) => item.key === key);
}

function opaqueHex(value: string): string {
  return value.length === HEX_RGB_LENGTH ? `${value}FF` : value;
}

export function BrandSocialStarterFieldsV1({
  csrfToken,
  fields,
  onBusyChange,
  onChange,
  revision,
  values,
  workspaceId,
}: {
  readonly csrfToken: string;
  readonly fields: readonly EffectiveInvocationField[];
  readonly onBusyChange: (busy: boolean) => void;
  readonly onChange: (
    key: string,
    value: EffectiveInvocationValue | undefined,
  ) => void;
  readonly revision?: BrandKitRevision;
  readonly values: EffectiveInvocationValues;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const headline = field(fields, "headline");
  const logo = field(fields, "logoArtifactId");
  const background = field(fields, "backgroundColor");
  const selectedLogo =
    typeof values.logoArtifactId === "string" ? values.logoArtifactId : "";
  const selectedColor =
    typeof values.backgroundColor === "string"
      ? values.backgroundColor
      : "#FFFFFFFF";
  const titleStyle = brandSocialStarterTitleStyleV1(revision);

  return (
    <div className="grid gap-6">
      {headline ? (
        <label className="grid gap-2">
          <span className="text-sm font-bold text-ink">{headline.label} *</span>
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 5 }}
            maxLength={120}
            onChange={(event) =>
              onChange("headline", event.currentTarget.value || undefined)
            }
            placeholder={headline.placeholder}
            showCount
            value={typeof values.headline === "string" ? values.headline : ""}
            variant="filled"
          />
          {headline.description ? (
            <small className="text-xs leading-5 text-muted">
              {headline.description}
            </small>
          ) : null}
        </label>
      ) : null}

      {logo ? (
        <section className="grid gap-2" aria-label={logo.label}>
          <strong className="text-sm text-ink">{logo.label} *</strong>
          {revision?.logos.length ? (
            <div className="grid grid-cols-2 gap-2">
              {revision.logos.map((item) => (
                <button
                  aria-pressed={selectedLogo === item.artifactId}
                  className="grid min-w-0 gap-2 rounded-[12px] border-0 bg-mist p-2 text-left shadow-[inset_0_0_0_1px_transparent] transition-colors hover:bg-mist-deep focus-visible:outline-3 focus-visible:outline-primary aria-pressed:bg-primary/8 aria-pressed:shadow-[inset_0_0_0_1px_var(--primary)]"
                  key={item.key}
                  onClick={() => onChange("logoArtifactId", item.artifactId)}
                  type="button"
                >
                  <span className="relative grid h-20 place-items-center overflow-hidden rounded-[9px] bg-paper">
                    <ArtifactPreview
                      alt=""
                      artifactId={item.artifactId}
                      imageClassName="absolute inset-0 size-full object-contain p-3"
                      thumbnail
                      workspaceId={workspaceId}
                    />
                  </span>
                  <span className="truncate px-1 text-xs font-semibold text-ink">
                    {item.name}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {effectiveInvocationArtifactWorkflowField(logo) ? (
            <details className="rounded-[12px] bg-mist p-3">
              <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink">
                {revision
                  ? t("workflows.templateDetail.brandStarterOtherLogo")
                  : t("workflows.templateDetail.brandStarterUploadLogo")}
              </summary>
              <div className="mt-3">
                <WorkflowTestFileControl
                  csrfToken={csrfToken}
                  field={effectiveInvocationArtifactWorkflowField(logo)!}
                  onBusyChange={onBusyChange}
                  onChange={(value) =>
                    onChange(
                      "logoArtifactId",
                      typeof value === "string" ? value : undefined,
                    )
                  }
                  value={values.logoArtifactId}
                  workspaceId={workspaceId}
                />
              </div>
            </details>
          ) : (
            <EffectiveInvocationFieldControl
              csrfToken={csrfToken}
              field={logo}
              onBusyChange={onBusyChange}
              onChange={(value) => onChange("logoArtifactId", value)}
              value={values.logoArtifactId}
              workspaceId={workspaceId}
            />
          )}
        </section>
      ) : null}

      {background ? (
        <section className="grid gap-2" aria-label={background.label}>
          <strong className="text-sm text-ink">{background.label} *</strong>
          {revision?.colors.length ? (
            <div className="flex flex-wrap gap-2">
              {revision.colors.map((item) => {
                const value = opaqueHex(item.value);
                return (
                  <button
                    aria-label={item.name}
                    aria-pressed={selectedColor === value}
                    className="size-10 rounded-full border-0 shadow-[inset_0_0_0_1px_rgb(21_21_21_/_12%)] ring-offset-2 ring-offset-paper focus-visible:outline-3 focus-visible:outline-primary aria-pressed:ring-2 aria-pressed:ring-primary"
                    key={item.key}
                    onClick={() => onChange("backgroundColor", value)}
                    style={{ backgroundColor: item.value }}
                    title={item.name}
                    type="button"
                  />
                );
              })}
            </div>
          ) : null}
          <ColorPicker
            className="w-full"
            format="hex"
            onChangeComplete={(color) =>
              onChange("backgroundColor", `${color.toHexString()}FF`)
            }
            showText
            value={selectedColor.slice(0, HEX_RGB_LENGTH)}
          />
          {background.description ? (
            <small className="text-xs leading-5 text-muted">
              {background.description}
            </small>
          ) : null}
        </section>
      ) : null}

      {revision ? (
        <section className="grid gap-3 rounded-[16px] bg-mist p-4">
          <div>
            <strong className="text-sm text-ink">
              {t("workflows.templateDetail.brandStarterCanvasContinuation")}
            </strong>
            <p className="m-0 mt-1 text-xs leading-5 text-muted">
              {t(
                "workflows.templateDetail.brandStarterCanvasContinuationDescription",
              )}
            </p>
          </div>
          {titleStyle ? (
            <div className="rounded-[10px] bg-paper px-3 py-2">
              <span
                className="block truncate"
                style={{
                  color:
                    revision.colors.find(
                      (item) => item.key === titleStyle.colorKey,
                    )?.value ?? "#151515",
                  fontFamily: titleStyle.fontFamily,
                  fontSize: `${String(
                    Math.min(titleStyle.fontSize, HEADLINE_PREVIEW_MAX_SIZE),
                  )}px`,
                  fontWeight: titleStyle.fontWeight,
                  letterSpacing: `${String(titleStyle.letterSpacing)}px`,
                }}
              >
                {titleStyle.name}
              </span>
              <span className="mt-1 block text-[10px] text-muted">
                {titleStyle.fontFamily}
              </span>
            </div>
          ) : null}
          {revision.guidelines.voice ? (
            <p className="m-0 text-xs leading-5 text-muted">
              <strong className="text-ink">
                {t("workflows.templateDetail.brandStarterVoice")}
              </strong>{" "}
              {revision.guidelines.voice}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
