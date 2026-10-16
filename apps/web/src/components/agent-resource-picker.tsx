import {
  BgColorsOutlined,
  BranchesOutlined,
  CheckOutlined,
  DisconnectOutlined,
  PlusOutlined,
  ReadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Button, Empty, Input, Modal, Spin, Tooltip } from "antd";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AssetArtwork } from "./asset-artwork.js";

type ResourceOption = {
  readonly id: string;
  readonly displayName: string;
  readonly summary?: string;
  readonly coverAssetId?: string;
};

export function AgentResourcePicker({
  value = [],
  onChange,
  resources,
  kind,
  workspaceId,
  canReadAssets,
  disabled = false,
  loading = false,
  onSearchChange,
  matchingResourceIds,
  onLoadMore,
  loadingMore = false,
  error,
}: {
  readonly value?: readonly string[];
  readonly onChange?: (value: string[]) => void;
  readonly resources: readonly ResourceOption[];
  readonly kind: "skills" | "brands" | "workflows" | "libraries";
  readonly workspaceId: string;
  readonly canReadAssets: boolean;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly matchingResourceIds?: readonly string[];
  readonly onSearchChange?: (search: string) => void;
  readonly onLoadMore?: () => void;
  readonly loadingMore?: boolean;
  readonly error?: ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<readonly string[]>([]);
  const selectionLimit = { skills: 40, brands: 8, workflows: 40, libraries: 8 }[
    kind
  ];
  const matches = onSearchChange
    ? resources.filter(
        (item) => !matchingResourceIds || matchingResourceIds.includes(item.id),
      )
    : resources.filter((item) =>
        `${item.displayName} ${item.summary ?? ""}`
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
      );
  const icon = {
    skills: <ReadOutlined aria-hidden="true" />,
    brands: <BgColorsOutlined aria-hidden="true" />,
    workflows: <BranchesOutlined aria-hidden="true" />,
    libraries: <ReadOutlined aria-hidden="true" />,
  }[kind];
  function artwork(item?: ResourceOption): React.JSX.Element {
    return (
      <AssetArtwork
        alt={item?.displayName ?? ""}
        {...(canReadAssets && item?.coverAssetId
          ? { assetId: item.coverAssetId }
          : {})}
        workspaceId={workspaceId}
        className="size-6 rounded-md bg-primary/8 text-sm text-primary"
      >
        {icon}
      </AssetArtwork>
    );
  }
  function toggle(id: string): void {
    setPending((selected) => {
      if (selected.includes(id)) return selected.filter((item) => item !== id);
      return value.length + selected.length < selectionLimit
        ? [...selected, id]
        : selected;
    });
  }
  function showPicker(): void {
    setSearch("");
    onSearchChange?.("");
    setPending([]);
    setOpen(true);
  }
  function closePicker(): void {
    setOpen(false);
  }
  function applySelection(): void {
    if (!disabled && pending.length)
      onChange?.([...new Set([...value, ...pending])]);
    setOpen(false);
  }

  function handleSearchChange(event: React.ChangeEvent<HTMLInputElement>) {
    setSearch(event.target.value);
    onSearchChange?.(event.target.value);
  }
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">
          {t(
            kind === "skills"
              ? "agent.hub.skillsTitle"
              : `agent.editor.resourceKinds.${kind}`,
          )}{" "}
          <span className="ml-1 text-xs font-normal text-muted">
            {value.length}
          </span>
        </span>
        {!disabled && (
          <Button
            type="text"
            color="primary"
            size="small"
            icon={<PlusOutlined aria-hidden="true" />}
            onClick={showPicker}
          >
            {t(`agent.editor.addResource.${kind}`)}
          </Button>
        )}
      </div>
      <div className="grid max-h-60 gap-0.5 overflow-y-auto overscroll-contain">
        {value.map((id) => {
          const item = resources.find((resource) => resource.id === id);
          return (
            <div
              key={id}
              className="flex min-h-9 min-w-0 items-center gap-2 rounded-lg px-1 py-0.5 transition-colors duration-150 hover:bg-mist focus-within:bg-mist motion-reduce:transition-none"
            >
              {artwork(item)}
              <Tooltip
                title={
                  <>
                    <strong>
                      {item?.displayName ?? t("agent.resourceUnavailable")}
                    </strong>
                    {item?.summary && (
                      <div className="mt-1">{item.summary}</div>
                    )}
                  </>
                }
                trigger={["hover", "focus"]}
              >
                <span
                  tabIndex={0}
                  className="min-w-0 flex-1 truncate rounded text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {item?.displayName ?? t("agent.resourceUnavailable")}
                </span>
              </Tooltip>
              {!disabled && (
                <Tooltip title={t("agent.design.unlink")}>
                  <Button
                    type="text"
                    size="small"
                    aria-label={t("agent.design.unlinkTitle", {
                      name: item?.displayName ?? t("agent.resourceUnavailable"),
                    })}
                    icon={<DisconnectOutlined aria-hidden="true" />}
                    onClick={() =>
                      onChange?.(value.filter((selected) => selected !== id))
                    }
                  />
                </Tooltip>
              )}
            </div>
          );
        })}
      </div>
      {value.length === 0 && (
        <span className="text-xs text-muted">
          {t("agent.design.noBindings")}
        </span>
      )}
      <Modal
        open={open}
        onCancel={closePicker}
        title={t(`agent.editor.addResource.${kind}`)}
        width={620}
        destroyOnHidden
        footer={
          <div className="flex items-center justify-between gap-3">
            <span role="status" className="text-sm text-muted">
              {t(
                pending.length + value.length >= selectionLimit
                  ? "agent.editor.selectionLimit"
                  : "agent.editor.selectedCount",
                {
                  count:
                    pending.length + value.length >= selectionLimit
                      ? pending.length + value.length
                      : pending.length,
                },
              )}
            </span>
            <div className="flex gap-2">
              <Button onClick={closePicker}>{t("agent.cancel")}</Button>
              <Button
                type="primary"
                disabled={disabled || pending.length === 0}
                onClick={applySelection}
              >
                {t("agent.design.addSelected", { count: pending.length })}
              </Button>
            </div>
          </div>
        }
      >
        <Input
          aria-label={t(`agent.editor.searchResource.${kind}`)}
          placeholder={t(`agent.editor.searchResource.${kind}`)}
          prefix={<SearchOutlined className="text-muted" />}
          value={search}
          onChange={handleSearchChange}
          allowClear
        />
        <div className="mt-3 max-h-[52dvh] overflow-y-auto p-1">
          {loading && (
            <div className="grid min-h-32 place-items-center">
              <Spin />
            </div>
          )}
          {error}
          {!loading && !error && matches.length === 0 && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t(
                search
                  ? "agent.editor.noMatches"
                  : "agent.editor.noAvailableResources",
              )}
            />
          )}
          {!loading && (
            <div className="grid gap-1">
              {matches.map((item) => {
                const attached = value.includes(item.id);
                const selected = pending.includes(item.id);
                return (
                  <button
                    type="button"
                    key={item.id}
                    aria-pressed={attached || selected}
                    aria-label={item.displayName}
                    disabled={
                      disabled ||
                      attached ||
                      (!selected &&
                        pending.length + value.length >= selectionLimit)
                    }
                    onClick={() => toggle(item.id)}
                    className={`flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-lg border-0 bg-transparent p-3 text-left transition-colors duration-150 hover:bg-mist motion-reduce:transition-none ${selected ? "bg-primary-soft" : ""} ${attached ? "cursor-default bg-mist disabled:cursor-default" : "disabled:cursor-not-allowed"}`}
                  >
                    {artwork(item)}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                        {item.displayName}
                      </span>
                      {item.summary && (
                        <span className="mt-1 block text-xs leading-5 text-muted">
                          {item.summary}
                        </span>
                      )}
                    </span>
                    {attached ? (
                      <span className="shrink-0 text-xs text-muted">
                        {t("agent.design.attached")}
                      </span>
                    ) : (
                      <span
                        className={`mt-0.5 grid size-[18px] shrink-0 place-items-center rounded border text-xs ${selected ? "border-primary bg-primary text-white" : "border-muted"}`}
                      >
                        {selected ? <CheckOutlined aria-hidden="true" /> : null}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {onLoadMore && (
            <Button block loading={loadingMore} onClick={onLoadMore}>
              {t("libraries.more")}
            </Button>
          )}
        </div>
      </Modal>
    </div>
  );
}
