import type { WorkspaceTeam } from "@kanvas/contracts/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { fetchWorkspaceTeam } from "../../api/transport.js";
import { workspaceQueryKeys } from "../../api/query-keys.js";

type TeamMember = WorkspaceTeam["members"][number];
type TeamInvitation = WorkspaceTeam["invitations"][number];

const TEAM_PAGE_SIZE = "100";

function mergeTeamItems<TItem, TKey extends string>(
  current: readonly TItem[],
  additional: readonly TItem[],
  keyFor: (item: TItem) => TKey,
): TItem[] {
  const merged = new Map<TKey, TItem>();
  for (const item of [...current, ...additional]) {
    merged.set(keyFor(item), item);
  }
  return [...merged.values()];
}

interface PeoplePaginationState {
  readonly additionalInvitations: TeamInvitation[];
  readonly additionalMembers: TeamMember[];
  readonly invitationsCursor: string | null;
  readonly membersCursor: string | null;
  readonly source: WorkspaceTeam | undefined;
}

export function usePeopleDirectory(workspaceId: string) {
  const queryClient = useQueryClient();
  const queryKey = workspaceQueryKeys.team(workspaceId);
  const team = useQuery({
    queryKey,
    queryFn: () => fetchWorkspaceTeam(workspaceId),
    retry: false,
  });
  const [paginationState, setPaginationState] = useState<PeoplePaginationState>(
    () => ({
      additionalInvitations: [],
      additionalMembers: [],
      invitationsCursor: null,
      membersCursor: null,
      source: undefined,
    }),
  );
  const activePagination =
    paginationState.source === team.data
      ? paginationState
      : {
          additionalInvitations: [],
          additionalMembers: [],
          invitationsCursor: team.data?.invitationsNextCursor ?? null,
          membersCursor: team.data?.membersNextCursor ?? null,
          source: team.data,
        };

  function updatePagination(
    update: (current: PeoplePaginationState) => PeoplePaginationState,
  ): void {
    setPaginationState((current) =>
      update(current.source === team.data ? current : activePagination),
    );
  }

  const loadMembers = useMutation({
    mutationFn: async () => {
      if (!activePagination.membersCursor) {
        throw new Error("No member page is available.");
      }
      return fetchWorkspaceTeam(workspaceId, {
        pageKind: "members",
        cursor: activePagination.membersCursor,
        limit: TEAM_PAGE_SIZE,
      });
    },
    onSuccess: (page) => {
      updatePagination((current) => ({
        ...current,
        additionalMembers: mergeTeamItems(
          current.additionalMembers,
          page.members,
          (member) => member.membershipId,
        ),
        membersCursor: page.membersNextCursor ?? null,
      }));
    },
  });

  const loadInvitations = useMutation({
    mutationFn: async () => {
      if (!activePagination.invitationsCursor) {
        throw new Error("No invitation page is available.");
      }
      return fetchWorkspaceTeam(workspaceId, {
        pageKind: "invitations",
        cursor: activePagination.invitationsCursor,
        limit: TEAM_PAGE_SIZE,
      });
    },
    onSuccess: (page) => {
      updatePagination((current) => ({
        ...current,
        additionalInvitations: mergeTeamItems(
          current.additionalInvitations,
          page.invitations,
          (invitation) => invitation.invitationId,
        ),
        invitationsCursor: page.invitationsNextCursor ?? null,
      }));
    },
  });

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey });
  }

  return {
    invitations: team.data
      ? mergeTeamItems(
          team.data.invitations,
          activePagination.additionalInvitations,
          (invitation) => invitation.invitationId,
        )
      : [],
    invitationsCursor: activePagination.invitationsCursor,
    loadInvitations,
    loadMembers,
    members: team.data
      ? mergeTeamItems(
          team.data.members,
          activePagination.additionalMembers,
          (member) => member.membershipId,
        )
      : [],
    membersCursor: activePagination.membersCursor,
    refresh,
    team,
  };
}
