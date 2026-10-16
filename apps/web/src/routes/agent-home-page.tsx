import type { AgentHubSkill, CurrentHumanContext } from "@kanvas/contracts/api";
import { getRouteApi, Navigate, useNavigate } from "@tanstack/react-router";
import { Alert } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell } from "../components/app-shell.js";
import { WorkspaceBoundary } from "../components/workspace-page.js";
import {
  AgentComposer,
  agentComposerHasFilePayload,
  agentComposerImageFiles,
} from "../features/agent/agent-composer.js";
import { composerDraftStorageKey } from "../features/agent/agent-composer-draft.js";
import {
  AgentHomeContent,
  AgentStarterTasks,
} from "../features/agent/agent-home-content.js";
import { useAgentComposerAttachments } from "../features/agent/use-agent-composer-attachments.js";

const homeRoute = getRouteApi("/w/$workspaceId");

export function AgentHomePage() {
  const { workspaceId } = homeRoute.useParams();
  const search = homeRoute.useSearch();
  // Preserve existing capability and Canvas deep links without executing on Home.
  if (Object.keys(search).length > 0)
    return (
      <Navigate
        to="/w/$workspaceId/agent"
        params={{ workspaceId }}
        search={search}
        replace
      />
    );
  return (
    <WorkspaceBoundary workspaceId={workspaceId}>
      {({ context, workspace }) => (
        <HomeContent
          key={`${context.human.principalId}:${workspace.id}`}
          context={context}
          workspace={workspace}
        />
      )}
    </WorkspaceBoundary>
  );
}

function HomeContent({
  context,
  workspace,
}: {
  readonly context: CurrentHumanContext;
  readonly workspace: CurrentHumanContext["workspaces"][number];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canStart = workspace.permissions.includes("agent.run");
  const [draftId] = useState(() => {
    const key = `kanvas:home-draft:${context.human.principalId}:${workspace.id}`;
    try {
      const current = sessionStorage.getItem(key);
      if (current && /^[0-9a-f-]{36}$/u.test(current)) return current;
      const id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
      return id;
    } catch {
      return crypto.randomUUID();
    }
  });
  const draftKey = composerDraftStorageKey(workspace.id, undefined, draftId);
  const [value, setValue] = useState(() => {
    try {
      return sessionStorage.getItem(draftKey) ?? "";
    } catch {
      return "";
    }
  });
  const [error, setError] = useState<string>();
  const [continuing, setContinuing] = useState(false);
  const attachments = useAgentComposerAttachments({
    workspaceId: workspace.id,
    csrfToken: context.csrfToken,
    draftKey,
    onError: () => setError("agent.attachmentError"),
  });
  function change(value: string) {
    setValue(value);
    setError(undefined);
    try {
      sessionStorage.setItem(draftKey, value);
    } catch {
      /* Keep the visible draft until the user continues. */
    }
  }
  async function continueDraft() {
    if (
      !canStart ||
      continuing ||
      attachments.busy ||
      attachments.hasError ||
      !value.trim()
    )
      return;
    setContinuing(true);
    setError(undefined);
    try {
      sessionStorage.setItem(draftKey, value);
      // Attachment storage is shared with the conversation's existing upload hook.
      if (
        attachments.attachments.length > 0 &&
        !sessionStorage.getItem(`${draftKey}:attachments`)
      )
        throw new Error("Draft attachments unavailable");
      await navigate({
        to: "/w/$workspaceId/agent",
        params: { workspaceId: workspace.id },
        search: { draftId },
      });
    } catch {
      setError("studio.home.continueError");
      setContinuing(false);
    }
  }
  function openAgent(agentDefinitionId: string) {
    void navigate({
      to: "/w/$workspaceId/agent",
      params: { workspaceId: workspace.id },
      search: { agentDefinitionId },
    });
  }
  function openSkill(skill: AgentHubSkill, initialPrompt?: string) {
    void navigate({
      to: "/w/$workspaceId/agent",
      params: { workspaceId: workspace.id },
      search: {
        skillRevisionId: skill.skillRevisionId,
        ...(initialPrompt ? { initialPrompt } : {}),
      },
    });
  }
  function dropImages(event: React.DragEvent<HTMLElement>) {
    if (!agentComposerHasFilePayload(event.dataTransfer)) return;
    event.preventDefault();
    attachments.addFiles(agentComposerImageFiles(event.dataTransfer.files));
  }
  function pasteImages(event: React.ClipboardEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    const files = agentComposerImageFiles(event.clipboardData.files);
    if (files.length) {
      event.preventDefault();
      attachments.addFiles(files);
    }
  }
  return (
    <AppShell
      context={context}
      workspace={workspace}
      pageTitle={t("studio.home.navigation")}
      fullBleed
      headerContent={
        <h1 id="app-shell-page-title" className="m-0 text-base font-semibold">
          {t("studio.home.navigation")}
        </h1>
      }
    >
      <div className="h-full overflow-y-auto bg-paper px-4 pb-12 pt-10 sm:px-8 sm:pt-16 lg:px-12">
        <div className="mx-auto w-full max-w-[1280px]">
          {canStart ? (
            <section
              aria-labelledby="home-start"
              className="mx-auto mb-12 w-full max-w-[880px] sm:mb-16"
              onDragOver={(event) => {
                if (agentComposerHasFilePayload(event.dataTransfer)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }
              }}
              onDrop={dropImages}
              onPaste={pasteImages}
            >
              <h2
                id="home-start"
                className="m-0 mb-7 text-center text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-[32px]"
              >
                {t("studio.home.agentWelcome")}
              </h2>
              <AgentComposer
                workspaceId={workspace.id}
                inputRef={inputRef}
                addAttachmentLabel={t("agent.addAttachment")}
                addFileLabel={t("agent.addFile")}
                ariaLabel={t("agent.composerLabel")}
                attachments={attachments.attachments}
                disabled={continuing}
                errorLabel={t("agent.attachmentError")}
                onChange={change}
                onFiles={attachments.addFiles}
                onRemoveAttachment={attachments.removeAttachment}
                onSend={() => void continueDraft()}
                placeholder={t("agent.composerPlaceholder")}
                removeAttachmentLabel={t("agent.removeAttachment")}
                sendBlocked={attachments.busy || attachments.hasError}
                sendLabel={t("studio.home.continueToConversation")}
                uploadingLabel={t("agent.attachmentUploading")}
                value={value}
              />
              {error ? (
                <Alert
                  className="mt-3"
                  type="error"
                  showIcon
                  title={t(error)}
                />
              ) : null}
              <AgentStarterTasks
                workspaceId={workspace.id}
                permissions={workspace.permissions}
                onSelect={openSkill}
              />
            </section>
          ) : (
            <Alert
              className="mb-8"
              type="info"
              title={t("studio.home.readOnlyNotice")}
            />
          )}
          <AgentHomeContent
            workspaceId={workspace.id}
            permissions={workspace.permissions}
            onSelectAgent={openAgent}
            onSelectSkill={openSkill}
          />
        </div>
      </div>
    </AppShell>
  );
}
