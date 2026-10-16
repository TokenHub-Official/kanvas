import { CapabilityAgentAvailability } from "../features/capability-definitions/capability-agent-availability.js";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import type {
  CapabilityAdminSummary,
  CapabilityDefinitionSummary,
  CapabilityRecommendationSummary,
  CreateCapabilityDefinitionBody,
  PublishCapabilityImplementationRevisionBody,
} from "@kanvas/contracts/api";
import { resolveLocalizedTextV1 } from "@kanvas/contracts/capability";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  Button,
  Dropdown,
  Form,
  Segmented,
  Skeleton,
  Tag,
  type MenuProps,
  type TableColumnsType,
} from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  createCapabilityDefinition,
  fetchWorkspaceCapabilityDefinitions,
  fetchWorkspaceModelResources,
  installCapabilityRecommendation,
  publishCapabilityDefinitionImplementation,
  setCapabilityDefinitionStatus,
  updateCapabilityDefinition,
} from "../api/transport.js";
import { workspaceQueryKeys } from "../api/query-keys.js";
import { EmptyState, InlineNotice } from "../components/feedback.js";
import {
  KanvasInput,
  KanvasSearchInput,
  KanvasTextArea,
} from "../components/kanvas-input.js";
import { KanvasSelect } from "../components/kanvas-select.js";
import { SettingsDirectoryTable } from "../components/settings-directory-table.js";
import {
  SettingsAlertDialog,
  SettingsAlertDialogContent,
  SettingsDialog,
  SettingsDialogContent,
} from "../components/settings-overlay.js";
import {
  SettingsPageHeader,
  SettingsShell,
} from "../components/settings-shell.js";
import { useSettingsNotification } from "../components/settings-notification.js";
import { StatusTag } from "../components/status-tag.js";
import { UnsavedChangesGuard } from "../components/unsaved-changes-guard.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { activeBindingCount } from "../features/capability-bindings/capability-binding-model.js";
import { useCapabilityBindingsController } from "../features/capability-bindings/use-capability-bindings-controller.js";
import {
  capabilityMetadataBody,
  capabilityMetadataEditorError,
  capabilityMetadataEditorFrom,
  type CapabilityMetadataEditorState,
} from "../features/capability-definitions/capability-metadata-editor.js";
import {
  CapabilityGroup,
  type CapabilityRuntimeGroup,
} from "../features/capability-bindings/capability-runtime-controls.js";
import {
  capabilityDefinitionBodyFromAdapter,
  capabilityEditorLocale,
  capabilityEditorText,
  emptyCapabilityDefinitionDraft,
  visibleCapabilityOutputs,
  type CapabilityDefinitionDraft,
  updateCapabilityEditorText,
} from "../features/capability-definitions/capability-definition-editor.js";
import { CapabilityDefinitionCreateDialog } from "../features/capability-definitions/capability-definition-create-dialog.js";
import { CapabilityTestDialog } from "../features/capability-definitions/capability-test-dialog.js";
import {
  capabilityImplementationBody,
  capabilityImplementationBodyFromSource,
  emptyCapabilityImplementationDraft,
  type CapabilityImplementationDefinitionContext,
  type CapabilityImplementationDraft,
} from "../features/capability-definitions/capability-implementation-editor.js";
import { CapabilityImplementationDialog } from "../features/capability-definitions/capability-implementation-dialog.js";

const routeApi = getRouteApi("/w/$workspaceId/settings/capabilities");
const installationRefreshIntervalMilliseconds = 1_500;
const capabilityCategories = [
  { value: "image_processing", zh: "图像处理", en: "Image processing" },
  { value: "image_generation", zh: "图像生成", en: "Image generation" },
  { value: "image_analysis", zh: "图像分析", en: "Image analysis" },
] as const;
type CapabilityDirectoryView = "installed" | "recommendations" | "archived";
type CapabilityDirectoryRow =
  | Readonly<{
      key: string;
      kind: "installed";
      definition: CapabilityAdminSummary;
    }>
  | Readonly<{
      key: string;
      kind: "recommendation";
      recommendation: CapabilityRecommendationSummary;
    }>;

function localized(
  value: Readonly<{ "zh-CN": string; "en-US": string }>,
  language: string | undefined,
): string {
  return language?.toLocaleLowerCase().startsWith("zh")
    ? value["zh-CN"]
    : value["en-US"];
}

function localizedRecommendation(
  value: CapabilityRecommendationSummary["title"],
  language: string | undefined,
): string {
  return resolveLocalizedTextV1(value, language ?? "zh-CN");
}

function runtimeNeedsAttention(definition: CapabilityAdminSummary): boolean {
  return (
    activeBindingCount(definition.bindings) === 0 ||
    (definition.agentAvailability !== undefined &&
      definition.agentAvailability.status !== "ready" &&
      definition.agentAvailability.reason !== "agent_not_exposed") ||
    definition.bindings.some(
      (binding) =>
        binding.status === "enabled" && binding.availabilityReason !== "ready",
    )
  );
}

function recommendationIsInstalling(
  recommendation: CapabilityRecommendationSummary,
): boolean {
  return (
    recommendation.installationStatus === "waiting_dependency" ||
    recommendation.installationStatus === "installing"
  );
}

function firstRunMethod(
  body: PublishCapabilityImplementationRevisionBody,
): CreateCapabilityDefinitionBody["runMethod"] {
  const { expectedDefinitionVersion, replaceBinding, ...runMethod } = body;
  void expectedDefinitionVersion;
  void replaceBinding;
  return runMethod;
}

function capabilityDraftFromSource(
  source: string | undefined,
): CapabilityDefinitionDraft | undefined {
  if (!source) return undefined;
  const separator = source.indexOf(":");
  const kind = source.slice(0, separator);
  const id = source.slice(separator + 1);
  if (
    separator < 1 ||
    (kind !== "model_resource" && kind !== "model_service" && kind !== "plugin")
  ) {
    return undefined;
  }
  return {
    ...emptyCapabilityDefinitionDraft(),
    sourceKind: kind,
    sourceId: id,
  };
}

export function CapabilityDefinitionsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = routeApi.useParams();
  return (
    <WorkspacePage
      pageTitle={t("settings.capabilityDefinitions.title")}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <SettingsShell active="capabilities" workspace={workspace}>
          {workspace.permissions.includes("capability.configure") ? (
            <CapabilityDefinitionsContent
              canRun={workspace.permissions.includes("capability.run")}
              csrfToken={context.csrfToken}
              principalId={context.human.principalId}
              workspaceId={workspace.id}
            />
          ) : (
            <EmptyState
              title={t("settings.capabilityDefinitions.forbiddenTitle")}
            >
              {t("settings.capabilityDefinitions.forbiddenDescription")}
            </EmptyState>
          )}
        </SettingsShell>
      )}
    </WorkspacePage>
  );
}

function CapabilityDefinitionsContent({
  canRun,
  csrfToken,
  principalId,
  workspaceId,
}: {
  readonly canRun: boolean;
  readonly csrfToken: string;
  readonly principalId: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const searchParams = routeApi.useSearch();
  const navigate = useNavigate();
  const toast = useSettingsNotification();
  const queryClient = useQueryClient();
  const queryKey = workspaceQueryKeys.capabilityDefinitions(workspaceId);
  const definitions = useQuery({
    queryKey,
    queryFn: () => fetchWorkspaceCapabilityDefinitions(workspaceId),
    refetchInterval: (query) =>
      query.state.data?.recommendations.some(recommendationIsInstalling)
        ? installationRefreshIntervalMilliseconds
        : false,
    retry: false,
  });
  const modelResources = useQuery({
    queryKey: workspaceQueryKeys.modelResources(workspaceId),
    queryFn: () => fetchWorkspaceModelResources(workspaceId),
    retry: false,
  });
  const [directoryView, setDirectoryView] = useState<CapabilityDirectoryView>(
    searchParams.view ?? "installed",
  );
  const [search, setSearch] = useState(searchParams.q ?? "");
  const [recommendationTarget, setRecommendationTarget] =
    useState<CapabilityRecommendationSummary>();
  const [selectedRoutePolicyRevisionId, setSelectedRoutePolicyRevisionId] =
    useState<string>();
  const [creationDraft, setCreationDraft] = useState<
    CapabilityDefinitionDraft | undefined
  >(() => capabilityDraftFromSource(searchParams.source));
  const [editor, setEditor] = useState<CapabilityMetadataEditorState>();
  const [implementationEditor, setImplementationEditor] = useState<{
    readonly definition: CapabilityImplementationDefinitionContext;
    readonly draft: CapabilityImplementationDraft;
  }>();
  const [testTargetId, setTestTargetId] = useState<string>();
  const [statusTarget, setStatusTarget] =
    useState<CapabilityDefinitionSummary>();
  const context = { csrfToken, workspaceId };
  const compatibleRoutes = (definitions.data?.providerRoutes ?? []).filter(
    (route) =>
      recommendationTarget?.compatibleModelRoutePolicyRevisionIds.includes(
        route.routePolicyRevisionId,
      ),
  );
  const openRecommendation = (
    recommendation: CapabilityRecommendationSummary,
  ) => {
    setRecommendationTarget(recommendation);
    setSelectedRoutePolicyRevisionId(
      recommendation.compatibleModelRoutePolicyRevisionIds[0],
    );
  };
  const runtimeTarget = definitions.data?.definitions.find(
    (definition) => definition.id === searchParams.capabilityId,
  );
  const testTarget = definitions.data?.definitions.find(
    (definition) => definition.id === testTargetId,
  );
  const implementationDefinition = implementationEditor?.definition;
  const addImplementation = (definition: CapabilityAdminSummary) => {
    setImplementationEditor({
      definition,
      draft: emptyCapabilityImplementationDraft(definition),
    });
  };
  const replaceImplementation = (
    definition: CapabilityAdminSummary,
    binding: CapabilityAdminSummary["bindings"][number],
  ) => {
    setImplementationEditor({
      definition,
      draft: emptyCapabilityImplementationDraft(definition, binding),
    });
  };

  const listSearch = {
    ...(search ? { q: search } : {}),
    ...(directoryView === "installed" ? {} : { view: directoryView }),
  };
  const openCapability = (definitionId: string) => {
    void navigate({
      params: { workspaceId },
      resetScroll: false,
      search: { ...listSearch, capabilityId: definitionId },
      to: "/w/$workspaceId/settings/capabilities",
    });
  };
  const closeCapability = () => {
    void navigate({
      params: { workspaceId },
      resetScroll: false,
      search: listSearch,
      to: "/w/$workspaceId/settings/capabilities",
    });
  };
  function configureImplementationModels(): void {
    setImplementationEditor(undefined);
    void navigate({
      to: "/w/$workspaceId/settings/models",
      params: { workspaceId },
    });
  }
  const changeDirectoryView = (view: CapabilityDirectoryView) => {
    setDirectoryView(view);
    void navigate({
      params: { workspaceId },
      replace: true,
      resetScroll: false,
      search: {
        ...(search ? { q: search } : {}),
        ...(view === "installed" ? {} : { view }),
      },
      to: "/w/$workspaceId/settings/capabilities",
    });
  };
  const changeSearch = (value: string) => {
    setSearch(value);
    void navigate({
      params: { workspaceId },
      replace: true,
      resetScroll: false,
      search: {
        ...(value ? { q: value } : {}),
        ...(directoryView === "installed" ? {} : { view: directoryView }),
      },
      to: "/w/$workspaceId/settings/capabilities",
    });
  };
  const installRecommendation = useMutation({
    mutationFn: async () => {
      if (!recommendationTarget) {
        throw new Error("Capability recommendation is not selected.");
      }
      return installCapabilityRecommendation(
        context,
        recommendationTarget.id,
        {
          expectedCatalogDigest: recommendationTarget.canonicalDigest,
          confirmDependencies: true,
          ...(recommendationTarget.sourceKind === "model_service" &&
          selectedRoutePolicyRevisionId
            ? { selectedRoutePolicyRevisionId }
            : {}),
        },
        crypto.randomUUID(),
      );
    },
    onSuccess: async (result) => {
      setRecommendationTarget(undefined);
      setSelectedRoutePolicyRevisionId(undefined);
      await queryClient.invalidateQueries({ queryKey });
      toast.notify({
        title: t(
          result.status === "installed"
            ? "settings.capabilityDefinitions.install.completed"
            : "settings.capabilityDefinitions.install.started",
        ),
        ...(result.status === "installed"
          ? {}
          : {
              description: t(
                "settings.capabilityDefinitions.install.startedDescription",
              ),
            }),
        tone: "positive",
      });
    },
    onError: () =>
      toast.notify({
        title: t("settings.capabilityDefinitions.install.failed"),
        description: t(
          "settings.capabilityDefinitions.install.failedDescription",
        ),
        tone: "danger",
      }),
  });

  const publishImplementation = useMutation({
    mutationFn: async () => {
      if (!implementationEditor || !implementationDefinition) {
        throw new Error("Capability implementation editor is not open.");
      }
      const adapter = definitions.data?.runtimeAdapters.find(
        (item) =>
          item.id === implementationEditor.draft.runtimeAdapterRevisionId,
      );
      if (!adapter) throw new Error("Runtime Adapter is not selected.");
      const publication = capabilityImplementationBody(
        implementationEditor.draft,
        implementationDefinition,
        adapter,
        modelResources.data?.resources ?? [],
        definitions.data?.providerRoutes ?? [],
      );
      return publishCapabilityDefinitionImplementation(
        context,
        implementationDefinition.id,
        publication,
        implementationEditor.draft.requestKey,
      );
    },
    onSuccess: async () => {
      setImplementationEditor(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({
          queryKey: ["workflow-authoring-capabilities", workspaceId],
        }),
      ]);
      toast.notify({
        title: t(
          "settings.capabilityDefinitions.implementation.toast.published",
        ),
        tone: "positive",
      });
    },
    onError: () =>
      toast.notify({
        title: t("settings.capabilityDefinitions.implementation.toast.failed"),
        description: t(
          "settings.capabilityDefinitions.implementation.toast.failedDescription",
        ),
        tone: "danger",
      }),
  });

  const createFromSource = useMutation({
    mutationFn: async () => {
      if (
        !creationDraft?.sourceKind ||
        !creationDraft.sourceId ||
        !creationDraft.runtimeAdapterRevisionId
      ) {
        throw new Error("Capability source is not selected.");
      }
      const adapter = definitions.data?.runtimeAdapters.find(
        (item) => item.id === creationDraft.runtimeAdapterRevisionId,
      );
      if (!adapter) throw new Error("Runtime Adapter is not selected.");
      const body = capabilityDefinitionBodyFromAdapter(
        creationDraft,
        adapter,
        creationDraft.sourceKind === "model_service"
          ? definitions.data?.providerRoutes.find(
              (route) => route.routePolicyRevisionId === creationDraft.sourceId,
            )
          : undefined,
      );
      const definition: CapabilityImplementationDefinitionContext = {
        id: "01K00000000000000000000000",
        key: body.key,
        version: 1,
        inputSchema: body.inputSchema,
        outputSchema: body.outputSchema,
        bindings: [],
      };
      const publication = capabilityImplementationBodyFromSource(
        { kind: creationDraft.sourceKind, id: creationDraft.sourceId },
        { zh: creationDraft.titleZh, en: creationDraft.titleEn },
        definition,
        adapter,
        modelResources.data?.resources ?? [],
        definitions.data?.providerRoutes ?? [],
      );
      return createCapabilityDefinition(
        context,
        { ...body, runMethod: firstRunMethod(publication) },
        creationDraft.requestKey,
      );
    },
    onSuccess: async () => {
      setCreationDraft(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({
          queryKey: ["workflow-authoring-capabilities", workspaceId],
        }),
      ]);
      toast.notify({
        title: t("settings.capabilityDefinitions.toast.created"),
        tone: "positive",
      });
    },
    onError: () => {
      toast.notify({
        title: t("settings.capabilityDefinitions.toast.createFailed"),
        description: t(
          "settings.capabilityDefinitions.toast.createFailedDescription",
        ),
        tone: "danger",
      });
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!editor?.editing) {
        throw new Error("Capability metadata editor is not open.");
      }
      const validationError = capabilityMetadataEditorError(editor);
      if (validationError) {
        throw new TypeError("Capability discovery metadata is incomplete.");
      }
      const body = capabilityMetadataBody(editor);
      return updateCapabilityDefinition(
        context,
        editor.editing.id,
        { expectedVersion: editor.editing.version, ...body },
        editor.requestKey,
      );
    },
    onSuccess: async () => {
      setEditor(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({
          queryKey: ["workflow-authoring-capabilities", workspaceId],
        }),
      ]);
      toast.notify({
        title: t("settings.capabilityDefinitions.toast.saved"),
        tone: "positive",
      });
    },
    onError: () =>
      toast.notify({
        title: t("settings.capabilityDefinitions.toast.saveFailed"),
        description: t(
          "settings.capabilityDefinitions.toast.saveFailedDescription",
        ),
        tone: "danger",
      }),
  });
  const setStatus = useMutation({
    mutationFn: (definition: CapabilityDefinitionSummary) =>
      setCapabilityDefinitionStatus(context, definition.id, {
        expectedVersion: definition.version,
        status: definition.status === "active" ? "archived" : "active",
      }),
    onSuccess: async () => {
      setStatusTarget(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({
          queryKey: ["workflow-authoring-capabilities", workspaceId],
        }),
      ]);
      toast.notify({
        title: t("settings.capabilityDefinitions.toast.statusUpdated"),
        tone: "positive",
      });
    },
    onError: () =>
      toast.notify({
        title: t("settings.capabilityDefinitions.toast.statusFailed"),
        description: t(
          "settings.capabilityDefinitions.toast.statusFailedDescription",
        ),
        tone: "danger",
      }),
  });

  const rows = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    const definitionRows: CapabilityDirectoryRow[] = (
      definitions.data?.definitions ?? []
    ).map((definition) => ({
      key: definition.id,
      kind: "installed",
      definition,
    }));
    const recommendations: CapabilityDirectoryRow[] = (
      definitions.data?.recommendations ?? []
    )
      .filter(
        (recommendation) =>
          !recommendation.installedDefinitionId &&
          recommendation.installationStatus !== "installed",
      )
      .map((recommendation) => ({
        key: `recommendation:${recommendation.id}`,
        kind: "recommendation",
        recommendation,
      }));
    let visible = recommendations;
    if (directoryView === "installed") {
      visible = definitionRows.filter(
        (row) => row.kind === "installed" && row.definition.status === "active",
      );
    } else if (directoryView === "archived") {
      visible = definitionRows.filter(
        (row) =>
          row.kind === "installed" && row.definition.status === "archived",
      );
    }
    return visible.filter((row) => {
      if (!normalized) return true;
      const values =
        row.kind === "installed"
          ? [
              localized(
                row.definition.declaration.catalog.title,
                i18n.resolvedLanguage,
              ),
              row.definition.declaration.catalog.description
                ? localized(
                    row.definition.declaration.catalog.description,
                    i18n.resolvedLanguage,
                  )
                : "",
              localized(
                row.definition.declaration.catalog.category,
                i18n.resolvedLanguage,
              ),
              ...row.definition.declaration.catalog.tags,
            ]
          : [
              localizedRecommendation(
                row.recommendation.title,
                i18n.resolvedLanguage,
              ),
              row.recommendation.description
                ? localizedRecommendation(
                    row.recommendation.description,
                    i18n.resolvedLanguage,
                  )
                : "",
              localizedRecommendation(
                row.recommendation.category,
                i18n.resolvedLanguage,
              ),
            ];
      return values.some((value) =>
        value.toLocaleLowerCase().includes(normalized),
      );
    });
  }, [definitions.data, directoryView, i18n.resolvedLanguage, search]);

  const columns: TableColumnsType<CapabilityDirectoryRow> = [
    {
      title: t("settings.capabilityDefinitions.columns.capability"),
      key: "capability",
      width: 420,
      render: (_, row) => {
        const title =
          row.kind === "installed"
            ? localized(
                row.definition.declaration.catalog.title,
                i18n.resolvedLanguage,
              )
            : localizedRecommendation(
                row.recommendation.title,
                i18n.resolvedLanguage,
              );
        let description: string | undefined;
        if (
          row.kind === "installed" &&
          row.definition.declaration.catalog.description
        ) {
          description = localized(
            row.definition.declaration.catalog.description,
            i18n.resolvedLanguage,
          );
        } else if (
          row.kind === "recommendation" &&
          row.recommendation.description
        ) {
          description = localizedRecommendation(
            row.recommendation.description,
            i18n.resolvedLanguage,
          );
        }
        return (
          <div className="min-w-0">
            <div className="font-semibold text-ink">{title}</div>
            {description ? (
              <div className="mt-1 line-clamp-2 text-sm text-muted">
                {description}
              </div>
            ) : null}
            {row.kind === "installed" ? (
              <div className="mt-1.5 text-xs text-muted">
                {t("settings.capabilityDefinitions.inputCount", {
                  count: row.definition.declaration.parameters.length,
                })}
                <span aria-hidden="true"> · </span>
                {t("settings.capabilityDefinitions.outputCount", {
                  count: visibleCapabilityOutputs(
                    row.definition.declaration.outputs,
                  ).length,
                })}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      title: t("settings.capabilityDefinitions.columns.category"),
      key: "category",
      width: 180,
      render: (_, row) => (
        <Tag variant="filled">
          {row.kind === "installed"
            ? localized(
                row.definition.declaration.catalog.category,
                i18n.resolvedLanguage,
              )
            : localizedRecommendation(
                row.recommendation.category,
                i18n.resolvedLanguage,
              )}
        </Tag>
      ),
    },
    {
      title: t("settings.capabilityDefinitions.columns.status"),
      key: "status",
      width: 140,
      render: (_, row) => {
        if (row.kind === "recommendation") {
          let status = "notInstalled";
          if (recommendationIsInstalling(row.recommendation)) {
            status = "installing";
          } else if (row.recommendation.installationStatus === "failed") {
            status = "failed";
          }
          return (
            <StatusTag tone={status === "failed" ? "warning" : "neutral"}>
              {t(`settings.capabilityDefinitions.status.${status}`)}
            </StatusTag>
          );
        }
        let status = "ready";
        if (row.definition.status === "archived") {
          status = "archived";
        } else if (runtimeNeedsAttention(row.definition)) {
          status = "needsConfiguration";
        }
        let tone: "neutral" | "positive" | "warning" = "neutral";
        if (status === "ready") {
          tone = "positive";
        } else if (status === "needsConfiguration") {
          tone = "warning";
        }
        return (
          <div className="grid justify-items-start gap-1">
            <StatusTag tone={tone}>
              {t(`settings.capabilityDefinitions.status.${status}`)}
            </StatusTag>
            {status === "needsConfiguration" ? (
              <span className="text-xs leading-4 text-muted">
                {t(
                  row.definition.bindings.length === 0
                    ? "settings.capabilityDefinitions.statusReasons.noImplementation"
                    : "settings.capabilityDefinitions.statusReasons.implementationUnavailable",
                )}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      title: t("settings.capabilityDefinitions.columns.actions"),
      key: "actions",
      width: 190,
      fixed: "right",
      render: (_, row) => {
        if (row.kind === "recommendation") {
          const installing = recommendationIsInstalling(row.recommendation);
          let actionKey = "settings.capabilityDefinitions.actions.install";
          if (row.recommendation.installationStatus === "failed") {
            actionKey = "settings.capabilityDefinitions.actions.retryInstall";
          } else if (installing) {
            actionKey = "settings.capabilityDefinitions.actions.installing";
          }
          return (
            <Button
              disabled={installing}
              loading={installing}
              onClick={() => openRecommendation(row.recommendation)}
              size="small"
              type="primary"
            >
              {t(actionKey)}
            </Button>
          );
        }
        const definition = row.definition;
        const needsConfiguration =
          definition.status === "active" && runtimeNeedsAttention(definition);
        let primaryActionKey = "settings.capabilityDefinitions.actions.manage";
        if (definition.status === "archived") {
          primaryActionKey = "settings.capabilityDefinitions.actions.restore";
        } else if (needsConfiguration) {
          primaryActionKey = "settings.capabilityDefinitions.actions.configure";
        }
        const items: MenuProps["items"] = [
          {
            key: "edit",
            icon: <EditOutlined />,
            label: t("settings.capabilityDefinitions.actions.edit"),
          },
          {
            key: "status",
            icon:
              definition.status === "active" ? (
                <DeleteOutlined />
              ) : (
                <UndoOutlined />
              ),
            danger: definition.status === "active",
            label:
              definition.status === "active"
                ? t("settings.capabilityDefinitions.actions.archive")
                : t("settings.capabilityDefinitions.actions.restore"),
          },
        ];
        return (
          <div className="flex items-center gap-1">
            <Button
              onClick={() =>
                definition.status === "archived"
                  ? setStatusTarget(definition)
                  : openCapability(definition.id)
              }
              size="small"
              type={needsConfiguration ? "primary" : "default"}
            >
              {t(primaryActionKey)}
            </Button>
            <Dropdown
              menu={{
                items,
                onClick: ({ key }) => {
                  if (key === "edit") {
                    setEditor(capabilityMetadataEditorFrom(definition));
                  } else {
                    setStatusTarget(definition);
                  }
                },
              }}
              placement="bottomRight"
              trigger={["click"]}
            >
              <Button
                aria-label={t("settings.capabilityDefinitions.actions.more")}
                icon={<MoreOutlined />}
                type="text"
              />
            </Dropdown>
          </div>
        );
      },
    },
  ];
  let emptyText: React.JSX.Element;
  if (directoryView === "installed") {
    emptyText = (
      <EmptyState
        action={() => setDirectoryView("recommendations")}
        actionLabel={t("settings.capabilityDefinitions.viewRecommendations")}
        title={t("settings.capabilityDefinitions.emptyInstalledTitle")}
      >
        {t("settings.capabilityDefinitions.emptyInstalledDescription")}
      </EmptyState>
    );
  } else if (directoryView === "recommendations") {
    emptyText = (
      <EmptyState
        title={t("settings.capabilityDefinitions.emptyRecommendationsTitle")}
      >
        {t("settings.capabilityDefinitions.emptyRecommendationsDescription")}
      </EmptyState>
    );
  } else {
    emptyText = (
      <EmptyState
        title={t("settings.capabilityDefinitions.emptyArchivedTitle")}
      >
        {null}
      </EmptyState>
    );
  }

  return (
    <div className="w-full">
      {!runtimeTarget ? (
        <SettingsPageHeader
          action={
            <Button
              icon={<PlusOutlined />}
              onClick={() => setCreationDraft(emptyCapabilityDefinitionDraft())}
            >
              {t("settings.capabilityDefinitions.createCustom")}
            </Button>
          }
          title={t("settings.capabilityDefinitions.title")}
        />
      ) : null}
      {definitions.isPending ? (
        <div className="rounded-[20px] bg-paper p-5">
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      ) : null}
      {definitions.isError ? (
        <InlineNotice
          title={t("settings.capabilityDefinitions.loadError")}
          tone="danger"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {t("settings.capabilityDefinitions.loadErrorDescription")}
            </span>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void definitions.refetch()}
              size="small"
            >
              {t("settings.capabilityDefinitions.reload")}
            </Button>
          </div>
        </InlineNotice>
      ) : null}
      {definitions.data && !runtimeTarget ? (
        <SettingsDirectoryTable
          columns={columns}
          dataSource={rows}
          emptyText={emptyText}
          toolbar={
            <div className="flex w-full flex-wrap items-center gap-3">
              <Segmented<CapabilityDirectoryView>
                onChange={changeDirectoryView}
                options={[
                  {
                    label: t("settings.capabilityDefinitions.views.installed", {
                      count: definitions.data.definitions.filter(
                        (definition) => definition.status === "active",
                      ).length,
                    }),
                    value: "installed",
                  },
                  {
                    label: t(
                      "settings.capabilityDefinitions.views.recommendations",
                      {
                        count: definitions.data.recommendations.filter(
                          (recommendation) =>
                            !recommendation.installedDefinitionId &&
                            recommendation.installationStatus !== "installed",
                        ).length,
                      },
                    ),
                    value: "recommendations",
                  },
                  {
                    label: t("settings.capabilityDefinitions.views.archived", {
                      count: definitions.data.definitions.filter(
                        (definition) => definition.status === "archived",
                      ).length,
                    }),
                    value: "archived",
                  },
                ]}
                value={directoryView}
              />
              <KanvasSearchInput
                allowClear
                className="w-full sm:ml-auto sm:max-w-90"
                onChange={(event) => changeSearch(event.target.value)}
                placeholder={t("settings.capabilityDefinitions.search")}
                value={search}
              />
            </div>
          }
        />
      ) : null}
      {runtimeTarget ? (
        <CapabilityRuntimeDetail
          canRun={canRun}
          csrfToken={csrfToken}
          definition={runtimeTarget}
          onAddImplementation={addImplementation}
          onBack={closeCapability}
          onReplaceImplementation={replaceImplementation}
          onTest={(definition) => setTestTargetId(definition.id)}
          onRefresh={async () => {
            await definitions.refetch();
          }}
          workspaceId={workspaceId}
        />
      ) : null}
      <CapabilityRecommendationInstallDialog
        compatibleRoutes={compatibleRoutes}
        installing={installRecommendation.isPending}
        onClose={() => {
          if (!installRecommendation.isPending) {
            setRecommendationTarget(undefined);
            setSelectedRoutePolicyRevisionId(undefined);
          }
        }}
        onInstall={() => installRecommendation.mutate()}
        recommendation={recommendationTarget}
        selectedRoutePolicyRevisionId={selectedRoutePolicyRevisionId}
        setSelectedRoutePolicyRevisionId={setSelectedRoutePolicyRevisionId}
        workspaceId={workspaceId}
      />
      <CapabilityDefinitionEditorDialog
        editor={editor}
        onChange={setEditor}
        onSave={() => save.mutate()}
        saving={save.isPending}
      />
      <CapabilityDefinitionCreateDialog
        adapters={definitions.data?.runtimeAdapters ?? []}
        draft={creationDraft}
        onChange={setCreationDraft}
        onSave={() => createFromSource.mutate()}
        providerRoutes={definitions.data?.providerRoutes ?? []}
        resources={modelResources.data?.resources ?? []}
        saving={createFromSource.isPending}
      />
      <CapabilityTestDialog
        canRun={canRun}
        csrfToken={csrfToken}
        definition={testTarget}
        key={testTarget?.id ?? "closed"}
        onClose={() => setTestTargetId(undefined)}
        principalId={principalId}
        workspaceId={workspaceId}
      />
      <CapabilityImplementationDialog
        adapters={definitions.data?.runtimeAdapters ?? []}
        creating={false}
        definition={implementationDefinition}
        draft={implementationEditor?.draft}
        onChange={(draft) =>
          setImplementationEditor((current) =>
            current && draft ? { ...current, draft } : undefined,
          )
        }
        onConfigureModels={configureImplementationModels}
        onPublish={() => publishImplementation.mutate()}
        providerRoutes={definitions.data?.providerRoutes ?? []}
        publishing={publishImplementation.isPending}
        resources={modelResources.data?.resources ?? []}
      />
      <SettingsAlertDialog
        onOpenChange={(open) => {
          if (!open) setStatusTarget(undefined);
        }}
        open={Boolean(statusTarget)}
      >
        <SettingsAlertDialogContent
          actionLabel={
            statusTarget?.status === "active"
              ? t("settings.capabilityDefinitions.actions.archive")
              : t("settings.capabilityDefinitions.actions.restore")
          }
          actionVariant={
            statusTarget?.status === "active" ? "danger" : "primary"
          }
          cancelLabel={t("settings.capabilityDefinitions.cancel")}
          onAction={() => {
            if (statusTarget) setStatus.mutate(statusTarget);
          }}
          title={
            statusTarget?.status === "active"
              ? t("settings.capabilityDefinitions.archiveTitle")
              : t("settings.capabilityDefinitions.restoreTitle")
          }
        >
          {statusTarget?.status === "active"
            ? t("settings.capabilityDefinitions.archiveDescription")
            : t("settings.capabilityDefinitions.restoreDescription")}
        </SettingsAlertDialogContent>
      </SettingsAlertDialog>
    </div>
  );
}

function CapabilityRecommendationInstallDialog({
  compatibleRoutes,
  installing,
  onClose,
  onInstall,
  recommendation,
  selectedRoutePolicyRevisionId,
  setSelectedRoutePolicyRevisionId,
  workspaceId,
}: {
  readonly compatibleRoutes: readonly Readonly<{
    routePolicyRevisionId: string;
    providerName: string;
    providerModelId: string;
  }>[];
  readonly installing: boolean;
  readonly onClose: () => void;
  readonly onInstall: () => void;
  readonly recommendation: CapabilityRecommendationSummary | undefined;
  readonly selectedRoutePolicyRevisionId: string | undefined;
  readonly setSelectedRoutePolicyRevisionId: (
    value: string | undefined,
  ) => void;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const usesModelService = recommendation?.sourceKind === "model_service";
  const needsModelServiceConfiguration =
    usesModelService && compatibleRoutes.length === 0;
  const capabilityName = recommendation
    ? localizedRecommendation(recommendation.title, i18n.resolvedLanguage)
    : "";

  function configureModels(): void {
    onClose();
    void navigate({
      params: { workspaceId },
      to: "/w/$workspaceId/settings/models",
    });
  }

  return (
    <SettingsDialog
      onOpenChange={(open) => {
        if (!open && !installing) onClose();
      }}
      open={Boolean(recommendation)}
    >
      {recommendation ? (
        <SettingsDialogContent
          closeLabel={t("common.dialog.close")}
          {...(recommendation.description
            ? {
                description: localizedRecommendation(
                  recommendation.description,
                  i18n.resolvedLanguage,
                ),
              }
            : {})}
          dismissible={!installing}
          title={t("settings.capabilityDefinitions.install.title", {
            name: capabilityName,
          })}
        >
          <div className="grid gap-5">
            {recommendation.sourceKind === "model_resource" ? (
              <InlineNotice
                title={t(
                  "settings.capabilityDefinitions.install.recommendedModelTitle",
                )}
              >
                {t(
                  "settings.capabilityDefinitions.install.recommendedModelDescription",
                )}
              </InlineNotice>
            ) : null}
            {recommendation.sourceKind === "plugin" ? (
              <p className="m-0 text-sm leading-6 text-muted">
                {t("settings.capabilityDefinitions.install.readyDescription")}
              </p>
            ) : null}
            {usesModelService && !needsModelServiceConfiguration ? (
              <label className="grid gap-2 text-sm font-medium text-ink">
                {t("settings.capabilityDefinitions.install.chooseModel")}
                <KanvasSelect
                  onChange={(value) =>
                    setSelectedRoutePolicyRevisionId(String(value))
                  }
                  options={compatibleRoutes.map((route) => ({
                    label: `${route.providerModelId} · ${route.providerName}`,
                    value: route.routePolicyRevisionId,
                  }))}
                  value={selectedRoutePolicyRevisionId}
                />
              </label>
            ) : null}
            {needsModelServiceConfiguration ? (
              <InlineNotice
                title={t(
                  "settings.capabilityDefinitions.install.modelServiceRequiredTitle",
                )}
              >
                {t(
                  "settings.capabilityDefinitions.install.modelServiceRequiredDescription",
                )}
              </InlineNotice>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button disabled={installing} onClick={onClose}>
                {t("settings.capabilityDefinitions.cancel")}
              </Button>
              {needsModelServiceConfiguration ? (
                <Button onClick={configureModels} type="primary">
                  {t("settings.capabilityDefinitions.install.configureModels")}
                </Button>
              ) : (
                <Button
                  disabled={usesModelService && !selectedRoutePolicyRevisionId}
                  loading={installing}
                  onClick={onInstall}
                  type="primary"
                >
                  {t(
                    recommendation.sourceKind === "model_resource"
                      ? "settings.capabilityDefinitions.install.addModelAndInstall"
                      : "settings.capabilityDefinitions.install.confirm",
                  )}
                </Button>
              )}
            </div>
          </div>
        </SettingsDialogContent>
      ) : null}
    </SettingsDialog>
  );
}

function CapabilityRuntimeDetail({
  canRun,
  csrfToken,
  definition,
  onAddImplementation,
  onBack,
  onReplaceImplementation,
  onTest,
  onRefresh,
  workspaceId,
}: {
  readonly canRun: boolean;
  readonly csrfToken: string;
  readonly definition: CapabilityAdminSummary;
  readonly onAddImplementation: (definition: CapabilityAdminSummary) => void;
  readonly onReplaceImplementation: (
    definition: CapabilityAdminSummary,
    binding: CapabilityAdminSummary["bindings"][number],
  ) => void;
  readonly onTest: (definition: CapabilityAdminSummary) => void;
  readonly onBack: () => void;
  readonly onRefresh: () => Promise<unknown>;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const {
    closePause,
    confirmPause,
    pauseTarget,
    moveOrder,
    openPause,
    operationPending,
    orderSaving,
    resume,
  } = useCapabilityBindingsController({
    csrfToken,
    onRefresh,
    workspaceId,
  });
  const capabilityName = localized(
    definition.declaration.catalog.title,
    i18n.resolvedLanguage,
  );
  const group: CapabilityRuntimeGroup = {
    capabilityKey: definition.key,
    capabilityRevision: definition.contractRevision,
    bindings: definition.bindings,
  };
  let runtimeTone: "neutral" | "positive" | "warning" = "positive";
  let runtimeLabel = t("settings.execution.runnable");
  if (definition.status === "archived") {
    runtimeTone = "neutral";
    runtimeLabel = t("settings.capabilityDefinitions.status.archived");
  } else if (runtimeNeedsAttention(definition)) {
    runtimeTone = "warning";
    runtimeLabel = t("settings.execution.needsReview");
  }

  return (
    <>
      <div className="grid gap-7 pb-8">
        <Button
          className="w-fit !px-0"
          disabled={operationPending}
          icon={<ArrowLeftOutlined aria-hidden="true" />}
          onClick={onBack}
          type="text"
        >
          {t("settings.capabilityDefinitions.details.back")}
        </Button>

        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="m-0 text-2xl font-semibold tracking-[-0.02em] text-ink">
                {capabilityName}
              </h2>
              <StatusTag tone={runtimeTone}>{runtimeLabel}</StatusTag>
            </div>
            {definition.declaration.catalog.description ? (
              <p className="mt-3 mb-0 max-w-3xl text-sm leading-6 text-muted">
                {localized(
                  definition.declaration.catalog.description,
                  i18n.resolvedLanguage,
                )}
              </p>
            ) : null}
          </div>
          <Button
            disabled={
              !canRun ||
              operationPending ||
              definition.status !== "active" ||
              activeBindingCount(definition.bindings) === 0
            }
            onClick={() => onTest(definition)}
            type="primary"
          >
            {t("settings.capabilityDefinitions.test.action")}
          </Button>
        </header>

        <CapabilityAgentAvailability
          availability={definition.agentAvailability}
        />

        <section className="grid gap-3">
          <h3 className="m-0 text-base font-semibold text-ink">
            {t("settings.capabilityDefinitions.details.contract")}
          </h3>
          <CapabilityContractSummary definition={definition} />
        </section>

        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="m-0 text-base font-semibold text-ink">
                {t("settings.capabilityDefinitions.details.runMethods")}
              </h3>
              <p className="mt-1 mb-0 text-sm text-muted">
                {t("settings.capabilityDefinitions.details.runMethodsHint")}
              </p>
            </div>
            <Button
              disabled={operationPending || definition.status !== "active"}
              icon={<PlusOutlined />}
              onClick={() => onAddImplementation(definition)}
            >
              {t("settings.capabilityDefinitions.implementation.add")}
            </Button>
          </div>
          {group.bindings.length > 0 ? (
            <CapabilityGroup
              group={group}
              key={`${group.capabilityKey}:${group.capabilityRevision}`}
              onPause={(binding) =>
                openPause({
                  binding,
                  capabilityName,
                  removesLastEnabledRoute:
                    activeBindingCount(group.bindings) === 1,
                })
              }
              onReplace={(binding) =>
                onReplaceImplementation(definition, binding)
              }
              onResume={resume}
              onSaveOrder={(bindings, moves) => moveOrder({ bindings, moves })}
              operationPending={
                operationPending || definition.status !== "active"
              }
              orderSaving={orderSaving}
            />
          ) : (
            <EmptyState
              action={() => onAddImplementation(definition)}
              actionLabel={t(
                "settings.capabilityDefinitions.implementation.add",
              )}
              title={t("settings.execution.emptyTitle")}
            >
              {t("settings.execution.emptyDescription")}
            </EmptyState>
          )}
        </section>
      </div>

      <SettingsAlertDialog
        onOpenChange={(open) => {
          if (!open) closePause();
        }}
        open={Boolean(pauseTarget)}
      >
        <SettingsAlertDialogContent
          actionLabel={t("settings.execution.pause.action")}
          cancelLabel={t("settings.execution.configure.cancel")}
          onAction={confirmPause}
          title={
            pauseTarget?.removesLastEnabledRoute
              ? t("settings.execution.pause.lastRouteTitle", {
                  name: pauseTarget.capabilityName,
                })
              : t("settings.execution.pause.title", {
                  name: pauseTarget
                    ? (pauseTarget.binding.providerName ??
                      t(
                        `settings.execution.targets.${pauseTarget.binding.executionTarget}`,
                      ))
                    : "",
                })
          }
        >
          <p>{t("settings.execution.pause.description")}</p>
          {pauseTarget?.removesLastEnabledRoute ? (
            <p className="mt-2 font-bold text-danger">
              {t("settings.execution.pause.lastRouteDescription")}
            </p>
          ) : null}
        </SettingsAlertDialogContent>
      </SettingsAlertDialog>
    </>
  );
}

function CapabilityContractSummary({
  definition,
}: {
  readonly definition: CapabilityAdminSummary;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const sections = [
    {
      key: "inputs",
      title: t("settings.capabilityDefinitions.details.inputs"),
      fields: definition.declaration.parameters.map((parameter) => ({
        description: parameter.description
          ? localized(parameter.description, i18n.resolvedLanguage)
          : undefined,
        key: parameter.key,
        label: localized(parameter.label, i18n.resolvedLanguage),
        status: parameter.required
          ? t("settings.capabilityDefinitions.details.required")
          : t("settings.capabilityDefinitions.details.optional"),
        statusTag: parameter.required,
      })),
    },
    {
      key: "outputs",
      title: t("settings.capabilityDefinitions.details.outputs"),
      fields: visibleCapabilityOutputs(definition.declaration.outputs).map(
        (output) => ({
          description: output.description
            ? localized(output.description, i18n.resolvedLanguage)
            : undefined,
          key: output.key,
          label: localized(output.label, i18n.resolvedLanguage),
          status: output.primary
            ? t("settings.capabilityDefinitions.details.primary")
            : undefined,
          statusTag: output.primary,
        }),
      ),
    },
  ] as const;
  return (
    <div className="grid items-start gap-4 md:grid-cols-2">
      {sections.map((section) => (
        <section
          className="min-w-0 rounded-[16px] bg-paper p-4"
          key={section.key}
        >
          <h4 className="m-0 text-sm font-semibold text-ink">
            {section.title}
          </h4>
          {section.fields.length > 0 ? (
            <ul className="mt-2 grid list-none divide-y divide-line p-0">
              {section.fields.map((field) => (
                <li
                  className="flex min-h-12 min-w-0 items-center justify-between gap-4 py-2.5"
                  key={field.key}
                >
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">
                      {field.label}
                    </span>
                    {field.description ? (
                      <span className="mt-0.5 block text-xs leading-5 text-muted">
                        {field.description}
                      </span>
                    ) : null}
                  </div>
                  <CapabilityFieldStatus
                    status={field.status}
                    statusTag={field.statusTag}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">
              {t("settings.capabilityDefinitions.details.none")}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function CapabilityFieldStatus({
  status,
  statusTag,
}: {
  readonly status: string | undefined;
  readonly statusTag: boolean;
}): React.JSX.Element | null {
  if (!status) return null;
  if (statusTag) {
    return (
      <StatusTag className="shrink-0" tone="neutral">
        {status}
      </StatusTag>
    );
  }
  return <span className="shrink-0 text-xs text-muted">{status}</span>;
}

function CapabilityDefinitionEditorDialog({
  editor,
  onChange,
  onSave,
  saving,
}: {
  readonly editor: CapabilityMetadataEditorState | undefined;
  readonly onChange: (value: CapabilityMetadataEditorState | undefined) => void;
  readonly onSave: () => void;
  readonly saving: boolean;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const locale = capabilityEditorLocale(i18n.resolvedLanguage);
  const [discardOpen, setDiscardOpen] = useState(false);
  const update = (value: Partial<CapabilityMetadataEditorState>) =>
    onChange(editor ? { ...editor, ...value } : editor);
  const catalog = editor?.editing?.declaration.catalog;
  const dirty = Boolean(
    editor &&
    catalog &&
    (editor.titleZh !== catalog.title["zh-CN"] ||
      editor.titleEn !== catalog.title["en-US"] ||
      editor.descriptionZh !== (catalog.description?.["zh-CN"] ?? "") ||
      editor.descriptionEn !== (catalog.description?.["en-US"] ?? "") ||
      editor.categoryZh !== catalog.category["zh-CN"] ||
      editor.categoryEn !== catalog.category["en-US"] ||
      editor.tags !== catalog.tags.join(", ")),
  );

  function updateTitle(value: string): void {
    if (!editor) return;
    const next = updateCapabilityEditorText(
      locale,
      editor.titleZh,
      editor.titleEn,
      value,
    );
    update({ titleZh: next.zh, titleEn: next.en });
  }

  function updateCategory(value: string): void {
    const category = capabilityCategories.find((item) => item.value === value);
    if (category) update({ categoryZh: category.zh, categoryEn: category.en });
  }

  function updateDescription(value: string): void {
    if (!editor) return;
    const next = value.trim()
      ? updateCapabilityEditorText(
          locale,
          editor.descriptionZh,
          editor.descriptionEn,
          value,
        )
      : { zh: "", en: "" };
    update({ descriptionZh: next.zh, descriptionEn: next.en });
  }

  function requestClose(): void {
    if (saving) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onChange(undefined);
  }

  function discardChanges(): void {
    setDiscardOpen(false);
    onChange(undefined);
  }

  return (
    <>
      <UnsavedChangesGuard
        active={dirty}
        title={t("settings.capabilityDefinitions.discard.title")}
      >
        {t("settings.capabilityDefinitions.discard.description")}
      </UnsavedChangesGuard>
      <SettingsDialog
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
        open={Boolean(editor)}
      >
        <SettingsDialogContent
          closeLabel={t("settings.capabilityDefinitions.close")}
          dismissible={!saving}
          scrollable
          title={t("settings.capabilityDefinitions.editTitle")}
          width={760}
        >
          {editor ? (
            <Form
              initialValues={{
                name: capabilityEditorText(
                  locale,
                  editor.titleZh,
                  editor.titleEn,
                ),
                category: capabilityCategories.find(
                  (item) =>
                    item.zh === editor.categoryZh &&
                    item.en === editor.categoryEn,
                )?.value,
                description: capabilityEditorText(
                  locale,
                  editor.descriptionZh,
                  editor.descriptionEn,
                ),
              }}
              key={editor.requestKey}
              layout="vertical"
              onFinish={onSave}
              validateTrigger={[]}
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Form.Item
                  label={t("settings.capabilityDefinitions.fields.name")}
                  name="name"
                  rules={[
                    {
                      required: true,
                      message: t(
                        "settings.capabilityDefinitions.validation.title",
                      ),
                    },
                  ]}
                >
                  <KanvasInput
                    onChange={(event) => updateTitle(event.target.value)}
                    placeholder={t(
                      "settings.capabilityDefinitions.placeholders.name",
                    )}
                  />
                </Form.Item>
                <Form.Item
                  label={t("settings.capabilityDefinitions.fields.category")}
                  name="category"
                  rules={[
                    {
                      required: true,
                      message: t(
                        "settings.capabilityDefinitions.validation.category",
                      ),
                    },
                  ]}
                >
                  <KanvasSelect
                    onChange={(value) => updateCategory(String(value))}
                    options={capabilityCategories.map((item) => ({
                      label: locale === "zh-CN" ? item.zh : item.en,
                      value: item.value,
                    }))}
                    placeholder={t(
                      "settings.capabilityDefinitions.placeholders.category",
                    )}
                  />
                </Form.Item>
                <Form.Item
                  className="md:col-span-2"
                  label={t("settings.capabilityDefinitions.fields.description")}
                  name="description"
                >
                  <KanvasTextArea
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    onChange={(event) => updateDescription(event.target.value)}
                    placeholder={t(
                      "settings.capabilityDefinitions.placeholders.description",
                    )}
                  />
                </Form.Item>
              </div>
              <div className="mt-6 flex justify-end gap-2 pt-2">
                <Button disabled={saving} onClick={requestClose}>
                  {t("settings.capabilityDefinitions.cancel")}
                </Button>
                <Button
                  disabled={!dirty}
                  htmlType="submit"
                  loading={saving}
                  type="primary"
                >
                  {t("settings.capabilityDefinitions.save")}
                </Button>
              </div>
            </Form>
          ) : null}
        </SettingsDialogContent>
      </SettingsDialog>
      <SettingsAlertDialog onOpenChange={setDiscardOpen} open={discardOpen}>
        <SettingsAlertDialogContent
          actionLabel={t("settings.capabilityDefinitions.discard.action")}
          cancelLabel={t("settings.capabilityDefinitions.cancel")}
          onAction={discardChanges}
          title={t("settings.capabilityDefinitions.discard.title")}
        >
          {t("settings.capabilityDefinitions.discard.description")}
        </SettingsAlertDialogContent>
      </SettingsAlertDialog>
    </>
  );
}
