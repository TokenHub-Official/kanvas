import { Button, Modal } from "antd";
import { createContext, use, type ReactNode } from "react";

interface SettingsOverlayContextValue {
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}

const SettingsDialogContext = createContext<SettingsOverlayContextValue | null>(
  null,
);
const SettingsAlertContext = createContext<SettingsOverlayContextValue | null>(
  null,
);

function useOverlayContext(
  context: typeof SettingsDialogContext,
  componentName: string,
): SettingsOverlayContextValue {
  const value = use(context);
  if (!value) {
    throw new Error(
      `${componentName} must be used inside its settings overlay root.`,
    );
  }
  return value;
}

export function SettingsDialog({
  children,
  onOpenChange,
  open,
}: {
  readonly children: ReactNode;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}): React.JSX.Element {
  return (
    <SettingsDialogContext value={{ onOpenChange, open }}>
      {children}
    </SettingsDialogContext>
  );
}

export function SettingsDialogContent({
  children,
  closeLabel,
  description,
  dismissible = true,
  scrollable = false,
  title,
  width = 520,
}: {
  readonly children: ReactNode;
  readonly closeLabel: string;
  readonly description?: ReactNode;
  readonly dismissible?: boolean;
  readonly scrollable?: boolean;
  readonly title: ReactNode;
  readonly width?: number;
}): React.JSX.Element {
  const overlay = useOverlayContext(
    SettingsDialogContext,
    "SettingsDialogContent",
  );
  return (
    <Modal
      centered
      closable={
        dismissible
          ? {
              "aria-label": closeLabel,
            }
          : false
      }
      destroyOnHidden
      footer={null}
      mask={{ closable: dismissible }}
      onCancel={() => overlay.onOpenChange(false)}
      open={overlay.open}
      styles={
        scrollable
          ? {
              body: {
                maxHeight: "calc(100dvh - 160px)",
                overflowY: "auto",
                overscrollBehavior: "contain",
              },
            }
          : undefined
      }
      title={title}
      width={width}
    >
      {description ? (
        <div className="mb-5 text-sm leading-6 text-muted">{description}</div>
      ) : null}
      {children}
    </Modal>
  );
}

export function SettingsAlertDialog({
  children,
  onOpenChange,
  open,
}: {
  readonly children: ReactNode;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}): React.JSX.Element {
  return (
    <SettingsAlertContext value={{ onOpenChange, open }}>
      {children}
    </SettingsAlertContext>
  );
}

export function SettingsAlertDialogContent({
  actionLabel,
  actionVariant = "danger",
  cancelLabel,
  children,
  onAction,
  title,
}: {
  readonly actionLabel: string;
  readonly actionVariant?: "danger" | "primary";
  readonly cancelLabel: string;
  readonly children: ReactNode;
  readonly onAction: () => void;
  readonly title: ReactNode;
}): React.JSX.Element {
  const overlay = useOverlayContext(
    SettingsAlertContext,
    "SettingsAlertDialogContent",
  );

  function performAction(): void {
    overlay.onOpenChange(false);
    onAction();
  }

  return (
    <Modal
      cancelText={cancelLabel}
      centered
      closable={false}
      footer={(_, { CancelBtn }) => (
        <>
          <CancelBtn />
          <Button
            danger={actionVariant === "danger"}
            onClick={performAction}
            type="primary"
          >
            {actionLabel}
          </Button>
        </>
      )}
      mask={{ closable: true }}
      onCancel={() => overlay.onOpenChange(false)}
      open={overlay.open}
      title={title}
      width={440}
    >
      <div className="pt-1 text-sm leading-6 text-muted">{children}</div>
    </Modal>
  );
}
