import { useTranslation } from "react-i18next";

import type {
  BrandCollectionChangesV1,
  BrandRevisionChangesV1,
} from "./brand-revision-diff-v1.js";

function collectionLines(
  label: string,
  changes: BrandCollectionChangesV1,
  actionLabels: {
    readonly added: string;
    readonly changed: string;
    readonly removed: string;
  },
): string[] {
  const lines: string[] = [];
  if (changes.added.length > 0) {
    lines.push(`${label} · ${actionLabels.added}：${changes.added.join("、")}`);
  }
  if (changes.changed.length > 0) {
    lines.push(
      `${label} · ${actionLabels.changed}：${changes.changed.join("、")}`,
    );
  }
  if (changes.removed.length > 0) {
    lines.push(
      `${label} · ${actionLabels.removed}：${changes.removed.join("、")}`,
    );
  }
  return lines;
}

export function BrandRevisionChangeSummaryV1({
  changes,
}: {
  readonly changes: BrandRevisionChangesV1;
}): React.JSX.Element {
  const { t } = useTranslation();
  const actionLabels = {
    added: t("brand.diff.added"),
    changed: t("brand.diff.changed"),
    removed: t("brand.diff.removed"),
  };
  const lines = [
    ...(changes.identityChanged ? [t("brand.diff.identityChanged")] : []),
    ...collectionLines(t("brand.logos"), changes.logos, actionLabels),
    ...collectionLines(
      t("brand.referenceImages"),
      changes.referenceImages,
      actionLabels,
    ),
    ...collectionLines(t("brand.colors"), changes.colors, actionLabels),
    ...collectionLines(t("brand.textStyles"), changes.textStyles, actionLabels),
    ...(changes.guidelinesChanged ? [t("brand.diff.guidelinesChanged")] : []),
  ];
  return lines.length > 0 ? (
    <ul className="m-0 grid gap-2 pl-5 text-sm leading-6 text-ink">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  ) : (
    <p className="m-0 text-sm text-muted">{t("brand.diff.noChanges")}</p>
  );
}
