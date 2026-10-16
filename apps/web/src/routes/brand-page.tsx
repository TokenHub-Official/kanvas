import { ActionLink } from "../components/action-link.js";
import type {
  BrandKitColor,
  BrandKitDraft,
  BrandKitLogo,
  BrandKitReferenceImage,
  BrandKitRevision,
  BrandKitSummary,
  BrandKitTextStyle,
} from "@kanvas/contracts/api";
import {
  CheckOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  ArrowLeftOutlined,
  FontSizeOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { App as AntApp, Button, Empty, InputNumber, Modal, Spin } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  createBrandKit,
  fetchCanvasDrafts,
  fetchWorkflowRuns,
  fetchBrandKitDraft,
  fetchBrandKitRevision,
  fetchBrandKitRevisions,
  fetchBrandKits,
  fetchWorkspaceAssets,
  publishBrandKit,
  setDefaultBrandKit,
  updateBrandKitDraft,
} from "../api/transport.js";
import { PageEmptyState, PageLoading } from "../components/feedback.js";
import { ArtifactPreview } from "../components/artifact-preview.js";
import {
  BrandLogoPickerModal,
  type BrandImageSelection,
} from "../features/brand/brand-logo-picker.js";
export { BrandLogoPickerModal } from "../features/brand/brand-logo-picker.js";
import { KanvasInput, KanvasTextArea } from "../components/kanvas-input.js";
import { KanvasSelect } from "../components/kanvas-select.js";
import { StatusTag } from "../components/status-tag.js";
import { usePageQueryRecovery } from "../components/page-query-recovery.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { canvasFontCatalogV1 } from "../features/editor/font-catalog-v1.js";
import { BrandRevisionChangeSummaryV1 } from "../features/brand/brand-revision-change-summary-v1.js";
import { brandRevisionChangesV1 } from "../features/brand/brand-revision-diff-v1.js";

const brandRouteApi = getRouteApi("/w/$workspaceId/brand");
const brandRoles: readonly BrandKitColor["role"][] = [
  "primary",
  "secondary",
  "accent",
  "background",
  "surface",
  "text_primary",
  "text_secondary",
];
const logoRoles: readonly BrandKitLogo["role"][] = [
  "primary",
  "inverse",
  "icon",
];
const textStyleRoles: readonly BrandKitTextStyle["role"][] = [
  "display",
  "title",
  "subtitle",
  "body",
  "caption",
];
const DEFAULT_TITLE_FONT_SIZE = 64;
const DEFAULT_BODY_FONT_SIZE = 28;
const DEFAULT_TITLE_FONT_WEIGHT = 700;
const DEFAULT_BODY_FONT_WEIGHT = 400;
const DEFAULT_TITLE_LINE_HEIGHT = 1.1;
const DEFAULT_BODY_LINE_HEIGHT = 1.4;
const PUBLISHED_TEXT_PREVIEW_MAX_SIZE = 36;
const BRAND_USAGE_DRAFT_LIMIT = 50;
const BRAND_USAGE_RUN_LIMIT = 40;
const BRAND_USAGE_RECENT_LIMIT = 4;
const BRAND_USAGE_ASSET_LIMIT = 6;

function setTextStyleColor(
  style: BrandKitTextStyle,
  colorKey: string | undefined,
): BrandKitTextStyle {
  const next = { ...style };
  if (colorKey) next.colorKey = colorKey;
  else delete next.colorKey;
  return next;
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function BrandPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = brandRouteApi.useParams();
  const { brandKitId, returnTo } = brandRouteApi.useSearch();
  return (
    <WorkspacePage
      pageTitle={t("brand.documentTitle")}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <BrandWorkspace
          canUseAgent={workspace.permissions.includes("agent.run")}
          canManage={workspace.permissions.includes("brand.manage")}
          csrfToken={context.csrfToken}
          key={brandKitId ?? "brand-list"}
          {...(brandKitId ? { initialBrandKitId: brandKitId } : {})}
          {...(returnTo ? { returnTo } : {})}
          workspaceId={workspace.id}
        />
      )}
    </WorkspacePage>
  );
}

function BrandWorkspace({
  canUseAgent,
  canManage,
  csrfToken,
  initialBrandKitId,
  returnTo,
  workspaceId,
}: {
  readonly canUseAgent: boolean;
  readonly canManage: boolean;
  readonly csrfToken: string;
  readonly initialBrandKitId?: string;
  readonly returnTo?: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { notification } = AntApp.useApp();
  const [selectedBrandKitId, setSelectedBrandKitId] = useState<
    string | undefined
  >(initialBrandKitId);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const showBrand = (brandKitId: string): void => {
    setSelectedBrandKitId(brandKitId);
    window.scrollTo({ behavior: "auto", top: 0 });
  };
  const showBrandList = (): void => {
    setSelectedBrandKitId(undefined);
    window.scrollTo({ behavior: "auto", top: 0 });
  };
  const brands = useQuery({
    queryKey: ["brand-kits", workspaceId, "active"],
    queryFn: () => fetchBrandKits(workspaceId, { lifecycleStatus: "active" }),
    retry: false,
  });
  const recovery = usePageQueryRecovery(brands.refetch);
  const selectedSummary = brands.data?.items.find(
    (item) => item.id === selectedBrandKitId,
  );

  const createMutation = useMutation({
    mutationFn: () =>
      createBrandKit(
        { csrfToken, workspaceId },
        {
          name: createName.trim(),
          ...(createDescription.trim()
            ? { description: createDescription.trim() }
            : {}),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async (draft) => {
      queryClient.setQueryData(
        ["brand-kit-draft", workspaceId, draft.brandKitId],
        draft,
      );
      showBrand(draft.brandKitId);
      setCreateOpen(false);
      setCreateName("");
      setCreateDescription("");
      await queryClient.invalidateQueries({
        queryKey: ["brand-kits", workspaceId],
      });
    },
    onError: () => {
      notification.error({
        title: t("brand.operationError"),
        description: t("brand.operationErrorDescription"),
      });
    },
  });

  if (brands.isPending) return <PageLoading />;
  if (brands.isError) {
    return (
      <PageEmptyState
        action={recovery.retry}
        actionLabel={t("brand.reload")}
        actionPending={recovery.pending}
        title={t("brand.loadError")}
      >
        {t("common.checkConnection")}
      </PageEmptyState>
    );
  }

  const empty = brands.data.items.length === 0;
  let selectedSurface: React.JSX.Element | null = null;
  if (selectedSummary) {
    selectedSurface = canManage ? (
      <BrandDraftSurface
        canUseAgent={canUseAgent}
        csrfToken={csrfToken}
        key={`${selectedSummary.id}:${String(selectedSummary.draftVersion)}`}
        summary={selectedSummary}
        workspaceId={workspaceId}
      />
    ) : (
      <BrandPublishedSurface
        canUseAgent={canUseAgent}
        key={selectedSummary.id}
        summary={selectedSummary}
        workspaceId={workspaceId}
      />
    );
  }
  return (
    <div className="mx-auto w-full max-w-320 animate-[studio-page-in_360ms_cubic-bezier(0.16,1,0.3,1)] pb-12 motion-reduce:animate-none">
      {returnTo || (canManage && !empty) ? (
        <header className="flex flex-col gap-5 pt-1.5 pb-6 sm:flex-row sm:items-end sm:justify-end">
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {returnTo ? (
              <Button href={returnTo} icon={<ArrowLeftOutlined />} size="large">
                {t(
                  returnTo.includes("/boards/")
                    ? "brand.returnToCanvas"
                    : "agent.editor.returnSource",
                )}
              </Button>
            ) : null}
            {canManage && !empty ? (
              <Button
                icon={<PlusOutlined />}
                onClick={() => setCreateOpen(true)}
                size="large"
                type="primary"
              >
                {t("brand.newBrand")}
              </Button>
            ) : null}
          </div>
        </header>
      ) : null}

      {empty ? (
        <div className="grid min-h-92 place-items-center py-8">
          <Empty
            description={
              <span className="grid max-w-[440px] gap-2 text-center">
                <strong className="text-lg text-ink">
                  {t("brand.emptyTitle")}
                </strong>
                <span className="text-sm leading-6 text-muted">
                  {t(
                    canManage
                      ? "brand.emptyDescription"
                      : "brand.emptyReadonly",
                  )}
                </span>
              </span>
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            {canManage ? (
              <Button onClick={() => setCreateOpen(true)} type="primary">
                {t("brand.newBrand")}
              </Button>
            ) : null}
          </Empty>
        </div>
      ) : null}
      {!empty && selectedSummary ? (
        <div className="min-w-0">
          <Button
            className="mb-5"
            icon={<ArrowLeftOutlined />}
            onClick={showBrandList}
            type="text"
          >
            {t("brand.backToBrands")}
          </Button>
          {selectedSurface}
        </div>
      ) : null}
      {!empty && !selectedSummary ? (
        <div
          role="region"
          aria-label={t("brand.selectBrand")}
          className="min-w-0"
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {brands.data.items.map((item) => (
              <article
                className="flex min-h-56 flex-col rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6"
                key={item.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="m-0 truncate text-xl font-semibold tracking-[-0.02em] text-ink">
                      {item.name}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusTag
                        tone={
                          item.latestPublishedRevision ? "positive" : "warning"
                        }
                      >
                        {t(
                          item.latestPublishedRevision
                            ? "brand.available"
                            : "brand.needsSetup",
                        )}
                      </StatusTag>
                      {item.isDefault ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                          <CheckOutlined aria-hidden="true" />
                          {t("brand.default")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <p className="mt-4 mb-0 line-clamp-3 min-h-12 text-sm leading-6 text-muted">
                  {item.description || t("brand.noDescription")}
                </p>
                <p className="mt-4 mb-0 text-xs text-muted">
                  {t("brand.updatedAt", {
                    date: new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                    }).format(new Date(item.updatedAt)),
                  })}
                </p>
                <div className="mt-auto flex flex-wrap gap-2 pt-6">
                  <Button onClick={() => showBrand(item.id)}>
                    {t(canManage ? "brand.manageBrand" : "brand.viewBrand")}
                  </Button>
                  {item.latestPublishedRevision && canUseAgent ? (
                    <ActionLink
                      params={{ workspaceId }}
                      search={{
                        brandKitId: item.id,
                        brandKitRevisionId: item.latestPublishedRevision.id,
                      }}
                      to="/w/$workspaceId/agent"
                      color="primary"
                      variant="solid"
                    >
                      {t("brand.createWithBrand")}
                    </ActionLink>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <Modal
        cancelText={t("common.back")}
        confirmLoading={createMutation.isPending}
        okButtonProps={{ disabled: !createName.trim() }}
        okText={t(createMutation.isPending ? "brand.creating" : "brand.create")}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createMutation.mutate()}
        open={createOpen}
        title={t("brand.createTitle")}
      >
        <div className="grid gap-4 pt-3">
          <label className="grid gap-2 text-sm font-semibold text-ink">
            {t("brand.name")}
            <KanvasInput
              maxLength={160}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder={t("brand.namePlaceholder")}
              value={createName}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-ink">
            {t("brand.descriptionLabel")}
            <KanvasTextArea
              maxLength={500}
              onChange={(event) => setCreateDescription(event.target.value)}
              placeholder={t("brand.descriptionPlaceholder")}
              rows={3}
              value={createDescription}
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}

function BrandDraftSurface({
  canUseAgent,
  csrfToken,
  summary,
  workspaceId,
}: {
  readonly canUseAgent: boolean;
  readonly csrfToken: string;
  readonly summary: BrandKitSummary;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { notification } = AntApp.useApp();
  const draftQuery = useQuery({
    queryKey: ["brand-kit-draft", workspaceId, summary.id],
    queryFn: () => fetchBrandKitDraft(workspaceId, summary.id),
    retry: false,
  });
  if (draftQuery.isPending) return <PageLoading />;
  if (draftQuery.isError) {
    return (
      <PageEmptyState title={t("brand.loadError")}>
        {t("common.checkConnection")}
      </PageEmptyState>
    );
  }
  return (
    <BrandDraftEditor
      canUseAgent={canUseAgent}
      csrfToken={csrfToken}
      draft={draftQuery.data}
      key={draftQuery.data.draftVersion}
      notification={notification}
      summary={summary}
      workspaceId={workspaceId}
    />
  );
}

function BrandDraftEditor({
  canUseAgent,
  csrfToken,
  draft,
  notification,
  summary,
  workspaceId,
}: {
  readonly canUseAgent: boolean;
  readonly csrfToken: string;
  readonly draft: BrandKitDraft;
  readonly notification: ReturnType<typeof AntApp.useApp>["notification"];
  readonly summary: BrandKitSummary;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const queryClient = useQueryClient();
  const latestRevisionQuery = useQuery({
    queryKey: [
      "brand-kit-revision",
      workspaceId,
      draft.brandKitId,
      draft.latestPublishedRevision?.id,
    ],
    queryFn: () =>
      fetchBrandKitRevision(
        workspaceId,
        draft.brandKitId,
        draft.latestPublishedRevision!.id,
      ),
    enabled: Boolean(draft.latestPublishedRevision),
    retry: false,
  });
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description ?? "");
  const [colors, setColors] = useState<BrandKitColor[]>(() =>
    draft.colors.map((color) => ({ ...color })),
  );
  const [logos, setLogos] = useState<BrandKitLogo[]>(() =>
    draft.logos.map((logo) => ({ ...logo })),
  );
  const [referenceImages, setReferenceImages] = useState<
    BrandKitReferenceImage[]
  >(() => draft.referenceImages.map((reference) => ({ ...reference })));
  const [textStyles, setTextStyles] = useState<BrandKitTextStyle[]>(() =>
    draft.textStyles.map((style) => ({ ...style })),
  );
  const [voice, setVoice] = useState(draft.guidelines.voice ?? "");
  const [principles, setPrinciples] = useState(
    draft.guidelines.principles.join("\n"),
  );
  const [avoid, setAvoid] = useState(draft.guidelines.avoid.join("\n"));
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const normalizedColors = colors.map((color, position) => ({
    ...color,
    position,
  }));
  const normalizedDescription = description.trim();
  const normalizedLogos = logos.map((logo, position) => ({
    ...logo,
    position,
  }));
  const normalizedReferenceImages = referenceImages.map(
    (reference, position) => ({ ...reference, position }),
  );
  const normalizedTextStyles = textStyles.map((style, position) => ({
    ...style,
    position,
  }));
  const normalizedGuidelines = {
    ...(voice.trim() ? { voice: voice.trim() } : {}),
    principles: lines(principles),
    avoid: lines(avoid),
  };
  const draftChanged =
    name.trim() !== draft.name ||
    normalizedDescription !== (draft.description ?? "") ||
    JSON.stringify(normalizedColors) !== JSON.stringify(draft.colors) ||
    JSON.stringify(normalizedLogos) !== JSON.stringify(draft.logos) ||
    JSON.stringify(normalizedReferenceImages) !==
      JSON.stringify(draft.referenceImages) ||
    JSON.stringify(normalizedTextStyles) !== JSON.stringify(draft.textStyles) ||
    JSON.stringify(normalizedGuidelines) !== JSON.stringify(draft.guidelines);
  const localProjection = {
    name: name.trim(),
    ...(normalizedDescription ? { description: normalizedDescription } : {}),
    colors: normalizedColors,
    logos: normalizedLogos,
    referenceImages: normalizedReferenceImages,
    textStyles: normalizedTextStyles,
    guidelines: normalizedGuidelines,
  };
  const savedProjection = {
    name: draft.name,
    ...(draft.description ? { description: draft.description } : {}),
    colors: draft.colors,
    logos: draft.logos,
    referenceImages: draft.referenceImages,
    textStyles: draft.textStyles,
    guidelines: draft.guidelines,
  };
  const savedChanges = latestRevisionQuery.data
    ? brandRevisionChangesV1(latestRevisionQuery.data, savedProjection)
        .hasChanges
    : colors.length > 0 || logos.length > 0 || textStyles.length > 0;
  const publishChanges = latestRevisionQuery.data
    ? brandRevisionChangesV1(latestRevisionQuery.data, localProjection)
        .hasChanges
    : colors.length > 0 || logos.length > 0 || textStyles.length > 0;
  let statusKey:
    | "checking"
    | "draftReady"
    | "publishedCurrent"
    | "savedUnpublished"
    | "unavailable"
    | "unsaved" = "publishedCurrent";
  if (draftChanged) statusKey = "unsaved";
  else if (draft.latestPublishedRevision && latestRevisionQuery.isError) {
    statusKey = "unavailable";
  } else if (draft.latestPublishedRevision && latestRevisionQuery.isPending) {
    statusKey = "checking";
  } else if (!draft.latestPublishedRevision) statusKey = "draftReady";
  else if (savedChanges) statusKey = "savedUnpublished";
  const context = { csrfToken, workspaceId };
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["brand-kits", workspaceId] }),
      queryClient.invalidateQueries({
        queryKey: ["brand-kit-draft", workspaceId, draft.brandKitId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["brand-kit-revisions", workspaceId, draft.brandKitId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["brand-kit-revision", workspaceId, draft.brandKitId],
      }),
    ]);
  };
  const save = useMutation({
    mutationFn: () =>
      updateBrandKitDraft(context, draft.brandKitId, {
        expectedDraftVersion: draft.draftVersion,
        name: name.trim(),
        ...(normalizedDescription
          ? { description: normalizedDescription }
          : {}),
        colors: normalizedColors,
        logos: normalizedLogos,
        referenceImages: normalizedReferenceImages,
        textStyles: normalizedTextStyles,
        guidelines: normalizedGuidelines,
      }),
    onSuccess: async (value) => {
      queryClient.setQueryData(
        ["brand-kit-draft", workspaceId, draft.brandKitId],
        value,
      );
      notification.success({ title: t("brand.savedTitle") });
      await invalidate();
    },
    onError: () =>
      notification.error({
        title: t("brand.operationError"),
        description: t("brand.operationErrorDescription"),
      }),
  });
  const publish = useMutation({
    mutationFn: async () => {
      let expectedDraftVersion = draft.draftVersion;
      if (draftChanged) {
        const saved = await updateBrandKitDraft(context, draft.brandKitId, {
          expectedDraftVersion,
          name: name.trim(),
          ...(normalizedDescription
            ? { description: normalizedDescription }
            : {}),
          colors: normalizedColors,
          logos: normalizedLogos,
          referenceImages: normalizedReferenceImages,
          textStyles: normalizedTextStyles,
          guidelines: normalizedGuidelines,
        });
        expectedDraftVersion = saved.draftVersion;
        queryClient.setQueryData(
          ["brand-kit-draft", workspaceId, draft.brandKitId],
          saved,
        );
      }
      return publishBrandKit(
        context,
        draft.brandKitId,
        { expectedDraftVersion },
        crypto.randomUUID(),
      );
    },
    onSuccess: async () => {
      notification.success({ title: t("brand.publishedTitle") });
      await invalidate();
    },
    onError: () =>
      notification.error({
        title: t("brand.operationError"),
        description: t("brand.operationErrorDescription"),
      }),
  });
  const makeDefault = useMutation({
    mutationFn: () =>
      setDefaultBrandKit(context, draft.brandKitId, {
        expectedBrandKitVersion: summary.version,
      }),
    onSuccess: async () => {
      notification.success({ title: t("brand.defaultTitle") });
      await invalidate();
    },
    onError: () =>
      notification.error({
        title: t("brand.operationError"),
        description: t("brand.operationErrorDescription"),
      }),
  });

  const busy = save.isPending || publish.isPending || makeDefault.isPending;
  let statusTone: "neutral" | "positive" | "warning" = "warning";
  if (statusKey === "publishedCurrent") statusTone = "positive";
  else if (statusKey === "checking") statusTone = "neutral";
  let publishLabelKey = "brand.publish";
  if (publish.isPending) publishLabelKey = "brand.publishing";
  else if (draftChanged) publishLabelKey = "brand.saveAndPublish";
  const missingPublishRequirements = [
    ...(logos.length === 0 ? [t("brand.logos")] : []),
    ...(colors.length === 0 ? [t("brand.colors")] : []),
    ...(textStyles.length === 0 ? [t("brand.textStyles")] : []),
  ];
  const missingPublishRequirementList =
    missingPublishRequirements.length > 0
      ? new Intl.ListFormat(i18n.resolvedLanguage ?? i18n.language, {
          style: "long",
          type: "conjunction",
        }).format(missingPublishRequirements)
      : undefined;
  function saveDraft(): void {
    save.mutate();
  }
  function publishDraft(): void {
    publish.mutate();
  }
  function closeLogoPicker(): void {
    setLogoPickerOpen(false);
  }
  function selectLogo(asset: BrandImageSelection): void {
    const artifact = asset.currentArtifact;
    if (!artifact) return;
    setLogos((current) => [
      ...current,
      {
        key: `logo.custom-${crypto.randomUUID()}`,
        name: asset.name,
        role: current.length === 0 ? "primary" : "icon",
        assetId: asset.id,
        artifactId: artifact.id,
        position: current.length,
      },
    ]);
    closeLogoPicker();
  }
  function closeReferencePicker(): void {
    setReferencePickerOpen(false);
  }
  function selectReferenceImage(asset: BrandImageSelection): void {
    const artifact = asset.currentArtifact;
    if (!artifact) return;
    setReferenceImages((current) => [
      ...current,
      {
        key: `reference.custom-${crypto.randomUUID()}`,
        name: asset.name,
        assetId: asset.id,
        artifactId: artifact.id,
        position: current.length,
      },
    ]);
    closeReferencePicker();
  }
  return (
    <div className="grid max-w-[1120px] gap-5">
      <section className="grid gap-5 rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="grid min-w-0 flex-1 gap-4">
            <label className="grid max-w-180 gap-2 text-sm font-semibold text-ink">
              {t("brand.name")}
              <KanvasInput
                aria-label={t("brand.name")}
                maxLength={160}
                onChange={(event) => setName(event.target.value)}
                size="large"
                value={name}
              />
            </label>
            <label className="grid max-w-180 gap-2 text-sm font-semibold text-ink">
              {t("brand.descriptionLabel")}
              <KanvasTextArea
                aria-label={t("brand.descriptionLabel")}
                autoSize={{ minRows: 2, maxRows: 4 }}
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("brand.descriptionPlaceholder")}
                value={description}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusTag tone={statusTone}>
              {t(`brand.status.${statusKey}`)}
            </StatusTag>
            {summary.isDefault ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <CheckOutlined aria-hidden="true" />
                {t("brand.default")}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-5">
          {!summary.isDefault && summary.latestPublishedRevision ? (
            <Button
              disabled={busy}
              loading={makeDefault.isPending}
              onClick={() => makeDefault.mutate()}
            >
              {t(
                makeDefault.isPending
                  ? "brand.settingDefault"
                  : "brand.setDefault",
              )}
            </Button>
          ) : null}
          {summary.latestPublishedRevision && canUseAgent ? (
            <ActionLink
              params={{ workspaceId }}
              search={{
                brandKitId: summary.id,
                brandKitRevisionId: summary.latestPublishedRevision.id,
              }}
              to="/w/$workspaceId/agent"
              color="primary"
              variant="solid"
            >
              {t("brand.createWithBrand")}
            </ActionLink>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="brand-foundations-title" className="grid gap-5">
        <div className="pt-2">
          <h2
            className="m-0 text-2xl font-semibold tracking-[-0.025em]"
            id="brand-foundations-title"
          >
            {t("brand.foundations")}
          </h2>
          <p className="m-0 mt-1.5 max-w-170 text-ui-body text-muted">
            {t("brand.foundationsDescription")}
          </p>
        </div>
        <div className="grid gap-4 rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
                {t("brand.logos")}
              </h3>
              <p className="m-0 mt-1 text-ui-body text-muted">
                {t("brand.logosDescription")}
              </p>
            </div>
            <Button
              icon={<PlusOutlined />}
              onClick={() => setLogoPickerOpen(true)}
            >
              {t("brand.addLogo")}
            </Button>
          </div>
          {logos.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {logos.map((logo, index) => (
                <article
                  className="grid min-w-0 gap-3 rounded-[16px] bg-mist p-3"
                  key={logo.key}
                >
                  <div className="relative grid aspect-[3/2] place-items-center overflow-hidden rounded-xl bg-paper">
                    <ArtifactPreview
                      alt={logo.name}
                      artifactId={logo.artifactId}
                      imageClassName="absolute inset-0 size-full object-contain p-5"
                      thumbnail
                      workspaceId={workspaceId}
                    />
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_120px_36px] items-center gap-2">
                    <KanvasInput
                      aria-label={t("brand.logoName")}
                      onChange={(event) =>
                        setLogos((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                      value={logo.name}
                    />
                    <KanvasSelect
                      aria-label={t("brand.logoRole")}
                      onChange={(role: BrandKitLogo["role"]) =>
                        setLogos((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, role } : item,
                          ),
                        )
                      }
                      options={logoRoles.map((role) => ({
                        label: t(`brand.logoRoles.${role}`),
                        value: role,
                      }))}
                      value={logo.role}
                    />
                    <Button
                      aria-label={t("brand.removeLogo", { name: logo.name })}
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        setLogos((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      type="text"
                    />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="grid min-h-32 place-items-center rounded-[14px] bg-mist text-ui-body text-muted">
              {t("brand.logoEmpty")}
            </div>
          )}
        </div>
        <div className="grid gap-4 rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
                {t("brand.referenceImages")}
              </h3>
              <p className="m-0 mt-1 text-ui-body text-muted">
                {t("brand.referenceImagesDescription")}
              </p>
            </div>
            <Button
              icon={<PlusOutlined />}
              onClick={() => setReferencePickerOpen(true)}
            >
              {t("brand.addReferenceImage")}
            </Button>
          </div>
          {referenceImages.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {referenceImages.map((reference, index) => (
                <article
                  className="grid min-w-0 gap-3 rounded-[16px] bg-mist p-3"
                  key={reference.key}
                >
                  <div className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-xl bg-paper">
                    <ArtifactPreview
                      alt={reference.name}
                      artifactId={reference.artifactId}
                      imageClassName="absolute inset-0 size-full object-cover"
                      thumbnail
                      workspaceId={workspaceId}
                    />
                  </div>
                  <KanvasInput
                    aria-label={t("brand.referenceImageName")}
                    onChange={(event) =>
                      setReferenceImages((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      )
                    }
                    value={reference.name}
                  />
                  <div className="grid grid-cols-[minmax(0,1fr)_36px] gap-2">
                    <KanvasInput
                      aria-label={t("brand.referenceImageDescription")}
                      onChange={(event) =>
                        setReferenceImages((current) =>
                          current.map((item, itemIndex) => {
                            if (itemIndex !== index) return item;
                            const next = { ...item };
                            if (event.target.value.trim()) {
                              next.description = event.target.value;
                            } else delete next.description;
                            return next;
                          }),
                        )
                      }
                      placeholder={t(
                        "brand.referenceImageDescriptionPlaceholder",
                      )}
                      value={reference.description ?? ""}
                    />
                    <Button
                      aria-label={t("brand.removeReferenceImage", {
                        name: reference.name,
                      })}
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        setReferenceImages((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      type="text"
                    />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="grid min-h-32 place-items-center rounded-[14px] bg-mist text-ui-body text-muted">
              {t("brand.referenceImageEmpty")}
            </div>
          )}
        </div>
        <div className="grid gap-4 rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
                {t("brand.colors")}
              </h3>
              <p className="m-0 mt-1 text-ui-body text-muted">
                {t("brand.colorsDescription")}
              </p>
            </div>
            <Button
              icon={<PlusOutlined />}
              onClick={() =>
                setColors((current) => [
                  ...current,
                  {
                    key: `color.custom-${crypto.randomUUID()}`,
                    name: t("brand.roles.accent"),
                    role: "accent",
                    value: "#3048F5",
                    position: current.length,
                  },
                ])
              }
            >
              {t("brand.addColor")}
            </Button>
          </div>
          <div className="grid gap-2">
            {colors.map((color, index) => (
              <div
                className="grid grid-cols-[52px_minmax(0,1fr)] gap-3 rounded-[14px] bg-mist p-3 md:grid-cols-[52px_minmax(140px,1fr)_180px_150px_36px] md:items-center"
                key={color.key}
              >
                <span
                  aria-hidden="true"
                  className="size-11 rounded-xl shadow-[inset_0_0_0_1px_rgb(21_21_21_/_8%)]"
                  style={{ backgroundColor: color.value }}
                />
                <KanvasInput
                  aria-label={t("brand.colorName")}
                  onChange={(event) =>
                    setColors((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    )
                  }
                  value={color.name}
                />
                <KanvasSelect
                  aria-label={t("brand.colorRole")}
                  onChange={(role: BrandKitColor["role"]) =>
                    setColors((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, role } : item,
                      ),
                    )
                  }
                  options={brandRoles.map((role) => ({
                    label: t(`brand.roles.${role}`),
                    value: role,
                  }))}
                  value={color.role}
                />
                <KanvasInput
                  aria-label={t("brand.colorValue")}
                  maxLength={9}
                  onChange={(event) =>
                    setColors((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, value: event.target.value.toUpperCase() }
                          : item,
                      ),
                    )
                  }
                  value={color.value}
                />
                <Button
                  aria-label={t("brand.removeColor", { name: color.name })}
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    setColors((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  type="text"
                />
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-4 rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
                {t("brand.textStyles")}
              </h3>
              <p className="m-0 mt-1 text-ui-body text-muted">
                {t("brand.textStylesDescription")}
              </p>
            </div>
            <Button
              icon={<FontSizeOutlined />}
              onClick={() => {
                const font = canvasFontCatalogV1[0];
                const role: BrandKitTextStyle["role"] =
                  textStyles.length === 0 ? "title" : "body";
                setTextStyles((current) => [
                  ...current,
                  {
                    key: `text.custom-${crypto.randomUUID()}`,
                    name: t(`brand.textStyleRoles.${role}`),
                    role,
                    fontId: font.id,
                    fontRevision: font.revision,
                    fontFamily: font.family,
                    fontSize:
                      role === "title"
                        ? DEFAULT_TITLE_FONT_SIZE
                        : DEFAULT_BODY_FONT_SIZE,
                    fontWeight:
                      role === "title"
                        ? DEFAULT_TITLE_FONT_WEIGHT
                        : DEFAULT_BODY_FONT_WEIGHT,
                    lineHeight:
                      role === "title"
                        ? DEFAULT_TITLE_LINE_HEIGHT
                        : DEFAULT_BODY_LINE_HEIGHT,
                    letterSpacing: 0,
                    ...(colors[0] ? { colorKey: colors[0].key } : {}),
                    position: current.length,
                  },
                ]);
              }}
            >
              {t("brand.addTextStyle")}
            </Button>
          </div>
          <div className="grid gap-2">
            {textStyles.map((style, index) => (
              <div
                className="grid gap-3 rounded-[14px] bg-mist p-3 xl:grid-cols-[minmax(150px,1fr)_140px_190px_100px_100px_36px] xl:items-center"
                key={style.key}
              >
                <KanvasInput
                  aria-label={t("brand.textStyleName")}
                  onChange={(event) =>
                    setTextStyles((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    )
                  }
                  value={style.name}
                />
                <KanvasSelect
                  aria-label={t("brand.textStyleRole")}
                  onChange={(role: BrandKitTextStyle["role"]) =>
                    setTextStyles((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, role } : item,
                      ),
                    )
                  }
                  options={textStyleRoles.map((role) => ({
                    label: t(`brand.textStyleRoles.${role}`),
                    value: role,
                  }))}
                  value={style.role}
                />
                <KanvasSelect
                  aria-label={t("brand.font")}
                  onChange={(fontId: string) => {
                    const font = canvasFontCatalogV1.find(
                      (candidate) => candidate.id === fontId,
                    );
                    if (!font) return;
                    setTextStyles((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              fontId: font.id,
                              fontRevision: font.revision,
                              fontFamily: font.family,
                              fontWeight: font.weights.includes(item.fontWeight)
                                ? item.fontWeight
                                : (font.weights.at(-1) ??
                                  DEFAULT_BODY_FONT_WEIGHT),
                            }
                          : item,
                      ),
                    );
                  }}
                  options={canvasFontCatalogV1.map((font) => ({
                    label: font.label,
                    value: font.id,
                  }))}
                  value={style.fontId}
                />
                <InputNumber
                  aria-label={t("brand.fontSize")}
                  max={512}
                  min={6}
                  onChange={(fontSize) => {
                    if (fontSize === null) return;
                    setTextStyles((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, fontSize } : item,
                      ),
                    );
                  }}
                  value={style.fontSize}
                />
                <KanvasSelect
                  aria-label={t("brand.textColor")}
                  allowClear
                  onChange={(colorKey: string | undefined) =>
                    setTextStyles((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? setTextStyleColor(item, colorKey)
                          : item,
                      ),
                    )
                  }
                  options={colors.map((color) => ({
                    label: color.name,
                    value: color.key,
                  }))}
                  value={style.colorKey}
                  variant="filled"
                />
                <Button
                  aria-label={t("brand.removeTextStyle", {
                    name: style.name,
                  })}
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    setTextStyles((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  type="text"
                />
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-4 rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6">
          <div>
            <h3 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
              {t("brand.guidelines")}
            </h3>
            <p className="m-0 mt-1 text-ui-body text-muted">
              {t("brand.guidelinesDescription")}
            </p>
          </div>
          <label className="grid gap-2 text-sm font-semibold text-ink">
            {t("brand.voice")}
            <KanvasTextArea
              maxLength={1000}
              onChange={(event) => setVoice(event.target.value)}
              placeholder={t("brand.voicePlaceholder")}
              rows={3}
              value={voice}
            />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold text-ink">
              {t("brand.principles")}
              <KanvasTextArea
                onChange={(event) => setPrinciples(event.target.value)}
                placeholder={t("brand.principlesPlaceholder")}
                rows={5}
                value={principles}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-ink">
              {t("brand.avoid")}
              <KanvasTextArea
                onChange={(event) => setAvoid(event.target.value)}
                placeholder={t("brand.avoidPlaceholder")}
                rows={5}
                value={avoid}
              />
            </label>
          </div>
        </div>
      </section>
      <BrandVersionHistory
        brandKitId={draft.brandKitId}
        workspaceId={workspaceId}
      />
      <BrandUsageSurface
        brandKitId={draft.brandKitId}
        logos={logos}
        workspaceId={workspaceId}
      />
      {statusKey === "draftReady" ||
      statusKey === "savedUnpublished" ||
      statusKey === "unsaved" ? (
        <div className="sticky bottom-3 z-20 flex flex-col gap-3 rounded-[14px] bg-paper px-4 py-3 [box-shadow:var(--shadow-overlay-control)] sm:flex-row sm:items-center sm:justify-between">
          <div aria-live="polite" className="min-w-0">
            <strong className="block text-ui-body font-semibold text-ink">
              {t(`brand.status.${statusKey}`)}
            </strong>
            <span className="block text-ui-label text-muted">
              {t(`brand.statusDescriptions.${statusKey}`)}
            </span>
            {missingPublishRequirementList ? (
              <span className="mt-1 block text-ui-label font-medium text-warning">
                {t("brand.publishMissingRequirements", {
                  requirements: missingPublishRequirementList,
                })}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              disabled={busy || !name.trim() || !draftChanged}
              loading={save.isPending}
              onClick={saveDraft}
            >
              {t(save.isPending ? "brand.saving" : "brand.save")}
            </Button>
            <Button
              disabled={
                busy ||
                (Boolean(draft.latestPublishedRevision) &&
                  (latestRevisionQuery.isPending ||
                    latestRevisionQuery.isError)) ||
                !publishChanges ||
                missingPublishRequirements.length > 0
              }
              loading={publish.isPending}
              onClick={publishDraft}
              type="primary"
            >
              {t(publishLabelKey)}
            </Button>
          </div>
        </div>
      ) : null}
      <BrandLogoPickerModal
        applyLabel={t("brand.addLogo")}
        onCancel={closeLogoPicker}
        onSelect={selectLogo}
        open={logoPickerOpen}
        workspaceId={workspaceId}
      />
      <BrandLogoPickerModal
        applyLabel={t("brand.addReferenceImage")}
        onCancel={closeReferencePicker}
        onSelect={selectReferenceImage}
        open={referencePickerOpen}
        title={t("brand.selectReferenceImage")}
        workspaceId={workspaceId}
      />
    </div>
  );
}

function BrandVersionHistory({
  brandKitId,
  workspaceId,
}: {
  readonly brandKitId: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>();
  const revisions = useQuery({
    queryKey: ["brand-kit-revisions", workspaceId, brandKitId],
    queryFn: () => fetchBrandKitRevisions(workspaceId, brandKitId),
    retry: false,
  });
  const selectedIndex =
    revisions.data?.items.findIndex((item) => item.id === selectedRevisionId) ??
    -1;
  const selectedSummary =
    selectedIndex >= 0 ? revisions.data?.items[selectedIndex] : undefined;
  const previousSummary =
    selectedIndex >= 0 ? revisions.data?.items[selectedIndex + 1] : undefined;
  const selectedRevision = useQuery({
    queryKey: selectedSummary
      ? ["brand-kit-revision", workspaceId, brandKitId, selectedSummary.id]
      : ["brand-kit-revision", workspaceId, brandKitId, "selected"],
    queryFn: () =>
      fetchBrandKitRevision(workspaceId, brandKitId, selectedSummary!.id),
    enabled: Boolean(selectedSummary),
    retry: false,
  });
  const previousRevision = useQuery({
    queryKey: previousSummary
      ? ["brand-kit-revision", workspaceId, brandKitId, previousSummary.id]
      : ["brand-kit-revision", workspaceId, brandKitId, "previous"],
    queryFn: () =>
      fetchBrandKitRevision(workspaceId, brandKitId, previousSummary!.id),
    enabled: Boolean(previousSummary),
    retry: false,
  });
  const changes =
    selectedRevision.data && previousRevision.data
      ? brandRevisionChangesV1(previousRevision.data, selectedRevision.data)
      : undefined;
  return (
    <section className="grid gap-4 rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6">
      <div>
        <h2 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
          {t("brand.versionHistory")}
        </h2>
        <p className="m-0 mt-1 text-ui-body text-muted">
          {t("brand.versionHistoryDescription")}
        </p>
      </div>
      {revisions.isPending ? <Spin size="small" /> : null}
      {revisions.data?.items.length === 0 ? (
        <Empty description={t("brand.noPublishedVersions")} />
      ) : null}
      <div className="divide-y divide-line overflow-hidden rounded-[14px] bg-mist">
        {revisions.data?.items.map((item, index) => (
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3"
            key={item.id}
          >
            <div className="flex min-w-0 items-center gap-3">
              <ClockCircleOutlined className="text-muted" />
              <div>
                <strong className="block text-sm">
                  {t("brand.updateRecord")}
                </strong>
                <time
                  className="text-xs text-muted"
                  dateTime={item.publishedAt}
                >
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(item.publishedAt))}
                </time>
              </div>
              {index === 0 ? (
                <StatusTag tone="info">{t("brand.current")}</StatusTag>
              ) : null}
            </div>
            <Button onClick={() => setSelectedRevisionId(item.id)} size="small">
              {t("brand.reviewVersion")}
            </Button>
          </div>
        ))}
      </div>
      <Modal
        footer={null}
        onCancel={() => setSelectedRevisionId(undefined)}
        open={Boolean(selectedSummary)}
        title={selectedSummary ? t("brand.updateDetails") : undefined}
      >
        <div className="grid gap-4 py-2">
          {selectedRevision.isPending || previousRevision.isPending ? (
            <Spin size="small" />
          ) : null}
          {!previousSummary && selectedRevision.data ? (
            <p className="m-0 text-sm text-muted">
              {t("brand.firstVersionDescription")}
            </p>
          ) : null}
          {changes ? <BrandRevisionChangeSummaryV1 changes={changes} /> : null}
        </div>
      </Modal>
    </section>
  );
}

function BrandUsageSurface({
  brandKitId,
  logos,
  workspaceId,
}: {
  readonly brandKitId: string;
  readonly logos: readonly BrandKitLogo[];
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const drafts = useQuery({
    queryKey: ["canvas-drafts", workspaceId, "brand", brandKitId],
    queryFn: () => fetchCanvasDrafts(workspaceId, BRAND_USAGE_DRAFT_LIMIT),
    retry: false,
    staleTime: 30_000,
  });
  const runs = useQuery({
    queryKey: ["workflow-runs", workspaceId, "brand", brandKitId],
    queryFn: () =>
      fetchWorkflowRuns(workspaceId, { limit: BRAND_USAGE_RUN_LIMIT }),
    retry: false,
    staleTime: 30_000,
  });
  const assets = useQuery({
    queryKey: ["workspace-assets", workspaceId, "brand", brandKitId],
    queryFn: () =>
      fetchWorkspaceAssets(workspaceId, {
        lifecycleStatus: "active",
        limit: "40",
      }),
    retry: false,
    staleTime: 30_000,
  });
  const recent = [
    ...(drafts.data?.items ?? [])
      .filter((draft) => draft.brand?.brandKitId === brandKitId)
      .map((draft) => ({
        id: draft.id,
        kind: "canvas" as const,
        name: draft.title,
        occurredAt: draft.updatedAt,
      })),
    ...(runs.data?.items ?? [])
      .filter((run) => run.brand?.brandKitId === brandKitId)
      .map((run) => ({
        id: run.id,
        kind: "workflow" as const,
        name: run.displayName,
        occurredAt: run.completedAt ?? run.createdAt,
      })),
  ]
    .toSorted(
      (left, right) =>
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, BRAND_USAGE_RECENT_LIMIT);
  const logoAssetIds = new Set(logos.map((logo) => logo.assetId));
  const relatedAssets = [
    ...(assets.data?.items ?? [])
      .filter(
        (asset) =>
          asset.currentArtifact?.brand?.brandKitId === brandKitId &&
          !logoAssetIds.has(asset.id),
      )
      .slice(0, BRAND_USAGE_ASSET_LIMIT)
      .map((asset) => ({
        key: `asset:${asset.id}`,
        assetId: asset.id,
        artifactId: asset.currentArtifact!.id,
        name: asset.name,
        kind: "result" as const,
      })),
    ...logos.map((logo) => ({
      key: `logo:${logo.key}`,
      assetId: logo.assetId,
      artifactId: logo.artifactId,
      name: logo.name,
      kind: "logo" as const,
    })),
  ];
  return (
    <section className="grid gap-4 rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6">
      <div>
        <h2 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
          {t("brand.usageTitle")}
        </h2>
        <p className="m-0 mt-1 text-ui-body text-muted">
          {t("brand.usageDescription")}
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="m-0 mb-3 text-sm font-semibold text-ink">
            {t("brand.recentWork")}
          </h3>
          {recent.length > 0 ? (
            <div className="divide-y divide-line overflow-hidden rounded-[14px] bg-mist">
              {recent.map((item) => (
                <Link
                  className="flex items-center justify-between gap-3 px-3.5 py-3 text-sm text-ink no-underline hover:bg-mist-deep focus-visible:outline-3 focus-visible:outline-primary"
                  key={`${item.kind}:${item.id}`}
                  params={
                    item.kind === "canvas"
                      ? { workspaceId, canvasDraftId: item.id }
                      : { workspaceId, workflowRunId: item.id }
                  }
                  {...(item.kind === "canvas"
                    ? {
                        search: { importImage: false },
                        to: "/w/$workspaceId/boards/$canvasDraftId" as const,
                      }
                    : {
                        to: "/w/$workspaceId/workflow-runs/$workflowRunId" as const,
                      })}
                >
                  <span className="min-w-0">
                    <strong className="block truncate">{item.name}</strong>
                    <span className="text-xs font-normal text-muted">
                      {t(
                        item.kind === "canvas"
                          ? "brand.canvasWork"
                          : "brand.workflowWork",
                      )}
                    </span>
                  </span>
                  <time
                    className="shrink-0 text-xs text-muted"
                    dateTime={item.occurredAt}
                  >
                    {new Intl.DateTimeFormat(undefined, {
                      month: "short",
                      day: "numeric",
                    }).format(new Date(item.occurredAt))}
                  </time>
                </Link>
              ))}
            </div>
          ) : (
            <p className="m-0 rounded-[14px] bg-mist px-3.5 py-4 text-sm text-muted">
              {drafts.isPending || runs.isPending
                ? t("brand.usageLoading")
                : t("brand.noRecentWork")}
            </p>
          )}
        </div>
        <div>
          <h3 className="m-0 mb-3 text-sm font-semibold text-ink">
            {t("brand.relatedAssets")}
          </h3>
          {relatedAssets.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {relatedAssets.map((asset) => (
                <Link
                  className="grid gap-2 rounded-[14px] bg-mist p-2 text-ink no-underline hover:bg-mist-deep focus-visible:outline-3 focus-visible:outline-primary"
                  key={asset.key}
                  params={{ workspaceId, assetId: asset.assetId }}
                  to="/w/$workspaceId/assets/$assetId"
                >
                  <span className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[10px] bg-paper">
                    <ArtifactPreview
                      alt=""
                      artifactId={asset.artifactId}
                      imageClassName="absolute inset-0 size-full object-contain p-2"
                      thumbnail
                      workspaceId={workspaceId}
                    />
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-xs">
                      {asset.name}
                    </strong>
                    <span className="text-[10px] text-muted">
                      {t(
                        asset.kind === "logo"
                          ? "brand.logoAsset"
                          : "brand.resultAsset",
                      )}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="m-0 rounded-[14px] bg-mist px-3.5 py-4 text-sm text-muted">
              {assets.isPending
                ? t("brand.usageLoading")
                : t("brand.noRelatedAssets")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function BrandPublishedSurface({
  canUseAgent,
  summary,
  workspaceId,
}: {
  readonly canUseAgent: boolean;
  readonly summary: BrandKitSummary;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const revision = useQuery({
    queryKey: [
      "brand-kit-revision",
      workspaceId,
      summary.id,
      summary.latestPublishedRevision?.id,
    ],
    queryFn: () =>
      fetchBrandKitRevision(
        workspaceId,
        summary.id,
        summary.latestPublishedRevision!.id,
      ),
    enabled: Boolean(summary.latestPublishedRevision),
    retry: false,
  });
  if (!summary.latestPublishedRevision) {
    return <Empty description={t("brand.emptyReadonly")} />;
  }
  if (revision.isPending) return <PageLoading />;
  if (revision.isError) {
    return (
      <PageEmptyState title={t("brand.loadError")}>
        {t("common.checkConnection")}
      </PageEmptyState>
    );
  }
  return (
    <div className="grid gap-9">
      <PublishedBrandContent
        canUseAgent={canUseAgent}
        revision={revision.data}
        workspaceId={workspaceId}
      />
      <BrandVersionHistory brandKitId={summary.id} workspaceId={workspaceId} />
      <BrandUsageSurface
        brandKitId={summary.id}
        logos={revision.data.logos}
        workspaceId={workspaceId}
      />
    </div>
  );
}

function PublishedBrandContent({
  canUseAgent,
  revision,
  workspaceId,
}: {
  readonly canUseAgent: boolean;
  readonly revision: BrandKitRevision;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="grid max-w-[1120px] gap-5">
      <header className="rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6">
        <h2 className="m-0 text-2xl font-semibold tracking-[-0.025em]">
          {revision.name}
        </h2>
        {revision.description ? (
          <p className="mt-2 mb-0 max-w-180 text-sm leading-6 text-muted">
            {revision.description}
          </p>
        ) : null}
        <StatusTag className="mt-2" tone="positive">
          {t("brand.available")}
        </StatusTag>
        {canUseAgent ? (
          <ActionLink
            params={{ workspaceId }}
            search={{
              brandKitId: revision.brandKitId,
              brandKitRevisionId: revision.id,
            }}
            to="/w/$workspaceId/agent"
            className="mt-4"
            color="primary"
            variant="solid"
          >
            {t("brand.createWithBrand")}
          </ActionLink>
        ) : null}
      </header>
      <section className="grid gap-4 rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6">
        <h3 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
          {t("brand.logos")}
        </h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {revision.logos.map((logo) => (
            <div
              className="grid gap-2 rounded-[16px] bg-mist p-3"
              key={logo.key}
            >
              <div className="relative grid aspect-[3/2] place-items-center overflow-hidden rounded-xl bg-paper">
                <ArtifactPreview
                  alt={logo.name}
                  artifactId={logo.artifactId}
                  imageClassName="absolute inset-0 size-full object-contain p-5"
                  thumbnail
                  workspaceId={workspaceId}
                />
              </div>
              <strong className="text-sm">{logo.name}</strong>
              <span className="text-xs text-muted">
                {t(`brand.logoRoles.${logo.role}`)}
              </span>
            </div>
          ))}
        </div>
      </section>
      {revision.referenceImages.length > 0 ? (
        <section className="grid gap-4 rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6">
          <h3 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
            {t("brand.referenceImages")}
          </h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {revision.referenceImages.map((reference) => (
              <div
                className="grid gap-2 rounded-[16px] bg-mist p-3"
                key={reference.key}
              >
                <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-paper">
                  <ArtifactPreview
                    alt={reference.name}
                    artifactId={reference.artifactId}
                    imageClassName="absolute inset-0 size-full object-cover"
                    thumbnail
                    workspaceId={workspaceId}
                  />
                </div>
                <strong className="text-sm">{reference.name}</strong>
                {reference.description ? (
                  <span className="text-xs text-muted">
                    {reference.description}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section className="grid gap-4 rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6">
        <h3 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
          {t("brand.colors")}
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-4">
          {revision.colors.map((color) => (
            <div
              className="grid gap-2 rounded-[14px] bg-mist p-3"
              key={color.key}
            >
              <div
                className="h-24 rounded-xl shadow-[inset_0_0_0_1px_rgb(21_21_21_/_8%)]"
                style={{ backgroundColor: color.value }}
              />
              <strong className="text-sm">{color.name}</strong>
              <span className="text-xs text-muted">{color.value}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="grid gap-4 rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6">
        <h3 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
          {t("brand.textStyles")}
        </h3>
        <div className="grid gap-2">
          {revision.textStyles.map((style) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 rounded-[12px] bg-mist px-3.5 py-3"
              key={style.key}
            >
              <span
                className="truncate"
                style={{
                  fontFamily: style.fontFamily,
                  fontSize: `${String(
                    Math.min(style.fontSize, PUBLISHED_TEXT_PREVIEW_MAX_SIZE),
                  )}px`,
                  fontWeight: style.fontWeight,
                }}
              >
                {style.name}
              </span>
              <small className="text-muted">
                {style.fontFamily} · {String(style.fontSize)}
              </small>
            </div>
          ))}
        </div>
      </section>
      <section className="grid gap-4 rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6">
        <h3 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
          {t("brand.guidelines")}
        </h3>
        {revision.guidelines.voice ? (
          <p className="m-0 max-w-[70ch] text-sm leading-6 text-muted">
            {revision.guidelines.voice}
          </p>
        ) : null}
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <strong className="text-sm">{t("brand.principles")}</strong>
            <ul className="mt-2 grid gap-1 pl-5 text-sm leading-6 text-muted">
              {revision.guidelines.principles.map((principle) => (
                <li key={principle}>{principle}</li>
              ))}
            </ul>
          </div>
          <div>
            <strong className="text-sm">{t("brand.avoid")}</strong>
            <ul className="mt-2 grid gap-1 pl-5 text-sm leading-6 text-muted">
              {revision.guidelines.avoid.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
