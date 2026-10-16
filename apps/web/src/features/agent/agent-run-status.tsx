import { LoadingOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
const longQueueWaitMs = 60_000;
const refreshWaitMs = 5_000;
export function agentQueueWaitIsLong(
  updatedAt: string | undefined,
  now: number,
): boolean {
  return Boolean(updatedAt && now - Date.parse(updatedAt) >= longQueueWaitMs);
}
export function AgentRunStatus({
  status,
  updatedAt,
}: {
  readonly status?: "queued" | "running";
  readonly updatedAt?: string;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (status !== "queued") return;
    const timer = window.setInterval(() => setNow(Date.now()), refreshWaitMs);
    return () => window.clearInterval(timer);
  }, [status]);
  const longWait = status === "queued" && agentQueueWaitIsLong(updatedAt, now);
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-6 grid max-w-[780px] gap-1 text-sm text-ink-muted"
    >
      <span className="flex items-center gap-2">
        <LoadingOutlined aria-hidden="true" spin />
        {t(status === "queued" ? "agent.queued" : "agent.working")}
      </span>
      {longWait ? (
        <span className="pl-6 text-xs leading-5 text-muted">
          {t("agent.queueLongWait")}
        </span>
      ) : null}
    </div>
  );
}
