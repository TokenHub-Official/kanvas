export const authorizationModelVersion = 1;

export const organizationPermissionIds = Object.freeze([
  "organization.read",
  "organization.manage",
  "organization.membership.manage",
  "organization.workspace.create",
  "organization.archive",
  "organization.owner.transfer",
] as const);

export const workspacePermissionIds = Object.freeze([
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
  "library.read",
  "library.manage",
  "brand.read",
  "brand.manage",
  "agent.read",
  "agent.run",
  "agent.manage",
  "agent.publish",
  "skill.read",
  "skill.use",
  "skill.manage",
  "skill.publish",
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
] as const);

export const permissionIds = Object.freeze([
  ...organizationPermissionIds,
  ...workspacePermissionIds,
] as const);

export type OrganizationPermissionId =
  (typeof organizationPermissionIds)[number];
export type WorkspacePermissionId = (typeof workspacePermissionIds)[number];
export type PermissionId = (typeof permissionIds)[number];

export type PrincipalStatus = "active" | "suspended" | "revoked";
export type OrganizationStatus =
  "active" | "suspended" | "archived" | "setup_required";
export type WorkspaceStatus =
  "active" | "suspended" | "archived" | "setup_required";
export type MembershipStatus = "active" | "suspended" | "revoked";
export type ServiceGrantStatus = "active" | "suspended" | "revoked";
export type OrganizationRole = "owner" | "admin" | "member";
export type WorkspaceRole =
  "owner" | "admin" | "editor" | "operator" | "reviewer" | "viewer";

const permissionIdSet = new Set<string>(permissionIds);
const workspacePermissionIdSet = new Set<string>(workspacePermissionIds);

const organizationRolePermissionMatrix = Object.freeze({
  owner: organizationPermissionIds,
  admin: Object.freeze([
    "organization.read",
    "organization.manage",
    "organization.membership.manage",
    "organization.workspace.create",
  ] as const),
  member: Object.freeze(["organization.read"] as const),
} satisfies Readonly<
  Record<OrganizationRole, readonly OrganizationPermissionId[]>
>);

const workspaceRolePermissionMatrix = Object.freeze({
  owner: workspacePermissionIds,
  admin: Object.freeze(
    workspacePermissionIds.filter(
      (permission) => permission !== "workspace.delete",
    ),
  ),
  editor: Object.freeze([
    "library.manage",
    "workspace.read",
    "canvas.read",
    "canvas.write",
    "asset.read",
    "asset.write",
    "artifact.download",
    "library.read",
    "brand.read",
    "agent.read",
    "agent.run",
    "agent.manage",
    "agent.publish",
    "skill.read",
    "skill.use",
    "skill.manage",
    "skill.publish",
    "workflow.read",
    "workflow.author",
    "workflow.run",
    "capability.run",
    "credential.invoke",
  ] as const),
  operator: Object.freeze([
    "workspace.read",
    "canvas.read",
    "canvas.write",
    "asset.read",
    "asset.write",
    "artifact.download",
    "library.read",
    "brand.read",
    "agent.read",
    "agent.run",
    "skill.read",
    "skill.use",
    "workflow.read",
    "workflow.run",
    "capability.run",
    "credential.invoke",
  ] as const),
  reviewer: Object.freeze([
    "workspace.read",
    "canvas.read",
    "asset.read",
    "artifact.download",
    "library.read",
    "brand.read",
    "agent.read",
    "agent.run",
    "skill.read",
    "skill.use",
    "workflow.read",
    "approval.decide",
  ] as const),
  viewer: Object.freeze([
    "workspace.read",
    "canvas.read",
    "asset.read",
    "artifact.download",
    "library.read",
    "brand.read",
    "workflow.read",
  ] as const),
} satisfies Readonly<Record<WorkspaceRole, readonly WorkspacePermissionId[]>>);

/**
 * Service principals are explicit automation identities. Governance,
 * membership, owner-only retention, human approval, and credential
 * administration stay outside their fixed action allowlist.
 */
export const servicePermissionAllowlist = Object.freeze([
  "library.read",
  "workspace.read",
  "canvas.read",
  "canvas.write",
  "asset.read",
  "asset.write",
  "artifact.download",
  "agent.read",
  "agent.run",
  "skill.read",
  "skill.use",
  "workflow.read",
  "workflow.author",
  "workflow.publish",
  "workflow.run",
  "capability.run",
  "capability.configure",
  "credential.invoke",
  "usage.read",
  "audit.read",
] as const satisfies readonly WorkspacePermissionId[]);

const servicePermissionAllowlistSet = new Set<WorkspacePermissionId>(
  servicePermissionAllowlist,
);

export type AuthorizationDenialReason =
  | "principal_inactive"
  | "workspace_not_visible"
  | "workspace_inactive"
  | "membership_inactive"
  | "permission_missing"
  | "service_grant_inactive"
  | "service_token_expired"
  | "service_token_revoked"
  | "service_action_disallowed";

export type AuthorizationDecision =
  | {
      readonly decision: "allow";
      readonly effectivePermissions: readonly WorkspacePermissionId[];
    }
  | {
      readonly decision: "deny";
      readonly disclosure: "not_found" | "forbidden";
      readonly reason: AuthorizationDenialReason;
    };

export interface HumanWorkspaceAuthorizationFacts {
  readonly principalStatus: PrincipalStatus;
  readonly requestedWorkspaceId: string;
  readonly workspaceId: string;
  readonly workspaceStatus: WorkspaceStatus;
  readonly membershipStatus: MembershipStatus;
  readonly membershipRole: WorkspaceRole;
  readonly requiredPermission: WorkspacePermissionId;
}

export interface ServiceWorkspaceAuthorizationFacts {
  readonly principalStatus: PrincipalStatus;
  readonly requestedWorkspaceId: string;
  readonly workspaceId: string;
  readonly workspaceStatus: WorkspaceStatus;
  readonly grantStatus: ServiceGrantStatus;
  readonly grantPermissions: readonly WorkspacePermissionId[];
  readonly tokenPermissions: readonly WorkspacePermissionId[];
  readonly tokenExpiresAt: Date;
  readonly tokenRevokedAt: Date | null;
  readonly now: Date;
  readonly requiredPermission: WorkspacePermissionId;
}

export interface TrustedWorkspaceScope {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly principalId: string;
  readonly principalType: "human" | "service";
  readonly authenticationRefType: "session" | "service_api_token";
  readonly authenticationRefId: string;
  readonly authorityType: "human_membership" | "service_grant";
  readonly authorityId: string;
  readonly authorityVersion: number;
  readonly authorizationModelVersion: typeof authorizationModelVersion;
  readonly effectivePermissions: readonly WorkspacePermissionId[];
  /**
   * This marker is materialized only by the database authorization store
   * after reading current membership or grant facts. HTTP request data must
   * never be cast directly to this type.
   */
  readonly trusted: true;
}

export interface TrustedInstanceAdministratorScope {
  readonly instanceId: string;
  readonly principalId: string;
  readonly principalType: "human";
  readonly authenticationRefType: "session";
  readonly authenticationRefId: string;
  readonly authorityType: "instance_administrator";
  readonly authorityId: string;
  readonly authorityVersion: number;
  readonly authorizationModelVersion: typeof authorizationModelVersion;
  /**
   * This marker is materialized only after the current Principal and active
   * Instance Administrator fact have been read from the database.
   */
  readonly trusted: true;
}

export type TrustedWorkspaceMembershipManagementScope =
  TrustedWorkspaceScope | TrustedInstanceAdministratorScope;

export function isPermissionId(value: unknown): value is PermissionId {
  return typeof value === "string" && permissionIdSet.has(value);
}

export function isWorkspacePermissionId(
  value: unknown,
): value is WorkspacePermissionId {
  return typeof value === "string" && workspacePermissionIdSet.has(value);
}

function comparePermission(
  left: WorkspacePermissionId,
  right: WorkspacePermissionId,
): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

export function normalizeWorkspacePermissionSet(
  value: unknown,
): readonly WorkspacePermissionId[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const permissions = new Set<WorkspacePermissionId>();
  for (const candidate of value) {
    if (!isWorkspacePermissionId(candidate) || permissions.has(candidate)) {
      return undefined;
    }
    permissions.add(candidate);
  }
  return Object.freeze([...permissions].sort(comparePermission));
}

export function permissionsForOrganizationRole(
  role: OrganizationRole,
): readonly OrganizationPermissionId[] {
  return organizationRolePermissionMatrix[role];
}

export function permissionsForWorkspaceRole(
  role: WorkspaceRole,
): readonly WorkspacePermissionId[] {
  return workspaceRolePermissionMatrix[role];
}

export function serviceTokenPermissionsAreSubset(
  grantPermissions: readonly WorkspacePermissionId[],
  tokenPermissions: readonly WorkspacePermissionId[],
): boolean {
  const grant = new Set(grantPermissions);
  return tokenPermissions.every(
    (permission) =>
      grant.has(permission) && servicePermissionAllowlistSet.has(permission),
  );
}

function effectiveServicePermissions(
  grantPermissions: readonly WorkspacePermissionId[],
  tokenPermissions: readonly WorkspacePermissionId[],
): readonly WorkspacePermissionId[] {
  const grant = new Set(grantPermissions);
  return Object.freeze(
    tokenPermissions
      .filter(
        (permission) =>
          grant.has(permission) &&
          servicePermissionAllowlistSet.has(permission),
      )
      .sort(comparePermission),
  );
}

export function evaluateHumanWorkspaceAuthorization(
  facts: HumanWorkspaceAuthorizationFacts,
): AuthorizationDecision {
  if (facts.requestedWorkspaceId !== facts.workspaceId) {
    return {
      decision: "deny",
      disclosure: "not_found",
      reason: "workspace_not_visible",
    };
  }
  if (facts.principalStatus !== "active") {
    return {
      decision: "deny",
      disclosure: "forbidden",
      reason: "principal_inactive",
    };
  }
  if (facts.membershipStatus !== "active") {
    return {
      decision: "deny",
      disclosure: "forbidden",
      reason: "membership_inactive",
    };
  }
  if (facts.workspaceStatus !== "active") {
    return {
      decision: "deny",
      disclosure: "forbidden",
      reason: "workspace_inactive",
    };
  }
  const effectivePermissions = permissionsForWorkspaceRole(
    facts.membershipRole,
  );
  if (!effectivePermissions.includes(facts.requiredPermission)) {
    return {
      decision: "deny",
      disclosure: "forbidden",
      reason: "permission_missing",
    };
  }
  return {
    decision: "allow",
    effectivePermissions,
  };
}

export function evaluateServiceWorkspaceAuthorization(
  facts: ServiceWorkspaceAuthorizationFacts,
): AuthorizationDecision {
  if (facts.requestedWorkspaceId !== facts.workspaceId) {
    return {
      decision: "deny",
      disclosure: "not_found",
      reason: "workspace_not_visible",
    };
  }
  if (!servicePermissionAllowlistSet.has(facts.requiredPermission)) {
    return {
      decision: "deny",
      disclosure: "forbidden",
      reason: "service_action_disallowed",
    };
  }
  if (facts.principalStatus !== "active") {
    return {
      decision: "deny",
      disclosure: "forbidden",
      reason: "principal_inactive",
    };
  }
  if (facts.grantStatus !== "active") {
    return {
      decision: "deny",
      disclosure: "forbidden",
      reason: "service_grant_inactive",
    };
  }
  if (facts.tokenRevokedAt !== null) {
    return {
      decision: "deny",
      disclosure: "forbidden",
      reason: "service_token_revoked",
    };
  }
  if (facts.tokenExpiresAt <= facts.now) {
    return {
      decision: "deny",
      disclosure: "forbidden",
      reason: "service_token_expired",
    };
  }
  if (facts.workspaceStatus !== "active") {
    return {
      decision: "deny",
      disclosure: "forbidden",
      reason: "workspace_inactive",
    };
  }
  const effectivePermissions = effectiveServicePermissions(
    facts.grantPermissions,
    facts.tokenPermissions,
  );
  if (!effectivePermissions.includes(facts.requiredPermission)) {
    return {
      decision: "deny",
      disclosure: "forbidden",
      reason: "permission_missing",
    };
  }
  return {
    decision: "allow",
    effectivePermissions,
  };
}
