import { ActionLink } from "../../components/action-link.js";
import type { CurrentHumanContext, SiteTool } from "@kanvas/contracts/api";
import { EllipsisOutlined } from "@ant-design/icons";
import { Link } from "@tanstack/react-router";
import { Alert, Button, Dropdown, Modal } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DeleteToolAction } from "./delete-tool-action.js";
import { toolLibrary } from "./library-api.js";
import { useCommand } from "./use-tool-command.js";

export function ToolListActions({
  tool,
  context,
  refresh,
}: {
  tool: SiteTool;
  context: CurrentHumanContext;
  refresh: () => Promise<unknown>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  const command = useCommand(async () => {
    await refresh();
    setConfirm(false);
  });
  const enable = tool.state === "disabled";
  const workspace = context.workspaces.find((w) =>
    w.permissions.includes("workspace.read"),
  );
  const actionLabel = enable ? "studio.tools.enable" : "studio.tools.disable";
  let helpLabel = tool.publishedRevision
    ? "studio.tools.list.disableHelp"
    : "studio.tools.list.disableDraftHelp";
  if (enable) helpLabel = "studio.tools.list.enableHelp";
  function apply() {
    const key = crypto.randomUUID();
    command.run(() =>
      toolLibrary.change(
        context.csrfToken,
        tool.id,
        "availability",
        {
          expectedVersion: tool.version,
          enabled: enable,
        },
        key,
      ),
    );
  }
  return (
    <div className="flex items-center justify-end gap-1">
      <DeleteToolAction
        tool={tool}
        context={context}
        onDeleted={refresh}
        help={t("studio.tools.list.deleteHelp")}
        trigger={(openDelete) => (
          <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            disabled={command.busy || command.uncertain}
            menu={{
              items: [
                ...(workspace && tool.state === "enabled"
                  ? [
                      {
                        key: "open",
                        label: (
                          <Link
                            to="/w/$workspaceId/tools/$slug"
                            params={{
                              workspaceId: workspace.id,
                              slug: tool.slug,
                            }}
                          >
                            {t("studio.tools.editor.open")}
                          </Link>
                        ),
                      },
                    ]
                  : []),
                ...(!enable || tool.publishedRevision
                  ? [
                      {
                        key: "availability",
                        label: t(
                          enable
                            ? "studio.tools.enable"
                            : "studio.tools.disable",
                        ),
                      },
                    ]
                  : []),
                ...(tool.state === "disabled"
                  ? [
                      {
                        key: "delete",
                        danger: true,
                        label: t("studio.tools.deletion.action"),
                      },
                    ]
                  : []),
              ],
              onClick: ({ key }) => {
                if (key === "delete") openDelete();
                else if (key === "availability") setConfirm(true);
              },
            }}
          >
            <Button
              type="text"
              icon={<EllipsisOutlined />}
              aria-label={t("studio.tools.list.more", {
                name: tool.displayName,
              })}
            />
          </Dropdown>
        )}
      />
      <ActionLink
        size="small"
        color="primary"
        variant="filled"
        to="/admin/tools/$toolId"
        params={{ toolId: tool.id }}
      >
        {t("studio.tools.list.manage")}
      </ActionLink>
      <Modal
        open={confirm}
        title={t(
          enable
            ? "studio.tools.list.enableTitle"
            : "studio.tools.list.disableTitle",
          { name: tool.displayName },
        )}
        onCancel={() => setConfirm(false)}
        closable={!command.busy && !command.uncertain}
        mask={{ closable: false }}
        cancelButtonProps={{ disabled: command.busy || command.uncertain }}
        okButtonProps={{ loading: command.busy }}
        cancelText={t("studio.tools.editor.cancel")}
        okText={t(
          command.uncertain ? "studio.tools.retryOperation" : actionLabel,
        )}
        onOk={() => {
          if (command.uncertain) void command.retry();
          else apply();
        }}
      >
        <p>{t(helpLabel)}</p>
        {command.error ? <Alert type="error" title={command.error} /> : null}
      </Modal>
    </div>
  );
}
