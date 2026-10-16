import type {
  ModelResourceSummary,
  ProviderExecutionRouteSummary,
  RuntimeAdapterSummary,
} from "@kanvas/contracts/api";
import { resolveLocalizedTextV1 } from "@kanvas/contracts/capability";
import { Button, Form } from "antd";
import { useTranslation } from "react-i18next";

import { InlineNotice } from "../../components/feedback.js";
import { KanvasInput, KanvasTextArea } from "../../components/kanvas-input.js";
import { KanvasSelect } from "../../components/kanvas-select.js";
import {
  SettingsDialog,
  SettingsDialogContent,
} from "../../components/settings-overlay.js";
import {
  compatibleRuntimeAdapters,
  type CapabilityImplementationSource,
} from "./capability-implementation-editor.js";
import {
  capabilityEditorLocale,
  capabilityEditorText,
  capabilityDefinitionAdapterDefaults,
  type CapabilityDefinitionDraft,
  updateCapabilityEditorText,
} from "./capability-definition-editor.js";

const capabilityCategories = [
  { value: "image_processing", zh: "图像处理", en: "Image processing" },
  { value: "image_generation", zh: "图像生成", en: "Image generation" },
  { value: "image_analysis", zh: "图像分析", en: "Image analysis" },
] as const;

function sourceFrom(value: string): CapabilityImplementationSource | undefined {
  const separator = value.indexOf(":");
  if (separator < 1) return undefined;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (kind === "model_resource") return { kind, id };
  if (kind === "model_service") return { kind, id };
  if (kind === "plugin") return { kind, id };
  return undefined;
}

function sourceFromDraft(
  draft: CapabilityDefinitionDraft,
): CapabilityImplementationSource | undefined {
  if (!draft.sourceKind || !draft.sourceId) return undefined;
  return { kind: draft.sourceKind, id: draft.sourceId };
}

export function CapabilityDefinitionCreateDialog({
  adapters,
  draft,
  onChange,
  onSave,
  providerRoutes,
  resources,
  saving,
}: {
  readonly adapters: readonly RuntimeAdapterSummary[];
  readonly draft: CapabilityDefinitionDraft | undefined;
  readonly onChange: (draft: CapabilityDefinitionDraft | undefined) => void;
  readonly onSave: () => void;
  readonly providerRoutes: readonly ProviderExecutionRouteSummary[];
  readonly resources: readonly ModelResourceSummary[];
  readonly saving: boolean;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const locale = capabilityEditorLocale(i18n.resolvedLanguage);
  const update = (value: Partial<CapabilityDefinitionDraft>) =>
    onChange(draft ? { ...draft, ...value } : draft);
  const selectedSource = draft ? sourceFromDraft(draft) : undefined;
  const compatible = compatibleRuntimeAdapters(
    selectedSource,
    resources,
    providerRoutes,
    adapters,
  );
  const sourceValue = selectedSource
    ? `${selectedSource.kind}:${selectedSource.id}`
    : undefined;
  const readyToCreate = Boolean(
    sourceValue &&
    draft?.runtimeAdapterRevisionId &&
    draft.titleZh.trim() &&
    draft.titleEn.trim() &&
    draft.categoryZh.trim() &&
    draft.categoryEn.trim(),
  );

  function selectSource(value: unknown): void {
    if (!draft) return;
    const source = sourceFrom(String(value));
    if (!source) return;
    const choices = compatibleRuntimeAdapters(
      source,
      resources,
      providerRoutes,
      adapters,
    );
    const next: CapabilityDefinitionDraft = {
      ...draft,
      sourceKind: source.kind,
      sourceId: source.id,
      runtimeAdapterRevisionId: "",
    };
    onChange(
      choices.length === 1
        ? {
            ...next,
            ...capabilityDefinitionAdapterDefaults(next, choices[0]!),
          }
        : next,
    );
  }

  function selectRuntimeAdapter(value: unknown): void {
    const selected = compatible.find((adapter) => adapter.id === String(value));
    if (selected && draft) {
      update(capabilityDefinitionAdapterDefaults(draft, selected));
    }
  }

  function selectCategory(value: unknown): void {
    const category = capabilityCategories.find(
      (item) => item.value === String(value),
    );
    if (category) {
      update({ categoryZh: category.zh, categoryEn: category.en });
    }
  }

  function updateTitle(value: string): void {
    if (!draft) return;
    const next = updateCapabilityEditorText(
      locale,
      draft.titleZh,
      draft.titleEn,
      value,
    );
    update({ titleZh: next.zh, titleEn: next.en });
  }

  function updateDescription(value: string): void {
    if (!draft) return;
    const next = value.trim()
      ? updateCapabilityEditorText(
          locale,
          draft.descriptionZh,
          draft.descriptionEn,
          value,
        )
      : { zh: "", en: "" };
    update({ descriptionZh: next.zh, descriptionEn: next.en });
  }

  return (
    <SettingsDialog
      onOpenChange={(open) => {
        if (!open && !saving) onChange(undefined);
      }}
      open={Boolean(draft)}
    >
      <SettingsDialogContent
        closeLabel={t("settings.capabilityDefinitions.close")}
        description={t("settings.capabilityDefinitions.createDescription")}
        dismissible={!saving}
        scrollable
        title={t("settings.capabilityDefinitions.createTitle")}
        width={680}
      >
        {draft ? (
          <Form className="space-y-6" layout="vertical" onFinish={onSave}>
            <div className="grid gap-4">
              <Form.Item
                label={t(
                  "settings.capabilityDefinitions.implementation.source",
                )}
                required
              >
                <KanvasSelect
                  onChange={selectSource}
                  options={[
                    ...resources
                      .filter(
                        (resource) =>
                          resource.status === "active" &&
                          compatibleRuntimeAdapters(
                            { kind: "model_resource", id: resource.revisionId },
                            resources,
                            providerRoutes,
                            adapters,
                          ).length > 0,
                      )
                      .map((resource) => ({
                        label: resource.displayName,
                        value: `model_resource:${resource.revisionId}`,
                      })),
                    ...providerRoutes
                      .filter(
                        (route) =>
                          route.availabilityReason === "ready" &&
                          compatibleRuntimeAdapters(
                            {
                              kind: "model_service",
                              id: route.routePolicyRevisionId,
                            },
                            resources,
                            providerRoutes,
                            adapters,
                          ).length > 0,
                      )
                      .map((route) => ({
                        label: `${route.providerName} · ${route.providerModelId}`,
                        value: `model_service:${route.routePolicyRevisionId}`,
                      })),
                    ...adapters
                      .filter((adapter) =>
                        adapter.sourceKinds.includes("plugin"),
                      )
                      .map((adapter) => ({
                        label: resolveLocalizedTextV1(
                          adapter.displayName,
                          i18n.resolvedLanguage ?? "zh-CN",
                        ),
                        value: `plugin:${adapter.id}`,
                      })),
                  ]}
                  placeholder={t(
                    "settings.capabilityDefinitions.implementation.sourcePlaceholder",
                  )}
                  value={sourceValue}
                />
              </Form.Item>

              {selectedSource && compatible.length === 0 ? (
                <InlineNotice
                  title={t(
                    "settings.capabilityDefinitions.implementation.noSourceTitle",
                  )}
                  tone="info"
                >
                  {t(
                    "settings.capabilityDefinitions.implementation.noSourceDescription",
                  )}
                </InlineNotice>
              ) : null}

              {compatible.length > 0 ? (
                <Form.Item
                  label={t(
                    "settings.capabilityDefinitions.implementation.runtime",
                  )}
                  required
                >
                  <KanvasSelect
                    onChange={selectRuntimeAdapter}
                    options={compatible.map((adapter) => ({
                      label: resolveLocalizedTextV1(
                        adapter.displayName,
                        i18n.resolvedLanguage ?? "zh-CN",
                      ),
                      value: adapter.id,
                    }))}
                    value={draft.runtimeAdapterRevisionId || undefined}
                  />
                </Form.Item>
              ) : null}
            </div>

            {draft.runtimeAdapterRevisionId ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Form.Item
                  label={t("settings.capabilityDefinitions.fields.name")}
                  required
                >
                  <KanvasInput
                    onChange={(event) => updateTitle(event.target.value)}
                    value={capabilityEditorText(
                      locale,
                      draft.titleZh,
                      draft.titleEn,
                    )}
                  />
                </Form.Item>
                <Form.Item
                  label={t("settings.capabilityDefinitions.fields.category")}
                  required
                >
                  <KanvasSelect
                    onChange={selectCategory}
                    options={capabilityCategories.map((category) => ({
                      label: locale === "zh-CN" ? category.zh : category.en,
                      value: category.value,
                    }))}
                  />
                </Form.Item>
                <Form.Item
                  className="md:col-span-2"
                  label={t("settings.capabilityDefinitions.fields.description")}
                >
                  <KanvasTextArea
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    onChange={(event) => updateDescription(event.target.value)}
                    value={capabilityEditorText(
                      locale,
                      draft.descriptionZh,
                      draft.descriptionEn,
                    )}
                  />
                </Form.Item>
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <Button disabled={saving} onClick={() => onChange(undefined)}>
                {t("settings.capabilityDefinitions.cancel")}
              </Button>
              <Button
                disabled={!readyToCreate}
                htmlType="submit"
                loading={saving}
                type="primary"
              >
                {t("settings.capabilityDefinitions.create")}
              </Button>
            </div>
          </Form>
        ) : null}
      </SettingsDialogContent>
    </SettingsDialog>
  );
}
