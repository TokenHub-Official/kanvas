import {
  libraryPreviewQueryOptions,
  libraryTextQueryOptions,
} from "../features/resource-libraries/library-preview-query.js";
import { LibraryDocumentEditor } from "../features/resource-libraries/library-document-editor.js";
import {
  catalogGridClassName,
  catalogRowLayoutClassName,
  catalogRowClassName,
  catalogEntryLinkClassName,
} from "../components/catalog-layout.js";
import { httpStatus } from "../api/http-status.js";
import { LibraryTextContent } from "../features/resource-libraries/library-content.js";
import {
  ArrowLeftOutlined,
  EditOutlined,
  FileOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SaveOutlined,
  SearchOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { UnsavedChangesGuard } from "../components/unsaved-changes-guard.js";
import type { LibraryDocument, LibrarySummary } from "@kanvas/contracts/api";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  App,
  Button,
  Empty,
  Modal,
  Space,
  Spin,
  Dropdown,
  Image,
  Segmented,
  Skeleton,
  Tag,
  Tooltip,
} from "antd";
import { useDeferredValue, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ulid } from "ulid";
import { WorkspacePage } from "../components/workspace-page.js";
import { KanvasInput, KanvasTextArea } from "../components/kanvas-input.js";
import { ApiProblem, type WorkspaceApiContext } from "../api/transport.js";
import {
  BrandLogoPickerModal,
  type BrandImageSelection,
} from "../features/brand/brand-logo-picker.js";
import { useObjectUrl } from "../components/use-object-url.js";
import {
  changeLibraryLifecycle,
  fetchLibraries,
  fetchLibrary,
  libraryFileMediaType,
  saveLibrary,
  uploadLibraryFile,
} from "../features/resource-libraries/api.js";

const listRoute = getRouteApi("/w/$workspaceId/libraries");
const detailRoute = getRouteApi("/w/$workspaceId/libraries/$libraryId");
const maximumEntries = 200;
export function LibrariesPage() {
  const { workspaceId } = listRoute.useParams();
  const { t } = useTranslation();
  return (
    <WorkspacePage pageTitle={t("libraries.title")} workspaceId={workspaceId}>
      {({ context, workspace }) => (
        <LibraryList
          context={{ workspaceId, csrfToken: context.csrfToken }}
          canRead={workspace.permissions.includes("library.read")}
          canManage={workspace.permissions.includes("library.manage")}
        />
      )}
    </WorkspacePage>
  );
}
function LibraryList({
  context,
  canRead,
  canManage,
}: {
  context: WorkspaceApiContext;
  canRead: boolean;
  canManage: boolean;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query);
  const [archived, setArchived] = useState(false);
  const emptyLabel = archived ? "libraries.noArchived" : "libraries.empty";
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const requestRef = useRef<
    { name: string; id: string; key: string } | undefined
  >(undefined);
  const list = useInfiniteQuery({
    queryKey: ["resource-libraries", context.workspaceId, search, archived],
    enabled: canRead,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      fetchLibraries(
        context.workspaceId,
        {
          query: search,
          lifecycleStatus: archived ? "archived" : "active",
          ...(pageParam ? { afterId: pageParam } : {}),
        },
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor,
  });
  const create = useMutation({
    mutationFn: async () => {
      if (!requestRef.current || requestRef.current.name !== name.trim())
        requestRef.current = {
          name: name.trim(),
          id: ulid(),
          key: crypto.randomUUID(),
        };
      const attemptRef = requestRef.current;
      await saveLibrary(
        context,
        attemptRef.id,
        0,
        {
          schemaVersion: 1,
          name: attemptRef.name,
          description: "",
          entries: [],
        },
        attemptRef.key,
      );
      return attemptRef.id;
    },
    onSuccess: (libraryId) => {
      void navigate({
        to: "/w/$workspaceId/libraries/$libraryId",
        params: { workspaceId: context.workspaceId, libraryId },
      });
    },
  });
  if (!canRead) return <Empty description={t("libraries.noAccess")} />;

  function openCreateDialog() {
    setCreating(true);
    create.reset();
  }
  return (
    <section className="mx-auto flex w-full max-w-[1320px] flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <KanvasInput
            className="w-full sm:w-96"
            allowClear
            prefix={<SearchOutlined />}
            aria-label={t("libraries.search")}
            placeholder={t("libraries.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Segmented
            aria-label={t("libraries.statusFilter")}
            value={archived ? "archived" : "active"}
            onChange={(value) => setArchived(value === "archived")}
            options={[
              { value: "active", label: t("libraries.active") },
              { value: "archived", label: t("libraries.archived") },
            ]}
          />
        </div>
        {canManage && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreateDialog}
          >
            {t("libraries.create")}
          </Button>
        )}
      </div>
      {list.isError && (
        <Alert
          type="error"
          showIcon
          title={t("libraries.loadFailed")}
          action={
            <Button onClick={() => void list.refetch()}>
              {t("libraries.retry")}
            </Button>
          }
        />
      )}
      {list.isPending ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : (
        !list.isError &&
        ((list.data?.pages.flatMap((page) => page.items).length ?? 0) > 0 ? (
          <div
            className={`${catalogGridClassName} overflow-hidden rounded-xl bg-paper`}
          >
            <div
              className={`${catalogRowLayoutClassName} bg-mist/50 text-xs text-muted max-[767px]:hidden`}
            >
              <span>{t("libraries.libraryPurpose")}</span>
              <span>{t("libraries.entries")}</span>
              <span className="max-[1100px]:hidden">
                {t("agent.hub.updated")}
              </span>
              <span />
            </div>
            {list.data?.pages
              .flatMap((page) => page.items)
              .map((item) => (
                <article key={item.id} className={catalogRowClassName}>
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-mist text-base text-muted">
                      <FolderOpenOutlined />
                    </span>
                    <div className="min-w-0">
                      <Link
                        to="/w/$workspaceId/libraries/$libraryId"
                        params={{
                          workspaceId: context.workspaceId,
                          libraryId: item.id,
                        }}
                        title={item.name}
                        className={`${catalogEntryLinkClassName} inline-flex min-w-0 items-center gap-2 rounded text-sm font-semibold text-ink no-underline hover:text-primary`}
                      >
                        <span className="truncate">{item.name}</span>
                        <RightOutlined
                          aria-hidden="true"
                          className="shrink-0 text-xs text-muted"
                        />
                      </Link>
                      <p
                        className="m-0 mt-1 max-w-[60ch] truncate text-sm leading-5 text-muted"
                        title={item.description}
                      >
                        {item.description}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted max-[767px]:col-start-1 max-[767px]:row-start-2">
                    {t("libraries.entryCount", { count: item.entryCount })}
                  </span>
                  <span className="text-xs text-muted max-[1100px]:hidden">
                    {new Intl.DateTimeFormat(i18n.language, {
                      month: "short",
                      day: "numeric",
                    }).format(new Date(item.updatedAt))}
                  </span>
                  <span />
                </article>
              ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t(query ? "libraries.noMatches" : emptyLabel)}
            >
              {query ? (
                <Button onClick={() => setQuery("")}>
                  {t("libraries.clearSearch")}
                </Button>
              ) : null}
            </Empty>
          </div>
        ))
      )}
      {list.hasNextPage && (
        <Button
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t("libraries.more")}
        </Button>
      )}
      <Modal
        title={t("libraries.create")}
        open={creating}
        onCancel={() => !create.isPending && setCreating(false)}
        onOk={() => create.mutate()}
        okText={t("libraries.create")}
        cancelText={t("libraries.cancel")}
        confirmLoading={create.isPending}
        closable={!create.isPending}
        cancelButtonProps={{ disabled: create.isPending }}
        okButtonProps={{ disabled: !name.trim() }}
      >
        <label className="flex flex-col gap-2">
          {t("libraries.name")}
          <KanvasInput
            autoFocus
            maxLength={160}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {create.isError && (
          <Alert type="error" title={t("libraries.createFailed")} />
        )}
      </Modal>
    </section>
  );
}
export function LibraryDetailPage() {
  const { workspaceId, libraryId } = detailRoute.useParams();
  const { t } = useTranslation();
  return (
    <WorkspacePage pageTitle={t("libraries.title")} workspaceId={workspaceId}>
      {({ context, workspace }) => (
        <LibraryDetail
          key={libraryId}
          context={{ workspaceId, csrfToken: context.csrfToken }}
          libraryId={libraryId}
          canManage={workspace.permissions.includes("library.manage")}
          canReadAssets={workspace.permissions.includes("asset.read")}
        />
      )}
    </WorkspacePage>
  );
}
function LibraryDetail({
  context,
  libraryId,
  canManage,
  canReadAssets,
}: {
  context: WorkspaceApiContext;
  libraryId: string;
  canManage: boolean;
  canReadAssets: boolean;
}) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string>();
  const detail = useQuery({
    queryKey: ["resource-library", context.workspaceId, libraryId],
    queryFn: ({ signal }) =>
      fetchLibrary(context.workspaceId, libraryId, signal),
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  if (detail.isPending)
    return (
      <div className="mx-auto w-full max-w-6xl p-6">
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  if (detail.isError) {
    const unavailable =
      detail.error instanceof ApiProblem &&
      (detail.error.status === httpStatus.notFound ||
        detail.error.status === httpStatus.forbidden);
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-6 p-6">
        <Link
          className="flex w-fit items-center gap-2 text-sm text-muted"
          to="/w/$workspaceId/libraries"
          params={{ workspaceId: context.workspaceId }}
        >
          <ArrowLeftOutlined />
          {t("libraries.back")}
        </Link>
        {unavailable ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("libraries.unavailable")}
          />
        ) : (
          <Alert
            type="error"
            showIcon
            title={t("libraries.loadFailed")}
            action={
              <Button onClick={() => void detail.refetch()}>
                {t("libraries.retry")}
              </Button>
            }
          />
        )}
      </section>
    );
  }
  return (
    <LibraryEditor
      key={`${libraryId}:${detail.data.library.version}`}
      context={context}
      library={detail.data.library}
      initial={detail.data.revision.document}
      selectedId={selectedId}
      setSelectedId={setSelectedId}
      canManage={canManage}
      canReadAssets={canReadAssets}
    />
  );
}
function LibraryEditor({
  context,
  library,
  initial,
  selectedId,
  setSelectedId,
  canManage,
  canReadAssets,
}: {
  context: WorkspaceApiContext;
  library: LibrarySummary;
  initial: LibraryDocument;
  selectedId: string | undefined;
  setSelectedId: (id: string | undefined) => void;
  canManage: boolean;
  canReadAssets: boolean;
}) {
  const { t } = useTranslation();
  const { modal, message } = App.useApp();
  const cache = useQueryClient();
  const [document, setDocument] = useState(initial);
  const [picker, setPicker] = useState(false);
  const [entrySearch, setEntrySearch] = useState("");
  const entryQuery = entrySearch.trim().toLocaleLowerCase();
  const matchingEntries = document.entries.filter((entry) =>
    `${entry.name} ${entry.purpose}`.toLocaleLowerCase().includes(entryQuery),
  );
  const [textEditing, setTextEditing] = useState<{
    name: string;
    text: string;
    mediaType: "text/plain" | "text/markdown";
    entryId?: string;
  }>();
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [entryEditing, setEntryEditing] = useState<string>();
  const [removedEntry, setRemovedEntry] = useState<{
    entry: LibraryDocument["entries"][number];
    index: number;
  }>();
  const selected =
    document.entries.find((entry) => entry.id === selectedId) ??
    document.entries[0];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replacementRef = useRef<string | undefined>(undefined);
  const [pendingUpload, setPendingUpload] = useState<
    { file: File; key: string; entryId?: string } | undefined
  >();
  const attemptRef = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  const editable = canManage && library.lifecycleStatus === "active";
  const dirty = JSON.stringify(document) !== JSON.stringify(initial);
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({
        queryKey: ["resource-library", context.workspaceId, library.id],
      }),
      cache.invalidateQueries({
        queryKey: ["resource-libraries", context.workspaceId],
      }),
    ]);
  };
  const save = useMutation({
    mutationFn: async () => {
      const signature = JSON.stringify(document);
      if (attemptRef.current?.signature !== signature)
        attemptRef.current = { signature, key: crypto.randomUUID() };
      return saveLibrary(
        context,
        library.id,
        library.version,
        document,
        attemptRef.current.key,
      );
    },
    onSuccess: async () => {
      await refresh();
      void message.success(t("libraries.saved"));
    },
  });
  const lifecycle = useMutation({
    mutationFn: () =>
      changeLibraryLifecycle(
        context,
        library.id,
        library.version,
        library.lifecycleStatus === "active" ? "archived" : "active",
      ),
    onSuccess: refresh,
  });
  const upload = useMutation({
    mutationFn: (input: NonNullable<typeof pendingUpload>) =>
      uploadLibraryFile(context, library.id, input.file, input.key),
    onSuccess: (file, input) => {
      const entryId = input.entryId ?? ulid();
      setSelectedId(entryId);
      setEntrySearch("");
      setDocument((current) => ({
        ...current,
        entries: input.entryId
          ? current.entries.map((entry) =>
              entry.id === input.entryId
                ? {
                    id: entry.id,
                    name: entry.name,
                    purpose: entry.purpose,
                    artifactId: file.artifactId,
                  }
                : entry,
            )
          : [
              ...current.entries,
              {
                id: entryId,
                name: input.file.name,
                purpose: "",
                artifactId: file.artifactId,
              },
            ],
      }));
      setPendingUpload(undefined);
    },
  });
  const busy = save.isPending || lifecycle.isPending || upload.isPending;
  const blocked = busy || Boolean(pendingUpload);
  const invalidNames = document.entries.some((entry) => !entry.name.trim());
  let uploadErrorLabel = "libraries.uploadFailed";
  if (upload.error instanceof ApiProblem) {
    if (
      [
        "resource_library.document_limit",
        "resource_library.document_complex",
      ].includes(upload.error.code)
    )
      uploadErrorLabel = "libraries.documentLimit";
    else if (
      [
        "resource_library.document_invalid",
        "resource_library.extraction_invalid",
      ].includes(upload.error.code)
    )
      uploadErrorLabel = "libraries.documentUnreadable";
  }
  function chooseUpload(entryId?: string) {
    replacementRef.current = entryId;
    fileInputRef.current?.click();
  }
  function updateEntry(id: string, patch: { name?: string; purpose?: string }) {
    setDocument((current) => ({
      ...current,
      entries: current.entries.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    }));
  }

  function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!libraryFileMediaType(file)) {
      void message.error(t("libraries.unsupported"));
      return;
    }
    const input = {
      file,
      key: crypto.randomUUID(),
      ...(replacementRef.current ? { entryId: replacementRef.current } : {}),
    };
    setPendingUpload(input);
    upload.mutate(input);
  }

  function cancelPendingUpload() {
    setPendingUpload(undefined);
    upload.reset();
  }

  function undoRemoval() {
    if (!removedEntry) return;

    setDocument((current) => ({
      ...current,
      entries: [
        ...current.entries.slice(0, removedEntry.index),
        removedEntry.entry,
        ...current.entries.slice(removedEntry.index),
      ],
    }));
    setRemovedEntry(undefined);
  }

  async function applyDocument(file: File, key: string) {
    if (!textEditing) return;

    await upload.mutateAsync({
      file,
      key,
      ...(textEditing.entryId ? { entryId: textEditing.entryId } : {}),
    });
    setTextEditing(undefined);
  }

  function applyMetadata(name: string, description: string) {
    setDocument((current) => ({ ...current, name, description }));
    setMetadataOpen(false);
  }

  function applyEntryDetails(name: string, purpose: string) {
    if (!entryEditing) return;

    updateEntry(entryEditing, { name, purpose });
    setEntryEditing(undefined);
  }

  function selectAsset(asset: BrandImageSelection) {
    if (asset.currentArtifact) {
      const existing = document.entries.find(
        (entry) => entry.artifactId === asset.currentArtifact!.id,
      );
      if (existing) {
        setSelectedId(existing.id);
        void message.info(t("libraries.duplicate"));
      } else {
        const entryId = ulid();
        setSelectedId(entryId);
        setDocument((current) => ({
          ...current,
          entries: [
            ...current.entries,
            {
              id: entryId,
              name: asset.name,
              purpose: "",
              sourceAssetId: asset.id,
              artifactId: asset.currentArtifact!.id,
            },
          ],
        }));
      }
    }
    setPicker(false);
  }
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-4 sm:p-6">
      <UnsavedChangesGuard
        active={dirty || busy || Boolean(pendingUpload) || Boolean(textEditing)}
        title={t("libraries.discard")}
        actionLabel={t("libraries.leave")}
        cancelLabel={t("libraries.keepEditing")}
      >
        {t("libraries.unsavedHint")}
      </UnsavedChangesGuard>
      <Link
        className="flex w-fit items-center gap-2 text-sm text-muted hover:text-ink"
        to="/w/$workspaceId/libraries"
        params={{ workspaceId: context.workspaceId }}
      >
        <ArrowLeftOutlined />
        {t("libraries.back")}
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="m-0 break-words text-xl font-semibold text-ink">
              {document.name}
            </h1>
            {library.lifecycleStatus === "archived" && (
              <Tag>{t("libraries.archived")}</Tag>
            )}
          </div>
          {document.description && (
            <p className="mb-0 mt-1 max-w-prose whitespace-pre-wrap break-words text-sm text-muted">
              {document.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          {dirty && (
            <span role="status" className="text-xs text-muted">
              {t("libraries.unsaved")}
            </span>
          )}
          {editable && dirty && (
            <Button
              type="primary"
              icon={<SaveOutlined />}
              disabled={
                blocked || !dirty || !document.name.trim() || invalidNames
              }
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              {t("libraries.save")}
            </Button>
          )}
          {canManage && (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  ...(editable
                    ? [
                        {
                          key: "edit",
                          label: t("libraries.editDetails"),
                          icon: <EditOutlined />,
                          disabled: blocked,
                          onClick: () => setMetadataOpen(true),
                        },
                      ]
                    : []),
                  {
                    key: "lifecycle",
                    label: (
                      <span>
                        {t(
                          library.lifecycleStatus === "active"
                            ? "libraries.archive"
                            : "libraries.restore",
                        )}
                        {dirty && (
                          <span className="ml-2 text-xs">
                            {t("libraries.saveFirst")}
                          </span>
                        )}
                      </span>
                    ),
                    disabled: blocked || dirty,
                    onClick: () =>
                      void modal.confirm({
                        title: t(
                          library.lifecycleStatus === "active"
                            ? "libraries.archiveTitle"
                            : "libraries.restoreConfirm",
                        ),
                        content: t(
                          library.lifecycleStatus === "active"
                            ? "libraries.archiveConsequence"
                            : "libraries.restoreHint",
                        ),
                        okText: t(
                          library.lifecycleStatus === "active"
                            ? "libraries.archive"
                            : "libraries.restore",
                        ),
                        cancelText: t("libraries.cancel"),
                        onOk: () => lifecycle.mutateAsync(),
                      }),
                  },
                ],
              }}
            >
              <Button
                icon={<MoreOutlined />}
                aria-label={t("libraries.manage")}
              />
            </Dropdown>
          )}
        </div>
      </div>
      {library.lifecycleStatus === "archived" && (
        <Alert
          type="info"
          showIcon
          title={t("libraries.archiveConsequence")}
          action={
            canManage ? (
              <Button
                onClick={() => lifecycle.mutate()}
                loading={lifecycle.isPending}
              >
                {t("libraries.restore")}
              </Button>
            ) : undefined
          }
        />
      )}
      {invalidNames && (
        <Alert type="warning" showIcon title={t("libraries.nameRequired")} />
      )}
      {(save.isError || lifecycle.isError) && (
        <Alert
          type="error"
          showIcon
          title={t(
            save.error instanceof ApiProblem &&
              save.error.status === httpStatus.conflict
              ? "libraries.conflict"
              : "libraries.saveFailedTitle",
          )}
          description={t("libraries.failedSave")}
          action={
            save.isError &&
            !(
              save.error instanceof ApiProblem &&
              save.error.status === httpStatus.conflict
            ) ? (
              <Button onClick={() => save.mutate()} loading={save.isPending}>
                {t("libraries.retrySave")}
              </Button>
            ) : (
              <Button
                onClick={() =>
                  void modal.confirm({
                    title: t("libraries.discard"),
                    content: t("libraries.reloadConsequence"),
                    okText: t("libraries.reload"),
                    cancelText: t("libraries.keepEditing"),
                    onOk: refresh,
                  })
                }
              >
                {t("libraries.reload")}
              </Button>
            )
          }
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-base font-semibold">
          {t("libraries.entries")}{" "}
          <span className="ml-1 text-sm font-normal text-muted">
            {document.entries.length}
          </span>
        </h2>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<PlusOutlined />}
              disabled={blocked || document.entries.length >= maximumEntries}
              onClick={() =>
                setTextEditing({
                  name: "",
                  text: "",
                  mediaType: "text/markdown",
                })
              }
            >
              {t("libraries.newDocument")}
            </Button>
            <Tooltip placement="bottom" title={t("libraries.uploadHint")}>
              <Button
                icon={<UploadOutlined />}
                disabled={blocked || document.entries.length >= maximumEntries}
                onClick={() => chooseUpload()}
              >
                {t("libraries.upload")}
              </Button>
            </Tooltip>
            {canReadAssets && (
              <Button
                icon={<PlusOutlined />}
                disabled={blocked || document.entries.length >= maximumEntries}
                onClick={() => setPicker(true)}
              >
                {t("libraries.fromAssets")}
              </Button>
            )}
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        hidden
        accept=".png,.jpg,.jpeg,.webp,.txt,.md,.markdown,.pdf,.docx"
        onChange={handleFileSelection}
      />
      {upload.isPending && (
        <Spin description={t("libraries.uploading")}>
          <div className="h-8" />
        </Spin>
      )}
      {upload.isError && pendingUpload && (
        <Alert
          type="error"
          showIcon
          title={t(uploadErrorLabel)}
          action={
            <Space>
              <Button onClick={() => upload.mutate(pendingUpload)}>
                {t("libraries.retry")}
              </Button>
              <Button onClick={cancelPendingUpload}>
                {t("libraries.cancel")}
              </Button>
            </Space>
          }
        />
      )}
      {removedEntry && (
        <Alert
          type="info"
          showIcon
          title={t("libraries.removed", { name: removedEntry.entry.name })}
          action={
            <Button
              disabled={busy || document.entries.length >= maximumEntries}
              onClick={undoRemoval}
            >
              {t("libraries.undo")}
            </Button>
          }
        />
      )}
      {!document.entries.length ? (
        <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-line">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("libraries.noEntries")}
          />
        </div>
      ) : (
        <div className="grid min-w-0 overflow-hidden rounded-xl border border-line bg-paper md:grid-cols-[240px_minmax(0,1fr)]">
          <nav
            aria-label={t("libraries.entries")}
            className="max-h-64 overflow-auto border-b border-line p-2 md:max-h-[65vh] md:border-b-0 md:border-r"
          >
            <div className="sticky top-0 z-10 bg-paper pb-2">
              <KanvasInput
                size="small"
                allowClear
                prefix={<SearchOutlined />}
                value={entrySearch}
                onChange={(event) => setEntrySearch(event.target.value)}
                placeholder={t("libraries.searchEntries")}
                aria-label={t("libraries.searchEntries")}
              />
            </div>
            {!matchingEntries.length && (
              <p role="status" className="px-3 py-6 text-sm text-muted">
                {t("libraries.noEntryMatches")}
              </p>
            )}
            {matchingEntries.map((entry) => (
              <div
                key={entry.id}
                className={`flex min-w-0 items-center rounded-lg ${selected?.id === entry.id ? "bg-primary/8" : "hover:bg-mist"}`}
              >
                <button
                  type="button"
                  aria-current={selected?.id === entry.id ? "true" : undefined}
                  onClick={() => setSelectedId(entry.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <FileOutlined className="shrink-0 text-sm text-muted" />
                  <span className="min-w-0" title={entry.purpose || entry.name}>
                    <span className="block truncate text-sm font-medium text-ink">
                      {entry.name}
                    </span>
                  </span>
                </button>
                {editable && (
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: [
                        {
                          key: "details",
                          label: t("libraries.editEntry"),
                          icon: <EditOutlined />,
                          onClick: () => setEntryEditing(entry.id),
                        },
                        {
                          key: "replace",
                          label: t("libraries.replace"),
                          icon: <ReloadOutlined />,
                          onClick: () => chooseUpload(entry.id),
                        },
                        {
                          key: "remove",
                          label: t("libraries.remove"),
                          danger: true,
                          onClick: () => {
                            setRemovedEntry({
                              entry,
                              index: document.entries.findIndex(
                                (item) => item.id === entry.id,
                              ),
                            });
                            setDocument((current) => ({
                              ...current,
                              entries: current.entries.filter(
                                (item) => item.id !== entry.id,
                              ),
                            }));
                          },
                        },
                      ],
                    }}
                  >
                    <Button
                      type="text"
                      size="small"
                      disabled={blocked}
                      icon={<MoreOutlined />}
                      aria-label={t("libraries.entryActions", {
                        name: entry.name,
                      })}
                    />
                  </Dropdown>
                )}
              </div>
            ))}
          </nav>
          <section className="min-w-0" aria-label={t("libraries.preview")}>
            {selected && (
              <LibraryPreview
                key={selected.artifactId}
                libraryId={library.id}
                workspaceId={context.workspaceId}
                artifact={{ id: selected.artifactId, name: selected.name }}
                {...(editable
                  ? {
                      onEdit: (
                        text: string,
                        mediaType: "text/plain" | "text/markdown",
                      ) =>
                        setTextEditing({
                          name: selected.name,
                          text,
                          mediaType,
                          entryId: selected.id,
                        }),
                      editingDisabled: blocked,
                    }
                  : {})}
                header={
                  <div className="min-w-0 flex-1">
                    <h3 className="m-0 break-words text-base font-semibold">
                      {selected.name}
                    </h3>
                    {selected.sourceAssetId && (
                      <Link
                        className="mt-1 inline-block text-xs"
                        to="/w/$workspaceId/assets/$assetId"
                        params={{
                          workspaceId: context.workspaceId,
                          assetId: selected.sourceAssetId,
                        }}
                      >
                        {t("libraries.openAsset")}
                      </Link>
                    )}
                    {selected.purpose && (
                      <p className="mb-0 mt-1 whitespace-pre-wrap break-words text-sm text-muted">
                        {selected.purpose}
                      </p>
                    )}
                  </div>
                }
              />
            )}
          </section>
        </div>
      )}
      {textEditing && (
        <LibraryDocumentEditor
          initial={textEditing}
          onClose={() => setTextEditing(undefined)}
          onApply={applyDocument}
        />
      )}
      {metadataOpen && (
        <LibraryFieldsDialog
          title={t("libraries.editDetails")}
          name={document.name}
          description={document.description}
          nameLabel={t("libraries.name")}
          descriptionLabel={t("libraries.description")}
          nameLimit={160}
          descriptionLimit={2000}
          onClose={() => setMetadataOpen(false)}
          onApply={applyMetadata}
        />
      )}
      {entryEditing &&
        document.entries.find((entry) => entry.id === entryEditing) && (
          <LibraryFieldsDialog
            title={t("libraries.editEntry")}
            name={
              document.entries.find((entry) => entry.id === entryEditing)!.name
            }
            description={
              document.entries.find((entry) => entry.id === entryEditing)!
                .purpose
            }
            nameLabel={t("libraries.fileName")}
            descriptionLabel={t("libraries.purpose")}
            nameLimit={240}
            descriptionLimit={1000}
            onClose={() => setEntryEditing(undefined)}
            onApply={applyEntryDetails}
          />
        )}
      <BrandLogoPickerModal
        open={picker}
        title={t("libraries.fromAssets")}
        applyLabel={t("libraries.add")}
        workspaceId={context.workspaceId}
        onCancel={() => setPicker(false)}
        onSelect={selectAsset}
      />
    </section>
  );
}
function LibraryPreview({
  workspaceId,
  libraryId,
  artifact,
  header,
  onEdit,
  editingDisabled,
}: {
  onEdit?: (text: string, mediaType: "text/plain" | "text/markdown") => void;
  editingDisabled?: boolean;
  header: ReactNode;
  workspaceId: string;
  libraryId: string;
  artifact: { id: string; name: string };
}) {
  const { t } = useTranslation();
  const content = useQuery(
    libraryPreviewQueryOptions(
      workspaceId,
      artifact.id,
      t("libraries.unsupported"),
    ),
  );
  const extracted = useQuery(
    libraryTextQueryOptions(
      workspaceId,
      libraryId,
      artifact.id,
      content.isSuccess && content.data.blob.type.startsWith("application/"),
    ),
  );
  const url = useObjectUrl(content.data?.blob);
  return (
    <div>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        {header}
        {content.isSuccess && content.data.text !== undefined && onEdit && (
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            disabled={editingDisabled ?? false}
            onClick={() =>
              onEdit(
                content.data.text!,
                content.data.blob.type === "text/markdown"
                  ? "text/markdown"
                  : "text/plain",
              )
            }
          >
            {t("libraries.editContent")}
          </Button>
        )}
        {content.isSuccess && url && (
          <Button
            type="text"
            size="small"
            icon={<DownloadOutlined />}
            href={url}
            download={artifact.name}
          >
            {t("libraries.download")}
          </Button>
        )}
      </div>
      <div className="min-h-48 p-4">
        {content.isPending && (
          <div
            role="status"
            aria-label={t("libraries.loadingPreview")}
            className="grid min-h-64 place-items-center"
          >
            <Spin />
          </div>
        )}
        {content.isError && (
          <Alert
            type="error"
            title={t("libraries.previewFailed")}
            action={
              <Button onClick={() => void content.refetch()}>
                {t("libraries.retry")}
              </Button>
            }
          />
        )}
        {content.isSuccess &&
          content.data.blob.type.startsWith("application/") && (
            <>
              {extracted.isPending && <Spin />}
              {extracted.isError && (
                <Alert
                  type="error"
                  title={t("libraries.extractionFailed")}
                  action={
                    <Button onClick={() => void extracted.refetch()}>
                      {t("libraries.retry")}
                    </Button>
                  }
                />
              )}
              {extracted.isSuccess && (
                <div className="max-h-[65vh] overflow-auto">
                  {extracted.data.pageRanges.length ? (
                    extracted.data.pageRanges.map((page) => (
                      <section key={page.page} className="mb-5">
                        <div className="mb-2 text-xs text-muted">
                          {t("libraries.page", { number: page.page })}
                        </div>
                        <LibraryTextContent
                          text={extracted.data.text.slice(
                            page.startOffset,
                            page.endOffset,
                          )}
                          markdown={false}
                        />
                      </section>
                    ))
                  ) : (
                    <LibraryTextContent
                      text={extracted.data.text}
                      markdown={false}
                    />
                  )}
                </div>
              )}
            </>
          )}
        {content.isSuccess && content.data.text !== undefined && (
          <div className="max-h-[65vh] overflow-auto">
            <LibraryTextContent
              text={content.data.text}
              markdown={content.data.blob.type === "text/markdown"}
            />
          </div>
        )}
        {content.isSuccess &&
          content.data.blob.type.startsWith("image/") &&
          url && (
            <Image
              src={url}
              alt={artifact.name}
              styles={{
                root: { width: "100%" },
                image: {
                  maxHeight: "60vh",
                  objectFit: "contain",
                  width: "100%",
                },
              }}
            />
          )}
      </div>
    </div>
  );
}

function LibraryFieldsDialog({
  title,
  name,
  description,
  nameLabel,
  descriptionLabel,
  nameLimit,
  descriptionLimit,
  onClose,
  onApply,
}: {
  title: string;
  name: string;
  description: string;
  nameLabel: string;
  descriptionLabel: string;
  nameLimit: number;
  descriptionLimit: number;
  onClose: () => void;
  onApply: (name: string, description: string) => void;
}) {
  const { t } = useTranslation();
  const [draftName, setDraftName] = useState(name);
  const [draftDescription, setDraftDescription] = useState(description);
  return (
    <Modal
      open
      title={title}
      onCancel={onClose}
      onOk={() => onApply(draftName.trim(), draftDescription)}
      okText={t("libraries.apply")}
      cancelText={t("libraries.cancel")}
      okButtonProps={{ disabled: !draftName.trim() }}
    >
      <div className="grid gap-4 py-2">
        <label className="grid gap-2 text-sm">
          {nameLabel}
          <KanvasInput
            autoFocus
            value={draftName}
            maxLength={nameLimit}
            onChange={(event) => setDraftName(event.target.value)}
          />
        </label>
        <label className="grid gap-2 text-sm">
          {descriptionLabel}
          <KanvasTextArea
            autoSize={{ minRows: 3, maxRows: 6 }}
            value={draftDescription}
            maxLength={descriptionLimit}
            onChange={(event) => setDraftDescription(event.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}
