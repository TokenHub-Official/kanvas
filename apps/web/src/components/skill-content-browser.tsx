import {
  DeleteOutlined,
  DownloadOutlined,
  FileOutlined,
  FileTextOutlined,
  FileImageOutlined,
  FolderOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type {
  AgentHubSkillDetail,
  SkillFileInput,
} from "@kanvas/contracts/api";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AutoComplete,
  Button,
  Drawer,
  Input,
  Modal,
  Popconfirm,
  Skeleton,
  Segmented,
  Select,
  Tree,
  Upload,
} from "antd";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import {
  ApiProblem,
  fetchSkillFile,
  type SkillFileSource,
} from "../api/transport.js";
import { httpStatus } from "../api/http-status.js";

const minimumCodeFenceLength = 3;
const maximumFileBytes = 2_097_152;
const maximumFilePathBytes = 500;
const maximumFilePathDepth = 12;
const downloadUrlLifetime = 1_000;
const maximumTextLength = 262_144;
const maximumChangedFiles = 20;
type FileNode = {
  key: string;
  title: string;
  isLeaf?: boolean;
  children?: FileNode[];
};
export function skillFileTree(paths: readonly string[]): FileNode[] {
  const roots: FileNode[] = [];
  for (const path of [...new Set(["SKILL.md", ...paths])].sort()) {
    let children = roots;
    let parent = "";
    const parts = path.split("/").filter(Boolean);
    parts.forEach((part, index) => {
      const key = parent ? `${parent}/${part}` : part;
      let node = children.find((item) => item.key === key);
      if (!node) {
        node = { key, title: part, isLeaf: index === parts.length - 1 };
        children.push(node);
      }
      if (index < parts.length - 1) {
        node.children ??= [];
        children = node.children;
      }
      parent = key;
    });
  }
  return roots;
}
export function validNewSkillPath(path: string): boolean {
  return (
    Boolean(path) &&
    new TextEncoder().encode(path).byteLength <= maximumFilePathBytes &&
    path === path.normalize("NFC") &&
    path.split("/").length <= maximumFilePathDepth &&
    !path.startsWith("/") &&
    !/[\\:]/u.test(path) &&
    !/\p{Cc}/u.test(path) &&
    !path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          part.endsWith(" ") ||
          part.endsWith("."),
      ) &&
    !["skill.md", "kanvas.yaml"].includes(path.split("/")[0]!.toLowerCase())
  );
}
export function skillFileDestination(
  directory: string,
  filename: string,
): string {
  return [directory.trim(), filename.trim()]
    .filter(Boolean)
    .join("/")
    .normalize("NFC");
}
export function skillMarkdownPreview(content: string): string {
  const match = content.match(
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u,
  );
  if (!match) return content;
  const frontmatter = match[1]!;
  const fence = "`".repeat(
    Math.max(
      minimumCodeFenceLength,
      ...(frontmatter.match(/`+/gu) ?? []).map((value) => value.length + 1),
    ),
  );
  return `${fence}yaml\n${frontmatter}\n${fence}\n\n${match[2]}`;
}
function textFile(path: string, mediaType: string): boolean {
  return (
    mediaType.startsWith("text/") ||
    /(?:json|yaml|javascript|xml)/u.test(mediaType) ||
    /\.(?:md|txt|py|js|ts|tsx|jsx|json|yaml|yml|sh|csv|css|html|sql|toml)$/iu.test(
      path,
    )
  );
}
function blobForInput(file: SkillFileInput): Blob {
  if ("text" in file) return new Blob([file.text], { type: "text/plain" });
  const extension = file.path.split(".").at(-1)?.toLowerCase() ?? "";
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    pdf: "application/pdf",
  };
  return new Blob(
    [
      Uint8Array.from(atob(file.base64), (character) =>
        character.charCodeAt(0),
      ),
    ],
    { type: types[extension] ?? "application/octet-stream" },
  );
}
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), downloadUrlLifetime);
}
function FileBody({
  blob,
  path,
  editing,
  editedText,
  onChange,
  disabled,
}: {
  readonly blob: Blob;
  readonly path: string;
  readonly editing: boolean;
  readonly editedText?: string;
  readonly onChange: (text: string) => void;
  readonly disabled: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [content, setContent] = useState<{ blob: Blob; text: string }>();
  const [failedBlob, setFailedBlob] = useState<Blob>();
  useEffect(() => {
    let active = true;
    if (editedText === undefined && textFile(path, blob.type))
      void blob
        .text()
        .then((text) => {
          if (active) setContent({ blob, text });
        })
        .catch(() => {
          if (active) setFailedBlob(blob);
        });
    return () => {
      active = false;
    };
  }, [blob, path, editedText]);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const url = URL.createObjectURL(blob);
    image.src = url;
    return () => {
      image.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  if (blob.type.startsWith("image/") && blob.type !== "image/svg+xml")
    return (
      <img
        ref={imageRef}
        alt={path}
        className="mx-auto max-h-[55dvh] max-w-full object-contain"
      />
    );
  if (!textFile(path, blob.type))
    return (
      <div className="grid min-h-52 place-content-center justify-items-center gap-3 text-muted">
        <FileOutlined className="text-3xl" />
        <span>{t("agent.skillWorkbench.downloadToView")}</span>
        <Button
          icon={<DownloadOutlined />}
          onClick={() => download(blob, path.split("/").at(-1)!)}
        >
          {t("agent.skillWorkbench.downloadFile")}
        </Button>
      </div>
    );
  if (failedBlob === blob)
    return (
      <Alert type="error" title={t("agent.skillWorkbench.fileReadError")} />
    );
  const bodyText =
    editedText ?? (content?.blob === blob ? content.text : undefined);
  if (bodyText === undefined) return <Skeleton active />;
  if (editing && bodyText.length <= maximumTextLength)
    return (
      <Input.TextArea
        aria-label={t("agent.skillWorkbench.fileContent", { name: path })}
        value={bodyText}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        maxLength={maximumTextLength}
        autoSize={{ minRows: 18, maxRows: 30 }}
        variant="borderless"
        className="!rounded-none !p-0 !font-mono !text-sm !leading-6"
      />
    );
  if (/\.md$/iu.test(path))
    return (
      <Streamdown mode="static" plugins={{ code }} className="agent-markdown">
        {skillMarkdownPreview(bodyText)}
      </Streamdown>
    );
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "text";
  const language =
    (
      {
        py: "python",
        js: "javascript",
        ts: "typescript",
        sh: "bash",
        yml: "yaml",
        txt: "text",
      } as Record<string, string>
    )[extension] ?? extension;
  const fence = "`".repeat(
    Math.max(
      minimumCodeFenceLength,
      ...(bodyText.match(/`+/gu) ?? []).map((value) => value.length + 1),
    ),
  );
  return (
    <Streamdown
      mode="static"
      plugins={{ code }}
      controls={false}
      className="agent-markdown [&_[data-streamdown='code-block']]:m-0 [&_[data-streamdown='code-block']]:rounded-none [&_[data-streamdown='code-block']]:border-0 [&_[data-streamdown='code-block']]:bg-transparent [&_[data-streamdown='code-block']]:p-0 [&_[data-streamdown='code-block-header']]:hidden [&_[data-streamdown='code-block-body']]:rounded-none [&_[data-streamdown='code-block-body']]:border-0 [&_[data-streamdown='code-block-body']]:bg-transparent [&_[data-streamdown='code-block-body']]:p-0 [&_pre]:m-0 [&_pre]:text-left"
    >{`${fence}${language}\n${bodyText}\n${fence}`}</Streamdown>
  );
}

type Editing = {
  readonly files: readonly SkillFileInput[];
  readonly removedPaths: readonly string[];
  readonly disabled: boolean;
  readonly onFilesChange: (
    files: SkillFileInput[],
    removedPaths: string[],
  ) => void;
};
export type SkillFileSelection = {
  readonly path: string;
  readonly onChange: (path: string) => void;
};

export function SkillContentBrowser({
  compact = false,
  value = "",
  onChange,
  id,
  resources,
  source,
  workspaceId,
  editing,
  selection,
}: {
  readonly compact?: boolean;
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  readonly id?: string;
  readonly resources: AgentHubSkillDetail["resources"];
  readonly source?: SkillFileSource;
  readonly workspaceId: string;
  readonly editing?: Editing;
  readonly selection?: SkillFileSelection;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [localSelection, setLocalSelection] = useState("SKILL.md");
  const requestedSelection = selection?.path ?? localSelection;
  const setSelected = selection?.onChange ?? setLocalSelection;
  const [contentMode, setContentMode] = useState("source");
  const [addOpen, setAddOpen] = useState(false);
  const [replacementPath, setReplacementPath] = useState<string>();
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryVisible, setDirectoryVisible] = useState(true);
  const [newPath, setNewPath] = useState("");
  const [newDirectory, setNewDirectory] = useState("assets");
  const [directoryChosen, setDirectoryChosen] = useState(false);
  const [addMode, setAddMode] = useState("upload");
  const [readingUpload, setReadingUpload] = useState(false);
  const [newText, setNewText] = useState("");
  const [uploadBase64, setUploadBase64] = useState<string>();
  const [error, setError] = useState<string>();
  const paths = [
    ...new Set([
      ...resources.map((file) => file.path),
      ...(editing?.files.map((file) => file.path) ?? []),
    ]),
  ].filter(
    (path) => !editing?.removedPaths.includes(path) && path !== "kanvas.yaml",
  );
  const tree = skillFileTree(paths);
  const selected =
    paths.includes(requestedSelection) || requestedSelection === "SKILL.md"
      ? requestedSelection
      : "SKILL.md";
  useEffect(() => {
    if (requestedSelection !== selected) setSelected(selected);
  }, [requestedSelection, selected, setSelected]);
  const file = editing?.files.find((item) => item.path === selected);
  const resource = resources.find((item) => item.path === selected);
  const loaded = useQuery({
    queryKey: ["skill-file", workspaceId, source, selected],
    queryFn: () => fetchSkillFile(workspaceId, source!, selected),
    // The source pins an immutable published revision or draft version.
    staleTime: Infinity,
    enabled: Boolean(source) && selected !== "SKILL.md" && !file,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const localBlob = useMemo(
    () => (file ? blobForInput(file) : undefined),
    [file],
  );
  const blob = localBlob ?? loaded.data;
  function updateFile(text: string): void {
    if (!editing) return;
    if (!file && editing.files.length >= maximumChangedFiles) {
      setError(t("agent.skillWorkbench.fileLimit"));
      return;
    }
    editing.onFilesChange(
      [
        ...editing.files.filter((item) => item.path !== selected),
        { path: selected, text },
      ],
      [...editing.removedPaths],
    );
  }
  function removeFile(): void {
    if (!editing) return;
    setError(undefined);
    editing.onFilesChange(
      editing.files.filter((item) => item.path !== selected),
      resource
        ? [...editing.removedPaths, selected]
        : [...editing.removedPaths],
    );
    setSelected("SKILL.md");
  }
  function openAdd(): void {
    setReplacementPath(undefined);
    setNewPath("");
    setNewDirectory(
      selected.includes("/")
        ? selected.slice(0, selected.lastIndexOf("/"))
        : "assets",
    );
    setDirectoryChosen(selected.includes("/"));
    setAddMode("upload");
    setNewText("");
    setUploadBase64(undefined);
    setError(undefined);
    setAddOpen(true);
  }
  function addFile(): void {
    if (!editing) return;
    const path = skillFileDestination(newDirectory, newPath);
    if (!validNewSkillPath(path)) {
      setError(t("agent.skillWorkbench.invalidPath"));
      return;
    }
    if (
      paths.some(
        (existing) =>
          (existing.toLowerCase() === path.toLowerCase() &&
            path !== replacementPath) ||
          existing.toLowerCase().startsWith(`${path.toLowerCase()}/`) ||
          path.toLowerCase().startsWith(`${existing.toLowerCase()}/`),
      )
    ) {
      setError(t("agent.skillWorkbench.duplicatePath"));
      return;
    }
    if (!uploadBase64 && !newText.length) {
      setError(t("agent.skillWorkbench.emptyFile"));
      return;
    }
    if (
      !editing.files.some((item) => item.path === path) &&
      editing.files.length >= maximumChangedFiles
    ) {
      setError(t("agent.skillWorkbench.fileLimit"));
      return;
    }
    editing.onFilesChange(
      [
        ...editing.files.filter((item) => item.path !== path),
        uploadBase64 ? { path, base64: uploadBase64 } : { path, text: newText },
      ],
      editing.removedPaths.filter((item) => item !== path),
    );
    setSelected(path);
    setAddOpen(false);
  }
  async function chooseUpload(
    file: File,
    path = replacementPath ?? file.name,
  ): Promise<void> {
    if (
      replacementPath &&
      blob?.type.startsWith("image/") &&
      file.type !== blob.type
    ) {
      setError(t("agent.skillWorkbench.replaceFileType"));
      return;
    }
    if (!file.size || file.size > maximumFileBytes) {
      setError(t("agent.skillWorkbench.fileSizeLimit"));
      return;
    }
    setReadingUpload(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      setUploadBase64(btoa(binary));
      setNewPath(path.split("/").at(-1)!);
      if (path.includes("/")) {
        setNewDirectory(path.slice(0, path.lastIndexOf("/")));
      } else if (!directoryChosen && !replacementPath) {
        setNewDirectory(
          textFile(file.name, file.type) ? "references" : "assets",
        );
      }
      setError(undefined);
    } catch {
      setError(t("agent.skillWorkbench.fileReadError"));
    } finally {
      setReadingUpload(false);
    }
  }
  function pasteImage(event: ReactClipboardEvent<HTMLDivElement>): void {
    if (!editing || editing.disabled) return;
    const image = Array.from(event.clipboardData.files).find((item) =>
      ["image/png", "image/jpeg", "image/webp"].includes(item.type),
    );
    if (!image) return;
    event.preventDefault();
    openAdd();
    void chooseUpload(image, `references/${image.name}`);
  }
  function openReplacement(): void {
    openAdd();
    setReplacementPath(selected);
    setNewPath(selected.split("/").at(-1)!);
    setNewDirectory(
      selected.includes("/")
        ? selected.slice(0, selected.lastIndexOf("/"))
        : "",
    );
  }
  function closeAdd(): void {
    setAddOpen(false);
    setError(undefined);
  }
  function selectAddMode(mode: string | number): void {
    const nextMode = String(mode);
    setAddMode(nextMode);
    if (!directoryChosen) {
      setNewDirectory(nextMode === "text" ? "references" : "assets");
    }
    setUploadBase64(undefined);
    setError(undefined);
  }
  function selectDirectory(value: string): void {
    setNewDirectory(value);
    setDirectoryChosen(true);
  }
  function retryRead(): void {
    void loaded.refetch();
  }
  let body: React.JSX.Element;
  if (selected === "SKILL.md") {
    body =
      editing && contentMode === "source" ? (
        <Input.TextArea
          aria-label={t("agent.skillWorkbench.fileContent", {
            name: "SKILL.md",
          })}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          disabled={editing.disabled}
          maxLength={maximumTextLength}
          autoSize={{ minRows: 16, maxRows: 36 }}
          variant="borderless"
          className="!rounded-none !bg-transparent !p-0 !font-mono !text-sm !leading-6"
        />
      ) : (
        <Streamdown mode="static" plugins={{ code }} className="agent-markdown">
          {skillMarkdownPreview(value)}
        </Streamdown>
      );
  } else if (blob) {
    body = (
      <FileBody
        key={`${selected}:${source?.kind === "draft" ? source.version : "published"}`}
        blob={blob}
        path={selected}
        editing={Boolean(editing) && contentMode === "source"}
        {...(file && "text" in file ? { editedText: file.text } : {})}
        disabled={editing?.disabled ?? false}
        onChange={updateFile}
      />
    );
  } else if (loaded.isError) {
    body = (
      <Alert
        type="error"
        showIcon
        title={t(
          loaded.error instanceof ApiProblem &&
            loaded.error.status === httpStatus.conflict
            ? "agent.skillWorkbench.fileConflict"
            : "agent.skillWorkbench.fileReadError",
        )}
        action={
          <Button size="small" onClick={retryRead}>
            {t("agent.editor.retry")}
          </Button>
        }
      />
    );
  } else body = <Skeleton active />;
  const directory = (inDrawer = false) => (
    <nav
      aria-label={t("agent.authoring.skillFiles")}
      className="flex h-full min-h-0 flex-col border-r border-line/60 bg-mist/35 px-2 py-2"
    >
      <div
        className={`flex h-9 shrink-0 items-center justify-between px-2 text-xs text-muted ${inDrawer && !editing ? "hidden" : ""}`}
      >
        {!inDrawer && <span>{t("agent.authoring.skillFiles")}</span>}
        {editing && (
          <Button
            type="text"
            size="small"
            disabled={editing.disabled}
            aria-label={t("agent.skillWorkbench.addFile")}
            icon={<PlusOutlined />}
            onClick={openAdd}
          />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Tree
          classNames={{
            root: "bg-transparent [&_.ant-tree-node-content-wrapper]:!flex [&_.ant-tree-node-content-wrapper]:min-w-0 [&_.ant-tree-node-content-wrapper]:items-center [&_.ant-tree-node-content-wrapper]:gap-1 [&_.ant-tree-node-content-wrapper]:!rounded-md [&_.ant-tree-node-content-wrapper]:!h-8 [&_.ant-tree-node-content-wrapper]:!py-0 [&_.ant-tree-indent-unit]:!w-4",
            item: "w-full !pb-0.5",
            itemIcon: "shrink-0",
            itemTitle: "min-w-0 truncate !text-[13px]",
            itemSwitcher: "shrink-0 self-center",
          }}
          showIcon
          key={paths.join("\n")}
          blockNode
          defaultExpandAll
          selectedKeys={[selected]}
          treeData={tree}
          onSelect={(keys, info) => {
            if (info.node.isLeaf && keys[0]) {
              setSelected(String(keys[0]));
              setDirectoryOpen(false);
            }
          }}
          icon={(props) => {
            if (!props.isLeaf) return <FolderOutlined />;
            if (/\.(png|jpe?g|webp|gif|svg)$/iu.test(String(props.eventKey)))
              return <FileImageOutlined />;
            return <FileTextOutlined />;
          }}
        />
      </div>
    </nav>
  );
  return (
    <div
      id={id}
      className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-paper"
      onPaste={pasteImage}
    >
      {!compact && directoryVisible && (
        <div className="hidden w-[240px] shrink-0 lg:block">{directory()}</div>
      )}
      {!compact && (
        <Drawer
          open={directoryOpen}
          onClose={() => setDirectoryOpen(false)}
          title={t("agent.authoring.skillFiles")}
          placement="left"
          size={288}
          styles={{ body: { padding: 0 } }}
        >
          {directoryOpen && directory(true)}
        </Drawer>
      )}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {
          <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line/60 px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {compact ? (
                <Select
                  aria-label={t("agent.authoring.skillFiles")}
                  className="min-w-0 w-full"
                  value={selected}
                  onChange={setSelected}
                  options={[...new Set(["SKILL.md", ...paths])].map((path) => ({
                    value: path,
                    label: path,
                  }))}
                />
              ) : (
                <>
                  <Button
                    className="!hidden lg:!inline-flex"
                    type="text"
                    size="small"
                    icon={
                      directoryVisible ? (
                        <MenuFoldOutlined />
                      ) : (
                        <MenuUnfoldOutlined />
                      )
                    }
                    aria-label={t(
                      directoryVisible
                        ? "agent.skillWorkbench.hideFiles"
                        : "agent.skillWorkbench.showFiles",
                    )}
                    aria-expanded={directoryVisible}
                    onClick={() => setDirectoryVisible(!directoryVisible)}
                  />
                  <Button
                    className="lg:!hidden"
                    type="text"
                    size="small"
                    icon={<MenuUnfoldOutlined />}
                    aria-label={t("agent.skillWorkbench.showFiles")}
                    onClick={() => setDirectoryOpen(true)}
                  />
                </>
              )}
              {!compact && (
                <span
                  className="truncate text-xs font-medium text-muted"
                  title={selected}
                >
                  {selected}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {editing &&
                (selected === "SKILL.md" ||
                  !blob?.type.startsWith("image/")) && (
                  <Segmented
                    size="small"
                    value={contentMode}
                    onChange={setContentMode}
                    options={[
                      {
                        value: "source",
                        label: t("agent.skillWorkbench.source"),
                      },
                      { value: "preview", label: t("agent.authoring.preview") },
                    ]}
                  />
                )}
              {selected !== "SKILL.md" && blob && (
                <Button
                  type="text"
                  size="small"
                  aria-label={t("agent.skillWorkbench.downloadFile")}
                  icon={<DownloadOutlined />}
                  onClick={() => download(blob, selected.split("/").at(-1)!)}
                />
              )}
              {editing && selected !== "SKILL.md" && (
                <Button
                  type="text"
                  size="small"
                  disabled={editing.disabled}
                  aria-label={t("agent.skillWorkbench.replaceFile")}
                  icon={<UploadOutlined />}
                  onClick={openReplacement}
                />
              )}
              {editing && selected !== "SKILL.md" && (
                <Popconfirm
                  title={t("agent.skillWorkbench.removeFileConfirm", {
                    name: selected,
                  })}
                  onConfirm={removeFile}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    disabled={editing.disabled}
                    aria-label={t("agent.skillWorkbench.removeFile")}
                    icon={<DeleteOutlined />}
                  />
                </Popconfirm>
              )}
            </div>
          </header>
        }
        <div className="min-h-0 min-w-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
          {/(^|\/)scripts\/|\.(?:py|js|mjs|cjs|ts|tsx|jsx|sh|bash|zsh|rb|php|pl|bat|cmd|ps1)$/iu.test(
            selected,
          ) && (
            <Alert
              className="mb-3"
              type="info"
              showIcon
              title={t("agent.skillImport.scriptFile")}
            />
          )}
          {error && !addOpen && (
            <Alert className="mb-3" type="error" title={error} />
          )}
          <div
            className={`w-full ${(!editing || contentMode === "preview") && /\.md$/iu.test(selected) ? "mx-auto max-w-[820px]" : ""}`}
          >
            {body}
          </div>
        </div>
      </section>
      <Modal
        open={addOpen}
        title={t(
          replacementPath
            ? "agent.skillWorkbench.replaceFile"
            : "agent.skillWorkbench.addFile",
        )}
        onCancel={closeAdd}
        width={560}
        closable={!readingUpload}
        mask={{ closable: !readingUpload }}
        keyboard={!readingUpload}
        onOk={addFile}
        confirmLoading={readingUpload}
        okButtonProps={{
          disabled:
            !newPath.trim() ||
            (addMode === "upload" ? !uploadBase64 : !newText.trim()) ||
            readingUpload,
        }}
        cancelButtonProps={{ disabled: readingUpload }}
        okText={t(
          replacementPath
            ? "agent.skillWorkbench.replaceFile"
            : "agent.skillWorkbench.addFile",
        )}
        cancelText={t("agent.cancel")}
      >
        <div className="grid gap-4 py-3">
          {!replacementPath && (
            <Segmented
              block
              value={addMode}
              disabled={readingUpload}
              options={[
                {
                  value: "upload",
                  label: t("agent.skillWorkbench.uploadFile"),
                  icon: <UploadOutlined />,
                },
                {
                  value: "text",
                  label: t("agent.skillWorkbench.createText"),
                  icon: <FileTextOutlined />,
                },
              ]}
              onChange={selectAddMode}
            />
          )}
          {error && <Alert type="error" showIcon title={error} />}
          {addMode === "upload" && (
            <Upload.Dragger
              showUploadList={false}
              disabled={readingUpload}
              beforeUpload={(file) => {
                void chooseUpload(file);
                return false;
              }}
            >
              <UploadOutlined className="mb-2 text-xl text-muted" />
              <p className="m-0 text-sm font-medium">
                {uploadBase64 ? newPath : t("agent.skillWorkbench.dropFile")}
              </p>
              <p className="mt-1 mb-0 text-xs text-muted">
                {uploadBase64
                  ? t("agent.skillWorkbench.changeUpload")
                  : t("agent.skillWorkbench.uploadLimit")}
              </p>
            </Upload.Dragger>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">
              {t("agent.skillWorkbench.fileName")}
              <Input
                disabled={Boolean(replacementPath) || readingUpload}
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                placeholder={
                  addMode === "text" ? "notes/guide.md" : "xxx/yyy.jpg"
                }
              />
            </label>
            <label className="grid gap-2 text-sm">
              {t("agent.skillWorkbench.saveLocation")}
              <AutoComplete
                aria-label={t("agent.skillWorkbench.saveLocation")}
                disabled={Boolean(replacementPath) || readingUpload}
                value={newDirectory}
                onChange={selectDirectory}
                placeholder={t("agent.skillWorkbench.rootFolder")}
                options={[
                  ...new Set([
                    "",
                    "references",
                    "assets",
                    "scripts",
                    ...paths
                      .filter((path) => path.includes("/"))
                      .map((path) => path.slice(0, path.lastIndexOf("/"))),
                  ]),
                ].map((value) => ({
                  value,
                  label: ["references", "assets", "scripts"].includes(value)
                    ? t(`agent.skillWorkbench.directory.${value}`)
                    : value || t("agent.skillWorkbench.rootFolder"),
                }))}
              />
            </label>
          </div>
          {newPath.trim() && (
            <p className="m-0 break-all text-xs text-muted">
              {t("agent.skillWorkbench.destination", {
                path: skillFileDestination(newDirectory, newPath),
              })}
            </p>
          )}
          {addMode === "text" && (
            <label className="grid gap-2 text-sm">
              {t("agent.skillWorkbench.newFileContent")}
              <Input.TextArea
                value={newText}
                onChange={(event) => setNewText(event.target.value)}
                placeholder={t("agent.skillWorkbench.contentPlaceholder")}
                maxLength={maximumTextLength}
                autoSize={{ minRows: 8, maxRows: 12 }}
                className="!font-mono !text-sm"
              />
            </label>
          )}
        </div>
      </Modal>
    </div>
  );
}
