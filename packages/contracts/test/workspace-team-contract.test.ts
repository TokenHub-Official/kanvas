import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  acceptWorkspaceInvitationRoute,
  changeWorkspaceMembershipRoute,
  changeWorkspaceMembershipsRoute,
  ChangeWorkspaceMembershipsBodySchema,
  createWorkspaceInvitationRoute,
  getWorkspaceTeamRoute,
  InvitationSummarySchema,
  registerInvitationAccountRoute,
  resendWorkspaceInvitationRoute,
  resolveInvitationRoute,
  revokeWorkspaceInvitationRoute,
  routeRegistry,
  WorkspaceTeamQuerySchema,
  WorkspaceTeamSchema,
} from "../src/api/index.js";

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
  });
  const registerFormats = addFormats as unknown as (
    instance: Ajv2020,
  ) => unknown;
  registerFormats(ajv);
  return ajv;
}

describe("Workspace Team contracts", () => {
  it("registers the public resolution, verified acceptance, and authorized management surface", () => {
    expect(resolveInvitationRoute).toMatchObject({
      method: "POST",
      path: "/api/v1/invitation-resolutions",
      security: ["public"],
    });
    expect(acceptWorkspaceInvitationRoute).toMatchObject({
      method: "POST",
      path: "/api/v1/workspace-invitation-acceptances",
      security: ["browserSession"],
    });
    expect(registerInvitationAccountRoute).toMatchObject({
      method: "POST",
      path: "/api/v1/invitation-registrations",
      security: ["public"],
    });
    expect(routeRegistry).toContain(registerInvitationAccountRoute);
    for (const route of [
      getWorkspaceTeamRoute,
      createWorkspaceInvitationRoute,
      resendWorkspaceInvitationRoute,
      revokeWorkspaceInvitationRoute,
      changeWorkspaceMembershipRoute,
      changeWorkspaceMembershipsRoute,
    ]) {
      expect(route.security).toEqual(["sessionOrServiceToken"]);
      expect(routeRegistry).toContain(route);
    }
  });

  it("keeps the public summary bounded and masked", () => {
    const validate = createAjv().compile(InvitationSummarySchema);
    expect(
      validate({
        invitationId: "01K00000000000000000000001",
        state: "pending",
        organization: {
          id: "01K00000000000000000000002",
          name: "Kanvas",
        },
        workspace: {
          id: "01K00000000000000000000003",
          name: "Visual Lab",
        },
        workspaceRole: "editor",
        targetEmailMasked: "li***@example.com",
        identityStatus: "signed_out",
        expiresAt: "2026-08-01T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      validate({
        invitationId: "01K00000000000000000000001",
        state: "pending",
        organization: {
          id: "01K00000000000000000000002",
          name: "Kanvas",
        },
        workspace: {
          id: "01K00000000000000000000003",
          name: "Visual Lab",
        },
        workspaceRole: "editor",
        targetEmailMasked: "li***@example.com",
        identityStatus: "matched",
        expiresAt: "2026-08-01T00:00:00.000Z",
        invitationToken: `knv_invite_v1_${"a".repeat(43)}`,
      }),
    ).toBe(false);
  });

  it("projects members and pending invitations without raw auth subjects or tokens", () => {
    const validate = createAjv().compile(WorkspaceTeamSchema);
    expect(
      validate({
        members: [
          {
            membershipId: "01K00000000000000000000001",
            principalId: "01K00000000000000000000002",
            displayName: "Lin",
            verifiedEmail: "lin@example.com",
            role: "owner",
            status: "active",
            version: 2,
            isCurrentHuman: true,
            createdAt: "2026-07-29T00:00:00.000Z",
            updatedAt: "2026-07-29T00:00:00.000Z",
          },
        ],
        invitations: [
          {
            invitationId: "01K00000000000000000000003",
            targetEmail: "designer@example.com",
            workspaceRole: "editor",
            state: "pending",
            expiresAt: "2026-08-01T00:00:00.000Z",
            version: 1,
            invitedByPrincipalId: "01K00000000000000000000002",
            createdAt: "2026-07-29T00:00:00.000Z",
            updatedAt: "2026-07-29T00:00:00.000Z",
          },
        ],
      }),
    ).toBe(true);
  });

  it("requires bounded, kind-scoped cursors for independent team pages", () => {
    const validate = createAjv().compile(WorkspaceTeamQuerySchema);
    expect(
      validate({
        pageKind: "members",
        cursor: "opaque_member_cursor",
        limit: "100",
      }),
    ).toBe(true);
    expect(
      validate({
        pageKind: "invitations",
        cursor: "opaque_invitation_cursor",
        limit: "25",
      }),
    ).toBe(true);
    expect(
      validate({
        pageKind: "members",
        limit: "101",
      }),
    ).toBe(false);
  });

  it("bounds one atomic membership batch to 100 explicit versions", () => {
    const validate = createAjv().compile(ChangeWorkspaceMembershipsBodySchema);
    expect(
      validate({
        changes: [
          {
            targetPrincipalId: "01K00000000000000000000005",
            expectedVersion: 3,
            role: "editor",
            status: "suspended",
          },
        ],
      }),
    ).toBe(true);
    expect(validate({ changes: [] })).toBe(false);
    expect(
      validate({
        changes: Array.from({ length: 101 }, () => ({
          targetPrincipalId: "01K00000000000000000000005",
          expectedVersion: 3,
          role: "editor",
          status: "suspended",
        })),
      }),
    ).toBe(false);
  });
});
