import { cn } from "../../lib/cn.js";
import { Check } from "./canvas-icons-v1.js";
import type { CanvasSaveStatusV1 } from "./canvas-workspace-view-model-v1.js";

export function CanvasSaveStatusIndicatorV1({
  canEdit,
  message,
  status,
}: {
  readonly canEdit: boolean;
  readonly message: string;
  readonly status: CanvasSaveStatusV1;
}) {
  const stable = canEdit && status === "saved";
  const attention = canEdit && (status === "error" || status === "idle");
  const busy = canEdit && (status === "saving" || status === "uploading");

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className={cn(
        "canvas-v1-save-state flex h-7 min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium",
        stable && "text-white/65",
        busy && "bg-white/10 text-white/90",
        attention && "bg-white/15 text-white",
        !canEdit && "text-white/65",
      )}
      data-save-status={canEdit ? status : "read-only"}
      role="status"
    >
      {stable ? <Check aria-hidden="true" className="size-3" /> : null}
      <span className="truncate">{message}</span>
    </div>
  );
}
