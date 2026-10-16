import type { WorkflowRunDetails } from "@kanvas/contracts/api";
import { Button, Input, InputNumber, Popconfirm, Select } from "antd";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { InlineNotice } from "../../components/feedback.js";
import {
  workflowApprovalDecisionForm,
  workflowApprovalDecisionValue,
} from "./workflow-approval-decision.js";

type PendingApproval = NonNullable<
  WorkflowRunDetails["pendingApprovals"]
>[number];

interface DecisionOption {
  readonly decisionValue: string | number | boolean;
  readonly label: string;
  readonly value: string;
}

function fieldOptionLabel(
  value: string | number | boolean,
  labels: { readonly no: string; readonly yes: string },
): string {
  if (typeof value !== "boolean") return String(value);
  return value ? labels.yes : labels.no;
}

function booleanControlValue(value: unknown): "false" | "true" | null {
  if (typeof value !== "boolean") return null;
  return value ? "true" : "false";
}

function fieldOptions(
  field: {
    readonly schema?: Readonly<Record<string, unknown>>;
  },
  labels: {
    readonly no: string;
    readonly yes: string;
  },
): readonly DecisionOption[] {
  const values = field.schema?.enum;
  return Array.isArray(values)
    ? values.flatMap((value, index) =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
          ? [
              {
                decisionValue: value,
                label: fieldOptionLabel(value, labels),
                value: `option-${String(index)}`,
              },
            ]
          : [],
      )
    : [];
}

const maximumBrowserTimerDelayMs = 2_147_483_647;

export function WorkflowApprovalCard({
  approval,
  canDecide,
  onDecide,
  submitting,
}: {
  readonly approval: PendingApproval;
  readonly canDecide: boolean;
  readonly onDecide: (
    approvalRequestId: string,
    decision: Readonly<Record<string, unknown>>,
  ) => void;
  readonly submitting: boolean;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const formId = useId();
  const form = useMemo(
    () => workflowApprovalDecisionForm(approval.decisionSchema),
    [approval.decisionSchema],
  );
  const [values, setValues] = useState<Readonly<Record<string, unknown>>>({});
  const decision =
    form.kind === "flat"
      ? workflowApprovalDecisionValue(form, values)
      : undefined;
  const expiresAt = Date.parse(approval.expiresAt);
  const [expired, setExpired] = useState(() => expiresAt <= Date.now());
  useEffect(() => {
    let timer: number | undefined;
    const scheduleExpiry = () => {
      const remaining = expiresAt - Date.now();
      timer = window.setTimeout(
        () => {
          if (remaining > maximumBrowserTimerDelayMs) scheduleExpiry();
          else setExpired(true);
        },
        Math.min(maximumBrowserTimerDelayMs, remaining),
      );
    };
    if (expiresAt > Date.now()) scheduleExpiry();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [expiresAt]);
  const expiry = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(approval.expiresAt));

  function decisionOptionChangeHandler(
    fieldKey: string,
    options: readonly DecisionOption[],
  ): (optionKey: string) => void {
    return (optionKey) => {
      const option = options.find((item) => item.value === optionKey);
      if (!option) return;
      setValues((current) => ({
        ...current,
        [fieldKey]: option.decisionValue,
      }));
    };
  }

  return (
    <section className="grid gap-4 border-y border-line py-5">
      <header>
        <h2 className="m-0 text-base font-bold text-ink">
          {approval.title ?? t("workflows.runSession.approval.title")}
        </h2>
        {approval.message ? (
          <p className="mt-1 mb-0 text-sm leading-6 text-muted">
            {approval.message}
          </p>
        ) : null}
        <p className="mt-2 mb-0 text-xs text-muted">
          {t("workflows.runSession.approval.expiresAt", { time: expiry })}
        </p>
      </header>

      {expired ? (
        <InlineNotice
          title={t("workflows.runSession.approval.expired")}
          tone="warning"
        />
      ) : null}
      {!canDecide && !expired ? (
        <InlineNotice
          title={t("workflows.runSession.approval.permissionRequired")}
          tone="info"
        />
      ) : null}

      {canDecide && !expired && form.kind === "standard_boolean" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            loading={submitting}
            onClick={() => onDecide(approval.id, { approved: true })}
            type="primary"
          >
            {t("workflows.runSession.approval.approve")}
          </Button>
          <Popconfirm
            cancelText={t("workflows.runSession.approval.keepReviewing")}
            okButtonProps={{ danger: true }}
            okText={t("workflows.runSession.approval.reject")}
            onConfirm={() => onDecide(approval.id, { approved: false })}
            title={t("workflows.runSession.approval.rejectTitle")}
          >
            <Button danger disabled={submitting}>
              {t("workflows.runSession.approval.reject")}
            </Button>
          </Popconfirm>
        </div>
      ) : null}

      {canDecide && !expired && form.kind === "flat" ? (
        <div className="grid gap-4">
          {form.fields.map((field) => {
            const controlId = `${formId}-${field.key}`;
            const fieldValue = values[field.key];
            const booleanValue = booleanControlValue(fieldValue);
            const numberValue =
              typeof fieldValue === "number" ? fieldValue : null;
            const options = fieldOptions(field, {
              no: t("workflows.templateDetail.no"),
              yes: t("workflows.templateDetail.yes"),
            });
            const selectedOption = options.find(
              (option) => option.decisionValue === values[field.key],
            );
            let control: React.JSX.Element;
            if (options.length > 0) {
              control = (
                <Select
                  aria-required={field.required}
                  id={controlId}
                  onChange={decisionOptionChangeHandler(field.key, options)}
                  options={options.map(({ label, value }) => ({
                    label,
                    value,
                  }))}
                  value={selectedOption?.value ?? null}
                  variant="filled"
                />
              );
            } else if (field.type === "boolean") {
              control = (
                <Select
                  aria-required={field.required}
                  id={controlId}
                  onChange={(value: "false" | "true") =>
                    setValues((current) => ({
                      ...current,
                      [field.key]: value === "true",
                    }))
                  }
                  options={[
                    {
                      label: t("workflows.templateDetail.yes"),
                      value: "true",
                    },
                    {
                      label: t("workflows.templateDetail.no"),
                      value: "false",
                    },
                  ]}
                  value={booleanValue}
                  variant="filled"
                />
              );
            } else if (field.type === "integer" || field.type === "number") {
              control = (
                <InputNumber
                  aria-required={field.required}
                  className="w-full"
                  id={controlId}
                  onChange={(value) =>
                    setValues((current) => ({
                      ...current,
                      [field.key]: value ?? undefined,
                    }))
                  }
                  value={numberValue}
                  variant="filled"
                />
              );
            } else {
              control = (
                <Input
                  aria-required={field.required}
                  id={controlId}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.key]: event.currentTarget.value,
                    }))
                  }
                  value={(values[field.key] as string | undefined) ?? ""}
                  variant="filled"
                />
              );
            }
            return (
              <label
                className="grid gap-1.5"
                htmlFor={controlId}
                key={field.key}
              >
                <span className="text-xs font-semibold text-ink">
                  {field.title}
                  {field.required ? <span aria-hidden="true"> *</span> : null}
                </span>
                {field.description ? (
                  <span className="text-xs leading-5 text-muted">
                    {field.description}
                  </span>
                ) : null}
                {control}
              </label>
            );
          })}
          {!decision && form.fields.some((field) => field.required) ? (
            <p className="m-0 text-xs leading-5 text-muted" role="status">
              {t("workflows.runSession.approval.requiredFields")}
            </p>
          ) : null}
          <Button
            disabled={!decision}
            loading={submitting}
            onClick={() => {
              if (decision) onDecide(approval.id, decision);
            }}
            type="primary"
          >
            {t("workflows.runSession.approval.submit")}
          </Button>
        </div>
      ) : null}

      {canDecide && !expired && form.kind === "unsupported" ? (
        <InlineNotice
          title={t("workflows.runSession.approval.unsupportedSchema")}
          tone="warning"
        />
      ) : null}
    </section>
  );
}
