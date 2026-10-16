import {
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  MailOutlined,
  MoreOutlined,
  ReloadOutlined,
  StopOutlined,
  UndoOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import type { WorkspaceTeam } from "@kanvas/contracts/api";
import { useMutation } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
  Button,
  Checkbox,
  Dropdown,
  Form,
  Radio,
  Segmented,
  Spin,
  type RadioChangeEvent,
  type TableColumnsType,
  type TableProps,
} from "antd";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import { useReducer, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiProblem,
  addWorkspaceMember,
  changeWorkspaceMembership,
  changeWorkspaceMemberships,
  createWorkspaceInvitation,
  resendWorkspaceInvitation,
  revokeWorkspaceInvitation,
} from "../api/transport.js";
import { httpStatus } from "../api/http-status.js";
import { EmptyState, InlineNotice } from "../components/feedback.js";
import { KanvasInput, KanvasSearchInput } from "../components/kanvas-input.js";
import { KanvasAvatar } from "../components/kanvas-avatar.js";
import {
  SettingsAlertDialog as AlertDialog,
  SettingsAlertDialogContent as AlertDialogContent,
  SettingsDialog as Dialog,
  SettingsDialogContent as DialogContent,
} from "../components/settings-overlay.js";
import { usePageQueryRecovery } from "../components/page-query-recovery.js";
import { SettingsDirectoryTable } from "../components/settings-directory-table.js";
import { StatusTag } from "../components/status-tag.js";
import {
  SettingsInlineSelect,
  SettingsValuePill,
} from "../components/settings-inline-select.js";
import {
  SettingsPageHeader,
  SettingsShell,
} from "../components/settings-shell.js";
import { useSettingsNotification } from "../components/settings-notification.js";
import { UnsavedChangesGuard } from "../components/unsaved-changes-guard.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { cn } from "../lib/cn.js";
import {
  initialPeopleInviteDraftState,
  reducePeopleInviteDraft,
  type PeopleWorkspaceRole,
} from "../features/people/people-invite-draft-state.js";
import { usePeopleDirectory } from "../features/people/use-people-directory.js";
import { i18n } from "../i18n/i18n.js";

const peopleRouteApi = getRouteApi("/w/$workspaceId/settings/people");

type TeamMember = WorkspaceTeam["members"][number];
type TeamInvitation = WorkspaceTeam["invitations"][number];
type WorkspaceRole = PeopleWorkspaceRole;
type TeamDirectoryRow =
  | {
      readonly key: string;
      readonly kind: "invitation";
      readonly invitation: TeamInvitation;
    }
  | {
      readonly key: string;
      readonly kind: "member";
      readonly member: TeamMember;
    };
type BatchMemberAction = "restore" | "suspend";
type PendingConfirmation =
  | {
      readonly kind: "suspend-member";
      readonly member: TeamMember;
    }
  | {
      readonly kind: "revoke-invitation";
      readonly invitation: TeamInvitation;
    }
  | {
      readonly kind: "restore-member";
      readonly member: TeamMember;
    };

const roleLabels: Record<WorkspaceRole, string> = {
  get owner() {
    return i18n.t("settings.people.roles.owner.label");
  },
  get admin() {
    return i18n.t("settings.people.roles.admin.label");
  },
  get editor() {
    return i18n.t("settings.people.roles.editor.label");
  },
  get operator() {
    return i18n.t("settings.people.roles.operator.label");
  },
  get reviewer() {
    return i18n.t("settings.people.roles.reviewer.label");
  },
  get viewer() {
    return i18n.t("settings.people.roles.viewer.label");
  },
};

const roleDescriptions: Record<WorkspaceRole, string> = {
  get owner() {
    return i18n.t("settings.people.roles.owner.description");
  },
  get admin() {
    return i18n.t("settings.people.roles.admin.description");
  },
  get editor() {
    return i18n.t("settings.people.roles.editor.description");
  },
  get operator() {
    return i18n.t("settings.people.roles.operator.description");
  },
  get reviewer() {
    return i18n.t("settings.people.roles.reviewer.description");
  },
  get viewer() {
    return i18n.t("settings.people.roles.viewer.description");
  },
};

const roles = [
  "owner",
  "admin",
  "editor",
  "operator",
  "reviewer",
  "viewer",
] as const;
const INVITATION_EXPIRY_HOURS = 168;
const MAX_BATCH_SELECTION = 100;
const PRINCIPAL_ID_DISPLAY_SUFFIX_LENGTH = 6;

const invitationRoleGroups = [
  {
    labelKey: "collaboration",
    roles: ["editor", "operator", "reviewer", "viewer"],
  },
  {
    labelKey: "management",
    roles: ["admin", "owner"],
  },
] as const satisfies readonly {
  readonly labelKey: "collaboration" | "management";
  readonly roles: readonly WorkspaceRole[];
}[];

function teamError(error: unknown): string {
  if (!(error instanceof ApiProblem)) {
    return i18n.t("settings.people.errors.generic");
  }
  if (error.status === httpStatus.conflict) {
    if (error.code === "workspace_team.last_owner") {
      return i18n.t("settings.people.errors.lastOwner");
    }
    return i18n.t("settings.people.errors.conflict");
  }
  if (error.status === httpStatus.forbidden) {
    return i18n.t("settings.people.errors.forbidden");
  }
  return error.message;
}

function initials(name: string): string {
  return name
    .split(/\s+/u)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function PeoplePage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = peopleRouteApi.useParams();
  return (
    <WorkspacePage
      pageTitle={t("settings.people.title")}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <SettingsShell active="people" workspace={workspace}>
          {workspace.permissions.includes("membership.manage") ? (
            <PeopleContent
              csrfToken={context.csrfToken}
              currentRole={workspace.membership.role}
              key={workspace.id}
              workspaceId={workspace.id}
            />
          ) : (
            <EmptyState title={t("settings.people.forbiddenTitle")}>
              {t("settings.people.forbiddenDescription")}
            </EmptyState>
          )}
        </SettingsShell>
      )}
    </WorkspacePage>
  );
}

function PeopleContent({
  csrfToken,
  currentRole,
  workspaceId,
}: {
  readonly csrfToken: string;
  readonly currentRole: WorkspaceRole;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { i18n: currentI18n, t } = useTranslation();
  const toast = useSettingsNotification();
  const [inviteDraft, updateInviteDraft] = useReducer(
    reducePeopleInviteDraft,
    initialPeopleInviteDraftState,
  );
  const {
    email: targetEmail,
    error: inviteError,
    open: inviteOpen,
    ownerRiskAcknowledged,
    role: targetRole,
    shareUrl,
  } = inviteDraft;
  const [memberMode, setMemberMode] = useState<"existing" | "invite">(
    "existing",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [batchAction, setBatchAction] = useState<BatchMemberAction>();
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [confirmation, setConfirmation] = useState<PendingConfirmation>();
  const apiContext = {
    csrfToken,
    workspaceId,
  };
  const {
    invitations,
    invitationsCursor,
    loadInvitations,
    loadMembers,
    members,
    membersCursor,
    refresh,
    team,
  } = usePeopleDirectory(workspaceId);
  const teamRecovery = usePageQueryRecovery(team.refetch);

  const addMember = useMutation({
    mutationFn: () =>
      addWorkspaceMember(apiContext, {
        email: targetEmail.trim().toLowerCase(),
        role: targetRole,
      }),
    onSuccess: async () => {
      updateInviteDraft({ type: "close" });
      toast.notify({
        title: t("settings.people.addExisting.succeeded"),
        tone: "positive",
      });
      await refresh();
    },
    onError: (error) => {
      updateInviteDraft({
        type: "validation_failed",
        error: t(
          error instanceof ApiProblem && error.status === httpStatus.conflict
            ? "settings.people.addExisting.alreadyMember"
            : "settings.people.addExisting.failed",
        ),
      });
    },
  });
  const createInvite = useMutation({
    mutationFn: () =>
      createWorkspaceInvitation(apiContext, {
        targetEmail: targetEmail.trim().toLowerCase(),
        workspaceRole: targetRole,
        expiresInHours: INVITATION_EXPIRY_HOURS,
      }),
    onSuccess: async (created) => {
      updateInviteDraft({
        type: "created",
        shareUrl: `${window.location.origin}${created.invitePath}`,
      });
      await refresh();
    },
    onError: (error) => {
      updateInviteDraft({ type: "request_failed", error: teamError(error) });
    },
  });

  const resendInvite = useMutation({
    mutationFn: (invitation: TeamInvitation) =>
      resendWorkspaceInvitation(apiContext, invitation.invitationId, {
        expectedVersion: invitation.version,
        expiresInHours: INVITATION_EXPIRY_HOURS,
      }),
    onSuccess: async (created) => {
      updateInviteDraft({
        type: "resent",
        shareUrl: `${window.location.origin}${created.invitePath}`,
      });
      toast.notify({
        title: t("settings.people.toast.resentTitle"),
        description: t("settings.people.toast.resentDescription"),
        tone: "positive",
      });
      await refresh();
    },
    onError: async (error) => {
      toast.notify({
        title: t("settings.people.toast.resendErrorTitle"),
        description: teamError(error),
        tone: "danger",
      });
      await refresh();
    },
  });

  const memberSubmissionPending = createInvite.isPending || addMember.isPending;
  function changeMemberMode(value: string | number): void {
    setMemberMode(value as "existing" | "invite");
    updateInviteDraft({ type: "email_changed", email: targetEmail });
  }
  const revokeInvite = useMutation({
    mutationFn: (invitation: TeamInvitation) =>
      revokeWorkspaceInvitation(apiContext, invitation.invitationId, {
        expectedVersion: invitation.version,
      }),
    onSuccess: async () => {
      toast.notify({
        title: t("settings.people.toast.revokedTitle"),
        description: t("settings.people.toast.revokedDescription"),
        tone: "positive",
      });
      await refresh();
    },
    onError: async (error) => {
      toast.notify({
        title: t("settings.people.toast.revokeErrorTitle"),
        description: teamError(error),
        tone: "danger",
      });
      await refresh();
    },
  });

  const changeMember = useMutation({
    mutationFn: (input: {
      readonly member: TeamMember;
      readonly role: WorkspaceRole;
      readonly status: TeamMember["status"];
    }) =>
      changeWorkspaceMembership(apiContext, input.member.principalId, {
        expectedVersion: input.member.version,
        role: input.role,
        status: input.status,
      }),
    onSuccess: async () => {
      toast.notify({
        title: t("settings.people.toast.memberUpdatedTitle"),
        tone: "positive",
      });
      await refresh();
    },
    onError: async (error) => {
      toast.notify({
        title: t("settings.people.toast.memberErrorTitle"),
        description: teamError(error),
        tone: "danger",
      });
      await refresh();
    },
  });

  const changeMembers = useMutation({
    mutationFn: (input: {
      readonly action: BatchMemberAction;
      readonly members: readonly TeamMember[];
    }) =>
      changeWorkspaceMemberships(apiContext, {
        changes: input.members.map((member) => ({
          targetPrincipalId: member.principalId,
          expectedVersion: member.version,
          role: member.role,
          status: input.action === "suspend" ? "suspended" : "active",
        })),
      }),
    onSuccess: async (result) => {
      toast.notify({
        title: t("settings.people.toast.batchUpdatedTitle"),
        description: t("settings.people.toast.batchUpdatedDescription", {
          count: result.members.length,
        }),
        tone: "positive",
      });
      setBatchAction(undefined);
      setSelectedMemberIds(new Set());
      await refresh();
    },
    onError: async (error) => {
      toast.notify({
        title: t("settings.people.toast.batchErrorTitle"),
        description: t("settings.people.toast.batchErrorDescription", {
          error: teamError(error),
        }),
        tone: "danger",
      });
      setBatchAction(undefined);
      await refresh();
    },
  });

  function submitInvite() {
    if (!targetEmail.trim()) {
      updateInviteDraft({
        type: "validation_failed",
        error: t("settings.people.invite.emailRequired"),
      });
      return;
    }
    if (memberSubmissionPending) return;
    if (memberMode === "existing") addMember.mutate();
    else createInvite.mutate();
  }

  async function copyShareUrl() {
    if (!shareUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.notify({
        title: t("settings.people.toast.copiedTitle"),
        description: t("settings.people.toast.copiedDescription"),
        tone: "positive",
      });
    } catch {
      toast.notify({
        title: t("settings.people.toast.copyErrorTitle"),
        description: t("settings.people.toast.copyErrorDescription"),
        tone: "danger",
      });
    }
  }

  function updateInviteDialogVisibility(open: boolean): void {
    if (!open && memberSubmissionPending) {
      return;
    }
    if (!open) {
      updateInviteDraft({ type: "close" });
      return;
    }
    updateInviteDraft({ type: "open" });
  }

  function openInviteDialog(): void {
    updateInviteDraft({ type: "open" });
  }

  function closeInviteDialog(): void {
    updateInviteDialogVisibility(false);
  }

  function updateTargetEmail(event: ChangeEvent<HTMLInputElement>): void {
    updateInviteDraft({ type: "email_changed", email: event.target.value });
  }

  function updateTargetRole(event: RadioChangeEvent): void {
    updateInviteDraft({
      type: "role_changed",
      role: event.target.value as WorkspaceRole,
    });
  }

  function updateOwnerRiskAcknowledgement(event: CheckboxChangeEvent): void {
    updateInviteDraft({
      type: "owner_risk_changed",
      acknowledged: event.target.checked,
    });
  }

  if (team.isPending) {
    return (
      <div className="mx-auto w-full max-w-[1100px]">
        <div className="flex min-h-65 items-center justify-center gap-2.5 text-xs text-muted">
          <Spin aria-hidden="true" size="small" />
          {t("settings.people.loading")}
        </div>
      </div>
    );
  }
  if (team.isError) {
    return (
      <EmptyState
        action={teamRecovery.retry}
        actionLabel={t("settings.people.reload")}
        actionPending={teamRecovery.pending}
        title={
          team.error instanceof ApiProblem &&
          team.error.status === httpStatus.forbidden
            ? t("settings.people.loadForbiddenTitle")
            : t("settings.people.loadErrorTitle")
        }
      >
        {t("settings.people.loadErrorDescription")}
      </EmptyState>
    );
  }

  const pendingInvitations = invitations.filter(
    (invitation) => invitation.state === "pending",
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const memberStatusLabel = (
    status: WorkspaceTeam["members"][number]["status"],
  ) => {
    if (status === "active") {
      return t("settings.people.status.active");
    }
    return status === "suspended"
      ? t("settings.people.status.suspended")
      : t("settings.people.status.revoked");
  };
  const visibleMembers = members.filter((member) => {
    if (!normalizedSearchQuery) {
      return true;
    }
    return [
      member.displayName,
      member.verifiedEmail,
      roleLabels[member.role],
      memberStatusLabel(member.status),
    ].some((value) => value?.toLowerCase().includes(normalizedSearchQuery));
  });
  const visibleInvitations = pendingInvitations.filter((invitation) => {
    if (!normalizedSearchQuery) {
      return true;
    }
    return [invitation.targetEmail, roleLabels[invitation.workspaceRole]].some(
      (value) => value.toLowerCase().includes(normalizedSearchQuery),
    );
  });
  const selectedMembers = members.filter((member) =>
    selectedMemberIds.has(member.membershipId),
  );
  const selectedActiveMembers = selectedMembers.filter(
    (member) => member.status === "active",
  );
  const selectedInactiveMembers = selectedMembers.filter(
    (member) => member.status !== "active",
  );
  let batchTargetMembers: ReadonlyArray<WorkspaceTeam["members"][number]> = [];
  if (batchAction === "suspend") {
    batchTargetMembers = selectedActiveMembers;
  } else if (batchAction === "restore") {
    batchTargetMembers = selectedInactiveMembers;
  }
  const availableRoles =
    currentRole === "owner" ? roles : roles.filter((role) => role !== "owner");
  const availableInvitationRoleGroups = invitationRoleGroups
    .map((group) => ({
      ...group,
      roles: group.roles.filter(
        (role) => currentRole === "owner" || role !== "owner",
      ),
    }))
    .filter((group) => group.roles.length > 0);
  const managementPending =
    changeMember.isPending ||
    changeMembers.isPending ||
    resendInvite.isPending ||
    revokeInvite.isPending;
  const inviteDraftDirty =
    !shareUrl && (targetEmail.trim().length > 0 || targetRole !== "editor");
  const noSearchResults =
    normalizedSearchQuery.length > 0 &&
    visibleMembers.length === 0 &&
    visibleInvitations.length === 0;

  const directoryRows: TeamDirectoryRow[] = [
    ...visibleMembers.map((member) => ({
      key: member.membershipId,
      kind: "member" as const,
      member,
    })),
    ...visibleInvitations.map((invitation) => ({
      invitation,
      key: `invitation:${invitation.invitationId}`,
      kind: "invitation" as const,
    })),
  ];
  const rowSelection: TableProps<TeamDirectoryRow>["rowSelection"] = {
    columnTitle: null,
    getCheckboxProps: (row) => {
      if (row.kind === "invitation") {
        return {
          "aria-label": t("settings.people.table.invitationNotSelectable", {
            email: row.invitation.targetEmail,
          }),
          disabled: true,
          name: row.invitation.targetEmail,
        };
      }
      const disabled =
        row.member.isCurrentHuman ||
        (currentRole !== "owner" && row.member.role === "owner") ||
        (!selectedMemberIds.has(row.member.membershipId) &&
          selectedMemberIds.size >= MAX_BATCH_SELECTION);
      return {
        "aria-label": t("settings.people.members.selectLabel", {
          name: row.member.displayName,
        }),
        disabled,
        name: row.member.displayName,
      };
    },
    getTitleCheckboxProps: () => ({
      "aria-label": t("settings.people.batch.selectCurrent"),
    }),
    onChange: (keys) => {
      setSelectedMemberIds(new Set(keys.map((key) => String(key))));
    },
    selectedRowKeys: [...selectedMemberIds],
  };
  const columns: TableColumnsType<TeamDirectoryRow> = [
    {
      key: "person",
      render: (_, row) => {
        if (row.kind === "invitation") {
          return (
            <div className="flex min-w-0 items-center gap-3">
              <KanvasAvatar
                icon={<MailOutlined aria-hidden="true" />}
                shape="square"
                tone="brand"
              />
              <div className="min-w-0">
                <strong className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="truncate">{row.invitation.targetEmail}</span>
                  <StatusTag className="shrink-0" tone="warning">
                    {t("settings.people.table.invitationType")}
                  </StatusTag>
                </strong>
                <span className="mt-0.5 block text-xs text-muted">
                  {t("settings.people.table.awaitingAcceptance")}
                </span>
              </div>
            </div>
          );
        }
        return (
          <div className="flex min-w-0 items-center gap-3">
            <KanvasAvatar shape="square">
              <strong className="text-xs">
                {initials(row.member.displayName)}
              </strong>
            </KanvasAvatar>
            <div className="min-w-0">
              <strong className="block truncate text-xs">
                {row.member.displayName}
                {row.member.isCurrentHuman ? (
                  <small className="ml-2 rounded-full bg-primary-soft px-1.5 py-0.5 text-xs text-primary">
                    {t("settings.people.members.you")}
                  </small>
                ) : null}
              </strong>
              <span className="mt-0.5 block truncate text-xs text-muted">
                {row.member.verifiedEmail ??
                  t("settings.people.members.fallbackName", {
                    id: row.member.principalId.slice(
                      -PRINCIPAL_ID_DISPLAY_SUFFIX_LENGTH,
                    ),
                  })}
              </span>
            </div>
          </div>
        );
      },
      title: t("settings.people.table.person"),
      width: 390,
    },
    {
      key: "role",
      render: (_, row) => {
        if (row.kind === "invitation") {
          return (
            <SettingsValuePill>
              {roleLabels[row.invitation.workspaceRole]}
            </SettingsValuePill>
          );
        }
        const member = row.member;
        const canChangeRole =
          !member.isCurrentHuman &&
          member.status === "active" &&
          (currentRole === "owner" || member.role !== "owner");
        if (!canChangeRole) {
          return (
            <SettingsValuePill>{roleLabels[member.role]}</SettingsValuePill>
          );
        }
        return (
          <SettingsInlineSelect<WorkspaceRole>
            confirmation={{
              cancelText: t("settings.people.invite.cancel"),
              okText: t("settings.people.confirm.changeRoleAction"),
              title: (role) =>
                t("settings.people.confirm.changeRoleTitle", {
                  name: member.displayName,
                  role: roleLabels[role],
                }),
            }}
            disabled={managementPending}
            label={t("settings.people.table.changeRoleLabel", {
              name: member.displayName,
            })}
            onSelect={(role) => {
              changeMember.mutate({
                member,
                role,
                status: member.status,
              });
            }}
            options={availableRoles.map((role) => ({
              disabled: member.role === role,
              label: roleLabels[role],
              value: role,
            }))}
            value={member.role}
          />
        );
      },
      title: t("settings.people.table.role"),
      width: 170,
    },
    {
      key: "status",
      render: (_, row) => {
        if (row.kind === "invitation") {
          return (
            <span className="text-xs text-muted">
              {t("settings.people.invitations.expiresAt", {
                date: new Intl.DateTimeFormat(currentI18n.resolvedLanguage, {
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  month: "short",
                }).format(new Date(row.invitation.expiresAt)),
              })}
            </span>
          );
        }
        return (
          <StatusTag
            tone={row.member.status === "active" ? "positive" : "neutral"}
          >
            {memberStatusLabel(row.member.status)}
          </StatusTag>
        );
      },
      title: t("settings.people.table.status"),
      width: 190,
    },
    {
      align: "right",
      key: "actions",
      render: (_, row) => {
        if (row.kind === "invitation") {
          const invitation = row.invitation;
          return (
            <Dropdown
              menu={{
                items: [
                  {
                    disabled:
                      managementPending ||
                      (currentRole !== "owner" &&
                        invitation.workspaceRole === "owner"),
                    icon: <ReloadOutlined aria-hidden="true" />,
                    key: "resend",
                    label: t("settings.people.invitations.resend"),
                  },
                  { type: "divider" },
                  {
                    danger: true,
                    disabled: managementPending,
                    icon: <CloseOutlined aria-hidden="true" />,
                    key: "revoke",
                    label: t("settings.people.invitations.revoke"),
                  },
                ],
                onClick: ({ key }) => {
                  if (key === "resend") {
                    resendInvite.mutate(invitation);
                    return;
                  }
                  setConfirmation({
                    invitation,
                    kind: "revoke-invitation",
                  });
                },
              }}
              placement="bottomRight"
              trigger={["click"]}
            >
              <Button
                aria-label={t("settings.people.invitations.manage")}
                icon={<MoreOutlined aria-hidden="true" />}
                size="small"
                type="text"
              />
            </Dropdown>
          );
        }
        const member = row.member;
        const canManage =
          !member.isCurrentHuman &&
          (currentRole === "owner" || member.role !== "owner");
        if (!canManage) {
          return null;
        }
        return member.status === "active" ? (
          <Button
            danger
            disabled={managementPending}
            icon={<StopOutlined aria-hidden="true" />}
            onClick={() => {
              setConfirmation({
                kind: "suspend-member",
                member,
              });
            }}
            size="small"
            type="text"
          >
            {t("settings.people.members.suspend")}
          </Button>
        ) : (
          <Button
            disabled={managementPending}
            icon={<UndoOutlined aria-hidden="true" />}
            onClick={() => {
              setConfirmation({
                kind: "restore-member",
                member,
              });
            }}
            size="small"
            type="text"
          >
            {t("settings.people.members.restore")}
          </Button>
        );
      },
      title: t("settings.people.table.actions"),
      width: 150,
    },
  ];
  const modalConfirmation = confirmation;
  let confirmationActionLabel = t("settings.people.confirm.revokeAction");
  let confirmationTitle = t("settings.people.confirm.revokeTitle");
  let confirmationDescription = t("settings.people.confirm.revokeDescription");
  if (modalConfirmation?.kind === "suspend-member") {
    confirmationActionLabel = t("settings.people.confirm.suspendAction");
    confirmationTitle = t("settings.people.confirm.suspendTitle", {
      name: modalConfirmation.member.displayName,
    });
    confirmationDescription = t("settings.people.confirm.suspendDescription");
  } else if (modalConfirmation?.kind === "restore-member") {
    confirmationActionLabel = t("settings.people.confirm.restoreAction");
    confirmationTitle = t("settings.people.confirm.restoreTitle", {
      name: modalConfirmation.member.displayName,
    });
    confirmationDescription = t("settings.people.confirm.restoreDescription", {
      role: roleLabels[modalConfirmation.member.role],
    });
  }

  return (
    <div className="w-full">
      <UnsavedChangesGuard
        active={inviteDraftDirty}
        title={t("settings.people.leaveTitle")}
      >
        {t("settings.people.leaveDescription")}
      </UnsavedChangesGuard>
      <SettingsPageHeader
        action={
          <Button
            className="w-full sm:w-auto"
            disabled={memberSubmissionPending || managementPending}
            icon={<UserAddOutlined aria-hidden="true" />}
            onClick={openInviteDialog}
            type="primary"
          >
            {t("settings.people.addExisting.action")}
          </Button>
        }
        title={t("settings.people.title")}
      />

      <Dialog onOpenChange={updateInviteDialogVisibility} open={inviteOpen}>
        <SettingsDirectoryTable<TeamDirectoryRow>
          bulkToolbar={
            selectedMembers.length > 0 ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <strong className="text-xs">
                    {t("settings.people.batch.selected", {
                      count: selectedMembers.length,
                    })}
                  </strong>
                  {selectedMembers.length >= MAX_BATCH_SELECTION ? (
                    <span className="ml-2 text-xs text-muted">
                      {t("settings.people.batch.limitReached")}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    danger
                    disabled={selectedActiveMembers.length === 0}
                    icon={<StopOutlined aria-hidden="true" />}
                    onClick={() => setBatchAction("suspend")}
                    size="small"
                  >
                    {t("settings.people.batch.suspendSelected", {
                      count: selectedActiveMembers.length,
                    })}
                  </Button>
                  <Button
                    disabled={selectedInactiveMembers.length === 0}
                    icon={<UndoOutlined aria-hidden="true" />}
                    onClick={() => setBatchAction("restore")}
                    size="small"
                  >
                    {t("settings.people.batch.restoreSelected", {
                      count: selectedInactiveMembers.length,
                    })}
                  </Button>
                  <Button
                    onClick={() => setSelectedMemberIds(new Set())}
                    size="small"
                    type="text"
                  >
                    {t("settings.people.batch.clear")}
                  </Button>
                </div>
              </div>
            ) : undefined
          }
          columns={columns}
          dataSource={directoryRows}
          emptyText={
            noSearchResults
              ? t("settings.people.noSearchResults")
              : t("settings.people.table.empty")
          }
          footer={
            loadMembers.isError ||
            loadInvitations.isError ||
            membersCursor ||
            invitationsCursor ? (
              <div className="grid gap-3">
                {loadMembers.isError ? (
                  <InlineNotice
                    title={t("settings.people.members.loadMoreErrorTitle")}
                    tone="danger"
                  >
                    {t("settings.people.loadMoreErrorDescription")}
                  </InlineNotice>
                ) : null}
                {loadInvitations.isError ? (
                  <InlineNotice
                    title={t("settings.people.invitations.loadMoreErrorTitle")}
                    tone="danger"
                  >
                    {t("settings.people.loadMoreErrorDescription")}
                  </InlineNotice>
                ) : null}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {membersCursor ? (
                    <Button
                      loading={loadMembers.isPending}
                      onClick={() => loadMembers.mutate()}
                      size="small"
                      type="text"
                    >
                      {t("settings.people.members.loadMore")}
                    </Button>
                  ) : null}
                  {invitationsCursor ? (
                    <Button
                      loading={loadInvitations.isPending}
                      onClick={() => loadInvitations.mutate()}
                      size="small"
                      type="text"
                    >
                      {t("settings.people.invitations.loadMore")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : undefined
          }
          rowSelection={rowSelection}
          toolbar={
            <div className="w-full max-w-110">
              <KanvasSearchInput
                allowClear
                aria-label={t("settings.people.searchLabel")}
                autoComplete="off"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t("settings.people.searchPlaceholder")}
                size="large"
                value={searchQuery}
              />
              {normalizedSearchQuery && (membersCursor || invitationsCursor) ? (
                <p className="mt-1.5 text-xs text-muted">
                  {t("settings.people.searchPartial")}
                </p>
              ) : null}
            </div>
          }
        />

        <DialogContent
          closeLabel={t("common.dialog.close")}
          description={
            shareUrl
              ? t("settings.people.invite.shareDescription")
              : t(
                  memberMode === "existing"
                    ? "settings.people.addExisting.description"
                    : "settings.people.invite.description",
                )
          }
          dismissible={!memberSubmissionPending}
          title={
            shareUrl
              ? t("settings.people.invite.shareTitle")
              : t("settings.people.addExisting.action")
          }
        >
          {shareUrl ? (
            <div className="pb-1 pt-2 text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-[16px] bg-positive-surface text-positive">
                <CheckOutlined aria-hidden="true" className="text-lg" />
              </span>
              <h3 className="mt-4 text-lg font-semibold">
                {t("settings.people.invite.created")}
              </h3>
              <p className="mt-1.5 text-xs text-muted">
                {t("settings.people.invite.sharePrivately")}
              </p>
              <div className="mt-5 flex items-center gap-2 rounded-[12px] bg-mist p-2 text-left">
                <code className="min-w-0 flex-1 truncate pl-1 text-xs text-ink">
                  {shareUrl}
                </code>
                <Button
                  aria-label={t("settings.people.invite.copy")}
                  icon={<CopyOutlined aria-hidden="true" />}
                  onClick={() => {
                    void copyShareUrl();
                  }}
                />
              </div>
              <Button
                className="!mt-6 !w-full"
                onClick={closeInviteDialog}
                type="primary"
              >
                {t("settings.people.invite.done")}
              </Button>
            </div>
          ) : (
            <Form layout="vertical" onFinish={submitInvite}>
              <Segmented
                block
                className="mb-5"
                aria-label={t("settings.people.addExisting.method")}
                disabled={memberSubmissionPending}
                options={[
                  {
                    label: t("settings.people.addExisting.existing"),
                    value: "existing",
                  },
                  {
                    label: t("settings.people.addExisting.invite"),
                    value: "invite",
                  },
                ]}
                value={memberMode}
                onChange={changeMemberMode}
              />
              <Form.Item
                help={inviteError}
                htmlFor="targetEmail"
                label={t("settings.people.invite.email")}
                validateStatus={inviteError ? "error" : ""}
              >
                <KanvasInput
                  autoCapitalize="none"
                  autoComplete="email"
                  disabled={memberSubmissionPending}
                  id="targetEmail"
                  onChange={updateTargetEmail}
                  placeholder={t(
                    "settings.people.addExisting.emailPlaceholder",
                  )}
                  size="large"
                  spellCheck={false}
                  type="email"
                  value={targetEmail}
                />
              </Form.Item>
              <Form.Item
                className="!mb-0"
                label={t("settings.people.invite.role")}
              >
                <Radio.Group
                  aria-label={t("settings.people.invite.role")}
                  className="grid w-full gap-4"
                  disabled={memberSubmissionPending}
                  onChange={updateTargetRole}
                  value={targetRole}
                >
                  {availableInvitationRoleGroups.map((group) => (
                    <section key={group.labelKey}>
                      <h4 className="mb-1.5 text-xs font-semibold text-muted">
                        {t("settings.people.invite.groups." + group.labelKey)}
                      </h4>
                      <div className="grid gap-1.5">
                        {group.roles.map((role) => (
                          <div
                            className={cn(
                              "min-h-15 rounded-[12px] bg-mist/65 px-3 py-2.5 transition-colors hover:bg-paper-hover",
                              targetRole === role && "bg-primary-soft",
                            )}
                            key={role}
                          >
                            <Radio
                              className="m-0 flex w-full items-start"
                              value={role}
                            >
                              <span className="ml-1 block text-left">
                                <strong className="block text-xs">
                                  {roleLabels[role]}
                                </strong>
                                <small className="mt-0.5 block text-xs leading-5 text-muted">
                                  {roleDescriptions[role]}
                                </small>
                              </span>
                            </Radio>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </Radio.Group>
              </Form.Item>
              {targetRole === "owner" ? (
                <InlineNotice
                  className="mt-5"
                  title={t("settings.people.invite.ownerWarningTitle")}
                >
                  <p>{t("settings.people.invite.ownerWarningDescription")}</p>
                  <Checkbox
                    checked={ownerRiskAcknowledged}
                    className="!mt-3 !font-semibold"
                    disabled={memberSubmissionPending}
                    onChange={updateOwnerRiskAcknowledgement}
                  >
                    {t("settings.people.invite.ownerAcknowledge")}
                  </Checkbox>
                </InlineNotice>
              ) : null}
              <div className="mt-6 flex justify-end gap-2">
                <Button
                  disabled={memberSubmissionPending}
                  onClick={closeInviteDialog}
                >
                  {t("settings.people.invite.cancel")}
                </Button>
                <Button
                  disabled={targetRole === "owner" && !ownerRiskAcknowledged}
                  htmlType="submit"
                  loading={memberSubmissionPending}
                  type="primary"
                >
                  {t(
                    memberMode === "existing"
                      ? "settings.people.addExisting.submit"
                      : "settings.people.invite.submit",
                  )}
                </Button>
              </div>
            </Form>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && modalConfirmation) {
            setConfirmation(undefined);
          }
        }}
        open={Boolean(modalConfirmation)}
      >
        {modalConfirmation ? (
          <AlertDialogContent
            actionLabel={confirmationActionLabel}
            actionVariant={
              modalConfirmation.kind === "restore-member" ? "primary" : "danger"
            }
            cancelLabel={t("settings.people.invite.cancel")}
            onAction={() => {
              if (modalConfirmation.kind === "suspend-member") {
                changeMember.mutate({
                  member: modalConfirmation.member,
                  role: modalConfirmation.member.role,
                  status: "suspended",
                });
              } else if (modalConfirmation.kind === "restore-member") {
                changeMember.mutate({
                  member: modalConfirmation.member,
                  role: modalConfirmation.member.role,
                  status: "active",
                });
              } else {
                revokeInvite.mutate(modalConfirmation.invitation);
              }
            }}
            title={confirmationTitle}
          >
            {confirmationDescription}
          </AlertDialogContent>
        ) : null}
      </AlertDialog>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setBatchAction(undefined);
          }
        }}
        open={Boolean(batchAction)}
      >
        {batchAction ? (
          <AlertDialogContent
            actionLabel={
              batchAction === "suspend"
                ? t("settings.people.batch.confirmSuspend")
                : t("settings.people.batch.confirmRestore")
            }
            actionVariant={batchAction === "suspend" ? "danger" : "primary"}
            cancelLabel={t("settings.people.invite.cancel")}
            onAction={() => {
              changeMembers.mutate({
                action: batchAction,
                members: batchTargetMembers,
              });
            }}
            title={
              batchAction === "suspend"
                ? t("settings.people.batch.suspendTitle", {
                    count: batchTargetMembers.length,
                  })
                : t("settings.people.batch.restoreTitle", {
                    count: batchTargetMembers.length,
                  })
            }
          >
            {batchAction === "suspend"
              ? t("settings.people.batch.suspendDescription")
              : t("settings.people.batch.restoreDescription")}
            {t("settings.people.batch.atomicDescription")}
          </AlertDialogContent>
        ) : null}
      </AlertDialog>
    </div>
  );
}
