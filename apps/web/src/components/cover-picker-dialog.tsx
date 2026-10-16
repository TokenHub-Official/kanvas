import { httpStatus } from "../api/http-status.js";
import { ApiProblem } from "../api/transport.js";
import { CheckOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Input, Modal, Skeleton, Upload } from "antd";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface CoverPickerItem {
  readonly id: string;
  readonly name: string;
  readonly thumbnail: ReactNode;
}

/** Mount when opened: a local selection is applied only by explicit confirmation. */
export function CoverPickerDialog({
  initialSelection,
  items,
  loading,
  loadError,
  canUpload,
  onRetry,
  onUpload,
  onCancel,
  onConfirm,
}: {
  initialSelection: string | null;
  items: readonly CoverPickerItem[];
  loading: boolean;
  loadError?: string;
  canUpload: boolean;
  onRetry: () => void;
  onUpload: (file: File, signal: AbortSignal) => Promise<CoverPickerItem>;
  onCancel: () => void;
  onConfirm: (id: string | null) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [selection, setSelection] = useState(initialSelection);
  const [query, setQuery] = useState("");
  const [uploaded, setUploaded] = useState<readonly CoverPickerItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const [retryable, setRetryable] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<File | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const merged = [
    ...uploaded,
    ...items.filter((item) => !uploaded.some((added) => added.id === item.id)),
  ];
  const visible = merged.filter((item) =>
    item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  async function selectFile(file: File) {
    if (uploading || abortRef.current || !canUpload) return;
    fileRef.current = file;
    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setError(undefined);
    try {
      const item = await onUpload(file, controller.signal);
      if (controller.signal.aborted) return;
      setUploaded((previous) => [
        item,
        ...previous.filter((existing) => existing.id !== item.id),
      ]);
      setSelection(item.id);
      setQuery("");
    } catch (failure) {
      if (!controller.signal.aborted) {
        const status =
          failure instanceof ApiProblem ? failure.status : undefined;
        let key = "uploadError";
        if (status === httpStatus.badRequest) key = "invalidImage";
        if (status === httpStatus.payloadTooLarge) key = "tooLarge";
        if (
          status === httpStatus.unauthorized ||
          status === httpStatus.forbidden
        )
          key = "permissionError";
        setRetryable(
          status !== httpStatus.badRequest &&
            status !== httpStatus.payloadTooLarge &&
            status !== httpStatus.unauthorized &&
            status !== httpStatus.forbidden,
        );
        setError(t(`common.coverPicker.${key}`));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (!controller.signal.aborted) setUploading(false);
    }
  }
  function cancel() {
    abortRef.current?.abort();
    onCancel();
  }
  return (
    <Modal
      open
      title={t("common.coverPicker.title")}
      onCancel={cancel}
      onOk={() => onConfirm(selection)}
      okText={t("common.coverPicker.apply")}
      cancelText={t("common.coverPicker.cancel")}
      okButtonProps={{ disabled: uploading }}
    >
      <div className="flex items-center gap-3">
        <Input.Search
          aria-label={t("common.coverPicker.search")}
          placeholder={t("common.coverPicker.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          allowClear
        />
        {canUpload ? (
          <Upload
            accept="image/png,image/jpeg,image/webp"
            showUploadList={false}
            disabled={uploading}
            beforeUpload={(file) => {
              void selectFile(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} loading={uploading}>
              {t("common.coverPicker.upload")}
            </Button>
          </Upload>
        ) : null}
      </div>
      {error ? (
        <Alert
          className="mt-4"
          showIcon
          type="error"
          title={error}
          action={
            retryable ? (
              <Button
                disabled={uploading}
                onClick={() => {
                  if (fileRef.current) void selectFile(fileRef.current);
                }}
              >
                {t("common.coverPicker.retry")}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {loadError ? (
        <Alert
          className="mt-4"
          showIcon
          type="error"
          title={loadError}
          action={
            <Button onClick={onRetry}>{t("common.coverPicker.retry")}</Button>
          }
        />
      ) : null}
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-muted">
          {selection
            ? t("common.coverPicker.selected")
            : t("common.coverPicker.noCover")}
        </span>
        <Button
          type="text"
          disabled={uploading || selection === null}
          onClick={() => setSelection(null)}
        >
          {t("common.coverPicker.remove")}
        </Button>
      </div>
      <div className="mt-2 max-h-96 overflow-auto p-1">
        {loading && !merged.length ? <Skeleton active /> : null}
        {!loading && !loadError && !visible.length ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t(
              query
                ? "common.coverPicker.noMatches"
                : "common.coverPicker.empty",
            )}
          />
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visible.map((item) => (
            <Button
              key={item.id}
              type="text"
              disabled={uploading}
              aria-pressed={selection === item.id}
              aria-label={item.name}
              onClick={() => setSelection(item.id)}
              styles={{
                root: { height: "auto", padding: 8 },
                content: { display: "block", width: "100%" },
              }}
              className={selection === item.id ? "ring-2 ring-primary" : ""}
            >
              <span className="block w-full">
                <span className="relative block aspect-[4/3] overflow-hidden rounded-lg bg-mist">
                  {item.thumbnail}
                  {selection === item.id ? (
                    <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-white">
                      <CheckOutlined />
                    </span>
                  ) : null}
                </span>
                <span
                  className="mt-2 block truncate text-left text-xs"
                  title={item.name}
                >
                  {item.name}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
