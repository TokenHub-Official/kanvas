import { Button, Form, Input, InputNumber, Select, Segmented } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type {
  CanvasImageCapabilityTool,
  CanvasOperationParameterField,
} from "./canvas-capability-tools.js";

type ParameterValue = boolean | number | string | undefined;
const LONG_TEXT_PARAMETER_THRESHOLD = 240;

export function CanvasOperationParametersV1({
  busy,
  onSubmit,
  tool,
}: {
  readonly busy: boolean;
  readonly onSubmit: (parameters: Readonly<Record<string, unknown>>) => void;
  readonly tool: CanvasImageCapabilityTool;
}): React.JSX.Element {
  const { t } = useTranslation();
  const initialValues = useMemo(
    () =>
      Object.fromEntries(
        tool.parameterFields.flatMap((field) =>
          field.defaultValue === undefined
            ? []
            : [
                [
                  field.key,
                  field.control === "select" || field.control === "boolean"
                    ? encodeOptionValue(field.defaultValue)
                    : field.defaultValue,
                ],
              ],
        ),
      ),
    [tool.parameterFields],
  );

  return (
    <Form<Readonly<Record<string, ParameterValue>>>
      className="grid content-start"
      disabled={busy}
      initialValues={initialValues}
      layout="vertical"
      onFinish={(values) => {
        onSubmit(
          Object.fromEntries(
            Object.entries(values).flatMap(([key, value]) => {
              const projected = fieldValueV1(tool, key, value);
              return projected === undefined ||
                (typeof projected === "string" && projected.length === 0)
                ? []
                : [[key, projected]];
            }),
          ),
        );
      }}
      requiredMark={false}
      size="large"
      variant="filled"
    >
      {tool.parameterFields.map((field) => (
        <Form.Item
          key={field.key}
          label={field.label}
          name={field.key}
          {...(field.required
            ? {
                rules: [
                  {
                    required: true,
                    message: t("canvas.operationParameters.required", {
                      field: field.label,
                    }),
                  },
                ],
              }
            : {})}
        >
          <ParameterControlV1 field={field} />
        </Form.Item>
      ))}
      <Form.Item className="mb-0 mt-2">
        <Button block htmlType="submit" loading={busy} type="primary">
          {t("canvas.operationParameters.start", {
            tool: tool.label,
          })}
        </Button>
      </Form.Item>
    </Form>
  );
}

function ParameterControlV1({
  field,
}: {
  readonly field: CanvasOperationParameterField;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (field.control === "select") {
    return (
      <Select
        allowClear={!field.required}
        aria-label={field.label}
        {...(field.options
          ? {
              options: field.options.map((option) => ({
                label: option.label,
                value: encodeOptionValue(option.value),
              })),
            }
          : {})}
        placeholder={t("canvas.operationParameters.choose", {
          field: field.label,
        })}
      />
    );
  }
  if (field.control === "boolean") {
    return (
      <Segmented
        aria-label={field.label}
        block
        options={[
          {
            label: t("canvas.operationParameters.yes"),
            value: encodeOptionValue(true),
          },
          {
            label: t("canvas.operationParameters.no"),
            value: encodeOptionValue(false),
          },
        ]}
      />
    );
  }
  if (field.control === "integer") {
    return (
      <InputNumber
        aria-label={field.label}
        className="w-full"
        {...(field.maximum !== undefined ? { max: field.maximum } : {})}
        {...(field.minimum !== undefined ? { min: field.minimum } : {})}
        {...(field.step !== undefined ? { step: field.step } : {})}
      />
    );
  }
  return (
    <Input.TextArea
      aria-label={field.label}
      autoSize={{ minRows: 3, maxRows: 8 }}
      maxLength={field.maxLength}
      showCount={
        field.maxLength !== undefined &&
        field.maxLength > LONG_TEXT_PARAMETER_THRESHOLD
      }
    />
  );
}

function encodeOptionValue(value: boolean | number | string): string {
  return `${typeof value}:${JSON.stringify(value)}`;
}

function fieldValueV1(
  tool: CanvasImageCapabilityTool,
  key: string,
  value: ParameterValue,
): ParameterValue {
  const field = tool.parameterFields.find((candidate) => candidate.key === key);
  if (
    (field?.control === "select" || field?.control === "boolean") &&
    typeof value === "string"
  ) {
    const option = field.options?.find(
      (candidate) => encodeOptionValue(candidate.value) === value,
    );
    if (option) {
      return option.value;
    }
    if (value === encodeOptionValue(true)) {
      return true;
    }
    return value === encodeOptionValue(false) ? false : undefined;
  }
  return typeof value === "string" ? value.trim() : value;
}
