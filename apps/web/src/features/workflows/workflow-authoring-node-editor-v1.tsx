import type {
  WorkflowAuthoringCapability,
  WorkflowCapabilitySemanticType,
} from "@kanvas/contracts/api";
import type { WorkflowJsonValue } from "@kanvas/contracts/workflow";
import type {
  WorkflowAuthoringBindingV1,
  WorkflowAuthoringFieldV1,
  WorkflowAuthoringNodeV1,
  WorkflowAuthoringOutputFieldV1,
  WorkflowAuthoringVariableV1,
} from "@kanvas/contracts/workflow-authoring";
import {
  CustomerServiceOutlined,
  DownOutlined,
  EditOutlined,
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  PlusOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  Button,
  Checkbox,
  ColorPicker,
  Drawer,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Slider,
  Switch,
} from "antd";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  validateWorkflowAuthoringFields,
  workflowAuthoringFieldKind,
  workflowAuthoringSchemaForKind,
  workflowEnumValues,
  workflowFieldNumber,
  workflowFieldPlaceholder,
  workflowFieldRenderKey,
  workflowFileConfiguration,
  withWorkflowEnumValues,
  withWorkflowFieldPlaceholder,
  type WorkflowAuthoringFieldKindV1,
  type WorkflowFileTransferV1,
} from "./workflow-authoring-field-schema-v1.js";
import {
  workflowCapabilityInputDefaults,
  workflowCapabilityInputWithDefaults,
} from "./workflow-authoring-capability-input-v1.js";
import {
  workflowCapabilityOutput,
  workflowCapabilityParameter,
  workflowCapabilityText,
  workflowSemanticTypesCompatible,
} from "./workflow-capability-authoring-profile-v1.js";
import { workflowApprovalDecisionFields } from "./workflow-authoring-model.js";
import { workflowAuthoringNodeUsesCapabilityIdentity } from "./workflow-authoring-shell-model-v1.js";

const WorkflowRichPromptV1 = lazy(async () => {
  const module = await import("./workflow-rich-prompt-v1.js");
  return { default: module.WorkflowRichPromptV1 };
});

export interface WorkflowAuthoringVariableOptionV1 {
  readonly id: string;
  readonly label: string;
  readonly sourceLabel: string;
  readonly sourceNodeId: string;
  readonly fieldKey: string;
  readonly variable: WorkflowAuthoringVariableV1;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly semanticType?: WorkflowCapabilitySemanticType;
  readonly bundle?: { readonly key: string; readonly role: string };
}

type CapabilityAuthoringNodeV1 = Extract<
  WorkflowAuthoringNodeV1,
  { type: "capability" | "batch" }
>;

function objectFields(binding: WorkflowAuthoringBindingV1) {
  return binding.kind === "object" ? binding.fields : {};
}

function variableBinding(
  option: WorkflowAuthoringVariableOptionV1 | undefined,
): WorkflowAuthoringBindingV1 {
  return option
    ? { kind: "variable", variable: option.variable }
    : { kind: "literal", value: null };
}

function selectedVariableId(
  binding: WorkflowAuthoringBindingV1,
  variables: readonly WorkflowAuthoringVariableOptionV1[],
): string | undefined {
  if (binding.kind !== "variable") return undefined;
  return variables.find(
    (item) =>
      JSON.stringify(item.variable) === JSON.stringify(binding.variable),
  )?.id;
}

function workflowVariableOptionLabel(
  item: WorkflowAuthoringVariableOptionV1,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const source =
    item.variable.source === "workflow_input"
      ? t("workflows.editor.workflowInputSource")
      : item.sourceLabel;
  return `${source} · ${item.label}`;
}

function schemaFields(schema: Readonly<Record<string, unknown>>) {
  const properties = schema.properties;
  return typeof properties === "object" &&
    properties !== null &&
    !Array.isArray(properties)
    ? Object.entries(properties as Readonly<Record<string, unknown>>)
    : [];
}

function schemaText(
  schema: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = schema[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function capabilityMetadata(
  capability: WorkflowAuthoringCapability,
  t: ReturnType<typeof useTranslation>["t"],
  language: string,
): {
  readonly title: string;
  readonly description?: string;
  readonly category: string;
  readonly source: string;
  readonly searchText: string;
} {
  const title = workflowCapabilityText(
    capability.authoring.catalog.title,
    language,
  );
  const description = capability.authoring.catalog.description
    ? workflowCapabilityText(capability.authoring.catalog.description, language)
    : undefined;
  const category = workflowCapabilityText(
    capability.authoring.catalog.category,
    language,
  );
  const sourceKind = capability.authoring.catalog.sourceKind;
  const source = t(`workflows.editor.capabilityCatalog.sources.${sourceKind}`, {
    defaultValue: sourceKind,
  });
  return {
    title,
    ...(description ? { description } : {}),
    category,
    source,
    searchText: [
      title,
      description,
      category,
      source,
      capability.contractKey,
      `r${String(capability.revision)}`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export function capabilityIdentity(
  capability: WorkflowAuthoringCapability,
): string {
  return `${capability.contractId}@${String(capability.revision)}`;
}

function editableNodeName(
  node: WorkflowAuthoringNodeV1,
  capabilities: readonly WorkflowAuthoringCapability[],
  language: string,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (node.type === "input" || node.type === "output") {
    return t(`workflows.editor.authoringKinds.${node.type}`);
  }
  if (node.type === "capability" || node.type === "batch") {
    const capability = capabilities.find(
      (item) =>
        item.contractId === node.capability.contractId &&
        item.revision === node.capability.revision,
    );
    const localizedCapabilityName = [
      node.displayName,
      node.capability.contractId,
      capability?.contractId,
      capability?.contractKey,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) =>
        t(`workflows.editor.capabilityNames.${value}`, { defaultValue: "" }),
      )
      .find(Boolean);
    if (localizedCapabilityName) return localizedCapabilityName;
    if (workflowAuthoringNodeUsesCapabilityIdentity(node, capability)) {
      if (capability) {
        return workflowCapabilityText(
          capability.authoring.catalog.title,
          language,
        );
      }
      return t(
        `workflows.editor.capabilityNames.${node.capability.contractId}`,
        { defaultValue: t(`workflows.editor.authoringKinds.${node.type}`) },
      );
    }
  }
  return node.displayName === node.nodeKey
    ? t(`workflows.editor.authoringKinds.${node.type}`)
    : node.displayName;
}

function fieldKey(index: number): string {
  return `field_${String(index + 1)}`;
}

function conditionValueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

function conditionListText(value: readonly unknown[]): string {
  return value
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    .join(", ");
}

function schemaDefaultText(schema: Readonly<Record<string, unknown>>): string {
  const value = schema.default;
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

function parseJsonSource(source: string): unknown {
  return JSON.parse(source) as unknown;
}

function FieldConstraintsEditor({
  field,
  onChange,
  output = false,
}: {
  readonly field: WorkflowAuthoringFieldV1;
  readonly onChange: (field: WorkflowAuthoringFieldV1) => void;
  readonly output?: boolean;
}) {
  const { t } = useTranslation();
  const kind = workflowAuthoringFieldKind(field.schema);
  const updateSchema = (patch: Readonly<Record<string, unknown>>) =>
    onChange({ ...field, schema: { ...field.schema, ...patch } });
  const enumValues = workflowEnumValues(field.schema);
  const file = workflowFileConfiguration(field.schema);

  return (
    <div className="grid gap-4">
      <label className="grid gap-1 text-[11px] text-muted">
        {t("workflows.editor.fieldDescription")}
        <Input.TextArea
          aria-label={t("workflows.editor.fieldDescription")}
          onChange={(event) =>
            updateSchema({ description: event.currentTarget.value })
          }
          placeholder={t("workflows.editor.fieldDescriptionExample")}
          rows={2}
          value={schemaText(field.schema, "description") ?? ""}
        />
      </label>

      {!output ? (
        <label className="grid gap-1 text-[11px] text-muted">
          {t("workflows.editor.fieldPlaceholder")}
          <Input
            maxLength={500}
            onChange={(event) =>
              onChange({
                ...field,
                schema: withWorkflowFieldPlaceholder(
                  field.schema,
                  event.currentTarget.value,
                ),
              })
            }
            placeholder={t("workflows.editor.fieldPlaceholderExample")}
            value={workflowFieldPlaceholder(field.schema) ?? ""}
          />
        </label>
      ) : null}

      {kind === "string" && !output ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[11px] text-muted">
              {t("workflows.editor.minLength")}
              <InputNumber
                className="w-full"
                min={0}
                onChange={(minLength) =>
                  updateSchema({ minLength: minLength ?? 0 })
                }
                value={workflowFieldNumber(field.schema, "minLength") ?? null}
              />
            </label>
            <label className="grid gap-1 text-[11px] text-muted">
              {t("workflows.editor.maxLength")}
              <InputNumber
                className="w-full"
                min={1}
                onChange={(maxLength) =>
                  updateSchema({ maxLength: maxLength ?? 1 })
                }
                value={workflowFieldNumber(field.schema, "maxLength") ?? null}
              />
            </label>
          </div>
          <label className="grid gap-1 text-[11px] text-muted">
            {t("workflows.editor.defaultValue")}
            <Input
              onChange={(event) =>
                updateSchema({ default: event.currentTarget.value })
              }
              value={schemaDefaultText(field.schema)}
            />
          </label>
          <label className="grid gap-1 text-[11px] text-muted">
            {t("workflows.editor.enumValues")}
            <Input.TextArea
              onChange={(event) =>
                onChange({
                  ...field,
                  schema: withWorkflowEnumValues(
                    field.schema,
                    event.currentTarget.value
                      .split("\n")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  ),
                })
              }
              placeholder={t("workflows.editor.enumValuesPlaceholder")}
              rows={3}
              value={enumValues.join("\n")}
            />
          </label>
        </>
      ) : null}

      {(kind === "number" || kind === "integer") && !output ? (
        <div className="grid grid-cols-2 gap-2">
          <InputNumber
            aria-label={t("workflows.editor.minimum")}
            className="w-full"
            onChange={(minimum) => updateSchema({ minimum })}
            placeholder={t("workflows.editor.minimum")}
            value={workflowFieldNumber(field.schema, "minimum") ?? null}
          />
          <InputNumber
            aria-label={t("workflows.editor.maximum")}
            className="w-full"
            onChange={(maximum) => updateSchema({ maximum })}
            placeholder={t("workflows.editor.maximum")}
            value={workflowFieldNumber(field.schema, "maximum") ?? null}
          />
        </div>
      ) : null}

      {kind === "boolean" && !output ? (
        <Select
          allowClear
          aria-label={t("workflows.editor.defaultValue")}
          onChange={(value) => updateSchema({ default: value })}
          options={[
            { label: t("workflows.editor.yes"), value: true },
            { label: t("workflows.editor.no"), value: false },
          ]}
          placeholder={t("workflows.editor.defaultValue")}
          value={
            typeof field.schema.default === "boolean"
              ? field.schema.default
              : undefined
          }
        />
      ) : null}

      {kind === "array" && !output ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <InputNumber
              aria-label={t("workflows.editor.minItems")}
              className="w-full"
              min={0}
              onChange={(minItems) => updateSchema({ minItems: minItems ?? 0 })}
              placeholder={t("workflows.editor.minItems")}
              value={workflowFieldNumber(field.schema, "minItems") ?? null}
            />
            <InputNumber
              aria-label={t("workflows.editor.maxItems")}
              className="w-full"
              min={1}
              onChange={(maxItems) => updateSchema({ maxItems: maxItems ?? 1 })}
              placeholder={t("workflows.editor.maxItems")}
              value={workflowFieldNumber(field.schema, "maxItems") ?? null}
            />
          </div>
          <Input.TextArea
            aria-label={t("workflows.editor.enumValues")}
            onChange={(event) =>
              onChange({
                ...field,
                schema: withWorkflowEnumValues(
                  field.schema,
                  event.currentTarget.value
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean),
                ),
              })
            }
            placeholder={t("workflows.editor.arrayEnumPlaceholder")}
            rows={3}
            value={enumValues.join("\n")}
          />
          <label className="flex items-center justify-between text-xs font-semibold text-ink">
            {t("workflows.editor.uniqueItems")}
            <Switch
              checked={field.schema.uniqueItems === true}
              onChange={(uniqueItems) => updateSchema({ uniqueItems })}
              size="small"
            />
          </label>
        </>
      ) : null}

      {kind === "object" && !output ? (
        <Input.TextArea
          aria-label={t("workflows.editor.defaultJson")}
          onChange={(event) => {
            try {
              const schema: Record<string, unknown> = {
                ...field.schema,
                default: parseJsonSource(event.currentTarget.value),
              };
              delete schema["x-kanvas-default-source"];
              onChange({ ...field, schema });
            } catch {
              updateSchema({
                "x-kanvas-default-source": event.currentTarget.value,
              });
            }
          }}
          placeholder={t("workflows.editor.defaultJson")}
          rows={4}
          value={
            schemaText(field.schema, "x-kanvas-default-source") ??
            schemaDefaultText(field.schema)
          }
        />
      ) : null}

      {kind === "file" || kind === "file_list" ? (
        <>
          <strong className="text-xs text-ink">
            {t("workflows.editor.fileCategories")}
          </strong>
          <div className="grid gap-2">
            {(
              [
                ["document", FileTextOutlined],
                ["image", FileImageOutlined],
                ["audio", CustomerServiceOutlined],
                ["video", VideoCameraOutlined],
                ["other", FileOutlined],
              ] as const
            ).map(([category, Icon]) => {
              const selected = file.categories.includes(category);
              return (
                <button
                  aria-pressed={selected}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    selected
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-line bg-paper text-ink hover:bg-mist"
                  }`}
                  key={category}
                  onClick={() => {
                    const categories = selected
                      ? file.categories.filter((item) => item !== category)
                      : [...file.categories, category];
                    updateSchema({
                      "x-kanvas-file": { ...file, categories },
                    });
                  }}
                  type="button"
                >
                  <Icon aria-hidden="true" className="text-base" />
                  {t(`workflows.editor.fileCategory.${category}`)}
                </button>
              );
            })}
          </div>
          {!output ? (
            <label className="grid gap-2 text-xs font-semibold text-ink">
              {t("workflows.editor.fileTransfer")}
              <Segmented<WorkflowFileTransferV1>
                block
                onChange={(transfer) =>
                  updateSchema({ "x-kanvas-file": { ...file, transfer } })
                }
                options={(["upload", "url", "both"] as const).map((value) => ({
                  label: t(`workflows.editor.fileTransferMode.${value}`),
                  value,
                }))}
                value={file.transfer}
              />
            </label>
          ) : null}
          {kind === "file_list" && !output ? (
            <div className="grid grid-cols-2 gap-2">
              <InputNumber
                aria-label={t("workflows.editor.minItems")}
                className="w-full"
                min={0}
                onChange={(minItems) =>
                  updateSchema({ minItems: minItems ?? 0 })
                }
                placeholder={t("workflows.editor.minItems")}
                value={workflowFieldNumber(field.schema, "minItems") ?? null}
              />
              <InputNumber
                aria-label={t("workflows.editor.maxItems")}
                className="w-full"
                min={1}
                onChange={(maxItems) =>
                  updateSchema({ maxItems: maxItems ?? 1 })
                }
                placeholder={t("workflows.editor.maxItems")}
                value={workflowFieldNumber(field.schema, "maxItems") ?? null}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function FieldEditModal({
  field,
  onCancel,
  onSave,
  output,
  siblingFields,
  variables,
}: {
  readonly field: WorkflowAuthoringFieldV1 | WorkflowAuthoringOutputFieldV1;
  readonly onCancel: () => void;
  readonly onSave: (
    field: WorkflowAuthoringFieldV1 | WorkflowAuthoringOutputFieldV1,
  ) => void;
  readonly output: boolean;
  readonly siblingFields: readonly WorkflowAuthoringFieldV1[];
  readonly variables: readonly WorkflowAuthoringVariableOptionV1[];
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(field);
  const issues = validateWorkflowAuthoringFields([
    ...siblingFields,
    draft,
  ]).filter((issue) => issue.fieldIndex === siblingFields.length);
  return (
    <Modal
      cancelText={t("workflows.editor.cancel")}
      destroyOnHidden
      okButtonProps={{ disabled: issues.length > 0 }}
      okText={t("workflows.editor.saveField")}
      onCancel={onCancel}
      onOk={() => onSave(draft)}
      open
      title={t("workflows.editor.editField")}
      width={560}
    >
      <div className="grid gap-4 pt-2">
        <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-2">
          <Input
            aria-label={t("workflows.editor.fieldLabel")}
            onChange={(event) =>
              setDraft({ ...draft, label: event.currentTarget.value })
            }
            placeholder={t("workflows.editor.fieldLabel")}
            value={draft.label}
          />
          <Select
            aria-label={t("workflows.editor.fieldType")}
            onChange={(type: WorkflowAuthoringFieldKindV1) =>
              setDraft({
                ...draft,
                schema: workflowAuthoringSchemaForKind(type),
              })
            }
            options={(
              [
                "string",
                "number",
                "integer",
                "boolean",
                "object",
                "array",
                "file",
                "file_list",
              ] as const
            ).map((type) => ({
              label: t(`workflows.editor.schemaTypes.${type}`),
              value: type,
            }))}
            value={workflowAuthoringFieldKind(draft.schema)}
          />
        </div>
        <Input
          aria-label={t("workflows.editor.fieldKey")}
          onChange={(event) =>
            setDraft({ ...draft, key: event.currentTarget.value })
          }
          placeholder={t("workflows.editor.fieldKey")}
          value={draft.key}
        />
        {output && "binding" in draft ? (
          <Select
            allowClear
            aria-label={t("workflows.editor.outputSource")}
            onChange={(id: string | undefined) => {
              const selected = variables.find((item) => item.id === id);
              setDraft({
                ...draft,
                binding: variableBinding(selected),
              });
            }}
            options={variables.map((item) => ({
              label: workflowVariableOptionLabel(item, t),
              value: item.id,
            }))}
            placeholder={t("workflows.editor.selectOutputSource")}
            value={selectedVariableId(draft.binding, variables)}
          />
        ) : null}
        <FieldConstraintsEditor
          field={draft}
          onChange={(nextField) =>
            setDraft(
              "binding" in draft
                ? { ...nextField, binding: draft.binding }
                : nextField,
            )
          }
          output={output}
        />
        {issues.map((issue) => (
          <span className="text-xs text-danger" key={issue.code}>
            {t(`workflows.editor.fieldIssues.${issue.code}`)}
          </span>
        ))}
        <Checkbox
          checked={draft.required}
          onChange={(event) =>
            setDraft({ ...draft, required: event.target.checked })
          }
        >
          {t("workflows.editor.requiredField")}
        </Checkbox>
      </div>
    </Modal>
  );
}

function FieldsEditor({
  fields,
  onChange,
  output,
  variables,
}: {
  readonly fields: readonly (
    WorkflowAuthoringFieldV1 | WorkflowAuthoringOutputFieldV1
  )[];
  readonly onChange: (
    fields: readonly (
      WorkflowAuthoringFieldV1 | WorkflowAuthoringOutputFieldV1
    )[],
  ) => void;
  readonly output: boolean;
  readonly variables: readonly WorkflowAuthoringVariableOptionV1[];
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<{
    readonly field: WorkflowAuthoringFieldV1 | WorkflowAuthoringOutputFieldV1;
    readonly index: number;
  }>();
  const issues = validateWorkflowAuthoringFields(fields);
  return (
    <div className="grid gap-2">
      {fields.map((field, index) => {
        if (output && field.key === "schemaVersion") return null;
        const fieldIssues = issues.filter(
          (issue) => issue.fieldIndex === index,
        );
        return (
          <div
            className="grid gap-2 rounded-xl bg-mist p-3"
            key={workflowFieldRenderKey(index)}
          >
            <div className="flex items-start gap-3">
              <button
                className="grid min-w-0 flex-1 gap-1 border-0 bg-transparent p-0 text-left"
                onClick={() => setEditing({ field, index })}
                type="button"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <strong className="truncate text-xs text-ink">
                    {field.label}
                  </strong>
                  <span className="rounded bg-mist px-1.5 py-0.5 text-[10px] text-muted">
                    {t(
                      `workflows.editor.schemaTypes.${workflowAuthoringFieldKind(field.schema)}`,
                    )}
                  </span>
                  {field.required ? (
                    <span className="text-[10px] text-primary">
                      {t("workflows.editor.requiredField")}
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-[11px] text-muted">
                  {field.key}
                </span>
              </button>
              <Button
                aria-label={t("workflows.editor.editField")}
                icon={<EditOutlined aria-hidden="true" />}
                onClick={() => setEditing({ field, index })}
                size="small"
                type="text"
              />
              <Button
                danger
                onClick={() =>
                  onChange(
                    fields.filter((_item, itemIndex) => itemIndex !== index),
                  )
                }
                size="small"
                type="text"
              >
                {t("workflows.editor.deleteField")}
              </Button>
            </div>
            {fieldIssues.map((issue) => (
              <span className="text-[11px] text-danger" key={issue.code}>
                {t(`workflows.editor.fieldIssues.${issue.code}`)}
              </span>
            ))}
          </div>
        );
      })}
      <Button
        block
        icon={<PlusOutlined aria-hidden="true" />}
        onClick={() => {
          const key = fieldKey(fields.length);
          const base: WorkflowAuthoringFieldV1 = {
            key,
            label: t("workflows.editor.newField"),
            required: false,
            schema: workflowAuthoringSchemaForKind("string"),
          };
          setEditing({
            field: output
              ? { ...base, binding: variableBinding(variables[0]) }
              : base,
            index: fields.length,
          });
        }}
        type="text"
      >
        {t("workflows.editor.addField")}
      </Button>
      {editing ? (
        <FieldEditModal
          field={editing.field}
          key={`field-editor-${String(editing.index)}`}
          onCancel={() => setEditing(undefined)}
          onSave={(field) => {
            const next = [...fields];
            next[editing.index] = field;
            onChange(next);
            setEditing(undefined);
          }}
          output={output}
          siblingFields={fields.filter(
            (_field, index) => index !== editing.index,
          )}
          variables={variables}
        />
      ) : null}
    </div>
  );
}

function VariableSelect({
  binding,
  label,
  onChange,
  showLabel = true,
  variables,
}: {
  readonly binding: WorkflowAuthoringBindingV1;
  readonly label: string;
  readonly onChange: (binding: WorkflowAuthoringBindingV1) => void;
  readonly showLabel?: boolean;
  readonly variables: readonly WorkflowAuthoringVariableOptionV1[];
}) {
  const { t } = useTranslation();
  const control = (
    <Select
      aria-label={label}
      onChange={(id) =>
        onChange(variableBinding(variables.find((item) => item.id === id)))
      }
      options={variables.map((item) => ({
        label: workflowVariableOptionLabel(item, t),
        value: item.id,
      }))}
      placeholder={t("workflows.editor.selectVariable")}
      value={selectedVariableId(binding, variables)}
      variant="filled"
    />
  );
  return showLabel ? (
    <label className="grid gap-2 text-xs font-semibold text-ink">
      {label}
      {control}
    </label>
  ) : (
    control
  );
}

export function compatibleVariables(
  schema: Readonly<Record<string, unknown>>,
  variables: readonly WorkflowAuthoringVariableOptionV1[],
  expectedSemanticType?: WorkflowCapabilitySemanticType,
): readonly WorkflowAuthoringVariableOptionV1[] {
  if (expectedSemanticType === "background.source") {
    return variables.filter((item) =>
      workflowSemanticTypesCompatible(expectedSemanticType, item.semanticType),
    );
  }
  if (expectedSemanticType?.startsWith("artifact.") === true) {
    return variables.filter((item) =>
      workflowSemanticTypesCompatible(expectedSemanticType, item.semanticType),
    );
  }
  const target = workflowAuthoringFieldKind(schema);
  if (target === "string") {
    return variables.filter((item) => {
      const source = workflowAuthoringFieldKind(item.schema);
      return (
        source === "string" ||
        source === "number" ||
        source === "integer" ||
        source === "boolean" ||
        source === "file"
      );
    });
  }
  return variables.filter((item) => {
    if (workflowAuthoringFieldKind(item.schema) !== target) return false;
    return workflowSemanticTypesCompatible(
      expectedSemanticType,
      item.semanticType,
    );
  });
}

function schemaEnumScalars(
  schema: Readonly<Record<string, unknown>>,
): readonly (string | number | boolean)[] {
  return Array.isArray(schema.enum)
    ? schema.enum.filter(
        (value): value is string | number | boolean =>
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean",
      )
    : [];
}

function sameBinding(
  left: WorkflowAuthoringBindingV1,
  right: WorkflowAuthoringBindingV1,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

const localizedOptionValues = new Set([
  "auto",
  "low",
  "medium",
  "high",
  "coarse",
  "fine",
  "opaque",
  "transparent",
  "cover",
  "contain",
  "stretch",
]);
const defaultImageDimension = 1024;
const hexColorDisplayLength = 7;

function workflowOptionLabel(
  value: string | number | boolean,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return typeof value === "string" && localizedOptionValues.has(value)
    ? t(`workflows.editor.optionLabels.${value}`)
    : String(value);
}

function EnumBindingEditor({
  binding,
  label,
  onChange,
  schema,
  variables,
}: {
  readonly binding: WorkflowAuthoringBindingV1;
  readonly label: string;
  readonly onChange: (binding: WorkflowAuthoringBindingV1) => void;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly variables: readonly WorkflowAuthoringVariableOptionV1[];
}) {
  const { t } = useTranslation();
  const fixed = schemaEnumScalars(schema).map((value, index) => ({
    binding: { kind: "literal" as const, value },
    label: workflowOptionLabel(value, t),
    value: `literal:${String(index)}`,
  }));
  const upstream = variables.map((item) => ({
    binding: { kind: "variable" as const, variable: item.variable },
    label: workflowVariableOptionLabel(item, t),
    value: `variable:${item.id}`,
  }));
  const options = [...fixed, ...upstream];
  return (
    <label className="grid gap-2 text-xs font-semibold text-ink">
      {label}
      <Select
        onChange={(value) => {
          const option = options.find((item) => item.value === value);
          if (option) onChange(option.binding);
        }}
        options={[
          {
            label: t("workflows.editor.mappingLiteral"),
            options: fixed,
          },
          ...(upstream.length > 0
            ? [
                {
                  label: t("workflows.editor.mappingVariable"),
                  options: upstream,
                },
              ]
            : []),
        ]}
        value={
          options.find((item) => sameBinding(item.binding, binding))?.value
        }
        variant="filled"
      />
    </label>
  );
}

function ScalarBindingEditor({
  allowLiteral,
  allowVariable,
  binding,
  kind,
  label,
  onChange,
  schema,
  variables,
}: {
  readonly allowLiteral: boolean;
  readonly allowVariable: boolean;
  readonly binding: WorkflowAuthoringBindingV1;
  readonly kind: "number" | "integer" | "boolean";
  readonly label: string;
  readonly onChange: (binding: WorkflowAuthoringBindingV1) => void;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly variables: readonly WorkflowAuthoringVariableOptionV1[];
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"literal" | "variable">(() => {
    if (binding.kind === "variable" && allowVariable) return "variable";
    return allowLiteral ? "literal" : "variable";
  });
  let control: ReactNode;
  if (mode === "variable") {
    control = (
      <VariableSelect
        binding={binding}
        label={t("workflows.editor.selectVariable")}
        onChange={onChange}
        variables={variables}
      />
    );
  } else if (kind === "boolean") {
    control = (
      <Switch
        checked={binding.kind === "literal" && binding.value === true}
        onChange={(value) => onChange({ kind: "literal", value })}
      />
    );
  } else {
    control = (
      <InputNumber
        className="w-full"
        controls={false}
        onChange={(value) =>
          onChange({ kind: "literal", value: value ?? null })
        }
        placeholder={t("workflows.editor.unsetValue")}
        {...(typeof schema.maximum === "number" ? { max: schema.maximum } : {})}
        {...(typeof schema.minimum === "number" ? { min: schema.minimum } : {})}
        {...(typeof schema.multipleOf === "number"
          ? { step: schema.multipleOf }
          : {})}
        {...(kind === "integer" ? { precision: 0 } : {})}
        value={
          binding.kind === "literal" && typeof binding.value === "number"
            ? binding.value
            : null
        }
        variant="filled"
      />
    );
  }
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-xs text-ink">{label}</strong>
        {allowLiteral && allowVariable ? (
          <Segmented
            onChange={(value) => {
              const nextMode = value as "literal" | "variable";
              setMode(nextMode);
              onChange(
                nextMode === "variable"
                  ? variableBinding(variables[0])
                  : {
                      kind: "literal",
                      value: kind === "boolean" ? false : 0,
                    },
              );
            }}
            options={[
              {
                label: t("workflows.editor.mappingLiteral"),
                value: "literal",
              },
              {
                label: t("workflows.editor.mappingVariable"),
                value: "variable",
              },
            ]}
            size="small"
            value={mode}
          />
        ) : null}
      </div>
      {control}
    </section>
  );
}

function CapabilitySelect({
  capabilities,
  node,
  onChange,
}: {
  readonly capabilities: readonly WorkflowAuthoringCapability[];
  readonly node: CapabilityAuthoringNodeV1;
  readonly onChange: (node: CapabilityAuthoringNodeV1) => void;
}) {
  const { i18n, t } = useTranslation();
  const [changing, setChanging] = useState(false);
  const options = capabilities.map((item) => {
    const metadata = capabilityMetadata(item, t, i18n.language);
    return {
      capability: item,
      label: (
        <div className="grid min-w-0 gap-0.5 py-1">
          <strong className="truncate text-xs text-ink">
            {metadata.title}
          </strong>
          <span className="truncate text-[11px] text-muted">
            {metadata.category} / {metadata.source} / {item.contractKey} / r
            {item.revision}
          </span>
          {metadata.description ? (
            <span className="truncate text-[11px] text-muted">
              {metadata.description}
            </span>
          ) : null}
        </div>
      ),
      searchText: metadata.searchText,
      selectedLabel: metadata.title,
      value: capabilityIdentity(item),
    };
  });
  const selected = options.find(
    (option) =>
      option.capability.contractId === node.capability.contractId &&
      option.capability.revision === node.capability.revision,
  );
  const selectedMetadata = selected
    ? capabilityMetadata(selected.capability, t, i18n.language)
    : undefined;
  return (
    <section className="grid gap-2 border-b border-[var(--canvas-panel-line)] pb-4">
      <div className="flex items-start justify-between gap-4">
        <p className="m-0 min-w-0 text-xs leading-5 text-muted">
          {selectedMetadata?.description ??
            t("workflows.editor.capabilityDescriptionFallback")}
        </p>
        <Button
          icon={<EditOutlined aria-hidden="true" />}
          onClick={() => setChanging((current) => !current)}
          size="small"
          type="text"
        >
          {t("workflows.editor.changeCapability")}
        </Button>
      </div>
      {changing ? (
        <Select
          listHeight={360}
          onChange={(identity) => {
            const capability = capabilities.find(
              (item) => capabilityIdentity(item) === identity,
            );
            if (!capability) return;
            onChange({
              ...node,
              capability: {
                contractId: capability.contractId,
                revision: capability.revision,
                canonicalDigest: capability.canonicalDigest,
              },
              input: workflowCapabilityInputDefaults(
                capability.inputSchema,
                capability.authoring,
              ),
            });
            setChanging(false);
          }}
          optionLabelProp="selectedLabel"
          options={options}
          placeholder={t("workflows.editor.capabilityCatalog.search")}
          popupMatchSelectWidth={420}
          showSearch={{
            filterOption: (input, option) =>
              String(option?.searchText ?? "")
                .toLocaleLowerCase()
                .includes(input.toLocaleLowerCase()),
          }}
          value={selected?.value}
          variant="filled"
        />
      ) : null}
    </section>
  );
}

function StructuredBindingEditor({
  binding,
  label,
  onChange,
  variables,
}: {
  readonly binding: WorkflowAuthoringBindingV1;
  readonly label: string;
  readonly onChange: (binding: WorkflowAuthoringBindingV1) => void;
  readonly variables: readonly WorkflowAuthoringVariableOptionV1[];
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"literal" | "variable">(
    binding.kind === "variable" ? "variable" : "literal",
  );
  const [source, setSource] = useState(() =>
    binding.kind === "literal" ? JSON.stringify(binding.value, null, 2) : "{}",
  );
  const [invalid, setInvalid] = useState(false);
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-xs text-ink">{label}</strong>
        <Segmented
          onChange={(value) => {
            const nextMode = value as "literal" | "variable";
            setMode(nextMode);
            if (nextMode === "variable")
              onChange(variableBinding(variables[0]));
          }}
          options={[
            { label: t("workflows.editor.mappingLiteral"), value: "literal" },
            {
              disabled: variables.length === 0,
              label: t("workflows.editor.mappingVariable"),
              value: "variable",
            },
          ]}
          size="small"
          value={mode}
        />
      </div>
      {mode === "variable" ? (
        <VariableSelect
          binding={binding}
          label={t("workflows.editor.selectVariable")}
          onChange={onChange}
          variables={variables}
        />
      ) : (
        <Input.TextArea
          aria-label={label}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setSource(next);
            try {
              onChange({
                kind: "literal",
                value: parseJsonSource(next) as WorkflowJsonValue,
              });
              setInvalid(false);
            } catch {
              setInvalid(true);
            }
          }}
          rows={5}
          {...(invalid ? { status: "error" as const } : {})}
          value={source}
        />
      )}
      {invalid ? (
        <span className="text-[11px] text-danger">
          {t("workflows.editor.invalidJson")}
        </span>
      ) : null}
    </section>
  );
}

function literalRecord(
  binding: WorkflowAuthoringBindingV1,
): Readonly<Record<string, WorkflowJsonValue>> {
  return binding.kind === "literal" &&
    typeof binding.value === "object" &&
    binding.value !== null &&
    !Array.isArray(binding.value)
    ? binding.value
    : {};
}

function numericValue(
  value: Readonly<Record<string, WorkflowJsonValue>>,
  key: string,
  fallback: number,
): number {
  return typeof value[key] === "number" ? value[key] : fallback;
}

const placementQuarterDivisor = 4;
const mediumSubjectScale = 0.75;
const smallSubjectScale = 0.5;
const subjectSizePresets = ["fill", "medium", "small"] as const;

function horizontalPlacement(
  offset: number,
  availableSpace: number,
): "center" | "left" | "right" {
  if (availableSpace === 0) return "center";
  if (offset <= availableSpace / placementQuarterDivisor) return "left";
  if (
    offset >=
    (availableSpace * (placementQuarterDivisor - 1)) / placementQuarterDivisor
  ) {
    return "right";
  }
  return "center";
}

function verticalPlacement(
  offset: number,
  availableSpace: number,
): "bottom" | "middle" | "top" {
  if (availableSpace === 0) return "middle";
  if (offset <= availableSpace / placementQuarterDivisor) return "top";
  if (
    offset >=
    (availableSpace * (placementQuarterDivisor - 1)) / placementQuarterDivisor
  ) {
    return "bottom";
  }
  return "middle";
}

function alignedOffset(
  alignment: "center" | "end" | "start",
  availableSpace: number,
): number {
  if (alignment === "start") return 0;
  if (alignment === "end") return availableSpace;
  return Math.round(availableSpace / 2);
}

function CanvasSizeBindingEditor({
  binding,
  label,
  onChange,
}: {
  readonly binding: WorkflowAuthoringBindingV1;
  readonly label: string;
  readonly onChange: (binding: WorkflowAuthoringBindingV1) => void;
}) {
  const { t } = useTranslation();
  const value = literalRecord(binding);
  const update = (key: "width" | "height", next: number | null) =>
    onChange({
      kind: "literal",
      value: {
        width: numericValue(value, "width", defaultImageDimension),
        height: numericValue(value, "height", defaultImageDimension),
        [key]: next ?? 1,
      },
    });
  return (
    <section className="grid gap-3">
      <strong className="text-xs text-ink">{label}</strong>
      <div className="grid grid-cols-2 gap-3">
        {(["width", "height"] as const).map((key) => (
          <label className="grid gap-1.5" key={key}>
            <span className="text-[11px] font-medium text-muted">
              {t("workflows.editor.placementAxis." + key)}
            </span>
            <InputNumber
              aria-label={`${label} ${key}`}
              className="w-full"
              controls={false}
              max={8192}
              min={1}
              onChange={(next) => update(key, next)}
              precision={0}
              value={numericValue(value, key, defaultImageDimension)}
              variant="filled"
            />
          </label>
        ))}
      </div>
    </section>
  );
}

function PlacementBindingEditor({
  binding,
  canvasBinding,
  label,
  onChange,
}: {
  readonly binding: WorkflowAuthoringBindingV1;
  readonly canvasBinding?: WorkflowAuthoringBindingV1;
  readonly label: string;
  readonly onChange: (binding: WorkflowAuthoringBindingV1) => void;
}) {
  const { t } = useTranslation();
  const [preciseOpen, setPreciseOpen] = useState(false);
  const value = literalRecord(binding);
  const canvas = literalRecord(
    canvasBinding ?? {
      kind: "literal",
      value: {
        width: defaultImageDimension,
        height: defaultImageDimension,
      },
    },
  );
  const canvasWidth = Math.max(
    1,
    numericValue(canvas, "width", defaultImageDimension),
  );
  const canvasHeight = Math.max(
    1,
    numericValue(canvas, "height", defaultImageDimension),
  );
  const placementWidth = Math.max(
    1,
    numericValue(value, "width", defaultImageDimension),
  );
  const placementHeight = Math.max(
    1,
    numericValue(value, "height", defaultImageDimension),
  );
  const placementX = numericValue(value, "x", 0);
  const placementY = numericValue(value, "y", 0);
  const horizontalSpace = Math.max(0, canvasWidth - placementWidth);
  const verticalSpace = Math.max(0, canvasHeight - placementHeight);
  const horizontal = horizontalPlacement(placementX, horizontalSpace);
  const vertical = verticalPlacement(placementY, verticalSpace);
  const replace = (patch: Readonly<Record<string, WorkflowJsonValue>>) =>
    onChange({
      kind: "literal",
      value: {
        x: numericValue(value, "x", 0),
        y: numericValue(value, "y", 0),
        width: numericValue(value, "width", defaultImageDimension),
        height: numericValue(value, "height", defaultImageDimension),
        fit: typeof value.fit === "string" ? value.fit : "contain",
        opacity: numericValue(value, "opacity", 1),
        ...patch,
      },
    });
  const update = (key: string, next: WorkflowJsonValue) =>
    replace({ [key]: next });
  const widthRatio = placementWidth / canvasWidth;
  const heightRatio = placementHeight / canvasHeight;
  let sizePreset: "fill" | "medium" | "small" = "medium";
  if (widthRatio >= 1 && heightRatio >= 1) sizePreset = "fill";
  if (widthRatio <= smallSubjectScale && heightRatio <= smallSubjectScale) {
    sizePreset = "small";
  }
  const applySizePreset = (preset: "fill" | "medium" | "small") => {
    let scale = mediumSubjectScale;
    if (preset === "fill") scale = 1;
    if (preset === "small") scale = smallSubjectScale;
    const width = Math.round(canvasWidth * scale);
    const height = Math.round(canvasHeight * scale);
    replace({
      width,
      height,
      x: Math.round((canvasWidth - width) / 2),
      y: Math.round((canvasHeight - height) / 2),
    });
  };
  return (
    <section className="grid gap-4">
      <strong className="text-xs text-ink">{label}</strong>
      <div className="grid gap-2">
        <span className="text-[11px] font-medium text-muted">
          {t("workflows.editor.subjectSize")}
        </span>
        <Segmented
          block
          onChange={applySizePreset}
          options={subjectSizePresets.map((preset) => ({
            label: t("workflows.editor.subjectSizes." + preset),
            value: preset,
          }))}
          value={sizePreset}
        />
      </div>
      <div className="grid gap-2">
        <span className="text-[11px] font-medium text-muted">
          {t("workflows.editor.placementHorizontal")}
        </span>
        <Segmented
          block
          onChange={(next) => {
            let alignment: "center" | "end" | "start" = "center";
            if (next === "left") alignment = "start";
            if (next === "right") alignment = "end";
            update("x", alignedOffset(alignment, horizontalSpace));
          }}
          options={(["left", "center", "right"] as const).map((position) => ({
            label: t("workflows.editor.placementPositions." + position),
            value: position,
          }))}
          value={horizontal}
        />
      </div>
      <div className="grid gap-2">
        <span className="text-[11px] font-medium text-muted">
          {t("workflows.editor.placementVertical")}
        </span>
        <Segmented
          block
          onChange={(next) => {
            let alignment: "center" | "end" | "start" = "center";
            if (next === "top") alignment = "start";
            if (next === "bottom") alignment = "end";
            update("y", alignedOffset(alignment, verticalSpace));
          }}
          options={(["top", "middle", "bottom"] as const).map((position) => ({
            label: t("workflows.editor.placementPositions." + position),
            value: position,
          }))}
          value={vertical}
        />
      </div>
      <label className="grid gap-2">
        <span className="text-[11px] font-medium text-muted">
          {t("workflows.editor.placementFit")}
        </span>
        <Select
          aria-label={`${label} fit`}
          onChange={(fit) => update("fit", fit)}
          options={["contain", "cover", "stretch"].map((fit) => ({
            label: workflowOptionLabel(fit, t),
            value: fit,
          }))}
          value={typeof value.fit === "string" ? value.fit : "contain"}
          variant="filled"
        />
      </label>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-muted">
            {t("workflows.editor.placementOpacity")}
          </span>
          <output className="text-[11px] tabular-nums text-muted">
            {Math.round(numericValue(value, "opacity", 1) * 100)}%
          </output>
        </div>
        <Slider
          max={1}
          min={0}
          onChange={(next) => update("opacity", next)}
          step={0.05}
          tooltip={{
            formatter: (next) => `${Math.round((next ?? 1) * 100)}%`,
          }}
          value={numericValue(value, "opacity", 1)}
        />
      </div>
      <Button
        className="w-fit px-0"
        icon={
          <DownOutlined
            aria-hidden="true"
            className={
              preciseOpen
                ? "rotate-180 transition-transform"
                : "transition-transform"
            }
          />
        }
        onClick={() => setPreciseOpen((current) => !current)}
        size="small"
        type="text"
      >
        {t("workflows.editor.precisePlacement")}
      </Button>
      {preciseOpen ? (
        <div className="grid grid-cols-2 gap-3 border-t border-[var(--canvas-panel-line)] pt-3">
          {(["x", "y", "width", "height"] as const).map((key) => {
            const dimension = key === "width" || key === "height";
            const fallback = dimension ? defaultImageDimension : 0;
            return (
              <label className="grid gap-1.5" key={key}>
                <span className="text-[11px] font-medium text-muted">
                  {t("workflows.editor.placementAxis." + key)}
                </span>
                <InputNumber
                  aria-label={`${label} ${key}`}
                  className="w-full"
                  controls={false}
                  max={8192}
                  min={dimension ? 1 : 0}
                  onChange={(next) => update(key, next ?? (dimension ? 1 : 0))}
                  precision={0}
                  value={numericValue(value, key, fallback)}
                  variant="filled"
                />
              </label>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function BackgroundSourceBindingEditor({
  binding,
  label,
  onChange,
  variables,
}: {
  readonly binding: WorkflowAuthoringBindingV1;
  readonly label: string;
  readonly onChange: (binding: WorkflowAuthoringBindingV1) => void;
  readonly variables: readonly WorkflowAuthoringVariableOptionV1[];
}) {
  const { t } = useTranslation();
  const literal = literalRecord(binding);
  const object = objectFields(binding);
  const kindBinding = object.kind;
  let kind: "artifact" | "color" = "color";
  if (
    (kindBinding?.kind === "literal" && kindBinding.value === "artifact") ||
    literal.kind === "artifact"
  ) {
    kind = "artifact";
  }
  const artifactBinding = object.artifactId;
  const fitBinding = object.fit;
  const fit =
    fitBinding?.kind === "literal" && typeof fitBinding.value === "string"
      ? fitBinding.value
      : "cover";
  return (
    <section className="grid gap-3">
      <strong className="text-xs text-ink">{label}</strong>
      <Segmented
        block
        onChange={(nextKind) =>
          onChange(
            nextKind === "artifact"
              ? {
                  kind: "object",
                  fields: {
                    kind: { kind: "literal", value: "artifact" },
                    artifactId: variableBinding(variables[0]),
                    fit: { kind: "literal", value: "cover" },
                  },
                }
              : {
                  kind: "literal",
                  value: { kind: "color", color: "#FFFFFFFF" },
                },
          )
        }
        options={[
          { label: t("workflows.editor.backgroundColor"), value: "color" },
          {
            label: t("workflows.editor.backgroundImage"),
            value: "artifact",
            disabled: variables.length === 0,
          },
        ]}
        value={kind}
      />
      {kind === "color" ? (
        <ColorPicker
          className="w-full"
          format="hex"
          onChangeComplete={(color) =>
            onChange({
              kind: "literal",
              value: { kind: "color", color: `${color.toHexString()}FF` },
            })
          }
          showText
          value={
            typeof literal.color === "string"
              ? literal.color.slice(0, hexColorDisplayLength)
              : "#FFFFFF"
          }
        />
      ) : (
        <div className="grid gap-3">
          <VariableSelect
            binding={artifactBinding ?? variableBinding(variables[0])}
            label={label}
            onChange={(artifactId) =>
              onChange({
                kind: "object",
                fields: {
                  kind: { kind: "literal", value: "artifact" },
                  artifactId,
                  fit: { kind: "literal", value: fit },
                },
              })
            }
            showLabel={false}
            variables={variables}
          />
          <label className="grid gap-1.5">
            <span className="text-[11px] font-medium text-muted">
              {t("workflows.editor.backgroundFit")}
            </span>
            <Select
              aria-label={`${label} fit`}
              onChange={(nextFit) =>
                onChange({
                  kind: "object",
                  fields: {
                    kind: { kind: "literal", value: "artifact" },
                    artifactId:
                      artifactBinding ?? variableBinding(variables[0]),
                    fit: { kind: "literal", value: nextFit },
                  },
                })
              }
              options={["cover", "contain", "stretch"].map((item) => ({
                label: workflowOptionLabel(item, t),
                value: item,
              }))}
              value={fit}
              variant="filled"
            />
          </label>
        </div>
      )}
    </section>
  );
}

export function inputFieldsWithDerivations(options: {
  readonly capability: WorkflowAuthoringCapability | undefined;
  readonly fields: Readonly<Record<string, WorkflowAuthoringBindingV1>>;
  readonly parameterKey: string;
  readonly value: WorkflowAuthoringBindingV1;
  readonly variables: readonly WorkflowAuthoringVariableOptionV1[];
}): Readonly<Record<string, WorkflowAuthoringBindingV1>> {
  const next: Record<string, WorkflowAuthoringBindingV1> = {
    ...options.fields,
    [options.parameterKey]: options.value,
  };
  const derivations = options.capability?.authoring.parameters.filter(
    (parameter) =>
      parameter.derivation?.kind === "same_bundle_role" &&
      parameter.derivation.fromParameter === options.parameterKey,
  );
  if (!derivations || derivations.length === 0) return next;
  const selectedId = selectedVariableId(options.value, options.variables);
  const selected = options.variables.find((item) => item.id === selectedId);
  for (const parameter of derivations) {
    const derivation = parameter.derivation;
    if (!derivation || !selected?.bundle) {
      delete next[parameter.key];
      continue;
    }
    const derived = options.variables.find(
      (item) =>
        item.sourceNodeId === selected.sourceNodeId &&
        item.bundle?.key === selected.bundle?.key &&
        item.bundle?.role === derivation.role,
    );
    if (derived) next[parameter.key] = variableBinding(derived);
    else delete next[parameter.key];
  }
  return next;
}

type CapabilityParameterSectionV1 =
  "content" | "layout" | "materials" | "settings";

export function workflowParameterSectionV1(
  semanticType: WorkflowCapabilitySemanticType | undefined,
): CapabilityParameterSectionV1 {
  if (
    semanticType === "background.source" ||
    semanticType?.startsWith("artifact.") === true
  ) {
    return "materials";
  }
  if (semanticType === "prompt.rich") {
    return "content";
  }
  if (semanticType?.startsWith("layout.") === true) return "layout";
  return "settings";
}

function CapabilityMappings({
  capabilities,
  node,
  onChange,
  variables,
}: {
  readonly capabilities: readonly WorkflowAuthoringCapability[];
  readonly node: CapabilityAuthoringNodeV1;
  readonly onChange: (node: CapabilityAuthoringNodeV1) => void;
  readonly variables: readonly WorkflowAuthoringVariableOptionV1[];
}) {
  const { i18n, t } = useTranslation();
  const capability = capabilities.find(
    (item) => item.contractId === node.capability.contractId,
  );
  const inputSchema = capability?.inputSchema ?? {};
  const hydratedInput = workflowCapabilityInputWithDefaults(
    inputSchema,
    node.input,
    capability?.authoring,
  );
  const fields = objectFields(hydratedInput);
  const inputProperties = Object.fromEntries(schemaFields(inputSchema));
  const declaredFields = capability
    ? capability.authoring.parameters.map(
        (parameter) => [parameter.key, inputProperties[parameter.key]] as const,
      )
    : schemaFields(inputSchema);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const visibleDeclaredFields = declaredFields.filter(([key]) => {
    const declaration = workflowCapabilityParameter(capability, key);
    if (declaration?.exposurePolicy.default === "hidden_derived") return false;
    if (
      declaration?.required === false &&
      (declaration.editor === "artifact_picker" ||
        declaration.editor === "artifact_list_picker")
    ) {
      const schema = inputProperties[key];
      const fieldSchema =
        typeof schema === "object" && schema !== null
          ? (schema as Readonly<Record<string, unknown>>)
          : {};
      return (
        compatibleVariables(fieldSchema, variables, declaration.semanticType)
          .length > 0
      );
    }
    return true;
  });
  const groupedFieldMap = new Map<
    CapabilityParameterSectionV1,
    (typeof declaredFields)[number][]
  >();
  for (const field of visibleDeclaredFields) {
    const declaration = workflowCapabilityParameter(capability, field[0]);
    const section = workflowParameterSectionV1(declaration?.semanticType);
    const sectionFields = groupedFieldMap.get(section) ?? [];
    sectionFields.push(field);
    groupedFieldMap.set(section, sectionFields);
  }
  const groupedFields = [...groupedFieldMap].map(
    ([section, sectionFields]) => ({
      fields: sectionFields,
      section,
    }),
  );

  const renderField = ([key, schema]: (typeof declaredFields)[number]) => {
    const fieldSchema =
      typeof schema === "object" && schema !== null
        ? (schema as Readonly<Record<string, unknown>>)
        : {};
    const declaration = workflowCapabilityParameter(capability, key);
    const language = i18n.language;
    let label = key;
    if (declaration !== undefined) {
      label = workflowCapabilityText(declaration.label, language);
    } else if (typeof fieldSchema.title === "string") {
      label = fieldSchema.title;
    }
    const binding =
      fields[key] ??
      ({
        kind: "literal" as const,
        value: declaration?.defaultValue ?? null,
      } satisfies WorkflowAuthoringBindingV1);
    const availableVariables = compatibleVariables(
      fieldSchema,
      variables,
      declaration?.semanticType,
    );
    const kind = workflowAuthoringFieldKind(fieldSchema);
    const enumValues = schemaEnumScalars(fieldSchema);
    const updateBinding = (value: WorkflowAuthoringBindingV1) =>
      onChange({
        ...node,
        input: {
          kind: "object",
          fields: inputFieldsWithDerivations({
            capability,
            fields,
            parameterKey: key,
            value,
            variables,
          }),
        },
      });
    let control: ReactNode;
    if (Object.hasOwn(fieldSchema, "const")) {
      control = (
        <div className="flex min-h-10 items-center justify-between border-b border-[var(--canvas-panel-line)] text-xs">
          <strong className="text-ink">{label}</strong>
          <span className="text-muted">{String(fieldSchema.const)}</span>
        </div>
      );
    } else if (declaration?.editor === "canvas_size") {
      control = (
        <CanvasSizeBindingEditor
          binding={binding}
          label={label}
          onChange={updateBinding}
        />
      );
    } else if (declaration?.editor === "placement") {
      const canvasParameter = capability?.authoring.parameters.find(
        (parameter) => parameter.editor === "canvas_size",
      );
      control = (
        <PlacementBindingEditor
          binding={binding}
          {...(canvasParameter && fields[canvasParameter.key]
            ? { canvasBinding: fields[canvasParameter.key] }
            : {})}
          label={label}
          onChange={updateBinding}
        />
      );
    } else if (declaration?.editor === "background_source") {
      control = (
        <BackgroundSourceBindingEditor
          binding={binding}
          label={label}
          onChange={updateBinding}
          variables={availableVariables}
        />
      );
    } else if (
      declaration?.editor === "artifact_picker" ||
      declaration?.editor === "artifact_list_picker"
    ) {
      control = (
        <VariableSelect
          binding={binding}
          label={label}
          onChange={updateBinding}
          variables={availableVariables}
        />
      );
    } else if (enumValues.length > 0) {
      control = (
        <EnumBindingEditor
          binding={binding}
          label={label}
          onChange={updateBinding}
          schema={fieldSchema}
          variables={availableVariables}
        />
      );
    } else if (kind === "number" || kind === "integer" || kind === "boolean") {
      control = (
        <ScalarBindingEditor
          allowLiteral={
            declaration?.sourcePolicy.allowed.includes("constant") ?? true
          }
          allowVariable={
            availableVariables.length > 0 &&
            (declaration?.sourcePolicy.allowed.includes("workflow_input") ===
              true ||
              declaration?.sourcePolicy.allowed.includes("upstream") === true)
          }
          binding={binding}
          kind={kind}
          label={label}
          onChange={updateBinding}
          schema={fieldSchema}
          variables={availableVariables}
        />
      );
    } else if (declaration?.editor === "rich_prompt" || kind === "string") {
      control = (
        <Suspense fallback={<div className="h-36 animate-pulse bg-mist" />}>
          <WorkflowRichPromptV1
            binding={binding}
            label={label}
            onChange={updateBinding}
            variables={availableVariables}
          />
        </Suspense>
      );
    } else if (kind === "object") {
      control = (
        <StructuredBindingEditor
          binding={binding}
          label={label}
          onChange={updateBinding}
          variables={availableVariables}
        />
      );
    } else {
      control = (
        <VariableSelect
          binding={binding}
          label={label}
          onChange={updateBinding}
          variables={availableVariables}
        />
      );
    }
    return (
      <section
        className="grid gap-1.5 border-b border-[var(--canvas-panel-line)] pb-4 last:border-b-0 last:pb-0"
        key={key}
      >
        {control}
        {declaration?.description ? (
          <span className="text-[11px] leading-4 text-muted">
            {workflowCapabilityText(declaration.description, language)}
          </span>
        ) : null}
      </section>
    );
  };

  return (
    <section className="grid gap-6">
      {groupedFields.length === 0 ? (
        <p className="m-0 text-xs text-muted">
          {t("workflows.editor.noInputFields")}
        </p>
      ) : null}
      {groupedFields.map((group) => {
        const collapsed =
          group.section === "settings" &&
          group.fields.every(([key]) => {
            const declaration = workflowCapabilityParameter(capability, key);
            return declaration?.required === false;
          });
        const visible = !collapsed || settingsOpen;
        return (
          <section
            className="grid gap-4 border-t border-[var(--canvas-panel-line)] pt-5 first:border-t-0 first:pt-0"
            key={group.section}
          >
            {collapsed ? (
              <Button
                className="w-fit px-0"
                icon={
                  <DownOutlined
                    aria-hidden="true"
                    className={
                      settingsOpen
                        ? "rotate-180 transition-transform"
                        : "transition-transform"
                    }
                  />
                }
                onClick={() => setSettingsOpen((current) => !current)}
                size="small"
                type="text"
              >
                {t("workflows.editor.parameterSections.moreSettings", {
                  count: group.fields.length,
                })}
              </Button>
            ) : (
              <h3 className="m-0 text-sm font-bold text-ink">
                {t("workflows.editor.parameterSections." + group.section)}
              </h3>
            )}
            {visible ? (
              <div className="grid gap-4">{group.fields.map(renderField)}</div>
            ) : null}
          </section>
        );
      })}
    </section>
  );
}

function CapabilityOutputs({
  capabilities,
  node,
}: {
  readonly capabilities: readonly WorkflowAuthoringCapability[];
  readonly node: CapabilityAuthoringNodeV1;
}) {
  const { i18n, t } = useTranslation();
  const capability = capabilities.find(
    (item) => item.contractId === node.capability.contractId,
  );
  const outputSchema = capability?.outputSchema ?? {};
  const outputProperties = Object.fromEntries(schemaFields(outputSchema));
  const outputs = capability
    ? capability.authoring.outputs.map(
        (output) => [output.key, outputProperties[output.key]] as const,
      )
    : schemaFields(outputSchema);
  return (
    <section className="grid gap-3 border-t border-[var(--canvas-panel-line)] pt-5">
      <strong className="text-sm text-ink">
        {t("workflows.editor.shell.produces")}
      </strong>
      <div className="grid divide-y divide-[var(--canvas-panel-line)]">
        {outputs.map(([key]) => {
          const declaration = workflowCapabilityOutput(capability, key);
          if (declaration?.visibility !== "author") return null;
          return (
            <div
              className="flex min-h-10 items-center justify-between text-xs"
              key={key}
            >
              <span className="text-ink">
                {declaration
                  ? workflowCapabilityText(declaration.label, i18n.language)
                  : key}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function approvalText(
  binding: WorkflowAuthoringBindingV1,
  key: "title" | "message",
): string {
  const field = objectFields(binding)[key];
  return field?.kind === "literal" && typeof field.value === "string"
    ? field.value
    : "";
}

function ApprovalDecisionFields({
  schema,
}: {
  readonly schema: Readonly<Record<string, unknown>>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const fields = workflowApprovalDecisionFields(
    schema,
    t("workflows.editor.approvalDecisionApprovedTitle"),
  );
  return (
    <section className="grid gap-2 rounded-xl bg-mist p-3">
      <strong className="text-xs text-ink">
        {t("workflows.editor.shell.decisions")}
      </strong>
      <p className="m-0 text-xs leading-5 text-muted">
        {t("workflows.editor.approvalDecisionHint")}
      </p>
      <ul className="m-0 grid list-none gap-1 p-0">
        {fields.map((field) => (
          <li className="text-xs font-semibold text-ink" key={field.key}>
            {field.title}
          </li>
        ))}
      </ul>
    </section>
  );
}

function nodeWithCapabilityDefaults(
  node: WorkflowAuthoringNodeV1,
  capabilities: readonly WorkflowAuthoringCapability[],
): WorkflowAuthoringNodeV1 {
  if (node.type !== "capability" && node.type !== "batch") return node;
  const capability = capabilities.find(
    (item) =>
      item.contractId === node.capability.contractId &&
      item.revision === node.capability.revision,
  );
  return capability
    ? {
        ...node,
        input: workflowCapabilityInputWithDefaults(
          capability.inputSchema,
          node.input,
          capability.authoring,
        ),
      }
    : node;
}

export function WorkflowAuthoringNodeEditorV1({
  capabilities,
  node,
  onApply,
  onClose,
  open,
  variables,
}: {
  readonly capabilities: readonly WorkflowAuthoringCapability[];
  readonly node: WorkflowAuthoringNodeV1;
  readonly onApply: (node: WorkflowAuthoringNodeV1) => void;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly variables: readonly WorkflowAuthoringVariableOptionV1[];
}) {
  const { i18n, t } = useTranslation();
  const [draft, setDraft] = useState(() =>
    nodeWithCapabilityDefaults(node, capabilities),
  );
  const fieldIssues =
    draft.type === "input" || draft.type === "output"
      ? validateWorkflowAuthoringFields(draft.fields)
      : [];
  let content: ReactNode;

  if (draft.type === "input") {
    content = (
      <FieldsEditor
        fields={draft.fields}
        onChange={(fields) =>
          setDraft({
            ...draft,
            fields: fields as readonly WorkflowAuthoringFieldV1[],
          })
        }
        output={false}
        variables={variables}
      />
    );
  } else if (draft.type === "output") {
    content = (
      <FieldsEditor
        fields={draft.fields}
        onChange={(fields) =>
          setDraft({
            ...draft,
            fields: fields as readonly WorkflowAuthoringOutputFieldV1[],
          })
        }
        output
        variables={variables}
      />
    );
  } else if (draft.type === "capability") {
    content = (
      <div className="grid gap-5">
        <CapabilitySelect
          capabilities={capabilities}
          node={draft}
          onChange={setDraft}
        />
        <CapabilityMappings
          capabilities={capabilities}
          node={draft}
          onChange={setDraft}
          variables={variables}
        />
        <CapabilityOutputs capabilities={capabilities} node={draft} />
      </div>
    );
  } else if (draft.type === "condition") {
    content = (
      <div className="grid gap-5">
        <VariableSelect
          binding={draft.value}
          label={t("workflows.editor.switchValue")}
          onChange={(value) => setDraft({ ...draft, value })}
          variables={variables}
        />
        <section className="grid gap-3">
          <strong className="text-xs text-ink">
            {t("workflows.editor.switchCases")}
          </strong>
          {draft.cases.map((item, index) => (
            <div className="grid gap-2 rounded-xl bg-mist p-3" key={item.id}>
              <Input
                onChange={(event) => {
                  const cases = [...draft.cases];
                  cases[index] = { ...item, label: event.currentTarget.value };
                  setDraft({ ...draft, cases });
                }}
                value={item.label}
              />
              <Select
                onChange={(operator) => {
                  const cases = [...draft.cases];
                  cases[index] = { ...item, operator };
                  setDraft({ ...draft, cases });
                }}
                options={["exists", "equals", "not_equals", "in"].map(
                  (operator) => ({
                    label: t(
                      `workflows.editor.operators.${operator === "not_equals" ? "notEquals" : operator}`,
                    ),
                    value: operator,
                  }),
                )}
                value={item.operator}
              />
              {item.operator !== "exists" ? (
                <Input
                  onChange={(event) => {
                    const cases = [...draft.cases];
                    cases[index] = {
                      ...item,
                      value:
                        item.operator === "in"
                          ? event.currentTarget.value
                              .split(",")
                              .map((value) => value.trim())
                              .filter(Boolean)
                          : event.currentTarget.value,
                    };
                    setDraft({ ...draft, cases });
                  }}
                  placeholder={t("workflows.editor.conditionValue")}
                  value={
                    item.operator === "in" && Array.isArray(item.value)
                      ? conditionListText(item.value)
                      : conditionValueText(item.value)
                  }
                />
              ) : null}
              <Button
                danger
                disabled={draft.cases.length === 1}
                onClick={() =>
                  setDraft({
                    ...draft,
                    cases: draft.cases.filter(
                      (_case, caseIndex) => caseIndex !== index,
                    ),
                  })
                }
                size="small"
                type="text"
              >
                {t("workflows.editor.deleteBranch")}
              </Button>
            </div>
          ))}
          <Button
            block
            onClick={() =>
              setDraft({
                ...draft,
                cases: [
                  ...draft.cases,
                  {
                    id: `case_${String(draft.cases.length + 1)}`,
                    label: t("workflows.editor.newBranch"),
                    operator: "exists",
                  },
                ],
              })
            }
          >
            {t("workflows.editor.addCondition")}
          </Button>
          <label className="grid gap-2 text-xs font-semibold text-ink">
            {t("workflows.editor.defaultBranch")}
            <Input
              onChange={(event) =>
                setDraft({ ...draft, defaultLabel: event.currentTarget.value })
              }
              value={draft.defaultLabel}
            />
          </label>
        </section>
      </div>
    );
  } else if (draft.type === "batch") {
    content = (
      <div className="grid gap-5">
        <VariableSelect
          binding={draft.items}
          label={t("workflows.editor.mapItems")}
          onChange={(items) => setDraft({ ...draft, items })}
          variables={variables}
        />
        <CapabilitySelect
          capabilities={capabilities}
          node={draft}
          onChange={setDraft}
        />
        <label className="grid gap-2 text-xs font-semibold text-ink">
          {t("workflows.editor.failureMode")}
          <Select
            onChange={(failureMode) => setDraft({ ...draft, failureMode })}
            options={(["fail_fast", "collect_all"] as const).map((mode) => ({
              label: t(
                `workflows.editor.failureModes.${mode === "fail_fast" ? "failFast" : "collectAll"}`,
              ),
              value: mode,
            }))}
            value={draft.failureMode}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-2 text-xs font-semibold text-ink">
            {t("workflows.editor.maxItems")}
            <InputNumber
              max={1000}
              min={1}
              onChange={(maxItems) =>
                setDraft({ ...draft, maxItems: maxItems ?? 1 })
              }
              value={draft.maxItems}
            />
          </label>
          <label className="grid gap-2 text-xs font-semibold text-ink">
            {t("workflows.editor.concurrency")}
            <InputNumber
              max={32}
              min={1}
              onChange={(maxConcurrency) =>
                setDraft({ ...draft, maxConcurrency: maxConcurrency ?? 1 })
              }
              value={draft.maxConcurrency}
            />
          </label>
        </div>
        <CapabilityMappings
          capabilities={capabilities}
          node={draft}
          onChange={setDraft}
          variables={variables}
        />
        <CapabilityOutputs capabilities={capabilities} node={draft} />
      </div>
    );
  } else {
    content = (
      <div className="grid gap-4">
        <label className="grid gap-2 text-xs font-semibold text-ink">
          {t("workflows.editor.approvalRequestTitle")}
          <Input
            onChange={(event) =>
              setDraft({
                ...draft,
                request: {
                  kind: "object",
                  fields: {
                    ...objectFields(draft.request),
                    title: {
                      kind: "literal",
                      value: event.currentTarget.value,
                    },
                  },
                },
              })
            }
            value={approvalText(draft.request, "title")}
          />
        </label>
        <label className="grid gap-2 text-xs font-semibold text-ink">
          {t("workflows.editor.approvalRequestMessage")}
          <Input.TextArea
            onChange={(event) =>
              setDraft({
                ...draft,
                request: {
                  kind: "object",
                  fields: {
                    ...objectFields(draft.request),
                    message: {
                      kind: "literal",
                      value: event.currentTarget.value,
                    },
                  },
                },
              })
            }
            rows={4}
            value={approvalText(draft.request, "message")}
          />
        </label>
        <ApprovalDecisionFields schema={draft.decisionSchema} />
      </div>
    );
  }

  return (
    <Drawer
      extra={
        <Button
          disabled={fieldIssues.length > 0}
          onClick={() => {
            onApply(draft);
            onClose();
          }}
          type="primary"
        >
          {t("workflows.editor.apply")}
        </Button>
      }
      onClose={onClose}
      open={open}
      size={420}
      title={t(`workflows.editor.configureKinds.${node.type}`)}
    >
      <div className="grid gap-5">
        <label className="grid gap-2 text-xs font-semibold text-ink">
          {t("workflows.editor.nodeName")}
          <Input
            disabled={draft.type === "input" || draft.type === "output"}
            onChange={(event) =>
              setDraft({ ...draft, displayName: event.currentTarget.value })
            }
            value={editableNodeName(draft, capabilities, i18n.language, t)}
          />
        </label>
        {content}
      </div>
    </Drawer>
  );
}
