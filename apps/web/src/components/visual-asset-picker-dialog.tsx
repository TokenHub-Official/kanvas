import {
  CheckOutlined,
  ExpandOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Alert, Button, Empty, Input, Modal, Segmented, Skeleton } from "antd";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { transparencySurfaceStyle } from "./transparency-surface.js";
import { VisualIdentityModal } from "./visual-identity-modal.js";

export interface VisualAssetOption {
  readonly id: string;
  readonly name: string;
  readonly thumbnail: ReactNode;
  readonly preview: ReactNode;
  readonly unavailableReason?: string;
}

export interface VisualAssetSource {
  readonly items: readonly VisualAssetOption[];
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly loading: boolean;
  readonly error?: string;
  readonly onRetry: () => void;
  readonly more?: {
    readonly state: "ready" | "loading" | "error";
    readonly onLoad: () => void;
  };
}

const skeletonCards = Array.from({ length: 8 }, (_, index) => index);

/** Mount per opening. The source owns fetching; this dialog owns only a tentative selection. */
export function VisualAssetPickerDialog({
  title,
  applyLabel,
  source,
  initialSelection = null,
  sourceActions,
  permissionError,
  onApply,
  onCancel,
}: {
  readonly title: string;
  readonly applyLabel: string;
  readonly source: VisualAssetSource;
  readonly initialSelection?: VisualAssetOption | null;
  readonly sourceActions?: ReactNode;
  readonly permissionError?: string;
  readonly onApply: (item: VisualAssetOption) => Promise<void> | void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const selectionId = useId();
  const [draft, setDraft] = useState(initialSelection);
  const [showSelected, setShowSelected] = useState(Boolean(initialSelection));
  const [preview, setPreview] = useState<VisualAssetOption | null>(null);
  const [previewBackground, setPreviewBackground] = useState("light");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string>();
  const applyLockRef = useRef(false);
  const selectedCardRef = useRef<HTMLLabelElement | null>(null);
  const locateRequestedRef = useRef(Boolean(initialSelection));
  const selection = source.items.find((item) => item.id === draft?.id) ?? draft;
  const selectionInResults = source.items.some(
    (item) => item.id === selection?.id,
  );
  const visibleItems =
    showSelected && selection && !selectionInResults
      ? [selection, ...source.items]
      : source.items;
  const selectionIssue = permissionError ?? selection?.unavailableReason;
  const changed = selection?.id !== initialSelection?.id;

  useEffect(() => {
    if (
      locateRequestedRef.current &&
      selectedCardRef.current &&
      !source.loading
    ) {
      selectedCardRef.current.scrollIntoView({ block: "nearest" });
      locateRequestedRef.current = false;
    }
  }, [showSelected, source.loading, visibleItems.length]);

  function select(item: VisualAssetOption): void {
    if (item.unavailableReason || permissionError || applying) return;
    setDraft(item);
    setApplyError(undefined);
  }
  function search(query: string): void {
    if (selection) setDraft(selection);
    setShowSelected(false);
    source.onQueryChange(query);
  }
  function locateSelection(): void {
    locateRequestedRef.current = true;
    setShowSelected(true);
    source.onQueryChange("");
  }
  async function apply(): Promise<void> {
    if (!selection || selectionIssue || !changed || applyLockRef.current)
      return;
    applyLockRef.current = true;
    setApplying(true);
    setApplyError(undefined);
    try {
      await onApply(selection);
      onCancel();
    } catch (error) {
      setApplyError(
        error instanceof Error
          ? error.message
          : t("common.visualPicker.applyFailed"),
      );
    } finally {
      applyLockRef.current = false;
      setApplying(false);
    }
  }
  const label = (key: string) => t(`common.visualPicker.${key}`);
  return (
    <>
      <VisualIdentityModal
        open
        title={title}
        width={720}
        applyLabel={applyLabel}
        cancelLabel={t("common.cancel")}
        busy={applying}
        applyDisabled={!selection || !changed || Boolean(selectionIssue)}
        onApply={() => void apply()}
        onCancel={() => {
          if (!applyLockRef.current) onCancel();
        }}
        toolbar={
          <div className="flex min-w-0 items-center gap-2">
            <Input
              value={source.query}
              allowClear
              prefix={<SearchOutlined />}
              aria-label={label("search")}
              placeholder={label("search")}
              disabled={applying}
              onChange={(event) => search(event.target.value)}
            />
            {sourceActions}
          </div>
        }
        footerStart={
          selection ? (
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <span
                className="min-w-0 truncate text-muted"
                title={selection.name}
              >
                {t("common.visualPicker.selected", { name: selection.name })}
              </span>
              {!selectionInResults && !showSelected ? (
                <Button type="link" size="small" onClick={locateSelection}>
                  {label("locate")}
                </Button>
              ) : null}
            </div>
          ) : (
            <span className="text-xs text-muted">{label("choose")}</span>
          )
        }
      >
        <div className="@container grid gap-3 pb-1">
          {selectionIssue || applyError ? (
            <Alert type="error" showIcon title={selectionIssue ?? applyError} />
          ) : null}
          {source.error ? (
            <Alert
              type="error"
              showIcon
              title={source.error}
              action={
                <Button
                  size="small"
                  loading={source.loading}
                  onClick={source.onRetry}
                >
                  {label("retry")}
                </Button>
              }
            />
          ) : null}
          {source.loading && visibleItems.length === 0 ? (
            <div
              aria-label={label("loading")}
              role="status"
              className="grid grid-cols-2 gap-3 @min-[440px]:grid-cols-3 @min-[620px]:grid-cols-4"
            >
              {skeletonCards.map((key) => (
                <div key={key} className="grid gap-2">
                  <Skeleton.Node
                    active
                    className="!h-auto !w-full aspect-[4/3]"
                  />
                  <Skeleton.Input active size="small" className="!w-full" />
                </div>
              ))}
            </div>
          ) : null}
          {visibleItems.length > 0 ? (
            <div
              role="radiogroup"
              aria-label={label("items")}
              className="grid grid-cols-2 gap-3 @min-[440px]:grid-cols-3 @min-[620px]:grid-cols-4"
            >
              {visibleItems.map((item) => {
                const selected = item.id === selection?.id;
                const unavailable = Boolean(
                  item.unavailableReason || permissionError,
                );
                return (
                  <label
                    key={item.id}
                    data-active={selected}
                    data-disabled={unavailable}
                    ref={
                      selected
                        ? (element) => {
                            selectedCardRef.current = element;
                          }
                        : undefined
                    }
                    className="group relative grid min-w-0 cursor-pointer content-start gap-2 rounded-xl border-2 border-transparent p-1 transition-colors hover:bg-mist/60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary data-[active=true]:border-primary data-[active=true]:bg-primary/5 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-55"
                  >
                    <input
                      className="sr-only"
                      type="radio"
                      name={selectionId}
                      aria-label={item.name}
                      checked={selected}
                      disabled={unavailable || applying}
                      onChange={() => select(item)}
                    />
                    <span
                      className="relative block aspect-[4/3] overflow-hidden rounded-lg"
                      style={transparencySurfaceStyle}
                    >
                      {item.thumbnail}
                    </span>
                    {selected ? (
                      <span
                        aria-hidden="true"
                        className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-primary text-xs text-white"
                      >
                        <CheckOutlined />
                      </span>
                    ) : null}
                    <div className="flex min-w-0 items-start gap-1 px-1 pb-1">
                      <span
                        className="line-clamp-2 min-h-10 min-w-0 flex-1 break-words text-xs leading-5 text-ink"
                        title={item.name}
                      >
                        {item.name}
                      </span>
                      <Button
                        type="text"
                        size="small"
                        icon={<ExpandOutlined />}
                        disabled={unavailable}
                        aria-label={t("common.visualPicker.preview", {
                          name: item.name,
                        })}
                        className="!size-10 !shrink-0 sm:!size-8"
                        onClick={() => setPreview(item)}
                      />
                    </div>
                    {item.unavailableReason ? (
                      <span className="px-1 pb-1 text-xs text-danger">
                        {item.unavailableReason}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          ) : null}
          {visibleItems.length === 0 && !source.error && !source.loading ? (
            <div className="py-6 text-center">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={source.query ? label("noResults") : label("empty")}
              />
              {source.query ? (
                <Button onClick={() => search("")}>
                  {label("clearSearch")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {source.more ? (
            <div className="flex flex-col items-center gap-2 py-2">
              {source.more.state === "error" ? (
                <span role="alert" className="text-xs text-danger">
                  {label("moreFailed")}
                </span>
              ) : null}
              <Button
                loading={source.more.state === "loading"}
                onClick={source.more.onLoad}
              >
                {label(source.more.state === "error" ? "retry" : "loadMore")}
              </Button>
            </div>
          ) : null}
        </div>
      </VisualIdentityModal>
      <Modal
        open={Boolean(preview)}
        title={preview?.name}
        width={720}
        centered
        destroyOnHidden
        onCancel={() => setPreview(null)}
        footer={
          <Button onClick={() => setPreview(null)}>
            {label("closePreview")}
          </Button>
        }
      >
        <div className="mb-3 flex justify-end">
          <Segmented
            aria-label={label("previewBackground")}
            value={previewBackground}
            onChange={setPreviewBackground}
            options={[
              { label: label("light"), value: "light" },
              { label: label("dark"), value: "dark" },
            ]}
          />
        </div>
        <div
          className="relative grid h-[min(60dvh,480px)] place-items-center overflow-hidden rounded-xl"
          style={
            previewBackground === "dark"
              ? { backgroundColor: "#202437" }
              : transparencySurfaceStyle
          }
        >
          {preview?.preview}
        </div>
      </Modal>
    </>
  );
}
