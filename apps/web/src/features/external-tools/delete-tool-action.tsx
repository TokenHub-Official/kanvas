import type { CurrentHumanContext, SiteTool } from "@kanvas/contracts/api";
import { Alert, Button, Modal } from "antd";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toolLibrary } from "./library-api.js";
import { useCommand } from "./use-tool-command.js";

export function DeleteToolAction({
  tool,
  context,
  onDeleted,
  trigger,
  help,
}: {
  tool: SiteTool;
  context: CurrentHumanContext;
  onDeleted: () => Promise<unknown>;
  trigger?: (open: () => void) => ReactNode;
  help?: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const command = useCommand(async () => {
    await onDeleted();
    setOpen(false);
  });
  if (tool.state !== "disabled" && !trigger) return null;
  function remove() {
    if (tool.state !== "disabled") return;
    const key = crypto.randomUUID();
    const expectedVersion = tool.version;
    command.run(() =>
      toolLibrary.change(
        context.csrfToken,
        tool.id,
        "delete",
        { expectedVersion },
        key,
      ),
    );
  }
  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <Button type="text" danger onClick={() => setOpen(true)}>
          {t("studio.tools.deletion.action")}
        </Button>
      )}
      <Modal
        open={open}
        title={t("studio.tools.deletion.title", { name: tool.displayName })}
        closable={!command.busy && !command.uncertain}
        mask={{ closable: false }}
        onCancel={() => setOpen(false)}
        cancelButtonProps={{ disabled: command.busy || command.uncertain }}
        okButtonProps={{ danger: true, loading: command.busy }}
        okText={t(
          command.uncertain
            ? "studio.tools.retryOperation"
            : "studio.tools.deletion.action",
        )}
        cancelText={t("studio.tools.editor.cancel")}
        onOk={() => {
          if (command.uncertain) void command.retry();
          else remove();
        }}
      >
        <p>{help ?? t("studio.tools.deletion.help")}</p>
        {command.error ? <Alert type="error" title={command.error} /> : null}
      </Modal>
    </>
  );
}
