import {
  ArrowLeftOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { projectWorkflowAuthoringGraph } from "@kanvas/contracts/workflow-authoring";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Alert, App as AntApp, Button, Skeleton } from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ulid } from "ulid";

import {
  createWorkflowRun,
  fetchBrandKitRevision,
  fetchWorkflowAuthoringCapabilities,
  fetchWorkflowRuns,
  fetchWorkflowTemplate,
} from "../api/transport.js";
import workingIllustration from "../assets/icons/ant-design/EditOutlined.svg";
import { ArtifactPreview } from "../components/artifact-preview.js";
import { DoodleIcon } from "../components/doodle-icon.js";
import { PageEmptyState } from "../components/feedback.js";
import { KanvasSelect } from "../components/kanvas-select.js";
import { StatusTag } from "../components/status-tag.js";
import { useDocumentTitle } from "../components/use-document-title.js";
import { WorkspaceBoundary } from "../components/workspace-page.js";
import {
  useWorkspaceBrandChoiceV1,
  withoutBrandChoiceV1,
  workspaceBrandChoiceValueV1,
} from "../features/brand/use-workspace-brand-choice-v1.js";
import { BrandSocialStarterFieldsV1 } from "../features/workflows/brand-social-starter-fields-v1.js";
import {
  brandSocialStarterDefaultsV1,
  brandSocialStarterWorkflowKeyV1,
} from "../features/workflows/brand-social-starter-v1.js";
import { EffectiveInvocationFieldControl } from "../features/workflows/effective-invocation-field-control.js";
import { localizeEffectiveInvocationFields } from "../features/workflows/workflow-capability-authoring-profile-v1.js";
import {
  effectiveInvocationInput,
  requiredInvocationField,
  type EffectiveInvocationValue,
  type EffectiveInvocationValues,
} from "../features/workflows/effective-invocation-input.js";
import {
  workflowRunFinalArtifactsV1,
  type WorkflowRunArtifactV1,
} from "../features/workflows/workflow-run-artifacts-v1.js";

const routeApi = getRouteApi(
  "/w/$workspaceId/workflow-templates/$workflowRevisionId",
);
interface TemplateHistoryItem {
  readonly id: string;
  readonly lifecycleStatus: string;
  readonly createdAt: string;
  readonly artifact?: WorkflowRunArtifactV1;
  readonly brandName?: string;
}

function formatHistoryDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function WorkflowTemplateDetailPage(): React.JSX.Element {
  const { workspaceId, workflowRevisionId } = routeApi.useParams();
  const search = routeApi.useSearch();
  let initialBrandKitId: string | null | undefined;
  if (search.brandKitId) initialBrandKitId = search.brandKitId;
  else if (search.withoutBrand) initialBrandKitId = null;
  return (
    <WorkspaceBoundary workspaceId={workspaceId}>
      {({ context, workspace }) => (
        <TemplateLaunchExperience
          canReadBrand={workspace.permissions.includes("brand.read")}
          canRun={workspace.permissions.includes("workflow.run")}
          csrfToken={context.csrfToken}
          {...(initialBrandKitId !== undefined ? { initialBrandKitId } : {})}
          workflowRevisionId={workflowRevisionId}
          workspaceId={workspace.id}
        />
      )}
    </WorkspaceBoundary>
  );
}

function TemplateLaunchExperience({
  canReadBrand,
  canRun,
  csrfToken,
  initialBrandKitId,
  workflowRevisionId,
  workspaceId,
}: {
  readonly canReadBrand: boolean;
  readonly canRun: boolean;
  readonly csrfToken: string;
  readonly initialBrandKitId?: string | null;
  readonly workflowRevisionId: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const { notification } = AntApp.useApp();
  const navigate = useNavigate();
  const [sharedValues, setSharedValues] = useState<EffectiveInvocationValues>(
    {},
  );
  const [brandScopedValues, setBrandScopedValues] = useState<{
    readonly scope: string;
    readonly values: EffectiveInvocationValues;
  }>();
  const [inputError, setInputError] = useState<string>();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [uploadingFieldKeys, setUploadingFieldKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const brandChoice = useWorkspaceBrandChoiceV1({
    canReadBrand,
    ...(initialBrandKitId !== undefined ? { initialBrandKitId } : {}),
    workspaceId,
  });
  const brandChoicePending = canReadBrand && brandChoice.brands.isPending;
  const brandOptions = [
    ...brandChoice.publishedBrands.map((brand) => ({
      label: brand.isDefault
        ? t("studio.home.brandDefaultOption", { brand: brand.name })
        : brand.name,
      value: workspaceBrandChoiceValueV1(brand.id),
    })),
    {
      label: t("studio.home.withoutBrand"),
      value: withoutBrandChoiceV1,
    },
  ];
  const template = useQuery({
    queryKey: ["workflow-template", workspaceId, workflowRevisionId],
    queryFn: () => fetchWorkflowTemplate(workspaceId, workflowRevisionId),
    retry: false,
  });
  const capabilities = useQuery({
    queryKey: ["workflow-authoring-capabilities", workspaceId],
    queryFn: () => fetchWorkflowAuthoringCapabilities(workspaceId),
    retry: false,
  });
  const recentRuns = useQuery({
    queryKey: ["workflow-runs", workspaceId, workflowRevisionId, "recent"],
    queryFn: () =>
      fetchWorkflowRuns(workspaceId, {
        workflowRevisionId,
        state: "completed",
        limit: 6,
      }),
    retry: false,
  });
  const isBrandSocialStarter =
    template.data?.workflowKey === brandSocialStarterWorkflowKeyV1;
  const selectedBrand = brandChoice.selection.brand;
  const selectedBrandRevisionId = brandChoice.selection.brandKitRevisionId;
  const brandRevision = useQuery({
    queryKey:
      selectedBrand && selectedBrandRevisionId
        ? [
            "brand-kit-revision",
            workspaceId,
            selectedBrand.id,
            selectedBrandRevisionId,
          ]
        : ["brand-kit-revision", workspaceId, "workflow-starter"],
    queryFn: () =>
      fetchBrandKitRevision(
        workspaceId,
        selectedBrand!.id,
        selectedBrandRevisionId!,
      ),
    enabled: Boolean(
      isBrandSocialStarter && selectedBrand && selectedBrandRevisionId,
    ),
    retry: false,
    staleTime: 30_000,
  });
  const brandValueScope = selectedBrandRevisionId ?? "without-brand";
  const scopedValues =
    brandScopedValues?.scope === brandValueScope
      ? brandScopedValues.values
      : {};
  const values = isBrandSocialStarter
    ? {
        ...brandSocialStarterDefaultsV1(brandRevision.data),
        ...sharedValues,
        ...scopedValues,
      }
    : sharedValues;
  const invocationSchema = template.data?.effectiveInvocationSchema;
  const directCapability = useMemo(() => {
    const nodes = template.data?.topology.nodes;
    const node = nodes?.length === 1 ? nodes[0] : undefined;
    if (node?.kind !== "invoke") return undefined;
    const input = node.input as Readonly<Record<string, unknown>>;
    const reference = input.$value as
      Readonly<Record<string, unknown>> | undefined;
    if (
      Object.keys(input).length !== 1 ||
      reference?.source !== "workflow_input" ||
      reference.pointer !== ""
    ) {
      return undefined;
    }
    return capabilities.data?.items.find(
      (capability) =>
        capability.contractId === node.capability.contractId &&
        capability.revision === node.capability.revision &&
        capability.canonicalDigest === node.capability.canonicalDigest,
    );
  }, [capabilities.data?.items, template.data?.topology.nodes]);
  const properties = useMemo(
    () =>
      invocationSchema?.availability === "available"
        ? localizeEffectiveInvocationFields(
            invocationSchema.fields,
            directCapability,
            i18n.resolvedLanguage ?? i18n.language,
          )
        : [],
    [directCapability, i18n.language, i18n.resolvedLanguage, invocationSchema],
  );
  const title =
    template.data?.displayName ?? t("workflows.templateDetail.documentTitle");
  useDocumentTitle(title);
  const graph = useMemo(
    () =>
      template.data
        ? projectWorkflowAuthoringGraph({
            schemaVersion: 1,
            inputSchema: template.data.inputSchema,
            outputSchema: template.data.outputSchema,
            topology: template.data.topology,
          })
        : undefined,
    [template.data],
  );
  const historyItems = useMemo<readonly TemplateHistoryItem[]>(
    () =>
      (recentRuns.data?.items ?? []).map((run) => ({
        id: run.id,
        lifecycleStatus: run.lifecycleStatus,
        createdAt: run.createdAt,
        ...(run.brand ? { brandName: run.brand.name } : {}),
        ...(graph
          ? {
              artifact: workflowRunFinalArtifactsV1(
                run,
                graph,
                capabilities.data?.items ?? [],
              )[0],
            }
          : {}),
      })),
    [capabilities.data?.items, graph, recentRuns.data?.items],
  );
  const selectedHistoryItem =
    historyItems.find((item) => item.id === selectedRunId) ?? historyItems[0];

  function updateInvocationValue(
    key: string,
    value: EffectiveInvocationValue | undefined,
  ): void {
    setInputError(undefined);
    if (
      isBrandSocialStarter &&
      (key === "logoArtifactId" || key === "backgroundColor")
    ) {
      setBrandScopedValues((current) => ({
        scope: brandValueScope,
        values: {
          ...(current?.scope === brandValueScope ? current.values : {}),
          [key]: value,
        },
      }));
      return;
    }
    setSharedValues((current) => ({ ...current, [key]: value }));
  }

  function notifyError() {
    notification.error({
      message: t("workflows.templateDetail.operationError"),
      description: t("workflows.templateDetail.operationErrorDescription"),
    });
  }

  const start = useMutation({
    mutationFn: () => {
      if (!template.data) {
        throw new Error(t("workflows.templateDetail.notLoaded"));
      }
      if (!invocationSchema) {
        throw new Error(t("workflows.templateDetail.schemaUnavailable"));
      }
      const missing = requiredInvocationField(properties, values);
      if (missing) {
        setInputError(
          t("workflows.templateDetail.requiredInput", { field: missing.label }),
        );
        throw new Error(`Missing ${missing.key}.`);
      }
      let input: Readonly<Record<string, unknown>>;
      try {
        input = effectiveInvocationInput(invocationSchema, values);
      } catch (error) {
        setInputError(t("workflows.templateDetail.invalidInput"));
        throw error;
      }
      return createWorkflowRun(
        { csrfToken, workspaceId },
        {
          workflowRevisionId: template.data.workflowRevisionId,
          input,
          ...(brandChoice.selection.brandKitRevisionId
            ? {
                brandKitRevisionId: brandChoice.selection.brandKitRevisionId,
              }
            : { brandKitRevisionId: null }),
        },
        ulid(),
      );
    },
    onSuccess: async (run) => {
      await navigate({
        to: "/w/$workspaceId/workflow-runs/$workflowRunId",
        params: { workspaceId, workflowRunId: run.id },
      });
    },
    onError: notifyError,
  });
  if (template.isPending) {
    return (
      <main className="grid min-h-svh bg-canvas lg:grid-cols-[minmax(0,1.04fr)_minmax(460px,0.96fr)]">
        <div className="min-h-[52svh]" />
        <div className="bg-paper p-8 lg:p-10">
          <Skeleton active paragraph={{ rows: 9 }} />
        </div>
      </main>
    );
  }
  if (template.isError || !template.data) {
    return (
      <main className="grid min-h-svh place-items-center bg-mist p-6">
        <PageEmptyState
          action={() => void template.refetch()}
          actionLabel={t("workflows.templateDetail.reload")}
          title={t("workflows.templateDetail.loadError")}
        >
          {t("workflows.templateDetail.loadErrorDescription")}
        </PageEmptyState>
      </main>
    );
  }

  const value = template.data;
  const historyArtifact = selectedHistoryItem?.artifact;
  let visualContent: React.JSX.Element;
  if (historyArtifact) {
    visualContent = (
      <ArtifactPreview
        alt={t("workflows.templateDetail.recentResultAlt", {
          name: value.displayName,
        })}
        artifactId={historyArtifact.artifactId}
        imageClassName="aspect-[4/3] max-h-[46svh] w-full rounded-[16px] object-contain"
        workspaceId={workspaceId}
      />
    );
  } else if (value.presentation?.cover) {
    visualContent = (
      <ArtifactPreview
        alt={value.presentation.cover.alt}
        artifactId={value.presentation.cover.artifactId}
        imageClassName="aspect-[4/3] max-h-[46svh] w-full rounded-[16px] object-contain"
        workspaceId={workspaceId}
      />
    );
  } else {
    visualContent = (
      <div className="grid justify-items-center gap-3 text-center">
        <DoodleIcon
          aspectRatio="241 / 211"
          className="h-44 w-auto text-white sm:h-52"
          source={workingIllustration}
        />
        <p className="m-0 max-w-xs text-xs leading-5 text-white/50">
          {recentRuns.isError
            ? t("workflows.templateDetail.historyUnavailable")
            : t("workflows.templateDetail.noHistory")}
        </p>
      </div>
    );
  }
  const visibleProperties = properties.filter(
    (property) => property.valueType !== "constant",
  );
  const missingRequiredInput = Boolean(
    requiredInvocationField(visibleProperties, values),
  );
  return (
    <main
      className="grid min-h-svh bg-canvas lg:max-h-svh lg:grid-cols-[minmax(0,1.04fr)_minmax(460px,0.96fr)] lg:overflow-hidden"
      id="kanvas-main-content"
    >
      <section className="flex min-h-[58svh] min-w-0 flex-col overflow-hidden bg-canvas text-white lg:min-h-svh">
        <header className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            className="inline-flex min-h-11 items-center gap-2 rounded-[12px] px-3 text-sm font-semibold text-white/75 no-underline transition-colors hover:bg-white/8 hover:text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-acid"
            params={{ workspaceId }}
            to="/w/$workspaceId/workflow-templates"
          >
            <ArrowLeftOutlined />
            {t("workflows.templateDetail.back")}
          </Link>
          <StatusTag className="px-3 py-1" tone="inverse">
            {t(`workflows.templates.status.${value.runtimeStatus}`)}
          </StatusTag>
        </header>

        <div className="grid min-h-0 flex-1 content-center gap-6 px-6 py-7 sm:px-10 lg:px-11 lg:py-9">
          <div className="mx-auto grid w-full max-w-[760px] gap-4">
            <p className="m-0 text-xs font-bold tracking-[0.1em] text-acid uppercase">
              {value.category ?? t("workflows.templateDetail.creationPlan")}
            </p>
            <h1 className="m-0 max-w-3xl text-[clamp(36px,5vw,68px)] leading-[0.98] font-bold tracking-[-0.055em]">
              {value.displayName}
            </h1>
            {value.description ? (
              <p className="m-0 max-w-2xl text-sm leading-6 text-white/65 sm:text-base sm:leading-7">
                {value.description}
              </p>
            ) : null}
          </div>

          <div className="mx-auto grid w-full max-w-[760px] gap-3">
            <div className="flex items-center justify-between gap-4">
              <strong className="text-sm text-white">
                {historyItems.length > 0
                  ? t("workflows.templateDetail.recentResults")
                  : t("workflows.templateDetail.preview")}
              </strong>
              {selectedHistoryItem ? (
                <Link
                  className="text-xs font-semibold text-white/60 no-underline hover:text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-acid"
                  params={{
                    workspaceId,
                    workflowRunId: selectedHistoryItem.id,
                  }}
                  to="/w/$workspaceId/workflow-runs/$workflowRunId"
                >
                  {t("workflows.templateDetail.openResult")}
                </Link>
              ) : null}
            </div>

            <div className="grid min-h-[280px] place-items-center overflow-hidden rounded-[22px] bg-white/5 p-5 sm:p-7">
              {visualContent}
            </div>

            {historyItems.length > 0 ? (
              <div
                aria-label={t("workflows.templateDetail.recentResults")}
                className="grid auto-cols-[116px] grid-flow-col gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                role="list"
              >
                {historyItems.map((item) => (
                  <button
                    aria-pressed={selectedHistoryItem?.id === item.id}
                    className="group grid min-h-[92px] min-w-0 content-between gap-2 overflow-hidden rounded-[12px] border border-white/10 bg-white/5 p-2 text-left text-white transition-colors hover:border-white/35 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-acid aria-pressed:border-acid aria-pressed:bg-white/10"
                    key={item.id}
                    onClick={() => setSelectedRunId(item.id)}
                    role="listitem"
                    type="button"
                  >
                    {item.artifact ? (
                      <ArtifactPreview
                        alt={t("workflows.templateDetail.historyThumbnail")}
                        artifactId={item.artifact.artifactId}
                        imageClassName="aspect-video w-full rounded-[7px] object-cover"
                        thumbnail
                        workspaceId={workspaceId}
                      />
                    ) : (
                      <span className="grid aspect-video w-full place-items-center rounded-[7px] bg-black/20 text-[10px] text-white/55">
                        {t(
                          `workflows.templateDetail.runStatus.${item.lifecycleStatus}`,
                        )}
                      </span>
                    )}
                    <span className="flex items-center gap-1 truncate text-[10px] text-white/55">
                      <ClockCircleOutlined />
                      {formatHistoryDate(item.createdAt, i18n.language)}
                    </span>
                    {item.brandName ? (
                      <span className="truncate text-[10px] font-semibold text-acid">
                        {item.brandName}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <aside className="min-w-0 overflow-y-auto bg-paper px-5 py-7 text-ink sm:px-8 sm:py-9 lg:px-10 lg:py-12">
        <div className="mx-auto grid w-full max-w-[560px] content-start gap-7">
          <header>
            <p className="m-0 text-xs font-bold tracking-[0.08em] text-primary uppercase">
              {t("workflows.templateDetail.prepare")}
            </p>
            <h2 className="mt-2 mb-0 text-[clamp(30px,4vw,46px)] leading-[1.05] font-bold tracking-[-0.045em]">
              {t("workflows.templateDetail.runTitle")}
            </h2>
            <p className="mt-3 mb-0 text-sm leading-6 text-muted">
              {t("workflows.templateDetail.prepareDescription", {
                count: visibleProperties.filter((field) => field.required)
                  .length,
              })}
            </p>
          </header>

          <section className="grid gap-2 rounded-[16px] bg-mist p-4">
            <div>
              <strong className="block text-sm text-ink">
                {t("studio.home.brandForThisWork")}
              </strong>
              <span className="mt-1 block text-xs leading-5 text-muted">
                {brandChoice.brands.isError
                  ? t("studio.home.brandUnavailable")
                  : t("workflows.templateDetail.brandChoiceDescription")}
              </span>
            </div>
            <KanvasSelect
              aria-label={t("studio.home.brandForThisWork")}
              className="w-full"
              disabled={brandChoicePending}
              loading={brandChoicePending}
              onChange={(choice: string) => {
                brandChoice.setChoice(
                  choice as Parameters<typeof brandChoice.setChoice>[0],
                );
              }}
              options={brandOptions}
              size="large"
              value={brandChoice.resolvedChoice}
            />
          </section>

          {isBrandSocialStarter && brandRevision.isError ? (
            <Alert
              description={t(
                "workflows.templateDetail.brandStarterUnavailableDescription",
              )}
              showIcon
              title={t("workflows.templateDetail.brandStarterUnavailable")}
              type="warning"
            />
          ) : null}

          <div className="grid gap-5">
            {isBrandSocialStarter ? (
              <BrandSocialStarterFieldsV1
                csrfToken={csrfToken}
                fields={visibleProperties}
                onBusyChange={(busy) => {
                  setUploadingFieldKeys((current) => {
                    const next = new Set(current);
                    if (busy) next.add("logoArtifactId");
                    else next.delete("logoArtifactId");
                    return next;
                  });
                }}
                onChange={updateInvocationValue}
                {...(brandRevision.data
                  ? { revision: brandRevision.data }
                  : {})}
                values={values}
                workspaceId={workspaceId}
              />
            ) : (
              visibleProperties.map((property, index) => (
                <label className="grid gap-2" key={property.key}>
                  <span className="flex items-center gap-2 text-sm font-bold text-ink">
                    <span className="grid size-6 place-items-center rounded-full bg-mist text-[11px] text-muted">
                      {index + 1}
                    </span>
                    {property.label}
                    {property.required ? " *" : ""}
                  </span>
                  <span className="[&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-[12px] [&_input]:border [&_input]:border-line [&_input]:bg-mist [&_input]:px-3.5 [&_input]:text-sm [&_input]:text-ink [&_input]:outline-none focus-within:[&_input]:border-primary [&_select]:min-h-11 [&_select]:w-full [&_select]:rounded-[12px] [&_select]:border [&_select]:border-line [&_select]:bg-mist [&_select]:px-3.5 [&_select]:text-sm [&_textarea]:min-h-28 [&_textarea]:w-full [&_textarea]:rounded-[12px] [&_textarea]:border [&_textarea]:border-line [&_textarea]:bg-mist [&_textarea]:p-3.5 [&_textarea]:text-sm">
                    <EffectiveInvocationFieldControl
                      csrfToken={csrfToken}
                      field={property}
                      onBusyChange={(busy) => {
                        setUploadingFieldKeys((current) => {
                          const next = new Set(current);
                          if (busy) next.add(property.key);
                          else next.delete(property.key);
                          return next;
                        });
                      }}
                      onChange={(nextValue) =>
                        updateInvocationValue(property.key, nextValue)
                      }
                      value={values[property.key]}
                      workspaceId={workspaceId}
                    />
                  </span>
                  {property.description ? (
                    <small className="text-xs leading-5 text-muted">
                      {property.description}
                    </small>
                  ) : null}
                </label>
              ))
            )}
          </div>

          {visibleProperties.length === 0 &&
          invocationSchema?.availability !== "available" ? (
            <Alert
              description={t("workflows.templateDetail.schemaUnavailable")}
              showIcon
              type="warning"
            />
          ) : null}
          {inputError ? (
            <Alert description={inputError} showIcon type="error" />
          ) : null}

          <Button
            block
            disabled={
              !canRun ||
              value.runtimeStatus !== "enabled" ||
              invocationSchema?.availability !== "available" ||
              missingRequiredInput ||
              brandChoicePending ||
              (isBrandSocialStarter &&
                Boolean(selectedBrandRevisionId) &&
                (brandRevision.isPending || brandRevision.isError)) ||
              uploadingFieldKeys.size > 0
            }
            icon={<PlayCircleOutlined />}
            loading={start.isPending}
            onClick={() => start.mutate()}
            size="large"
            type="primary"
          >
            {t("workflows.templateDetail.run")}
          </Button>
        </div>
      </aside>
    </main>
  );
}
