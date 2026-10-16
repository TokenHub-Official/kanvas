import { Button, Modal } from "antd";
import type { ReactNode } from "react";

/** Shared editing shell for avatars, logos, and other visual identities. */
export function VisualIdentityModal({
  applyDisabled = false,
  applyLabel,
  busy = false,
  cancelLabel,
  children,
  toolbar,
  footerStart,
  onApply,
  onCancel,
  open,
  title,
  width = 520,
}: {
  readonly applyDisabled?: boolean;
  readonly applyLabel: string;
  readonly busy?: boolean;
  readonly cancelLabel: string;
  readonly children: ReactNode;
  readonly toolbar?: ReactNode;
  readonly footerStart?: ReactNode;
  readonly onApply: () => void;
  readonly onCancel: () => void;
  readonly open: boolean;
  readonly title: string;
  readonly width?: number;
}): React.JSX.Element {
  return (
    <Modal
      centered
      closable={!busy}
      destroyOnHidden
      mask={{ closable: !busy }}
      onCancel={onCancel}
      open={open}
      title={title}
      width={width}
      styles={{
        container: {
          maxHeight: "calc(100dvh - 32px)",
          display: "flex",
          flexDirection: "column",
        },
        body: {
          minHeight: 0,
          minWidth: 0,
          overflowY: "auto",
          overflowX: "hidden",
        },
      }}
      footer={
        <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          {footerStart ? (
            <div className="min-w-0 text-left">{footerStart}</div>
          ) : null}
          <div
            className={`flex justify-end gap-2 ${footerStart ? "" : "col-span-full"}`}
          >
            <Button disabled={busy} onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button
              disabled={applyDisabled}
              loading={busy}
              onClick={onApply}
              type="primary"
            >
              {applyLabel}
            </Button>
          </div>
        </div>
      }
    >
      {toolbar ? (
        <div className="sticky top-0 z-10 bg-paper pb-3">{toolbar}</div>
      ) : null}
      {children}
    </Modal>
  );
}
