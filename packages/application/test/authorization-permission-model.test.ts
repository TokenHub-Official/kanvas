import { describe, expect, it } from "vitest";

import {
  authorizationModelVersion,
  evaluateHumanWorkspaceAuthorization,
  evaluateServiceWorkspaceAuthorization,
  normalizeWorkspacePermissionSet,
  permissionIds,
  permissionsForOrganizationRole,
  permissionsForWorkspaceRole,
  servicePermissionAllowlist,
  serviceTokenPermissionsAreSubset,
  workspacePermissionIds,
} from "../src/modules/authorization/index.js";

const now = new Date("2026-07-28T12:00:00.000Z");
const workspaceA = "01K000000000000000000000001";
const workspaceB = "01K000000000000000000000002";

describe("fixed authorization model", () => {
  it("versions one complete, duplicate-free V0 permission vocabulary", () => {
    expect(authorizationModelVersion).toBe(1);
    expect(new Set(permissionIds).size).toBe(permissionIds.length);
    expect(permissionIds).toEqual(
      expect.arrayContaining([
        "workspace.read",
        "workspace.manage",
        "workspace.delete",
        "membership.manage",
        "canvas.read",
        "canvas.write",
        "asset.read",
        "asset.write",
        "artifact.download",
        "artifact.retain",
        "brand.read",
        "brand.manage",
        "agent.run",
        "workflow.read",
        "workflow.author",
        "workflow.publish",
        "workflow.run",
        "approval.decide",
        "capability.run",
        "capability.configure",
        "credential.manage",
        "credential.invoke",
        "usage.read",
        "audit.read",
      ]),
    );
    expect(
      normalizeWorkspacePermissionSet(["workflow.run", "asset.read"]),
    ).toEqual(["asset.read", "workflow.run"]);
    expect(
      normalizeWorkspacePermissionSet(["asset.read", "asset.read"]),
    ).toBeUndefined();
    expect(
      normalizeWorkspacePermissionSet(["permission.from.database"]),
    ).toBeUndefined();
  });

  it("keeps Organization roles separate from Workspace content roles", () => {
    expect(permissionsForOrganizationRole("admin")).toContain(
      "organization.workspace.create",
    );
    expect(permissionsForOrganizationRole("admin")).not.toContain(
      "workspace.read",
    );

    const orgAdminWithoutMembership = evaluateHumanWorkspaceAuthorization({
      principalStatus: "active",
      requestedWorkspaceId: workspaceB,
      workspaceId: workspaceA,
      workspaceStatus: "active",
      membershipStatus: "active",
      membershipRole: "admin",
      requiredPermission: "asset.read",
    });
    expect(orgAdminWithoutMembership).toEqual({
      decision: "deny",
      disclosure: "not_found",
      reason: "workspace_not_visible",
    });
  });

  it("implements the fixed Workspace role candidates without granting provider secret read", () => {
    expect(permissionsForWorkspaceRole("owner")).toEqual(
      workspacePermissionIds,
    );
    expect(permissionsForWorkspaceRole("admin")).not.toContain(
      "workspace.delete",
    );
    expect(permissionsForWorkspaceRole("editor")).toContain("workflow.run");
    expect(permissionsForWorkspaceRole("editor")).toContain("brand.read");
    expect(permissionsForWorkspaceRole("editor")).toContain("agent.run");
    expect(permissionsForWorkspaceRole("editor")).not.toContain("brand.manage");
    expect(permissionsForWorkspaceRole("editor")).not.toContain(
      "workflow.publish",
    );
    expect(permissionsForWorkspaceRole("reviewer")).toContain(
      "approval.decide",
    );
    expect(permissionsForWorkspaceRole("reviewer")).toContain("agent.run");
    expect(permissionsForWorkspaceRole("viewer")).not.toContain("asset.write");
    expect(permissionsForWorkspaceRole("viewer")).not.toContain("agent.run");
    expect(permissionsForWorkspaceRole("viewer")).toContain("brand.read");
    expect(servicePermissionAllowlist).not.toContain("brand.manage");
    expect(servicePermissionAllowlist).not.toContain("brand.read");
    expect(servicePermissionAllowlist).toContain("agent.run");
    expect(permissionIds).not.toContain("credential.secret.read");
  });

  it("fails Human authorization closed on IDOR, revocation, or a missing permission", () => {
    expect(
      evaluateHumanWorkspaceAuthorization({
        principalStatus: "active",
        requestedWorkspaceId: workspaceB,
        workspaceId: workspaceA,
        workspaceStatus: "active",
        membershipStatus: "active",
        membershipRole: "owner",
        requiredPermission: "asset.read",
      }),
    ).toMatchObject({
      decision: "deny",
      disclosure: "not_found",
    });
    expect(
      evaluateHumanWorkspaceAuthorization({
        principalStatus: "active",
        requestedWorkspaceId: workspaceA,
        workspaceId: workspaceA,
        workspaceStatus: "active",
        membershipStatus: "suspended",
        membershipRole: "editor",
        requiredPermission: "asset.read",
      }),
    ).toMatchObject({
      decision: "deny",
      reason: "membership_inactive",
    });
    expect(
      evaluateHumanWorkspaceAuthorization({
        principalStatus: "active",
        requestedWorkspaceId: workspaceA,
        workspaceId: workspaceA,
        workspaceStatus: "active",
        membershipStatus: "active",
        membershipRole: "viewer",
        requiredPermission: "asset.write",
      }),
    ).toMatchObject({
      decision: "deny",
      reason: "permission_missing",
    });
  });

  it("limits Service permissions to grant-token intersection and rejects Human-only actions", () => {
    expect(servicePermissionAllowlist).not.toEqual(
      expect.arrayContaining([
        "membership.manage",
        "workspace.delete",
        "approval.decide",
        "credential.manage",
      ]),
    );
    expect(
      serviceTokenPermissionsAreSubset(
        ["asset.read"],
        ["asset.read", "asset.write"],
      ),
    ).toBe(false);
    expect(
      evaluateServiceWorkspaceAuthorization({
        principalStatus: "active",
        requestedWorkspaceId: workspaceA,
        workspaceId: workspaceA,
        workspaceStatus: "active",
        grantStatus: "active",
        grantPermissions: ["asset.read"],
        tokenPermissions: ["asset.read", "asset.write"],
        tokenExpiresAt: new Date(now.getTime() + 1),
        tokenRevokedAt: null,
        now,
        requiredPermission: "asset.read",
      }),
    ).toMatchObject({
      decision: "allow",
      effectivePermissions: ["asset.read"],
    });
    expect(
      evaluateServiceWorkspaceAuthorization({
        principalStatus: "active",
        requestedWorkspaceId: workspaceA,
        workspaceId: workspaceA,
        workspaceStatus: "active",
        grantStatus: "active",
        grantPermissions: ["asset.read"],
        tokenPermissions: ["asset.read"],
        tokenExpiresAt: new Date(now.getTime() + 1),
        tokenRevokedAt: null,
        now,
        requiredPermission: "approval.decide",
      }),
    ).toEqual({
      decision: "deny",
      disclosure: "forbidden",
      reason: "service_action_disallowed",
    });
  });

  it("rejects a cross-Workspace, revoked, or exactly expired Service token immediately", () => {
    const base = {
      principalStatus: "active" as const,
      requestedWorkspaceId: workspaceA,
      workspaceId: workspaceA,
      workspaceStatus: "active" as const,
      grantStatus: "active" as const,
      grantPermissions: ["asset.read"] as const,
      tokenPermissions: ["asset.read"] as const,
      tokenExpiresAt: new Date(now.getTime() + 1),
      tokenRevokedAt: null,
      now,
      requiredPermission: "asset.read" as const,
    };

    expect(
      evaluateServiceWorkspaceAuthorization({
        ...base,
        requestedWorkspaceId: workspaceB,
      }),
    ).toMatchObject({
      decision: "deny",
      disclosure: "not_found",
    });
    expect(
      evaluateServiceWorkspaceAuthorization({
        ...base,
        tokenRevokedAt: now,
      }),
    ).toMatchObject({
      decision: "deny",
      reason: "service_token_revoked",
    });
    expect(
      evaluateServiceWorkspaceAuthorization({
        ...base,
        tokenExpiresAt: now,
      }),
    ).toMatchObject({
      decision: "deny",
      reason: "service_token_expired",
    });
  });
});
