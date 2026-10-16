import { useBlocker } from "@tanstack/react-router";
import { Button, Modal } from "antd";
import { useRef, type ReactNode, type RefObject } from "react";

export function hasUnsavedFormChanges(
  values: readonly string[],
  pending = false,
): boolean {
  return pending || values.some((value) => value.length > 0);
}

export function shouldBlockUnsavedChanges(
  active: boolean,
  bypassed: boolean,
): boolean {
  return active && !bypassed;
}

export function UnsavedChangesGuard({
  actionLabel = "放弃并离开",
  cancelLabel = "继续填写",
  active,
  bypass,
  children,
  title,
}: {
  readonly actionLabel?: string;
  readonly cancelLabel?: string;
  readonly active: boolean;
  readonly bypass?: RefObject<boolean>;
  readonly children: ReactNode;
  readonly title: string;
}): React.JSX.Element {
  const internalBypassRef = useRef(false);
  const activeBypass = bypass ?? internalBypassRef;
  const blocker = useBlocker({
    disabled: !active,
    enableBeforeUnload: () =>
      shouldBlockUnsavedChanges(active, activeBypass.current),
    shouldBlockFn: () =>
      shouldBlockUnsavedChanges(active, activeBypass.current),
    withResolver: true,
  });

  return (
    <Modal
      cancelButtonProps={{ autoFocus: true }}
      cancelText={cancelLabel}
      centered
      closable={false}
      footer={(_, { CancelBtn }) => (
        <>
          <CancelBtn />
          <Button
            danger
            onClick={() => {
              blocker.proceed?.();
            }}
            type="primary"
          >
            {actionLabel}
          </Button>
        </>
      )}
      mask={{ closable: false }}
      onCancel={() => {
        blocker.reset?.();
      }}
      open={blocker.status === "blocked"}
      title={title}
      width={440}
    >
      <div className="pt-1 text-sm leading-6 text-muted">{children}</div>
    </Modal>
  );
}
