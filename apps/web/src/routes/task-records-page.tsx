import zhCNDatePicker from "antd/es/date-picker/locale/zh_CN.js";
import type { TaskRecordList, TaskRecordQuery } from "@kanvas/contracts/api";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Form,
  Typography,
  type InputRef,
} from "antd";
import { FilterOutlined, ReloadOutlined } from "@ant-design/icons";
import { useRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { fetchTaskRecords } from "../api/transport.js";
import {
  SettingsShell,
  SettingsPageHeader,
} from "../components/settings-shell.js";
import { SettingsDirectoryTable } from "../components/settings-directory-table.js";
import { KanvasInput, KanvasSearchInput } from "../components/kanvas-input.js";
import { KanvasSelect } from "../components/kanvas-select.js";
import { StatusTag } from "../components/status-tag.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { AgentRunDiagnostics } from "../features/agent/agent-run-diagnostics.js";
import {
  taskRecordDuration,
  taskRecordStatus,
} from "../features/operations/task-record-presentation.js";
import { OperationsContent } from "./operations-page.js";
const referenceSuffixLength = 8;
const taskRangeZhLocale = {
  ...zhCNDatePicker,
  lang: {
    ...zhCNDatePicker.lang,
    shortWeekDays: ["日", "一", "二", "三", "四", "五", "六"],
    shortMonths: [
      "1月",
      "2月",
      "3月",
      "4月",
      "5月",
      "6月",
      "7月",
      "8月",
      "9月",
      "10月",
      "11月",
      "12月",
    ],
  },
};
const route = getRouteApi("/w/$workspaceId/settings/tasks");
type TaskRecord = TaskRecordList["items"][number];
interface AdditionalFilters {
  creator?: string;
  range?: ComponentProps<typeof DatePicker.RangePicker>["value"];
}
export function TaskRecordsPage(): React.JSX.Element {
  const { workspaceId } = route.useParams();
  const { t } = useTranslation();
  return (
    <WorkspacePage
      workspaceId={workspaceId}
      pageTitle={t("operations.tasks.title")}
    >
      {({ workspace }) => (
        <SettingsShell active="tasks" workspace={workspace}>
          {workspace.permissions.includes("audit.read") ? (
            <TaskRecordsContent
              workspaceId={workspaceId}
              permissions={workspace.permissions}
            />
          ) : (
            <Alert
              type="warning"
              title={t("operations.forbiddenTitle")}
              description={t("operations.forbiddenDescription")}
            />
          )}
        </SettingsShell>
      )}
    </WorkspacePage>
  );
}

export function TaskRecordsContent({
  workspaceId,
  permissions,
}: {
  readonly workspaceId: string;
  readonly permissions: readonly string[];
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState<TaskRecordQuery>({ limit: "50" });
  const [cursors, setCursors] = useState<(string | undefined)[]>([]);
  const [selected, setSelected] = useState<TaskRecord>();
  const referenceInputRef = useRef<InputRef | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const taskTriggerRef = useRef<HTMLButtonElement | null>(null);
  const diagnosticTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [diagnosticRunId, setDiagnosticRunId] = useState<string>();
  const [reference, setReference] = useState("");
  const [invalidReference, setInvalidReference] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const [filterForm] = Form.useForm<AdditionalFilters>();
  const records = useQuery({
    queryKey: ["task-records", workspaceId, i18n.language, query],
    queryFn: () =>
      fetchTaskRecords(workspaceId, {
        ...query,
        locale: i18n.language.startsWith("zh") ? "zh-CN" : "en-US",
      }),
    retry: false,
  });
  function changeFilters(
    patch: Partial<
      Record<
        "reference" | "status" | "kind" | "creator" | "from" | "to",
        string | undefined
      >
    >,
  ): void {
    const { cursor: _cursor, ...current } = query;
    void _cursor;
    setCursors([]);
    setQuery(
      Object.fromEntries(
        Object.entries({ ...current, ...patch }).filter(
          ([, value]) => value !== undefined,
        ),
      ),
    );
  }
  function searchReference(): void {
    const value = reference.trim();
    if (value && !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(value)) {
      setInvalidReference(true);
      return;
    }
    setInvalidReference(false);
    changeFilters({ reference: value || undefined });
  }
  function applyAdditionalFilters(values: AdditionalFilters): void {
    changeFilters({
      creator: values.creator?.trim() || undefined,
      from: values.range?.[0]?.toISOString(),
      to: values.range?.[1]?.toISOString(),
    });
    setMoreFilters(false);
    requestAnimationFrame(() => filterTriggerRef.current?.focus());
  }
  function resetFilters(): void {
    setQuery({ limit: "50" });
    setCursors([]);
    setReference("");
    setInvalidReference(false);
    filterForm.resetFields();
    requestAnimationFrame(() => referenceInputRef.current?.focus());
  }
  function closeRecord(): void {
    setSelected(undefined);
    requestAnimationFrame(() => taskTriggerRef.current?.focus());
  }
  function closeDiagnostic(): void {
    setDiagnosticRunId(undefined);
    requestAnimationFrame(() => diagnosticTriggerRef.current?.focus());
  }
  function nextPage(): void {
    if (!records.data?.nextCursor) return;
    setCursors([...cursors, query.cursor]);
    setQuery({ ...query, cursor: records.data.nextCursor });
  }
  function previousPage(): void {
    const cursor = cursors.at(-1);
    setCursors(cursors.slice(0, -1));
    const { cursor: _cursor, ...filters } = query;
    void _cursor;
    setQuery({ ...filters, ...(cursor ? { cursor } : {}) });
  }
  const filtered = Boolean(
    query.reference ||
    query.status ||
    query.kind ||
    query.creator ||
    query.from ||
    query.to,
  );
  const additionalCount =
    Number(Boolean(query.creator)) + Number(Boolean(query.from || query.to));
  const dateFormat = new Intl.DateTimeFormat(i18n.language, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  let emptyMessage = filtered
    ? "operations.tasks.empty"
    : "operations.tasks.noRecords";
  if (records.isError) emptyMessage = "operations.tasks.loadError";
  const rows = (records.data?.items ?? []).map((record) => ({
    ...record,
    key: `${record.kind}:${record.id}`,
  }));
  function submitReference(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    searchReference();
  }
  function changeReference(event: React.ChangeEvent<HTMLInputElement>) {
    setReference(event.target.value);
    setInvalidReference(false);
    if (!event.target.value) changeFilters({ reference: undefined });
  }
  function openTask(
    event: React.MouseEvent<HTMLButtonElement>,
    record: TaskRecord,
  ) {
    taskTriggerRef.current = event.currentTarget;
    setSelected(record);
  }
  return (
    <div>
      <SettingsPageHeader
        title={t("operations.tasks.title")}
        action={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void records.refetch()}
            loading={records.isFetching}
          >
            {t("operations.refresh")}
          </Button>
        }
      />
      {records.isError ? (
        <Alert
          type="error"
          showIcon
          title={t(
            records.data
              ? "operations.refreshErrorTitle"
              : "operations.tasks.loadError",
          )}
          description={t("operations.loadErrorDescription")}
        />
      ) : null}
      <SettingsDirectoryTable
        scrollX="100%"
        loading={records.isFetching}
        dataSource={rows}
        toolbar={
          <div className="grid w-full gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <form
                onSubmit={submitReference}
                className="flex min-w-0 flex-1 basis-80 gap-2 sm:max-w-110"
              >
                <KanvasSearchInput
                  ref={referenceInputRef}
                  aria-label={t("operations.tasks.reference")}
                  placeholder={t("operations.tasks.searchPlaceholder")}
                  allowClear
                  value={reference}
                  status={invalidReference ? "error" : ""}
                  onChange={changeReference}
                />
                <Button htmlType="submit">
                  {t("operations.tasks.search")}
                </Button>
              </form>
              <KanvasSelect
                className="min-w-32"
                aria-label={t("operations.tasks.status")}
                value={query.status ?? "all"}
                onChange={(value: string) =>
                  changeFilters({ status: value === "all" ? undefined : value })
                }
                options={[
                  { value: "all", label: t("operations.tasks.allStatuses") },
                  ...["failed", "active", "succeeded", "cancelled"].map(
                    (value) => ({
                      value,
                      label: t(`operations.tasks.statuses.${value}`),
                    }),
                  ),
                ]}
              />
              <KanvasSelect
                className="min-w-36"
                aria-label={t("operations.tasks.kind")}
                value={query.kind ?? "all"}
                onChange={(value: string) =>
                  changeFilters({ kind: value === "all" ? undefined : value })
                }
                options={[
                  { value: "all", label: t("operations.tasks.allKinds") },
                  ...["agent", "workflow", "capability"].map((value) => ({
                    value,
                    label: t(`operations.tasks.kinds.${value}`),
                  })),
                ]}
              />
              <Button
                ref={filterTriggerRef}
                icon={<FilterOutlined />}
                aria-expanded={moreFilters}
                aria-controls="task-additional-filters"
                onClick={() => setMoreFilters(!moreFilters)}
              >
                {t("operations.tasks.moreFilters")}
                {additionalCount ? ` (${additionalCount})` : ""}
              </Button>
              {filtered ? (
                <Button type="text" onClick={resetFilters}>
                  {t("operations.tasks.clearFilters")}
                </Button>
              ) : null}
            </div>
            {invalidReference ? (
              <p role="alert" className="m-0 text-xs text-danger">
                {t("operations.tasks.invalidReference")}
              </p>
            ) : null}
            {additionalCount && !moreFilters ? (
              <div className="text-xs text-muted">
                {[
                  query.creator
                    ? `${t("operations.tasks.creatorShort")}: ${query.creator}`
                    : undefined,
                  query.from
                    ? `${t("operations.tasks.from")}: ${new Date(query.from).toLocaleString(i18n.language)}`
                    : undefined,
                  query.to
                    ? `${t("operations.tasks.to")}: ${new Date(query.to).toLocaleString(i18n.language)}`
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            ) : null}
            <div id="task-additional-filters" hidden={!moreFilters}>
              <Form
                component="div"
                form={filterForm}
                layout="vertical"
                onFinish={applyAdditionalFilters}
                className="grid items-end gap-x-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-[1fr_2fr_auto]"
              >
                <Form.Item
                  name="creator"
                  label={t("operations.tasks.creator")}
                  className="mb-0"
                >
                  <KanvasInput allowClear maxLength={255} />
                </Form.Item>
                <Form.Item
                  name="range"
                  label={t("operations.tasks.creationPeriod")}
                  className="mb-0"
                >
                  <DatePicker.RangePicker
                    {...(i18n.language.startsWith("zh")
                      ? { locale: taskRangeZhLocale }
                      : {})}
                    className="w-full"
                    showTime
                    allowEmpty={[true, true]}
                    placeholder={[
                      t("operations.tasks.from"),
                      t("operations.tasks.to"),
                    ]}
                  />
                </Form.Item>
                <Form.Item className="mb-0">
                  <Button onClick={() => filterForm.submit()} type="primary">
                    {t("operations.tasks.applyFilters")}
                  </Button>
                </Form.Item>
              </Form>
            </div>
          </div>
        }
        emptyText={
          <div className="py-6 text-center">
            <p>{t(emptyMessage)}</p>
            {filtered && !records.isError ? (
              <Button onClick={resetFilters}>
                {t("operations.tasks.clearFilters")}
              </Button>
            ) : null}
          </div>
        }
        columns={[
          {
            title: t("operations.tasks.task"),
            key: "task",
            width: "40%",
            render: (_, record) => (
              <div className="min-w-0 py-0.5">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={(event) => openTask(event, record)}
                    className="block max-w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-sm font-semibold text-ink hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    title={record.title}
                  >
                    {record.title}
                  </button>
                  <span className="shrink-0 sm:hidden">
                    <StatusTag tone={taskRecordStatus(record).tone}>
                      {t(`operations.states.${taskRecordStatus(record).key}`)}
                    </StatusTag>
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                  <span>{t(`operations.tasks.kinds.${record.kind}`)}</span>
                  <span aria-hidden="true">·</span>
                  <span title={record.id}>
                    #{record.id.slice(-referenceSuffixLength)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted md:hidden">
                  <span>{record.creatorName}</span>
                  <span>{dateFormat.format(new Date(record.createdAt))}</span>
                  <span>{taskRecordDuration(record, i18n.language)}</span>
                </div>
              </div>
            ),
          },
          {
            title: t("operations.tasks.status"),
            key: "status",
            responsive: ["sm"],
            width: 140,
            render: (_, record) => {
              const status = taskRecordStatus(record);
              return (
                <StatusTag tone={status.tone}>
                  {t(`operations.states.${status.key}`, {
                    defaultValue: status.key,
                  })}
                </StatusTag>
              );
            },
          },
          {
            title: t("operations.tasks.creatorShort"),
            dataIndex: "creatorName",
            responsive: ["md"],
            ellipsis: true,
          },
          {
            title: t("operations.tasks.createdAt"),
            key: "createdAt",
            responsive: ["md"],
            width: 170,
            render: (_, record) => (
              <time
                dateTime={record.createdAt}
                title={new Date(record.createdAt).toLocaleString(i18n.language)}
                className="text-sm tabular-nums"
              >
                {dateFormat.format(new Date(record.createdAt))}
              </time>
            ),
          },
          {
            title: t("operations.tasks.duration"),
            key: "duration",
            responsive: ["md"],
            width: 130,
            render: (_, record) => (
              <span className="text-sm tabular-nums">
                {taskRecordDuration(record, i18n.language)}
              </span>
            ),
          },
        ]}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted" aria-live="polite">
              {t("operations.tasks.pageSummary", {
                page: cursors.length + 1,
                count: rows.length,
              })}
            </span>
            <div className="flex gap-2">
              <Button
                disabled={!cursors.length || records.isFetching}
                onClick={previousPage}
              >
                {t("operations.tasks.previous")}
              </Button>
              <Button
                disabled={!records.data?.nextCursor || records.isFetching}
                onClick={nextPage}
              >
                {t("operations.tasks.next")}
              </Button>
            </div>
          </div>
        }
      />
      {selected?.kind === "agent" ? (
        <AgentRunDiagnostics
          key={selected.id}
          workspaceId={workspaceId}
          runId={selected.id}
          onClose={closeRecord}
        />
      ) : null}
      {selected && selected.kind !== "agent" ? (
        <Drawer
          open
          onClose={closeRecord}
          size="min(1000px, 100vw)"
          title={selected.title}
        >
          <div className="mb-5 grid gap-3 border-b border-line pb-4">
            <Typography.Text copyable={{ text: selected.id }}>
              {t("operations.tasks.reference")}: {selected.id}
            </Typography.Text>
            {selected.agentRunId ? (
              <Button
                ref={diagnosticTriggerRef}
                className="justify-self-start"
                onClick={() => setDiagnosticRunId(selected.agentRunId)}
              >
                {t("operations.tasks.agentDiagnostics")}
              </Button>
            ) : null}
            {selected.threadId ? (
              <Typography.Text
                type="secondary"
                copyable={{ text: selected.threadId }}
              >
                {t("operations.tasks.thread")}: {selected.threadId}
              </Typography.Text>
            ) : null}
          </div>
          <OperationsContent
            embedded
            onReturn={closeRecord}
            key={selected.id}
            workspaceId={workspaceId}
            workflowRunId={selected.id}
            kind={selected.kind}
            canConfigureRoutes={permissions.includes("capability.configure")}
            canManageProviders={permissions.includes("credential.manage")}
            canReadUsage={permissions.includes("usage.read")}
            canReadCapabilities={permissions.includes("capability.run")}
            returnTo={`/w/${workspaceId}/settings/tasks`}
          />
        </Drawer>
      ) : null}
      {diagnosticRunId ? (
        <AgentRunDiagnostics
          key={diagnosticRunId}
          workspaceId={workspaceId}
          runId={diagnosticRunId}
          onClose={closeDiagnostic}
        />
      ) : null}
    </div>
  );
}
