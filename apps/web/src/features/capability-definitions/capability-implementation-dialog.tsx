import { Button, Checkbox, Form, InputNumber } from "antd";
import { resolveLocalizedTextV1 } from "@kanvas/contracts/capability";
import type {
  ModelResourceSummary,
  ProviderExecutionRouteSummary,
  RuntimeAdapterSummary,
} from "@kanvas/contracts/api";
import { useTranslation } from "react-i18next";
import { useState } from "react";

import { InlineNotice } from "../../components/feedback.js";
import { KanvasInput } from "../../components/kanvas-input.js";
import { KanvasSelect } from "../../components/kanvas-select.js";
import { StatusTag } from "../../components/status-tag.js";
import {
  SettingsDialog,
  SettingsDialogContent,
} from "../../components/settings-overlay.js";
import {
  capabilityImplementationDraftError,
  compatibleRuntimeAdapters,
  selectCapabilityImplementationAdapter,
  type CapabilityImplementationDefinitionContext,
  type CapabilityImplementationDraft,
  type CapabilityImplementationSource,
  type InputFieldMappingDraft,
} from "./capability-implementation-editor.js";

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function propertyKeys(schema: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(record(schema.properties) ?? {});
}

function configurationValue(
  value: string,
  schema: Readonly<Record<string, unknown>>,
): string | number | boolean {
  if (schema.type === "boolean") return value === "true";
  if (schema.type === "integer") return Number.parseInt(value, 10);
  if (schema.type === "number") return Number(value);
  return value;
}

function configurationText(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}

export function CapabilityImplementationDialog({
  adapters,
  creating,
  definition,
  draft,
  onChange,
  onConfigureModels,
  onPublish,
  providerRoutes,
  publishing,
  resources,
}: {
  readonly adapters: readonly RuntimeAdapterSummary[];
  readonly creating?: boolean;
  readonly definition: CapabilityImplementationDefinitionContext | undefined;
  readonly draft: CapabilityImplementationDraft | undefined;
  readonly onChange: (draft: CapabilityImplementationDraft | undefined) => void;
  readonly onConfigureModels: () => void;
  readonly onPublish: () => void;
  readonly providerRoutes: readonly ProviderExecutionRouteSummary[];
  readonly publishing: boolean;
  readonly resources: readonly ModelResourceSummary[];
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [submittedRequestKey, setSubmittedRequestKey] = useState<string>();
  const submitted = submittedRequestKey === draft?.requestKey;
  const update = (value: Partial<CapabilityImplementationDraft>) =>
    onChange(draft ? { ...draft, ...value } : draft);
  const compatible = compatibleRuntimeAdapters(
    draft?.source,
    resources,
    providerRoutes,
    adapters,
    definition,
  );
  const adapter = compatible.find(
    (item) => item.id === draft?.runtimeAdapterRevisionId,
  );
  const error = draft ? capabilityImplementationDraftError(draft) : undefined;
  const sourceValue = draft?.source
    ? `${draft.source.kind}:${draft.source.id}`
    : undefined;
  const capabilityInputs = definition
    ? propertyKeys(definition.inputSchema)
    : [];
  const capabilityOutputs = definition
    ? propertyKeys(definition.outputSchema)
    : [];
  const adapterOutputs = adapter
    ? propertyKeys(adapter.invocationOutputSchema)
    : [];
  const configurationProperties = adapter
    ? (record(adapter.configurationSchema.properties) ?? {})
    : {};
  const compatibleSourceCount = definition
    ? resources.filter(
        (resource) =>
          resource.status === "active" &&
          compatibleRuntimeAdapters(
            { kind: "model_resource", id: resource.revisionId },
            resources,
            providerRoutes,
            adapters,
            definition,
          ).length > 0,
      ).length +
      providerRoutes.filter(
        (route) =>
          route.availabilityReason === "ready" &&
          compatibleRuntimeAdapters(
            { kind: "model_service", id: route.routePolicyRevisionId },
            resources,
            providerRoutes,
            adapters,
            definition,
          ).length > 0,
      ).length +
      adapters.filter(
        (runtimeAdapter) =>
          runtimeAdapter.sourceKinds.includes("plugin") &&
          compatibleRuntimeAdapters(
            { kind: "plugin", id: runtimeAdapter.id },
            resources,
            providerRoutes,
            adapters,
            definition,
          ).length > 0,
      ).length
    : 0;

  const updateInputMapping = (
    targetKey: string,
    value: Partial<InputFieldMappingDraft>,
  ) =>
    update({
      inputMappings:
        draft?.inputMappings.map((mapping) =>
          mapping.targetKey === targetKey ? { ...mapping, ...value } : mapping,
        ) ?? [],
    });
  const selectSource = (value: string) => {
    if (!draft || !definition) return;
    const separator = value.indexOf(":");
    const kind = value.slice(0, separator);
    const id = value.slice(separator + 1);
    let source: CapabilityImplementationSource;
    if (kind === "model_resource") {
      source = { kind: "model_resource", id };
    } else if (kind === "model_service") {
      source = { kind: "model_service", id };
    } else {
      source = { kind: "plugin", id };
    }
    const resource = resources.find((item) => item.revisionId === id);
    const route = providerRoutes.find(
      (item) => item.routePolicyRevisionId === id,
    );
    const plugin = adapters.find((item) => item.id === id);
    const suggestedNameZh =
      resource?.displayName ??
      (route
        ? `${route.providerName} · ${route.providerModelId}`
        : undefined) ??
      (plugin ? resolveLocalizedTextV1(plugin.displayName, "zh-CN") : "");
    const suggestedNameEn =
      resource?.displayName ??
      (route
        ? `${route.providerName} · ${route.providerModelId}`
        : undefined) ??
      (plugin ? resolveLocalizedTextV1(plugin.displayName, "en-US") : "");
    const next = {
      ...draft,
      source,
      displayNameZh: suggestedNameZh,
      displayNameEn: suggestedNameEn,
      runtimeAdapterRevisionId: "",
      configuration: {},
      inputMappings: [],
      outputMappings: [],
    };
    const choices = compatibleRuntimeAdapters(
      source,
      resources,
      providerRoutes,
      adapters,
      definition,
    );
    onChange(
      choices.length === 1
        ? selectCapabilityImplementationAdapter(next, definition, choices[0]!)
        : next,
    );
  };
  const selectAdapter = (value: string) => {
    if (!draft || !definition) return;
    const selected = compatible.find((item) => item.id === value);
    if (selected) {
      onChange(
        selectCapabilityImplementationAdapter(draft, definition, selected),
      );
    }
  };
  const selectInputMapping = (
    mapping: InputFieldMappingDraft,
    value: unknown,
  ) => {
    const selected = String(value);
    if (selected === "constant") {
      updateInputMapping(mapping.targetKey, {
        mode: "constant",
        sourceKey: "",
      });
      return;
    }
    const [mode, sourceKey = ""] = selected.split(":", 2);
    updateInputMapping(mapping.targetKey, {
      mode: mode === "configuration" ? "configuration" : "input",
      sourceKey,
    });
  };

  function submitImplementation(): void {
    if (!draft) return;
    if (error) {
      setSubmittedRequestKey(draft.requestKey);
      return;
    }
    onPublish();
  }

  let dialogTitle = t("settings.capabilityDefinitions.implementation.addTitle");
  if (creating) {
    dialogTitle = t(
      "settings.capabilityDefinitions.implementation.createTitle",
    );
  } else if (draft?.replaceBinding) {
    dialogTitle = t(
      "settings.capabilityDefinitions.implementation.replaceTitle",
    );
  }

  return (
    <SettingsDialog
      onOpenChange={(open) => {
        if (!open && !publishing) onChange(undefined);
      }}
      open={Boolean(draft && definition)}
    >
      <SettingsDialogContent
        closeLabel={t("settings.capabilityDefinitions.close")}
        dismissible={!publishing}
        scrollable
        title={dialogTitle}
        width={720}
      >
        {draft && definition ? (
          <Form
            className="space-y-6"
            layout="vertical"
            onFinish={submitImplementation}
            validateTrigger={[]}
          >
            <section className="grid gap-4">
              <Form.Item
                {...(submitted && (error === "source" || error === "adapter")
                  ? {
                      help: t(
                        `settings.capabilityDefinitions.implementation.validation.${error}`,
                      ),
                      validateStatus: "error" as const,
                    }
                  : {})}
              >
                <SelectField
                  label={t(
                    "settings.capabilityDefinitions.implementation.source",
                  )}
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
                            definition,
                          ).length > 0,
                      )
                      .map((resource) => ({
                        label: t(
                          "settings.capabilityDefinitions.implementation.modelResourceOption",
                          {
                            name: resource.displayName,
                          },
                        ),
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
                            definition,
                          ).length > 0,
                      )
                      .map((route) => ({
                        label: t(
                          "settings.capabilityDefinitions.implementation.modelServiceOption",
                          {
                            provider: route.providerName,
                            model: route.providerModelId,
                          },
                        ),
                        value: `model_service:${route.routePolicyRevisionId}`,
                      })),
                    ...adapters
                      .filter(
                        (runtimeAdapter) =>
                          runtimeAdapter.sourceKinds.includes("plugin") &&
                          compatibleRuntimeAdapters(
                            { kind: "plugin", id: runtimeAdapter.id },
                            resources,
                            providerRoutes,
                            adapters,
                            definition,
                          ).length > 0,
                      )
                      .map((runtimeAdapter) => ({
                        label: t(
                          "settings.capabilityDefinitions.implementation.pluginOption",
                          {
                            name: resolveLocalizedTextV1(
                              runtimeAdapter.displayName,
                              i18n.resolvedLanguage ?? "en-US",
                            ),
                          },
                        ),
                        value: `plugin:${runtimeAdapter.id}`,
                      })),
                  ]}
                  placeholder={t(
                    "settings.capabilityDefinitions.implementation.sourcePlaceholder",
                  )}
                  value={sourceValue}
                />
              </Form.Item>
              {compatibleSourceCount === 0 ? (
                <InlineNotice
                  title={t(
                    "settings.capabilityDefinitions.implementation.noSourceTitle",
                  )}
                  tone="info"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {t(
                        "settings.capabilityDefinitions.implementation.noSourceDescription",
                      )}
                    </span>
                    <Button
                      onClick={onConfigureModels}
                      size="small"
                      type="link"
                    >
                      {t(
                        "settings.capabilityDefinitions.implementation.configureModels",
                      )}
                    </Button>
                  </div>
                </InlineNotice>
              ) : null}
              {compatible.length > 1 ? (
                <SelectField
                  label={t(
                    "settings.capabilityDefinitions.implementation.runtime",
                  )}
                  onChange={selectAdapter}
                  options={compatible.map((item) => ({
                    label: resolveLocalizedTextV1(
                      item.displayName,
                      i18n.resolvedLanguage ?? "en-US",
                    ),
                    value: item.id,
                  }))}
                  placeholder={t(
                    "settings.capabilityDefinitions.implementation.runtimePlaceholder",
                  )}
                  value={draft.runtimeAdapterRevisionId || undefined}
                />
              ) : null}
            </section>

            {adapter ? (
              <Form.Item
                {...(submitted &&
                error &&
                error !== "source" &&
                error !== "adapter"
                  ? {
                      help: t(
                        `settings.capabilityDefinitions.implementation.validation.${error}`,
                      ),
                      validateStatus: "error" as const,
                    }
                  : {})}
              >
                {!error || error === "name" || error === "description" ? (
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[14px] bg-positive-surface px-4 py-3">
                    <StatusTag tone="positive">
                      {t(
                        "settings.capabilityDefinitions.implementation.autoConfigured",
                      )}
                    </StatusTag>
                    <span className="text-sm text-positive-strong">
                      {t(
                        "settings.capabilityDefinitions.implementation.autoConfiguredDescription",
                      )}
                    </span>
                  </div>
                ) : null}
                <details
                  key={`${adapter.id}:${draft.source?.id ?? "source"}`}
                  className="group rounded-2xl bg-mist px-4 py-3"
                  open={
                    error === "configuration" ||
                    error === "inputMapping" ||
                    error === "outputMapping" ||
                    error === "priority" ||
                    undefined
                  }
                >
                  <summary className="cursor-pointer text-sm font-medium text-ink">
                    <span>
                      {t(
                        "settings.capabilityDefinitions.implementation.advanced",
                      )}
                    </span>
                    <span className="ml-2 font-normal text-muted">
                      {t(
                        "settings.capabilityDefinitions.implementation.advancedHint",
                      )}
                    </span>
                  </summary>
                  <div className="mt-4 space-y-4">
                    {adapter &&
                    Object.keys(configurationProperties).length > 0 ? (
                      <section className="space-y-3 rounded-2xl bg-surface p-4">
                        <div className="font-semibold text-ink">
                          {t(
                            "settings.capabilityDefinitions.implementation.configuration",
                          )}
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          {Object.entries(configurationProperties).map(
                            ([key, candidate]) => {
                              const schema = record(candidate) ?? {};
                              const value = draft.configuration[key];
                              return (
                                <Field
                                  key={key}
                                  label={key}
                                  onChange={(next) =>
                                    update({
                                      configuration: {
                                        ...draft.configuration,
                                        [key]: configurationValue(next, schema),
                                      },
                                    })
                                  }
                                  value={configurationText(value)}
                                />
                              );
                            },
                          )}
                        </div>
                      </section>
                    ) : null}

                    {adapter ? (
                      <>
                        <section className="space-y-3 rounded-2xl bg-surface p-4">
                          <div className="font-semibold text-ink">
                            {t(
                              "settings.capabilityDefinitions.implementation.inputMapping",
                            )}
                          </div>
                          {draft.inputMappings.map((mapping) => {
                            const mappingValue =
                              mapping.mode === "constant"
                                ? "constant"
                                : `${mapping.mode}:${mapping.sourceKey}`;
                            return (
                              <div
                                className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"
                                key={mapping.targetKey}
                              >
                                <div className="font-mono text-sm">
                                  {mapping.targetKey}
                                </div>
                                <div className="grid gap-2">
                                  <KanvasSelect
                                    onChange={(value) =>
                                      selectInputMapping(mapping, value)
                                    }
                                    options={[
                                      ...capabilityInputs.map((key) => ({
                                        label: t(
                                          "settings.capabilityDefinitions.implementation.capabilityInput",
                                          { name: key },
                                        ),
                                        value: `input:${key}`,
                                      })),
                                      ...Object.keys(
                                        configurationProperties,
                                      ).map((key) => ({
                                        label: t(
                                          "settings.capabilityDefinitions.implementation.configurationValue",
                                          { name: key },
                                        ),
                                        value: `configuration:${key}`,
                                      })),
                                      {
                                        label: t(
                                          "settings.capabilityDefinitions.implementation.constant",
                                        ),
                                        value: "constant",
                                      },
                                    ]}
                                    value={mappingValue}
                                  />
                                  {mapping.mode === "constant" ? (
                                    <KanvasInput
                                      onChange={(event) =>
                                        updateInputMapping(mapping.targetKey, {
                                          constantValue: event.target.value,
                                        })
                                      }
                                      placeholder={t(
                                        "settings.capabilityDefinitions.implementation.constantPlaceholder",
                                      )}
                                      value={mapping.constantValue}
                                    />
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </section>

                        <section className="space-y-3 rounded-2xl bg-surface p-4">
                          <div className="font-semibold text-ink">
                            {t(
                              "settings.capabilityDefinitions.implementation.outputMapping",
                            )}
                          </div>
                          {capabilityOutputs.map((targetKey) => {
                            const mapping = draft.outputMappings.find(
                              (item) => item.targetKey === targetKey,
                            );
                            return (
                              <div
                                className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"
                                key={targetKey}
                              >
                                <div className="font-mono text-sm">
                                  {targetKey}
                                </div>
                                <KanvasSelect
                                  onChange={(sourceKey) =>
                                    update({
                                      outputMappings: draft.outputMappings.map(
                                        (item) =>
                                          item.targetKey === targetKey
                                            ? {
                                                ...item,
                                                sourceKey: String(sourceKey),
                                              }
                                            : item,
                                      ),
                                    })
                                  }
                                  options={adapterOutputs.map((key) => ({
                                    label: key,
                                    value: key,
                                  }))}
                                  value={mapping?.sourceKey}
                                />
                              </div>
                            );
                          })}
                        </section>
                      </>
                    ) : null}

                    <section className="grid gap-4 rounded-2xl bg-surface p-4 md:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className="text-sm font-medium">
                          {t(
                            "settings.capabilityDefinitions.implementation.priority",
                          )}
                        </span>
                        <InputNumber
                          className="w-full"
                          min={1}
                          onChange={(priority) => {
                            if (typeof priority === "number")
                              update({ priority });
                          }}
                          value={draft.priority}
                        />
                      </label>
                      <div className="space-y-2">
                        <div className="text-sm font-medium">
                          {t(
                            "settings.capabilityDefinitions.implementation.fallback",
                          )}
                        </div>
                        <Checkbox.Group
                          onChange={(fallbackOn) =>
                            update({
                              fallbackOn: fallbackOn,
                            })
                          }
                          options={(
                            [
                              "not_applicable",
                              "unavailable",
                              "retry_exhausted",
                            ] as const
                          ).map((reason) => ({
                            label: t(
                              `settings.capabilityDefinitions.implementation.fallbackReasons.${reason}`,
                            ),
                            value: reason,
                          }))}
                          value={[...draft.fallbackOn]}
                        />
                      </div>
                    </section>
                  </div>
                </details>
              </Form.Item>
            ) : null}

            {adapter ? (
              <p className="m-0 text-sm leading-6 text-muted">
                {t("settings.capabilityDefinitions.implementation.publishHint")}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <Button disabled={publishing} onClick={() => onChange(undefined)}>
                {t("settings.capabilityDefinitions.cancel")}
              </Button>
              <Button
                disabled={!draft.source || !adapter}
                htmlType="submit"
                loading={publishing}
                type="primary"
              >
                {t(
                  creating
                    ? "settings.capabilityDefinitions.implementation.create"
                    : "settings.capabilityDefinitions.implementation.publish",
                )}
              </Button>
            </div>
          </Form>
        ) : null}
      </SettingsDialogContent>
    </SettingsDialog>
  );
}

function Field({
  label,
  onChange,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}): React.JSX.Element {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <KanvasInput
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function SelectField({
  disabled,
  label,
  onChange,
  options,
  placeholder,
  value,
}: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly placeholder: string;
  readonly value: string | undefined;
}): React.JSX.Element {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <KanvasSelect
        {...(disabled !== undefined ? { disabled } : {})}
        onChange={(next) => onChange(String(next))}
        options={[...options]}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}
