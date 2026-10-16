import type {
  CapabilityAdminSummary,
  CapabilityRunDetails,
} from "@kanvas/contracts/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Collapse, Form } from "antd";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiProblem,
  cancelCapabilityRun,
  createCapabilityRun,
  fetchCapabilityRun,
  fetchWorkspaceAssets,
} from "../../api/transport.js";
import { ArtifactPreview } from "../../components/artifact-preview.js";
import { InlineNotice, LoadingState } from "../../components/feedback.js";
import { KanvasInput, KanvasTextArea } from "../../components/kanvas-input.js";
import { KanvasSelect } from "../../components/kanvas-select.js";
import {
  RunOutputValue,
  type RunOutputSchema,
} from "../../components/run-output-value.js";
import {
  SettingsDialog,
  SettingsDialogContent,
} from "../../components/settings-overlay.js";
import {
  useBrowserRuntimes,
  type BrowserRuntimeConnectionState,
  type BrowserRuntimeFailure,
} from "../browser-executor/use-browser-runtimes.js";
import {
  clearCapabilityTestRecovery,
  readCapabilityTestRecovery,
  writeCapabilityTestRecovery,
  type CapabilityTestRecovery,
} from "./capability-test-recovery.js";

const runRefreshIntervalMilliseconds = 1_000;
const longTextThreshold = 240;
const noCapabilityKeys: readonly string[] = Object.freeze([]);

function runFailureKey(error: unknown): string {
  let code = "";
  if (error instanceof ApiProblem) {
    code = error.code;
  } else {
    const details = record(error);
    if (typeof details?.code === "string") code = details.code;
  }
  if (code.includes("budget")) return "budgetUnavailable";
  if (code.includes("deadline") || code.includes("timeout")) return "timedOut";
  if (
    code.includes("unavailable") ||
    code.includes("unconfigured") ||
    code.includes("credential") ||
    code === "capability_run.runtime_not_active"
  ) {
    return "unavailable";
  }
  return "unknown";
}

export function CapabilityTestFailure({
  error,
}: {
  readonly error: unknown;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <InlineNotice
      title={t("settings.capabilityDefinitions.test.failed")}
      tone="danger"
    >
      {t(
        `settings.capabilityDefinitions.test.failures.${runFailureKey(error)}`,
      )}
    </InlineNotice>
  );
}

export function CapabilityTestOutputValue({
  schema,
  value,
}: {
  readonly schema?: RunOutputSchema;
  readonly value: unknown;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <RunOutputValue
      emptyLabel={t("settings.capabilityDefinitions.test.output.empty")}
      noLabel={t("settings.capabilityDefinitions.test.output.no")}
      {...(schema ? { schema } : {})}
      value={value}
      yesLabel={t("settings.capabilityDefinitions.test.output.yes")}
    />
  );
}

export function CapabilityTestActions({
  cancelling,
  hasRun,
  missingRequired,
  onCancel,
  onClose,
  onNew,
  onStart,
  starting,
  status,
}: {
  readonly cancelling: boolean;
  readonly hasRun: boolean;
  readonly missingRequired: boolean;
  readonly onCancel: () => void;
  readonly onClose: () => void;
  readonly onNew: () => void;
  readonly onStart: () => void;
  readonly starting: boolean;
  readonly status: CapabilityRunDetails["lifecycleStatus"] | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const active = status === "queued" || status === "running";
  if (active) {
    return (
      <div className="flex justify-end">
        <Button disabled={cancelling} loading={cancelling} onClick={onCancel}>
          {t(
            cancelling
              ? "settings.capabilityDefinitions.test.cancelling"
              : "settings.capabilityDefinitions.test.cancelRun",
          )}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex justify-end gap-2">
      <Button disabled={starting} onClick={onClose}>
        {t(
          hasRun
            ? "settings.capabilityDefinitions.test.done"
            : "settings.capabilityDefinitions.cancel",
        )}
      </Button>
      <Button
        disabled={!hasRun && missingRequired}
        loading={!hasRun && starting}
        onClick={hasRun ? onNew : onStart}
        type="primary"
      >
        {t(
          hasRun
            ? "settings.capabilityDefinitions.test.newTest"
            : "settings.capabilityDefinitions.test.start",
        )}
      </Button>
    </div>
  );
}

type CapabilityTestBinding = Pick<
  CapabilityAdminSummary["bindings"][number],
  "availabilityReason" | "executionTarget" | "id" | "order" | "status"
>;

type CapabilityTestRunSelection =
  | {
      readonly recovery: CapabilityTestRecovery;
      readonly source: "current" | "session";
    }
  | undefined;

export function capabilityTestUsesBrowserRuntime(
  bindings: readonly CapabilityTestBinding[],
): boolean {
  const selected = bindings
    .filter(
      (binding) =>
        binding.status === "enabled" && binding.availabilityReason === "ready",
    )
    .toSorted(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    )[0];
  return selected?.executionTarget === "browser";
}

export function CapabilityTestBrowserRuntimeNotice({
  canRun,
  failure,
  onReconnect,
  state,
}: {
  readonly canRun: boolean;
  readonly failure?: BrowserRuntimeFailure;
  readonly onReconnect: () => void;
  readonly state: BrowserRuntimeConnectionState;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (!canRun) {
    return (
      <InlineNotice
        title={t("settings.capabilityDefinitions.test.browser.title")}
        tone="warning"
      >
        {t("settings.capabilityDefinitions.test.browser.permissionRequired")}
      </InlineNotice>
    );
  }
  const needsReconnect = state === "reconnecting" || state === "unavailable";
  let tone: "danger" | "info" | "positive" | "warning" = "info";
  if (state === "ready") tone = "positive";
  else if (state === "reconnecting") tone = "warning";
  else if (state === "unavailable") tone = "danger";
  const descriptionKey =
    failure && (state === "reconnecting" || state === "unavailable")
      ? `settings.capabilityDefinitions.test.browser.failures.${failure.stage}`
      : `settings.capabilityDefinitions.test.browser.${state}`;
  return (
    <InlineNotice
      {...(needsReconnect
        ? {
            action: (
              <Button onClick={onReconnect} size="small">
                {t("settings.capabilityDefinitions.test.browser.reconnect")}
              </Button>
            ),
          }
        : {})}
      title={t("settings.capabilityDefinitions.test.browser.title")}
      tone={tone}
    >
      {t(descriptionKey)}
    </InlineNotice>
  );
}

export function CapabilityTestEmptyAssets({
  visible,
  workspaceId,
}: {
  readonly visible: boolean;
  readonly workspaceId: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <InlineNotice
      title={t("settings.capabilityDefinitions.test.noImageAssets")}
    >
      <Button href={`/w/${workspaceId}/assets`} size="small">
        {t("settings.capabilityDefinitions.test.openAssets")}
      </Button>
    </InlineNotice>
  );
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function initialValue(schema: Readonly<Record<string, unknown>>): unknown {
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return schema.examples[0];
  }
  if (schema.type === "boolean") return false;
  return undefined;
}

function initialInput(
  definition: CapabilityAdminSummary | undefined,
): Readonly<Record<string, unknown>> {
  const properties = record(definition?.inputSchema.properties) ?? {};
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) => {
      const candidate = initialValue(record(value) ?? {});
      return candidate === undefined ? [] : [[key, candidate]];
    }),
  );
}

function textValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function localizedText(
  value: Readonly<{ "en-US": string; "zh-CN": string }>,
  language: string | undefined,
): string {
  return language?.toLocaleLowerCase().startsWith("zh")
    ? value["zh-CN"]
    : value["en-US"];
}

type CapabilityOutputDeclaration =
  CapabilityAdminSummary["declaration"]["outputs"][number];

function CapabilityTestResultField({
  declaration,
  language,
  schema,
  value,
  workspaceId,
}: {
  readonly declaration: CapabilityOutputDeclaration;
  readonly language: string | undefined;
  readonly schema?: RunOutputSchema;
  readonly value: unknown;
  readonly workspaceId: string;
}): React.JSX.Element {
  const label = localizedText(declaration.label, language);
  return (
    <section className="grid gap-2">
      <h4 className="text-sm font-medium text-muted">{label}</h4>
      {typeof value === "string" &&
      declaration.semanticType.startsWith("artifact.") ? (
        <ArtifactPreview
          alt={label}
          artifactId={value}
          workspaceId={workspaceId}
        />
      ) : (
        <CapabilityTestOutputValue
          {...(schema ? { schema } : {})}
          value={value}
        />
      )}
    </section>
  );
}

export function CapabilityTestResultValues({
  declarations,
  language,
  output,
  outputSchema,
  workspaceId,
}: {
  readonly declarations: readonly CapabilityOutputDeclaration[];
  readonly language: string | undefined;
  readonly output: Readonly<Record<string, unknown>>;
  readonly outputSchema?: RunOutputSchema;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const properties = record(outputSchema?.properties) ?? {};
  const visibleDeclarations = declarations.filter(
    (declaration) =>
      declaration.visibility !== "hidden" &&
      Object.hasOwn(output, declaration.key),
  );
  const authorDeclarations = visibleDeclarations.filter(
    (declaration) => declaration.visibility === "author",
  );
  const advancedDeclarations = visibleDeclarations.filter(
    (declaration) => declaration.visibility === "advanced",
  );
  const resultField = (declaration: CapabilityOutputDeclaration) => {
    const schema = record(properties[declaration.key]);
    return (
      <CapabilityTestResultField
        declaration={declaration}
        key={declaration.key}
        language={language}
        {...(schema ? { schema } : {})}
        value={output[declaration.key]}
        workspaceId={workspaceId}
      />
    );
  };
  return (
    <>
      {authorDeclarations.map(resultField)}
      {advancedDeclarations.length > 0 ? (
        <details className="rounded-xl border border-line bg-mist/45 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary">
            {t("workflows.runSession.technicalDetails")}
          </summary>
          <div className="mt-3 grid gap-3 border-t border-line pt-3">
            {advancedDeclarations.map(resultField)}
          </div>
        </details>
      ) : null}
    </>
  );
}

export function CapabilityTestInputLayout({
  children,
  completedResult,
}: {
  readonly children: ReactNode;
  readonly completedResult?: ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (!completedResult) return <>{children}</>;
  return (
    <>
      {completedResult}
      <Collapse
        bordered={false}
        className="bg-mist/45"
        items={[
          {
            children,
            forceRender: true,
            key: "input",
            label: t("settings.capabilityDefinitions.test.currentInput"),
          },
        ]}
        size="small"
      />
    </>
  );
}

export function CapabilityTestDialog({
  canRun,
  csrfToken,
  definition,
  onClose,
  principalId,
  workspaceId,
}: {
  readonly canRun: boolean;
  readonly csrfToken: string;
  readonly definition: CapabilityAdminSummary | undefined;
  readonly onClose: () => void;
  readonly principalId: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const queryClient = useQueryClient();
  const capabilityName = definition
    ? localizedText(definition.declaration.catalog.title, i18n.resolvedLanguage)
    : "";
  const [input, setInput] = useState<Readonly<Record<string, unknown>>>(() =>
    initialInput(definition),
  );
  const recoveryScope = {
    capabilityId: definition?.id ?? "",
    principalId,
    workspaceId,
  };
  const [runSelection, setRunSelection] = useState<CapabilityTestRunSelection>(
    () => {
      const stored = definition
        ? readCapabilityTestRecovery({
            capabilityId: definition.id,
            principalId,
            workspaceId,
          })
        : undefined;
      return stored ? { recovery: stored, source: "session" } : undefined;
    },
  );
  const recovery = runSelection?.recovery;
  const [browserRestartKey, setBrowserRestartKey] = useState(0);
  const [browserFailure, setBrowserFailure] = useState<BrowserRuntimeFailure>();
  const runId = recovery?.runId;
  const properties = useMemo(
    () => record(definition?.inputSchema.properties) ?? {},
    [definition?.inputSchema.properties],
  );
  const required = useMemo(
    () =>
      new Set(
        Array.isArray(definition?.inputSchema.required)
          ? definition.inputSchema.required.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
      ),
    [definition?.inputSchema.required],
  );
  const needsImage = definition?.declaration.parameters.some((parameter) =>
    parameter.semanticType.startsWith("artifact."),
  );
  const requiresImage = definition?.declaration.parameters.some(
    (parameter) =>
      parameter.required && parameter.semanticType.startsWith("artifact."),
  );
  const assets = useQuery({
    queryKey: ["capability-test-assets", workspaceId],
    queryFn: () =>
      fetchWorkspaceAssets(workspaceId, {
        mediaKind: "image",
        lifecycleStatus: "active",
        limit: "100",
      }),
    enabled: Boolean(definition && needsImage),
    retry: false,
  });
  const imageAssetOptions = useMemo(
    () =>
      (assets.data?.items ?? []).flatMap((asset) =>
        asset.currentArtifact
          ? [
              {
                label: asset.name,
                value: asset.currentArtifact.id,
              },
            ]
          : [],
      ),
    [assets.data?.items],
  );
  const run = useQuery({
    queryKey: ["capability-test-run", workspaceId, runId],
    queryFn: () => fetchCapabilityRun(workspaceId, runId!),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.lifecycleStatus;
      return status === "queued" || status === "running"
        ? runRefreshIntervalMilliseconds
        : false;
    },
    retry: false,
  });

  const start = useMutation({
    mutationFn: () => {
      if (!definition) throw new Error("Capability is not selected.");
      return createCapabilityRun(
        { csrfToken, workspaceId },
        { contractRevisionId: definition.contractRevisionId, input },
        crypto.randomUUID(),
      );
    },
    onSuccess: (created) => {
      if (!definition) return;
      const nextRecovery: CapabilityTestRecovery = {
        capabilityId: definition.id,
        principalId,
        workspaceId,
        schemaVersion: 1,
        browserRuntimeRequired: capabilityTestUsesBrowserRuntime(
          definition.bindings,
        ),
        capabilityKey: definition.key,
        contractRevisionId: created.contractRevisionId,
        runId: created.id,
      };
      queryClient.setQueryData(
        ["capability-test-run", workspaceId, created.id],
        created,
      );
      writeCapabilityTestRecovery(nextRecovery);
      setRunSelection({ recovery: nextRecovery, source: "current" });
    },
  });

  const cancel = useMutation({
    mutationFn: () => {
      if (!runId) throw new Error("Capability run is not active.");
      return cancelCapabilityRun(
        { csrfToken, workspaceId },
        runId,
        crypto.randomUUID(),
      );
    },
    onSuccess: (cancelled) => {
      queryClient.setQueryData(
        ["capability-test-run", workspaceId, cancelled.id],
        cancelled,
      );
    },
  });

  const restoredRun =
    recovery &&
    run.data?.id === recovery.runId &&
    run.data.contractRevisionId === recovery.contractRevisionId &&
    run.data.invocationKind === "user"
      ? run.data
      : undefined;
  const recoveryMismatch = Boolean(recovery && run.data && !restoredRun);
  const restoredInput = record(restoredRun?.input);
  const visibleInput = recovery && restoredInput ? restoredInput : input;
  const missingRequired = [...required].some(
    (key) =>
      visibleInput[key] === undefined ||
      visibleInput[key] === null ||
      visibleInput[key] === "",
  );
  const output = record(restoredRun?.output);
  const runStatus = restoredRun?.lifecycleStatus;
  const runActive = runStatus === "queued" || runStatus === "running";
  const cancelling =
    cancel.isPending || Boolean(restoredRun?.cancelRequestedAt);
  const selectedBrowserRuntimeRequired = Boolean(
    definition && capabilityTestUsesBrowserRuntime(definition.bindings),
  );
  const browserRuntimeRequired =
    recovery?.browserRuntimeRequired ?? selectedBrowserRuntimeRequired;
  const browserCapabilityKey = browserRuntimeRequired
    ? (recovery?.capabilityKey ?? definition?.key)
    : undefined;
  const browserCapabilityKeys = useMemo(
    () =>
      browserCapabilityKey
        ? Object.freeze([browserCapabilityKey])
        : noCapabilityKeys,
    [browserCapabilityKey],
  );
  const browserRuntimeEnabled =
    canRun &&
    browserRuntimeRequired &&
    (!recovery || runActive || runStatus === "failed");
  const browserRuntimeState = useBrowserRuntimes({
    csrfToken,
    enabled: browserRuntimeEnabled,
    onFailure: setBrowserFailure,
    requiredCapabilityKeys: browserCapabilityKeys,
    restartKey: browserRestartKey,
    workspaceId,
  });
  function startTest(): void {
    if (browserRuntimeRequired && browserRuntimeState !== "ready") return;
    cancel.reset();
    start.reset();
    start.mutate();
  }
  function prepareNewTest(): void {
    clearCapabilityTestRecovery(recoveryScope);
    setRunSelection(undefined);
    setInput(initialInput(definition));
    setBrowserFailure(undefined);
    setBrowserRestartKey(0);
    cancel.reset();
    start.reset();
  }
  function reconnectBrowserRuntime(): void {
    setBrowserFailure(undefined);
    setBrowserRestartKey((current) => current + 1);
  }
  function cancelRun(): void {
    cancel.mutate();
  }
  let recoveryDescriptionKey =
    "settings.capabilityDefinitions.test.restoredDescription";
  if (run.isError || recoveryMismatch) {
    recoveryDescriptionKey =
      "settings.capabilityDefinitions.test.restoreFailed";
  } else if (run.isPending) {
    recoveryDescriptionKey = "settings.capabilityDefinitions.test.restoring";
  }
  const completedResult =
    restoredRun?.lifecycleStatus === "completed" && output ? (
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-ink">
          {t("settings.capabilityDefinitions.test.result")}
        </h3>
        <CapabilityTestResultValues
          declarations={definition?.declaration.outputs ?? []}
          language={i18n.resolvedLanguage ?? i18n.language}
          output={output}
          {...(definition?.outputSchema
            ? { outputSchema: definition.outputSchema }
            : {})}
          workspaceId={workspaceId}
        />
      </section>
    ) : undefined;

  return (
    <SettingsDialog
      onOpenChange={(open) => {
        if (!open && !start.isPending && !runActive && !cancel.isPending) {
          onClose();
        }
      }}
      open={Boolean(definition)}
    >
      {definition ? (
        <SettingsDialogContent
          closeLabel={t("common.dialog.close")}
          description={t("settings.capabilityDefinitions.test.description")}
          dismissible={!start.isPending && !runActive && !cancel.isPending}
          scrollable
          title={t("settings.capabilityDefinitions.test.title", {
            name: capabilityName,
          })}
          width={680}
        >
          <div className="grid gap-5">
            <CapabilityTestInputLayout
              {...(completedResult ? { completedResult } : {})}
            >
              <Form
                className="grid gap-4"
                disabled={Boolean(recovery)}
                layout="vertical"
              >
                {definition.declaration.parameters.map((parameter) => {
                  const schema = record(properties[parameter.key]) ?? {};
                  const enumValues = Array.isArray(schema.enum)
                    ? schema.enum.filter(
                        (value): value is string | number =>
                          typeof value === "string" ||
                          typeof value === "number",
                      )
                    : [];
                  const label = localizedText(
                    parameter.label,
                    i18n.resolvedLanguage,
                  );
                  const description = parameter.description
                    ? localizedText(
                        parameter.description,
                        i18n.resolvedLanguage,
                      )
                    : undefined;
                  const fieldLabel = (
                    <span>
                      {label}
                      <span className="ml-1.5 font-normal text-muted">
                        {t(
                          parameter.required
                            ? "settings.capabilityDefinitions.details.required"
                            : "settings.capabilityDefinitions.details.optional",
                        )}
                      </span>
                    </span>
                  );
                  const fieldProps = {
                    ...(description
                      ? {
                          extra: (
                            <span className="text-xs leading-5 text-muted">
                              {description}
                            </span>
                          ),
                        }
                      : {}),
                    label: fieldLabel,
                  };
                  const update = (value: unknown) =>
                    setInput((current) => ({
                      ...current,
                      [parameter.key]: value,
                    }));
                  if (parameter.editor === "artifact_picker") {
                    return (
                      <Form.Item key={parameter.key} {...fieldProps}>
                        <KanvasSelect
                          loading={assets.isPending}
                          onChange={(value) => update(String(value))}
                          options={imageAssetOptions}
                          placeholder={t(
                            "settings.capabilityDefinitions.test.chooseImage",
                          )}
                          value={
                            typeof visibleInput[parameter.key] === "string"
                              ? visibleInput[parameter.key]
                              : undefined
                          }
                        />
                      </Form.Item>
                    );
                  }
                  if (parameter.editor === "artifact_list_picker") {
                    return (
                      <Form.Item key={parameter.key} {...fieldProps}>
                        <KanvasSelect
                          loading={assets.isPending}
                          {...(typeof schema.maxItems === "number"
                            ? { maxCount: schema.maxItems }
                            : {})}
                          mode="multiple"
                          onChange={(value) => update(value)}
                          options={imageAssetOptions}
                          placeholder={t(
                            "settings.capabilityDefinitions.test.chooseImages",
                          )}
                          value={
                            Array.isArray(visibleInput[parameter.key])
                              ? visibleInput[parameter.key]
                              : []
                          }
                        />
                      </Form.Item>
                    );
                  }
                  if (enumValues.length > 0) {
                    return (
                      <Form.Item key={parameter.key} {...fieldProps}>
                        <KanvasSelect
                          onChange={update}
                          options={enumValues.map((value) => ({
                            label: String(value),
                            value,
                          }))}
                          placeholder={t(
                            "settings.capabilityDefinitions.test.useDefault",
                          )}
                          value={visibleInput[parameter.key]}
                        />
                      </Form.Item>
                    );
                  }
                  if (schema.type === "boolean") {
                    return (
                      <Checkbox
                        checked={Boolean(visibleInput[parameter.key])}
                        key={parameter.key}
                        onChange={(event) => update(event.target.checked)}
                      >
                        {fieldLabel}
                      </Checkbox>
                    );
                  }
                  if (
                    parameter.semanticType === "prompt.rich" ||
                    (schema.type === "string" &&
                      typeof schema.maxLength === "number" &&
                      schema.maxLength > longTextThreshold)
                  ) {
                    return (
                      <Form.Item key={parameter.key} {...fieldProps}>
                        <KanvasTextArea
                          autoSize={{ minRows: 3, maxRows: 8 }}
                          onChange={(event) => update(event.target.value)}
                          value={textValue(visibleInput[parameter.key])}
                        />
                      </Form.Item>
                    );
                  }
                  return (
                    <Form.Item key={parameter.key} {...fieldProps}>
                      <KanvasInput
                        inputMode={
                          schema.type === "number" || schema.type === "integer"
                            ? "decimal"
                            : undefined
                        }
                        onChange={(event) =>
                          update(
                            schema.type === "number" ||
                              schema.type === "integer"
                              ? Number(event.target.value)
                              : event.target.value,
                          )
                        }
                        value={textValue(visibleInput[parameter.key])}
                      />
                    </Form.Item>
                  );
                })}
              </Form>
            </CapabilityTestInputLayout>

            <CapabilityTestEmptyAssets
              visible={Boolean(
                definition &&
                requiresImage &&
                !assets.isPending &&
                imageAssetOptions.length === 0,
              )}
              workspaceId={workspaceId}
            />

            {runSelection?.source === "session" ? (
              <InlineNotice
                title={t("settings.capabilityDefinitions.test.restoredTitle")}
                tone={run.isError || recoveryMismatch ? "danger" : "info"}
              >
                {t(recoveryDescriptionKey)}
              </InlineNotice>
            ) : null}
            {start.isError || cancel.isError ? (
              <CapabilityTestFailure error={start.error ?? cancel.error} />
            ) : null}
            {restoredRun?.lifecycleStatus === "failed" ? (
              <CapabilityTestFailure error={restoredRun.error} />
            ) : null}
            {restoredRun?.lifecycleStatus === "cancelled" ? (
              <InlineNotice
                title={t("settings.capabilityDefinitions.test.cancelled")}
              >
                {t("settings.capabilityDefinitions.test.cancelledDescription")}
              </InlineNotice>
            ) : null}
            {restoredRun?.lifecycleStatus === "queued" ||
            restoredRun?.lifecycleStatus === "running" ? (
              <LoadingState
                label={t("settings.capabilityDefinitions.test.running")}
              />
            ) : null}
            {browserRuntimeEnabled ? (
              <CapabilityTestBrowserRuntimeNotice
                canRun={canRun}
                {...(browserFailure ? { failure: browserFailure } : {})}
                onReconnect={reconnectBrowserRuntime}
                state={browserRuntimeState}
              />
            ) : null}
            <CapabilityTestActions
              cancelling={cancelling}
              hasRun={Boolean(recovery)}
              missingRequired={
                missingRequired ||
                !canRun ||
                (browserRuntimeRequired && browserRuntimeState !== "ready")
              }
              onCancel={cancelRun}
              onClose={onClose}
              onNew={prepareNewTest}
              onStart={startTest}
              starting={start.isPending}
              status={runStatus}
            />
          </div>
        </SettingsDialogContent>
      ) : null}
    </SettingsDialog>
  );
}
