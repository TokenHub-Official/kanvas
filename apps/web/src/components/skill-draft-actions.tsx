import {
  CheckCircleOutlined,
  DeleteOutlined,
  ExperimentOutlined,
} from "@ant-design/icons";
import type { SkillDraftDetail } from "@kanvas/contracts/api";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Alert, Button, Collapse, Drawer, Input, Modal, Tag } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  archiveSkillDraft,
  publishSkillCandidate,
  submitSkillCandidate,
} from "../api/transport.js";
import { skillErrorKey } from "./skill-error.js";
import { ActionLink } from "./action-link.js";
import { synchronizePublishedSkillCaches } from "../features/agent/skill-publication-cache.js";

export function SkillDraftActions({
  draft,
  workspaceId,
  csrfToken,
  canPublish,
  disabled,
}: {
  readonly draft: SkillDraftDetail;
  readonly workspaceId: string;
  readonly csrfToken: string;
  readonly canPublish: boolean;
  readonly disabled: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modal, modalContext] = Modal.useModal();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [request, setRequest] = useState(draft.exampleRequests[0] ?? "");
  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["skill-drafts", workspaceId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["skill-draft", workspaceId, draft.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["agent-hub-skills", workspaceId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["agent-hub-skill", workspaceId, draft.skillDefinitionId],
      }),
    ]);
  }
  async function prepare() {
    if (draft.candidateId && draft.candidateDigest) return draft;
    return submitSkillCandidate(
      { csrfToken, workspaceId },
      draft.id,
      { expectedDraftVersion: draft.draftVersion },
      `skill-candidate:${crypto.randomUUID()}`,
    );
  }
  async function publish(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const candidate = await prepare();
      if (!candidate.candidateId || !candidate.candidateDigest) {
        throw new Error("Skill candidate is missing");
      }
      const published = await publishSkillCandidate(
        { csrfToken, workspaceId },
        candidate.candidateId,
        candidate.candidateDigest,
        `skill-publish:${crypto.randomUUID()}`,
      );
      await synchronizePublishedSkillCaches({
        draftId: draft.id,
        published,
        queryClient,
        workspaceId,
      });
    } catch (error) {
      setError(t(skillErrorKey(error)));
    } finally {
      setPending(false);
    }
  }
  async function archive(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      await archiveSkillDraft(
        { csrfToken, workspaceId },
        draft.id,
        draft.draftVersion,
      );
      await refresh();
      await navigate({ to: "/w/$workspaceId/skills", params: { workspaceId } });
    } catch (error) {
      setError(t(skillErrorKey(error)));
    } finally {
      setPending(false);
    }
  }
  async function test(): Promise<void> {
    if (!request.trim()) return;
    setPending(true);
    setError(undefined);
    try {
      const candidate = await prepare();
      if (!candidate.candidateId || !candidate.candidateDigest) {
        throw new Error("Skill candidate is missing");
      }
      await refresh();
      await navigate({
        to: "/w/$workspaceId/agent",
        params: { workspaceId },
        search: {
          skillCandidateId: candidate.candidateId,
          skillCandidateDigest: candidate.candidateDigest,
          skillTestRequest: request.trim(),
          initialPrompt: request.trim(),
          returnTo: `/w/${workspaceId}/skills/drafts/${draft.id}/edit`,
        },
      });
    } catch (error) {
      setError(t(skillErrorKey(error)));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {modalContext}
      <Button
        type="primary"
        icon={<CheckCircleOutlined />}
        disabled={disabled}
        title={disabled ? t("agent.design.saveBeforePublish") : undefined}
        onClick={() => setOpen(true)}
      >
        {t("agent.editor.publication")}
      </Button>
      <Drawer
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title={t("agent.editor.publication")}
        closable={!pending}
        mask={{ closable: !pending }}
        keyboard={!pending}
        size={440}
        footer={
          !draft.publishedCurrent && canPublish ? (
            <div className="flex justify-end gap-2">
              <Button disabled={pending} onClick={() => setOpen(false)}>
                {t("agent.cancel")}
              </Button>
              <Button
                type="primary"
                loading={pending}
                disabled={disabled}
                onClick={() => void publish()}
              >
                {t("agent.hub.publishSkill")}
              </Button>
            </div>
          ) : null
        }
      >
        <div className="flex h-full flex-col gap-5">
          <h2 className="m-0 text-base font-semibold">{draft.displayName}</h2>
          {error && <Alert title={error} type="error" showIcon />}
          {draft.publishedCurrent && (
            <>
              <Tag className="w-fit" color="success">
                {t("agent.hub.skillStatus.published")}
              </Tag>
              <ActionLink
                to="/w/$workspaceId/skills/$skillDefinitionId"
                params={{
                  workspaceId,
                  skillDefinitionId: draft.skillDefinitionId,
                }}
              >
                {t("agent.skillWorkbench.viewPublished")}
              </ActionLink>
            </>
          )}
          {!draft.publishedCurrent &&
            draft.resources.some((file) =>
              /(^|\/)scripts\/|\.(?:py|js|mjs|cjs|ts|tsx|jsx|sh|bash|zsh|rb|php|pl|bat|cmd|ps1)$/iu.test(
                file.path,
              ),
            ) && (
              <Alert
                type="warning"
                showIcon
                title={t("agent.skillImport.scriptsRetained")}
              />
            )}
          {!draft.publishedCurrent && (
            <>
              <p className="m-0 text-sm leading-6 text-muted">
                {t("agent.skillWorkbench.checkBeforePublish")}
              </p>
              {!canPublish && (
                <p className="m-0 text-sm text-muted">
                  {t("agent.skillWorkbench.publishPermission")}
                </p>
              )}
              <Collapse
                ghost
                items={[
                  {
                    key: "test",
                    label: t("agent.skillWorkbench.testRequest"),
                    children: (
                      <div className="grid gap-3">
                        <Input.TextArea
                          aria-label={t("agent.skillWorkbench.testRequest")}
                          value={request}
                          onChange={(event) => setRequest(event.target.value)}
                          autoSize={{ minRows: 4, maxRows: 10 }}
                          maxLength={2000}
                          disabled={pending}
                        />
                        <Button
                          icon={<ExperimentOutlined />}
                          disabled={pending || !request.trim()}
                          onClick={() => void test()}
                        >
                          {t("agent.hub.startTest")}
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
            </>
          )}
          {draft.publishedSkillRevisionId && !draft.publishedCurrent && (
            <div className="mt-auto pt-8">
              <Button
                danger
                type="text"
                icon={<DeleteOutlined />}
                disabled={pending}
                onClick={() =>
                  void modal.confirm({
                    title: t("agent.hub.archiveSkillConfirm"),
                    okButtonProps: { danger: true },
                    onOk: archive,
                  })
                }
              >
                {t("agent.skillWorkbench.archiveDraft")}
              </Button>
            </div>
          )}
        </div>
      </Drawer>
    </>
  );
}
