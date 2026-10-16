import { useState } from "react";
import { LibraryReferenceDialog } from "./library-reference-dialog.js";
import { Tooltip } from "antd";
import { ReadOutlined } from "@ant-design/icons";
import type { AgentThreadView } from "@kanvas/contracts/api";
import { useTranslation } from "react-i18next";

type Use = NonNullable<
  AgentThreadView["messages"][number]["libraryUses"]
>[number];
export function LibraryUseReferences({
  uses,
  workspaceId,
}: {
  readonly workspaceId?: string;
  readonly uses: readonly Use[];
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Use>();
  const groups = new Map<string, { item: Use; kinds: Set<Use["kind"]> }>();
  for (const item of uses) {
    const key = `${item.libraryId}:${item.revisionNumber}:${item.entryId}`;
    const group = groups.get(key) ?? { item, kinds: new Set<Use["kind"]>() };
    const locations = [
      ...new Map(
        [...(group.item.locations ?? []), ...(item.locations ?? [])].map(
          (location) => [
            `${location.startOffset}:${location.endOffset}`,
            location,
          ],
        ),
      ).values(),
    ];
    group.item = { ...group.item, ...item, locations };
    group.kinds.add(item.kind);
    groups.set(key, group);
  }
  return (
    <section
      aria-label={t("libraries.usedReferences")}
      className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"
    >
      <h3 className="m-0 flex items-center gap-1.5 text-xs font-semibold text-muted">
        <ReadOutlined />
        {t("libraries.usedReferences")}
      </h3>
      <ul className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
        {[...groups].map(([key, { item, kinds }]) => (
          <li key={key} className="min-w-0 max-w-full">
            <Tooltip
              title={
                <>
                  <div>
                    {item.libraryName} ·{" "}
                    {t("libraries.revision", { number: item.revisionNumber })}
                  </div>
                  <div>
                    {[...kinds]
                      .map((kind) => t(`libraries.useKind.${kind}`))
                      .join(" · ")}
                  </div>
                </>
              }
              trigger={["hover", "focus"]}
            >
              <button
                type="button"
                onClick={() => {
                  if (workspaceId && item.artifactId) setSelected(item);
                }}
                aria-label={t("libraries.viewReference", { name: item.name })}
                className="block max-w-64 cursor-pointer truncate rounded border-0 bg-mist px-2 py-0.5 text-xs text-muted focus-visible:outline-2 focus-visible:outline-primary"
              >
                {item.name}
              </button>
            </Tooltip>
          </li>
        ))}
      </ul>
      {selected && workspaceId && (
        <LibraryReferenceDialog
          item={selected}
          workspaceId={workspaceId}
          onClose={() => setSelected(undefined)}
        />
      )}
    </section>
  );
}
