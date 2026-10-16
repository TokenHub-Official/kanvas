import type { EffectiveInvocationField } from "@kanvas/contracts/api";
import { useTranslation } from "react-i18next";

import {
  scalarOptionToken,
  valueFromScalarOption,
  type EffectiveInvocationValue,
} from "./effective-invocation-input.js";
import type { WorkflowSchemaField } from "./workflow-authoring-model.js";
import { WorkflowTestFileControl } from "./workflow-test-file-control.js";

const ignoreBusyChange = () => undefined;

export function effectiveInvocationArtifactWorkflowField(
  field: EffectiveInvocationField,
): WorkflowSchemaField | undefined {
  const multiple = field.valueType === "artifact_list";
  if (field.valueType !== "artifact" && !multiple) return undefined;
  return {
    key: field.key,
    title: field.label,
    type: multiple ? "array" : "string",
    required: field.required,
    ...(field.description ? { description: field.description } : {}),
    schema: {
      type: multiple ? "array" : "string",
      ...(multiple
        ? {
            items: { type: "string" },
            minItems: field.minItems,
            maxItems: field.maxItems,
            uniqueItems: field.uniqueItems,
          }
        : {}),
      "x-kanvas-file": {
        categories: ["image"],
        transfer: "both",
      },
    },
  };
}

function textValue(
  value: EffectiveInvocationValue | undefined,
  separator = "\n",
): string {
  if (value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.join(separator);
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

export function EffectiveInvocationFieldControl({
  csrfToken,
  field,
  onBusyChange,
  onChange,
  value,
  workspaceId,
}: {
  readonly csrfToken?: string;
  readonly field: EffectiveInvocationField;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onChange: (value: EffectiveInvocationValue | undefined) => void;
  readonly value: EffectiveInvocationValue | undefined;
  readonly workspaceId?: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (field.valueType === "constant") {
    return null;
  }
  if (field.valueType === "enum") {
    return (
      <select
        onChange={(event) => {
          onChange(valueFromScalarOption(field, event.currentTarget.value));
        }}
        required={field.required}
        value={value === undefined ? "" : scalarOptionToken(value)}
      >
        {!field.required ? (
          <option value="">{t("workflows.templateDetail.unset")}</option>
        ) : (
          <option disabled value="">
            {t("workflows.templateDetail.selectPlaceholder")}
          </option>
        )}
        {field.values.map((option) => (
          <option
            key={scalarOptionToken(option)}
            value={scalarOptionToken(option)}
          >
            {String(option)}
          </option>
        ))}
      </select>
    );
  }
  if (field.valueType === "integer") {
    return (
      <input
        max={field.maximum}
        min={field.minimum}
        onChange={(event) => {
          onChange(event.currentTarget.value || undefined);
        }}
        placeholder={field.placeholder}
        required={field.required}
        step={field.step}
        type="number"
        value={textValue(value)}
      />
    );
  }
  if (field.valueType === "boolean") {
    const allowedValues = field.allowedValues ?? [true, false];
    return (
      <select
        onChange={(event) => {
          onChange(valueFromScalarOption(field, event.currentTarget.value));
        }}
        required={field.required}
        value={value === undefined ? "" : scalarOptionToken(value)}
      >
        {!field.required ? (
          <option value="">{t("workflows.templateDetail.unset")}</option>
        ) : (
          <option disabled value="">
            {t("workflows.templateDetail.selectPlaceholder")}
          </option>
        )}
        {allowedValues.map((option) => (
          <option key={String(option)} value={scalarOptionToken(option)}>
            {option
              ? t("workflows.templateDetail.yes")
              : t("workflows.templateDetail.no")}
          </option>
        ))}
      </select>
    );
  }
  if (field.valueType === "artifact") {
    if (csrfToken && workspaceId) {
      const workflowField = effectiveInvocationArtifactWorkflowField(field)!;
      return (
        <WorkflowTestFileControl
          csrfToken={csrfToken}
          field={workflowField}
          onBusyChange={onBusyChange ?? ignoreBusyChange}
          onChange={(nextValue) =>
            onChange(typeof nextValue === "string" ? nextValue : undefined)
          }
          value={value}
          workspaceId={workspaceId}
        />
      );
    }
    return (
      <input
        maxLength={26}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        pattern="[0-7][0-9A-HJKMNP-TV-Z]{25}"
        placeholder={
          field.placeholder ?? t("workflows.templateDetail.artifactPlaceholder")
        }
        required={field.required}
        spellCheck={false}
        type="text"
        value={textValue(value)}
      />
    );
  }
  if (field.valueType === "artifact_list") {
    if (csrfToken && workspaceId) {
      const workflowField = effectiveInvocationArtifactWorkflowField(field)!;
      return (
        <WorkflowTestFileControl
          csrfToken={csrfToken}
          field={workflowField}
          onBusyChange={onBusyChange ?? ignoreBusyChange}
          onChange={(nextValue) =>
            onChange(
              Array.isArray(nextValue) &&
                nextValue.every((item) => typeof item === "string")
                ? nextValue
                : undefined,
            )
          }
          value={value}
          workspaceId={workspaceId}
        />
      );
    }
    return (
      <textarea
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        placeholder={
          field.placeholder ??
          t("workflows.templateDetail.artifactListPlaceholder")
        }
        required={field.required}
        rows={4}
        spellCheck={false}
        value={textValue(value)}
      />
    );
  }
  if (field.valueType === "json") {
    return (
      <textarea
        maxLength={field.maxLength}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        placeholder={
          field.placeholder ?? t("workflows.templateDetail.jsonPlaceholder")
        }
        required={field.required}
        rows={6}
        spellCheck={false}
        value={textValue(value)}
      />
    );
  }
  return (
    <input
      maxLength={field.maxLength}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      placeholder={field.placeholder}
      required={field.required}
      type="text"
      value={textValue(value)}
    />
  );
}
