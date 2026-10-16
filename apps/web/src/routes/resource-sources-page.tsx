import type {
  CreateResourceSourceBody,
  ResourceSourceSummary,
  ResourceSourceType,
} from "@kanvas/contracts/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
  Button,
  Form,
  InputNumber,
  Skeleton,
  Switch,
  Tooltip,
  type TableColumnsType,
} from "antd";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  createWorkspaceResourceSource,
  disableWorkspaceResourceSource,
  fetchResourceSourceTypes,
  fetchWorkspaceResourceSources,
  publishWorkspaceResourceSource,
  validateWorkspaceResourceSource,
} from "../api/transport.js";
import { EmptyState } from "../components/feedback.js";
import {
  KanvasInput,
  KanvasPasswordInput,
} from "../components/kanvas-input.js";
import { KanvasSelect } from "../components/kanvas-select.js";
import { SettingsDirectoryTable } from "../components/settings-directory-table.js";
import {
  SettingsDialog,
  SettingsDialogContent,
} from "../components/settings-overlay.js";
import {
  SettingsPageHeader,
  SettingsShell,
} from "../components/settings-shell.js";
import { useSettingsNotification } from "../components/settings-notification.js";
import { WorkspacePage } from "../components/workspace-page.js";

const resourceSourcesRouteApi = getRouteApi(
  "/w/$workspaceId/settings/resource-sources",
);

type ConfigurationValue = boolean | number | string | string[];

interface SourceDraft {
  readonly sourceType: ResourceSourceType;
  readonly displayName: string;
  readonly endpointOrigin: string;
  readonly credentialMaterial: string;
  readonly configuration: Readonly<Record<string, ConfigurationValue>>;
  readonly replaces?: ResourceSourceSummary;
}

interface SourceTableRow {
  readonly key: string;
  readonly sourceType: ResourceSourceType;
  readonly source?: ResourceSourceSummary;
}

interface EnableSourceVariables {
  readonly sourceType: ResourceSourceType;
  readonly source?: ResourceSourceSummary;
  readonly draft?: SourceDraft;
}

interface ResourceSourceMutationContext {
  readonly csrfToken: string;
  readonly workspaceId: string;
}

function operationKey(action: string, id: string): string {
  return `resource-source:${action}:${id}:${crypto.randomUUID()}`;
}

export async function runResourceSourceEnableFlow(
  context: ResourceSourceMutationContext,
  variables: EnableSourceVariables,
): Promise<ResourceSourceSummary> {
  let current = variables.source;
  if (variables.draft || !current) {
    const value = variables.draft ?? sourceDraft(variables.sourceType);
    const authMode = value.sourceType.authModes[0]!;
    const body: CreateResourceSourceBody = {
      displayName: value.displayName.trim(),
      adapterKind: value.sourceType.adapterKind,
      adapterVersion: value.sourceType.adapterVersion,
      authMode,
      endpointOrigin: value.endpointOrigin.trim(),
      configuration: value.configuration,
      licensePolicy: {
        requireCommercialUse: true,
        allowAttribution: true,
        allowShareAlike: false,
        allowStandaloneRedistributionRestriction: true,
        allowUnknownModelRelease: true,
        allowUnknownPropertyRelease: true,
        allowedLicenseIds: [],
      },
      ...(authMode === "none"
        ? {}
        : { credentialMaterial: value.credentialMaterial }),
    };
    current = (
      await createWorkspaceResourceSource(
        context,
        body,
        operationKey("create", value.sourceType.adapterKind),
      )
    ).source;
  }
  if (
    current.lifecycleStatus !== "ready" &&
    current.lifecycleStatus !== "published"
  ) {
    current = (
      await validateWorkspaceResourceSource(
        context,
        current.id,
        { expectedVersion: current.version },
        operationKey("validate", current.id),
      )
    ).source;
  }
  if (current.lifecycleStatus !== "published") {
    current = (
      await publishWorkspaceResourceSource(
        context,
        current.id,
        {
          expectedVersion: current.version,
          capabilities: variables.sourceType.capabilities,
        },
        operationKey("publish", current.id),
      )
    ).source;
  }
  const replaced = variables.draft?.replaces;
  if (
    replaced &&
    replaced.id !== current.id &&
    replaced.lifecycleStatus !== "disabled"
  ) {
    await disableWorkspaceResourceSource(
      context,
      replaced.id,
      { expectedVersion: replaced.version },
      operationKey("replace", replaced.id),
    );
  }
  return current;
}

function initialConfigurationValue(
  inputKind: ResourceSourceType["configurationFields"][number]["inputKind"],
): ConfigurationValue {
  if (inputKind === "boolean") return true;
  if (inputKind === "integer") return 0;
  if (inputKind === "string_list") return [];
  return "";
}

function sourceDraft(
  sourceType: ResourceSourceType,
  source?: ResourceSourceSummary,
): SourceDraft {
  return {
    sourceType,
    displayName: source?.displayName ?? sourceType.displayName,
    endpointOrigin:
      source?.endpointOrigin ?? sourceType.defaultEndpointOrigin ?? "",
    credentialMaterial: "",
    configuration:
      source?.configuration ??
      Object.fromEntries(
        sourceType.configurationFields.map((field) => [
          field.key,
          initialConfigurationValue(field.inputKind),
        ]),
      ),
    ...(source ? { replaces: source } : {}),
  };
}

function localizedDescriptorLabel(
  labels: Readonly<Record<string, string>> | undefined,
  fallback: string,
  language: string,
): string {
  const normalized = language.toLowerCase();
  const base = normalized.split("-")[0] ?? normalized;
  return (
    Object.entries(labels ?? {}).find(
      ([key]) => key.toLowerCase() === normalized,
    )?.[1] ??
    Object.entries(labels ?? {}).find(
      ([key]) => key.toLowerCase().split("-")[0] === base,
    )?.[1] ??
    fallback
  );
}

function needsInitialConfiguration(sourceType: ResourceSourceType): boolean {
  return (
    sourceType.authModes[0] !== "none" || !sourceType.defaultEndpointOrigin
  );
}

export function resourceSourceRequiresConfiguration({
  source,
  sourceType,
}: SourceTableRow): boolean {
  return (
    needsInitialConfiguration(sourceType) &&
    (!source || !source.secretConfigured || source.lifecycleStatus === "failed")
  );
}

function selectedSource(
  existing: ResourceSourceSummary | undefined,
  candidate: ResourceSourceSummary,
): ResourceSourceSummary {
  if (!existing) return candidate;
  if (
    candidate.lifecycleStatus === "published" &&
    existing.lifecycleStatus !== "published"
  ) {
    return candidate;
  }
  return existing;
}

function SourceConfigureButton({
  busy,
  onConfigure,
  row,
}: {
  readonly busy: boolean;
  readonly onConfigure: (row: SourceTableRow) => void;
  readonly row: SourceTableRow;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Button
      disabled={busy}
      onClick={() => onConfigure(row)}
      size="small"
      type="text"
    >
      {t("settings.resourceSources.configure")}
    </Button>
  );
}

function SourceEnableSwitch({
  busy,
  onDisable,
  onEnable,
  pending,
  row,
}: {
  readonly busy: boolean;
  readonly onDisable: (row: SourceTableRow) => void;
  readonly onEnable: (row: SourceTableRow) => void;
  readonly pending: boolean;
  readonly row: SourceTableRow;
}): React.JSX.Element {
  const { t } = useTranslation();
  const requiresConfiguration = resourceSourceRequiresConfiguration(row);
  const changeEnabled = (checked: boolean) => {
    if (checked) onEnable(row);
    else onDisable(row);
  };
  const control = (
    <span className="inline-flex">
      <Switch
        aria-label={t("settings.resourceSources.toggle", {
          name: row.sourceType.displayName,
        })}
        checked={row.source?.lifecycleStatus === "published"}
        {...(requiresConfiguration
          ? {
              className: "outline outline-2 outline-offset-2 outline-amber-300",
            }
          : {})}
        disabled={busy && !pending}
        loading={pending}
        onChange={changeEnabled}
        size="small"
      />
    </span>
  );
  return requiresConfiguration ? (
    <Tooltip title={t("settings.resourceSources.completeConfiguration")}>
      {control}
    </Tooltip>
  ) : (
    control
  );
}

export function ResourceSourcesPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = resourceSourcesRouteApi.useParams();
  return (
    <WorkspacePage
      pageTitle={t("settings.resourceSources.title")}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <SettingsShell active="sources" workspace={workspace}>
          {workspace.permissions.includes("credential.manage") ? (
            <ResourceSourcesContent
              csrfToken={context.csrfToken}
              workspaceId={workspace.id}
            />
          ) : (
            <EmptyState title={t("settings.resourceSources.forbiddenTitle")}>
              {t("settings.resourceSources.forbiddenDescription")}
            </EmptyState>
          )}
        </SettingsShell>
      )}
    </WorkspacePage>
  );
}

function ResourceSourcesContent({
  csrfToken,
  workspaceId,
}: {
  readonly csrfToken: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const toast = useSettingsNotification();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<SourceDraft>();
  const sourceTypes = useQuery({
    queryKey: ["resource-source-types", workspaceId],
    queryFn: () => fetchResourceSourceTypes(workspaceId),
    retry: false,
  });
  const sources = useQuery({
    queryKey: ["workspace-resource-sources", workspaceId],
    queryFn: () => fetchWorkspaceResourceSources(workspaceId),
    retry: false,
  });
  const configuredByType = useMemo(() => {
    const result = new Map<string, ResourceSourceSummary>();
    for (const source of sources.data?.sources ?? []) {
      result.set(
        source.adapterKind,
        selectedSource(result.get(source.adapterKind), source),
      );
    }
    return result;
  }, [sources.data?.sources]);
  const rows = useMemo(
    () =>
      (sourceTypes.data?.sourceTypes ?? []).map((sourceType) => ({
        key: sourceType.adapterKind,
        sourceType,
        ...(configuredByType.get(sourceType.adapterKind)
          ? { source: configuredByType.get(sourceType.adapterKind)! }
          : {}),
      })),
    [configuredByType, sourceTypes.data?.sourceTypes],
  );
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["workspace-resource-sources", workspaceId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["resource-catalog-sources", workspaceId],
      }),
    ]);
  const context = { csrfToken, workspaceId };

  const enable = useMutation({
    mutationFn: (variables: EnableSourceVariables) =>
      runResourceSourceEnableFlow(context, variables),
    onSuccess: async () => {
      setDraft(undefined);
      await refresh();
      toast.notify({
        title: t("settings.resourceSources.toast.enabled"),
        tone: "positive",
      });
    },
    onError: async () => {
      await refresh();
      toast.notify({
        title: t("settings.resourceSources.toast.enableFailed"),
        tone: "danger",
      });
    },
  });

  const disable = useMutation({
    mutationFn: (source: ResourceSourceSummary) =>
      disableWorkspaceResourceSource(
        context,
        source.id,
        { expectedVersion: source.version },
        operationKey("disable", source.id),
      ),
    onSuccess: async () => {
      await refresh();
      toast.notify({
        title: t("settings.resourceSources.toast.disabled"),
        tone: "positive",
      });
    },
    onError: () => {
      toast.notify({
        title: t("settings.resourceSources.toast.error"),
        tone: "danger",
      });
    },
  });

  if (sourceTypes.isPending || sources.isPending) {
    return (
      <div className="w-full max-w-240">
        <SettingsPageHeader title={t("settings.resourceSources.title")} />
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }
  if (!sourceTypes.data || !sources.data) {
    return (
      <div className="w-full max-w-240">
        <SettingsPageHeader title={t("settings.resourceSources.title")} />
        <EmptyState
          action={() => {
            void Promise.all([sourceTypes.refetch(), sources.refetch()]);
          }}
          actionLabel={t("settings.resourceSources.reload")}
          title={t("settings.resourceSources.loadErrorTitle")}
        >
          {t("common.checkConnection")}
        </EmptyState>
      </div>
    );
  }

  const enableRow = (row: SourceTableRow) => {
    if (resourceSourceRequiresConfiguration(row)) {
      setDraft(sourceDraft(row.sourceType, row.source));
      return;
    }
    enable.mutate({
      sourceType: row.sourceType,
      ...(row.source ? { source: row.source } : {}),
    });
  };
  const disableRow = (row: SourceTableRow) => {
    if (row.source) disable.mutate(row.source);
  };
  const configureRow = (row: SourceTableRow) => {
    setDraft(sourceDraft(row.sourceType, row.source));
  };
  const pendingKey = enable.variables?.sourceType.adapterKind;
  const disablingId = disable.variables?.id;
  const busy = enable.isPending || disable.isPending;
  const coverage = (row: SourceTableRow) => {
    const selections = row.sourceType.configurationFields.flatMap((field) => {
      const value = row.source?.configuration[field.key];
      if (!Array.isArray(value) || value.length === 0) return [];
      return value.map((item) => {
        const suggestion = field.suggestions?.find(
          (candidate) => candidate.value === item,
        );
        return suggestion
          ? localizedDescriptorLabel(
              suggestion.labels,
              suggestion.label,
              language,
            )
          : item;
      });
    });
    const allContent = row.sourceType.resourceKinds
      .map((kind) => t(`settings.resourceSources.allKind.${kind}`))
      .join(" · ");
    const content =
      selections.length > 0
        ? t("settings.resourceSources.restrictedTo", {
            values: selections.join(" · "),
          })
        : allContent;
    return content;
  };
  const columns: TableColumnsType<SourceTableRow> = [
    {
      key: "source",
      title: t("settings.resourceSources.columns.source"),
      width: 340,
      render: (_, row) => (
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-mist p-2">
            <img
              alt=""
              className="size-full object-contain"
              src={row.sourceType.iconPath}
            />
          </span>
          <div className="min-w-0">
            <strong className="block truncate text-sm">
              {row.sourceType.displayName}
            </strong>
            <span className="block truncate text-xs text-muted">
              {localizedDescriptorLabel(
                row.sourceType.descriptions,
                row.sourceType.description,
                language,
              )}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "coverage",
      title: t("settings.resourceSources.columns.coverage"),
      width: 330,
      render: (_, row) => (
        <span className="line-clamp-2 text-sm text-ink">{coverage(row)}</span>
      ),
    },
    {
      align: "center",
      key: "configure",
      title: t("settings.resourceSources.columns.configure"),
      width: 120,
      render: (_, row) => (
        <SourceConfigureButton
          busy={busy}
          onConfigure={configureRow}
          row={row}
        />
      ),
    },
    {
      align: "center",
      key: "enabled",
      title: t("settings.resourceSources.columns.enabled"),
      width: 100,
      render: (_, row) => (
        <SourceEnableSwitch
          busy={busy}
          onDisable={disableRow}
          onEnable={enableRow}
          pending={
            (enable.isPending && pendingKey === row.key) ||
            (disable.isPending &&
              row.source !== undefined &&
              disablingId === row.source.id)
          }
          row={row}
        />
      ),
    },
  ];

  return (
    <div className="w-full max-w-240">
      <SettingsPageHeader title={t("settings.resourceSources.title")} />
      <SettingsDirectoryTable
        columns={columns}
        dataSource={rows}
        emptyText={t("settings.resourceSources.empty")}
      />
      <SettingsDialog
        onOpenChange={(open) => {
          if (!open && !enable.isPending) setDraft(undefined);
        }}
        open={Boolean(draft)}
      >
        {draft ? (
          <SettingsDialogContent
            closeLabel={t("settings.resourceSources.close")}
            dismissible={!enable.isPending}
            title={draft.sourceType.displayName}
          >
            <ResourceSourceForm
              draft={draft}
              onCancel={() => setDraft(undefined)}
              onChange={setDraft}
              onSubmit={() =>
                enable.mutate({ sourceType: draft.sourceType, draft })
              }
              pending={enable.isPending}
            />
          </SettingsDialogContent>
        ) : null}
      </SettingsDialog>
    </div>
  );
}

function ResourceSourceForm({
  draft,
  onCancel,
  onChange,
  onSubmit,
  pending,
}: {
  readonly draft: SourceDraft;
  readonly onCancel: () => void;
  readonly onChange: (draft: SourceDraft) => void;
  readonly onSubmit: () => void;
  readonly pending: boolean;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const authMode = draft.sourceType.authModes[0]!;
  const language = i18n.resolvedLanguage ?? i18n.language;
  const changeEndpoint = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...draft, endpointOrigin: event.target.value });
  };
  const changeCredential = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...draft, credentialMaterial: event.target.value });
  };
  const setConfiguration = (key: string, value: ConfigurationValue) => {
    onChange({
      ...draft,
      configuration: { ...draft.configuration, [key]: value },
    });
  };
  const endpointMissing =
    !draft.sourceType.defaultEndpointOrigin && !draft.endpointOrigin.trim();
  const credentialMissing =
    authMode !== "none" && !draft.credentialMaterial.trim();
  const configurationMissing = draft.sourceType.configurationFields.some(
    (field) =>
      resourceSourceConfigurationValueMissing(
        field,
        draft.configuration[field.key],
      ),
  );
  return (
    <Form layout="vertical" onFinish={onSubmit} requiredMark={false}>
      {!draft.sourceType.defaultEndpointOrigin ? (
        <Form.Item
          label={
            <span className="text-sm font-medium text-ink">
              {t("settings.resourceSources.endpoint")}
            </span>
          }
          {...(endpointMissing
            ? {
                help: t("settings.resourceSources.requiredField"),
                validateStatus: "error" as const,
              }
            : {})}
          required
        >
          <KanvasInput
            disabled={pending}
            maxLength={2048}
            onChange={changeEndpoint}
            size="large"
            value={draft.endpointOrigin}
          />
        </Form.Item>
      ) : null}
      {authMode === "none" ? null : (
        <Form.Item
          label={
            <span className="text-sm font-medium text-ink">
              {draft.sourceType.credentialLabel
                ? localizedDescriptorLabel(
                    draft.sourceType.credentialLabels,
                    draft.sourceType.credentialLabel,
                    language,
                  )
                : t("settings.resourceSources.credential")}
            </span>
          }
          {...(credentialMissing
            ? {
                help: t("settings.resourceSources.requiredField"),
                validateStatus: "error" as const,
              }
            : {})}
          required
        >
          <KanvasPasswordInput
            autoComplete="new-password"
            disabled={pending}
            maxLength={65_536}
            onChange={changeCredential}
            size="large"
            value={draft.credentialMaterial}
          />
        </Form.Item>
      )}
      {draft.sourceType.configurationFields.map((field) => (
        <ResourceSourceConfigurationField
          disabled={pending}
          field={field}
          key={field.key}
          language={language}
          onChange={setConfiguration}
          value={draft.configuration[field.key]}
        />
      ))}
      <div className="flex justify-end gap-2">
        <Button disabled={pending} onClick={onCancel}>
          {t("settings.resourceSources.cancel")}
        </Button>
        <Button
          disabled={
            endpointMissing || credentialMissing || configurationMissing
          }
          htmlType="submit"
          loading={pending}
          type="primary"
        >
          {t("settings.resourceSources.checkAndEnable")}
        </Button>
      </div>
    </Form>
  );
}

export function resourceSourceConfigurationValueMissing(
  field: ResourceSourceType["configurationFields"][number],
  value: ConfigurationValue | undefined,
): boolean {
  if (!field.required) return false;
  if (field.inputKind === "boolean") return value !== true;
  if (field.inputKind === "integer") return Number(value) <= 0;
  if (field.inputKind === "string_list") {
    return !Array.isArray(value) || value.length === 0;
  }
  return !String(value ?? "").trim();
}

function ResourceSourceConfigurationInput({
  disabled,
  field,
  language,
  onChange,
  value,
}: {
  readonly disabled: boolean;
  readonly field: ResourceSourceType["configurationFields"][number];
  readonly language: string;
  readonly onChange: (value: ConfigurationValue) => void;
  readonly value: ConfigurationValue | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const changeBoolean = (checked: boolean) => onChange(checked);
  const changeInteger = (next: number | null) => onChange(Number(next ?? 0));
  const changeList = (next: string[]) => onChange(next);
  const changeText = (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange(event.target.value);
  if (field.inputKind === "boolean") {
    return (
      <Switch
        checked={Boolean(value)}
        disabled={disabled}
        onChange={changeBoolean}
      />
    );
  }
  if (field.inputKind === "integer") {
    return (
      <InputNumber
        className="w-full"
        disabled={disabled}
        onChange={changeInteger}
        size="large"
        value={Number(value ?? 0)}
      />
    );
  }
  if (field.inputKind === "string_list") {
    return (
      <KanvasSelect
        allowClear
        disabled={disabled}
        mode="tags"
        onChange={changeList}
        options={(field.suggestions ?? []).map((suggestion) => ({
          label: localizedDescriptorLabel(
            suggestion.labels,
            suggestion.label,
            language,
          ),
          value: suggestion.value,
        }))}
        placeholder={t("settings.resourceSources.allAvailable")}
        size="large"
        tokenSeparators={[",", "，"]}
        value={Array.isArray(value) ? value : []}
      />
    );
  }
  return (
    <KanvasInput
      disabled={disabled}
      onChange={changeText}
      size="large"
      value={String(value ?? "")}
    />
  );
}

function ResourceSourceConfigurationField({
  disabled,
  field,
  language,
  onChange,
  value,
}: {
  readonly disabled: boolean;
  readonly field: ResourceSourceType["configurationFields"][number];
  readonly language: string;
  readonly onChange: (key: string, value: ConfigurationValue) => void;
  readonly value: ConfigurationValue | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const label = localizedDescriptorLabel(field.labels, field.label, language);
  const help = field.help
    ? localizedDescriptorLabel(field.helps, field.help, language)
    : undefined;
  const changeValue = (next: ConfigurationValue) => onChange(field.key, next);
  const missing = resourceSourceConfigurationValueMissing(field, value);
  let fieldExtra: ReactNode;
  if (missing) {
    fieldExtra = (
      <span className="text-xs leading-5 text-red-600">
        {t("settings.resourceSources.requiredField")}
      </span>
    );
  } else if (help) {
    fieldExtra = <span className="text-xs leading-5 text-muted">{help}</span>;
  }
  const input = (
    <ResourceSourceConfigurationInput
      disabled={disabled}
      field={field}
      language={language}
      onChange={changeValue}
      value={value}
    />
  );
  if (field.inputKind === "boolean") {
    return (
      <Form.Item className="mb-5" required={field.required}>
        <div
          className={`flex min-h-14 items-center justify-between gap-5 rounded-xl bg-mist px-4 py-3 ${missing ? "outline outline-1 outline-red-500" : ""}`}
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">{label}</div>
            {help ? (
              <div className="mt-1 text-xs leading-5 text-muted">{help}</div>
            ) : null}
            {missing ? (
              <div className="mt-1 text-xs leading-5 text-red-600">
                {t("settings.resourceSources.requiredField")}
              </div>
            ) : null}
          </div>
          {input}
        </div>
      </Form.Item>
    );
  }
  return (
    <Form.Item
      extra={fieldExtra}
      label={<span className="text-sm font-medium text-ink">{label}</span>}
      required={field.required}
      {...(missing ? { validateStatus: "error" as const } : {})}
    >
      {input}
    </Form.Item>
  );
}
