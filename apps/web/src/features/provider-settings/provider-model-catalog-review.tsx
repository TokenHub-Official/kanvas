import type { ProviderModelCatalogReview } from "@kanvas/contracts/api";
import { useTranslation } from "react-i18next";

import { StatusTag } from "../../components/status-tag.js";

type SelectedModelDiff = ProviderModelCatalogReview["selectedModels"][number];
type OperationDiff = SelectedModelDiff["operations"][number];

function operationHasChanges(operation: OperationDiff): boolean {
  return (
    operation.change !== "unchanged" ||
    operation.apiSurfaces.added.length > 0 ||
    operation.apiSurfaces.removed.length > 0 ||
    operation.parameters.some((parameter) => parameter.change !== "unchanged")
  );
}

function modelLabel(model: SelectedModelDiff): string {
  return (
    model.displayName.after ?? model.displayName.before ?? model.providerModelId
  );
}

export function ProviderModelCatalogReviewDetails({
  review,
}: {
  readonly review: ProviderModelCatalogReview;
}): React.JSX.Element {
  const { t } = useTranslation();
  const changedModels = review.selectedModels.filter(
    (model) =>
      model.change !== "unchanged" ||
      model.operations.some(operationHasChanges),
  );

  return (
    <div
      className="grid gap-4"
      data-provider-catalog-review={review.providerSettingId}
    >
      <div className="rounded-xl bg-mist px-4 py-3 text-xs leading-5 text-muted">
        {t("settings.providers.catalogReview.revisions", {
          activated:
            review.activated?.revision ??
            t("settings.providers.catalogReview.notActivated"),
          current: review.current.revision,
        })}
      </div>

      {review.blockers.length > 0 ? (
        <section
          aria-label={t("settings.providers.catalogReview.blockersTitle")}
          className="rounded-xl border border-warning/25 bg-warning-surface px-4 py-3"
        >
          <strong className="block text-xs text-warning">
            {t("settings.providers.catalogReview.blockersTitle")}
          </strong>
          <ul className="mt-2 grid gap-1 pl-4 text-xs leading-5 text-ink">
            {review.blockers.map((blocker, index) => (
              <li
                key={[
                  blocker.code,
                  blocker.providerModelId ?? "",
                  blocker.capabilityKey ?? "",
                  blocker.apiSurface ?? "",
                  String(index),
                ].join(":")}
              >
                {t(
                  `settings.providers.catalogReview.blockers.${blocker.code}`,
                  {
                    apiSurface: blocker.apiSurface ?? "",
                    capability: blocker.capabilityKey ?? "",
                    model: blocker.providerModelId ?? "",
                  },
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-xs leading-5 text-positive">
          {t("settings.providers.catalogReview.noBlockers")}
        </p>
      )}

      {changedModels.length === 0 ? (
        <p className="text-xs leading-5 text-muted">
          {t("settings.providers.catalogReview.noChanges")}
        </p>
      ) : (
        <div className="grid gap-3">
          {changedModels.map((model) => (
            <section
              className="rounded-xl border border-line px-4 py-3"
              data-provider-model-change={model.change}
              key={model.providerModelId}
            >
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block truncate text-sm">
                    {modelLabel(model)}
                  </strong>
                  <span className="block truncate text-[11px] text-muted">
                    {model.providerModelId}
                  </span>
                </div>
                <StatusTag>
                  {t(
                    `settings.providers.catalogReview.changes.${model.change}`,
                  )}
                </StatusTag>
              </div>

              <div className="mt-3 grid gap-2">
                {model.operations
                  .filter(operationHasChanges)
                  .map((operation) => (
                    <div
                      className="rounded-lg bg-paper-hover/60 px-3 py-2"
                      key={operation.capabilityKey}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-ink">
                          {t(
                            `settings.providers.catalogReview.operations.${operation.capabilityKey}`,
                          )}
                        </span>
                        <span className="text-muted">
                          {t(
                            `settings.providers.catalogReview.changes.${operation.change}`,
                          )}
                        </span>
                      </div>
                      {operation.apiSurfaces.added.length > 0 ? (
                        <p className="mt-1 text-[11px] leading-4 text-positive">
                          {t("settings.providers.catalogReview.surfacesAdded", {
                            values: operation.apiSurfaces.added.join(" · "),
                          })}
                        </p>
                      ) : null}
                      {operation.apiSurfaces.removed.length > 0 ? (
                        <p className="mt-1 text-[11px] leading-4 text-warning">
                          {t(
                            "settings.providers.catalogReview.surfacesRemoved",
                            {
                              values: operation.apiSurfaces.removed.join(" · "),
                            },
                          )}
                        </p>
                      ) : null}
                      {operation.parameters
                        .filter((parameter) => parameter.change !== "unchanged")
                        .map((parameter) => (
                          <p
                            className="mt-1 text-[11px] leading-4 text-muted"
                            key={parameter.key}
                          >
                            {t(
                              "settings.providers.catalogReview.parameterChange",
                              {
                                change: t(
                                  `settings.providers.catalogReview.changes.${parameter.change}`,
                                ),
                                fields:
                                  parameter.changedFields.length > 0
                                    ? parameter.changedFields.join(", ")
                                    : "—",
                                key: parameter.key,
                              },
                            )}
                          </p>
                        ))}
                    </div>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
