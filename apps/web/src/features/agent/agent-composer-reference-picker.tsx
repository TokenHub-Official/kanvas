import { fetchLibraries } from "../resource-libraries/api.js";
import { ActionLink } from "../../components/action-link.js";
import { AssetArtwork } from "../../components/asset-artwork.js";
import {
  SettingOutlined,
  CheckOutlined,
  SearchOutlined,
  ReadOutlined,
  BgColorsOutlined,
  BranchesOutlined,
  FileImageOutlined,
  LayoutOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Drawer, Empty, Input, Skeleton } from "antd";
import { useMemo, useRef, useState, useDeferredValue } from "react";
import { useTranslation } from "react-i18next";

import {
  fetchBrandKits,
  fetchCanvasDrafts,
  fetchWorkflowTemplates,
  fetchWorkspaceAssets,
  fetchAgentHubSkills,
} from "../../api/transport.js";
import { cn } from "../../lib/cn.js";

export type AgentComposerReference =
  | {
      readonly kind: "library";
      readonly id: string;
      readonly title: string;
      readonly description?: string;
      readonly libraryId: string;
    }
  | {
      readonly kind: "artifact";
      readonly id: string;
      readonly title: string;
      readonly description?: string;
      readonly artifactId: string;
    }
  | {
      readonly kind: "asset";
      readonly id: string;
      readonly title: string;
      readonly description?: string;
      readonly assetId: string;
      readonly artifactId: string;
    }
  | {
      readonly kind: "brand";
      readonly id: string;
      readonly title: string;
      readonly description?: string;
      readonly brandKitId: string;
      readonly brandKitRevisionId: string;
    }
  | {
      readonly kind: "canvas";
      readonly id: string;
      readonly title: string;
      readonly description?: string;
      readonly resourceId: string;
      readonly version: number;
    }
  | {
      readonly kind: "skill";
      readonly id: string;
      readonly title: string;
      readonly description?: string;
      readonly skillRevisionId: string;
    }
  | {
      readonly kind: "workflow";
      readonly id: string;
      readonly title: string;
      readonly description?: string;
      readonly resourceId: string;
    };

export type AgentComposerReferenceKind = Exclude<
  AgentComposerReference["kind"],
  "artifact"
>;
const canvasReferenceLimit = 50;
const maximumLibraryQueryLength = 200;
const maximumLibrarySelections = 8;

export function agentComposerSkillPayload(
  reference: AgentComposerReference | undefined,
) {
  if (reference?.kind !== "skill") return {};
  return {
    skillRevisionId: reference.skillRevisionId,
  };
}

function ReferenceIcon({
  kind,
}: {
  readonly kind: AgentComposerReference["kind"];
}) {
  if (kind === "brand") return <BgColorsOutlined aria-hidden="true" />;
  if (kind === "canvas") return <LayoutOutlined aria-hidden="true" />;
  if (kind === "workflow") return <BranchesOutlined aria-hidden="true" />;
  if (kind === "library") return <ReadOutlined aria-hidden="true" />;
  if (kind === "skill") return <ReadOutlined aria-hidden="true" />;
  return <FileImageOutlined aria-hidden="true" />;
}

export function filterAgentComposerReferences(
  items: readonly AgentComposerReference[],
  query: string,
): readonly AgentComposerReference[] {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized
    ? items.filter((item) =>
        `${item.title} ${item.description ?? ""}`
          .toLocaleLowerCase()
          .includes(normalized),
      )
    : items;
}

export function AgentComposerReferencePicker({
  kind,
  onCancel,
  onConfirm,
  open,
  selected,
  workspaceId,
  canManageSkills = false,
  maxSelected = 12,
}: {
  readonly maxSelected?: number;
  readonly kind: AgentComposerReferenceKind;
  readonly onCancel: () => void;
  readonly onConfirm: (items: readonly AgentComposerReference[]) => void;
  readonly open: boolean;
  readonly selected: readonly AgentComposerReference[];
  readonly workspaceId: string;
  readonly canManageSkills?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const serverQuery = useDeferredValue(
    kind === "library" ? query.trim().slice(0, maximumLibraryQueryLength) : "",
  );
  const [librarySelections, setLibrarySelections] = useState(
    () =>
      new Map(
        selected
          .filter((item) => item.kind === "library")
          .map((item) => [item.id, item]),
      ),
  );
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(() =>
    selected.filter((item) => item.kind === kind).map((item) => item.id),
  );
  const itemButtonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const references = useQuery({
    queryKey: ["agent-composer-references", workspaceId, kind, serverQuery],
    queryFn: async (): Promise<readonly AgentComposerReference[]> => {
      if (kind === "library") {
        const result = await fetchLibraries(workspaceId, {
          query: serverQuery,
          lifecycleStatus: "active",
        });
        return result.items.map((item) => ({
          kind,
          id: `library:${item.id}`,
          title: item.name,
          description: item.description,
          libraryId: item.id,
        }));
      }
      if (kind === "brand") {
        const result = await fetchBrandKits(workspaceId, {
          lifecycleStatus: "active",
        });
        return result.items.flatMap((item) =>
          item.latestPublishedRevision
            ? [
                {
                  kind,
                  id: `brand:${item.id}`,
                  title: item.name,
                  ...(item.description
                    ? { description: item.description }
                    : {}),
                  brandKitId: item.id,
                  brandKitRevisionId: item.latestPublishedRevision.id,
                },
              ]
            : [],
        );
      }
      if (kind === "canvas") {
        const result = await fetchCanvasDrafts(
          workspaceId,
          canvasReferenceLimit,
        );
        return result.items.map((item) => ({
          kind,
          id: `canvas:${item.id}`,
          title: item.title,
          description: t("agent.referenceCanvasPages", {
            count: item.pageCount,
          }),
          resourceId: item.id,
          version: item.version,
        }));
      }
      if (kind === "workflow") {
        const result = await fetchWorkflowTemplates(workspaceId);
        return result.items.map((item) => ({
          kind,
          id: `workflow:${item.workflowRevisionId}`,
          title: item.presentation?.title ?? item.displayName,
          ...((item.presentation?.description ?? item.description)
            ? {
                description: item.presentation?.description ?? item.description,
              }
            : {}),
          resourceId: item.workflowRevisionId,
        }));
      }
      if (kind === "skill") {
        const result = await fetchAgentHubSkills(workspaceId);
        return result.items
          .filter((item) => item.runtimeStatus === "enabled")
          .map((item) => ({
            kind,
            id: `skill:${item.skillRevisionId}`,
            title: item.displayName,
            description: item.summary,
            skillRevisionId: item.skillRevisionId,
          }));
      }
      if (kind === "asset") {
        const result = await fetchWorkspaceAssets(workspaceId, {
          lifecycleStatus: "active",
          limit: "100",
        });
        return result.items.flatMap((item) =>
          item.currentArtifact?.availabilityStatus === "available" &&
          item.currentArtifact.mediaType?.startsWith("image/")
            ? [
                {
                  kind,
                  id: `asset:${item.id}`,
                  title: item.name,
                  description:
                    item.currentArtifact.displayFilename ?? item.assetType,
                  assetId: item.id,
                  artifactId: item.currentArtifact.id,
                },
              ]
            : [],
        );
      }
      return [];
    },
    enabled: open && Boolean(kind),
    retry: false,
    staleTime: 30_000,
  });
  const visibleItems = useMemo(
    () => filterAgentComposerReferences(references.data ?? [], query),
    [query, references.data],
  );

  function toggle(item: AgentComposerReference): void {
    if (item.kind === "library")
      setLibrarySelections((current) => new Map(current).set(item.id, item));
    setSelectedIds((current) => {
      if (current.includes(item.id))
        return current.filter((id) => id !== item.id);
      if (maxSelected === 0) return current;
      if (kind === "brand" || kind === "skill") return [item.id];
      if (
        current.length >=
        Math.min(
          maxSelected,
          kind === "library" ? maximumLibrarySelections : maxSelected,
        )
      )
        return current;
      return [...current, item.id];
    });
  }

  function moveFocus(index: number, key: string): boolean {
    let next: number;
    switch (key) {
      case "ArrowDown":
        next = (index + 1) % visibleItems.length;
        break;
      case "ArrowUp":
        next = (index - 1 + visibleItems.length) % visibleItems.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = visibleItems.length - 1;
        break;
      default:
        return false;
    }
    itemButtonsRef.current[next]?.focus();
    return true;
  }

  const candidates =
    kind === "library"
      ? [
          ...new Map(
            [...librarySelections.values(), ...(references.data ?? [])].map(
              (item) => [item.id, item],
            ),
          ).values(),
        ]
      : (references.data ?? []);
  const picked = candidates.filter((item) => selectedIds.includes(item.id));
  const skillDirectoryLabelKey = canManageSkills
    ? "agent.navigation.manageSkills"
    : "agent.skillWorkbench.browseSkills";
  const emptySkillDescriptionKey = canManageSkills
    ? "agent.skillWorkbench.noSelectableSkillsManager"
    : "agent.skillWorkbench.noSelectableSkillsMember";
  const emptyReferences =
    kind === "skill" ? (
      <Empty
        description={
          <div className="mx-auto grid max-w-[36ch] justify-items-center gap-2">
            <strong className="text-sm text-ink">
              {t(
                query.trim()
                  ? "agent.noMatchingReferences"
                  : "agent.skillWorkbench.noSelectableSkills",
              )}
            </strong>
            <span className="text-sm leading-6 text-muted">
              {t(emptySkillDescriptionKey)}
            </span>
            <ActionLink
              className="mt-2"
              to="/w/$workspaceId/skills"
              params={{ workspaceId }}
            >
              {t(skillDirectoryLabelKey)}
            </ActionLink>
          </div>
        }
      />
    ) : (
      <Empty description={t("agent.noMatchingReferences")} />
    );
  return (
    <Drawer
      size={480}
      styles={{ body: { padding: 20 }, footer: { padding: "16px 20px" } }}
      destroyOnHidden
      footer={
        <div className="flex items-center justify-end gap-2">
          {kind === "skill" &&
          ((references.data?.length ?? 0) > 0 ||
            references.isPending ||
            references.isError ||
            query.trim()) ? (
            <ActionLink
              className="mr-auto"
              variant="text"
              color="default"
              icon={<SettingOutlined />}
              to="/w/$workspaceId/skills"
              params={{ workspaceId }}
            >
              {t(skillDirectoryLabelKey)}
            </ActionLink>
          ) : null}
          <Button onClick={onCancel}>{t("agent.cancel")}</Button>
          <Button
            disabled={
              references.isPending ||
              references.isError ||
              picked.length > maxSelected ||
              (picked.length === 0 &&
                !selected.some((item) => item.kind === kind))
            }
            onClick={() => onConfirm(picked)}
            type="primary"
          >
            {picked.length === 0 && selected.some((item) => item.kind === kind)
              ? t("agent.applyReferences")
              : t("agent.addReferences", { count: picked.length })}
          </Button>
        </div>
      }
      onClose={onCancel}
      open={open}
      title={kind ? t(`agent.referencePicker.${kind}`) : ""}
    >
      <Input
        autoFocus
        prefix={<SearchOutlined aria-hidden="true" />}
        allowClear
        aria-label={t("agent.searchReferences")}
        className="mb-5"
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("agent.searchReferences")}
        value={query}
      />
      {references.isPending ? (
        <Skeleton active paragraph={{ rows: 5 }} title={false} />
      ) : null}
      {references.isError ? (
        <Alert
          type="error"
          showIcon
          title={t("agent.referenceLoadError")}
          action={
            <Button onClick={() => void references.refetch()}>
              {t("agent.retry")}
            </Button>
          }
        />
      ) : null}
      {!references.isPending && !references.isError ? (
        <div
          aria-label={t("agent.availableReferences")}
          className="grid gap-1"
          aria-multiselectable={kind !== "brand" && kind !== "skill"}
          role="listbox"
        >
          {visibleItems.map((item, index) => {
            const active = selectedIds.includes(item.id);
            return (
              <button
                aria-selected={active}
                className={cn(
                  "flex w-full items-center gap-3 rounded-control border border-transparent bg-transparent px-3 py-3 text-left text-ink hover:bg-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50",
                  active && "!bg-primary-soft",
                )}
                disabled={
                  !active &&
                  (maxSelected === 0 ||
                    (kind !== "brand" &&
                      kind !== "skill" &&
                      selectedIds.length >= maxSelected))
                }
                key={item.id}
                onClick={() => toggle(item)}
                onKeyDown={(event) => {
                  if (moveFocus(index, event.key)) event.preventDefault();
                }}
                ref={(node) => {
                  itemButtonsRef.current[index] = node;
                }}
                role="option"
                type="button"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-mist-deep text-primary">
                  {item.kind === "asset" ? (
                    <AssetArtwork
                      assetId={item.assetId}
                      workspaceId={workspaceId}
                      alt=""
                      className="size-9 rounded-[8px]"
                    >
                      <FileImageOutlined aria-hidden="true" />
                    </AssetArtwork>
                  ) : (
                    <ReferenceIcon kind={item.kind} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block break-words text-sm font-medium">
                    {item.title}
                  </strong>
                  {item.description ? (
                    <span className="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">
                      {item.description}
                    </span>
                  ) : null}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded border border-line",
                    active && "border-primary bg-primary text-white",
                    (kind === "brand" || kind === "skill") && "rounded-full",
                  )}
                >
                  {active ? <CheckOutlined className="text-xs" /> : null}
                </span>
              </button>
            );
          })}
          {visibleItems.length === 0 ? emptyReferences : null}
        </div>
      ) : null}
    </Drawer>
  );
}
