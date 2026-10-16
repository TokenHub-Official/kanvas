import {
  ApartmentOutlined,
  AuditOutlined,
  BranchesOutlined,
  ExportOutlined,
  ImportOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, type ReactNode } from "react";

import { cn } from "../../lib/cn.js";

export type WorkflowAuthoringFlowNodeKindV1 =
  "input" | "capability" | "condition" | "batch" | "approval" | "output";

export interface WorkflowAuthoringFlowPortV1 {
  readonly id: string;
  readonly label?: string;
}

export interface WorkflowAuthoringFlowNodeDataV1 extends Record<
  string,
  unknown
> {
  readonly kind: WorkflowAuthoringFlowNodeKindV1;
  readonly title: string;
  readonly subtitle: string;
  readonly summary: string;
  readonly inputLabel: string;
  readonly outputLabel: string;
  readonly issueLabel: string;
  readonly issueCount: number;
  readonly sourcePorts: readonly WorkflowAuthoringFlowPortV1[];
  readonly inputPreview: readonly string[];
  readonly outputPreview: readonly string[];
  readonly inputPreviewLabel: string;
  readonly outputPreviewLabel: string;
}

export type WorkflowAuthoringReactFlowNodeV1 = Node<
  WorkflowAuthoringFlowNodeDataV1,
  "workflow-authoring-v1"
>;

const icons: Readonly<Record<WorkflowAuthoringFlowNodeKindV1, ReactNode>> = {
  input: <ImportOutlined aria-hidden="true" />,
  capability: <ThunderboltOutlined aria-hidden="true" />,
  condition: <BranchesOutlined aria-hidden="true" />,
  batch: <ApartmentOutlined aria-hidden="true" />,
  approval: <AuditOutlined aria-hidden="true" />,
  output: <ExportOutlined aria-hidden="true" />,
};

const accentClassNames: Readonly<
  Record<WorkflowAuthoringFlowNodeKindV1, string>
> = {
  input: "border-l-positive",
  capability: "border-l-primary",
  condition: "border-l-artwork-violet",
  batch: "border-l-warning",
  approval: "border-l-artwork-coral",
  output: "border-l-primary",
};

const handleStyle = {
  width: 12,
  height: 12,
  border: "2px solid var(--paper)",
  background: "var(--ink)",
};

const baseNodeHeight = 92;
const branchGap = 24;
const conditionPortStart = 58;
const defaultPortStart = 46;
const defaultPortGap = 18;
const portLabelOffset = 7;
const previewFieldLimit = 3;

export const WorkflowAuthoringFlowNodeV1 = memo(
  function WorkflowAuthoringFlowNodeV1({
    data,
    selected,
  }: NodeProps<WorkflowAuthoringReactFlowNodeV1>): React.JSX.Element {
    const hasInput = data.kind !== "input";
    const sourcePorts = data.kind === "output" ? [] : data.sourcePorts;
    const conditionHeight =
      data.kind === "condition"
        ? Math.max(0, sourcePorts.length - 1) * branchGap
        : 0;
    return (
      <article
        className={cn(
          "relative grid min-w-56 gap-2 rounded-xl border border-line-strong border-l-4 bg-paper px-4 py-3 text-ink shadow-[0_12px_34px_rgb(28_30_45_/_10%),0_2px_6px_rgb(28_30_45_/_6%)] transition-[border-color,box-shadow,transform] duration-150",
          accentClassNames[data.kind],
          selected &&
            "border-primary shadow-[0_0_0_3px_rgb(48_72_245_/_18%),0_16px_42px_rgb(28_30_45_/_14%)]",
        )}
        style={{ minHeight: baseNodeHeight + conditionHeight }}
      >
        {hasInput ? (
          <Handle
            aria-label={data.inputLabel}
            position={Position.Left}
            style={handleStyle}
            type="target"
          />
        ) : null}
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-mist text-primary">
            {icons[data.kind]}
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <strong className="truncate text-[13px] font-bold">
              {data.title}
            </strong>
            {data.subtitle !== data.title ? (
              <span className="truncate text-[11px] text-muted">
                {data.subtitle}
              </span>
            ) : null}
          </span>
          {data.issueCount > 0 ? (
            <span
              aria-label={data.issueLabel}
              className="grid size-5 shrink-0 place-items-center rounded-full bg-danger text-[10px] font-bold text-on-primary"
            >
              {data.issueCount}
            </span>
          ) : null}
        </div>
        <p className="m-0 truncate pl-11 text-[11px] text-muted">
          {data.summary}
        </p>
        {data.inputPreview.length > 0 || data.outputPreview.length > 0 ? (
          <div className="grid gap-1 border-t border-line pt-2 text-[10px] text-muted">
            {data.inputPreview.length > 0 ? (
              <span className="truncate">
                <span className="font-semibold text-ink">
                  {data.inputPreviewLabel}
                </span>{" "}
                {data.inputPreview.slice(0, previewFieldLimit).join(", ")}
              </span>
            ) : null}
            {data.outputPreview.length > 0 ? (
              <span className="truncate">
                <span className="font-semibold text-primary">
                  {data.outputPreviewLabel}
                </span>{" "}
                {data.outputPreview.slice(0, previewFieldLimit).join(", ")}
              </span>
            ) : null}
          </div>
        ) : null}
        {sourcePorts.map((port, index) => {
          const top =
            data.kind === "condition"
              ? conditionPortStart + index * branchGap
              : defaultPortStart + index * defaultPortGap;
          return (
            <span key={port.id}>
              {port.label ? (
                <span
                  className="absolute right-4 text-[10px] text-muted"
                  style={{ top: top - portLabelOffset }}
                >
                  {port.label}
                </span>
              ) : null}
              <Handle
                aria-label={port.label ?? data.outputLabel}
                id={port.id}
                position={Position.Right}
                style={{ ...handleStyle, top }}
                type="source"
              />
            </span>
          );
        })}
      </article>
    );
  },
);
