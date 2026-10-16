import {
  CaretRightOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  OrderedListOutlined,
  PauseOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { Button } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn.js";

export type AgentPendingMessageStatus = "queued" | "sending" | "uncertain";

export type AgentQueuePauseReason =
  | "stopped"
  | "cancelled"
  | "failed"
  | "waiting_approval"
  | "waiting_for_user"
  | "delivery_uncertain"
  | "delivery_failed"
  | "branch_changed"
  | "storage_unavailable"
  | "queue_unavailable"
  | "manual";

export interface AgentPendingMessageView {
  readonly id: string;
  readonly text: string;
  readonly status: AgentPendingMessageStatus;
  readonly attachmentCount: number;
  readonly referenceCount: number;
  readonly editable: boolean;
}

const collapsedMessageCount = 3;

export function visibleAgentPendingMessages(
  messages: readonly AgentPendingMessageView[],
  expanded: boolean,
): readonly AgentPendingMessageView[] {
  return expanded ? messages : messages.slice(0, collapsedMessageCount);
}

export function agentQueueResumeIsBlocked(
  reason: AgentQueuePauseReason | undefined,
): boolean {
  return (
    reason === "waiting_approval" ||
    reason === "waiting_for_user" ||
    reason === "storage_unavailable" ||
    reason === "queue_unavailable"
  );
}

export function AgentPendingMessageQueue({
  expanded,
  messages,
  onEditMessage,
  onPause,
  onRemoveMessage,
  onResume,
  onToggleExpanded,
  pauseReason,
  paused,
}: {
  readonly expanded: boolean;
  readonly messages: readonly AgentPendingMessageView[];
  readonly onEditMessage?: (
    id: string,
  ) => boolean | void | Promise<boolean | void>;
  readonly onPause?: () => boolean | void | Promise<boolean | void>;
  readonly onRemoveMessage?: (id: string) => void;
  readonly onResume?: () => void;
  readonly onToggleExpanded?: () => void;
  readonly pauseReason?: AgentQueuePauseReason;
  readonly paused: boolean;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const takingMessageRef = useRef(false);
  const [takingMessageId, setTakingMessageId] = useState<string>();
  const visibleMessages = visibleAgentPendingMessages(messages, expanded);
  const hiddenCount = messages.length - visibleMessages.length;
  const resumeBlocked = agentQueueResumeIsBlocked(pauseReason);

  if (messages.length === 0) return null;

  async function retrieveMessage(messageId: string): Promise<void> {
    if (!onEditMessage || takingMessageRef.current) return;
    takingMessageRef.current = true;
    setTakingMessageId(messageId);
    try {
      await onEditMessage(messageId);
    } catch {
      // The host leaves both the queue and Composer unchanged and shows the error.
    } finally {
      takingMessageRef.current = false;
      setTakingMessageId(undefined);
    }
  }

  return (
    <section
      aria-label={t("agent.messageQueue.title", { count: messages.length })}
      className="mb-2 overflow-hidden rounded-control bg-mist/60 px-2 py-1"
    >
      <header className="flex min-h-8 items-center justify-between gap-3 px-2">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <OrderedListOutlined aria-hidden="true" className="text-muted" />
          <strong className="truncate font-medium text-ink-muted">
            {t("agent.messageQueue.title", { count: messages.length })}
          </strong>
          {paused ? (
            <span className="shrink-0 text-warning">
              {t("agent.messageQueue.paused")}
            </span>
          ) : null}
        </div>
        {paused ? (
          <Button
            aria-label={t("agent.messageQueue.resume")}
            className="shrink-0"
            disabled={
              resumeBlocked || !onResume || takingMessageId !== undefined
            }
            icon={<CaretRightOutlined aria-hidden="true" />}
            onClick={onResume}
            size="small"
            type="text"
          >
            {t("agent.messageQueue.resume")}
          </Button>
        ) : (
          <Button
            aria-label={t("agent.messageQueue.pause")}
            className="shrink-0"
            disabled={!onPause || takingMessageId !== undefined}
            icon={<PauseOutlined aria-hidden="true" />}
            onClick={() => void onPause?.()}
            size="small"
            type="text"
          >
            {t("agent.messageQueue.pause")}
          </Button>
        )}
      </header>

      {paused && pauseReason && pauseReason !== "manual" ? (
        <p
          className="mx-2 mb-1 mt-0 text-xs leading-5 text-warning"
          role="status"
        >
          {t(`agent.messageQueue.pauseReason.${pauseReason}`)}
        </p>
      ) : null}

      <ol className="m-0 grid max-h-60 list-none gap-0 overflow-y-auto p-0">
        {visibleMessages.map((message, index) => {
          const canChange = message.editable && message.status === "queued";
          const canRetrieve = canChange && Boolean(onEditMessage);
          const interactionPending = takingMessageId !== undefined;
          const retrieving = takingMessageId === message.id;
          const metadata = [
            message.attachmentCount > 0
              ? t("agent.messageQueue.attachmentCount", {
                  count: message.attachmentCount,
                })
              : undefined,
            message.referenceCount > 0
              ? t("agent.messageQueue.referenceCount", {
                  count: message.referenceCount,
                })
              : undefined,
          ].filter((entry): entry is string => Boolean(entry));

          return (
            <li
              className={cn(
                "flex h-8 min-w-0 items-center gap-2 rounded-control px-2",
                message.status === "uncertain" && "bg-warning-surface/65",
                message.status !== "uncertain" &&
                  canRetrieve &&
                  !interactionPending &&
                  "hover:bg-paper/60",
              )}
              data-status={message.status}
              key={message.id}
            >
              <span
                aria-label={t("agent.messageQueue.position", {
                  position: index + 1,
                })}
                className="grid size-5 shrink-0 place-items-center text-xs text-muted [font-variant-numeric:tabular-nums]"
              >
                {index + 1}
              </span>
              <button
                aria-label={`${t("agent.messageQueue.edit")}: ${message.text}`}
                className="flex h-8 min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-default"
                disabled={!canRetrieve || interactionPending}
                onClick={() => void retrieveMessage(message.id)}
                title={message.text}
                type="button"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {message.text}
                </span>
                {message.status !== "queued" ? (
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 text-xs text-muted",
                      message.status === "uncertain" && "text-warning",
                    )}
                  >
                    {message.status === "sending" ? (
                      <LoadingOutlined
                        aria-hidden="true"
                        className="motion-reduce:animate-none"
                        spin
                      />
                    ) : null}
                    {message.status === "uncertain" ? (
                      <ExclamationCircleOutlined aria-hidden="true" />
                    ) : null}
                    {t(`agent.messageQueue.status.${message.status}`)}
                  </span>
                ) : null}
                {metadata.length > 0 ? (
                  <span
                    className="hidden max-w-48 shrink-0 truncate text-xs text-muted sm:inline"
                    title={metadata.join(" · ")}
                  >
                    {metadata.join(" · ")}
                  </span>
                ) : null}
              </button>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  aria-label={`${t("agent.messageQueue.edit")}: ${message.text}`}
                  className="grid size-8 place-items-center rounded-[8px] border-0 bg-transparent p-0 text-ink-muted hover:bg-mist-deep hover:text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-35"
                  disabled={!canRetrieve || interactionPending}
                  onClick={() => void retrieveMessage(message.id)}
                  title={t("agent.messageQueue.edit")}
                  type="button"
                >
                  {retrieving ? (
                    <LoadingOutlined
                      aria-hidden="true"
                      className="motion-reduce:animate-none"
                      spin
                    />
                  ) : (
                    <EditOutlined aria-hidden="true" />
                  )}
                </button>
                <button
                  aria-label={`${t("agent.messageQueue.remove")}: ${message.text}`}
                  className="grid size-8 place-items-center rounded-[8px] border-0 bg-transparent p-0 text-ink-muted hover:bg-danger-surface hover:text-danger focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-35"
                  disabled={
                    !canChange || !onRemoveMessage || interactionPending
                  }
                  onClick={() => onRemoveMessage?.(message.id)}
                  title={t("agent.messageQueue.remove")}
                  type="button"
                >
                  <DeleteOutlined aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {messages.length > collapsedMessageCount ? (
        <div className="px-2 pt-1">
          <Button
            block
            disabled={!onToggleExpanded}
            icon={
              expanded ? (
                <UpOutlined aria-hidden="true" />
              ) : (
                <DownOutlined aria-hidden="true" />
              )
            }
            onClick={onToggleExpanded}
            size="small"
            type="text"
          >
            {expanded
              ? t("agent.messageQueue.collapse")
              : t("agent.messageQueue.expand", { count: hiddenCount })}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
