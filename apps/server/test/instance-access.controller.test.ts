import type { TrustedInstanceAdministratorScope } from "@kanvas/application";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { InstanceAccessController } from "../src/http/instance-access.controller.js";
import { InstanceAdministratorContextStore } from "../src/http/instance-administrator-context.js";

const principalId = "01K00000000000000000000001";
const targetPrincipalId = "01K00000000000000000000002";
const workspaceId = "01K00000000000000000000003";
const sessionId = "01K00000000000000000000004";
const scope: TrustedInstanceAdministratorScope = {
  instanceId: "kanvas-test",
  principalId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: sessionId,
  authorityType: "instance_administrator",
  authorityId: principalId,
  authorityVersion: 1,
  authorizationModelVersion: 1,
  trusted: true,
};

function contextsFor(
  request: FastifyRequest,
): InstanceAdministratorContextStore {
  const contexts = new InstanceAdministratorContextStore();
  contexts.set(request, {
    authentication: {
      authSubjectId: "auth-subject",
      sessionId,
      authenticationStrength: "single_factor",
    },
    scope,
  });
  return contexts;
}

describe("InstanceAccessController", () => {
  it("projects the site Principal directory without auth subjects", async () => {
    const request = { id: "request-list" } as FastifyRequest;
    const listAccessOverview = vi.fn<
      ServerDatabaseRuntime["instanceAccess"]["listAccessOverview"]
    >(() =>
      Promise.resolve({
        principals: [
          {
            principalId: targetPrincipalId,
            displayName: "Member",
            email: "member@example.com",
            emailVerified: true,
            status: "active",
            version: 2,
            isInstanceAdministrator: false,
            memberships: [
              {
                membershipId: "01K00000000000000000000006",
                workspaceId,
                role: "editor",
                status: "active",
                version: 1,
              },
            ],
            registeredAt: new Date("2026-09-15T00:00:00.000Z"),
          },
        ],
        workspaces: [
          {
            organizationId: "01K00000000000000000000005",
            organizationName: "Kanvas",
            workspaceId,
            workspaceName: "Design",
          },
        ],
        invitations: [],
      }),
    );
    const controller = new InstanceAccessController(
      {
        instanceAccess: { listAccessOverview },
      } as unknown as ServerDatabaseRuntime,
      contextsFor(request),
    );

    await expect(controller.get(request)).resolves.toEqual({
      principals: [
        {
          principalId: targetPrincipalId,
          displayName: "Member",
          email: "member@example.com",
          emailVerified: true,
          status: "active",
          version: 2,
          isInstanceAdministrator: false,
          memberships: [
            {
              membershipId: "01K00000000000000000000006",
              workspaceId,
              role: "editor",
              status: "active",
              version: 1,
            },
          ],
          registeredAt: "2026-09-15T00:00:00.000Z",
        },
      ],
      workspaces: [
        {
          organizationId: "01K00000000000000000000005",
          organizationName: "Kanvas",
          workspaceId,
          workspaceName: "Design",
        },
      ],
      invitations: [],
    });
    expect(listAccessOverview).toHaveBeenCalledWith(scope);
  });

  it("grants the selected Workspace role with Instance authority", async () => {
    const request = { id: "request-grant" } as FastifyRequest;
    const grantWorkspaceAccess = vi.fn<
      ServerDatabaseRuntime["instanceAccess"]["grantWorkspaceAccess"]
    >(() =>
      Promise.resolve([
        {
          workspaceId,
          membershipId: "01K00000000000000000000006",
          role: "editor",
          status: "active",
          version: 1,
        },
      ]),
    );
    const controller = new InstanceAccessController(
      {
        instanceAccess: { grantWorkspaceAccess },
      } as unknown as ServerDatabaseRuntime,
      contextsFor(request),
    );

    await expect(
      controller.grant(
        request,
        { targetPrincipalId },
        { assignments: [{ workspaceId, role: "editor" }] },
      ),
    ).resolves.toEqual({
      memberships: [
        {
          workspaceId,
          membershipId: "01K00000000000000000000006",
          role: "editor",
          status: "active",
          version: 1,
        },
      ],
    });
    const grantInput = grantWorkspaceAccess.mock.calls[0]?.[0];
    expect(grantInput).toMatchObject({
      authority: scope,
      targetPrincipalId,
      assignments: [{ workspaceId, role: "editor" }],
    });
    expect(grantInput?.audit.requestId).toBe("request-grant");
  });

  it("changes a Workspace membership without adding the site administrator", async () => {
    const request = { id: "request-change-member" } as FastifyRequest;
    const changeWorkspaceMembership = vi.fn<
      ServerDatabaseRuntime["authorization"]["changeWorkspaceMembership"]
    >(() =>
      Promise.resolve({
        membershipId: "01K00000000000000000000006",
        role: "reviewer",
        status: "active",
        version: 3,
      }),
    );
    const controller = new InstanceAccessController(
      {
        authorization: { changeWorkspaceMembership },
      } as unknown as ServerDatabaseRuntime,
      contextsFor(request),
    );

    await expect(
      controller.changeMembership(
        request,
        { workspaceId, targetPrincipalId },
        { expectedVersion: 2, role: "reviewer", status: "active" },
      ),
    ).resolves.toEqual({
      membershipId: "01K00000000000000000000006",
      role: "reviewer",
      status: "active",
      version: 3,
    });
    expect(changeWorkspaceMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: scope,
        workspaceId,
        targetPrincipalId,
        expectedTargetVersion: 2,
      }),
    );
  });

  it("changes an ordinary site account status with CAS", async () => {
    const request = { id: "request-change-principal" } as FastifyRequest;
    const changePrincipalStatus = vi.fn<
      ServerDatabaseRuntime["instanceAccess"]["changePrincipalStatus"]
    >(() =>
      Promise.resolve({
        principalId: targetPrincipalId,
        status: "suspended",
        version: 4,
      }),
    );
    const controller = new InstanceAccessController(
      {
        instanceAccess: { changePrincipalStatus },
      } as unknown as ServerDatabaseRuntime,
      contextsFor(request),
    );

    await expect(
      controller.changePrincipalStatus(
        request,
        { targetPrincipalId },
        { expectedVersion: 3, status: "suspended" },
      ),
    ).resolves.toEqual({
      principalId: targetPrincipalId,
      status: "suspended",
      version: 4,
    });
    expect(changePrincipalStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: scope,
        targetPrincipalId,
        expectedVersion: 3,
        status: "suspended",
      }),
    );
  });

  it("creates and revokes an invitation with site administrator authority", async () => {
    const request = { id: "request-invitation" } as FastifyRequest;
    const invitationId = "01K00000000000000000000007";
    const createWorkspaceInvitation = vi.fn<
      ServerDatabaseRuntime["team"]["createWorkspaceInvitation"]
    >((options) =>
      Promise.resolve({
        invitationId,
        targetEmailMasked: "me****@example.com",
        workspaceRole: options.workspaceRole,
        expiresAt: options.expiresAt,
        version: 1,
      }),
    );
    const revokeWorkspaceInvitation = vi.fn<
      ServerDatabaseRuntime["team"]["revokeWorkspaceInvitation"]
    >(() =>
      Promise.resolve({
        invitationId,
        state: "revoked",
        version: 2,
        revokedAt: new Date("2026-09-16T12:00:00.000Z"),
      }),
    );
    const controller = new InstanceAccessController(
      {
        team: { createWorkspaceInvitation, revokeWorkspaceInvitation },
      } as unknown as ServerDatabaseRuntime,
      contextsFor(request),
    );

    const created = await controller.createInvitation(
      request,
      { workspaceId },
      {
        targetEmail: "member@example.com",
        workspaceRole: "editor",
        expiresInHours: 24,
      },
    );
    expect(created).toMatchObject({
      invitationId,
      targetEmailMasked: "me****@example.com",
      workspaceRole: "editor",
      version: 1,
    });
    expect(created.invitePath).toBe(`/invite/${created.invitationToken}`);
    expect(createWorkspaceInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: scope,
        workspaceId,
        targetEmail: "member@example.com",
        workspaceRole: "editor",
      }),
    );

    await expect(
      controller.revokeInvitation(
        request,
        { workspaceId, invitationId },
        { expectedVersion: 1 },
      ),
    ).resolves.toEqual({
      invitationId,
      state: "revoked",
      version: 2,
      revokedAt: "2026-09-16T12:00:00.000Z",
    });
    expect(revokeWorkspaceInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: scope,
        workspaceId,
        invitationId,
        expectedVersion: 1,
      }),
    );
  });
});
