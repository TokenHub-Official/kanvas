import type {
  BrandKitLogo,
  BrandKitSummary,
  BrandKitTextStyle,
  CanvasBrandContext,
} from "@kanvas/contracts/api";
import { BgColorsOutlined, SettingOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { App as AntApp, Button, Modal, Spin } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiProblem,
  fetchBrandKitRevision,
  fetchBrandKits,
} from "../../api/transport.js";
import { httpStatus } from "../../api/http-status.js";
import { ArtifactPreview } from "../../components/artifact-preview.js";
import { KanvasSelect } from "../../components/kanvas-select.js";
import { StatusTag } from "../../components/status-tag.js";
import { BrandRevisionChangeSummaryV1 } from "../brand/brand-revision-change-summary-v1.js";
import { brandRevisionChangesV1 } from "../brand/brand-revision-diff-v1.js";
import { CanvasPanelSection } from "./canvas-left-panel-shared-v1.js";

const BRAND_TEXT_PREVIEW_MAX_SIZE = 24;

const noInsertLogo = (): Promise<void> => Promise.resolve();
const noInsertTextStyle = (): void => undefined;

export function CanvasBrandPanelV1({
  brand,
  canEdit,
  canManage,
  onAdoptBrandRevision,
  onApplyColor,
  colorTarget,
  onInsertLogo = noInsertLogo,
  onInsertTextStyle = noInsertTextStyle,
  workspaceId,
}: {
  readonly brand?: CanvasBrandContext;
  readonly canEdit: boolean;
  readonly canManage: boolean;
  readonly onAdoptBrandRevision: (brandKitRevisionId: string) => Promise<void>;
  readonly onApplyColor: (color: string) => void;
  readonly colorTarget: "page" | "shape" | "text";
  readonly onInsertLogo?: (logo: BrandKitLogo) => Promise<void>;
  readonly onInsertTextStyle?: (
    style: BrandKitTextStyle,
    color: string,
  ) => void;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [pendingTarget, setPendingTarget] = useState<BrandKitSummary>();
  const revision = useQuery({
    queryKey: [
      "brand-kit-revision",
      workspaceId,
      brand?.brandKitId,
      brand?.brandKitRevisionId,
    ],
    queryFn: () =>
      fetchBrandKitRevision(
        workspaceId,
        brand!.brandKitId,
        brand!.brandKitRevisionId,
      ),
    enabled: Boolean(brand),
    retry: false,
    staleTime: 30_000,
  });
  const brands = useQuery({
    queryKey: ["brand-kits", workspaceId, "active"],
    queryFn: () => fetchBrandKits(workspaceId, { lifecycleStatus: "active" }),
    retry: false,
    staleTime: 30_000,
  });
  const latestRevision = brand
    ? brands.data?.items.find((item) => item.id === brand.brandKitId)
        ?.latestPublishedRevision
    : undefined;
  const updateAvailable = Boolean(
    brand && latestRevision && latestRevision.id !== brand.brandKitRevisionId,
  );
  const targetRevision = useQuery({
    queryKey: pendingTarget?.latestPublishedRevision
      ? [
          "brand-kit-revision",
          workspaceId,
          pendingTarget.id,
          pendingTarget.latestPublishedRevision.id,
        ]
      : ["brand-kit-revision", workspaceId, "pending"],
    queryFn: () =>
      fetchBrandKitRevision(
        workspaceId,
        pendingTarget!.id,
        pendingTarget!.latestPublishedRevision!.id,
      ),
    enabled: Boolean(pendingTarget?.latestPublishedRevision),
    retry: false,
  });
  const adopt = useMutation({
    mutationFn: async () => {
      if (!pendingTarget?.latestPublishedRevision) return;
      await onAdoptBrandRevision(pendingTarget.latestPublishedRevision.id);
    },
    onSuccess: () => setPendingTarget(undefined),
  });
  const colorsByKey = new Map(
    revision.data?.colors.map((color) => [color.key, color.value]) ?? [],
  );
  const publishedBrands =
    brands.data?.items.filter((item) => item.latestPublishedRevision) ?? [];
  const pendingChanges =
    revision.data && targetRevision.data
      ? brandRevisionChangesV1(revision.data, targetRevision.data)
      : undefined;
  const returnTo =
    typeof window === "undefined"
      ? undefined
      : `${window.location.pathname}${window.location.search}`;
  const selectBrandForSwitch = (brandKitId: string): void => {
    const selectedBrand = publishedBrands.find(
      (item) => item.id === brandKitId,
    );
    if (
      selectedBrand?.latestPublishedRevision?.id !== brand?.brandKitRevisionId
    ) {
      setPendingTarget(selectedBrand);
    }
  };
  const reviewLatestBrandRevision = (): void => {
    const currentBrand = brands.data?.items.find(
      (item) => item.id === brand?.brandKitId,
    );
    if (currentBrand) setPendingTarget(currentBrand);
  };
  const brandChangeModal = (
    <Modal
      confirmLoading={adopt.isPending}
      okButtonProps={{ disabled: !canEdit || targetRevision.isPending }}
      okText={
        pendingTarget?.id === brand?.brandKitId
          ? t("brand.canvas.confirmUpdate")
          : t("brand.canvas.confirmSwitch")
      }
      onCancel={() => setPendingTarget(undefined)}
      onOk={() => adopt.mutate()}
      open={Boolean(pendingTarget)}
      title={
        pendingTarget?.id === brand?.brandKitId
          ? t("brand.canvas.reviewUpdate")
          : t("brand.canvas.reviewSwitch")
      }
    >
      <div className="grid gap-4 py-2">
        <p className="m-0 text-sm leading-6 text-muted">
          {t("brand.canvas.changeSafetyDescription")}
        </p>
        {pendingTarget?.latestPublishedRevision ? (
          <div className="flex flex-wrap items-center gap-2">
            <strong>{pendingTarget.name}</strong>
            <StatusTag tone="positive">{t("brand.canvas.ready")}</StatusTag>
          </div>
        ) : null}
        {targetRevision.isPending ? <Spin size="small" /> : null}
        {pendingChanges ? (
          <BrandRevisionChangeSummaryV1 changes={pendingChanges} />
        ) : null}
      </div>
    </Modal>
  );

  if (!brand) {
    return (
      <div className="grid gap-4">
        <div className="grid gap-3 rounded-xl bg-[var(--paper)] p-3 shadow-[var(--shadow-section)]">
          <div className="flex items-start gap-3">
            <BgColorsOutlined
              aria-hidden="true"
              className="mt-0.5 text-xl text-primary"
            />
            <div className="min-w-0">
              <strong className="block text-sm text-ink">
                {t("brand.canvas.noBrand")}
              </strong>
              <span className="mt-1 block text-xs leading-5 text-muted">
                {t("brand.canvas.noBrandDescription")}
              </span>
            </div>
          </div>
          {publishedBrands.length > 0 ? (
            <KanvasSelect
              aria-label={t("brand.canvas.switchBrand")}
              className="w-full"
              disabled={!canEdit}
              onChange={selectBrandForSwitch}
              options={publishedBrands.map((item) => ({
                label: item.name,
                value: item.id,
              }))}
              placeholder={t("brand.canvas.chooseBrand")}
              size="small"
            />
          ) : null}
          {canManage ? (
            <Link
              params={{ workspaceId }}
              search={returnTo ? { returnTo } : {}}
              to="/w/$workspaceId/brand"
            >
              <Button icon={<SettingOutlined />} size="small" type="link">
                {t("brand.canvas.manage")}
              </Button>
            </Link>
          ) : null}
        </div>
        {brandChangeModal}
      </div>
    );
  }

  if (revision.isPending) {
    return (
      <div className="grid min-h-[220px] place-items-center">
        <Spin size="small" />
      </div>
    );
  }
  const missing =
    revision.error instanceof ApiProblem &&
    revision.error.status === httpStatus.notFound;
  if (revision.isError) {
    return (
      <div className="grid min-h-[260px] place-items-center content-center gap-3 text-center text-muted">
        <BgColorsOutlined aria-hidden="true" className="text-3xl" />
        <strong className="text-ink">
          {t(missing ? "brand.canvas.noBrand" : "brand.canvas.unavailable")}
        </strong>
        {missing ? (
          <span className="max-w-[230px] text-xs leading-5">
            {t("brand.canvas.noBrandDescription")}
          </span>
        ) : null}
        {canManage ? (
          <Link
            params={{ workspaceId }}
            search={returnTo ? { returnTo } : {}}
            to="/w/$workspaceId/brand"
          >
            <Button icon={<SettingOutlined />} size="small" type="link">
              {t("brand.canvas.manage")}
            </Button>
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="rounded-xl bg-[var(--paper)] p-3 shadow-[var(--shadow-section)]">
        <span className="text-[10px] font-semibold text-muted">
          {t("brand.canvas.current")}
        </span>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <strong className="block truncate text-sm text-ink">
              {revision.data.name}
            </strong>
            <span className="text-xs text-muted">
              {t("brand.canvas.ready")}
            </span>
          </div>
          {canManage ? (
            <Link
              params={{ workspaceId }}
              search={returnTo ? { returnTo } : {}}
              to="/w/$workspaceId/brand"
            >
              <Button
                aria-label={t("brand.canvas.manage")}
                icon={<SettingOutlined />}
                size="small"
                type="text"
              />
            </Link>
          ) : null}
        </div>
        {publishedBrands.length > 0 &&
        (!brand || publishedBrands.length > 1) ? (
          <KanvasSelect
            aria-label={t("brand.canvas.switchBrand")}
            className="mt-3 w-full"
            disabled={!canEdit}
            onChange={selectBrandForSwitch}
            options={publishedBrands.map((item) => ({
              label: item.name,
              value: item.id,
            }))}
            placeholder={t("brand.canvas.switchBrand")}
            size="small"
            {...(brand?.brandKitId ? { value: brand.brandKitId } : {})}
          />
        ) : null}
      </div>

      <CanvasPanelSection title={t("brand.logos")}>
        <div className="grid grid-cols-2 gap-2">
          {revision.data.logos.map((logo) => (
            <button
              className="group grid min-w-0 gap-2 rounded-lg border-0 bg-[var(--paper)] p-2 text-left shadow-[var(--shadow-section)] transition-[background-color,box-shadow] hover:bg-[var(--paper-hover)] hover:shadow-[var(--shadow-overlay-control)] focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary motion-reduce:transition-none disabled:opacity-55"
              disabled={!canEdit}
              key={logo.key}
              onClick={() => {
                void onInsertLogo(logo).catch(() => {
                  void message.error(t("brand.canvas.insertLogoError"));
                });
              }}
              type="button"
            >
              <span className="relative grid h-16 place-items-center overflow-hidden rounded-lg bg-[var(--paper)]">
                <ArtifactPreview
                  alt=""
                  artifactId={logo.artifactId}
                  imageClassName="absolute inset-0 size-full object-contain p-2"
                  thumbnail
                  workspaceId={workspaceId}
                />
              </span>
              <strong className="truncate px-0.5 text-xs text-ink">
                {logo.name}
              </strong>
              <span className="px-0.5 text-[10px] font-semibold text-primary">
                {t("brand.canvas.insert")}
              </span>
            </button>
          ))}
        </div>
      </CanvasPanelSection>

      <CanvasPanelSection title={t("brand.colors")}>
        <div className="grid grid-cols-2 gap-2">
          {revision.data.colors.map((color) => (
            <button
              className="group grid min-w-0 gap-2 rounded-lg border-0 bg-[var(--paper)] p-2 text-left shadow-[var(--shadow-section)] transition-[background-color,box-shadow] hover:bg-[var(--paper-hover)] hover:shadow-[var(--shadow-overlay-control)] focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary motion-reduce:transition-none"
              disabled={!canEdit}
              key={color.key}
              onClick={() => onApplyColor(color.value)}
              title={`${t(`brand.canvas.colorTargets.${colorTarget}`)} · ${
                color.name
              }`}
              type="button"
            >
              <span
                aria-hidden="true"
                className="h-12 rounded-lg shadow-[inset_0_0_0_1px_rgb(21_21_21_/_8%)]"
                style={{ backgroundColor: color.value }}
              />
              <span className="min-w-0 px-0.5">
                <strong className="block truncate text-xs text-ink">
                  {color.name}
                </strong>
                <span className="block truncate text-[10px] text-muted">
                  {color.value}
                </span>
                <span className="mt-1 block truncate text-[10px] font-semibold text-primary">
                  {t(`brand.canvas.colorTargets.${colorTarget}`)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </CanvasPanelSection>
      <CanvasPanelSection title={t("brand.textStyles")}>
        <div className="grid divide-y divide-[var(--canvas-panel-line)] overflow-hidden rounded-lg bg-[var(--paper)] shadow-[var(--shadow-section)]">
          {revision.data.textStyles.map((style) => {
            const color = style.colorKey
              ? (colorsByKey.get(style.colorKey) ?? "#151515")
              : "#151515";
            return (
              <button
                className="grid min-h-14 w-full gap-1 border-0 bg-transparent px-3 py-2 text-left transition-colors hover:bg-[var(--paper-hover)] focus-visible:z-10 focus-visible:outline-3 focus-visible:outline-primary motion-reduce:transition-none disabled:opacity-55"
                disabled={!canEdit}
                key={style.key}
                onClick={() => onInsertTextStyle(style, color)}
                type="button"
              >
                <span
                  className="truncate"
                  style={{
                    color,
                    fontFamily: style.fontFamily,
                    fontSize: `${String(
                      Math.min(style.fontSize, BRAND_TEXT_PREVIEW_MAX_SIZE),
                    )}px`,
                    fontWeight: style.fontWeight,
                    letterSpacing: `${String(style.letterSpacing)}px`,
                  }}
                >
                  {style.name}
                </span>
                <span className="text-[10px] text-muted">
                  {style.fontFamily} · {String(style.fontSize)}
                </span>
                <span className="text-[10px] font-semibold text-primary">
                  {t("brand.canvas.insertText")}
                </span>
              </button>
            );
          })}
        </div>
      </CanvasPanelSection>
      {revision.data.guidelines.voice ||
      revision.data.guidelines.principles.length > 0 ||
      revision.data.guidelines.avoid.length > 0 ? (
        <CanvasPanelSection title={t("brand.guidelines")}>
          <div className="grid gap-2 rounded-xl bg-[var(--paper)] p-3 shadow-[var(--shadow-section)]">
            {revision.data.guidelines.voice ? (
              <p className="m-0 text-xs leading-5 text-muted">
                {revision.data.guidelines.voice}
              </p>
            ) : null}
            {revision.data.guidelines.principles.length > 0 ? (
              <div className="grid gap-1">
                <strong className="text-[11px] text-ink">
                  {t("brand.principles")}
                </strong>
                <ul className="m-0 grid gap-1 pl-4 text-xs leading-5 text-muted">
                  {revision.data.guidelines.principles.map((principle) => (
                    <li key={principle}>{principle}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {revision.data.guidelines.avoid.length > 0 ? (
              <div className="grid gap-1">
                <strong className="text-[11px] text-ink">
                  {t("brand.avoid")}
                </strong>
                <ul className="m-0 grid gap-1 pl-4 text-xs leading-5 text-muted">
                  {revision.data.guidelines.avoid.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </CanvasPanelSection>
      ) : null}
      {updateAvailable && latestRevision ? (
        <div className="grid gap-2 rounded-xl bg-primary-soft p-3 text-xs text-ink">
          <strong>{t("brand.canvas.updateAvailable")}</strong>
          <span className="leading-5 text-muted">
            {t("brand.canvas.updateDescription")}
          </span>
          <Button
            disabled={!canEdit}
            onClick={reviewLatestBrandRevision}
            size="small"
            type="primary"
          >
            {t("brand.canvas.adoptUpdate")}
          </Button>
        </div>
      ) : null}
      {brandChangeModal}
    </div>
  );
}
