import type { CanvasDraft } from "@kanvas/contracts/api";
import {
  DownloadOutlined,
  MergeOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Button, Modal, Spin } from "antd";
import { useState } from "react";

const conflictDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
  day: "2-digit",
});

function conflictTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : conflictDateFormatter.format(date);
}

export function CanvasSaveConflictDialog({
  error,
  latestDraft,
  localSummary,
  onKeepLocal,
  onOpenChange,
  onReadLatest,
  onUseLatest,
  open,
  resolving,
}: {
  readonly error?: string;
  readonly latestDraft?: CanvasDraft;
  readonly localSummary: {
    readonly pageCount: number;
    readonly title: string;
    readonly version?: number;
  };
  readonly onKeepLocal: () => Promise<void>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onReadLatest: () => Promise<void>;
  readonly onUseLatest: () => Promise<void>;
  readonly open: boolean;
  readonly resolving?: "keep_local" | "use_latest";
}): React.JSX.Element {
  const [confirmUseLatest, setConfirmUseLatest] = useState(false);
  const [actionError, setActionError] = useState<string>();

  async function keepLocal(): Promise<void> {
    setActionError(undefined);
    try {
      await onKeepLocal();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "暂时无法保存本窗口修改。",
      );
    }
  }

  async function acceptLatest(): Promise<void> {
    setActionError(undefined);
    try {
      await onUseLatest();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "暂时无法切换到最新版本。",
      );
    }
  }

  function updateDialogVisibility(nextOpen: boolean): void {
    if (!nextOpen) {
      setConfirmUseLatest(false);
      setActionError(undefined);
    }
    onOpenChange(nextOpen);
  }

  return (
    <>
      <Modal
        centered
        classNames={{
          body: "max-h-[min(76vh,680px)] overflow-y-auto",
          container: "overflow-hidden",
          header: "pr-10",
        }}
        footer={null}
        focusable={{ focusTriggerAfterClose: true, trap: true }}
        onCancel={() => updateDialogVisibility(false)}
        open={open}
        title={
          <div className="grid gap-1">
            <span>选择要继续的内容</span>
            <span className="text-xs font-normal leading-5 text-[var(--muted)]">
              画板在另一个窗口产生了新版本，因此没有自动覆盖。
            </span>
          </div>
        }
        width={660}
      >
        <div className="pt-2">
          {latestDraft ? (
            <div className="grid">
              <section className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-[var(--line)] pt-1 pb-[18px] max-[640px]:grid-cols-[24px_minmax(0,1fr)]">
                <MergeOutlined
                  aria-hidden="true"
                  className="text-lg text-[var(--primary)]"
                />
                <div>
                  <h3 className="m-0 text-sm font-bold">保留本窗口修改</h3>
                  <dl className="mt-[7px] mb-0 grid gap-[3px] text-xs">
                    <div className="grid min-w-0 grid-cols-[38px_minmax(0,1fr)] gap-1.5">
                      <dt className="text-[var(--muted)]">标题</dt>
                      <dd className="m-0 min-w-0 truncate text-[var(--ink)]">
                        {localSummary.title}
                      </dd>
                    </div>
                    <div className="grid min-w-0 grid-cols-[38px_minmax(0,1fr)] gap-1.5">
                      <dt className="text-[var(--muted)]">内容</dt>
                      <dd className="m-0 min-w-0 truncate text-[var(--ink)]">
                        {String(localSummary.pageCount)} 页
                        {localSummary.version
                          ? ` · 基于版本 ${String(localSummary.version)}`
                          : " · 尚未首次保存"}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-1 mb-0 max-w-[48ch] text-xs leading-relaxed text-[var(--muted)]">
                    基于版本 {String(latestDraft.version)}{" "}
                    保存本窗口内容，另一个版本仍保留在历史中。
                  </p>
                </div>
                <Button
                  className="max-[640px]:col-start-2 max-[640px]:justify-self-start"
                  loading={resolving === "keep_local"}
                  onClick={() => {
                    void keepLocal();
                  }}
                  type="primary"
                >
                  保留本窗口修改
                </Button>
              </section>

              <section className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-[var(--line)] py-[18px] max-[640px]:grid-cols-[24px_minmax(0,1fr)]">
                <DownloadOutlined
                  aria-hidden="true"
                  className="text-lg text-[var(--muted)]"
                />
                <div>
                  <h3 className="m-0 text-sm font-bold">使用最新版本</h3>
                  <dl className="mt-[7px] mb-0 grid gap-[3px] text-xs">
                    <div className="grid min-w-0 grid-cols-[38px_minmax(0,1fr)] gap-1.5">
                      <dt className="text-[var(--muted)]">标题</dt>
                      <dd className="m-0 min-w-0 truncate text-[var(--ink)]">
                        {latestDraft.document.title}
                      </dd>
                    </div>
                    <div className="grid min-w-0 grid-cols-[38px_minmax(0,1fr)] gap-1.5">
                      <dt className="text-[var(--muted)]">内容</dt>
                      <dd className="m-0 min-w-0 truncate text-[var(--ink)]">
                        {String(latestDraft.document.pages.length)} 页{" · "}
                        {conflictTime(latestDraft.updatedAt)} 保存
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-1 mb-0 max-w-[48ch] text-xs leading-relaxed text-[var(--muted)]">
                    切换到最近保存的内容。尚未保存的排版修改将被放弃。
                  </p>
                </div>
                <Button
                  className="max-[640px]:col-start-2 max-[640px]:justify-self-start"
                  disabled={Boolean(resolving)}
                  loading={resolving === "use_latest"}
                  onClick={() => {
                    setConfirmUseLatest(true);
                  }}
                >
                  使用最新版本
                </Button>
              </section>
              {(actionError ?? error) ? (
                <p
                  className="mt-4 mb-0 text-sm text-[var(--danger)]"
                  role="alert"
                >
                  {actionError ?? error}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="grid min-h-[180px] place-items-center content-center gap-2.5 text-center">
              {error ? null : <Spin size="large" />}
              <strong>
                {error ? "暂时无法读取最新版本" : "正在读取最新版本"}
              </strong>
              {error ? (
                <p
                  className="m-0 max-w-[48ch] text-xs leading-relaxed text-[var(--danger)]"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              {error ? (
                <Button
                  onClick={() => {
                    void onReadLatest();
                  }}
                  size="small"
                >
                  <ReloadOutlined aria-hidden="true" />
                  重新读取
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        cancelText="取消"
        centered
        confirmLoading={resolving === "use_latest"}
        okButtonProps={{ danger: true }}
        okText="放弃本窗口修改"
        onCancel={() => setConfirmUseLatest(false)}
        onOk={() => {
          void acceptLatest();
        }}
        open={confirmUseLatest}
        title="使用最新版本？"
      >
        <p className="m-0 leading-6 text-[var(--muted)]">
          本窗口尚未保存的排版修改会被替换。请先确认没有仍在上传的图片。
        </p>
        {actionError ? (
          <p className="mt-3 mb-0 text-[var(--danger)]" role="alert">
            {actionError}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
