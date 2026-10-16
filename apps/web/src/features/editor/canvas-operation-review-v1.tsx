import {
  CheckCircleOutlined,
  CloseOutlined,
  MoreOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SwapOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Dropdown,
  Modal,
  Segmented,
  Spin,
  Tooltip,
  type MenuProps,
} from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  CanvasOperationSourceCompatibilityV1,
  CanvasOperationSessionV1,
} from "./canvas-operation-runtime-v1.js";
import {
  canvasOperationSurfaceProjectionV1,
  type CanvasOperationReviewActionV1,
} from "./canvas-operation-surface-v1.js";

function actionIcon(action: CanvasOperationReviewActionV1): React.JSX.Element {
  if (action === "replace_content") {
    return <SwapOutlined />;
  }
  if (action === "add_node") {
    return <PlusOutlined />;
  }
  if (action === "set_background") {
    return <PictureOutlined />;
  }
  if (action === "retry") {
    return <ReloadOutlined />;
  }
  if (action === "save_asset") {
    return <SaveOutlined />;
  }
  return <CloseOutlined />;
}

function previewBackgroundClassName(
  background: "checker" | "dark" | "light",
): string {
  if (background === "light") {
    return "bg-[#f7f7f8]";
  }
  if (background === "dark") {
    return "bg-[#202126]";
  }
  return "bg-white bg-[linear-gradient(45deg,#e8e9ee_25%,transparent_25%),linear-gradient(-45deg,#e8e9ee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e8e9ee_75%),linear-gradient(-45deg,transparent_75%,#e8e9ee_75%)] [background-position:0_0,0_8px,8px_-8px,-8px_0] [background-size:16px_16px]";
}

function CanvasOperationPreviewV1({
  busy,
  kind,
  maskUrl,
  onRetry,
  previewError,
  previewUrl,
  sourceUrl,
  tool,
}: {
  readonly busy: boolean;
  readonly kind: "compare" | "mask";
  readonly maskUrl?: string;
  readonly onRetry: () => void;
  readonly previewError?: string;
  readonly previewUrl?: string;
  readonly sourceUrl?: string;
  readonly tool: string;
}) {
  const { t } = useTranslation();
  const figureClassName =
    "relative m-0 grid min-h-[220px] min-w-0 place-items-center";
  const imageClassName = "block max-h-[300px] w-full object-contain";
  const captionClassName =
    "absolute right-[7px] bottom-[7px] rounded-md bg-[rgb(22_24_31_/_72%)] px-1.5 py-[3px] text-[10px] font-bold text-white backdrop-blur-[5px]";
  if (kind === "mask" && maskUrl) {
    return (
      <figure className={figureClassName}>
        <img
          alt={t("canvas.operationReview.preview.maskAlt", { tool })}
          className={imageClassName}
          src={maskUrl}
        />
        <figcaption className={captionClassName}>
          {t("canvas.operationReview.preview.mask")}
        </figcaption>
      </figure>
    );
  }
  if (previewUrl) {
    return (
      <div className="grid w-full grid-cols-2 items-stretch">
        {sourceUrl ? (
          <figure className={figureClassName}>
            <img
              alt={t("canvas.operationReview.preview.sourceAlt")}
              className={imageClassName}
              src={sourceUrl}
            />
            <figcaption className={captionClassName}>
              {t("canvas.operationReview.preview.source")}
            </figcaption>
          </figure>
        ) : null}
        <figure
          className={`${figureClassName} ${
            sourceUrl ? "border-l border-[rgb(100_103_118_/_22%)]" : ""
          }`}
        >
          <img
            alt={t("canvas.operationReview.preview.resultAlt", { tool })}
            className={imageClassName}
            src={previewUrl}
          />
          <figcaption className={captionClassName}>
            {t("canvas.operationReview.preview.result")}
          </figcaption>
        </figure>
      </div>
    );
  }
  if (previewError) {
    return (
      <Alert
        action={
          <Button
            disabled={busy}
            icon={<ReloadOutlined />}
            onClick={onRetry}
            size="small"
            type="text"
          >
            {t("canvas.operationReview.actions.retryPreview")}
          </Button>
        }
        title={previewError}
        showIcon
        type="warning"
      />
    );
  }
  return (
    <div className="flex min-h-48 items-center justify-center gap-3 text-[var(--muted-foreground)]">
      <Spin size="small" />
      {t("canvas.operationReview.preview.loading")}
    </div>
  );
}

export function CanvasOperationReviewV1({
  applicationAuthorized = true,
  busy,
  assetSaved,
  onApply,
  onClose,
  onDismiss,
  onDiscard,
  onRefreshStatus,
  onRetry,
  onRetryPreview,
  onSaveAsset,
  onViewAsset,
  afterClose,
  maskUrl,
  open = true,
  previewError,
  previewUrl,
  session,
  sourceUrl,
  sourceCompatibility,
  statusError,
}: {
  readonly applicationAuthorized?: boolean;
  readonly assetSaved: boolean;
  readonly busy: boolean;
  readonly onApply: (
    disposition: "add_node" | "replace_content" | "set_background",
  ) => void;
  readonly onClose: () => void;
  readonly onDismiss: () => void;
  readonly onDiscard: () => void;
  readonly onRefreshStatus: () => void;
  readonly onRetry: () => void;
  readonly onRetryPreview: () => void;
  readonly onSaveAsset: () => void;
  readonly onViewAsset: () => void;
  readonly afterClose?: () => void;
  readonly maskUrl?: string;
  readonly open?: boolean;
  readonly previewError?: string;
  readonly previewUrl?: string;
  readonly session: CanvasOperationSessionV1;
  readonly sourceUrl?: string;
  readonly sourceCompatibility: CanvasOperationSourceCompatibilityV1;
  readonly statusError?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [previewBackground, setPreviewBackground] = useState<
    "checker" | "dark" | "light"
  >("checker");
  const [previewKind, setPreviewKind] = useState<"compare" | "mask">("compare");
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const projection = canvasOperationSurfaceProjectionV1(
    session,
    sourceCompatibility,
  );
  const primaryAction = projection.primaryAction;
  const availableActions = session.availableOutputDispositions.filter(
    (action): action is "add_node" | "replace_content" | "set_background" =>
      (action === "add_node" ||
        action === "replace_content" ||
        action === "set_background") &&
      (action !== "replace_content" || projection.kind !== "conflict"),
  );
  const applyDisabled = busy || !previewUrl || !applicationAuthorized;
  const actionDisabled = (action: CanvasOperationReviewActionV1): boolean => {
    if (action === "close") {
      return false;
    }
    if (action === "retry") {
      return busy;
    }
    if (action === "save_asset") {
      return busy || (!assetSaved && applyDisabled);
    }
    return applyDisabled;
  };

  const actionLabel = (action: CanvasOperationReviewActionV1): string =>
    t(`canvas.operationReview.actions.${action}`);
  const runAction = (action: CanvasOperationReviewActionV1) => {
    if (actionDisabled(action)) {
      return;
    }
    if (
      action === "replace_content" ||
      action === "add_node" ||
      action === "set_background"
    ) {
      onApply(action);
      return;
    }
    if (action === "retry") {
      onRetry();
      return;
    }
    if (action === "save_asset") {
      if (assetSaved) {
        onViewAsset();
      } else {
        onSaveAsset();
      }
      return;
    }
    onClose();
  };
  const secondaryItems: MenuProps["items"] = [
    ...availableActions
      .filter((action) => action !== primaryAction)
      .map((action) => ({
        disabled: actionDisabled(action),
        key: action,
        icon: actionIcon(action),
        label: actionLabel(action),
      })),
    ...(primaryAction === "save_asset"
      ? []
      : [
          {
            disabled: actionDisabled("save_asset"),
            key: "save_asset",
            icon: assetSaved ? <CheckCircleOutlined /> : <SaveOutlined />,
            label: assetSaved
              ? t("canvas.operationReview.actions.viewAsset")
              : actionLabel("save_asset"),
          },
        ]),
    { type: "divider" },
    {
      danger: true,
      disabled: busy,
      key: "discard",
      icon: <CloseOutlined />,
      label: t("canvas.operationReview.actions.discard"),
    },
  ];
  let titleKey:
    | "canvas.operationReview.title.conflict"
    | "canvas.operationReview.title.decision"
    | "canvas.operationReview.title.recovery"
    | "canvas.operationReview.title.terminal" =
    "canvas.operationReview.title.decision";
  if (projection.kind === "conflict") {
    titleKey = "canvas.operationReview.title.conflict";
  } else if (projection.kind === "recovery") {
    titleKey = "canvas.operationReview.title.recovery";
  } else if (projection.kind === "terminal") {
    titleKey = "canvas.operationReview.title.terminal";
  }
  const title = t(titleKey, {
    tool: session.label,
  });
  const sourceWarningKeys = {
    missing: "canvas.operationReview.source.missing",
    source_changed: "canvas.operationReview.source.changed",
    wrong_page: "canvas.operationReview.source.wrongPage",
  } as const;
  const sourceWarning =
    sourceCompatibility === "compatible"
      ? undefined
      : t(sourceWarningKeys[sourceCompatibility]);
  const showDecision =
    projection.kind === "decision" || projection.kind === "conflict";

  return (
    <Modal
      {...(afterClose ? { afterClose } : {})}
      afterOpenChange={(visible) => {
        if (visible) {
          primaryButtonRef.current?.focus({
            preventScroll: true,
          });
        }
      }}
      centered
      classNames={{
        body: "max-h-[min(72vh,760px)] overflow-y-auto px-1",
        container: "overflow-hidden",
        header: "pr-10",
      }}
      destroyOnHidden
      footer={null}
      focusable={{
        focusTriggerAfterClose: false,
        trap: true,
      }}
      onCancel={onDismiss}
      open={open && projection.surface === "review"}
      title={<span tabIndex={-1}>{title}</span>}
      width={820}
    >
      <div className="space-y-5 pt-2">
        {showDecision ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                aria-label={t("canvas.operationReview.previewContent")}
                onChange={(value) => {
                  if (value === "compare" || value === "mask") {
                    setPreviewKind(value);
                  }
                }}
                options={[
                  {
                    label: t("canvas.operationReview.preview.compare"),
                    value: "compare",
                  },
                  {
                    disabled: !maskUrl,
                    label: t("canvas.operationReview.preview.mask"),
                    value: "mask",
                  },
                ]}
                value={previewKind}
              />
              <Segmented
                aria-label={t("canvas.operationReview.previewBackground")}
                onChange={(value) => {
                  if (
                    value === "checker" ||
                    value === "light" ||
                    value === "dark"
                  ) {
                    setPreviewBackground(value);
                  }
                }}
                options={[
                  {
                    label: t("canvas.operationReview.background.checker"),
                    value: "checker",
                  },
                  {
                    label: t("canvas.operationReview.background.light"),
                    value: "light",
                  },
                  {
                    label: t("canvas.operationReview.background.dark"),
                    value: "dark",
                  },
                ]}
                size="small"
                value={previewBackground}
              />
            </div>
            <div
              className={`grid min-h-[220px] place-items-center overflow-hidden rounded-xl border border-[var(--canvas-panel-line)] ${previewBackgroundClassName(
                previewBackground,
              )}`}
            >
              <CanvasOperationPreviewV1
                busy={busy}
                kind={previewKind}
                {...(maskUrl ? { maskUrl } : {})}
                onRetry={onRetryPreview}
                {...(previewError ? { previewError } : {})}
                {...(previewUrl ? { previewUrl } : {})}
                {...(sourceUrl ? { sourceUrl } : {})}
                tool={session.label}
              />
            </div>
          </>
        ) : null}

        {sourceWarning ? (
          <Alert showIcon title={sourceWarning} type="warning" />
        ) : null}
        {!applicationAuthorized ? (
          <Alert
            title={t("canvas.operationReview.permissionUnavailable")}
            showIcon
            type="warning"
          />
        ) : null}
        {statusError ? (
          <Alert
            action={
              <Button
                disabled={busy}
                icon={<ReloadOutlined />}
                onClick={onRefreshStatus}
                size="small"
                type="text"
              >
                {t("canvas.operationStatus.reconnect")}
              </Button>
            }
            title={statusError}
            showIcon
            type="warning"
          />
        ) : null}
        {!showDecision ? (
          <Alert
            description={
              session.failure?.message ??
              (session.phase === "cancelled"
                ? t("canvas.operationReview.terminal.cancelled")
                : t("canvas.operationReview.terminal.failed"))
            }
            icon={
              projection.kind === "recovery" ? (
                <ReloadOutlined />
              ) : (
                <WarningOutlined />
              )
            }
            title={
              projection.kind === "recovery"
                ? t("canvas.operationReview.status.recovery")
                : t("canvas.operationReview.status.terminal")
            }
            showIcon
            type={projection.kind === "recovery" ? "warning" : "error"}
          />
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {showDecision ? (
            <Dropdown
              menu={{
                items: secondaryItems,
                onClick: ({ key }) => {
                  if (key === "discard") {
                    if (!busy) {
                      onDiscard();
                    }
                    return;
                  }
                  runAction(key as CanvasOperationReviewActionV1);
                },
              }}
              trigger={["click"]}
            >
              <Tooltip title={t("canvas.operationReview.actions.more")}>
                <Button
                  aria-label={t("canvas.operationReview.actions.more")}
                  icon={<MoreOutlined />}
                />
              </Tooltip>
            </Dropdown>
          ) : null}
          {primaryAction ? (
            <Button
              disabled={actionDisabled(primaryAction)}
              icon={actionIcon(primaryAction)}
              onClick={() => {
                runAction(primaryAction);
              }}
              ref={primaryButtonRef}
              type="primary"
            >
              {actionLabel(primaryAction)}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
