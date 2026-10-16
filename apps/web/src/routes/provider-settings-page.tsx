import {
  CheckOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
  PlusOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import type {
  ProviderModelDiscoveryResult,
  ProviderSettingPreset,
  ProviderSettingSummary,
  WorkspaceBudgetSummary,
} from "@kanvas/contracts/api";
import {
  getProviderDefinition,
  providerDefinitions,
} from "@kanvas/contracts/provider-definition";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  Button,
  Checkbox,
  Drawer,
  Dropdown,
  Form,
  Modal,
  Table,
  Tag,
  type TableColumnsType,
} from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  createWorkspaceModel,
  createWorkspaceProviderSetting,
  deleteWorkspaceProviderSetting,
  discoverWorkspaceProviderModels,
  fetchWorkspaceModels,
  fetchWorkspaceProviderSettings,
  fetchWorkspaceUsageSummary,
  importWorkspaceProviderModels,
  mapWorkspaceProviderModel,
  refreshWorkspaceProviderModelCatalog,
} from "../api/transport.js";
import { workspaceQueryKeys } from "../api/query-keys.js";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
} from "../components/feedback.js";
import {
  KanvasInput,
  KanvasPasswordInput,
  KanvasSearchInput,
} from "../components/kanvas-input.js";
import { KanvasSelect } from "../components/kanvas-select.js";
import {
  SettingsPageHeader,
  SettingsShell,
} from "../components/settings-shell.js";
import { useSettingsNotification } from "../components/settings-notification.js";
import { StatusTag } from "../components/status-tag.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { ModelServiceTabs } from "../features/provider-settings/model-service-tabs.js";
import { ProviderLogo } from "../features/provider-settings/provider-logo.js";
import { BudgetLimitDialog } from "../features/usage/budget-limit-dialog.js";
import { formatBudgetAmount } from "../features/usage/usage-summary-model.js";
import {
  createProviderOperationKey,
  providerSettingsError,
} from "../features/provider-settings/provider-settings-runtime.js";
import { providerModelIdentifierError } from "../features/provider-settings/provider-settings-form.js";
import {
  formatProviderCheckDate,
  providerLifecyclePresentation,
  providerValidationTone,
} from "../features/provider-settings/provider-settings-presentation.js";

import {
  ProviderModelsDrawer,
  RenameProviderDialog,
} from "../features/provider-settings/provider-management-dialogs.js";

const routeApi = getRouteApi("/w/$workspaceId/settings/providers");

type DiscoveredModel = ProviderModelDiscoveryResult["models"][number];

interface EditableProviderModel {
  readonly upstreamModelId: string;
  readonly displayName: string;
  readonly suggestedCanonicalSlug: string;
  readonly suggestionSource: "models_dev" | "provider";
}

interface ProviderEditorState {
  readonly requestKey: string;
  readonly preset: ProviderSettingPreset;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly hardLimitAmount: string;
  readonly apiKey: string;
  readonly models: readonly EditableProviderModel[];
  readonly selected: readonly string[];
  readonly mappings: Readonly<Record<string, string>>;
  readonly search: string;
}

function emptyEditor(): ProviderEditorState {
  const definition = providerDefinitions[0];
  return {
    requestKey: createProviderOperationKey(),
    preset: definition.slug,
    displayName: definition.displayName,
    baseUrl: definition.defaultBaseUrl ?? "",
    hardLimitAmount: "20.00",
    apiKey: "",
    models: [],
    selected: [],
    mappings: {},
    search: "",
  };
}

function discoveredModel(model: DiscoveredModel): EditableProviderModel {
  return {
    upstreamModelId: model.providerModelId,
    displayName: model.displayName,
    suggestedCanonicalSlug:
      model.suggestedCanonicalSlug ?? model.providerModelId.toLocaleLowerCase(),
    suggestionSource: model.suggestionSource ?? "provider",
  };
}

class ProviderEditorError extends Error {}

function providerPageError(error: unknown): string {
  return error instanceof ProviderEditorError
    ? error.message
    : providerSettingsError(error);
}

export function ProviderSettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = routeApi.useParams();
  return (
    <WorkspacePage
      pageTitle={t("settings.providers.title")}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <SettingsShell active="providers" workspace={workspace}>
          {workspace.permissions.includes("credential.manage") ? (
            <ProviderSettingsContent
              csrfToken={context.csrfToken}
              workspaceId={workspace.id}
            />
          ) : (
            <EmptyState title={t("settings.providers.forbiddenTitle")}>
              {t("settings.providers.forbiddenDescription")}
            </EmptyState>
          )}
        </SettingsShell>
      )}
    </WorkspacePage>
  );
}

function ProviderSettingsContent({
  csrfToken,
  workspaceId,
}: {
  readonly csrfToken: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const toast = useSettingsNotification();
  const [modal, modalContextHolder] = Modal.useModal();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const context = { csrfToken, workspaceId };
  const providersKey = workspaceQueryKeys.providerSettings(workspaceId);
  const modelsKey = workspaceQueryKeys.models(workspaceId);
  const usageKey = workspaceQueryKeys.usageSummary(workspaceId);
  const providers = useQuery({
    queryKey: providersKey,
    queryFn: () => fetchWorkspaceProviderSettings(workspaceId),
    retry: false,
  });
  const usage = useQuery({
    queryKey: usageKey,
    queryFn: () => fetchWorkspaceUsageSummary(workspaceId),
    retry: false,
  });
  const budgetsByProviderId = new Map<string, WorkspaceBudgetSummary>(
    (usage.data?.budgets ?? []).flatMap((budget) =>
      budget.providerSettingId ? [[budget.providerSettingId, budget]] : [],
    ),
  );
  const [managedProvider, setManagedProvider] =
    useState<ProviderSettingSummary>();
  const [renamedProvider, setRenamedProvider] =
    useState<ProviderSettingSummary>();
  const [editor, setEditor] = useState<ProviderEditorState>();
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const closeEditor = () => setEditor(undefined);
  const closeManagedProvider = () => setManagedProvider(undefined);
  const closeRenamedProvider = () => setRenamedProvider(undefined);
  const updateEditor = (next: Partial<ProviderEditorState>) =>
    setEditor((current) => (current ? { ...current, ...next } : current));

  const discover = useMutation({
    mutationFn: async () => {
      if (!editor) {
        throw new ProviderEditorError(
          t("settings.providers.directory.errors.editorClosed"),
        );
      }
      return discoverWorkspaceProviderModels(context, {
        preset: editor.preset,
        baseUrl: editor.baseUrl.trim(),
        apiKey: editor.apiKey,
      });
    },
    onSuccess: (result) => {
      const nextModels = result.models.map(discoveredModel);
      setEditor((current) => {
        if (!current) return current;
        const selected = current.selected.filter((id) =>
          nextModels.some((model) => model.upstreamModelId === id),
        );
        return {
          ...current,
          models: nextModels,
          selected,
          mappings: Object.fromEntries(
            nextModels.map((model) => [
              model.upstreamModelId,
              current.mappings[model.upstreamModelId] ??
                model.suggestedCanonicalSlug,
            ]),
          ),
        };
      });
    },
    onError: (error) =>
      toast.notify({
        title: t("settings.providers.create.discoveryErrorTitle"),
        description: providerPageError(error),
        tone: "danger",
      }),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!editor) {
        throw new ProviderEditorError(
          t("settings.providers.directory.errors.editorClosed"),
        );
      }
      if (!editor.displayName.trim()) {
        throw new ProviderEditorError(
          t("settings.providers.validation.requiredName"),
        );
      }
      if (!editor.apiKey) {
        throw new ProviderEditorError(
          t("settings.providers.validation.requiredApiKey"),
        );
      }
      const hardLimitAmount = Number(editor.hardLimitAmount);
      if (!Number.isFinite(hardLimitAmount) || hardLimitAmount <= 0) {
        throw new ProviderEditorError(
          t("settings.providers.directory.errors.invalidBudget"),
        );
      }
      if (editor.selected.length === 0) {
        throw new ProviderEditorError(
          t("settings.providers.validation.requiredModel"),
        );
      }
      const selectedModels = editor.selected.map((upstreamModelId) => {
        const model = editor.models.find(
          (candidate) => candidate.upstreamModelId === upstreamModelId,
        );
        if (!model) {
          throw new ProviderEditorError(
            t("settings.providers.directory.errors.modelMissing", {
              model: upstreamModelId,
            }),
          );
        }
        const identifier = editor.mappings[upstreamModelId] ?? "";
        const identifierError = providerModelIdentifierError(identifier);
        if (identifierError) {
          throw new ProviderEditorError(
            t("settings.providers.directory.errors.invalidIdentifier", {
              model: model.displayName,
            }),
          );
        }
        const canonicalSlug = identifier.trim();
        return { ...model, canonicalSlug };
      });
      const created = await createWorkspaceProviderSetting(
        context,
        {
          displayName: editor.displayName.trim(),
          preset: editor.preset,
          baseUrl: editor.baseUrl.trim(),
          hardLimitAmount: editor.hardLimitAmount.trim(),
          apiKey: editor.apiKey,
        },
        editor.requestKey,
      );
      const imported = await importWorkspaceProviderModels(
        context,
        created.provider.id,
        {
          upstreamModelIds: selectedModels.map(
            (model) => model.upstreamModelId,
          ),
        },
      );
      const currentModels = await fetchWorkspaceModels(workspaceId);
      const canonicalBySlug = new Map(
        currentModels.models.map((model) => [model.slug, model]),
      );
      for (const selectedModel of selectedModels) {
        let canonical = canonicalBySlug.get(selectedModel.canonicalSlug);
        if (!canonical) {
          const createdModel = await createWorkspaceModel(context, {
            slug: selectedModel.canonicalSlug,
            sourceKind: selectedModel.suggestionSource,
            sourceReference:
              selectedModel.suggestionSource === "models_dev"
                ? selectedModel.suggestedCanonicalSlug
                : selectedModel.upstreamModelId,
          });
          canonical = createdModel.model;
          canonicalBySlug.set(canonical.slug, canonical);
        }
        const providerModel = imported.models.find(
          (model) => model.upstreamModelId === selectedModel.upstreamModelId,
        );
        if (!providerModel) {
          throw new ProviderEditorError(
            t("settings.providers.directory.errors.importIncomplete"),
          );
        }
        const suggested =
          selectedModel.canonicalSlug === selectedModel.suggestedCanonicalSlug;
        await mapWorkspaceProviderModel(
          context,
          created.provider.id,
          providerModel.id,
          {
            expectedVersion: providerModel.version,
            canonicalModelId: canonical.id,
            mappingSource: suggested
              ? selectedModel.suggestionSource
              : "manual",
            mappingConfidence: suggested ? "suggested" : "manual",
          },
        );
      }
    },
    onSuccess: async () => {
      closeEditor();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: providersKey }),
        queryClient.invalidateQueries({ queryKey: modelsKey }),
        queryClient.invalidateQueries({ queryKey: usageKey }),
      ]);
      toast.notify({
        title: t("settings.providers.directory.toast.createdTitle"),
        description: t("settings.providers.directory.toast.createdDescription"),
        tone: "positive",
      });
      void navigate({
        params: { workspaceId },
        to: "/w/$workspaceId/settings/models",
      });
    },
    onError: (error) =>
      toast.notify({
        title: t("settings.providers.create.errorTitle"),
        description: providerPageError(error),
        tone: "danger",
      }),
  });

  const testProvider = useMutation({
    mutationFn: (provider: ProviderSettingSummary) =>
      refreshWorkspaceProviderModelCatalog(
        context,
        provider.id,
        { expectedVersion: provider.version },
        createProviderOperationKey(),
      ),
    onSuccess: () => {
      toast.notify({
        title: t("settings.providers.toast.checkedTitle"),
        description: t("settings.providers.toast.checkedDescription"),
        tone: "positive",
      });
      void queryClient.invalidateQueries({ queryKey: providersKey });
    },
    onError: (error) =>
      toast.notify({
        title: t("settings.providers.toast.checkErrorTitle"),
        description: providerPageError(error),
        tone: "danger",
      }),
  });

  const removeProvider = useMutation({
    mutationFn: (provider: ProviderSettingSummary) =>
      deleteWorkspaceProviderSetting(
        context,
        provider.id,
        { expectedVersion: provider.version },
        createProviderOperationKey(),
      ),
    onSuccess: () => {
      toast.notify({
        title: t("settings.providers.directory.toast.removedTitle"),
        tone: "positive",
      });
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: providersKey }),
        queryClient.invalidateQueries({ queryKey: modelsKey }),
        queryClient.invalidateQueries({ queryKey: usageKey }),
      ]);
    },
    onError: (error) =>
      toast.notify({
        title: t("settings.providers.directory.toast.removeErrorTitle"),
        description: providerPageError(error),
        tone: "danger",
      }),
  });

  const confirmRemoveProvider = (provider: ProviderSettingSummary) => {
    modal.confirm({
      cancelText: t("settings.providers.directory.remove.cancel"),
      content: t("settings.providers.directory.remove.description"),
      okButtonProps: { danger: true },
      okText: t("settings.providers.directory.remove.submit"),
      onOk: () => removeProvider.mutateAsync(provider),
      title: t("settings.providers.directory.remove.title", {
        name: provider.displayName,
      }),
    });
  };

  const openCreate = () => setEditor(emptyEditor());

  const filteredProviders = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (providers.data?.providers ?? []).filter(
      (provider) =>
        (providerFilter === "all" || provider.preset === providerFilter) &&
        (!needle ||
          provider.displayName.toLocaleLowerCase().includes(needle) ||
          provider.modelKeys.some((model) =>
            model.toLocaleLowerCase().includes(needle),
          )),
    );
  }, [providerFilter, providers.data?.providers, search]);

  const visibleModelLimit = 4;
  const productLocale = i18n.resolvedLanguage ?? i18n.language;
  const columns: TableColumnsType<ProviderSettingSummary> = [
    {
      title: t("settings.providers.columns.service"),
      width: 240,
      render: (_, provider) => (
        <div className="flex items-center gap-3">
          <ProviderLogo preset={provider.preset} />
          <div className="min-w-0">
            <strong className="block truncate text-sm">
              {provider.displayName}
            </strong>
            <span className="block truncate text-xs text-muted">
              {provider.baseUrl}
            </span>
          </div>
        </div>
      ),
    },
    {
      title: t("settings.providers.columns.provider"),
      width: 140,
      render: (_, provider) =>
        getProviderDefinition(provider.preset).displayName,
    },
    {
      title: t("settings.providers.columns.models"),
      render: (_, provider) => (
        <div className="flex max-w-[420px] flex-wrap gap-1">
          {provider.modelKeys.slice(0, visibleModelLimit).map((model) => (
            <Tag key={model}>{model}</Tag>
          ))}
          {provider.modelKeys.length > visibleModelLimit ? (
            <Tag>+{provider.modelKeys.length - visibleModelLimit}</Tag>
          ) : null}
        </div>
      ),
    },
    {
      title: t("settings.providers.directory.columns.budgetUsage"),
      width: 250,
      render: (_, provider) => {
        const budget = budgetsByProviderId.get(provider.id);
        if (!budget) {
          return (
            <span className="text-xs text-muted">
              {t("settings.providers.directory.budget.missing")}
            </span>
          );
        }
        return (
          <div>
            <div className="text-sm tabular-nums">
              <strong>
                {formatBudgetAmount(
                  budget.remainingAmount,
                  budget.currencyCode,
                )}
              </strong>{" "}
              <span className="text-muted">
                /{" "}
                {formatBudgetAmount(
                  budget.hardLimitAmount,
                  budget.currencyCode,
                )}
              </span>
            </div>
            <span className="mt-1 block text-xs text-muted">
              {t("settings.providers.directory.budget.consumed", {
                amount: formatBudgetAmount(
                  budget.consumedAmount,
                  budget.currencyCode,
                ),
              })}
              {Number(budget.unknownHeldAmount) > 0
                ? ` · ${t("settings.providers.directory.budget.held", {
                    amount: formatBudgetAmount(
                      budget.unknownHeldAmount,
                      budget.currencyCode,
                    ),
                  })}`
                : ""}
            </span>
          </div>
        );
      },
    },
    {
      title: t("settings.providers.columns.status"),
      width: 120,
      render: (_, provider) => {
        const status = providerLifecyclePresentation(provider);
        return (
          <StatusTag tone={status.tone}>
            {t(`settings.providers.directory.lifecycle.${status.key}`)}
          </StatusTag>
        );
      },
    },
    {
      title: t("settings.providers.columns.validation"),
      width: 190,
      render: (_, provider) => {
        const checkedAt = provider.validatedAt
          ? formatProviderCheckDate(provider.validatedAt, productLocale)
          : undefined;
        return (
          <div className="grid justify-items-start gap-1">
            <StatusTag tone={providerValidationTone(provider.validation)}>
              {t(`settings.providers.validationLabels.${provider.validation}`)}
            </StatusTag>
            <span className="text-xs text-muted">
              {checkedAt ?? t("settings.providers.notChecked")}
            </span>
          </div>
        );
      },
    },
    {
      title: t("settings.providers.columns.actions"),
      width: 320,
      align: "right",
      fixed: "right",
      render: (_, provider) => {
        const budget = budgetsByProviderId.get(provider.id);
        const manageModels = () => setManagedProvider(provider);
        const manageConnection = ({ key }: { readonly key: string }) => {
          if (key === "rename") setRenamedProvider(provider);
          else if (key === "delete") confirmRemoveProvider(provider);
        };
        return (
          <div className="flex justify-end gap-1">
            <Button size="small" onClick={manageModels}>
              {t("settings.providers.management.models")}
            </Button>
            {budget ? (
              <BudgetLimitDialog
                budget={budget}
                csrfToken={csrfToken}
                workspaceId={workspaceId}
              />
            ) : null}
            <Button
              icon={<CheckOutlined />}
              loading={
                testProvider.isPending &&
                testProvider.variables?.id === provider.id
              }
              onClick={() => testProvider.mutate(provider)}
              size="small"
            >
              {t("settings.providers.recheck")}
            </Button>
            <Dropdown
              menu={{
                items: [
                  {
                    key: "rename",
                    icon: <EditOutlined />,
                    label: t("settings.providers.management.rename"),
                  },
                  {
                    danger: true,
                    icon: <DeleteOutlined />,
                    key: "delete",
                    label: t("settings.providers.directory.remove.action"),
                  },
                ],
                onClick: manageConnection,
              }}
            >
              <Button
                aria-label={t("settings.providers.manage", {
                  name: provider.displayName,
                })}
                icon={<MoreOutlined />}
                loading={
                  removeProvider.isPending &&
                  removeProvider.variables?.id === provider.id
                }
                size="small"
              />
            </Dropdown>
          </div>
        );
      },
    },
  ];

  if (providers.isPending || usage.isPending) {
    return <LoadingState label={t("settings.providers.loading")} />;
  }
  if (providers.isError || usage.isError || !providers.data || !usage.data) {
    return (
      <EmptyState
        action={() => {
          void Promise.all([providers.refetch(), usage.refetch()]);
        }}
        actionLabel={t("settings.providers.reload")}
        title={t("settings.providers.loadErrorTitle")}
      >
        {providerPageError(providers.error ?? usage.error)}
      </EmptyState>
    );
  }

  const visibleModels = (editor?.models ?? []).filter((model) => {
    const needle = editor?.search.trim().toLocaleLowerCase() ?? "";
    return (
      !needle ||
      model.upstreamModelId.toLocaleLowerCase().includes(needle) ||
      model.displayName.toLocaleLowerCase().includes(needle) ||
      editor?.mappings[model.upstreamModelId]
        ?.toLocaleLowerCase()
        .includes(needle)
    );
  });

  return (
    <div className="w-full">
      {modalContextHolder}
      <SettingsPageHeader
        action={
          <Button icon={<PlusOutlined />} onClick={openCreate} type="primary">
            {t("settings.providers.connect")}
          </Button>
        }
        title={t("settings.providers.title")}
      />
      <ModelServiceTabs active="providers" workspaceId={workspaceId} />

      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-line pb-4">
        <KanvasSelect
          aria-label={t("settings.providers.directory.filterLabel")}
          className="w-56 shrink-0"
          onChange={(value) => setProviderFilter(String(value))}
          options={[
            {
              label: t("settings.providers.directory.allServices"),
              value: "all",
            },
            ...providerDefinitions.map((definition) => ({
              value: definition.slug,
              label: (
                <span className="inline-flex items-center gap-2">
                  <ProviderLogo preset={definition.slug} />
                  {definition.displayName}
                </span>
              ),
            })),
          ]}
          value={providerFilter}
        />
        <KanvasSearchInput
          aria-label={t("settings.providers.directory.searchPlaceholder")}
          className="max-w-96 flex-1"
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("settings.providers.directory.searchPlaceholder")}
          value={search}
        />
      </div>

      {providers.data.providers.length === 0 ? (
        <EmptyState
          action={openCreate}
          actionLabel={t("settings.providers.connect")}
          title={t("settings.providers.emptyTitle")}
        >
          {t("settings.providers.emptyDescription")}
        </EmptyState>
      ) : (
        <Table
          columns={columns}
          dataSource={filteredProviders}
          locale={{
            emptyText: t("settings.providers.directory.noMatches"),
          }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          rowKey="id"
          scroll={{ x: 1430 }}
          size="middle"
        />
      )}

      {managedProvider ? (
        <ProviderModelsDrawer
          key={managedProvider.id}
          context={context}
          provider={managedProvider}
          onClose={closeManagedProvider}
        />
      ) : null}
      {renamedProvider ? (
        <RenameProviderDialog
          key={renamedProvider.id}
          context={context}
          provider={renamedProvider}
          onClose={closeRenamedProvider}
        />
      ) : null}
      <Drawer
        closable={{ disabled: save.isPending }}
        destroyOnHidden
        footer={
          editor ? (
            <div className="flex justify-end gap-3">
              <Button
                disabled={save.isPending}
                onClick={closeEditor}
                size="large"
              >
                {t("settings.providers.create.cancel")}
              </Button>
              <Button
                loading={save.isPending}
                onClick={() => save.mutate()}
                size="large"
                type="primary"
              >
                {t("settings.providers.directory.create.saveAndContinue")}
              </Button>
            </div>
          ) : undefined
        }
        mask={{ closable: !save.isPending }}
        onClose={() => {
          if (!save.isPending) closeEditor();
        }}
        open={Boolean(editor)}
        size="min(760px, 100vw)"
        title={t("settings.providers.connect")}
      >
        {editor ? (
          <div className="grid gap-6">
            <section>
              <h3 className="mb-1 text-base font-semibold">
                {t("settings.providers.directory.create.basicsTitle")}
              </h3>
              <p className="mb-5 text-sm text-muted">
                {t("settings.providers.directory.create.basicsDescription")}
              </p>
              <Form layout="vertical">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Form.Item
                    label={t("settings.providers.create.service")}
                    required
                  >
                    <KanvasSelect
                      aria-label={t("settings.providers.create.service")}
                      onChange={(value) => {
                        const preset = value as ProviderSettingPreset;
                        const definition = getProviderDefinition(preset);
                        updateEditor({
                          preset,
                          displayName: definition.displayName,
                          baseUrl: definition.defaultBaseUrl ?? "",
                          models: [],
                          selected: [],
                          mappings: {},
                        });
                      }}
                      options={providerDefinitions.map((definition) => ({
                        value: definition.slug,
                        label: (
                          <span className="inline-flex items-center gap-2">
                            <ProviderLogo preset={definition.slug} />
                            {definition.displayName}
                          </span>
                        ),
                      }))}
                      size="large"
                      value={editor.preset}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t("settings.providers.create.name")}
                    required
                  >
                    <KanvasInput
                      aria-label={t("settings.providers.create.name")}
                      onChange={(event) =>
                        updateEditor({ displayName: event.target.value })
                      }
                      size="large"
                      value={editor.displayName}
                    />
                  </Form.Item>
                </div>
                <Form.Item
                  label={t("settings.providers.create.baseUrl")}
                  required
                >
                  <KanvasInput
                    aria-label={t("settings.providers.create.baseUrl")}
                    onChange={(event) =>
                      updateEditor({ baseUrl: event.target.value })
                    }
                    size="large"
                    value={editor.baseUrl}
                  />
                </Form.Item>
                <Form.Item
                  extra={t(
                    `settings.providers.directory.storage.${providers.data.credentialStorage.mode}`,
                  )}
                  label={t("settings.providers.create.apiKey")}
                  required
                >
                  <KanvasPasswordInput
                    aria-label={t("settings.providers.create.apiKey")}
                    autoComplete="new-password"
                    onChange={(event) =>
                      updateEditor({ apiKey: event.target.value })
                    }
                    placeholder={t(
                      "settings.providers.create.apiKeyPlaceholder",
                    )}
                    size="large"
                    value={editor.apiKey}
                  />
                </Form.Item>
                <Form.Item
                  extra={t(
                    "settings.providers.directory.create.budgetDescription",
                  )}
                  label={t("settings.providers.directory.create.budgetLabel")}
                  required
                >
                  <KanvasInput
                    aria-label={t(
                      "settings.providers.directory.create.budgetLabel",
                    )}
                    inputMode="decimal"
                    onChange={(event) =>
                      updateEditor({ hardLimitAmount: event.target.value })
                    }
                    placeholder={t(
                      "settings.providers.directory.create.budgetPlaceholder",
                    )}
                    size="large"
                    value={editor.hardLimitAmount}
                  />
                </Form.Item>
              </Form>
            </section>

            <section>
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3 className="mb-1 text-base font-semibold">
                    {t("settings.providers.directory.create.modelsTitle")}
                  </h3>
                  <p className="m-0 text-sm text-muted">
                    {t("settings.providers.directory.create.modelsDescription")}
                  </p>
                </div>
                <Button
                  disabled={!editor.apiKey}
                  icon={<SyncOutlined />}
                  loading={discover.isPending}
                  onClick={() => discover.mutate()}
                >
                  {t("settings.providers.create.discoverModels")}
                </Button>
              </div>
              {editor.models.length > 0 ? (
                <>
                  <div className="mb-3 flex gap-2">
                    <KanvasSearchInput
                      aria-label={t(
                        "settings.providers.directory.create.searchModels",
                      )}
                      onChange={(event) =>
                        updateEditor({ search: event.target.value })
                      }
                      placeholder={t(
                        "settings.providers.directory.create.searchModels",
                      )}
                      value={editor.search}
                    />
                    <Button
                      onClick={() =>
                        updateEditor({
                          selected: editor.models.map(
                            (model) => model.upstreamModelId,
                          ),
                        })
                      }
                    >
                      {t("settings.providers.directory.create.selectAll")}
                    </Button>
                    <Button onClick={() => updateEditor({ selected: [] })}>
                      {t("settings.providers.directory.create.clear")}
                    </Button>
                  </div>
                  <Table<EditableProviderModel>
                    columns={[
                      {
                        width: 48,
                        render: (_, model) => (
                          <Checkbox
                            aria-label={t(
                              "settings.providers.directory.create.selectModel",
                              { name: model.displayName },
                            )}
                            checked={editor.selected.includes(
                              model.upstreamModelId,
                            )}
                            onChange={(event) =>
                              updateEditor({
                                selected: event.target.checked
                                  ? [...editor.selected, model.upstreamModelId]
                                  : editor.selected.filter(
                                      (id) => id !== model.upstreamModelId,
                                    ),
                              })
                            }
                          />
                        ),
                      },
                      {
                        title: t(
                          "settings.providers.directory.create.providerModel",
                        ),
                        render: (_, model) => (
                          <div>
                            <strong className="block text-sm">
                              {model.displayName}
                            </strong>
                            <span className="text-xs text-muted">
                              {model.upstreamModelId}
                            </span>
                          </div>
                        ),
                      },
                      {
                        title: t(
                          "settings.providers.directory.create.modelIdentifier",
                        ),
                        width: 290,
                        render: (_, model) => (
                          <div>
                            <KanvasInput
                              aria-label={t(
                                "settings.providers.directory.create.modelIdentifierFor",
                                { name: model.displayName },
                              )}
                              disabled={
                                !editor.selected.includes(model.upstreamModelId)
                              }
                              onChange={(event) =>
                                updateEditor({
                                  mappings: {
                                    ...editor.mappings,
                                    [model.upstreamModelId]: event.target.value,
                                  },
                                })
                              }
                              value={
                                editor.mappings[model.upstreamModelId] ?? ""
                              }
                            />
                          </div>
                        ),
                      },
                    ]}
                    dataSource={visibleModels}
                    pagination={{ pageSize: 8 }}
                    rowKey="upstreamModelId"
                    size="small"
                  />
                </>
              ) : (
                <InlineNotice
                  title={t(
                    "settings.providers.directory.create.modelsEmptyTitle",
                  )}
                  tone="info"
                >
                  {t(
                    "settings.providers.directory.create.modelsEmptyDescription",
                  )}
                </InlineNotice>
              )}
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
