import type { TaskRecordList } from "@kanvas/contracts/api";
import type { StatusTagTone } from "../../components/status-tag.js";

type TaskRecord = TaskRecordList["items"][number];
const millisecondsPerSecond = 1_000;
const secondsPerMinute = 60;
const minutesPerHour = 60;

export function taskRecordStatus(
  record: Pick<TaskRecord, "status" | "outcome">,
): { key: string; tone: StatusTagTone } {
  if (record.outcome === "partial_success")
    return { key: "partialSuccess", tone: "warning" };
  if (record.status === "failed" || record.outcome === "no_usable_output")
    return { key: "failed", tone: "danger" };
  if (["completed", "succeeded"].includes(record.status))
    return { key: "succeeded", tone: "positive" };
  if (record.status === "cancelled")
    return { key: "cancelled", tone: "neutral" };
  if (
    ["queued", "waiting", "waiting_approval", "waiting_for_user"].includes(
      record.status,
    )
  )
    return { key: record.status, tone: "warning" };
  return { key: record.status, tone: "info" };
}

export function taskRecordDuration(
  record: Pick<TaskRecord, "createdAt" | "completedAt">,
  locale: string,
): string {
  if (!record.completedAt) return "—";
  const seconds = Math.max(
    0,
    Math.round(
      (Date.parse(record.completedAt) - Date.parse(record.createdAt)) /
        millisecondsPerSecond,
    ),
  );
  if (!Number.isFinite(seconds)) return "—";
  const minutes = Math.floor(seconds / secondsPerMinute);
  const hours = Math.floor(minutes / minutesPerHour);
  const unit = (value: number, name: "hour" | "minute" | "second"): string =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: name,
      unitDisplay: "narrow",
    }).format(value);
  if (hours)
    return `${unit(hours, "hour")} ${unit(minutes % minutesPerHour, "minute")}`;
  if (minutes)
    return `${unit(minutes, "minute")} ${unit(seconds % secondsPerMinute, "second")}`;
  return unit(seconds, "second");
}
