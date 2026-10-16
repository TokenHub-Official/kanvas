import {
  CheckOutlined,
  DownloadOutlined,
  FolderAddOutlined,
  InfoCircleOutlined,
  LayoutOutlined,
  LoadingOutlined,
  MessageOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import type { AgentThreadView } from "@kanvas/contracts/api";
import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, type MenuProps } from "antd";
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ulid } from "ulid";
import {
  createWorkspaceAssetFromArtifact,
  downloadArtifact,
} from "../../api/transport.js";
import { agentTaskDisplayText } from "./agent-task-presentation.js";
type Task = AgentThreadView["tasks"][number];
type Artifact = NonNullable<Task["resultArtifacts"]>[number];
const maximumAssetNameLength = 240;

function pendingAssetSaveKey(workspaceId: string, artifactId: string): string {
  return `kanvas:agent-asset-save:${workspaceId}:${artifactId}`;
}

interface PendingAssetSave {
  readonly idempotencyKey: string;
  readonly name: string;
}

function pendingAssetSave(
  workspaceId: string,
  artifactId: string,
): PendingAssetSave | undefined {
  try {
    const raw = sessionStorage.getItem(
      pendingAssetSaveKey(workspaceId, artifactId),
    );
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.idempotencyKey === "string" &&
      /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(candidate.idempotencyKey) &&
      typeof candidate.name === "string" &&
      candidate.name.length > 0 &&
      [...candidate.name].length <= maximumAssetNameLength
      ? {
          idempotencyKey: candidate.idempotencyKey,
          name: candidate.name,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function useSaveArtifactMenuItem({
  artifactId,
  assetId,
  csrfToken,
  name,
  workspaceId,
}: {
  readonly artifactId: string;
  readonly assetId?: string;
  readonly csrfToken?: string;
  readonly name: string;
  readonly workspaceId: string;
}) {
  const { t } = useTranslation();
  const { notification } = App.useApp();
  const queryClient = useQueryClient();
  const [savedId, setSavedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef<PendingAssetSave | undefined>(
    pendingAssetSave(workspaceId, artifactId),
  );
  const savedAssetId = assetId ?? savedId;

  async function save(): Promise<void> {
    if (savingRef.current || savedAssetId || !csrfToken) return;
    savingRef.current = true;
    setBusy(true);
    const pending = pendingSaveRef.current ?? {
      idempotencyKey: ulid(),
      name: [...(name.trim() || t("agent.savedResultDefaultName"))]
        .slice(0, maximumAssetNameLength)
        .join(""),
    };
    pendingSaveRef.current = pending;
    try {
      sessionStorage.setItem(
        pendingAssetSaveKey(workspaceId, artifactId),
        JSON.stringify(pending),
      );
    } catch {
      // This tab retains the same request identity even when storage is blocked.
    }
    try {
      const result = await createWorkspaceAssetFromArtifact(
        { csrfToken, workspaceId },
        {
          assetId: pending.idempotencyKey,
          artifactId,
          name: pending.name,
        },
      );
      setSavedId(result.assetId);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["agent-thread", workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["workspace-assets", workspaceId],
        }),
      ]);
      notification.success({ title: t("agent.taskSavedToAssets") });
    } catch {
      notification.error({ title: t("agent.taskSaveToAssetsError") });
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  const statusIcon = savedAssetId ? <CheckOutlined /> : <FolderAddOutlined />;
  return {
    key: "save",
    icon: busy ? <LoadingOutlined /> : statusIcon,
    label: t(savedAssetId ? "agent.savedToAssets" : "agent.saveToAssets"),
    disabled: busy || Boolean(savedAssetId) || !csrfToken,
    onClick: () => void save(),
  };
}

export function AgentArtifactContextMenu({
  children,
  ...props
}: {
  readonly artifactId: string;
  readonly assetId?: string;
  readonly csrfToken?: string;
  readonly name: string;
  readonly workspaceId: string;
  readonly canSave: boolean;
  readonly children: ReactNode;
}) {
  const saveItem = useSaveArtifactMenuItem(props);
  if (!props.canSave || !props.csrfToken) return <>{children}</>;
  return (
    <Dropdown menu={{ items: [saveItem] }} trigger={["contextMenu"]}>
      <div>{children}</div>
    </Dropdown>
  );
}

export function taskArtifactFilename(blob: Blob, title: string): string {
  if (/\.[a-z0-9]{2,8}$/iu.test(title)) return title;
  let extension = "bin";
  if (blob.type.includes("png")) extension = "png";
  else if (blob.type.includes("webp")) extension = "webp";
  else if (blob.type.includes("jpeg")) extension = "jpg";
  else if (blob.type.includes("pdf")) extension = "pdf";
  return `${title}.${extension}`;
}
export function AgentResultCard({
  task,
  artifact,
  workspaceId,
  canDownload,
  canSave,
  csrfToken,
  children,
  onAddToComposer,
  onEdit,
  onDetails,
}: {
  readonly task: Task;
  readonly artifact: Artifact;
  readonly workspaceId: string;
  readonly canDownload: boolean;
  readonly canSave: boolean;
  readonly csrfToken?: string;
  readonly children: ReactNode;
  readonly onAddToComposer?: () => void;
  readonly onEdit?: (task: Task) => Promise<void>;
  readonly onDetails: () => void;
}) {
  const { t } = useTranslation();
  const taskDisplay = agentTaskDisplayText(task, t);
  const { notification } = App.useApp();
  const [busy, setBusy] = useState<"download" | "edit">();
  const saveItem = useSaveArtifactMenuItem({
    artifactId: artifact.resourceId,
    ...(artifact.assetId ? { assetId: artifact.assetId } : {}),
    ...(csrfToken ? { csrfToken } : {}),
    name: artifact.title ?? taskDisplay.title,
    workspaceId,
  });
  async function download(): Promise<void> {
    setBusy("download");
    try {
      const blob = await downloadArtifact(workspaceId, artifact.resourceId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = taskArtifactFilename(
        blob,
        artifact.title ?? taskDisplay.title,
      );
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      notification.error({ title: t("agent.taskDownloadError") });
    } finally {
      setBusy(undefined);
    }
  }
  async function edit(): Promise<void> {
    setBusy("edit");
    try {
      await onEdit?.(task);
    } catch {
      notification.error({ title: t("agent.openCanvasError") });
    } finally {
      setBusy(undefined);
    }
  }
  const menuItems: MenuProps["items"] = [
    ...(onAddToComposer
      ? [
          {
            key: "refine",
            icon: <MessageOutlined />,
            label: t("agent.refineResult"),
          },
        ]
      : []),
    ...(onEdit
      ? [
          {
            key: "edit",
            icon: <LayoutOutlined />,
            label: t("agent.continueTask"),
          },
        ]
      : []),
    ...(canDownload
      ? [
          {
            key: "download",
            icon: <DownloadOutlined />,
            label: t("agent.download"),
          },
        ]
      : []),
    ...(canSave && csrfToken ? [saveItem] : []),
    {
      key: "details",
      icon: <InfoCircleOutlined />,
      label: t("agent.navigation.details"),
    },
  ];
  const menu: MenuProps = {
    items: menuItems,
    onClick: ({ key }) => {
      if (key === "refine") onAddToComposer?.();
      if (key === "edit") void edit();
      if (key === "download") void download();
      if (key === "details") onDetails();
    },
  };
  return (
    <Dropdown menu={menu} trigger={["contextMenu"]}>
      <div className="grid w-full max-w-[420px] gap-2">
        {children}
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label={t("agent.taskResultActions")}
        >
          {canDownload ? (
            <Button
              size="small"
              icon={<DownloadOutlined />}
              loading={busy === "download"}
              disabled={busy === "edit"}
              onClick={() => void download()}
            >
              {t("agent.download")}
            </Button>
          ) : null}
          <Dropdown menu={menu} trigger={["click"]}>
            <Button
              aria-label={t("agent.moreResultActions")}
              icon={<MoreOutlined />}
              size="small"
              title={t("agent.moreResultActions")}
              type="text"
            />
          </Dropdown>
        </div>
      </div>
    </Dropdown>
  );
}
