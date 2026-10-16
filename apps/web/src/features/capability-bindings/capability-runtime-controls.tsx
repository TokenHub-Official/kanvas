import { ArrowDownOutlined, ArrowUpOutlined } from "@ant-design/icons";
import type { CapabilityBindingSummary } from "@kanvas/contracts/api";
import { resolveLocalizedTextV1 } from "@kanvas/contracts/capability";
import { Button } from "antd";
import { useReducer } from "react";
import { useTranslation } from "react-i18next";

import { StatusTag } from "../../components/status-tag.js";
import type { PendingCapabilityOrderMove } from "./capability-bindings-runtime.js";
import {
  createCapabilityOrderDraft,
  reduceCapabilityOrderDraft,
} from "./capability-order-draft.js";

export interface CapabilityRuntimeGroup {
  readonly bindings: readonly CapabilityBindingSummary[];
  readonly capabilityKey: string;
  readonly capabilityRevision: number;
}

function providerModelLabel(
  providerName: string,
  providerModelId: string,
): string {
  return providerName
    .toLocaleLowerCase("en-US")
    .includes(providerModelId.toLocaleLowerCase("en-US"))
    ? providerName
    : `${providerName} · ${providerModelId}`;
}

export function CapabilityGroup({
  group,
  onPause,
  onReplace,
  onResume,
  onSaveOrder,
  operationPending,
  orderSaving,
}: {
  readonly group: CapabilityRuntimeGroup;
  readonly onPause: (binding: CapabilityBindingSummary) => void;
  readonly onReplace: (binding: CapabilityBindingSummary) => void;
  readonly onResume: (binding: CapabilityBindingSummary) => void;
  readonly onSaveOrder: (
    bindings: readonly CapabilityBindingSummary[],
    moves: readonly PendingCapabilityOrderMove[],
  ) => Promise<void>;
  readonly operationPending: boolean;
  readonly orderSaving: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [orderDraft, updateOrderDraft] = useReducer(
    reduceCapabilityOrderDraft,
    group.bindings,
    createCapabilityOrderDraft,
  );
  const displayedBindings = orderDraft.editing
    ? orderDraft.bindings
    : group.bindings;

  const reset = () =>
    updateOrderDraft({ type: "reset", bindings: group.bindings });
  const save = () => {
    void onSaveOrder(group.bindings, orderDraft.moves)
      .then(reset)
      .catch(() => undefined);
  };

  return (
    <section className="min-w-0">
      <ol className="m-0 grid list-none gap-3 p-0">
        {displayedBindings.map((binding, index) => (
          <BindingRow
            binding={binding}
            editingOrder={orderDraft.editing}
            index={index}
            key={binding.id}
            next={displayedBindings[index + 1]}
            onMove={(direction) =>
              updateOrderDraft({ type: "move", direction, index })
            }
            onPause={onPause}
            onReplace={onReplace}
            onResume={onResume}
            operationPending={operationPending}
            previous={displayedBindings[index - 1]}
          />
        ))}
      </ol>
      {group.bindings.length > 1 ? (
        <footer className="mt-4 flex justify-end gap-2">
          {orderDraft.editing ? (
            <>
              <Button disabled={orderSaving} onClick={reset}>
                {t("settings.execution.edit.cancel")}
              </Button>
              <Button
                disabled={orderDraft.moves.length === 0}
                loading={orderSaving}
                onClick={save}
                type="primary"
              >
                {t("settings.execution.edit.save")}
              </Button>
            </>
          ) : (
            <Button
              disabled={operationPending}
              onClick={() =>
                updateOrderDraft({
                  type: "start",
                  bindings: group.bindings,
                })
              }
            >
              {t("settings.execution.edit.action")}
            </Button>
          )}
        </footer>
      ) : null}
    </section>
  );
}

function BindingRow({
  binding,
  editingOrder,
  index,
  next,
  onMove,
  onPause,
  onReplace,
  onResume,
  operationPending,
  previous,
}: {
  readonly binding: CapabilityBindingSummary;
  readonly editingOrder: boolean;
  readonly index: number;
  readonly next: CapabilityBindingSummary | undefined;
  readonly onMove: (direction: "earlier" | "later") => void;
  readonly onPause: (binding: CapabilityBindingSummary) => void;
  readonly onReplace: (binding: CapabilityBindingSummary) => void;
  readonly onResume: (binding: CapabilityBindingSummary) => void;
  readonly operationPending: boolean;
  readonly previous: CapabilityBindingSummary | undefined;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const ready = binding.availabilityReason === "ready";
  const providerDetail =
    binding.providerName && binding.providerModelId
      ? providerModelLabel(binding.providerName, binding.providerModelId)
      : undefined;
  const targetLabel = t(
    `settings.execution.targets.${binding.executionTarget}`,
  );
  const methodLabel = resolveLocalizedTextV1(
    binding.displayName,
    i18n.resolvedLanguage ?? "en-US",
  );
  let sourceLabel = methodLabel;
  if (binding.sourceKind === "plugin") {
    sourceLabel = t(
      `settings.capabilityDefinitions.implementation.builtIn.${binding.executionTarget}`,
    );
  } else if (binding.sourceKind === "model_service") {
    sourceLabel =
      providerDetail ??
      t("settings.capabilityDefinitions.implementation.modelService");
  }
  const hasMultipleCandidates = Boolean(previous || next);
  const indexTone = {
    browser: "bg-primary-soft text-primary",
    provider: "bg-warning-surface text-warning",
    worker: "bg-[#eee8ff] text-[#6741d9]",
  }[binding.executionTarget];

  return (
    <li
      className={
        hasMultipleCandidates
          ? "relative grid grid-cols-[36px_minmax(0,1fr)] gap-3"
          : "relative grid min-w-0"
      }
    >
      {next && hasMultipleCandidates ? (
        <span
          aria-hidden="true"
          className="absolute -bottom-3 left-[17px] top-9 w-0.5 bg-line"
        />
      ) : null}
      {hasMultipleCandidates ? (
        <span
          className={`relative z-1 grid size-9 place-items-center rounded-full text-xs font-bold ${indexTone}`}
        >
          {index + 1}
        </span>
      ) : null}
      <div className="min-w-0 rounded-[16px] bg-paper px-4 py-3.5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="min-w-0 truncate text-sm">
                {sourceLabel}
              </strong>
              {index === 0 && hasMultipleCandidates ? (
                <StatusTag tone="info">
                  {t("settings.execution.edit.preferred")}
                </StatusTag>
              ) : null}
              {binding.status !== "enabled" || !ready ? (
                <StatusTag
                  tone={binding.status === "enabled" ? "warning" : "neutral"}
                >
                  {binding.status === "enabled"
                    ? t(
                        `settings.execution.availability.${binding.availabilityReason}.label`,
                      )
                    : t(`settings.execution.binding.status.${binding.status}`)}
                </StatusTag>
              ) : (
                <StatusTag tone="positive">
                  {t("settings.execution.availability.ready.label")}
                </StatusTag>
              )}
            </div>
            <span className="mt-1 block text-xs text-muted">{targetLabel}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1 sm:justify-end">
            {!editingOrder ? (
              <Button
                disabled={operationPending}
                onClick={() => onReplace(binding)}
                size="small"
                type="text"
              >
                {t("settings.execution.binding.replace")}
              </Button>
            ) : null}
            {editingOrder && hasMultipleCandidates ? (
              <>
                <Button
                  aria-label={t("settings.execution.binding.moveUpLabel", {
                    name: targetLabel,
                  })}
                  disabled={!previous || operationPending}
                  icon={<ArrowUpOutlined aria-hidden="true" />}
                  onClick={() => onMove("earlier")}
                  size="small"
                  type="text"
                />
                <Button
                  aria-label={t("settings.execution.binding.moveDownLabel", {
                    name: targetLabel,
                  })}
                  disabled={!next || operationPending}
                  icon={<ArrowDownOutlined aria-hidden="true" />}
                  onClick={() => onMove("later")}
                  size="small"
                  type="text"
                />
              </>
            ) : null}
            {!editingOrder && binding.status === "enabled" ? (
              <Button
                danger
                disabled={operationPending}
                onClick={() => onPause(binding)}
                size="small"
                type="text"
              >
                {t("settings.execution.binding.pause")}
              </Button>
            ) : null}
            {!editingOrder && binding.status === "paused" ? (
              <Button
                disabled={!ready || operationPending}
                onClick={() => onResume(binding)}
                size="small"
                type="link"
              >
                {t("settings.execution.binding.resume")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}
