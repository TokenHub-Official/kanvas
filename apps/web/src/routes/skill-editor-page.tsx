import { CoverPickerDialog } from "../components/cover-picker-dialog.js";
import { createWorkspaceCoverUploader } from "../components/workspace-cover-upload.js";
import {
  ResourceActions,
  ResourceUnavailable,
} from "../components/resource-lifecycle.js";
import { skillErrorKey } from "../components/skill-error.js";
import {
  SkillContentBrowser,
  type SkillFileSelection,
} from "../components/skill-content-browser.js";
import { SkillDraftActions } from "../components/skill-draft-actions.js";
import { skillPackageName } from "../components/authoring-sections.js";
import {
  ReadOutlined,
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  EditOutlined,
  SettingOutlined,
  LockOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type {
  CreateSkillDraftBody,
  SkillDraftDetail,
  SkillDraftSummary,
  SkillFileInput,
} from "@kanvas/contracts/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Skeleton,
  Tag,
  Drawer,
  Radio,
  Tooltip,
} from "antd";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { useTranslation } from "react-i18next";

import {
  createSkillDraft,
  ApiProblem,
  fetchSkillDraft,
  fetchWorkspaceAssets,
  updateSkillDraft,
} from "../api/transport.js";
import { AssetArtwork } from "../components/asset-artwork.js";
import { UnsavedChangesGuard } from "../components/unsaved-changes-guard.js";
import { httpStatus } from "../api/http-status.js";

type SkillEditorValue = CreateSkillDraftBody;
const packageSuffixLength = 8;
const maximumExamples = 20;

function SkillInstructionsField(
  props: ComponentProps<typeof SkillContentBrowser>,
): React.JSX.Element {
  const { errors } = Form.Item.useStatus();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <SkillContentBrowser {...props} />
      {errors.length > 0 ? (
        <Form.ErrorList className="shrink-0 px-5 py-2" errors={errors} />
      ) : null}
    </div>
  );
}

export function SkillEditor({
  canManage,
  canPublish,
  canReadAssets,
  canUploadAssets = false,
  csrfToken,
  mode,
  skillDraftId,
  workspaceId,
  onSaved,
  onCancel,
  onStateChange,
  selection,
}: {
  readonly canManage: boolean;
  readonly canPublish: boolean;
  readonly canReadAssets: boolean;
  readonly canUploadAssets?: boolean;
  readonly csrfToken: string;
  readonly mode: "create" | "edit";
  readonly skillDraftId?: string;
  readonly workspaceId: string;
  readonly onSaved: (draft: SkillDraftSummary) => void;
  readonly onCancel: () => void;
  readonly onStateChange: (state: { dirty: boolean; saving: boolean }) => void;
  readonly selection: SkillFileSelection;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { notification } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<SkillEditorValue>();
  const [packageSuffix] = useState(() =>
    crypto.randomUUID().slice(0, packageSuffixLength),
  );
  const selectedCoverAssetId = Form.useWatch("coverAssetId", form);
  const displayName = Form.useWatch("displayName", form);
  const summary = Form.useWatch("summary", form);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const uploadCover = useMemo(
    () => createWorkspaceCoverUploader({ csrfToken, workspaceId }),
    [csrfToken, workspaceId],
  );
  const [files, setFiles] = useState<SkillFileInput[]>([]);
  const [removedPaths, setRemovedPaths] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);
  const leaveBypassRef = useRef(false);
  useEffect(
    () => onStateChange({ dirty, saving }),
    [dirty, saving, onStateChange],
  );
  function markDirty(): void {
    setDirty(true);
    setSaveComplete(false);
    leaveBypassRef.current = false;
  }
  function showFirstError({
    errorFields,
  }: {
    errorFields: { name: (string | number)[] }[];
  }): void {
    const first = errorFields[0];
    if (!first) return;
    if (
      [
        "description",
        "exampleRequests",

        "visibility",
        "displayName",
        "summary",
      ].includes(String(first.name[0])) &&
      !(
        mode === "create" &&
        ["displayName", "summary"].includes(String(first.name[0]))
      )
    )
      setSettingsOpen(true);
    requestAnimationFrame(() =>
      form.scrollToField(first.name, { focus: true, block: "center" }),
    );
  }
  const [error, setError] = useState<string>();
  const detail = useQuery({
    queryKey: ["skill-draft", workspaceId, skillDraftId],
    queryFn: () => fetchSkillDraft(workspaceId, skillDraftId!),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: mode === "edit" && Boolean(skillDraftId) && canManage,
    retry: false,
  });
  const assets = useQuery({
    queryKey: ["workspace-assets", workspaceId, "skill-cover"],
    queryFn: () => fetchWorkspaceAssets(workspaceId, { limit: "100" }),
    enabled: canReadAssets && coverOpen,
    retry: false,
  });

  function retryCoverAssets(): void {
    void assets.refetch();
  }

  if (!canManage) {
    return (
      <div className="mx-auto w-full max-w-6xl py-2">
        <Alert title={t("agent.hub.editorForbidden")} showIcon type="warning" />
      </div>
    );
  }
  if (mode === "edit" && detail.isPending) {
    return (
      <div className="mx-auto w-full max-w-6xl py-2">
        <Skeleton active paragraph={{ rows: 14 }} />
      </div>
    );
  }
  if (mode === "edit" && (detail.isError || !detail.data)) {
    return (
      <div className="mx-auto w-full max-w-6xl py-2">
        <ResourceUnavailable
          workspaceId={workspaceId}
          csrfToken={csrfToken}
          kind="skill"
          id={skillDraftId!}
        >
          <Alert
            action={
              <Button onClick={onCancel}>{t("agent.hub.backToSkills")}</Button>
            }
            title={t("agent.hub.skillUnavailable")}
            showIcon
            type="error"
          />
        </ResourceUnavailable>
      </div>
    );
  }

  const current: SkillDraftDetail | undefined = detail.data;
  let statusKey = "agent.hub.skillStatus.draft";
  if (current?.publishedSkillRevisionId)
    statusKey = "agent.skillWorkbench.unpublishedChanges";
  if (!dirty && current?.publishedCurrent)
    statusKey = "agent.hub.skillStatus.published";
  const initialValues: SkillEditorValue = current
    ? {
        name: current.packageName,
        displayName: current.displayName,
        summary: current.summary,
        description: current.description,
        instructions: current.instructions,
        visibility: current.visibility,
        ...(current.coverAssetId ? { coverAssetId: current.coverAssetId } : {}),
        ...(current.category ? { category: current.category } : {}),
        tags: [...current.tags],
        exampleRequests: [...current.exampleRequests],
      }
    : {
        name: "",
        displayName: "",
        summary: "",
        description: "",
        instructions: "",
        visibility: "private",
        tags: [],
        exampleRequests: [],
      };

  async function save(value: SkillEditorValue): Promise<void> {
    const emptyFile = files.find(
      (file) => "text" in file && file.text.length === 0,
    );
    if (emptyFile) {
      setError(
        t("agent.skillWorkbench.emptyFileNamed", { name: emptyFile.path }),
      );
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const coverAssetId = canReadAssets
        ? value.coverAssetId
        : current?.coverAssetId;
      const presentation = {
        displayName: value.displayName.trim(),
        summary: value.summary.trim(),
        description: value.description?.trim() || value.summary.trim(),
        instructions: value.instructions.trim(),
        visibility: value.visibility,
        ...(coverAssetId ? { coverAssetId } : {}),
        ...(current?.category ? { category: current.category } : {}),
        tags: current?.tags ?? [],
        exampleRequests: value.exampleRequests,

        files,
      } as const;
      const saved = current
        ? await updateSkillDraft({ csrfToken, workspaceId }, current.id, {
            ...presentation,
            removedPaths,
            expectedDraftVersion: current.draftVersion,
            expectedDefinitionVersion: current.definitionVersion,
            expectedPresentationVersion: current.presentationVersion,
          })
        : await createSkillDraft(
            { csrfToken, workspaceId },
            {
              ...presentation,
              name: skillPackageName(
                value.name ?? "",
                value.displayName,
                packageSuffix,
              ),
            },
            `skill-create:${crypto.randomUUID()}`,
          );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["skill-drafts", workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["agent-hub-skills", workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["skill-draft", workspaceId, saved.id],
        }),
      ]);
      setFiles([]);
      setRemovedPaths([]);
      form.setFieldsValue(presentation);
      setDirty(false);
      setSaveComplete(true);
      notification.success({ title: t("agent.editor.saved") });
      leaveBypassRef.current = true;
      if (!current)
        await queryClient.fetchQuery({
          queryKey: ["skill-draft", workspaceId, saved.id],
          queryFn: () => fetchSkillDraft(workspaceId, saved.id),
        });
      onStateChange({ dirty: false, saving: false });
      onSaved(saved);
    } catch (error) {
      setError(
        t(
          error instanceof ApiProblem && error.status === httpStatus.conflict
            ? "agent.skillWorkbench.saveConflict"
            : skillErrorKey(error),
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  function changeFiles(next: SkillFileInput[], removed: string[]): void {
    setFiles(next);
    setRemovedPaths(removed);
    markDirty();
  }
  function editCover(): void {
    setCoverOpen(true);
  }
  function applyCover(id: string | null): void {
    form.setFieldValue("coverAssetId", id ?? undefined);
    markDirty();
    setCoverOpen(false);
  }
  const coverItems = (assets.data?.items ?? []).filter(
    (asset) =>
      asset.lifecycleStatus === "active" &&
      asset.currentArtifact?.mediaType?.startsWith("image/"),
  );
  const identityFields = (
    <>
      <Form.Item
        name="displayName"
        label={t("agent.hub.name")}
        className="!mb-1"
        rules={[
          {
            required: true,
            whitespace: true,
            max: 160,
            message: t("agent.skillWorkbench.nameRequired"),
          },
        ]}
      >
        <Input
          aria-label={t("agent.hub.name")}
          variant="filled"
          className="!rounded-md !px-3 !py-1.5 !text-base !font-semibold"
          maxLength={160}
          placeholder={t("agent.authoring.skillName")}
        />
      </Form.Item>
      <Form.Item
        name="summary"
        label={t("agent.hub.summary")}
        className="!mb-0"
        rules={[
          {
            required: true,
            whitespace: true,
            max: 600,
            message: t("agent.skillWorkbench.summaryRequired"),
          },
        ]}
      >
        <Input.TextArea
          aria-label={t("agent.hub.summary")}
          variant="filled"
          className="!rounded-md !px-3 !py-1.5 !text-sm !text-ink"
          autoSize={{ minRows: 1, maxRows: 2 }}
          maxLength={600}
          placeholder={t("agent.skillWorkbench.summaryPlaceholder")}
        />
      </Form.Item>
    </>
  );
  async function uploadCoverItem(file: File, signal: AbortSignal) {
    const id = await uploadCover(file, signal);
    void queryClient.invalidateQueries({
      queryKey: ["workspace-assets", workspaceId],
    });
    return {
      id,
      name: file.name,
      thumbnail: (
        <AssetArtwork
          assetId={id}
          alt=""
          workspaceId={workspaceId}
          className="h-full w-full"
        >
          <ReadOutlined />
        </AssetArtwork>
      ),
    };
  }
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <Form<SkillEditorValue>
        className="flex min-h-0 flex-1 flex-col"
        form={form}
        initialValues={initialValues}
        key={current?.id ?? "new-skill"}
        disabled={saving}
        onValuesChange={markDirty}
        onFinishFailed={showFirstError}
        layout="vertical"
        onFinish={(value) => void save(value)}
      >
        <header className="shrink-0 border-b border-line/60 px-4 py-3">
          <Form.Item name="coverAssetId" hidden>
            <Input />
          </Form.Item>
          <div className="flex flex-wrap items-start gap-3">
            <Tooltip title={t("agent.skillWorkbench.editCover")}>
              <button
                type="button"
                disabled={!canReadAssets || saving}
                aria-label={t("agent.skillWorkbench.editCover")}
                onClick={editCover}
                className="group relative shrink-0 cursor-pointer rounded-xl border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <AssetArtwork
                  alt={t("agent.hub.cover")}
                  {...(selectedCoverAssetId
                    ? { assetId: selectedCoverAssetId }
                    : {})}
                  workspaceId={workspaceId}
                  className="size-9 rounded-lg bg-primary/8 text-base text-primary"
                >
                  <ReadOutlined />
                </AssetArtwork>
                {canReadAssets && (
                  <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-paper text-[10px] text-muted">
                    <EditOutlined />
                  </span>
                )}
              </button>
            </Tooltip>
            <div className="min-w-0 flex-1">
              <h2 className="m-0 break-words text-base leading-6 font-semibold">
                {displayName ||
                  current?.displayName ||
                  t("agent.hub.createSkill")}
              </h2>
              <div className="mt-1 flex items-center gap-2">
                <Tag className="!m-0 !text-xs !leading-5">{t(statusKey)}</Tag>
                <span role="status" className="text-sm font-medium text-ink">
                  {dirty && t("agent.editor.unsaved")}
                  {!dirty && saveComplete && t("agent.editor.saved")}
                </span>
              </div>
            </div>
            <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
              <Button
                htmlType="submit"
                type={dirty || !current ? "primary" : "default"}
                icon={<SaveOutlined />}
                loading={saving}
                disabled={Boolean(current) && !dirty}
              >
                {t("agent.editor.saveDraft")}
              </Button>
              {current && (
                <ResourceActions
                  workspaceId={workspaceId}
                  csrfToken={csrfToken}
                  kind="skill"
                  id={current.skillDefinitionId}
                  disabled={dirty || saving}
                />
              )}
              {current && (
                <SkillDraftActions
                  draft={current}
                  workspaceId={workspaceId}
                  csrfToken={csrfToken}
                  canPublish={canPublish}
                  disabled={dirty || saving}
                />
              )}
            </div>
          </div>
          {current ? (
            <p className="mt-2 mb-0 text-sm leading-5 text-muted sm:pl-12">
              {summary ?? current.summary}
            </p>
          ) : (
            <div className="mt-4 grid gap-3">{identityFields}</div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-1">
              <span className="mr-3 text-sm font-medium">
                {t("agent.design.content")}
              </span>
              <Button size="small" type="text" onClick={onCancel}>
                {t("agent.skillWorkbench.backToReading")}
              </Button>
              <Button
                size="small"
                type="text"
                icon={<SettingOutlined />}
                onClick={() => setSettingsOpen(true)}
              >
                {t("agent.design.settings")}
              </Button>
            </div>
          </div>
        </header>

        {error && (
          <Alert className="mx-5 mb-3" title={error} type="error" showIcon />
        )}
        <Form.Item
          name="instructions"
          noStyle
          rules={[
            {
              required: true,
              whitespace: true,
              max: 262_144,
              message: t("agent.skillWorkbench.instructionsRequired"),
            },
          ]}
        >
          <SkillInstructionsField
            selection={selection}
            workspaceId={workspaceId}
            resources={current?.resources ?? []}
            {...(current
              ? {
                  source: {
                    kind: "draft" as const,
                    id: current.id,
                    version: current.draftVersion,
                  },
                }
              : {})}
            editing={{
              files,
              removedPaths,
              disabled: saving,
              onFilesChange: changeFiles,
            }}
          />
        </Form.Item>
        <Drawer
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title={t("agent.skillWorkbench.settings")}
          size={400}
          forceRender
        >
          {current && <div className="mb-5 grid gap-3">{identityFields}</div>}
          <Form.Item
            name="description"
            label={t("agent.hub.skillDescription")}
            rules={[{ max: 600 }]}
          >
            <Input.TextArea
              maxLength={600}
              autoSize={{ minRows: 2, maxRows: 5 }}
              placeholder={t("agent.authoring.optionalDescription")}
            />
          </Form.Item>
          <Form.Item name="visibility" label={t("agent.hub.visibilityLabel")}>
            <Radio.Group
              className="!grid gap-3"
              options={[
                {
                  value: "private",
                  label: (
                    <span>
                      <LockOutlined className="mr-2" />
                      {t("agent.hub.visibility.private")}
                    </span>
                  ),
                },
                {
                  value: "workspace",
                  label: (
                    <span>
                      <TeamOutlined className="mr-2" />
                      {t("agent.hub.visibility.workspace")}
                    </span>
                  ),
                },
              ]}
            />
          </Form.Item>
          <h2 className="m-0 mb-2 text-sm font-medium">
            {t("agent.hub.exampleRequests")}
          </h2>
          <Form.List name="exampleRequests">
            {(fields, { add, remove }) => (
              <div className="grid gap-3">
                {fields.map((field) => (
                  <div className="flex items-start gap-2" key={field.key}>
                    <Form.Item
                      {...field}
                      className="!mb-0 flex-1"
                      rules={[{ required: true, whitespace: true, max: 300 }]}
                    >
                      <Input.TextArea
                        aria-label={t("agent.authoring.exampleNumber", {
                          count: field.name + 1,
                        })}
                        maxLength={300}
                        autoSize={{ minRows: 1, maxRows: 3 }}
                        placeholder={t("agent.authoring.examplePlaceholder")}
                      />
                    </Form.Item>
                    <Button
                      type="text"
                      aria-label={t("agent.authoring.removeExample", {
                        count: field.name + 1,
                      })}
                      icon={<DeleteOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  </div>
                ))}
                <Button
                  disabled={saving || fields.length >= maximumExamples}
                  icon={<PlusOutlined />}
                  onClick={() => add("")}
                >
                  {t("agent.authoring.addExample")}
                </Button>
              </div>
            )}
          </Form.List>
        </Drawer>
      </Form>
      {coverOpen ? (
        <CoverPickerDialog
          initialSelection={selectedCoverAssetId ?? null}
          items={coverItems.map((asset) => ({
            id: asset.id,
            name: asset.name,
            thumbnail: (
              <AssetArtwork
                assetId={asset.id}
                alt=""
                workspaceId={workspaceId}
                className="h-full w-full"
              >
                <ReadOutlined />
              </AssetArtwork>
            ),
          }))}
          loading={assets.isPending}
          {...(assets.isError
            ? { loadError: t("agent.editor.resourceLoadError") }
            : {})}
          canUpload={canUploadAssets && canReadAssets}
          onRetry={retryCoverAssets}
          onUpload={uploadCoverItem}
          onConfirm={applyCover}
          onCancel={() => setCoverOpen(false)}
        />
      ) : null}
      <UnsavedChangesGuard
        active={dirty || saving}
        bypass={leaveBypassRef}
        title={t("agent.editor.leaveTitle")}
        actionLabel={t("agent.editor.discard")}
        cancelLabel={t("agent.editor.keepEditing")}
      >
        {t("agent.editor.leaveDescription")}
      </UnsavedChangesGuard>
    </div>
  );
}
