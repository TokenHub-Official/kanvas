import {
  invalidateResourceQueries,
  notifyResourceStateChange,
} from "../api/resource-state-events.js";
import { DeleteOutlined, MoreOutlined, UndoOutlined } from "@ant-design/icons";
import type { ResourceStateList } from "@kanvas/contracts/api";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Drawer,
  Dropdown,
  Empty,
  Modal,
  Skeleton,
  Tag,
  type MenuProps,
} from "antd";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ApiProblem,
  changeResourceState,
  fetchResourceStates,
} from "../api/transport.js";

type Kind = "agent" | "skill";
export function useResourceStates(
  workspaceId: string,
  kind: Kind,
  enabled = true,
) {
  return useQuery({
    queryKey: ["resource-states", workspaceId, kind],
    queryFn: () => fetchResourceStates(workspaceId, kind),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    enabled,
  });
}
export function ResourceActions({
  workspaceId,
  csrfToken,
  kind,
  id,
  onDeleted,
  disabled = false,
  showStatus = true,
  additionalItems,
}: {
  readonly workspaceId: string;
  readonly csrfToken: string;
  readonly kind: Kind;
  readonly id: string;
  readonly onDeleted?: () => void;
  readonly disabled?: boolean;
  readonly showStatus?: boolean;
  readonly additionalItems?: MenuProps["items"];
}) {
  const { t } = useTranslation();
  const states = useResourceStates(workspaceId, kind);
  const record = states.data?.items.find((item) => item.id === id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { notification } = App.useApp();
  const [modal, context] = Modal.useModal();
  const [pending, setPending] = useState(false);
  async function change(
    item: ResourceStateList["items"][number],
    state: "enabled" | "disabled" | "deleted",
  ) {
    setPending(true);
    try {
      await changeResourceState({ workspaceId, csrfToken }, kind, id, {
        expectedVersion: item.version,
        state,
      });
      notifyResourceStateChange(workspaceId);
      await invalidateResourceQueries(queryClient, workspaceId);
      if (state === "deleted") {
        if (onDeleted) onDeleted();
        else
          await navigate({
            to:
              kind === "agent"
                ? "/w/$workspaceId/agents"
                : "/w/$workspaceId/skills",
            params: { workspaceId },
          });
      }
      if (item.state === "deleted")
        notification.success({ title: t("agent.lifecycle.restored") });
    } catch (error) {
      const code =
        error instanceof ApiProblem ? error.code.split(".").at(-1) : "failed";
      notification.error({
        title: t(`agent.lifecycle.errors.${code}`, {
          defaultValue: t("agent.lifecycle.errors.failed"),
        }),
      });
    } finally {
      setPending(false);
    }
  }
  if (!record) return null;
  if (record.state === "deleted" && !record.canManage)
    return <Tag color="error">{t("agent.lifecycle.deleted")}</Tag>;
  if (!record.canManage && !additionalItems?.length) return null;
  if (record.state === "deleted")
    return (
      <Button
        icon={<UndoOutlined />}
        loading={pending}
        onClick={() => void change(record, "disabled")}
      >
        {t("agent.lifecycle.restore")}
      </Button>
    );
  return (
    <>
      {context}
      {showStatus && record.state === "disabled" && (
        <Tag color="warning" className="!m-0">
          {t("agent.lifecycle.disabled")}
        </Tag>
      )}
      <Dropdown
        trigger={["click"]}
        menu={{
          items: [
            ...(additionalItems ?? []),
            ...(additionalItems?.length && record.canManage
              ? [{ type: "divider" as const }]
              : []),
            ...(record.canManage
              ? [
                  {
                    key: "toggle",
                    disabled: record.state === "disabled" && !record.canEnable,
                    label: t(
                      record.state === "enabled"
                        ? "agent.lifecycle.disable"
                        : "agent.lifecycle.enable",
                    ),
                    onClick: () => {
                      if (record.state === "disabled") {
                        void change(record, "enabled");
                        return;
                      }
                      void modal.confirm({
                        title: t("agent.lifecycle.disableTitle", {
                          name: record.displayName,
                        }),
                        content: t("agent.lifecycle.disableImpact"),
                        okText: t("agent.lifecycle.disable"),
                        cancelText: t("agent.cancel"),
                        onOk: () => change(record, "disabled"),
                      });
                    },
                  },
                  { type: "divider" as const },
                  {
                    key: "delete",
                    danger: true,
                    label: t("agent.lifecycle.delete"),
                    onClick: () =>
                      void modal.confirm({
                        autoFocusButton: "cancel",
                        title: t("agent.lifecycle.deleteTitle", {
                          name: record.displayName,
                        }),
                        content: (
                          <div className="grid gap-2">
                            <span>{t("agent.lifecycle.deleteImpact")}</span>
                            {record.boundAgentCount > 0 && (
                              <span>
                                {t("agent.lifecycle.boundAgents", {
                                  count: record.boundAgentCount,
                                })}
                              </span>
                            )}
                          </div>
                        ),
                        okText: t("agent.lifecycle.delete"),
                        cancelText: t("agent.cancel"),
                        okButtonProps: { danger: true },
                        onOk: () => change(record, "deleted"),
                      }),
                  },
                ]
              : []),
          ],
        }}
      >
        <Button
          type="text"
          size="small"
          icon={<MoreOutlined />}
          loading={pending}
          disabled={disabled || pending}
          aria-label={t("agent.lifecycle.actions", {
            name: record.displayName,
          })}
        />
      </Dropdown>
    </>
  );
}
export function ResourceTrash({
  workspaceId,
  csrfToken,
  kind,
}: {
  readonly workspaceId: string;
  readonly csrfToken: string;
  readonly kind: Kind;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const states = useResourceStates(workspaceId, kind);
  const items =
    states.data?.items.filter((item) => item.state === "deleted") ?? [];
  let content: ReactNode = (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={t("agent.lifecycle.trashEmpty")}
    />
  );
  if (states.isPending) content = <Skeleton active />;
  else if (states.isError)
    content = (
      <Alert
        type="error"
        title={t("agent.lifecycle.errors.failed")}
        action={
          <Button onClick={() => void states.refetch()}>
            {t("agent.editor.retry")}
          </Button>
        }
      />
    );
  else if (items.length)
    content = (
      <div className="divide-y divide-line">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-4 py-4"
          >
            <div className="min-w-0">
              <div className="break-words text-sm font-medium">
                {item.displayName}
              </div>
              <p className="mt-1 mb-0 truncate text-sm text-muted">
                {item.summary}
              </p>
            </div>
            <ResourceActions
              workspaceId={workspaceId}
              csrfToken={csrfToken}
              kind={kind}
              id={item.id}
            />
          </div>
        ))}
      </div>
    );
  return (
    <>
      <Button icon={<DeleteOutlined />} onClick={() => setOpen(true)}>
        {t("agent.lifecycle.trash")}
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={t("agent.lifecycle.trash")}
        size={560}
      >
        {content}
      </Drawer>
    </>
  );
}

export function ResourceUnavailable({
  workspaceId,
  csrfToken,
  kind,
  id,
  children,
}: {
  readonly workspaceId: string;
  readonly csrfToken: string;
  readonly kind: Kind;
  readonly id: string;
  readonly children?: ReactNode;
}) {
  const { t } = useTranslation();
  const states = useResourceStates(workspaceId, kind);
  const record = states.data?.items.find(
    (item) => item.id === id || item.draftIds.includes(id),
  );
  if (!record || record.state !== "deleted") return children ?? null;
  return (
    <Alert
      showIcon
      type="info"
      title={t("agent.lifecycle.deletedTitle", { name: record.displayName })}
      action={
        <ResourceActions
          workspaceId={workspaceId}
          csrfToken={csrfToken}
          kind={kind}
          id={record.id}
        />
      }
    />
  );
}
