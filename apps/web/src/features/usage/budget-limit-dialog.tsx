import type { WorkspaceBudgetSummary } from "@kanvas/contracts/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReducer } from "react";
import { Button, Form, InputNumber, Space } from "antd";
import { useTranslation } from "react-i18next";

import { ApiProblem, updateWorkspaceBudget } from "../../api/transport.js";
import { httpStatus } from "../../api/http-status.js";
import { workspaceQueryKeys } from "../../api/query-keys.js";
import { InlineNotice } from "../../components/feedback.js";
import {
  SettingsDialog as Dialog,
  SettingsDialogContent as DialogContent,
} from "../../components/settings-overlay.js";
import { useSettingsNotification } from "../../components/settings-notification.js";
import {
  createBudgetLimitDraft,
  reduceBudgetLimitDraft,
} from "./budget-limit-draft-state.js";
import {
  budgetUnavailableAmount,
  formatBudgetAmount,
} from "./usage-summary-model.js";

function editableBudgetAmount(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : value;
}

export function BudgetLimitDialog({
  budget,
  csrfToken,
  workspaceId,
}: {
  readonly budget: WorkspaceBudgetSummary;
  readonly csrfToken: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const toast = useSettingsNotification();
  const queryClient = useQueryClient();
  const originalLimit = editableBudgetAmount(budget.hardLimitAmount);
  const [draft, updateDraft] = useReducer(
    reduceBudgetLimitDraft,
    originalLimit,
    createBudgetLimitDraft,
  );
  const { fieldError, formError, limit, open } = draft;
  const providerSettingId = budget.providerSettingId;
  const committed = budgetUnavailableAmount(budget);
  const dirty = limit !== originalLimit;
  const mutation = useMutation({
    mutationFn: () => {
      if (!providerSettingId) {
        throw new Error("Provider budget is missing.");
      }
      return updateWorkspaceBudget(
        { csrfToken, workspaceId },
        providerSettingId,
        {
          expectedVersion: budget.version,
          hardLimitAmount: limit.trim(),
        },
      );
    },
    onSuccess: async () => {
      updateDraft({ type: "saved", limit });
      toast.notify({
        title: t("settings.usage.limit.updatedTitle"),
        description: t("settings.usage.limit.updatedDescription"),
        tone: "positive",
      });
      await queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.usageSummary(workspaceId),
      });
    },
    onError: (error) => {
      if (error instanceof ApiProblem && error.status === httpStatus.conflict) {
        updateDraft({
          type: "form_error",
          error: t("settings.usage.limit.conflict"),
        });
        return;
      }
      if (
        error instanceof ApiProblem &&
        error.status === httpStatus.badRequest
      ) {
        updateDraft({
          type: "field_error",
          error: t("settings.usage.limit.belowCommitted"),
        });
        return;
      }
      updateDraft({
        type: "form_error",
        error: t("settings.usage.limit.genericError"),
      });
    },
  });

  function validate(): boolean {
    const value = Number(limit);
    if (!Number.isFinite(value) || value < 0) {
      updateDraft({
        type: "field_error",
        error: t("settings.usage.limit.invalidAmount"),
      });
      return false;
    }
    if (value < committed) {
      updateDraft({
        type: "field_error",
        error: t("settings.usage.limit.minimumAmount", {
          amount: formatBudgetAmount(String(committed), budget.currencyCode),
        }),
      });
      return false;
    }
    updateDraft({ type: "validation_passed" });
    return true;
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!mutation.isPending) {
          updateDraft(
            nextOpen
              ? { type: "open", originalLimit }
              : { type: "close", originalLimit },
          );
        }
      }}
      open={open}
    >
      <Button
        onClick={() => {
          updateDraft({ type: "open", originalLimit });
        }}
        size="small"
      >
        {t("settings.usage.limit.action")}
      </Button>
      <DialogContent
        closeLabel={t("common.dialog.close")}
        dismissible={!mutation.isPending}
        title={t("settings.usage.limit.title", { name: budget.name })}
        width={520}
      >
        <Form
          className="grid gap-5"
          layout="vertical"
          onFinish={() => {
            if (validate() && dirty) mutation.mutate();
          }}
          requiredMark={false}
        >
          <dl className="grid gap-3 rounded-[16px] bg-mist px-4 py-3 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted">
                {t("settings.usage.limit.committed")}
              </dt>
              <dd className="mt-1 font-bold tabular-nums">
                {formatBudgetAmount(String(committed), budget.currencyCode)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">
                {t("settings.usage.limit.current")}
              </dt>
              <dd className="mt-1 font-bold tabular-nums">
                {formatBudgetAmount(
                  budget.hardLimitAmount,
                  budget.currencyCode,
                )}
              </dd>
            </div>
          </dl>
          <Form.Item
            className="!mb-0"
            help={
              fieldError ??
              t("settings.usage.limit.minimumAmount", {
                amount: formatBudgetAmount(
                  String(committed),
                  budget.currencyCode,
                ),
              })
            }
            label={t("settings.usage.limit.label")}
            {...(fieldError ? { validateStatus: "error" as const } : {})}
          >
            <Space.Compact block>
              <span className="inline-flex min-h-10 items-center rounded-l-control bg-mist-deep px-3 text-sm font-semibold text-muted">
                {budget.currencyCode}
              </span>
              <InputNumber<string>
                className="!w-full"
                controls={false}
                disabled={mutation.isPending}
                min={editableBudgetAmount(String(committed))}
                onChange={(value) => {
                  updateDraft({ type: "limit_changed", limit: value ?? "" });
                }}
                precision={2}
                size="large"
                stringMode
                value={limit}
                variant="filled"
              />
            </Space.Compact>
          </Form.Item>
          {formError ? (
            <InlineNotice
              title={t("settings.usage.limit.errorTitle")}
              tone="danger"
            >
              {formError}
            </InlineNotice>
          ) : null}
          <footer className="flex justify-end gap-2 border-t border-line pt-5">
            <Button
              disabled={mutation.isPending}
              onClick={() => {
                updateDraft({ type: "close", originalLimit });
              }}
              htmlType="button"
            >
              {t("settings.usage.limit.cancel")}
            </Button>
            <Button
              disabled={!dirty}
              loading={mutation.isPending}
              htmlType="submit"
              type="primary"
            >
              {t("settings.usage.limit.submit")}
            </Button>
          </footer>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
