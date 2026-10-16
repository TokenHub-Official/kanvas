import { ArrowRightOutlined } from "@ant-design/icons";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

import imageFileOpenIcon from "../assets/icons/ant-design/FileImageOutlined.svg";
import blankCanvasIcon from "../assets/icons/ant-design/LayoutOutlined.svg";
import { DoodleIcon } from "../components/doodle-icon.js";
import { KanvasSelect } from "../components/kanvas-select.js";
import { WorkspacePage } from "../components/workspace-page.js";
import {
  useWorkspaceBrandChoiceV1,
  withoutBrandChoiceV1,
  workspaceBrandChoiceValueV1,
} from "../features/brand/use-workspace-brand-choice-v1.js";
import { canvasImportFileIssue } from "../features/editor/canvas-import-file-validation.js";
import { stageCanvasImportFiles } from "../features/editor/canvas-import-handoff.js";

const creationHubRouteApi = getRouteApi("/w/$workspaceId/new");

export function CreationHubPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = creationHubRouteApi.useParams();

  return (
    <WorkspacePage
      pageTitle={t("studio.create.documentTitle")}
      workspaceId={workspaceId}
    >
      {({ workspace }) => (
        <CreationHubContent
          canCreate={
            workspace.permissions.includes("canvas.write") &&
            workspace.permissions.includes("asset.write")
          }
          canReadBrand={workspace.permissions.includes("brand.read")}
          workspaceId={workspace.id}
        />
      )}
    </WorkspacePage>
  );
}

function CreationHubContent({
  canCreate,
  canReadBrand,
  workspaceId,
}: {
  readonly canCreate: boolean;
  readonly canReadBrand: boolean;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string>();
  const brandChoice = useWorkspaceBrandChoiceV1({
    canReadBrand,
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
  let importDescriptionId: string | undefined;
  if (!canCreate) {
    importDescriptionId = "creation-permission-note";
  } else if (importError) {
    importDescriptionId = "creation-import-error";
  }

  function importSelectedImages(event: ChangeEvent<HTMLInputElement>): void {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) {
      return;
    }
    const issue = canvasImportFileIssue(files);
    if (issue) {
      setImportError(t(`studio.create.fileErrors.${issue}`));
      return;
    }
    setImportError(undefined);
    const importToken = stageCanvasImportFiles(files);
    void navigate({
      to: "/w/$workspaceId/boards/$canvasDraftId",
      params: { workspaceId, canvasDraftId: "new" },
      search: {
        importImage: true,
        importToken,
        ...(brandChoice.selection.brandKitRevisionId
          ? {
              brandKitRevisionId: brandChoice.selection.brandKitRevisionId,
            }
          : { withoutBrand: true }),
      },
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] animate-[studio-page-in_360ms_var(--ease-out-studio)]">
      <h2 className="m-0 pb-8 text-[clamp(32px,4vw,52px)] leading-[1.05] font-bold tracking-[-0.045em]">
        {t("studio.create.heading")}
      </h2>

      {canCreate ? (
        <section
          aria-label={t("studio.home.brandForThisWork")}
          className="mb-6 flex flex-col gap-3 rounded-[18px] bg-paper p-4 shadow-[0_10px_28px_rgb(29_27_51_/_6%)] sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <strong className="block text-sm text-ink">
              {t("studio.home.brandForThisWork")}
            </strong>
            <span className="mt-1 block text-xs text-muted">
              {brandChoice.brands.isError
                ? t("studio.home.brandUnavailable")
                : t("studio.home.brandChoiceHint")}
            </span>
          </div>
          <KanvasSelect
            aria-label={t("studio.home.brandForThisWork")}
            className="w-full sm:w-[320px]"
            disabled={brandChoicePending}
            loading={brandChoicePending}
            onChange={(value: string) => {
              brandChoice.setChoice(
                value as Parameters<typeof brandChoice.setChoice>[0],
              );
            }}
            options={brandOptions}
            size="large"
            value={brandChoice.resolvedChoice}
          />
        </section>
      ) : null}

      <section
        aria-label={t("studio.create.launchesLabel")}
        className="grid grid-cols-1 gap-4 lg:grid-cols-[1.05fr_0.95fr]"
      >
        {canCreate ? (
          <Link
            aria-disabled={brandChoicePending}
            className="group relative grid min-h-[300px] grid-cols-1 items-center gap-6 overflow-hidden rounded-[24px] bg-[var(--primary)] p-8 text-[var(--on-primary)] no-underline transition-[background-color,transform] duration-200 hover:-translate-y-1 hover:bg-[var(--primary-deep)] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-primary sm:grid-cols-[minmax(0,0.72fr)_minmax(220px,1.28fr)] sm:p-10"
            onClick={(event) => {
              if (brandChoicePending) event.preventDefault();
            }}
            params={{ workspaceId, canvasDraftId: "new" }}
            search={{
              importImage: false,
              ...(brandChoice.selection.brandKitRevisionId
                ? {
                    brandKitRevisionId:
                      brandChoice.selection.brandKitRevisionId,
                  }
                : { withoutBrand: true }),
            }}
            to="/w/$workspaceId/boards/$canvasDraftId"
          >
            <span className="relative z-2 grid gap-3">
              <strong className="text-[clamp(28px,3.2vw,44px)] leading-[1.04] tracking-[-0.045em]">
                {t("studio.create.blankTitle")}
              </strong>
              <span className="text-sm text-[var(--on-primary-muted)]">
                {t("studio.create.blankDescription")}
              </span>
              <ArrowRightOutlined className="mt-3 text-lg" />
            </span>
            <DoodleIcon
              aspectRatio="241 / 211"
              className="h-[180px] w-auto justify-self-center text-[var(--on-primary)] drop-shadow-[0_24px_34px_rgb(11_22_113_/_28%)] transition-transform duration-300 group-hover:-translate-y-1 group-hover:-rotate-1 sm:h-[210px] sm:justify-self-end"
              source={blankCanvasIcon}
            />
          </Link>
        ) : (
          <article
            aria-disabled="true"
            className="grid min-h-[300px] grid-cols-1 items-center gap-6 overflow-hidden rounded-[24px] bg-[var(--primary)] p-8 text-[var(--on-primary)] opacity-55 sm:grid-cols-[minmax(0,0.72fr)_minmax(220px,1.28fr)] sm:p-10"
          >
            <span className="grid gap-3">
              <strong className="text-[clamp(28px,3.2vw,44px)] leading-[1.04] tracking-[-0.045em]">
                {t("studio.create.blankTitle")}
              </strong>
              <span className="text-sm text-[var(--on-primary-muted)]">
                {t("studio.create.blankReadOnly")}
              </span>
            </span>
            <DoodleIcon
              aspectRatio="241 / 211"
              className="h-[180px] w-auto justify-self-center text-[var(--on-primary)] sm:h-[210px] sm:justify-self-end"
              source={blankCanvasIcon}
            />
          </article>
        )}

        <input
          accept="image/jpeg,image/png,image/webp"
          disabled={!canCreate || brandChoicePending}
          hidden
          multiple
          onChange={importSelectedImages}
          ref={imageInputRef}
          type="file"
        />
        <button
          aria-describedby={importDescriptionId}
          className="group grid min-h-[300px] w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-end gap-6 rounded-[24px] border-0 bg-paper p-8 text-left text-ink shadow-[0_12px_34px_rgb(29_27_51_/_7%)] transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[0_20px_48px_rgb(29_27_51_/_12%)] focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 sm:p-10"
          disabled={!canCreate || brandChoicePending}
          onClick={() => {
            imageInputRef.current?.click();
          }}
          type="button"
        >
          <DoodleIcon
            aspectRatio="155 / 176"
            className="col-span-2 h-[150px] w-auto justify-self-center text-primary transition-transform duration-300 group-hover:-translate-y-1 group-hover:rotate-2 sm:h-[178px]"
            source={imageFileOpenIcon}
          />
          <span className="grid min-w-0 gap-2">
            <strong className="text-2xl leading-tight">
              {t("studio.create.imageTitle")}
            </strong>
            <small className="text-sm leading-6 text-muted">
              {canCreate
                ? t("studio.create.imageDescription")
                : t("studio.create.imageReadOnly")}
            </small>
          </span>
          <ArrowRightOutlined className="text-lg text-primary" />
        </button>
      </section>

      {!canCreate ? (
        <p
          className="m-0 mt-4 max-w-[70ch] text-sm leading-6 text-muted"
          id="creation-permission-note"
          role="status"
        >
          {t("studio.create.permissionNote")}
        </p>
      ) : null}
      {importError ? (
        <p
          className="m-0 mt-4 max-w-[70ch] font-semibold text-danger"
          id="creation-import-error"
          role="alert"
        >
          {importError}
        </p>
      ) : null}
    </div>
  );
}
