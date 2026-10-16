import { VisualIdentitySymbolSchema } from "./visual-identity.js";
import { Type, type Static } from "@sinclair/typebox";

import {
  EditorDocumentV1Schema,
  EditorDraftContentV1Schema,
} from "../editor/index.js";
import {
  IsoDateTimeSchema,
  ProcessRoleSchema,
  type ProcessRole,
  UlidSchema,
} from "../primitives/index.js";
import {
  ValidateWorkflowTopologyResultSchema,
  WorkflowJsonValueSchema,
  WorkflowTopologySchema,
  WorkflowTopologyV1Schema,
} from "../workflow/index.js";
import { LocalizedTextV1Schema } from "../capability/localized-text.js";

export const HealthStatusSchema = Type.Union([
  Type.Literal("ok"),
  Type.Literal("starting"),
  Type.Literal("not_ready"),
]);

export const HealthResponseSchema = Type.Object(
  {
    status: HealthStatusSchema,
    serviceVersion: Type.String(),
    processRole: ProcessRoleSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.health-response.v1",
  },
);

export interface HealthResponse {
  readonly status: Static<typeof HealthStatusSchema>;
  readonly serviceVersion: string;
  readonly processRole: ProcessRole;
}

export const BrowserExecutionRequirementSchema = Type.Object(
  {
    requiredCapabilityKeys: Type.Array(
      Type.String({ minLength: 1, maxLength: 160 }),
      { maxItems: 500 },
    ),
  },
  { additionalProperties: false },
);
export type BrowserExecutionRequirement = Static<
  typeof BrowserExecutionRequirementSchema
>;

export const ProblemDetailsSchema = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    code: Type.String(),
    requestId: Type.Optional(Type.String()),
    detail: Type.Optional(Type.String()),
  },
  {
    additionalProperties: false,
    $id: "kanvas.problem-details.v1",
  },
);

export const BrowserSessionContextSchema = Type.Object(
  {
    authenticated: Type.Literal(true),
    csrfToken: Type.String({
      pattern: "^[A-Za-z0-9_-]{43}$",
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.browser-session-context.v1",
  },
);

export type BrowserSessionContext = Static<typeof BrowserSessionContextSchema>;

const Sha256DigestSchema = Type.String({
  pattern: "^sha256:[0-9a-f]{64}$",
});

const WorkspacePermissionIdSchema = Type.Union([
  Type.Literal("workspace.read"),
  Type.Literal("workspace.manage"),
  Type.Literal("workspace.delete"),
  Type.Literal("membership.manage"),
  Type.Literal("canvas.read"),
  Type.Literal("canvas.write"),
  Type.Literal("asset.read"),
  Type.Literal("asset.write"),
  Type.Literal("artifact.download"),
  Type.Literal("artifact.retain"),
  Type.Literal("library.read"),
  Type.Literal("library.manage"),
  Type.Literal("brand.read"),
  Type.Literal("brand.manage"),
  Type.Literal("agent.read"),
  Type.Literal("agent.run"),
  Type.Literal("agent.manage"),
  Type.Literal("agent.publish"),
  Type.Literal("skill.read"),
  Type.Literal("skill.use"),
  Type.Literal("skill.manage"),
  Type.Literal("skill.publish"),
  Type.Literal("workflow.read"),
  Type.Literal("workflow.author"),
  Type.Literal("workflow.publish"),
  Type.Literal("workflow.run"),
  Type.Literal("approval.decide"),
  Type.Literal("capability.run"),
  Type.Literal("capability.configure"),
  Type.Literal("credential.manage"),
  Type.Literal("credential.invoke"),
  Type.Literal("usage.read"),
  Type.Literal("audit.read"),
]);

export const DefaultAccessPolicySchema = Type.Object(
  {
    enabled: Type.Boolean(),
    workspaceId: Type.Union([UlidSchema, Type.Null()]),
    role: Type.Union([
      Type.Literal("viewer"),
      Type.Literal("operator"),
      Type.Literal("editor"),
    ]),
    oidcProviderIds: Type.Array(
      Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }),
      { maxItems: 20, uniqueItems: true },
    ),
    verifiedDomains: Type.Array(Type.String({ minLength: 3, maxLength: 253 }), {
      maxItems: 20,
      uniqueItems: true,
    }),
    version: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false, $id: "kanvas.default-access-policy.v1" },
);
export type DefaultAccessPolicy = Static<typeof DefaultAccessPolicySchema>;
export const UpdateDefaultAccessPolicyBodySchema = Type.Object(
  {
    ...Type.Omit(DefaultAccessPolicySchema, ["version"]).properties,
    expectedVersion: Type.Integer({ minimum: 0 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.update-default-access-policy-body.v1",
  },
);
export type UpdateDefaultAccessPolicyBody = Static<
  typeof UpdateDefaultAccessPolicyBodySchema
>;
export const DefaultAccessStatusSchema = Type.Object(
  {
    state: Type.Union([
      Type.Literal("pending"),
      Type.Literal("granted"),
      Type.Literal("excluded"),
      Type.Literal("failed"),
    ]),
    reason: Type.Union([
      Type.Literal("awaiting_verification"),
      Type.Literal("workspace_unavailable"),
      Type.Literal("temporary_failure"),
      Type.Literal("assigned"),
      Type.Literal("not_eligible"),
    ]),
  },
  { additionalProperties: false, $id: "kanvas.default-access-status.v1" },
);
export type DefaultAccessStatus = Static<typeof DefaultAccessStatusSchema>;
export const DefaultAccessPreviewSchema = Type.Object(
  {
    policy: DefaultAccessPolicySchema,
    candidates: Type.Array(
      Type.Object(
        {
          principalId: UlidSchema,
          displayName: Type.String(),
          email: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
    failures: Type.Array(
      Type.Object(
        {
          principalId: UlidSchema,
          displayName: Type.String(),
          email: Type.String(),
          workspaceName: Type.Union([Type.String(), Type.Null()]),
          reason: DefaultAccessStatusSchema.properties.reason,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false, $id: "kanvas.default-access-preview.v1" },
);
export type DefaultAccessPreview = Static<typeof DefaultAccessPreviewSchema>;
export const ApplyDefaultAccessBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1 }),
    principalIds: Type.Array(UlidSchema, {
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false, $id: "kanvas.apply-default-access-body.v1" },
);
export type ApplyDefaultAccessBody = Static<
  typeof ApplyDefaultAccessBodySchema
>;
export const AppliedDefaultAccessSchema = Type.Object(
  {
    results: Type.Array(
      Type.Object(
        { principalId: UlidSchema, ...DefaultAccessStatusSchema.properties },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false, $id: "kanvas.applied-default-access.v1" },
);
export type AppliedDefaultAccess = Static<typeof AppliedDefaultAccessSchema>;

export const CurrentHumanContextSchema = Type.Object(
  {
    defaultAccess: Type.Optional(DefaultAccessStatusSchema),
    authenticated: Type.Literal(true),
    csrfToken: Type.String({
      pattern: "^[A-Za-z0-9_-]{43}$",
    }),
    human: Type.Object(
      {
        principalId: UlidSchema,
        status: Type.Union([
          Type.Literal("active"),
          Type.Literal("suspended"),
          Type.Literal("revoked"),
        ]),
        displayName: Type.String({
          minLength: 1,
          maxLength: 160,
        }),
        verifiedEmail: Type.Optional(
          Type.String({
            minLength: 3,
            maxLength: 320,
          }),
        ),
      },
      {
        additionalProperties: false,
      },
    ),
    instanceAdministrator: Type.Optional(
      Type.Object(
        {
          version: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    workspaces: Type.Array(
      Type.Object(
        {
          id: UlidSchema,
          slug: Type.String({
            minLength: 1,
            maxLength: 80,
          }),
          name: Type.String({
            minLength: 1,
            maxLength: 160,
          }),
          organization: Type.Object(
            {
              id: UlidSchema,
              name: Type.String({
                minLength: 1,
                maxLength: 160,
              }),
            },
            {
              additionalProperties: false,
            },
          ),
          membership: Type.Object(
            {
              id: UlidSchema,
              role: Type.Union([
                Type.Literal("owner"),
                Type.Literal("admin"),
                Type.Literal("editor"),
                Type.Literal("operator"),
                Type.Literal("reviewer"),
                Type.Literal("viewer"),
              ]),
              version: Type.Integer({
                minimum: 1,
              }),
            },
            {
              additionalProperties: false,
            },
          ),
          permissions: Type.Array(WorkspacePermissionIdSchema, {
            uniqueItems: true,
            maxItems: 32,
          }),
        },
        {
          additionalProperties: false,
        },
      ),
      {
        maxItems: 256,
      },
    ),
    authorizationModelVersion: Type.Integer({
      minimum: 1,
    }),
    contextVersion: Sha256DigestSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.current-human-context.v1",
  },
);

export type CurrentHumanContext = Static<typeof CurrentHumanContextSchema>;

const WorkspaceRoleSchema = Type.Union([
  Type.Literal("owner"),
  Type.Literal("admin"),
  Type.Literal("editor"),
  Type.Literal("operator"),
  Type.Literal("reviewer"),
  Type.Literal("viewer"),
]);

const MembershipStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("suspended"),
  Type.Literal("revoked"),
]);

const InvitationStateSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("accepted"),
  Type.Literal("revoked"),
  Type.Literal("expired"),
]);

const InvitationTokenSchema = Type.String({
  pattern: "^knv_invite_v1_[A-Za-z0-9_-]{43}$",
});

const MaskedEmailSchema = Type.String({
  minLength: 3,
  maxLength: 320,
});

const EmailAddressSchema = Type.String({
  minLength: 3,
  maxLength: 320,
  pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
});

export const ResolveInvitationBodySchema = Type.Object(
  {
    invitationToken: InvitationTokenSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.resolve-invitation-body.v1",
  },
);

export type ResolveInvitationBody = Static<typeof ResolveInvitationBodySchema>;

export const InvitationIdentityStatusSchema = Type.Union(
  [
    Type.Literal("signed_out"),
    Type.Literal("matched"),
    Type.Literal("mismatched"),
    Type.Literal("unverified"),
  ],
  {
    $id: "kanvas.invitation-identity-status.v1",
  },
);

export type InvitationIdentityStatus = Static<
  typeof InvitationIdentityStatusSchema
>;

export const InvitationSummarySchema = Type.Object(
  {
    invitationId: UlidSchema,
    state: InvitationStateSchema,
    organization: Type.Object(
      {
        id: UlidSchema,
        name: Type.String({ minLength: 1, maxLength: 160 }),
      },
      { additionalProperties: false },
    ),
    workspace: Type.Object(
      {
        id: UlidSchema,
        name: Type.String({ minLength: 1, maxLength: 160 }),
      },
      { additionalProperties: false },
    ),
    workspaceRole: WorkspaceRoleSchema,
    targetEmailMasked: MaskedEmailSchema,
    identityStatus: InvitationIdentityStatusSchema,
    expiresAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.invitation-summary.v1",
  },
);

export type InvitationSummary = Static<typeof InvitationSummarySchema>;

export const RegisterInvitationAccountBodySchema = Type.Object(
  {
    invitationToken: InvitationTokenSchema,
    email: Type.String({
      minLength: 3,
      maxLength: 320,
      pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
    }),
    displayName: Type.String({
      minLength: 1,
      maxLength: 160,
    }),
    password: Type.String({
      minLength: 8,
      maxLength: 128,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.register-invitation-account-body.v1",
  },
);

export type RegisterInvitationAccountBody = Static<
  typeof RegisterInvitationAccountBodySchema
>;

export const InvitationAccountRegisteredSchema = Type.Object(
  {
    targetEmailMasked: MaskedEmailSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.invitation-account-registered.v1",
  },
);

export type InvitationAccountRegistered = Static<
  typeof InvitationAccountRegisteredSchema
>;

export const CreateWorkspaceInvitationBodySchema = Type.Object(
  {
    targetEmail: Type.String({
      minLength: 3,
      maxLength: 320,
      pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
    }),
    workspaceRole: WorkspaceRoleSchema,
    expiresInHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 720 })),
  },
  {
    additionalProperties: false,
    $id: "kanvas.create-workspace-invitation-body.v1",
  },
);

export type CreateWorkspaceInvitationBody = Static<
  typeof CreateWorkspaceInvitationBodySchema
>;

export const WorkspaceInvitationCreatedSchema = Type.Object(
  {
    invitationId: UlidSchema,
    invitationToken: InvitationTokenSchema,
    invitePath: Type.String({
      pattern: "^/invite/knv_invite_v1_[A-Za-z0-9_-]{43}$",
    }),
    targetEmailMasked: MaskedEmailSchema,
    workspaceRole: WorkspaceRoleSchema,
    expiresAt: IsoDateTimeSchema,
    version: Type.Integer({ minimum: 1 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-invitation-created.v1",
  },
);

export type WorkspaceInvitationCreated = Static<
  typeof WorkspaceInvitationCreatedSchema
>;

export const InvitationPathSchema = Type.Object(
  {
    invitationId: UlidSchema,
  },
  { additionalProperties: false },
);

export const ResendWorkspaceInvitationBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    expiresInHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 720 })),
  },
  {
    additionalProperties: false,
    $id: "kanvas.resend-workspace-invitation-body.v1",
  },
);

export type ResendWorkspaceInvitationBody = Static<
  typeof ResendWorkspaceInvitationBodySchema
>;

export const RevokeWorkspaceInvitationBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.revoke-workspace-invitation-body.v1",
  },
);

export type RevokeWorkspaceInvitationBody = Static<
  typeof RevokeWorkspaceInvitationBodySchema
>;

export const WorkspaceInvitationRevokedSchema = Type.Object(
  {
    invitationId: UlidSchema,
    state: Type.Literal("revoked"),
    version: Type.Integer({ minimum: 1 }),
    revokedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-invitation-revoked.v1",
  },
);

export type WorkspaceInvitationRevoked = Static<
  typeof WorkspaceInvitationRevokedSchema
>;

export const AcceptWorkspaceInvitationBodySchema = Type.Object(
  {
    invitationToken: InvitationTokenSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.accept-workspace-invitation-body.v1",
  },
);

export type AcceptWorkspaceInvitationBody = Static<
  typeof AcceptWorkspaceInvitationBodySchema
>;

export const WorkspaceInvitationAcceptedSchema = Type.Object(
  {
    invitationId: UlidSchema,
    organizationId: UlidSchema,
    workspaceId: UlidSchema,
    membershipId: UlidSchema,
    membershipRole: WorkspaceRoleSchema,
    membershipVersion: Type.Integer({ minimum: 1 }),
    acceptedAt: IsoDateTimeSchema,
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-invitation-accepted.v1",
  },
);

export type WorkspaceInvitationAccepted = Static<
  typeof WorkspaceInvitationAcceptedSchema
>;

export const WorkspaceTeamSchema = Type.Object(
  {
    members: Type.Array(
      Type.Object(
        {
          membershipId: UlidSchema,
          principalId: UlidSchema,
          displayName: Type.String({
            minLength: 1,
            maxLength: 160,
          }),
          verifiedEmail: Type.Optional(EmailAddressSchema),
          role: WorkspaceRoleSchema,
          status: MembershipStatusSchema,
          version: Type.Integer({ minimum: 1 }),
          isCurrentHuman: Type.Boolean(),
          createdAt: IsoDateTimeSchema,
          updatedAt: IsoDateTimeSchema,
        },
        { additionalProperties: false },
      ),
      { maxItems: 100 },
    ),
    invitations: Type.Array(
      Type.Object(
        {
          invitationId: UlidSchema,
          targetEmail: EmailAddressSchema,
          workspaceRole: WorkspaceRoleSchema,
          state: InvitationStateSchema,
          expiresAt: IsoDateTimeSchema,
          version: Type.Integer({ minimum: 1 }),
          invitedByPrincipalId: UlidSchema,
          createdAt: IsoDateTimeSchema,
          updatedAt: IsoDateTimeSchema,
        },
        { additionalProperties: false },
      ),
      { maxItems: 100 },
    ),
    membersNextCursor: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 512,
        pattern: "^[A-Za-z0-9_-]+$",
      }),
    ),
    invitationsNextCursor: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 512,
        pattern: "^[A-Za-z0-9_-]+$",
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-team.v1",
  },
);

export type WorkspaceTeam = Static<typeof WorkspaceTeamSchema>;

export const WorkspaceTeamQuerySchema = Type.Object(
  {
    pageKind: Type.Optional(
      Type.Union([Type.Literal("members"), Type.Literal("invitations")]),
    ),
    cursor: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 512,
        pattern: "^[A-Za-z0-9_-]+$",
      }),
    ),
    limit: Type.Optional(
      Type.String({
        pattern: "^(?:[1-9]|[1-9][0-9]|100)$",
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-team-query.v1",
  },
);

export type WorkspaceTeamQuery = Static<typeof WorkspaceTeamQuerySchema>;

export const TargetPrincipalPathSchema = Type.Object(
  {
    targetPrincipalId: UlidSchema,
  },
  { additionalProperties: false },
);

export const ChangeWorkspaceMembershipBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    role: WorkspaceRoleSchema,
    status: MembershipStatusSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.change-workspace-membership-body.v1",
  },
);

export type ChangeWorkspaceMembershipBody = Static<
  typeof ChangeWorkspaceMembershipBodySchema
>;

export const ChangedWorkspaceMembershipSchema = Type.Object(
  {
    membershipId: UlidSchema,
    role: WorkspaceRoleSchema,
    status: MembershipStatusSchema,
    version: Type.Integer({ minimum: 1 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.changed-workspace-membership.v1",
  },
);

export type ChangedWorkspaceMembership = Static<
  typeof ChangedWorkspaceMembershipSchema
>;

export const ChangeWorkspaceMembershipsBodySchema = Type.Object(
  {
    changes: Type.Array(
      Type.Object(
        {
          targetPrincipalId: UlidSchema,
          ...ChangeWorkspaceMembershipBodySchema.properties,
        },
        { additionalProperties: false },
      ),
      {
        minItems: 1,
        maxItems: 100,
      },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.change-workspace-memberships-body.v1",
  },
);

export type ChangeWorkspaceMembershipsBody = Static<
  typeof ChangeWorkspaceMembershipsBodySchema
>;

export const ChangedWorkspaceMembershipsSchema = Type.Object(
  {
    members: Type.Array(ChangedWorkspaceMembershipSchema, {
      minItems: 1,
      maxItems: 100,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.changed-workspace-memberships.v1",
  },
);

export type ChangedWorkspaceMemberships = Static<
  typeof ChangedWorkspaceMembershipsSchema
>;

export const RegistrationModeSchema = Type.Union([
  Type.Literal("closed"),
  Type.Literal("account_only"),
]);

const OidcProviderIdSchema = Type.String({
  pattern: "^[a-z][a-z0-9-]{0,63}$",
});

export const InstanceRegistrationPolicySchema = Type.Object(
  {
    mode: RegistrationModeSchema,
    emailPasswordEnabled: Type.Boolean(),
    emailVerificationRequired: Type.Boolean(),
    oidcProviderIds: Type.Array(OidcProviderIdSchema, {
      maxItems: 20,
      uniqueItems: true,
    }),
    version: Type.Integer({ minimum: 0 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.instance-registration-policy.v1",
  },
);

export type InstanceRegistrationPolicy = Static<
  typeof InstanceRegistrationPolicySchema
>;

export const InstanceRegistrationSettingsSchema = Type.Object(
  {
    policy: InstanceRegistrationPolicySchema,
    capabilities: Type.Object(
      {
        emailPasswordRegistrationAvailable: Type.Boolean(),
        emailVerificationDelivery: Type.Union([
          Type.Literal("unavailable"),
          Type.Literal("smtp"),
          Type.Literal("development_outbox"),
        ]),
        oidcProviders: Type.Array(
          Type.Object(
            {
              id: OidcProviderIdSchema,
              name: Type.String({ minLength: 1, maxLength: 64 }),
            },
            { additionalProperties: false },
          ),
          { maxItems: 20 },
        ),
      },
      { additionalProperties: false },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.instance-registration-settings.v1",
  },
);

export type InstanceRegistrationSettings = Static<
  typeof InstanceRegistrationSettingsSchema
>;

export const UpdateInstanceRegistrationPolicyBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 0 }),
    mode: RegistrationModeSchema,
    emailPasswordEnabled: Type.Boolean(),
    emailVerificationRequired: Type.Boolean(),
    oidcProviderIds: Type.Array(OidcProviderIdSchema, {
      maxItems: 20,
      uniqueItems: true,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.update-instance-registration-policy-body.v1",
  },
);

export type UpdateInstanceRegistrationPolicyBody = Static<
  typeof UpdateInstanceRegistrationPolicyBodySchema
>;

const GrantableWorkspaceRoleSchema = Type.Union([
  Type.Literal("admin"),
  Type.Literal("editor"),
  Type.Literal("operator"),
  Type.Literal("reviewer"),
  Type.Literal("viewer"),
]);

export const InstanceAccessOverviewSchema = Type.Object(
  {
    principals: Type.Array(
      Type.Object(
        {
          principalId: UlidSchema,
          displayName: Type.String({ minLength: 1, maxLength: 255 }),
          email: EmailAddressSchema,
          emailVerified: Type.Boolean(),
          registeredAt: IsoDateTimeSchema,
          status: MembershipStatusSchema,
          version: Type.Integer({ minimum: 1 }),
          isInstanceAdministrator: Type.Boolean(),
          memberships: Type.Array(
            Type.Object(
              {
                ...ChangedWorkspaceMembershipSchema.properties,
                workspaceId: UlidSchema,
              },
              { additionalProperties: false },
            ),
            { maxItems: 500 },
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 200 },
    ),
    invitations: Type.Array(
      Type.Object(
        {
          invitationId: UlidSchema,
          workspaceId: UlidSchema,
          targetEmail: EmailAddressSchema,
          workspaceRole: WorkspaceRoleSchema,
          state: InvitationStateSchema,
          expiresAt: IsoDateTimeSchema,
          version: Type.Integer({ minimum: 1 }),
          createdAt: IsoDateTimeSchema,
        },
        { additionalProperties: false },
      ),
      { maxItems: 200 },
    ),
    workspaces: Type.Array(
      Type.Object(
        {
          organizationId: UlidSchema,
          organizationName: Type.String({ minLength: 1, maxLength: 160 }),
          workspaceId: UlidSchema,
          workspaceName: Type.String({ minLength: 1, maxLength: 160 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.instance-access-overview.v1",
  },
);

export type InstanceAccessOverview = Static<
  typeof InstanceAccessOverviewSchema
>;

export const GrantInstanceWorkspaceAccessBodySchema = Type.Object(
  {
    assignments: Type.Array(
      Type.Object(
        {
          workspaceId: UlidSchema,
          role: GrantableWorkspaceRoleSchema,
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 50 },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.grant-instance-workspace-access-body.v1",
  },
);

export type GrantInstanceWorkspaceAccessBody = Static<
  typeof GrantInstanceWorkspaceAccessBodySchema
>;

export const GrantedInstanceWorkspaceAccessSchema = Type.Object(
  {
    memberships: Type.Array(
      Type.Object(
        {
          workspaceId: UlidSchema,
          membershipId: UlidSchema,
          role: GrantableWorkspaceRoleSchema,
          status: Type.Literal("active"),
          version: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 50 },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.granted-instance-workspace-access.v1",
  },
);

export type GrantedInstanceWorkspaceAccess = Static<
  typeof GrantedInstanceWorkspaceAccessSchema
>;

const InstanceSetupTokenSchema = Type.String({
  pattern: "^knv_setup_v1_[A-Za-z0-9_-]{43}$",
});

export const ResolveInstanceSetupBodySchema = Type.Object(
  {
    setupToken: InstanceSetupTokenSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.resolve-instance-setup-body.v1",
  },
);

export type ResolveInstanceSetupBody = Static<
  typeof ResolveInstanceSetupBodySchema
>;

export const InstanceSetupSummarySchema = Type.Object(
  {
    accountRegistration: Type.Union([
      Type.Literal("available"),
      Type.Literal("login_only"),
    ]),
  },
  {
    additionalProperties: false,
    $id: "kanvas.instance-setup-summary.v1",
  },
);

export type InstanceSetupSummary = Static<typeof InstanceSetupSummarySchema>;

export const RegisterInstanceSetupAccountBodySchema = Type.Object(
  {
    setupToken: InstanceSetupTokenSchema,
    email: Type.String({
      minLength: 3,
      maxLength: 320,
      pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
    }),
    displayName: Type.String({
      minLength: 1,
      maxLength: 160,
    }),
    password: Type.String({
      minLength: 8,
      maxLength: 128,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.register-instance-setup-account-body.v1",
  },
);

export type RegisterInstanceSetupAccountBody = Static<
  typeof RegisterInstanceSetupAccountBodySchema
>;

export const InstanceSetupAccountRegisteredSchema = Type.Object(
  {
    accountCreated: Type.Literal(true),
  },
  {
    additionalProperties: false,
    $id: "kanvas.instance-setup-account-registered.v1",
  },
);

export type InstanceSetupAccountRegistered = Static<
  typeof InstanceSetupAccountRegisteredSchema
>;

export const InstanceSetupRedemptionBodySchema = Type.Object(
  {
    setupToken: InstanceSetupTokenSchema,
    organizationSlug: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$",
    }),
    organizationName: Type.String({
      minLength: 1,
      maxLength: 160,
    }),
    workspaceSlug: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$",
    }),
    workspaceName: Type.String({
      minLength: 1,
      maxLength: 160,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.instance-setup-redemption-body.v1",
  },
);

export type InstanceSetupRedemptionBody = Static<
  typeof InstanceSetupRedemptionBodySchema
>;

export const InstanceSetupRedemptionResponseSchema = Type.Object(
  {
    principalId: UlidSchema,
    organizationId: UlidSchema,
    workspaceId: UlidSchema,
    bindingMode: Type.Union([
      Type.Literal("auth_subject"),
      Type.Literal("verified_email_hash"),
      Type.Literal("unbound"),
    ]),
  },
  {
    additionalProperties: false,
    $id: "kanvas.instance-setup-redemption-response.v1",
  },
);

export type InstanceSetupRedemptionResponse = Static<
  typeof InstanceSetupRedemptionResponseSchema
>;

export const BrowserMutationHeadersSchema = Type.Object(
  {
    "x-kanvas-csrf": Type.String({
      pattern: "^[A-Za-z0-9_-]{43}$",
    }),
  },
  {
    additionalProperties: true,
  },
);

export const BrowserControlPlaneVersionSchema = Type.Literal(1);

export const BrowserExecutorSessionPathSchema = Type.Object(
  {
    browserExecutorSessionId: UlidSchema,
  },
  {
    additionalProperties: false,
  },
);

export const BrowserAssignmentPathSchema = Type.Object(
  {
    browserExecutorSessionId: UlidSchema,
    browserAssignmentId: UlidSchema,
  },
  {
    additionalProperties: false,
  },
);

export const BrowserAttemptGrantHeadersSchema = Type.Object(
  {
    "x-kanvas-workspace-id": UlidSchema,
    "x-kanvas-attempt-grant": Type.String({
      pattern: "^[A-Za-z0-9_-]{43}$",
      description:
        "Single-assignment opaque grant returned once by the claim operation.",
    }),
  },
  {
    additionalProperties: true,
  },
);

export const BrowserAttemptOutputAllocationHeadersSchema = Type.Object(
  {
    "x-kanvas-workspace-id": UlidSchema,
    "x-kanvas-attempt-grant": Type.String({
      pattern: "^[A-Za-z0-9_-]{43}$",
    }),
    "idempotency-key": Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[\\x21-\\x7e]+$",
    }),
  },
  {
    additionalProperties: true,
  },
);

export const BrowserAttemptOutputUploadHeadersSchema = Type.Object(
  {
    "x-kanvas-workspace-id": UlidSchema,
    "x-kanvas-attempt-grant": Type.String({
      pattern: "^[A-Za-z0-9_-]{43}$",
    }),
    "x-kanvas-attempt-id": UlidSchema,
    "x-kanvas-attempt-lease-generation": Type.String({
      pattern: "^[1-9][0-9]{0,9}$",
    }),
    "x-kanvas-execution-generation": Type.String({
      pattern: "^[1-9][0-9]{0,9}$",
    }),
    "x-kanvas-output-role": Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[\\x21-\\x7e]+$",
    }),
    "x-kanvas-output-index": Type.String({
      pattern: "^(?:0|[1-9][0-9]{0,9})$",
    }),
  },
  {
    additionalProperties: true,
  },
);

export const BrowserAttemptOutputUploadSessionPathSchema = Type.Object(
  {
    browserExecutorSessionId: UlidSchema,
    browserAssignmentId: UlidSchema,
    uploadSessionId: UlidSchema,
  },
  {
    additionalProperties: false,
  },
);

export const AllocateBrowserAttemptOutputBodySchema = Type.Object(
  {
    controlPlaneVersion: BrowserControlPlaneVersionSchema,
    attemptId: UlidSchema,
    leaseGeneration: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    executionGeneration: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    outputRole: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[\\x21-\\x7e]+$",
    }),
    outputIndex: Type.Integer({
      minimum: 0,
      maximum: 4_294_967_295,
    }),
    expectedSize: Type.Optional(
      Type.String({
        pattern: "^(?:0|[1-9][0-9]{0,19})$",
      }),
    ),
    expectedMediaType: Type.Union([
      Type.Literal("image/jpeg"),
      Type.Literal("image/png"),
      Type.Literal("image/webp"),
    ]),
    expectedSha256: Type.Optional(
      Type.String({
        pattern: "^[0-9a-f]{64}$",
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.allocate-browser-attempt-output-body.v1",
  },
);

export type AllocateBrowserAttemptOutputBody = Static<
  typeof AllocateBrowserAttemptOutputBodySchema
>;

export const BrowserAttemptOutputUploadSessionSchema = Type.Object(
  {
    uploadSessionId: UlidSchema,
    state: Type.Union([
      Type.Literal("open"),
      Type.Literal("sealing"),
      Type.Literal("verifying"),
      Type.Literal("verified"),
      Type.Literal("committed"),
    ]),
    expiresAt: IsoDateTimeSchema,
    maximumBytes: Type.String({
      pattern: "^(?:0|[1-9][0-9]{0,19})$",
    }),
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.browser-attempt-output-upload-session.v1",
  },
);

export type BrowserAttemptOutputUploadSession = Static<
  typeof BrowserAttemptOutputUploadSessionSchema
>;

export const BrowserAttemptOutputIngestionSchema = Type.Object(
  {
    uploadSessionId: UlidSchema,
    state: Type.Union([Type.Literal("verified"), Type.Literal("committed")]),
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.browser-attempt-output-ingestion.v1",
  },
);

export type BrowserAttemptOutputIngestion = Static<
  typeof BrowserAttemptOutputIngestionSchema
>;

export const UserImportUploadSessionPathSchema = Type.Object(
  {
    uploadSessionId: UlidSchema,
  },
  {
    additionalProperties: false,
  },
);

export const ArtifactContentPathSchema = Type.Object(
  {
    artifactId: UlidSchema,
  },
  {
    additionalProperties: false,
  },
);

export const ArtifactDownloadHeadersSchema = Type.Object(
  {
    "x-kanvas-workspace-id": UlidSchema,
    range: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 200,
        pattern: "^bytes=[0-9]*-[0-9]*$",
      }),
    ),
  },
  {
    additionalProperties: true,
  },
);

export const AllocateUserImportBodySchema = Type.Object(
  {
    expectedSize: Type.Optional(
      Type.String({
        pattern: "^(?:0|[1-9][0-9]{0,19})$",
      }),
    ),
    expectedMediaType: Type.Union([
      Type.Literal("image/jpeg"),
      Type.Literal("image/png"),
      Type.Literal("image/webp"),
    ]),
    expectedSha256: Type.Optional(
      Type.String({
        pattern: "^[0-9a-f]{64}$",
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.allocate-user-import-body.v1",
  },
);

export type AllocateUserImportBody = Static<
  typeof AllocateUserImportBodySchema
>;

export const UserImportUploadSessionSchema = Type.Object(
  {
    uploadSessionId: UlidSchema,
    state: Type.Union([
      Type.Literal("open"),
      Type.Literal("sealing"),
      Type.Literal("verifying"),
      Type.Literal("verified"),
      Type.Literal("committed"),
    ]),
    expiresAt: IsoDateTimeSchema,
    maximumBytes: Type.String({
      pattern: "^(?:0|[1-9][0-9]{0,19})$",
    }),
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.user-import-upload-session.v1",
  },
);

export type UserImportUploadSession = Static<
  typeof UserImportUploadSessionSchema
>;

export const UserImportIngestionSchema = Type.Object(
  {
    uploadSessionId: UlidSchema,
    state: Type.Union([Type.Literal("verified"), Type.Literal("committed")]),
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.user-import-ingestion.v1",
  },
);

export type UserImportIngestion = Static<typeof UserImportIngestionSchema>;

export const CommitUserImportBodySchema = Type.Object(
  {
    artifactType: Type.String({
      minLength: 1,
      maxLength: 120,
    }),
    dataClassification: Type.Union([
      Type.Literal("internal"),
      Type.Literal("confidential"),
      Type.Literal("restricted"),
    ]),
    displayFilename: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 255,
      }),
    ),
    metadata: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        maxProperties: 128,
      }),
    ),
    asset: Type.Optional(
      Type.Object(
        {
          name: Type.String({
            minLength: 1,
            maxLength: 240,
          }),
          assetType: Type.String({
            minLength: 1,
            maxLength: 120,
          }),
        },
        {
          additionalProperties: false,
        },
      ),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.commit-user-import-body.v1",
  },
);

export type CommitUserImportBody = Static<typeof CommitUserImportBodySchema>;

export const CommittedUserImportSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("committed"), Type.Literal("replayed")]),
    uploadSessionId: UlidSchema,
    storedObjectId: UlidSchema,
    artifactId: UlidSchema,
    assetId: Type.Optional(UlidSchema),
    contentDigest: Sha256DigestSchema,
    mediaType: Type.String({
      minLength: 3,
      maxLength: 160,
    }),
    byteSize: Type.String({
      pattern: "^(?:0|[1-9][0-9]{0,19})$",
    }),
    committedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.committed-user-import.v1",
  },
);

export type CommittedUserImport = Static<typeof CommittedUserImportSchema>;

export const CanvasExportFormatSchema = Type.Union([
  Type.Literal("png"),
  Type.Literal("jpeg"),
  Type.Literal("webp"),
]);

export const CanvasExportUploadSessionPathSchema = Type.Object(
  {
    exportSessionId: UlidSchema,
  },
  {
    additionalProperties: false,
  },
);

export const AllocateCanvasExportBodySchema = Type.Object(
  {
    canvasDraftId: UlidSchema,
    documentVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    pageId: Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    }),
    format: CanvasExportFormatSchema,
    width: Type.Integer({ minimum: 64, maximum: 32_768 }),
    height: Type.Integer({ minimum: 64, maximum: 32_768 }),
    transparentBackground: Type.Boolean(),
    displayFilename: Type.String({
      minLength: 1,
      maxLength: 255,
    }),
    expectedSize: Type.Optional(
      Type.String({
        pattern: "^(?:0|[1-9][0-9]{0,19})$",
      }),
    ),
    expectedSha256: Type.Optional(
      Type.String({
        pattern: "^[0-9a-f]{64}$",
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.allocate-canvas-export-body.v1",
  },
);

export const CanvasExportTargetSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("artifact_only"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("new_asset"),
      name: Type.String({ minLength: 1, maxLength: 240 }),
      assetType: Type.String({
        minLength: 1,
        maxLength: 120,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("existing_asset"),
      assetId: UlidSchema,
      expectedVersion: Type.Integer({
        minimum: 1,
        maximum: 4_294_967_295,
      }),
    },
    { additionalProperties: false },
  ),
]);

export const CommitCanvasExportBodySchema = Type.Object(
  {
    request: AllocateCanvasExportBodySchema,
    target: CanvasExportTargetSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.commit-canvas-export-body.v1",
  },
);

export const CommittedCanvasExportSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("committed"), Type.Literal("replayed")]),
    exportSessionId: UlidSchema,
    storedObjectId: UlidSchema,
    artifactId: UlidSchema,
    assetId: Type.Optional(UlidSchema),
    assetVersion: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 4_294_967_295,
      }),
    ),
    contentDigest: Sha256DigestSchema,
    mediaType: Type.String({
      minLength: 3,
      maxLength: 160,
    }),
    byteSize: Type.String({
      pattern: "^(?:0|[1-9][0-9]{0,19})$",
    }),
    committedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.committed-canvas-export.v1",
  },
);

export const CanvasExportUploadSessionSchema = Type.Object(
  {
    exportSessionId: UlidSchema,
    state: Type.Union([
      Type.Literal("open"),
      Type.Literal("sealing"),
      Type.Literal("verifying"),
      Type.Literal("verified"),
      Type.Literal("committed"),
    ]),
    expiresAt: IsoDateTimeSchema,
    maximumBytes: Type.String({
      pattern: "^(?:0|[1-9][0-9]{0,19})$",
    }),
    replayed: Type.Boolean(),
    result: Type.Optional(CommittedCanvasExportSchema),
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-export-upload-session.v1",
  },
);

export const CanvasExportIngestionSchema = Type.Object(
  {
    exportSessionId: UlidSchema,
    state: Type.Union([Type.Literal("verified"), Type.Literal("committed")]),
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-export-ingestion.v1",
  },
);

export type AllocateCanvasExportBody = Static<
  typeof AllocateCanvasExportBodySchema
>;
export type CanvasExportFormat = Static<typeof CanvasExportFormatSchema>;
export type CanvasExportIngestion = Static<typeof CanvasExportIngestionSchema>;
export type CanvasExportTarget = Static<typeof CanvasExportTargetSchema>;
export type CanvasExportUploadSession = Static<
  typeof CanvasExportUploadSessionSchema
>;
export type CommitCanvasExportBody = Static<
  typeof CommitCanvasExportBodySchema
>;
export type CommittedCanvasExport = Static<typeof CommittedCanvasExportSchema>;

export const ArtifactBinaryContentSchema = Type.String({
  contentEncoding: "binary",
  description: "Authenticated immutable Artifact byte stream.",
});

export const OperationalTimelineSourceSchema = Type.Union([
  Type.Literal("workflow_run"),
  Type.Literal("node_run"),
  Type.Literal("capability_run"),
  Type.Literal("capability_attempt"),
  Type.Literal("outbox_event"),
  Type.Literal("inbox_receipt"),
  Type.Literal("provider_invocation"),
  Type.Literal("provider_observation"),
  Type.Literal("usage_ledger"),
  Type.Literal("budget_reservation"),
  Type.Literal("budget_ledger"),
  Type.Literal("artifact_commit"),
  Type.Literal("audit_event"),
]);

export const OperationalTimelineFactValueSchema = Type.Union([
  Type.String({
    maxLength: 1_024,
  }),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
]);

export const OperationalTimelineItemSchema = Type.Object(
  {
    id: Type.String({
      minLength: 1,
      maxLength: 320,
    }),
    source: OperationalTimelineSourceSchema,
    kind: Type.String({
      minLength: 1,
      maxLength: 160,
    }),
    resourceType: Type.String({
      minLength: 1,
      maxLength: 120,
    }),
    resourceId: Type.String({
      minLength: 1,
      maxLength: 320,
    }),
    status: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 120,
      }),
    ),
    outcome: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 120,
      }),
    ),
    occurredAt: IsoDateTimeSchema,
    requestId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 120,
      }),
    ),
    traceId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 120,
      }),
    ),
    facts: Type.Record(
      Type.String({
        minLength: 1,
        maxLength: 120,
      }),
      OperationalTimelineFactValueSchema,
      {
        maxProperties: 24,
      },
    ),
  },
  {
    additionalProperties: false,
  },
);

export const OperationalTimelineSchema = Type.Object(
  {
    workflowRunId: UlidSchema,
    generatedAt: IsoDateTimeSchema,
    items: Type.Array(OperationalTimelineItemSchema, {
      maxItems: 1_000,
    }),
    truncated: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.operational-timeline.v1",
  },
);

export type OperationalTimeline = Static<typeof OperationalTimelineSchema>;

export const BrowserCapabilityDeclarationSchema = Type.Object(
  {
    implementationRevisionId: UlidSchema,
    implementationDigest: Sha256DigestSchema,
    adapterKey: Type.String({ minLength: 1, maxLength: 160 }),
    backend: Type.Union([
      Type.Literal("webgpu"),
      Type.Literal("wasm"),
      Type.Literal("javascript"),
    ]),
    probeProfileVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    probeResultDigest: Sha256DigestSchema,
  },
  {
    additionalProperties: false,
  },
);

export const RegisterBrowserExecutorBodySchema = Type.Object(
  {
    controlPlaneVersion: BrowserControlPlaneVersionSchema,
    runtimeReleaseId: UlidSchema,
    runtimeReleaseDigest: Sha256DigestSchema,
    capabilityManifestVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    capabilityManifestDigest: Sha256DigestSchema,
    capabilities: Type.Array(BrowserCapabilityDeclarationSchema, {
      minItems: 1,
      maxItems: 64,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.register-browser-executor-body.v1",
  },
);

export type RegisterBrowserExecutorBody = Static<
  typeof RegisterBrowserExecutorBodySchema
>;

export const RegisteredBrowserExecutorSchema = Type.Object(
  {
    controlPlaneVersion: BrowserControlPlaneVersionSchema,
    sessionId: UlidSchema,
    workspaceId: UlidSchema,
    state: Type.Literal("active"),
    serverTime: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    capabilityIds: Type.Array(UlidSchema, {
      minItems: 1,
      maxItems: 64,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.registered-browser-executor.v1",
  },
);

export type RegisteredBrowserExecutor = Static<
  typeof RegisteredBrowserExecutorSchema
>;

export const ClaimBrowserAttemptBodySchema = Type.Object(
  {
    controlPlaneVersion: BrowserControlPlaneVersionSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.claim-browser-attempt-body.v1",
  },
);

export type ClaimBrowserAttemptBody = Static<
  typeof ClaimBrowserAttemptBodySchema
>;

export const ClaimedBrowserAttemptSchema = Type.Object(
  {
    assignmentId: UlidSchema,
    sessionId: UlidSchema,
    workspaceId: UlidSchema,
    invocationKind: Type.Union([
      Type.Literal("user"),
      Type.Literal("agent"),
      Type.Literal("canvas"),
      Type.Literal("workflow"),
    ]),
    workflowRunId: Type.Optional(UlidSchema),
    nodeRunId: Type.Optional(UlidSchema),
    capabilityRunId: UlidSchema,
    attemptId: UlidSchema,
    contractRevisionId: UlidSchema,
    bindingId: UlidSchema,
    routeCandidateIndex: Type.Integer({ minimum: 0 }),
    candidateAttemptNumber: Type.Integer({ minimum: 1 }),
    implementationRevisionId: UlidSchema,
    implementationDigest: Sha256DigestSchema,
    adapterKey: Type.String({ minLength: 1, maxLength: 160 }),
    backend: Type.Union([
      Type.Literal("webgpu"),
      Type.Literal("wasm"),
      Type.Literal("javascript"),
    ]),
    probeProfileVersion: Type.Integer({ minimum: 1 }),
    probeResultDigest: Sha256DigestSchema,
    input: Type.Unknown(),
    leaseGeneration: Type.Integer({ minimum: 1 }),
    executionGeneration: Type.Integer({ minimum: 1 }),
    leaseExpiresAt: IsoDateTimeSchema,
    executionDeadlineAt: IsoDateTimeSchema,
    attemptGrant: Type.String({
      pattern: "^[A-Za-z0-9_-]{43}$",
      description:
        "Returned once and never persisted by Kanvas. Keep only in controlled browser memory.",
    }),
  },
  {
    additionalProperties: false,
  },
);

export const ClaimBrowserAttemptResponseSchema = Type.Object(
  {
    controlPlaneVersion: BrowserControlPlaneVersionSchema,
    serverTime: IsoDateTimeSchema,
    assignment: Type.Union([ClaimedBrowserAttemptSchema, Type.Null()]),
  },
  {
    additionalProperties: false,
    $id: "kanvas.claim-browser-attempt-response.v1",
  },
);

export type ClaimBrowserAttemptResponse = Static<
  typeof ClaimBrowserAttemptResponseSchema
>;

export const HeartbeatBrowserAttemptBodySchema = Type.Object(
  {
    controlPlaneVersion: BrowserControlPlaneVersionSchema,
    attemptId: UlidSchema,
    leaseGeneration: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    executionGeneration: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.heartbeat-browser-attempt-body.v1",
  },
);

export type HeartbeatBrowserAttemptBody = Static<
  typeof HeartbeatBrowserAttemptBodySchema
>;

export const BrowserAttemptHeartbeatResponseSchema = Type.Object(
  {
    result: Type.Union([
      Type.Literal("renewed"),
      Type.Literal("cancel_requested"),
      Type.Literal("revoked"),
      Type.Literal("rejected"),
    ]),
    serverTime: IsoDateTimeSchema,
    leaseExpiresAt: Type.Optional(IsoDateTimeSchema),
  },
  {
    additionalProperties: false,
    $id: "kanvas.browser-attempt-heartbeat-response.v1",
  },
);

export type BrowserAttemptHeartbeatResponse = Static<
  typeof BrowserAttemptHeartbeatResponseSchema
>;

export const BrowserAttemptCompletionOutputSchema = Type.Object(
  {
    uploadSessionId: UlidSchema,
    outputRole: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[\\x21-\\x7e]+$",
    }),
    outputIndex: Type.Integer({
      minimum: 0,
      maximum: 4_294_967_295,
    }),
    artifactType: Type.String({ minLength: 1, maxLength: 120 }),
    metadata: Type.Record(Type.String(), Type.Unknown()),
  },
  {
    additionalProperties: false,
  },
);

const BrowserUsageObservationSchema = Type.Object(
  {
    entryKey: Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[\\x21-\\x7e]+$",
    }),
    metricKey: Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[\\x21-\\x7e]+$",
    }),
    valueDimension: Type.Literal("quantity"),
    unitCode: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[\\x21-\\x7e]+$",
    }),
    entryKind: Type.Literal("observation"),
    numericValue: Type.String({
      pattern: "^(?:0|[1-9][0-9]{0,23})(?:\\.[0-9]{1,12})?$",
    }),
    evidenceDigest: Sha256DigestSchema,
    observedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
  },
);

const BrowserUsageUnknownSchema = Type.Object(
  {
    entryKey: Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[\\x21-\\x7e]+$",
    }),
    metricKey: Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[\\x21-\\x7e]+$",
    }),
    valueDimension: Type.Literal("quantity"),
    unitCode: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[\\x21-\\x7e]+$",
    }),
    entryKind: Type.Literal("unknown"),
    evidenceDigest: Sha256DigestSchema,
    observedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
  },
);

export const BrowserInitialUsageEntrySchema = Type.Union([
  BrowserUsageObservationSchema,
  BrowserUsageUnknownSchema,
]);

export const CompleteBrowserAttemptBodySchema = Type.Object(
  {
    controlPlaneVersion: BrowserControlPlaneVersionSchema,
    attemptId: UlidSchema,
    capabilityRunId: UlidSchema,
    leaseGeneration: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    executionGeneration: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    implementationRevisionId: UlidSchema,
    implementationDigest: Sha256DigestSchema,
    adapterKey: Type.String({ minLength: 1, maxLength: 160 }),
    capabilityOutput: Type.Unknown(),
    outputs: Type.Array(BrowserAttemptCompletionOutputSchema, {
      maxItems: 64,
    }),
    initialUsage: Type.Array(BrowserInitialUsageEntrySchema, {
      maxItems: 256,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.complete-browser-attempt-body.v1",
  },
);

export type CompleteBrowserAttemptBody = Static<
  typeof CompleteBrowserAttemptBodySchema
>;

export const BrowserAttemptCompletionResponseSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("completed"), Type.Literal("replayed")]),
    completionId: UlidSchema,
    completionManifestHash: Sha256DigestSchema,
    manifestSchemaVersion: Type.Literal(1),
    terminalOutboxEventId: UlidSchema,
    completedAt: IsoDateTimeSchema,
    outputs: Type.Array(
      Type.Object(
        {
          uploadSessionId: UlidSchema,
          storedObjectId: UlidSchema,
          artifactId: UlidSchema,
          attemptOutputId: UlidSchema,
          outputRole: Type.String(),
          outputIndex: Type.Integer({ minimum: 0 }),
        },
        {
          additionalProperties: false,
        },
      ),
      {
        maxItems: 64,
      },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.browser-attempt-completion-response.v1",
  },
);

export type BrowserAttemptCompletionResponse = Static<
  typeof BrowserAttemptCompletionResponseSchema
>;

export const AcknowledgeBrowserAttemptCancellationBodySchema = Type.Object(
  {
    controlPlaneVersion: BrowserControlPlaneVersionSchema,
    attemptId: UlidSchema,
    capabilityRunId: UlidSchema,
    leaseGeneration: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    executionGeneration: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.acknowledge-browser-attempt-cancellation-body.v1",
  },
);

export type AcknowledgeBrowserAttemptCancellationBody = Static<
  typeof AcknowledgeBrowserAttemptCancellationBodySchema
>;

export const BrowserAttemptCancellationAcknowledgementSchema = Type.Object(
  {
    result: Type.Union([
      Type.Literal("acknowledged"),
      Type.Literal("replayed"),
      Type.Literal("revoked"),
      Type.Literal("rejected"),
    ]),
    serverTime: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.browser-attempt-cancellation-acknowledgement.v1",
  },
);

export type BrowserAttemptCancellationAcknowledgement = Static<
  typeof BrowserAttemptCancellationAcknowledgementSchema
>;

export const BrowserExecutorSessionTransitionSchema = Type.Object(
  {
    sessionId: UlidSchema,
    state: Type.Union([
      Type.Literal("active"),
      Type.Literal("draining"),
      Type.Literal("revoked"),
      Type.Literal("closed"),
    ]),
    changed: Type.Boolean(),
    serverTime: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.browser-executor-session-transition.v1",
  },
);

export type BrowserExecutorSessionTransition = Static<
  typeof BrowserExecutorSessionTransitionSchema
>;

export const ProviderSettingPresetSchema = Type.Union([
  Type.Literal("openai"),
  Type.Literal("anthropic"),
  Type.Literal("openrouter"),
  Type.Literal("xai"),
  Type.Literal("gemini"),
  Type.Literal("newapi"),
  Type.Literal("tokenhub"),
]);

export const ProviderSettingLifecycleSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("active"),
  Type.Literal("disabled"),
  Type.Literal("revoked"),
]);

export const ProviderSettingValidationSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("passed"),
  Type.Literal("failed"),
]);

export const ProviderCredentialStorageReadinessSchema = Type.Object(
  {
    ready: Type.Literal(true),
    mode: Type.Union([
      Type.Literal("plaintext_database"),
      Type.Literal("encrypted_database"),
    ]),
    kekVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  },
  {
    additionalProperties: false,
  },
);

export const ProviderSettingSummarySchema = Type.Object(
  {
    id: UlidSchema,
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    preset: ProviderSettingPresetSchema,
    baseUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    modelKeys: Type.Array(Type.String({ minLength: 1, maxLength: 255 }), {
      maxItems: 2_000,
    }),
    modelCatalog: Type.Optional(
      Type.Object(
        {
          revision: Type.Integer({
            minimum: 1,
            maximum: 4_294_967_295,
          }),
          discoveredAt: IsoDateTimeSchema,
          sourceDigest: Type.String({
            pattern: "^sha256:[0-9a-f]{64}$",
          }),
          discoveryMethod: Type.String({
            minLength: 1,
            maxLength: 120,
          }),
          activatedRevision: Type.Optional(
            Type.Integer({
              minimum: 1,
              maximum: 4_294_967_295,
            }),
          ),
          changesPendingReview: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
    lifecycle: ProviderSettingLifecycleSchema,
    validation: ProviderSettingValidationSchema,
    secretConfigured: Type.Boolean(),
    canRefreshModelCatalog: Type.Boolean({
      description:
        "Server-derived management eligibility for refreshing the exact selected-model catalog with the persisted credential.",
    }),
    secretFingerprintSuffix: Type.Optional(
      Type.String({
        minLength: 8,
        maxLength: 16,
        pattern: "^[0-9a-f]+$",
      }),
    ),
    secretRotatedAt: Type.Optional(IsoDateTimeSchema),
    validatedAt: Type.Optional(IsoDateTimeSchema),
    activatedAt: Type.Optional(IsoDateTimeSchema),
    version: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
  },
);

export const WorkspaceProviderSettingsSchema = Type.Object(
  {
    credentialStorage: ProviderCredentialStorageReadinessSchema,
    providers: Type.Array(ProviderSettingSummarySchema, {
      maxItems: 128,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-provider-settings.v1",
  },
);

const DecimalAmountSchema = Type.String({
  minLength: 1,
  maxLength: 50,
  pattern: "^-?[0-9]{1,36}(?:\\.[0-9]{1,12})?$",
});

const BudgetLimitAmountInputSchema = Type.String({
  minLength: 1,
  maxLength: 50,
  pattern: "^[0-9]{1,36}(?:\\.[0-9]{1,2})?$",
});

export const WorkspaceBudgetSummarySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 160 }),
    providerSettingId: Type.Optional(UlidSchema),
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("frozen"),
      Type.Literal("exhausted"),
      Type.Literal("closed"),
    ]),
    currencyCode: Type.String({
      minLength: 3,
      maxLength: 3,
      pattern: "^[A-Z]{3}$",
    }),
    periodStartAt: IsoDateTimeSchema,
    periodEndAt: IsoDateTimeSchema,
    hardLimitAmount: DecimalAmountSchema,
    consumedAmount: DecimalAmountSchema,
    reservedAmount: DecimalAmountSchema,
    unknownHeldAmount: DecimalAmountSchema,
    remainingAmount: DecimalAmountSchema,
    version: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
  },
  {
    additionalProperties: false,
  },
);

export const WorkspaceBudgetPathSchema = Type.Object(
  {
    providerSettingId: UlidSchema,
  },
  {
    additionalProperties: false,
  },
);

export const UpdateWorkspaceBudgetBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    hardLimitAmount: BudgetLimitAmountInputSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.update-workspace-budget-body.v1",
  },
);

export const WorkspaceBudgetMutationResultSchema = Type.Object(
  {
    providerSettingId: UlidSchema,
    hardLimitAmount: DecimalAmountSchema,
    version: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-budget-mutation-result.v1",
  },
);

export const WorkspaceUnknownBudgetHoldSchema = Type.Object(
  {
    id: UlidSchema,
    providerName: Type.String({
      minLength: 1,
      maxLength: 160,
    }),
    workflowRunId: Type.Optional(UlidSchema),
    capabilityRunId: Type.Optional(UlidSchema),
    providerRequestId: Type.Optional(
      Type.String({ minLength: 1, maxLength: 160 }),
    ),
    currencyCode: Type.String({
      minLength: 3,
      maxLength: 3,
      pattern: "^[A-Z]{3}$",
    }),
    heldAmount: DecimalAmountSchema,
    version: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    submittedAt: Type.Optional(IsoDateTimeSchema),
    heldAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
  },
);

const WorkspaceQuantityUsageMetricSchema = Type.Object(
  {
    metricKey: Type.String({ minLength: 1, maxLength: 160 }),
    dimension: Type.Literal("quantity"),
    unitCode: Type.String({ minLength: 1, maxLength: 80 }),
    value: DecimalAmountSchema,
    unknownCount: Type.Integer({ minimum: 0 }),
    lastRecordedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
  },
);

const WorkspaceMoneyUsageMetricSchema = Type.Object(
  {
    metricKey: Type.String({ minLength: 1, maxLength: 160 }),
    dimension: Type.Literal("money"),
    currencyCode: Type.String({
      minLength: 3,
      maxLength: 3,
      pattern: "^[A-Z]{3}$",
    }),
    value: DecimalAmountSchema,
    unknownCount: Type.Integer({ minimum: 0 }),
    lastRecordedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
  },
);

export const WorkspaceUsageSummarySchema = Type.Object(
  {
    generatedAt: IsoDateTimeSchema,
    windowStartAt: IsoDateTimeSchema,
    windowEndAt: IsoDateTimeSchema,
    trackedAttemptCount: Type.Integer({ minimum: 0 }),
    unknownUsageCount: Type.Integer({ minimum: 0 }),
    budgets: Type.Array(WorkspaceBudgetSummarySchema, {
      maxItems: 128,
    }),
    unknownHolds: Type.Array(WorkspaceUnknownBudgetHoldSchema, {
      maxItems: 128,
    }),
    metrics: Type.Array(
      Type.Union([
        WorkspaceQuantityUsageMetricSchema,
        WorkspaceMoneyUsageMetricSchema,
      ]),
      { maxItems: 256 },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-usage-summary.v1",
  },
);

export const UnknownBudgetHoldPathSchema = Type.Object(
  {
    budgetReservationId: UlidSchema,
  },
  {
    additionalProperties: false,
  },
);

export const ResolveUnknownBudgetHoldBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    resolution: Type.Union([
      Type.Literal("charged"),
      Type.Literal("not_charged"),
    ]),
    chargedAmount: Type.Optional(DecimalAmountSchema),
    evidenceReference: Type.String({
      minLength: 3,
      maxLength: 240,
      pattern: ".*\\S.*",
    }),
  },
  {
    additionalProperties: false,
  },
);

export const UnknownBudgetHoldResolutionSchema = Type.Object(
  {
    budgetReservationId: UlidSchema,
    result: Type.Union([Type.Literal("resolved"), Type.Literal("replayed")]),
    lifecycleStatus: Type.Union([
      Type.Literal("settled"),
      Type.Literal("released"),
    ]),
    chargedAmount: DecimalAmountSchema,
    resolvedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.unknown-budget-hold-resolution.v1",
  },
);

export const WorkspaceGeneralSettingsSchema = Type.Object(
  {
    workspaceId: UlidSchema,
    slug: Type.String({
      minLength: 1,
      maxLength: 80,
    }),
    name: Type.String({
      minLength: 1,
      maxLength: 160,
    }),
    version: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-general-settings.v1",
  },
);

export const RenameWorkspaceBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    name: Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: ".*\\S.*",
    }),
  },
  {
    additionalProperties: false,
  },
);

export const BrandKitColorRoleSchema = Type.Union([
  Type.Literal("primary"),
  Type.Literal("secondary"),
  Type.Literal("accent"),
  Type.Literal("background"),
  Type.Literal("surface"),
  Type.Literal("text_primary"),
  Type.Literal("text_secondary"),
]);

const BrandKitStableKeySchema = Type.String({
  minLength: 1,
  maxLength: 80,
  pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
});

export const BrandKitColorSchema = Type.Object(
  {
    key: BrandKitStableKeySchema,
    name: Type.String({
      minLength: 1,
      maxLength: 120,
      pattern: ".*\\S.*",
    }),
    role: BrandKitColorRoleSchema,
    value: Type.String({
      pattern: "^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$",
    }),
    position: Type.Integer({ minimum: 0, maximum: 999 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.brand-kit-color.v1",
  },
);

export const BrandKitLogoRoleSchema = Type.Union([
  Type.Literal("primary"),
  Type.Literal("inverse"),
  Type.Literal("icon"),
]);

export const BrandKitLogoSchema = Type.Object(
  {
    key: BrandKitStableKeySchema,
    name: Type.String({
      minLength: 1,
      maxLength: 120,
      pattern: ".*\\S.*",
    }),
    role: BrandKitLogoRoleSchema,
    assetId: UlidSchema,
    artifactId: UlidSchema,
    position: Type.Integer({ minimum: 0, maximum: 99 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.brand-kit-logo.v1",
  },
);

export const BrandKitReferenceImageSchema = Type.Object(
  {
    key: BrandKitStableKeySchema,
    name: Type.String({
      minLength: 1,
      maxLength: 120,
      pattern: ".*\\S.*",
    }),
    description: Type.Optional(
      Type.String({ minLength: 1, maxLength: 500, pattern: ".*\\S.*" }),
    ),
    assetId: UlidSchema,
    artifactId: UlidSchema,
    position: Type.Integer({ minimum: 0, maximum: 99 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.brand-kit-reference-image.v1",
  },
);

export const BrandKitTextStyleRoleSchema = Type.Union([
  Type.Literal("display"),
  Type.Literal("title"),
  Type.Literal("subtitle"),
  Type.Literal("body"),
  Type.Literal("caption"),
]);

export const BrandKitTextStyleSchema = Type.Object(
  {
    key: BrandKitStableKeySchema,
    name: Type.String({
      minLength: 1,
      maxLength: 120,
      pattern: ".*\\S.*",
    }),
    role: BrandKitTextStyleRoleSchema,
    fontId: Type.String({ minLength: 1, maxLength: 120 }),
    fontRevision: Type.String({ minLength: 1, maxLength: 120 }),
    fontFamily: Type.String({ minLength: 1, maxLength: 160 }),
    fontSize: Type.Number({ minimum: 6, maximum: 512 }),
    fontWeight: Type.Integer({ minimum: 100, maximum: 900 }),
    lineHeight: Type.Number({ minimum: 0.5, maximum: 3 }),
    letterSpacing: Type.Number({ minimum: -10, maximum: 50 }),
    colorKey: Type.Optional(BrandKitStableKeySchema),
    position: Type.Integer({ minimum: 0, maximum: 99 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.brand-kit-text-style.v1",
  },
);

export const BrandKitGuidelinesSchema = Type.Object(
  {
    voice: Type.Optional(
      Type.String({ minLength: 1, maxLength: 1000, pattern: ".*\\S.*" }),
    ),
    principles: Type.Array(
      Type.String({ minLength: 1, maxLength: 240, pattern: ".*\\S.*" }),
      { maxItems: 12, uniqueItems: true },
    ),
    avoid: Type.Array(
      Type.String({ minLength: 1, maxLength: 240, pattern: ".*\\S.*" }),
      { maxItems: 12, uniqueItems: true },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.brand-kit-guidelines.v1",
  },
);

export const BrandKitPublishedRevisionSummarySchema = Type.Object(
  {
    id: UlidSchema,
    revisionNumber: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    publishedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.brand-kit-published-revision-summary.v1",
  },
);

export const BrandKitRevisionListSchema = Type.Object(
  {
    items: Type.Array(BrandKitPublishedRevisionSummarySchema, {
      maxItems: 50,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.brand-kit-revision-list.v1",
  },
);

export const BrandKitSummarySchema = Type.Object(
  {
    id: UlidSchema,
    workspaceId: UlidSchema,
    name: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.Optional(
      Type.String({ minLength: 1, maxLength: 500, pattern: ".*\\S.*" }),
    ),
    lifecycleStatus: Type.Union([
      Type.Literal("active"),
      Type.Literal("archived"),
    ]),
    isDefault: Type.Boolean(),
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    draftVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    latestPublishedRevision: Type.Optional(
      BrandKitPublishedRevisionSummarySchema,
    ),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.brand-kit-summary.v1",
  },
);

export const BrandKitListSchema = Type.Object(
  {
    items: Type.Array(BrandKitSummarySchema, { maxItems: 100 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.brand-kit-list.v1",
  },
);

export const BrandKitListQuerySchema = Type.Object(
  {
    lifecycleStatus: Type.Optional(
      Type.Union([Type.Literal("active"), Type.Literal("archived")]),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.brand-kit-list-query.v1",
  },
);

export const BrandKitPathSchema = Type.Object(
  {
    brandKitId: UlidSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.brand-kit-path.v1",
  },
);

export const BrandKitRevisionPathSchema = Type.Object(
  {
    brandKitId: UlidSchema,
    brandKitRevisionId: UlidSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.brand-kit-revision-path.v1",
  },
);

export const CreateBrandKitBodySchema = Type.Object(
  {
    name: Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: ".*\\S.*",
    }),
    description: Type.Optional(
      Type.String({ minLength: 1, maxLength: 500, pattern: ".*\\S.*" }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.create-brand-kit-body.v1",
  },
);

export const UpdateBrandKitDraftBodySchema = Type.Object(
  {
    expectedDraftVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    name: Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: ".*\\S.*",
    }),
    description: Type.Optional(
      Type.String({ minLength: 1, maxLength: 500, pattern: ".*\\S.*" }),
    ),
    colors: Type.Array(BrandKitColorSchema, {
      maxItems: 64,
    }),
    logos: Type.Array(BrandKitLogoSchema, { maxItems: 12 }),
    referenceImages: Type.Array(BrandKitReferenceImageSchema, { maxItems: 24 }),
    textStyles: Type.Array(BrandKitTextStyleSchema, { maxItems: 16 }),
    guidelines: BrandKitGuidelinesSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.update-brand-kit-draft-body.v1",
  },
);

export const PublishBrandKitBodySchema = Type.Object(
  {
    expectedDraftVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.publish-brand-kit-body.v1",
  },
);

export const SetDefaultBrandKitBodySchema = Type.Object(
  {
    expectedBrandKitVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.set-default-brand-kit-body.v1",
  },
);

export const BrandKitDraftSchema = Type.Object(
  {
    brandKitId: UlidSchema,
    workspaceId: UlidSchema,
    name: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.Optional(
      Type.String({ minLength: 1, maxLength: 500, pattern: ".*\\S.*" }),
    ),
    lifecycleStatus: Type.Union([
      Type.Literal("active"),
      Type.Literal("archived"),
    ]),
    isDefault: Type.Boolean(),
    brandKitVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    draftVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    colors: Type.Array(BrandKitColorSchema, { maxItems: 64 }),
    logos: Type.Array(BrandKitLogoSchema, { maxItems: 12 }),
    referenceImages: Type.Array(BrandKitReferenceImageSchema, { maxItems: 24 }),
    textStyles: Type.Array(BrandKitTextStyleSchema, { maxItems: 16 }),
    guidelines: BrandKitGuidelinesSchema,
    latestPublishedRevision: Type.Optional(
      BrandKitPublishedRevisionSummarySchema,
    ),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.brand-kit-draft.v1",
  },
);

export const BrandKitRevisionSchema = Type.Object(
  {
    id: UlidSchema,
    brandKitId: UlidSchema,
    workspaceId: UlidSchema,
    revisionNumber: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.Optional(
      Type.String({ minLength: 1, maxLength: 500, pattern: ".*\\S.*" }),
    ),
    colors: Type.Array(BrandKitColorSchema, {
      minItems: 1,
      maxItems: 64,
    }),
    logos: Type.Array(BrandKitLogoSchema, {
      minItems: 1,
      maxItems: 12,
    }),
    referenceImages: Type.Array(BrandKitReferenceImageSchema, { maxItems: 24 }),
    textStyles: Type.Array(BrandKitTextStyleSchema, {
      minItems: 1,
      maxItems: 16,
    }),
    guidelines: BrandKitGuidelinesSchema,
    contentDigest: Sha256DigestSchema,
    publishedByPrincipalId: UlidSchema,
    publishedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.brand-kit-revision.v1",
  },
);

export type BrandKitColor = Static<typeof BrandKitColorSchema>;
export type BrandKitLogo = Static<typeof BrandKitLogoSchema>;
export type BrandKitReferenceImage = Static<
  typeof BrandKitReferenceImageSchema
>;
export type BrandKitTextStyle = Static<typeof BrandKitTextStyleSchema>;
export type BrandKitGuidelines = Static<typeof BrandKitGuidelinesSchema>;
export type BrandKitDraft = Static<typeof BrandKitDraftSchema>;
export type BrandKitList = Static<typeof BrandKitListSchema>;
export type BrandKitListQuery = Static<typeof BrandKitListQuerySchema>;
export type BrandKitRevision = Static<typeof BrandKitRevisionSchema>;
export type BrandKitRevisionList = Static<typeof BrandKitRevisionListSchema>;
export type BrandKitSummary = Static<typeof BrandKitSummarySchema>;
export type CreateBrandKitBody = Static<typeof CreateBrandKitBodySchema>;
export type PublishBrandKitBody = Static<typeof PublishBrandKitBodySchema>;
export type SetDefaultBrandKitBody = Static<
  typeof SetDefaultBrandKitBodySchema
>;
export type UpdateBrandKitDraftBody = Static<
  typeof UpdateBrandKitDraftBodySchema
>;

export const ProviderModelCapabilityKeySchema = Type.Union([
  Type.Literal("text.generate"),
  Type.Literal("image.generate"),
  Type.Literal("image.edit"),
]);

export const ProviderModelEvidenceSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("provider_api"),
      Type.Literal("adapter_manifest"),
      Type.Literal("administrator"),
    ]),
    reference: Type.String({ minLength: 1, maxLength: 255 }),
    observedAt: IsoDateTimeSchema,
    sourceDigest: Type.String({
      pattern: "^sha256:[0-9a-f]{64}$",
    }),
    confidence: Type.Union([
      Type.Literal("high"),
      Type.Literal("medium"),
      Type.Literal("low"),
    ]),
    claim: Type.Union([
      Type.Literal("identity"),
      Type.Literal("supported"),
      Type.Literal("unsupported"),
      Type.Literal("unknown"),
    ]),
  },
  { additionalProperties: false },
);

const ProviderModelParameterValueSchema = Type.Union([
  Type.String({ minLength: 1, maxLength: 255 }),
  Type.Integer({
    minimum: -2_147_483_647,
    maximum: 4_294_967_295,
  }),
  Type.Boolean(),
]);

const ProviderModelParameterCommonProperties = {
  key: Type.String({
    minLength: 1,
    maxLength: 80,
    pattern: "^[a-zA-Z][a-zA-Z0-9]*$",
  }),
  label: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  required: Type.Boolean(),
  evidence: Type.Array(ProviderModelEvidenceSchema, {
    minItems: 1,
    maxItems: 16,
  }),
};

export const ProviderModelParameterDefinitionSchema = Type.Union([
  Type.Object(
    {
      ...ProviderModelParameterCommonProperties,
      valueType: Type.Literal("enum"),
      values: Type.Array(ProviderModelParameterValueSchema, {
        minItems: 1,
        maxItems: 128,
        uniqueItems: true,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ProviderModelParameterCommonProperties,
      valueType: Type.Literal("integer"),
      minimum: Type.Integer({
        minimum: -2_147_483_647,
        maximum: 4_294_967_295,
      }),
      maximum: Type.Integer({
        minimum: -2_147_483_647,
        maximum: 4_294_967_295,
      }),
      step: Type.Optional(Type.Integer({ minimum: 1, maximum: 4_294_967_295 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ProviderModelParameterCommonProperties,
      valueType: Type.Literal("boolean"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ProviderModelParameterCommonProperties,
      valueType: Type.Literal("string"),
      maxLength: Type.Integer({ minimum: 1, maximum: 32_000 }),
    },
    { additionalProperties: false },
  ),
]);

const ProviderModelParameterPolicyCommonProperties = {
  allowedValues: Type.Optional(
    Type.Array(ProviderModelParameterValueSchema, {
      minItems: 1,
      maxItems: 128,
      uniqueItems: true,
    }),
  ),
  minimum: Type.Optional(
    Type.Integer({
      minimum: -2_147_483_647,
      maximum: 4_294_967_295,
    }),
  ),
  maximum: Type.Optional(
    Type.Integer({
      minimum: -2_147_483_647,
      maximum: 4_294_967_295,
    }),
  ),
};

export const ProviderModelParameterPolicySchema = Type.Union([
  Type.Object(
    {
      ...ProviderModelParameterPolicyCommonProperties,
      callerPolicy: Type.Literal("fixed"),
      defaultValue: ProviderModelParameterValueSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ProviderModelParameterPolicyCommonProperties,
      callerPolicy: Type.Literal("optional"),
      defaultValue: Type.Optional(ProviderModelParameterValueSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ProviderModelParameterPolicyCommonProperties,
      callerPolicy: Type.Literal("required"),
    },
    { additionalProperties: false },
  ),
]);

export const ProviderModelParameterPoliciesSchema = Type.Record(
  Type.String({
    minLength: 1,
    maxLength: 80,
    pattern: "^[a-zA-Z][a-zA-Z0-9]*$",
  }),
  ProviderModelParameterPolicySchema,
  { maxProperties: 64 },
);

export const CapabilityBindingPathSchema = Type.Object(
  {
    capabilityBindingId: UlidSchema,
  },
  {
    additionalProperties: false,
  },
);

export const CapabilityBindingAvailabilityReasonSchema = Type.Union([
  Type.Literal("ready"),
  Type.Literal("contract_unavailable"),
  Type.Literal("implementation_unavailable"),
  Type.Literal("provider_unconfigured"),
  Type.Literal("provider_unavailable"),
  Type.Literal("credential_unavailable"),
  Type.Literal("budget_unavailable"),
]);

export const CapabilityBindingSummarySchema = Type.Object(
  {
    id: UlidSchema,
    status: Type.Union([
      Type.Literal("enabled"),
      Type.Literal("paused"),
      Type.Literal("retired"),
    ]),
    order: Type.Integer({
      minimum: 0,
      maximum: 4_294_967_295,
    }),
    version: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    executionTarget: Type.Union([
      Type.Literal("browser"),
      Type.Literal("worker"),
      Type.Literal("provider"),
    ]),
    displayName: LocalizedTextV1Schema,
    description: Type.Optional(LocalizedTextV1Schema),
    sourceKind: Type.Union([
      Type.Literal("model_resource"),
      Type.Literal("model_service"),
      Type.Literal("plugin"),
    ]),
    providerName: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    availabilityReason: CapabilityBindingAvailabilityReasonSchema,
    implementationKey: Type.String({
      minLength: 1,
      maxLength: 160,
    }),
    implementationRevision: Type.Integer({ minimum: 1 }),
    adapterKey: Type.String({ minLength: 1, maxLength: 160 }),
    routePolicyRevisionId: Type.Optional(UlidSchema),
    providerModelId: Type.Optional(
      Type.String({ minLength: 1, maxLength: 255 }),
    ),
    apiSurface: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
  },
);

export const ProviderExecutionRouteSummarySchema = Type.Object(
  {
    routePolicyRevisionId: UlidSchema,
    providerName: Type.String({ minLength: 1, maxLength: 160 }),
    providerModelId: Type.String({
      minLength: 1,
      maxLength: 255,
    }),
    providerPreset: Type.String({ minLength: 1, maxLength: 160 }),
    apiSurface: Type.String({ minLength: 1, maxLength: 160 }),
    modelInputModalities: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 40 }), {
        maxItems: 16,
        uniqueItems: true,
      }),
    ),
    modelOperation: Type.Optional(ProviderModelCapabilityKeySchema),
    providerParameterDefinitions: Type.Optional(
      Type.Array(ProviderModelParameterDefinitionSchema, {
        maxItems: 64,
      }),
    ),
    providerParameterPolicies: Type.Optional(
      ProviderModelParameterPoliciesSchema,
    ),
    availabilityReason: Type.Union([
      Type.Literal("ready"),
      Type.Literal("provider_unavailable"),
      Type.Literal("budget_unavailable"),
    ]),
    availableBudgetAmount: DecimalAmountSchema,
  },
  { additionalProperties: false },
);

export const SetCapabilityBindingStatusBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    status: Type.Union([Type.Literal("enabled"), Type.Literal("paused")]),
  },
  {
    additionalProperties: false,
  },
);

export const MoveCapabilityBindingBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    adjacentBindingId: UlidSchema,
    expectedAdjacentVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    direction: Type.Union([Type.Literal("earlier"), Type.Literal("later")]),
  },
  {
    additionalProperties: false,
  },
);

export const CapabilityBindingMutationResultSchema = Type.Object(
  {
    bindingId: UlidSchema,
    version: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    adjacentBindingId: Type.Optional(UlidSchema),
    adjacentVersion: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 4_294_967_295,
      }),
    ),
  },
  {
    additionalProperties: false,
  },
);

export const CreateProviderSettingBodySchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    preset: ProviderSettingPresetSchema,
    baseUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    hardLimitAmount: BudgetLimitAmountInputSchema,
    apiKey: Type.String({
      minLength: 1,
      maxLength: 65_536,
    }),
    modelKeys: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 255 }), {
        minItems: 1,
        maxItems: 2_000,
        uniqueItems: true,
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.create-provider-setting-body.v1",
  },
);

const ProviderModelOperationDefinitionSchema = Type.Object(
  {
    apiSurfaces: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
    }),
    parameters: Type.Array(ProviderModelParameterDefinitionSchema, {
      maxItems: 64,
    }),
    evidence: Type.Array(ProviderModelEvidenceSchema, {
      minItems: 1,
      maxItems: 16,
    }),
  },
  { additionalProperties: false },
);

const ProviderModelEntryCommonProperties = {
  providerModelId: Type.String({
    minLength: 1,
    maxLength: 512,
  }),
  displayName: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
  inputModalities: Type.Array(
    Type.Union([
      Type.Literal("text"),
      Type.Literal("image"),
      Type.Literal("mask"),
    ]),
    { maxItems: 3, uniqueItems: true },
  ),
  outputModalities: Type.Array(
    Type.Union([
      Type.Literal("text"),
      Type.Literal("image"),
      Type.Literal("mask"),
    ]),
    { maxItems: 3, uniqueItems: true },
  ),
  evidence: Type.Array(ProviderModelEvidenceSchema, {
    minItems: 1,
    maxItems: 16,
  }),
  suggestedCanonicalSlug: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]*$",
    }),
  ),
  suggestionSource: Type.Optional(
    Type.Union([Type.Literal("models_dev"), Type.Literal("provider")]),
  ),
};

const ProviderModelEvidencedOperationsSchema = Type.Union([
  Type.Object(
    {
      "text.generate": ProviderModelOperationDefinitionSchema,
      "image.generate": Type.Optional(ProviderModelOperationDefinitionSchema),
      "image.edit": Type.Optional(ProviderModelOperationDefinitionSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      "image.generate": ProviderModelOperationDefinitionSchema,
      "image.edit": Type.Optional(ProviderModelOperationDefinitionSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      "image.generate": Type.Optional(ProviderModelOperationDefinitionSchema),
      "image.edit": ProviderModelOperationDefinitionSchema,
    },
    { additionalProperties: false },
  ),
]);

export const ProviderModelCatalogEntrySchema = Type.Union([
  Type.Object(
    {
      ...ProviderModelEntryCommonProperties,
      operations: Type.Object({}, { additionalProperties: false }),
      completeness: Type.Literal("identity_only"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ProviderModelEntryCommonProperties,
      operations: ProviderModelEvidencedOperationsSchema,
      completeness: Type.Union([
        Type.Literal("partial"),
        Type.Literal("complete"),
      ]),
    },
    { additionalProperties: false },
  ),
]);

export const DiscoverProviderModelsBodySchema = Type.Object(
  {
    preset: ProviderSettingPresetSchema,
    baseUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    apiKey: Type.String({
      minLength: 1,
      maxLength: 65_536,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.discover-provider-models-body.v1",
  },
);

export const ProviderModelDiscoveryResultSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    providerPreset: ProviderSettingPresetSchema,
    discoveryMethod: Type.String({
      minLength: 1,
      maxLength: 120,
    }),
    sourceDigest: Type.String({
      pattern: "^sha256:[0-9a-f]{64}$",
    }),
    discoveredAt: IsoDateTimeSchema,
    models: Type.Array(ProviderModelCatalogEntrySchema, {
      maxItems: 2_000,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.provider-model-discovery-result.v1",
  },
);

export const ProviderSettingCreatedSchema = Type.Object(
  {
    provider: ProviderSettingSummarySchema,
    result: Type.Union([Type.Literal("created"), Type.Literal("replayed")]),
  },
  {
    additionalProperties: false,
    $id: "kanvas.provider-setting-created.v1",
  },
);

export const ProviderSettingPathSchema = Type.Object(
  {
    providerSettingId: UlidSchema,
  },
  {
    additionalProperties: false,
  },
);

export const ProviderSettingVersionBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
  },
  {
    additionalProperties: false,
  },
);

const ProviderPricingAmountSchema = Type.String({
  minLength: 1,
  maxLength: 50,
  pattern: "^(?:0|[1-9][0-9]{0,23})(?:\\.[0-9]{1,12})?$",
});

const ProviderMeteredPricingRateInputSchema = Type.Object(
  {
    metricKey: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[a-z0-9][a-z0-9._-]*$",
    }),
    unitCode: Type.String({
      minLength: 1,
      maxLength: 40,
      pattern: "^[a-z0-9][a-z0-9._-]*$",
    }),
    quantity: Type.String({
      minLength: 1,
      maxLength: 20,
      pattern: "^[1-9][0-9]*$",
    }),
    amount: ProviderPricingAmountSchema,
  },
  { additionalProperties: false },
);

export const ProviderModelPricingConfigurationSchema = Type.Union([
  Type.Object(
    {
      providerModelId: Type.String({ minLength: 1, maxLength: 512 }),
      billingMode: Type.Literal("fixed"),
      fixedChargeAmount: ProviderPricingAmountSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      providerModelId: Type.String({ minLength: 1, maxLength: 512 }),
      billingMode: Type.Literal("metered"),
      rates: Type.Array(ProviderMeteredPricingRateInputSchema, {
        minItems: 1,
        maxItems: 32,
      }),
      minimumChargeAmount: Type.Optional(ProviderPricingAmountSchema),
      maximumChargeAmount: ProviderPricingAmountSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      providerModelId: Type.String({ minLength: 1, maxLength: 512 }),
      billingMode: Type.Literal("provider_reported"),
      maximumChargeAmount: ProviderPricingAmountSchema,
    },
    { additionalProperties: false },
  ),
]);

export const ActivateProviderSettingBodySchema = Type.Object(
  {
    ...ProviderSettingVersionBodySchema.properties,
    hardLimitAmount: BudgetLimitAmountInputSchema,
    modelPricingConfigurations: Type.Optional(
      Type.Array(ProviderModelPricingConfigurationSchema, {
        minItems: 1,
        maxItems: 32,
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.activate-provider-setting-body.v1",
  },
);

export const CanonicalModelSourceKindSchema = Type.Union([
  Type.Literal("models_dev"),
  Type.Literal("provider"),
  Type.Literal("manual"),
]);

export const ModelProfileModalitySchema = Type.Union([
  Type.Literal("text"),
  Type.Literal("image"),
  Type.Literal("audio"),
  Type.Literal("video"),
  Type.Literal("pdf"),
]);

export const ModelOperationKeySchema = Type.Union([
  Type.Literal("text.generate"),
  Type.Literal("image.generate"),
  Type.Literal("image.edit"),
]);

const ModelParameterInputCommonProperties = {
  key: Type.String({
    minLength: 1,
    maxLength: 80,
    pattern: "^[a-zA-Z][a-zA-Z0-9]*$",
  }),
  label: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  required: Type.Boolean(),
};

export const ModelParameterInputSchema = Type.Union([
  Type.Object(
    {
      ...ModelParameterInputCommonProperties,
      valueType: Type.Literal("enum"),
      values: Type.Array(ProviderModelParameterValueSchema, {
        minItems: 1,
        maxItems: 128,
        uniqueItems: true,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ModelParameterInputCommonProperties,
      valueType: Type.Literal("integer"),
      minimum: Type.Integer({
        minimum: -2_147_483_647,
        maximum: 4_294_967_295,
      }),
      maximum: Type.Integer({
        minimum: -2_147_483_647,
        maximum: 4_294_967_295,
      }),
      step: Type.Optional(Type.Integer({ minimum: 1, maximum: 4_294_967_295 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ModelParameterInputCommonProperties,
      valueType: Type.Literal("boolean"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ModelParameterInputCommonProperties,
      valueType: Type.Literal("string"),
      maxLength: Type.Integer({ minimum: 1, maximum: 65_535 }),
    },
    { additionalProperties: false },
  ),
]);

const ModelOperationInputSchema = Type.Object(
  {
    parameters: Type.Array(ModelParameterInputSchema, { maxItems: 64 }),
  },
  { additionalProperties: false },
);

export const ModelOperationsInputSchema = Type.Object(
  {
    "text.generate": Type.Optional(ModelOperationInputSchema),
    "image.generate": Type.Optional(ModelOperationInputSchema),
    "image.edit": Type.Optional(ModelOperationInputSchema),
  },
  { additionalProperties: false },
);

export const CanonicalModelPathSchema = Type.Object(
  { modelId: UlidSchema },
  { additionalProperties: false },
);

export const ProviderModelPathSchema = Type.Object(
  {
    providerSettingId: UlidSchema,
    providerModelId: UlidSchema,
  },
  { additionalProperties: false },
);

export const CreateCanonicalModelBodySchema = Type.Object(
  {
    slug: Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]*$",
    }),
    sourceKind: CanonicalModelSourceKindSchema,
    sourceReference: Type.Optional(
      Type.String({ minLength: 1, maxLength: 512 }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.create-canonical-model-body.v1",
  },
);

export const PublishCanonicalModelBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    family: Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[a-z0-9][a-z0-9._-]*$",
    }),
    description: Type.String({ minLength: 1, maxLength: 10_000 }),
    inputModalities: Type.Array(ModelProfileModalitySchema, {
      maxItems: 5,
      uniqueItems: true,
    }),
    outputModalities: Type.Array(ModelProfileModalitySchema, {
      maxItems: 5,
      uniqueItems: true,
    }),
    contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
    maximumInputTokens: Type.Optional(Type.Integer({ minimum: 1 })),
    maximumOutputTokens: Type.Optional(Type.Integer({ minimum: 1 })),
    attachment: Type.Optional(Type.Boolean()),
    reasoning: Type.Optional(Type.Boolean()),
    toolCall: Type.Optional(Type.Boolean()),
    structuredOutput: Type.Optional(Type.Boolean()),
    temperature: Type.Optional(Type.Boolean()),
    operations: ModelOperationsInputSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.publish-canonical-model-body.v1",
  },
);

export const ImportProviderModelsBodySchema = Type.Object(
  {
    upstreamModelIds: Type.Array(
      Type.String({ minLength: 1, maxLength: 512 }),
      { minItems: 1, maxItems: 2_000, uniqueItems: true },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.import-provider-models-body.v1",
  },
);

export const MapProviderModelBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    canonicalModelId: UlidSchema,
    mappingSource: CanonicalModelSourceKindSchema,
    mappingConfidence: Type.Union([
      Type.Literal("exact"),
      Type.Literal("suggested"),
      Type.Literal("manual"),
    ]),
  },
  {
    additionalProperties: false,
    $id: "kanvas.map-provider-model-body.v1",
  },
);

export const ProviderAgentTextTransportSchema = Type.Union([
  Type.Object(
    {
      apiSurface: Type.Literal("chat.completions.v1"),
      protocolKind: Type.Literal("openai_chat"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      apiSurface: Type.Literal("responses.v1"),
      protocolKind: Type.Literal("openai_responses"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      apiSurface: Type.Literal("generate-content.v1"),
      protocolKind: Type.Literal("gemini_generate_content"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      apiSurface: Type.Literal("messages.v1"),
      protocolKind: Type.Literal("anthropic_messages"),
    },
    { additionalProperties: false },
  ),
]);

export const PublishProviderModelBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    profile: Type.Optional(PublishCanonicalModelBodySchema),
    agentTextTransport: Type.Optional(ProviderAgentTextTransportSchema),
    pricing: ProviderModelPricingConfigurationSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.publish-provider-model-body.v1",
  },
);

const ModelProfileSummarySchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    family: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.String({ minLength: 1, maxLength: 10_000 }),
    inputModalities: Type.Array(ModelProfileModalitySchema, { maxItems: 5 }),
    outputModalities: Type.Array(ModelProfileModalitySchema, { maxItems: 5 }),
    contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
    maximumInputTokens: Type.Optional(Type.Integer({ minimum: 1 })),
    maximumOutputTokens: Type.Optional(Type.Integer({ minimum: 1 })),
    attachment: Type.Optional(Type.Boolean()),
    reasoning: Type.Optional(Type.Boolean()),
    toolCall: Type.Optional(Type.Boolean()),
    structuredOutput: Type.Optional(Type.Boolean()),
    temperature: Type.Optional(Type.Boolean()),
    operations: Type.Object(
      {
        "text.generate": Type.Optional(
          Type.Object(
            { parameters: Type.Array(ModelParameterInputSchema) },
            { additionalProperties: false },
          ),
        ),
        "image.generate": Type.Optional(
          Type.Object(
            { parameters: Type.Array(ModelParameterInputSchema) },
            { additionalProperties: false },
          ),
        ),
        "image.edit": Type.Optional(
          Type.Object(
            { parameters: Type.Array(ModelParameterInputSchema) },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const CanonicalModelSummarySchema = Type.Object(
  {
    id: UlidSchema,
    slug: Type.String({ minLength: 1, maxLength: 160 }),
    lifecycle: Type.Union([
      Type.Literal("draft"),
      Type.Literal("active"),
      Type.Literal("disabled"),
      Type.Literal("revoked"),
    ]),
    sourceKind: CanonicalModelSourceKindSchema,
    sourceReference: Type.Optional(
      Type.String({ minLength: 1, maxLength: 512 }),
    ),
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    profile: Type.Optional(ModelProfileSummarySchema),
    providers: Type.Array(
      Type.Object(
        {
          id: UlidSchema,
          providerSettingId: UlidSchema,
          providerName: Type.String({ minLength: 1, maxLength: 160 }),
          providerPreset: ProviderSettingPresetSchema,
          upstreamModelId: Type.String({ minLength: 1, maxLength: 512 }),
          lifecycle: Type.Union([
            Type.Literal("discovered"),
            Type.Literal("mapped"),
            Type.Literal("active"),
            Type.Literal("disabled"),
            Type.Literal("removed"),
          ]),
          agentTextTransport: Type.Optional(ProviderAgentTextTransportSchema),
          supportedAgentTextTransports: Type.Array(
            ProviderAgentTextTransportSchema,
            { minItems: 1, maxItems: 4 },
          ),
          supportedOperations: Type.Array(ProviderModelCapabilityKeySchema, {
            maxItems: 3,
            uniqueItems: true,
          }),
          operations: ModelOperationsInputSchema,
          providerReportedPricingAvailable: Type.Boolean(),
          maximumCharge: Type.Optional(
            Type.Object(
              {
                currencyCode: Type.String({ minLength: 3, maxLength: 3 }),
                amount: ProviderPricingAmountSchema,
              },
              { additionalProperties: false },
            ),
          ),
          version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
          modelDeploymentId: Type.Optional(UlidSchema),
          pricingRevisionId: Type.Optional(UlidSchema),
        },
        { additionalProperties: false },
      ),
      { maxItems: 2_000 },
    ),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  { additionalProperties: false },
);

export const WorkspaceModelsSchema = Type.Object(
  { models: Type.Array(CanonicalModelSummarySchema, { maxItems: 2_000 }) },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-models.v1",
  },
);

export const CanonicalModelMutationResultSchema = Type.Object(
  {
    model: CanonicalModelSummarySchema,
    result: Type.Union([
      Type.Literal("created"),
      Type.Literal("published"),
      Type.Literal("mapped"),
      Type.Literal("replayed"),
    ]),
  },
  {
    additionalProperties: false,
    $id: "kanvas.canonical-model-mutation-result.v1",
  },
);

export const ProviderModelsImportedSchema = Type.Object(
  {
    models: Type.Array(
      Type.Object(
        {
          id: UlidSchema,
          upstreamModelId: Type.String({ minLength: 1, maxLength: 512 }),
          lifecycle: Type.Union([
            Type.Literal("discovered"),
            Type.Literal("mapped"),
            Type.Literal("active"),
            Type.Literal("disabled"),
            Type.Literal("removed"),
          ]),
          version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 2_000 },
    ),
    created: Type.Integer({ minimum: 0, maximum: 2_000 }),
    refreshed: Type.Integer({ minimum: 0, maximum: 2_000 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.provider-models-imported.v1",
  },
);

export const ProviderModelCatalogSchema = Type.Object(
  {
    models: Type.Array(
      Type.Object(
        {
          upstreamModelId: Type.String({ minLength: 1, maxLength: 512 }),
          displayName: Type.String({ minLength: 1, maxLength: 160 }),
          description: Type.Optional(
            Type.String({ minLength: 1, maxLength: 10_000 }),
          ),
          inputModalities: Type.Array(
            Type.Union([
              Type.Literal("text"),
              Type.Literal("image"),
              Type.Literal("mask"),
            ]),
            { maxItems: 3 },
          ),
          outputModalities: Type.Array(
            Type.Union([
              Type.Literal("text"),
              Type.Literal("image"),
              Type.Literal("mask"),
            ]),
            { maxItems: 3 },
          ),
          completeness: Type.Union([
            Type.Literal("identity_only"),
            Type.Literal("partial"),
            Type.Literal("complete"),
          ]),
          suggestedCanonicalSlug: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 160,
              pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]*$",
            }),
          ),
          suggestionSource: Type.Optional(
            Type.Union([Type.Literal("models_dev"), Type.Literal("provider")]),
          ),
          imported: Type.Optional(
            Type.Object(
              {
                id: UlidSchema,
                canonicalModelId: Type.Optional(UlidSchema),
                lifecycle: Type.Union([
                  Type.Literal("discovered"),
                  Type.Literal("mapped"),
                  Type.Literal("active"),
                  Type.Literal("disabled"),
                  Type.Literal("removed"),
                ]),
                version: Type.Integer({
                  minimum: 1,
                  maximum: 4_294_967_295,
                }),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 2_000 },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.provider-model-catalog.v1",
  },
);

export const ModelReferenceSearchQuerySchema = Type.Object(
  {
    q: Type.Optional(Type.String({ maxLength: 160 })),
  },
  {
    additionalProperties: false,
    $id: "kanvas.model-reference-search-query.v1",
  },
);

const ModelReferenceCostSchema = Type.Object(
  {
    input: Type.Number({ minimum: 0 }),
    output: Type.Number({ minimum: 0 }),
    cacheRead: Type.Optional(Type.Number({ minimum: 0 })),
    cacheWrite: Type.Optional(Type.Number({ minimum: 0 })),
    reasoning: Type.Optional(Type.Number({ minimum: 0 })),
    inputAudio: Type.Optional(Type.Number({ minimum: 0 })),
    outputAudio: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const ModelReferenceSearchResultSchema = Type.Object(
  {
    models: Type.Array(
      Type.Object(
        {
          key: Type.String({ minLength: 1, maxLength: 160 }),
          displayName: Type.String({ minLength: 1, maxLength: 160 }),
          description: Type.String({ minLength: 1, maxLength: 10_000 }),
          family: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
          attachment: Type.Optional(Type.Boolean()),
          reasoning: Type.Optional(Type.Boolean()),
          toolCall: Type.Optional(Type.Boolean()),
          structuredOutput: Type.Optional(Type.Boolean()),
          temperature: Type.Optional(Type.Boolean()),
          inputModalities: Type.Array(ModelProfileModalitySchema, {
            maxItems: 5,
          }),
          outputModalities: Type.Array(ModelProfileModalitySchema, {
            maxItems: 5,
          }),
          contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
          maximumInputTokens: Type.Optional(Type.Integer({ minimum: 1 })),
          maximumOutputTokens: Type.Optional(Type.Integer({ minimum: 1 })),
          providers: Type.Array(
            Type.Object(
              {
                providerSlug: Type.String({ minLength: 1, maxLength: 160 }),
                providerName: Type.String({ minLength: 1, maxLength: 160 }),
                upstreamModelId: Type.String({ minLength: 1, maxLength: 512 }),
                cost: Type.Optional(ModelReferenceCostSchema),
              },
              { additionalProperties: false },
            ),
            { maxItems: 1_000 },
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 50 },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.model-reference-search-result.v1",
  },
);

export const SyncModelReferenceBodySchema = Type.Object(
  {
    providerModelId: UlidSchema,
    force: Type.Optional(Type.Boolean()),
  },
  {
    additionalProperties: false,
    $id: "kanvas.sync-model-reference-body.v1",
  },
);

export const ModelReferenceDefaultsSchema = Type.Object(
  {
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    family: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    description: Type.Optional(
      Type.String({ minLength: 1, maxLength: 10_000 }),
    ),
    inputModalities: Type.Optional(
      Type.Array(ModelProfileModalitySchema, { maxItems: 5 }),
    ),
    outputModalities: Type.Optional(
      Type.Array(ModelProfileModalitySchema, { maxItems: 5 }),
    ),
    contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
    maximumInputTokens: Type.Optional(Type.Integer({ minimum: 1 })),
    maximumOutputTokens: Type.Optional(Type.Integer({ minimum: 1 })),
    attachment: Type.Optional(Type.Boolean()),
    reasoning: Type.Optional(Type.Boolean()),
    toolCall: Type.Optional(Type.Boolean()),
    structuredOutput: Type.Optional(Type.Boolean()),
    temperature: Type.Optional(Type.Boolean()),
    cost: Type.Optional(ModelReferenceCostSchema),
  },
  { additionalProperties: false },
);

export const ModelReferenceSyncResultSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal("resolved"),
      Type.Literal("partial"),
      Type.Literal("not_found"),
    ]),
    stale: Type.Boolean(),
    sourceRevision: Type.Optional(
      Type.String({ minLength: 1, maxLength: 160 }),
    ),
    observedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
    metadataSource: Type.Optional(
      Type.String({ minLength: 1, maxLength: 256 }),
    ),
    pricingSource: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    warnings: Type.Array(
      Type.Union([
        Type.Literal("stale_snapshot"),
        Type.Literal("metadata_conflict"),
        Type.Literal("pricing_conflict"),
      ]),
      { maxItems: 3, uniqueItems: true },
    ),
    defaults: Type.Optional(ModelReferenceDefaultsSchema),
  },
  {
    additionalProperties: false,
    $id: "kanvas.model-reference-sync-result.v1",
  },
);

export const RefreshProviderModelCatalogBodySchema = Type.Object(
  {
    ...ProviderSettingVersionBodySchema.properties,
  },
  {
    additionalProperties: false,
    $id: "kanvas.refresh-provider-model-catalog-body.v1",
  },
);

export const ValidateProviderSettingBodySchema = Type.Object(
  {
    ...ProviderSettingVersionBodySchema.properties,
    apiKey: Type.String({
      minLength: 1,
      maxLength: 65_536,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.validate-provider-setting-body.v1",
  },
);

export const RotateProviderSettingSecretBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    apiKey: Type.String({
      minLength: 1,
      maxLength: 65_536,
    }),
    mode: Type.Optional(
      Type.Union([
        Type.Literal("graceful"),
        Type.Literal("revoke_immediately"),
      ]),
    ),
  },
  {
    additionalProperties: false,
  },
);

export const RenameProviderSettingBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.rename-provider-setting-body.v1",
  },
);
export type RenameProviderSettingBody = Static<
  typeof RenameProviderSettingBodySchema
>;

export const ProviderSettingMutationResultSchema = Type.Object(
  {
    provider: ProviderSettingSummarySchema,
    result: Type.Union([
      Type.Literal("renamed"),
      Type.Literal("validated"),
      Type.Literal("activated"),
      Type.Literal("rotated"),
      Type.Literal("disabled"),
      Type.Literal("deleted"),
      Type.Literal("replayed"),
    ]),
  },
  {
    additionalProperties: false,
    $id: "kanvas.provider-setting-mutation-result.v1",
  },
);

export const ProviderModelCatalogRefreshResultSchema = Type.Object(
  {
    provider: ProviderSettingSummarySchema,
    result: Type.Union([Type.Literal("refreshed"), Type.Literal("replayed")]),
    changesPendingReview: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.provider-model-catalog-refresh-result.v1",
  },
);

const ProviderModelCatalogChangeSchema = Type.Union([
  Type.Literal("unchanged"),
  Type.Literal("added"),
  Type.Literal("removed"),
  Type.Literal("changed"),
]);

const ProviderModelCatalogRevisionReferenceSchema = Type.Object(
  {
    snapshotId: UlidSchema,
    revision: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    canonicalDigest: Type.String({
      pattern: "^sha256:[0-9a-f]{64}$",
    }),
    sourceDigest: Type.String({
      pattern: "^sha256:[0-9a-f]{64}$",
    }),
  },
  { additionalProperties: false },
);

const ProviderModelCatalogParameterDiffSchema = Type.Object(
  {
    key: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[a-zA-Z][a-zA-Z0-9]*$",
    }),
    change: ProviderModelCatalogChangeSchema,
    changedFields: Type.Array(
      Type.Union([
        Type.Literal("valueType"),
        Type.Literal("required"),
        Type.Literal("values"),
        Type.Literal("minimum"),
        Type.Literal("maximum"),
        Type.Literal("step"),
        Type.Literal("maxLength"),
      ]),
      { maxItems: 7, uniqueItems: true },
    ),
    before: Type.Optional(ProviderModelParameterDefinitionSchema),
    after: Type.Optional(ProviderModelParameterDefinitionSchema),
  },
  { additionalProperties: false },
);

const ProviderModelCatalogOperationDiffSchema = Type.Object(
  {
    capabilityKey: ProviderModelCapabilityKeySchema,
    change: ProviderModelCatalogChangeSchema,
    apiSurfaces: Type.Object(
      {
        added: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
          maxItems: 16,
          uniqueItems: true,
        }),
        removed: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
          maxItems: 16,
          uniqueItems: true,
        }),
      },
      { additionalProperties: false },
    ),
    parameters: Type.Array(ProviderModelCatalogParameterDiffSchema, {
      maxItems: 128,
    }),
  },
  { additionalProperties: false },
);

const ProviderModelCatalogBlockerCodeSchema = Type.Union([
  Type.Literal("not_activated"),
  Type.Literal("no_pending_changes"),
  Type.Literal("selected_model_removed"),
  Type.Literal("selected_model_identity_only"),
  Type.Literal("selected_model_no_image_output"),
  Type.Literal("selected_model_no_image_operation"),
  Type.Literal("selected_model_operation_removed"),
  Type.Literal("selected_model_unsupported_route"),
]);

const ProviderModelCatalogBlockerSchema = Type.Object(
  {
    code: ProviderModelCatalogBlockerCodeSchema,
    providerModelId: Type.Optional(
      Type.String({ minLength: 1, maxLength: 512 }),
    ),
    capabilityKey: Type.Optional(ProviderModelCapabilityKeySchema),
    apiSurface: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  },
  { additionalProperties: false },
);

const ProviderModelCatalogSelectedModelDiffSchema = Type.Object(
  {
    providerModelId: Type.String({
      minLength: 1,
      maxLength: 512,
    }),
    change: ProviderModelCatalogChangeSchema,
    displayName: Type.Object(
      {
        before: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
        after: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
      },
      { additionalProperties: false },
    ),
    completeness: Type.Object(
      {
        before: Type.Optional(
          Type.Union([
            Type.Literal("identity_only"),
            Type.Literal("partial"),
            Type.Literal("complete"),
          ]),
        ),
        after: Type.Optional(
          Type.Union([
            Type.Literal("identity_only"),
            Type.Literal("partial"),
            Type.Literal("complete"),
          ]),
        ),
      },
      { additionalProperties: false },
    ),
    inputModalities: Type.Object(
      {
        added: Type.Array(
          Type.Union([
            Type.Literal("text"),
            Type.Literal("image"),
            Type.Literal("mask"),
          ]),
          { maxItems: 3, uniqueItems: true },
        ),
        removed: Type.Array(
          Type.Union([
            Type.Literal("text"),
            Type.Literal("image"),
            Type.Literal("mask"),
          ]),
          { maxItems: 3, uniqueItems: true },
        ),
      },
      { additionalProperties: false },
    ),
    outputModalities: Type.Object(
      {
        added: Type.Array(
          Type.Union([
            Type.Literal("text"),
            Type.Literal("image"),
            Type.Literal("mask"),
          ]),
          { maxItems: 3, uniqueItems: true },
        ),
        removed: Type.Array(
          Type.Union([
            Type.Literal("text"),
            Type.Literal("image"),
            Type.Literal("mask"),
          ]),
          { maxItems: 3, uniqueItems: true },
        ),
      },
      { additionalProperties: false },
    ),
    operations: Type.Array(ProviderModelCatalogOperationDiffSchema, {
      maxItems: 2,
    }),
    blockers: Type.Array(ProviderModelCatalogBlockerSchema, { maxItems: 64 }),
  },
  { additionalProperties: false },
);

export const ProviderModelCatalogReviewSchema = Type.Object(
  {
    providerSettingId: UlidSchema,
    version: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    current: ProviderModelCatalogRevisionReferenceSchema,
    activated: Type.Optional(ProviderModelCatalogRevisionReferenceSchema),
    selectedModels: Type.Array(ProviderModelCatalogSelectedModelDiffSchema, {
      minItems: 1,
      maxItems: 32,
    }),
    blockers: Type.Array(ProviderModelCatalogBlockerSchema, {
      maxItems: 128,
    }),
    canAdopt: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.provider-model-catalog-review.v1",
  },
);

export const AdoptProviderModelCatalogBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    currentRevision: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    activatedRevision: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.adopt-provider-model-catalog-body.v1",
  },
);

export const ProviderModelCatalogAdoptionResultSchema = Type.Object(
  {
    provider: ProviderSettingSummarySchema,
    result: Type.Union([Type.Literal("adopted"), Type.Literal("replayed")]),
    adoptedRevision: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.provider-model-catalog-adoption-result.v1",
  },
);

export type ProviderSettingPreset = Static<typeof ProviderSettingPresetSchema>;
export type ProviderSettingSummary = Static<
  typeof ProviderSettingSummarySchema
>;
export type WorkspaceProviderSettings = Static<
  typeof WorkspaceProviderSettingsSchema
>;
export type WorkspaceBudgetSummary = Static<
  typeof WorkspaceBudgetSummarySchema
>;
export type UpdateWorkspaceBudgetBody = Static<
  typeof UpdateWorkspaceBudgetBodySchema
>;
export type WorkspaceBudgetMutationResult = Static<
  typeof WorkspaceBudgetMutationResultSchema
>;
export type WorkspaceUnknownBudgetHold = Static<
  typeof WorkspaceUnknownBudgetHoldSchema
>;
export type WorkspaceUsageSummary = Static<typeof WorkspaceUsageSummarySchema>;
export type ResolveUnknownBudgetHoldBody = Static<
  typeof ResolveUnknownBudgetHoldBodySchema
>;
export type UnknownBudgetHoldResolution = Static<
  typeof UnknownBudgetHoldResolutionSchema
>;
export type WorkspaceGeneralSettings = Static<
  typeof WorkspaceGeneralSettingsSchema
>;
export type RenameWorkspaceBody = Static<typeof RenameWorkspaceBodySchema>;
export type CapabilityBindingAvailabilityReason = Static<
  typeof CapabilityBindingAvailabilityReasonSchema
>;
export type CapabilityBindingSummary = Static<
  typeof CapabilityBindingSummarySchema
>;
export type SetCapabilityBindingStatusBody = Static<
  typeof SetCapabilityBindingStatusBodySchema
>;
export type MoveCapabilityBindingBody = Static<
  typeof MoveCapabilityBindingBodySchema
>;
export type CapabilityBindingMutationResult = Static<
  typeof CapabilityBindingMutationResultSchema
>;
export type ProviderExecutionRouteSummary = Static<
  typeof ProviderExecutionRouteSummarySchema
>;
export type ProviderModelCapabilityKey = Static<
  typeof ProviderModelCapabilityKeySchema
>;
export type ProviderModelParameterDefinition = Static<
  typeof ProviderModelParameterDefinitionSchema
>;
export type ProviderModelParameterPolicy = Static<
  typeof ProviderModelParameterPolicySchema
>;
export type ProviderModelParameterPolicies = Static<
  typeof ProviderModelParameterPoliciesSchema
>;
export type CreateProviderSettingBody = Static<
  typeof CreateProviderSettingBodySchema
>;
export type DiscoverProviderModelsBody = Static<
  typeof DiscoverProviderModelsBodySchema
>;
export type ProviderModelDiscoveryResult = Static<
  typeof ProviderModelDiscoveryResultSchema
>;
export type ProviderSettingCreated = Static<
  typeof ProviderSettingCreatedSchema
>;
export type ProviderSettingVersionBody = Static<
  typeof ProviderSettingVersionBodySchema
>;
export type ProviderModelPricingConfiguration = Static<
  typeof ProviderModelPricingConfigurationSchema
>;
export type ActivateProviderSettingBody = Static<
  typeof ActivateProviderSettingBodySchema
>;
export type CanonicalModelSourceKind = Static<
  typeof CanonicalModelSourceKindSchema
>;
export type ModelOperationKey = Static<typeof ModelOperationKeySchema>;
export type ModelParameterInput = Static<typeof ModelParameterInputSchema>;
export type CreateCanonicalModelBody = Static<
  typeof CreateCanonicalModelBodySchema
>;
export type PublishCanonicalModelBody = Static<
  typeof PublishCanonicalModelBodySchema
>;
export type ImportProviderModelsBody = Static<
  typeof ImportProviderModelsBodySchema
>;
export type MapProviderModelBody = Static<typeof MapProviderModelBodySchema>;
export type PublishProviderModelBody = Static<
  typeof PublishProviderModelBodySchema
>;
export type ProviderAgentTextTransport = Static<
  typeof ProviderAgentTextTransportSchema
>;
export type CanonicalModelSummary = Static<typeof CanonicalModelSummarySchema>;
export type WorkspaceModels = Static<typeof WorkspaceModelsSchema>;
export type CanonicalModelMutationResult = Static<
  typeof CanonicalModelMutationResultSchema
>;
export type ProviderModelsImported = Static<
  typeof ProviderModelsImportedSchema
>;
export type ProviderModelCatalog = Static<typeof ProviderModelCatalogSchema>;
export type ModelReferenceSearchQuery = Static<
  typeof ModelReferenceSearchQuerySchema
>;
export type ModelReferenceSearchResult = Static<
  typeof ModelReferenceSearchResultSchema
>;
export type SyncModelReferenceBody = Static<
  typeof SyncModelReferenceBodySchema
>;
export type ModelReferenceDefaults = Static<
  typeof ModelReferenceDefaultsSchema
>;
export type ModelReferenceSyncResult = Static<
  typeof ModelReferenceSyncResultSchema
>;
export type RefreshProviderModelCatalogBody = Static<
  typeof RefreshProviderModelCatalogBodySchema
>;
export type RotateProviderSettingSecretBody = Static<
  typeof RotateProviderSettingSecretBodySchema
>;
export type ValidateProviderSettingBody = Static<
  typeof ValidateProviderSettingBodySchema
>;
export type ProviderSettingMutationResult = Static<
  typeof ProviderSettingMutationResultSchema
>;
export type ProviderModelCatalogRefreshResult = Static<
  typeof ProviderModelCatalogRefreshResultSchema
>;
export type ProviderModelCatalogReview = Static<
  typeof ProviderModelCatalogReviewSchema
>;
export type AdoptProviderModelCatalogBody = Static<
  typeof AdoptProviderModelCatalogBodySchema
>;
export type ProviderModelCatalogAdoptionResult = Static<
  typeof ProviderModelCatalogAdoptionResultSchema
>;

export const ValidateWorkflowTopologyBodySchema = WorkflowTopologySchema;
export const ValidateWorkflowTopologyResponseSchema =
  ValidateWorkflowTopologyResultSchema;

export const WorkflowPresentationSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    category: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    tags: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      maxItems: 20,
      uniqueItems: true,
    }),
    cover: Type.Optional(
      Type.Object(
        {
          artifactId: UlidSchema,
          alt: Type.String({ minLength: 1, maxLength: 500 }),
        },
        { additionalProperties: false },
      ),
    ),
    availability: Type.Object(
      {
        standalone: Type.Boolean(),
        canvas: Type.Boolean(),
        directLink: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-presentation.v1",
  },
);

export const WorkflowAuthoringDocumentSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    topology: WorkflowTopologyV1Schema,
    inputSchema: Type.Record(Type.String(), Type.Unknown()),
    outputSchema: Type.Record(Type.String(), Type.Unknown()),
    presentation: Type.Optional(WorkflowPresentationSchema),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-authoring-document.v1",
  },
);

export const WorkflowDefinitionPathSchema = Type.Object(
  {
    workflowDefinitionId: UlidSchema,
  },
  { additionalProperties: false },
);

export const WorkflowDraftPathSchema = Type.Object(
  {
    workflowDefinitionId: UlidSchema,
    workflowDraftId: UlidSchema,
  },
  { additionalProperties: false },
);

export const WorkflowDefinitionListQuerySchema = Type.Object(
  {
    includeArchived: Type.Optional(
      Type.Union([Type.Literal("true"), Type.Literal("false")]),
    ),
    limit: Type.Optional(
      Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|100)$" }),
    ),
  },
  { additionalProperties: false },
);

export const WorkflowDefinitionSummarySchema = Type.Object(
  {
    id: UlidSchema,
    workspaceId: UlidSchema,
    workflowKey: Type.String({ minLength: 1, maxLength: 160 }),
    displayName: Type.String({ minLength: 1, maxLength: 240 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    category: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    lifecycleStatus: Type.Union([
      Type.Literal("active"),
      Type.Literal("archived"),
    ]),
    version: Type.Integer({ minimum: 1 }),
    draft: Type.Optional(
      Type.Object(
        {
          id: UlidSchema,
          version: Type.Integer({ minimum: 1 }),
          lifecycleStatus: Type.Union([
            Type.Literal("active"),
            Type.Literal("archived"),
          ]),
          updatedAt: IsoDateTimeSchema,
        },
        { additionalProperties: false },
      ),
    ),
    latestRevision: Type.Optional(
      Type.Object(
        {
          id: UlidSchema,
          revision: Type.Integer({ minimum: 1 }),
          lifecycleStatus: Type.String({
            minLength: 1,
            maxLength: 40,
          }),
          runtimeStatus: Type.Optional(
            Type.String({ minLength: 1, maxLength: 40 }),
          ),
          publishedAt: Type.Optional(IsoDateTimeSchema),
        },
        { additionalProperties: false },
      ),
    ),
    createdByPrincipalId: UlidSchema,
    updatedByPrincipalId: UlidSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-definition-summary.v1",
  },
);

export const WorkflowDefinitionListSchema = Type.Object(
  {
    items: Type.Array(WorkflowDefinitionSummarySchema, {
      maxItems: 100,
    }),
    truncated: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-definition-list.v1",
  },
);

export const WorkflowCapabilitySemanticTypeSchema = Type.String({
  minLength: 3,
  maxLength: 160,
  pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$",
});

export const WorkflowCapabilityExposureSchema = Type.Union([
  Type.Literal("installation"),
  Type.Literal("workflow_author"),
  Type.Literal("template_input"),
  Type.Literal("hidden_derived"),
]);

export const WorkflowCapabilitySourceModeSchema = Type.Union([
  Type.Literal("constant"),
  Type.Literal("canvas_selection"),
  Type.Literal("workflow_input"),
  Type.Literal("upstream"),
  Type.Literal("mixed_rich_text"),
  Type.Literal("derived"),
]);

export const WorkflowCapabilityEditorSchema = Type.Union([
  Type.Literal("text"),
  Type.Literal("rich_prompt"),
  Type.Literal("enum"),
  Type.Literal("number"),
  Type.Literal("toggle"),
  Type.Literal("artifact_picker"),
  Type.Literal("artifact_list_picker"),
  Type.Literal("canvas_size"),
  Type.Literal("placement"),
  Type.Literal("background_source"),
  Type.Literal("region_list"),
  Type.Literal("json"),
]);

export const WorkflowCapabilityLocalizedTextSchema = Type.Object(
  {
    "zh-CN": Type.String({ minLength: 1, maxLength: 1000 }),
    "en-US": Type.String({ minLength: 1, maxLength: 1000 }),
  },
  { additionalProperties: false },
);

export const WorkflowCapabilityParameterDeclarationSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 160 }),
    label: WorkflowCapabilityLocalizedTextSchema,
    description: Type.Optional(WorkflowCapabilityLocalizedTextSchema),
    semanticType: WorkflowCapabilitySemanticTypeSchema,
    required: Type.Boolean(),
    exposurePolicy: Type.Object(
      {
        allowed: Type.Array(WorkflowCapabilityExposureSchema, {
          minItems: 1,
          maxItems: 4,
          uniqueItems: true,
        }),
        default: WorkflowCapabilityExposureSchema,
      },
      { additionalProperties: false },
    ),
    sourcePolicy: Type.Object(
      {
        allowed: Type.Array(WorkflowCapabilitySourceModeSchema, {
          minItems: 1,
          maxItems: 5,
          uniqueItems: true,
        }),
        default: WorkflowCapabilitySourceModeSchema,
      },
      { additionalProperties: false },
    ),
    editor: WorkflowCapabilityEditorSchema,
    defaultValue: Type.Optional(Type.Ref(WorkflowJsonValueSchema)),
    derivation: Type.Optional(
      Type.Object(
        {
          kind: Type.Literal("same_bundle_role"),
          fromParameter: Type.String({ minLength: 1, maxLength: 160 }),
          role: Type.String({ minLength: 1, maxLength: 80 }),
          optional: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const WorkflowCapabilityOutputDeclarationSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 160 }),
    label: WorkflowCapabilityLocalizedTextSchema,
    description: Type.Optional(WorkflowCapabilityLocalizedTextSchema),
    semanticType: WorkflowCapabilitySemanticTypeSchema,
    primary: Type.Boolean(),
    visibility: Type.Union([
      Type.Literal("author"),
      Type.Literal("advanced"),
      Type.Literal("hidden"),
    ]),
    bundle: Type.Optional(
      Type.Object(
        {
          key: Type.String({ minLength: 1, maxLength: 80 }),
          role: Type.String({ minLength: 1, maxLength: 80 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const WorkflowCapabilityAuthoringDeclarationSchema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.capability-declaration/v1"),
    origin: Type.Literal("declared"),
    catalog: Type.Object(
      {
        title: WorkflowCapabilityLocalizedTextSchema,
        description: Type.Optional(WorkflowCapabilityLocalizedTextSchema),
        category: WorkflowCapabilityLocalizedTextSchema,
        sourceKind: Type.Union([
          Type.Literal("custom"),
          Type.Literal("built_in"),
          Type.Literal("plugin"),
          Type.Literal("workflow"),
          Type.Literal("api"),
          Type.Literal("mcp"),
        ]),
        tags: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
          maxItems: 32,
          uniqueItems: true,
        }),
        surfaces: Type.Optional(
          Type.Array(
            Type.Union([
              Type.Literal("workflow"),
              Type.Literal("agent"),
              Type.Literal("canvas"),
            ]),
            { minItems: 1, maxItems: 3, uniqueItems: true },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    parameters: Type.Array(WorkflowCapabilityParameterDeclarationSchema, {
      maxItems: 200,
    }),
    outputs: Type.Array(WorkflowCapabilityOutputDeclarationSchema, {
      maxItems: 200,
    }),
    canvas: Type.Optional(
      Type.Object(
        {
          actionGroup: Type.String({
            minLength: 3,
            maxLength: 160,
            pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$",
          }),
          interactionBehavior: Type.Union([
            Type.Literal("direct"),
            Type.Literal("form"),
          ]),
          completionBehavior: Type.Union([
            Type.Literal("auto_replace_safe"),
            Type.Literal("review_required"),
          ]),
          outputModes: Type.Array(
            Type.Union([
              Type.Literal("add_node"),
              Type.Literal("asset_only"),
              Type.Literal("fill_container"),
              Type.Literal("replace_content"),
              Type.Literal("set_background"),
            ]),
            { minItems: 1, maxItems: 5, uniqueItems: true },
          ),
          order: Type.Integer({ minimum: 0, maximum: 10_000 }),
        },
        { additionalProperties: false },
      ),
    ),
    uiProfileKey: Type.Optional(
      Type.Union([Type.Literal("background_compose")]),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-capability-authoring-declaration.v1",
  },
);

export const WorkflowAuthoringCapabilitySchema = Type.Object(
  {
    contractId: Type.String({ minLength: 1, maxLength: 160 }),
    contractKey: Type.String({ minLength: 1, maxLength: 160 }),
    revision: Type.Integer({ minimum: 1 }),
    canonicalDigest: Sha256DigestSchema,
    inputSchema: Type.Record(Type.String(), Type.Unknown()),
    outputSchema: Type.Record(Type.String(), Type.Unknown()),
    authoring: WorkflowCapabilityAuthoringDeclarationSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-authoring-capability.v1",
  },
);

export const WorkflowAuthoringCapabilityListSchema = Type.Object(
  {
    items: Type.Array(WorkflowAuthoringCapabilitySchema, {
      maxItems: 500,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-authoring-capability-list.v1",
  },
);

export const WorkflowDraftSchema = Type.Object(
  {
    definition: WorkflowDefinitionSummarySchema,
    draft: Type.Object(
      {
        id: UlidSchema,
        version: Type.Integer({ minimum: 1 }),
        lifecycleStatus: Type.Union([
          Type.Literal("active"),
          Type.Literal("archived"),
        ]),
        canonicalDigest: Sha256DigestSchema,
        document: WorkflowAuthoringDocumentSchema,
        derivedFromWorkflowRevisionId: Type.Optional(UlidSchema),
        createdByPrincipalId: UlidSchema,
        updatedByPrincipalId: UlidSchema,
        createdAt: IsoDateTimeSchema,
        updatedAt: IsoDateTimeSchema,
      },
      { additionalProperties: false },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-draft.v1",
  },
);

export const WorkflowDraftMutationResultSchema = Type.Object(
  {
    value: WorkflowDraftSchema,
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-draft-mutation-result.v1",
  },
);

export const CreateWorkflowDraftBodySchema = Type.Object(
  {
    workflowKey: Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[a-z0-9][a-z0-9._-]{0,159}$",
    }),
    displayName: Type.String({ minLength: 1, maxLength: 240 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    category: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    derivedFromWorkflowRevisionId: Type.Optional(UlidSchema),
    document: WorkflowAuthoringDocumentSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.create-workflow-draft-body.v1",
  },
);

export const UpdateWorkflowDraftBodySchema = Type.Object(
  {
    expectedDefinitionVersion: Type.Integer({ minimum: 1 }),
    expectedDraftVersion: Type.Integer({ minimum: 1 }),
    displayName: Type.String({ minLength: 1, maxLength: 240 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    category: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    document: WorkflowAuthoringDocumentSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.update-workflow-draft-body.v1",
  },
);

export const ArchiveWorkflowDraftBodySchema = Type.Object(
  {
    expectedDefinitionVersion: Type.Integer({ minimum: 1 }),
    expectedDraftVersion: Type.Integer({ minimum: 1 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.archive-workflow-draft-body.v1",
  },
);

export type WorkflowAuthoringDocument = Static<
  typeof WorkflowAuthoringDocumentSchema
>;
export type WorkflowPresentation = Static<typeof WorkflowPresentationSchema>;
export type WorkflowAuthoringCapability = Static<
  typeof WorkflowAuthoringCapabilitySchema
>;
export type WorkflowCapabilityAuthoringDeclaration = Static<
  typeof WorkflowCapabilityAuthoringDeclarationSchema
>;
export type WorkflowCapabilityParameterDeclaration = Static<
  typeof WorkflowCapabilityParameterDeclarationSchema
>;
export type WorkflowCapabilityOutputDeclaration = Static<
  typeof WorkflowCapabilityOutputDeclarationSchema
>;
export type WorkflowCapabilitySemanticType = Static<
  typeof WorkflowCapabilitySemanticTypeSchema
>;
export type WorkflowAuthoringCapabilityList = Static<
  typeof WorkflowAuthoringCapabilityListSchema
>;
export type WorkflowDefinitionList = Static<
  typeof WorkflowDefinitionListSchema
>;
export type WorkflowDefinitionListQuery = Static<
  typeof WorkflowDefinitionListQuerySchema
>;
export type WorkflowDefinitionSummary = Static<
  typeof WorkflowDefinitionSummarySchema
>;
export type WorkflowDraft = Static<typeof WorkflowDraftSchema>;
export type WorkflowDraftMutationResult = Static<
  typeof WorkflowDraftMutationResultSchema
>;
export type CreateWorkflowDraftBody = Static<
  typeof CreateWorkflowDraftBodySchema
>;
export type UpdateWorkflowDraftBody = Static<
  typeof UpdateWorkflowDraftBodySchema
>;
export type ArchiveWorkflowDraftBody = Static<
  typeof ArchiveWorkflowDraftBodySchema
>;

export const WorkflowCandidatePathSchema = Type.Object(
  {
    workflowCandidateId: UlidSchema,
  },
  { additionalProperties: false },
);

export const WorkflowCandidateListQuerySchema = Type.Object(
  {
    workflowKey: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  },
  { additionalProperties: false },
);

export const WorkflowCandidateSchema = Type.Object(
  {
    id: UlidSchema,
    workspaceId: UlidSchema,
    subjectKind: Type.Literal("workflow"),
    subjectKey: Type.String({ minLength: 1, maxLength: 160 }),
    sourceDraftId: UlidSchema,
    sourceDraftVersion: Type.Integer({ minimum: 1 }),
    schemaVersion: Type.Literal(1),
    contentDocument: WorkflowAuthoringDocumentSchema,
    canonicalDigest: Sha256DigestSchema,
    parserProfileVersion: Type.String({
      minLength: 1,
      maxLength: 80,
    }),
    createdByPrincipalId: UlidSchema,
    createdAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-candidate.v1",
  },
);

export const WorkflowCandidateListSchema = Type.Object(
  {
    items: Type.Array(WorkflowCandidateSchema, { maxItems: 100 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-candidate-list.v1",
  },
);

export const WorkflowCandidateReviewSchema = Type.Object(
  {
    candidate: WorkflowCandidateSchema,
    latestTestRunId: Type.Optional(UlidSchema),
    activeTestRunIds: Type.Optional(Type.Array(UlidSchema, { maxItems: 100 })),
    checks: Type.Array(
      Type.Object(
        {
          id: UlidSchema,
          checkKind: Type.Union([
            Type.Literal("schema"),
            Type.Literal("resources"),
            Type.Literal("security"),
            Type.Literal("compatibility"),
            Type.Literal("eval"),
          ]),
          checkProfileVersion: Type.String({
            minLength: 1,
            maxLength: 80,
          }),
          outcome: Type.Union([Type.Literal("passed"), Type.Literal("failed")]),
          evidenceSummary: Type.Record(Type.String(), Type.Unknown()),
          evidenceDigest: Sha256DigestSchema,
          checkedAt: IsoDateTimeSchema,
        },
        { additionalProperties: false },
      ),
      { maxItems: 5 },
    ),
    review: Type.Optional(
      Type.Object(
        {
          id: UlidSchema,
          decision: Type.Union([
            Type.Literal("approved"),
            Type.Literal("rejected"),
          ]),
          commentSummary: Type.Optional(
            Type.String({ minLength: 1, maxLength: 1000 }),
          ),
          reviewerPrincipalId: UlidSchema,
          decidedAt: IsoDateTimeSchema,
        },
        { additionalProperties: false },
      ),
    ),
    publishedRevision: Type.Optional(
      Type.Object(
        {
          id: UlidSchema,
          workspaceId: UlidSchema,
          subjectKind: Type.Literal("workflow"),
          subjectKey: Type.String({
            minLength: 1,
            maxLength: 160,
          }),
          revision: Type.Integer({ minimum: 1 }),
          canonicalDigest: Sha256DigestSchema,
          runtimeStatus: Type.Literal("enabled"),
          publishedAt: IsoDateTimeSchema,
        },
        { additionalProperties: false },
      ),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-candidate-review.v1",
  },
);

export const SubmitWorkflowCandidateBodySchema = Type.Object(
  {
    expectedDraftVersion: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const StartWorkflowCandidateTestBodySchema = Type.Object(
  {
    input: Type.Unknown(),
  },
  { additionalProperties: false },
);

export const RecordWorkflowCandidateEvalBodySchema = Type.Object(
  {
    workflowRunId: UlidSchema,
    expectedCandidateDigest: Sha256DigestSchema,
  },
  { additionalProperties: false },
);

export const ReviewWorkflowCandidateBodySchema = Type.Object(
  {
    expectedCandidateDigest: Sha256DigestSchema,
    decision: Type.Union([Type.Literal("approved"), Type.Literal("rejected")]),
    commentSummary: Type.Optional(
      Type.String({ minLength: 1, maxLength: 1000 }),
    ),
  },
  { additionalProperties: false },
);

export const PublishWorkflowCandidateBodySchema = Type.Object(
  {
    expectedCandidateDigest: Sha256DigestSchema,
  },
  { additionalProperties: false },
);

export type WorkflowCandidate = Static<typeof WorkflowCandidateSchema>;
export type WorkflowCandidateList = Static<typeof WorkflowCandidateListSchema>;
export type WorkflowCandidateListQuery = Static<
  typeof WorkflowCandidateListQuerySchema
>;
export type WorkflowCandidateReview = Static<
  typeof WorkflowCandidateReviewSchema
>;
export type SubmitWorkflowCandidateBody = Static<
  typeof SubmitWorkflowCandidateBodySchema
>;
export type StartWorkflowCandidateTestBody = Static<
  typeof StartWorkflowCandidateTestBodySchema
>;
export type RecordWorkflowCandidateEvalBody = Static<
  typeof RecordWorkflowCandidateEvalBodySchema
>;
export type ReviewWorkflowCandidateBody = Static<
  typeof ReviewWorkflowCandidateBodySchema
>;
export type PublishWorkflowCandidateBody = Static<
  typeof PublishWorkflowCandidateBodySchema
>;

export const WorkflowTemplatePathSchema = Type.Object(
  {
    workflowRevisionId: UlidSchema,
  },
  { additionalProperties: false },
);

export const WorkflowTemplateListQuerySchema = Type.Object(
  {
    q: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    category: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    includeUnavailable: Type.Optional(Type.Literal("true")),
  },
  { additionalProperties: false },
);

const EffectiveInvocationParameterKeySchema = Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z_][A-Za-z0-9._-]*$",
});

const EffectiveInvocationScalarValueSchema = Type.Union([
  Type.String({ minLength: 1, maxLength: 32_000 }),
  Type.Integer({
    minimum: Number.MIN_SAFE_INTEGER,
    maximum: Number.MAX_SAFE_INTEGER,
  }),
  Type.Boolean(),
]);

const EffectiveInvocationFieldCommonProperties = {
  key: EffectiveInvocationParameterKeySchema,
  label: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
  placeholder: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  required: Type.Boolean(),
};

export const EffectiveInvocationFieldSchema = Type.Union([
  Type.Object(
    {
      ...EffectiveInvocationFieldCommonProperties,
      valueType: Type.Literal("enum"),
      values: Type.Array(EffectiveInvocationScalarValueSchema, {
        minItems: 1,
        maxItems: 256,
        uniqueItems: true,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EffectiveInvocationFieldCommonProperties,
      valueType: Type.Literal("integer"),
      minimum: Type.Integer({
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER,
      }),
      maximum: Type.Integer({
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER,
      }),
      step: Type.Optional(
        Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EffectiveInvocationFieldCommonProperties,
      valueType: Type.Literal("boolean"),
      allowedValues: Type.Optional(
        Type.Array(Type.Boolean(), {
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
        }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EffectiveInvocationFieldCommonProperties,
      valueType: Type.Literal("string"),
      maxLength: Type.Integer({ minimum: 1, maximum: 32_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EffectiveInvocationFieldCommonProperties,
      valueType: Type.Literal("artifact"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EffectiveInvocationFieldCommonProperties,
      valueType: Type.Literal("artifact_list"),
      minItems: Type.Integer({ minimum: 0, maximum: 200 }),
      maxItems: Type.Integer({ minimum: 1, maximum: 200 }),
      uniqueItems: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EffectiveInvocationFieldCommonProperties,
      valueType: Type.Literal("json"),
      jsonType: Type.Union([Type.Literal("object"), Type.Literal("array")]),
      maxLength: Type.Integer({ minimum: 1, maximum: 32_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EffectiveInvocationFieldCommonProperties,
      valueType: Type.Literal("constant"),
      value: EffectiveInvocationScalarValueSchema,
    },
    { additionalProperties: false },
  ),
]);

export const EffectiveInvocationUnavailableReasonSchema = Type.Union([
  Type.Literal("route_unavailable"),
  Type.Literal("route_ambiguous"),
  Type.Literal("schema_conflict"),
  Type.Literal("unsupported_schema"),
  Type.Literal("unsupported_topology"),
  Type.Literal("workflow_unavailable"),
  Type.Literal("provider_unconfigured"),
  Type.Literal("provider_unavailable"),
  Type.Literal("credential_unavailable"),
  Type.Literal("budget_unavailable"),
  Type.Literal("permission_required"),
]);

const EffectiveInvocationSchemaCommonProperties = {
  schemaVersion: Type.Literal("kanvas.effective-invocation-schema/v1"),
  controlledParameterKeys: Type.Array(EffectiveInvocationParameterKeySchema, {
    maxItems: 64,
    uniqueItems: true,
  }),
};

export const maximumEffectiveInvocationValidationSchemaLength = 131_072;

export const EffectiveInvocationValidationSchemaSchema = Type.Object(
  {
    schemaVersion: Type.Literal(
      "kanvas.effective-invocation-validation-schema/v1",
    ),
    document: Type.String({
      minLength: 2,
      maxLength: maximumEffectiveInvocationValidationSchemaLength,
    }),
  },
  { additionalProperties: false },
);

export const EffectiveInvocationSchema = Type.Union([
  Type.Object(
    {
      ...EffectiveInvocationSchemaCommonProperties,
      availability: Type.Literal("available"),
      validationSchema: EffectiveInvocationValidationSchemaSchema,
      fields: Type.Array(EffectiveInvocationFieldSchema, {
        maxItems: 200,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EffectiveInvocationSchemaCommonProperties,
      availability: Type.Literal("unavailable"),
      reason: EffectiveInvocationUnavailableReasonSchema,
    },
    { additionalProperties: false },
  ),
]);

export const WorkflowTemplateSchema = Type.Object(
  {
    workflowDefinitionId: UlidSchema,
    workflowRevisionId: UlidSchema,
    workflowKey: Type.String({ minLength: 1, maxLength: 160 }),
    revision: Type.Integer({ minimum: 1 }),
    displayName: Type.String({ minLength: 1, maxLength: 240 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    category: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    canonicalDigest: Sha256DigestSchema,
    runtimeStatus: Type.Union([
      Type.Literal("enabled"),
      Type.Literal("disabled"),
      Type.Literal("revoked"),
    ]),
    topology: WorkflowTopologySchema,
    inputSchema: Type.Record(Type.String(), Type.Unknown()),
    outputSchema: Type.Record(Type.String(), Type.Unknown()),
    effectiveInvocationSchema: Type.Optional(EffectiveInvocationSchema),
    presentation: Type.Optional(WorkflowPresentationSchema),
    publishedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-template.v1",
  },
);

export const WorkflowTemplateListSchema = Type.Object(
  {
    items: Type.Array(WorkflowTemplateSchema, { maxItems: 200 }),
    categories: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
      maxItems: 100,
      uniqueItems: true,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-template-list.v1",
  },
);

export type WorkflowTemplate = Static<typeof WorkflowTemplateSchema>;
export type WorkflowTemplateList = Static<typeof WorkflowTemplateListSchema>;
export type WorkflowTemplateListQuery = Static<
  typeof WorkflowTemplateListQuerySchema
>;
export type EffectiveInvocationField = Static<
  typeof EffectiveInvocationFieldSchema
>;
export type EffectiveInvocationSchema = Static<
  typeof EffectiveInvocationSchema
>;
export type EffectiveInvocationValidationSchema = Static<
  typeof EffectiveInvocationValidationSchemaSchema
>;
export type EffectiveInvocationUnavailableReason = Static<
  typeof EffectiveInvocationUnavailableReasonSchema
>;

export const IdempotencyHeadersSchema = Type.Object(
  {
    "idempotency-key": Type.String({
      minLength: 1,
      maxLength: 160,
    }),
    "x-kanvas-workspace-id": UlidSchema,
    "x-kanvas-csrf": Type.Optional(
      Type.String({
        pattern: "^[A-Za-z0-9_-]{43}$",
        description:
          "Required for browser-session mutations; omitted for Service Bearer requests.",
      }),
    ),
  },
  {
    additionalProperties: true,
  },
);

export const WorkspaceScopeHeadersSchema = Type.Object(
  {
    "x-kanvas-workspace-id": UlidSchema,
  },
  {
    additionalProperties: true,
  },
);

export const WorkspaceMutationHeadersSchema = Type.Object(
  {
    "x-kanvas-workspace-id": UlidSchema,
    "x-kanvas-csrf": Type.Optional(
      Type.String({
        pattern: "^[A-Za-z0-9_-]{43}$",
        description:
          "Required for browser-session mutations; omitted for Service Bearer requests.",
      }),
    ),
  },
  {
    additionalProperties: true,
  },
);

export const CanvasBrandContextSchema = Type.Object(
  {
    brandKitId: UlidSchema,
    brandKitRevisionId: UlidSchema,
    name: Type.String({ minLength: 1, maxLength: 160 }),
    revisionNumber: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-brand-context.v1",
  },
);

const EmbeddedCanvasBrandContextSchema = Type.Object(
  {
    brandKitId: UlidSchema,
    brandKitRevisionId: UlidSchema,
    name: Type.String({ minLength: 1, maxLength: 160 }),
    revisionNumber: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
  },
  { additionalProperties: false },
);

export const CreateWorkflowRunBodySchema = Type.Object(
  {
    workflowRevisionId: UlidSchema,
    brandKitRevisionId: Type.Optional(Type.Union([UlidSchema, Type.Null()])),
    input: Type.Unknown(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.create-workflow-run-body.v1",
  },
);

export type CreateWorkflowRunBody = Static<typeof CreateWorkflowRunBodySchema>;

export const WorkflowRunLifecycleSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("waiting"),
  Type.Literal("cancelling"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

export const WorkflowRunOutcomeSchema = Type.Union([
  Type.Literal("full_success"),
  Type.Literal("partial_success"),
  Type.Literal("no_usable_output"),
  Type.Null(),
]);

export const WorkflowCancellationReasonCodeSchema = Type.Union([
  Type.Literal("user_requested"),
  Type.Literal("superseded"),
  Type.Literal("policy_denied"),
  Type.Literal("budget_exceeded"),
  Type.Literal("runtime_shutdown"),
  Type.Literal("other"),
]);

export const CancelWorkflowRunBodySchema = Type.Object(
  {
    reasonCode: Type.Optional(WorkflowCancellationReasonCodeSchema),
  },
  {
    additionalProperties: false,
    $id: "kanvas.cancel-workflow-run-body.v1",
  },
);

export type CancelWorkflowRunBody = Static<typeof CancelWorkflowRunBodySchema>;

export const WorkflowRunCancellationAcceptedSchema = Type.Object(
  {
    id: UlidSchema,
    lifecycleStatus: Type.Union([
      Type.Literal("cancelling"),
      Type.Literal("cancelled"),
    ]),
    version: Type.Integer({ minimum: 1 }),
    cancelRequestedAt: IsoDateTimeSchema,
    cancelReasonCode: WorkflowCancellationReasonCodeSchema,
    cancelDeadlineAt: IsoDateTimeSchema,
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-run-cancellation-accepted.v1",
  },
);

export type WorkflowRunCancellationAccepted = Static<
  typeof WorkflowRunCancellationAcceptedSchema
>;

export const WorkflowRunAcceptedSchema = Type.Object(
  {
    id: UlidSchema,
    brand: Type.Optional(CanvasBrandContextSchema),
    definitionKind: Type.Union([
      Type.Literal("published_revision"),
      Type.Literal("publication_candidate"),
    ]),
    workflowRevisionId: Type.Optional(UlidSchema),
    publicationCandidateId: Type.Optional(UlidSchema),
    nonProduction: Type.Boolean(),
    lifecycleStatus: WorkflowRunLifecycleSchema,
    outcome: WorkflowRunOutcomeSchema,
    executionDeadlineAt: Type.Optional(IsoDateTimeSchema),
    createdAt: IsoDateTimeSchema,
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-run-accepted.v1",
  },
);

export type WorkflowRunAccepted = Static<typeof WorkflowRunAcceptedSchema>;

export const WorkflowRunPathSchema = Type.Object(
  {
    workflowRunId: UlidSchema,
  },
  {
    additionalProperties: false,
  },
);

export const WorkflowRunDetailsSchema = Type.Object(
  {
    id: UlidSchema,
    pendingApprovals: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: UlidSchema,
            nodeRunId: UlidSchema,
            nodeKey: Type.String({ minLength: 1, maxLength: 100 }),
            title: Type.Optional(Type.String({ maxLength: 500 })),
            message: Type.Optional(Type.String({ maxLength: 8000 })),
            decisionSchema: Type.Record(Type.String(), Type.Unknown(), {
              maxProperties: 200,
            }),
            expiresAt: IsoDateTimeSchema,
          },
          { additionalProperties: false },
        ),
        { maxItems: 500 },
      ),
    ),
    browserExecution: Type.Optional(BrowserExecutionRequirementSchema),
    brand: Type.Optional(CanvasBrandContextSchema),
    definitionKind: Type.Union([
      Type.Literal("published_revision"),
      Type.Literal("publication_candidate"),
    ]),
    workflowRevisionId: Type.Optional(UlidSchema),
    publicationCandidateId: Type.Optional(UlidSchema),
    nonProduction: Type.Boolean(),
    lifecycleStatus: WorkflowRunLifecycleSchema,
    outcome: WorkflowRunOutcomeSchema,
    version: Type.Integer({ minimum: 1 }),
    input: Type.Unknown(),
    output: Type.Unknown(),
    nodes: Type.Array(
      Type.Object(
        {
          id: UlidSchema,
          nodeKey: Type.String({ minLength: 1, maxLength: 100 }),
          scopeKey: Type.String({ minLength: 1, maxLength: 160 }),
          kind: Type.Union([
            Type.Literal("invoke"),
            Type.Literal("switch"),
            Type.Literal("map"),
            Type.Literal("approval"),
          ]),
          lifecycleStatus: Type.String({
            minLength: 1,
            maxLength: 24,
          }),
          waitingReason: Type.Optional(
            Type.String({ minLength: 1, maxLength: 32 }),
          ),
          output: Type.Unknown(),
          error: Type.Unknown(),
          createdAt: IsoDateTimeSchema,
          updatedAt: IsoDateTimeSchema,
          completedAt: Type.Optional(IsoDateTimeSchema),
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
    executionDeadlineAt: Type.Optional(IsoDateTimeSchema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    completedAt: Type.Optional(IsoDateTimeSchema),
    cancelRequestedAt: Type.Optional(IsoDateTimeSchema),
    cancelReasonCode: Type.Optional(WorkflowCancellationReasonCodeSchema),
    cancelDeadlineAt: Type.Optional(IsoDateTimeSchema),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-run-details.v1",
  },
);

export type WorkflowRunDetails = Static<typeof WorkflowRunDetailsSchema>;

export const DecideWorkflowApprovalBodySchema = Type.Object(
  {
    approvalRequestId: UlidSchema,
    decision: Type.Record(Type.String(), Type.Unknown(), {
      minProperties: 1,
      maxProperties: 200,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.decide-workflow-approval-body.v1",
  },
);

export const WorkflowApprovalDecisionResultSchema = Type.Object(
  {
    workflowRunId: UlidSchema,
    approvalRequestId: UlidSchema,
    decisionId: UlidSchema,
    result: Type.Union([Type.Literal("recorded"), Type.Literal("replayed")]),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-approval-decision-result.v1",
  },
);

export type DecideWorkflowApprovalBody = Static<
  typeof DecideWorkflowApprovalBodySchema
>;
export type WorkflowApprovalDecisionResult = Static<
  typeof WorkflowApprovalDecisionResultSchema
>;

export const WorkflowRunListStateSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("completed"),
  Type.Literal("unfinished"),
]);

export const WorkflowRunListQuerySchema = Type.Object(
  {
    workflowRevisionId: Type.Optional(UlidSchema),
    state: Type.Optional(WorkflowRunListStateSchema),
    cursor: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 512,
        pattern: "^[A-Za-z0-9_-]+$",
      }),
    ),
    limit: Type.Optional(
      Type.String({
        pattern: "^(?:[1-9]|[1-3][0-9]|40)$",
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-run-list-query.v1",
  },
);

export const WorkflowRunSummarySchema = Type.Object(
  {
    id: UlidSchema,
    brand: Type.Optional(CanvasBrandContextSchema),
    workflowRevisionId: UlidSchema,
    displayName: Type.String({ minLength: 1, maxLength: 240 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    lifecycleStatus: WorkflowRunLifecycleSchema,
    outcome: WorkflowRunOutcomeSchema,
    output: Type.Unknown(),
    createdAt: IsoDateTimeSchema,
    completedAt: Type.Optional(IsoDateTimeSchema),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-run-summary.v1",
  },
);

export const WorkflowRunListSchema = Type.Object(
  {
    items: Type.Array(WorkflowRunSummarySchema, { maxItems: 40 }),
    nextCursor: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 512,
        pattern: "^[A-Za-z0-9_-]+$",
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-run-list.v1",
  },
);

export type WorkflowRunListQuery = Static<typeof WorkflowRunListQuerySchema>;
export type WorkflowRunListState = Static<typeof WorkflowRunListStateSchema>;
export type WorkflowRunSummary = Static<typeof WorkflowRunSummarySchema>;
export type WorkflowRunList = Static<typeof WorkflowRunListSchema>;

export const WorkspaceAssetSummarySchema = Type.Object(
  {
    id: UlidSchema,
    assetKey: Type.String({ minLength: 1, maxLength: 160 }),
    name: Type.String({ minLength: 1, maxLength: 240 }),
    assetType: Type.String({ minLength: 1, maxLength: 120 }),
    lifecycleStatus: Type.Union([
      Type.Literal("active"),
      Type.Literal("archived"),
    ]),
    currentArtifact: Type.Optional(
      Type.Object(
        {
          id: UlidSchema,
          artifactType: Type.String({
            minLength: 1,
            maxLength: 120,
          }),
          displayFilename: Type.Optional(
            Type.String({ minLength: 1, maxLength: 255 }),
          ),
          mediaType: Type.Optional(
            Type.String({ minLength: 1, maxLength: 160 }),
          ),
          byteSize: Type.Optional(
            Type.String({ pattern: "^(0|[1-9][0-9]*)$" }),
          ),
          availabilityStatus: Type.String({
            minLength: 1,
            maxLength: 24,
          }),
          dataClassification: Type.String({
            minLength: 1,
            maxLength: 24,
          }),
          brand: Type.Optional(EmbeddedCanvasBrandContextSchema),
          createdAt: IsoDateTimeSchema,
        },
        { additionalProperties: false },
      ),
    ),
    version: Type.Integer({ minimum: 1 }),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-asset-summary.v1",
  },
);

export const WorkspaceAssetPathSchema = Type.Object(
  {
    assetId: UlidSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-asset-path.v1",
  },
);

export const WorkspaceAssetArtifactOriginSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("canvas_export"),
      canvasDraftId: UlidSchema,
      documentVersion: Type.Integer({ minimum: 1 }),
      pageId: Type.String({ minLength: 1, maxLength: 160 }),
      format: Type.Union([
        Type.Literal("png"),
        Type.Literal("jpeg"),
        Type.Literal("webp"),
      ]),
      width: Type.Integer({ minimum: 1, maximum: 32_768 }),
      height: Type.Integer({ minimum: 1, maximum: 32_768 }),
      transparentBackground: Type.Boolean(),
      sourceArtifactCount: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("capability_result"),
      capabilityRunId: UlidSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("user_import"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("unknown"),
    },
    { additionalProperties: false },
  ),
]);

export const WorkspaceAssetArtifactDetailSchema = Type.Object(
  {
    id: UlidSchema,
    artifactType: Type.String({
      minLength: 1,
      maxLength: 120,
    }),
    displayFilename: Type.Optional(
      Type.String({ minLength: 1, maxLength: 255 }),
    ),
    mediaType: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    byteSize: Type.Optional(Type.String({ pattern: "^(0|[1-9][0-9]*)$" })),
    availabilityStatus: Type.String({
      minLength: 1,
      maxLength: 24,
    }),
    dataClassification: Type.String({
      minLength: 1,
      maxLength: 24,
    }),
    isCurrent: Type.Boolean(),
    brand: Type.Optional(EmbeddedCanvasBrandContextSchema),
    origin: WorkspaceAssetArtifactOriginSchema,
    createdAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
  },
);

export const WorkspaceAssetLineageItemSchema = Type.Object(
  {
    direction: Type.Union([Type.Literal("input"), Type.Literal("output")]),
    relation: Type.Union([
      Type.Literal("derived_from"),
      Type.Literal("supersedes"),
      Type.Literal("composed_from"),
      Type.Literal("generated_from"),
    ]),
    artifact: Type.Object(
      {
        id: UlidSchema,
        artifactType: Type.String({
          minLength: 1,
          maxLength: 120,
        }),
        displayFilename: Type.Optional(
          Type.String({ minLength: 1, maxLength: 255 }),
        ),
        mediaType: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
        createdAt: IsoDateTimeSchema,
      },
      { additionalProperties: false },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-asset-lineage-item.v1",
  },
);

export const WorkspaceAssetDetailSchema = Type.Object(
  {
    id: UlidSchema,
    name: Type.String({ minLength: 1, maxLength: 240 }),
    assetType: Type.String({ minLength: 1, maxLength: 120 }),
    lifecycleStatus: Type.Union([
      Type.Literal("active"),
      Type.Literal("archived"),
    ]),
    version: Type.Integer({ minimum: 1 }),
    currentArtifact: Type.Optional(WorkspaceAssetArtifactDetailSchema),
    artifacts: Type.Array(WorkspaceAssetArtifactDetailSchema, { maxItems: 20 }),
    artifactsTruncated: Type.Boolean(),
    artifactsNextCursor: Type.Optional(
      Type.String({ minLength: 1, maxLength: 512 }),
    ),
    lineage: Type.Array(WorkspaceAssetLineageItemSchema, {
      maxItems: 40,
    }),
    lineageTruncated: Type.Boolean(),
    lineageNextCursor: Type.Optional(
      Type.String({ minLength: 1, maxLength: 512 }),
    ),
    usedByBrands: Type.Array(
      Type.Object(
        {
          brandKitId: UlidSchema,
          name: Type.String({ minLength: 1, maxLength: 160 }),
          isDefault: Type.Boolean(),
          logoRole: BrandKitLogoRoleSchema,
        },
        { additionalProperties: false },
      ),
      { maxItems: 100 },
    ),
    availableActions: Type.Array(
      Type.Union([
        Type.Literal("reuse_on_canvas"),
        Type.Literal("download_current"),
        Type.Literal("download_artifacts"),
      ]),
      { maxItems: 3, uniqueItems: true },
    ),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-asset-detail.v1",
  },
);

export const WorkspaceAssetListSchema = Type.Object(
  {
    items: Type.Array(WorkspaceAssetSummarySchema, {
      maxItems: 100,
    }),
    truncated: Type.Boolean(),
    facets: Type.Optional(
      Type.Object(
        {
          assetTypes: Type.Array(
            Type.String({ minLength: 1, maxLength: 120 }),
            {
              maxItems: 100,
            },
          ),
        },
        {
          additionalProperties: false,
        },
      ),
    ),
    nextCursor: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 512,
        pattern: "^[A-Za-z0-9_-]+$",
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-asset-list.v1",
  },
);

export type WorkspaceAssetSummary = Static<typeof WorkspaceAssetSummarySchema>;
export type WorkspaceAssetArtifactDetail = Static<
  typeof WorkspaceAssetArtifactDetailSchema
>;
export type WorkspaceAssetArtifactOrigin = Static<
  typeof WorkspaceAssetArtifactOriginSchema
>;
export type WorkspaceAssetDetail = Static<typeof WorkspaceAssetDetailSchema>;

export const WorkspaceAssetDetailQuerySchema = Type.Object(
  {
    historyKind: Type.Optional(
      Type.Union([Type.Literal("artifacts"), Type.Literal("lineage")]),
    ),
    cursor: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 512,
        pattern: "^[A-Za-z0-9_-]+$",
      }),
    ),
    limit: Type.Optional(
      Type.String({
        pattern: "^(?:[1-9]|[1-3][0-9]|40)$",
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-asset-detail-query.v1",
  },
);

export type WorkspaceAssetDetailQuery = Static<
  typeof WorkspaceAssetDetailQuerySchema
>;
export type WorkspaceAssetLineageItem = Static<
  typeof WorkspaceAssetLineageItemSchema
>;

export const CreateWorkspaceAssetFromArtifactBodySchema = Type.Object(
  {
    assetId: UlidSchema,
    artifactId: UlidSchema,
    name: Type.String({ minLength: 1, maxLength: 240 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.create-workspace-asset-from-artifact-body.v1",
  },
);

export const WorkspaceAssetAdoptionSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("created"), Type.Literal("existing")]),
    assetId: UlidSchema,
    artifactId: UlidSchema,
    version: Type.Integer({ minimum: 1 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-asset-adoption.v1",
  },
);

export type CreateWorkspaceAssetFromArtifactBody = Static<
  typeof CreateWorkspaceAssetFromArtifactBodySchema
>;
export type WorkspaceAssetAdoption = Static<
  typeof WorkspaceAssetAdoptionSchema
>;

export type WorkspaceAssetList = Static<typeof WorkspaceAssetListSchema>;

export const WorkspaceAssetListQuerySchema = Type.Object(
  {
    q: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    mediaKind: Type.Optional(
      Type.Union([
        Type.Literal("image"),
        Type.Literal("video"),
        Type.Literal("audio"),
        Type.Literal("document"),
      ]),
    ),
    assetType: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    ids: Type.Optional(
      Type.String({
        minLength: 26,
        maxLength: 647,
        pattern:
          "^[0-7][0-9A-HJKMNP-TV-Z]{25}(?:,[0-7][0-9A-HJKMNP-TV-Z]{25}){0,23}$",
      }),
    ),
    lifecycleStatus: Type.Optional(
      Type.Union([Type.Literal("active"), Type.Literal("archived")]),
    ),
    cursor: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 512,
        pattern: "^[A-Za-z0-9_-]+$",
      }),
    ),
    limit: Type.Optional(
      Type.String({
        pattern: "^(?:[1-9]|[1-9][0-9]|100)$",
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-asset-list-query.v1",
  },
);

export type WorkspaceAssetListQuery = Static<
  typeof WorkspaceAssetListQuerySchema
>;

export const CanvasDraftListQuerySchema = Type.Object(
  {
    limit: Type.Optional(
      Type.String({
        pattern: "^(?:[1-9]|[1-4][0-9]|50)$",
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-draft-list-query.v1",
  },
);

export const CanvasDraftSummarySchema = Type.Object(
  {
    id: UlidSchema,
    workspaceId: UlidSchema,
    brand: Type.Optional(CanvasBrandContextSchema),
    title: Type.String({ minLength: 1, maxLength: 240 }),
    pageCount: Type.Integer({ minimum: 1 }),
    version: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-draft-summary.v1",
  },
);

export const CanvasDraftListSchema = Type.Object(
  {
    items: Type.Array(CanvasDraftSummarySchema, {
      maxItems: 50,
    }),
    truncated: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-draft-list.v1",
  },
);

export type CanvasDraftList = Static<typeof CanvasDraftListSchema>;

export type CanvasDraftListQuery = Static<typeof CanvasDraftListQuerySchema>;

export type CanvasDraftSummary = Static<typeof CanvasDraftSummarySchema>;

export const CanvasDraftPathSchema = Type.Object(
  {
    canvasDraftId: UlidSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-draft-path.v1",
  },
);

export const CreateCanvasDraftBodySchema = Type.Object(
  {
    document: EditorDraftContentV1Schema,
    brandKitRevisionId: Type.Optional(Type.Union([UlidSchema, Type.Null()])),
  },
  {
    additionalProperties: false,
    $id: "kanvas.create-canvas-draft-body.v1",
  },
);

export const UpdateCanvasDraftBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    document: EditorDraftContentV1Schema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.update-canvas-draft-body.v1",
  },
);

export const UpdateCanvasDraftBrandBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    brandKitRevisionId: UlidSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.update-canvas-draft-brand-body.v1",
  },
);

export const CanvasDraftSchema = Type.Object(
  {
    id: UlidSchema,
    workspaceId: UlidSchema,
    brand: Type.Optional(CanvasBrandContextSchema),
    document: EditorDocumentV1Schema,
    version: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    createdByPrincipalId: UlidSchema,
    updatedByPrincipalId: UlidSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-draft.v1",
  },
);

export const CanvasDraftMutationResultSchema = Type.Object(
  {
    draft: CanvasDraftSchema,
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-draft-mutation-result.v1",
  },
);

export const CanvasDraftRevisionPathSchema = Type.Object(
  {
    canvasDraftId: UlidSchema,
    version: Type.String({
      pattern: "^(?:[1-9]|[1-9][0-9]{1,9})$",
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-draft-revision-path.v1",
  },
);

export const CanvasDraftRevisionListQuerySchema = Type.Object(
  {
    beforeVersion: Type.Optional(
      Type.String({
        pattern: "^(?:[1-9]|[1-9][0-9]{1,9})$",
      }),
    ),
    limit: Type.Optional(
      Type.String({
        pattern: "^(?:[1-9]|[12][0-9]|30)$",
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-draft-revision-list-query.v1",
  },
);

export const CanvasDraftRevisionSummarySchema = Type.Object(
  {
    version: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    title: Type.String({ minLength: 1, maxLength: 240 }),
    contentDigest: Sha256DigestSchema,
    kind: Type.Union([
      Type.Literal("save"),
      Type.Literal("restore"),
      Type.Literal("brand_update"),
    ]),
    restoredFromVersion: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 4_294_967_295,
      }),
    ),
    brand: Type.Optional(CanvasBrandContextSchema),
    createdByPrincipalId: UlidSchema,
    createdAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-draft-revision-summary.v1",
  },
);

export const CanvasDraftRevisionSchema = Type.Object(
  {
    canvasDraftId: UlidSchema,
    workspaceId: UlidSchema,
    ...CanvasDraftRevisionSummarySchema.properties,
    document: EditorDocumentV1Schema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-draft-revision.v1",
  },
);

export const CanvasDraftRevisionListSchema = Type.Object(
  {
    items: Type.Array(CanvasDraftRevisionSummarySchema, {
      maxItems: 30,
    }),
    nextBeforeVersion: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 4_294_967_295,
      }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-draft-revision-list.v1",
  },
);

export const RestoreCanvasDraftBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    sourceVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.restore-canvas-draft-body.v1",
  },
);

export type CanvasDraft = Static<typeof CanvasDraftSchema>;
export type CanvasBrandContext = Static<typeof CanvasBrandContextSchema>;
export type CanvasDraftMutationResult = Static<
  typeof CanvasDraftMutationResultSchema
>;
export type CanvasDraftRevision = Static<typeof CanvasDraftRevisionSchema>;
export type CanvasDraftRevisionList = Static<
  typeof CanvasDraftRevisionListSchema
>;
export type CanvasDraftRevisionListQuery = Static<
  typeof CanvasDraftRevisionListQuerySchema
>;
export type CanvasDraftRevisionSummary = Static<
  typeof CanvasDraftRevisionSummarySchema
>;
export type CreateCanvasDraftBody = Static<typeof CreateCanvasDraftBodySchema>;
export type RestoreCanvasDraftBody = Static<
  typeof RestoreCanvasDraftBodySchema
>;
export type UpdateCanvasDraftBody = Static<typeof UpdateCanvasDraftBodySchema>;
export type UpdateCanvasDraftBrandBody = Static<
  typeof UpdateCanvasDraftBrandBodySchema
>;

export const CreationEntrypointOutputPresentationSchema = Type.Union([
  Type.Literal("board"),
  Type.Literal("single_review"),
  Type.Literal("batch_review"),
  Type.Literal("assets"),
]);

export const WorkspaceCreationEntrypointSummarySchema = Type.Object(
  {
    skillRevisionId: UlidSchema,
    skillKey: Type.String({ minLength: 1, maxLength: 160 }),
    skillRevision: Type.Integer({ minimum: 1 }),
    entrypointKey: Type.String({ minLength: 1, maxLength: 160 }),
    workflowRevisionId: UlidSchema,
    workflowRevision: Type.Integer({ minimum: 1 }),
    displayName: Type.String({ minLength: 1, maxLength: 240 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    category: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    nonProduction: Type.Boolean(),
    outputPresentation: CreationEntrypointOutputPresentationSchema,
    inputSchema: Type.Record(Type.String(), Type.Unknown()),
    outputSchema: Type.Record(Type.String(), Type.Unknown()),
    effectiveInvocationSchema: EffectiveInvocationSchema,
    inputUiSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    capability: Type.Optional(
      Type.Object(
        {
          contractKey: Type.String({ minLength: 1, maxLength: 160 }),
          revision: Type.Integer({ minimum: 1 }),
          canonicalDigest: Sha256DigestSchema,
          surfaces: Type.Array(
            Type.Union([
              Type.Literal("workflow"),
              Type.Literal("agent"),
              Type.Literal("canvas"),
            ]),
            { minItems: 1, maxItems: 3, uniqueItems: true },
          ),
          parameters: Type.Array(
            Type.Object(
              {
                key: Type.String({ minLength: 1, maxLength: 160 }),
                semanticType: WorkflowCapabilitySemanticTypeSchema,
              },
              { additionalProperties: false },
            ),
            { maxItems: 200 },
          ),
          outputs: Type.Array(
            Type.Object(
              {
                key: Type.String({ minLength: 1, maxLength: 160 }),
                semanticType: WorkflowCapabilitySemanticTypeSchema,
                primary: Type.Boolean(),
              },
              { additionalProperties: false },
            ),
            { maxItems: 200 },
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-creation-entrypoint-summary.v1",
  },
);

export const WorkspaceCreationEntrypointListSchema = Type.Object(
  {
    items: Type.Array(WorkspaceCreationEntrypointSummarySchema, {
      maxItems: 100,
    }),
    truncated: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-creation-entrypoint-list.v1",
  },
);

export type WorkspaceCreationEntrypointSummary = Static<
  typeof WorkspaceCreationEntrypointSummarySchema
>;
export type WorkspaceCreationEntrypointList = Static<
  typeof WorkspaceCreationEntrypointListSchema
>;

export const AgentHubVisibilitySchema = Type.Union([
  Type.Literal("private"),
  Type.Literal("workspace"),
]);

export const AgentHubAgentAvatarSchema = Type.Union([
  ...VisualIdentitySymbolSchema.anyOf,
  Type.Object(
    {
      kind: Type.Literal("image"),
      assetId: UlidSchema,
    },
    { additionalProperties: false },
  ),
]);

export const AgentHubAgentSchema = Type.Object(
  {
    resourceState: Type.Union([
      Type.Literal("enabled"),
      Type.Literal("disabled"),
      Type.Literal("deleted"),
    ]),
    id: UlidSchema,
    agentKey: Type.String({ minLength: 1, maxLength: 160 }),
    managementKind: Type.Union([
      Type.Literal("system"),
      Type.Literal("workspace"),
    ]),
    systemKey: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    isDefault: Type.Boolean(),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    summary: Type.String({ minLength: 1, maxLength: 600 }),
    avatar: Type.Optional(AgentHubAgentAvatarSchema),
    coverAssetId: Type.Optional(UlidSchema),
    category: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    tags: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      maxItems: 20,
      uniqueItems: true,
    }),
    ownerPrincipalId: UlidSchema,
    visibility: AgentHubVisibilitySchema,
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    profileRevisionId: UlidSchema,
    profileRevision: Type.Integer({ minimum: 1 }),
    boundSkillCount: Type.Integer({ minimum: 0 }),
    updatedAt: IsoDateTimeSchema,
  },
  { additionalProperties: false },
);

export const AgentHubSkillSchema = Type.Object(
  {
    id: UlidSchema,
    skillKey: Type.String({ minLength: 1, maxLength: 160 }),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    summary: Type.String({ minLength: 1, maxLength: 600 }),
    coverAssetId: Type.Optional(UlidSchema),
    category: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    tags: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      maxItems: 20,
      uniqueItems: true,
    }),
    exampleRequests: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), {
      maxItems: 20,
    }),
    ownerPrincipalId: UlidSchema,
    visibility: AgentHubVisibilitySchema,
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    skillRevisionId: UlidSchema,
    skillRevision: Type.Integer({ minimum: 1 }),
    runtimeStatus: Type.Union([
      Type.Literal("enabled"),
      Type.Literal("disabled"),
      Type.Literal("revoked"),
    ]),
    activationVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    updatedAt: IsoDateTimeSchema,
  },
  { additionalProperties: false },
);

export const AgentHubAgentsSchema = Type.Object(
  { items: Type.Array(AgentHubAgentSchema, { maxItems: 100 }) },
  { additionalProperties: false },
);

export const AgentHubAgentDetailSchema = Type.Object(
  {
    ...AgentHubAgentSchema.properties,
    instructions: Type.String({ minLength: 1, maxLength: 8_000 }),
    creatorDisplayName: Type.Optional(
      Type.String({ minLength: 1, maxLength: 160 }),
    ),
    canEdit: Type.Boolean(),
    boundSkills: Type.Array(
      Type.Object(
        {
          id: UlidSchema,
          displayName: Type.Optional(
            Type.String({ minLength: 1, maxLength: 160 }),
          ),
          summary: Type.Optional(Type.String({ minLength: 1, maxLength: 600 })),
          workspaceAvailability: Type.Union([
            Type.Literal("available"),
            Type.Literal("private"),
            Type.Literal("disabled"),
            Type.Literal("deleted"),
            Type.Literal("revoked"),
            Type.Literal("unavailable"),
          ]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 40 },
    ),
    boundBrands: Type.Array(
      Type.Object(
        {
          id: UlidSchema,
          displayName: Type.String({ minLength: 1, maxLength: 160 }),
          description: Type.Optional(
            Type.String({ minLength: 1, maxLength: 1_000 }),
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 8 },
    ),
    boundLibraries: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: UlidSchema,
            displayName: Type.String({ minLength: 1, maxLength: 160 }),
            description: Type.Optional(Type.String({ maxLength: 2000 })),
          },
          { additionalProperties: false },
        ),
        { maxItems: 8 },
      ),
    ),
    boundWorkflows: Type.Array(
      Type.Object(
        {
          id: UlidSchema,
          displayName: Type.String({ minLength: 1, maxLength: 240 }),
          description: Type.Optional(
            Type.String({ minLength: 1, maxLength: 1_000 }),
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 40 },
    ),
  },
  { additionalProperties: false },
);

export const AgentHubSkillsSchema = Type.Object(
  { items: Type.Array(AgentHubSkillSchema, { maxItems: 100 }) },
  { additionalProperties: false },
);

export const AgentHubSkillDetailSchema = Type.Object(
  {
    ...AgentHubSkillSchema.properties,
    description: Type.String({ minLength: 1, maxLength: 600 }),
    instructions: Type.String({ minLength: 1, maxLength: 262_144 }),
    resources: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1, maxLength: 512 }),
          resourceKind: Type.Union([
            Type.Literal("instructions"),
            Type.Literal("reference"),
            Type.Literal("template"),
            Type.Literal("asset"),
            Type.Literal("eval"),
          ]),
          mediaType: Type.String({ minLength: 1, maxLength: 160 }),
          byteSize: Type.Integer({ minimum: 0, maximum: 67_108_864 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 1_024 },
    ),
  },
  { additionalProperties: false },
);

export const SkillDraftSummarySchema = Type.Object(
  {
    id: UlidSchema,
    skillDefinitionId: UlidSchema,
    skillKey: Type.String({ minLength: 1, maxLength: 160 }),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    summary: Type.String({ minLength: 1, maxLength: 600 }),
    coverAssetId: Type.Optional(UlidSchema),
    category: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    tags: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      maxItems: 20,
      uniqueItems: true,
    }),
    exampleRequests: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), {
      maxItems: 20,
    }),

    visibility: AgentHubVisibilitySchema,
    definitionVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    presentationVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    draftVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    canonicalDigest: Sha256DigestSchema,
    candidateId: Type.Optional(UlidSchema),
    candidateDigest: Type.Optional(Sha256DigestSchema),
    passedCheckCount: Type.Integer({ minimum: 0, maximum: 5 }),
    publishedSkillRevisionId: Type.Optional(UlidSchema),
    publishedSkillRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    publishedCurrent: Type.Boolean(),
    updatedAt: IsoDateTimeSchema,
  },
  { additionalProperties: false, $id: "kanvas.skill-draft-summary.v1" },
);

export const SkillDraftListSchema = Type.Object(
  { items: Type.Array(SkillDraftSummarySchema, { maxItems: 100 }) },
  { additionalProperties: false, $id: "kanvas.skill-draft-list.v1" },
);

export const SkillFileInputSchema = Type.Union([
  Type.Object(
    {
      path: Type.String({ minLength: 1, maxLength: 512 }),
      text: Type.String({ minLength: 1, maxLength: 262_144 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      path: Type.String({ minLength: 1, maxLength: 512 }),
      base64: Type.String({
        minLength: 4,
        maxLength: 2_796_204,
        pattern: "^[A-Za-z0-9+/]*={0,2}$",
      }),
    },
    { additionalProperties: false },
  ),
]);
export const SkillFileQuerySchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 512 }),
    skillRevisionId: Type.Optional(UlidSchema),
  },
  { additionalProperties: false },
);
export const SkillDraftFileQuerySchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 512 }),
    draftVersion: Type.String({ pattern: "^[1-9][0-9]{0,9}$" }),
  },
  { additionalProperties: false },
);
export type SkillFileInput = Static<typeof SkillFileInputSchema>;
export type SkillFileQuery = Static<typeof SkillFileQuerySchema>;
export type SkillDraftFileQuery = Static<typeof SkillDraftFileQuerySchema>;

export const SkillDraftDetailSchema = Type.Object(
  {
    ...SkillDraftSummarySchema.properties,
    resources: AgentHubSkillDetailSchema.properties.resources,
    packageName: Type.String({ minLength: 1, maxLength: 80 }),
    description: Type.String({ minLength: 1, maxLength: 600 }),
    instructions: Type.String({ minLength: 1, maxLength: 262_144 }),
  },
  { additionalProperties: false, $id: "kanvas.skill-draft-detail.v1" },
);

const SkillPresentationInputProperties = {
  displayName: Type.String({ minLength: 1, maxLength: 160, pattern: "\\S" }),
  summary: Type.String({ minLength: 1, maxLength: 600, pattern: "\\S" }),
  coverAssetId: Type.Optional(UlidSchema),
  category: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  tags: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
    maxItems: 20,
    uniqueItems: true,
  }),
  exampleRequests: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), {
    maxItems: 20,
  }),
} as const;

export const CreateSkillDraftBodySchema = Type.Object(
  {
    files: Type.Optional(Type.Array(SkillFileInputSchema, { maxItems: 20 })),

    name: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    }),
    description: Type.String({
      minLength: 1,
      maxLength: 600,
      pattern: "^[^\\r\\n]+$",
    }),
    instructions: Type.String({
      minLength: 1,
      maxLength: 262_144,
      pattern: "\\S",
    }),
    visibility: AgentHubVisibilitySchema,
    ...SkillPresentationInputProperties,
  },
  { additionalProperties: false, $id: "kanvas.create-skill-draft-body.v1" },
);

export const UpdateSkillDraftBodySchema = Type.Object(
  {
    files: Type.Optional(Type.Array(SkillFileInputSchema, { maxItems: 20 })),
    removedPaths: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
        maxItems: 50,
        uniqueItems: true,
      }),
    ),

    expectedDraftVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    expectedDefinitionVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    expectedPresentationVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    description: Type.String({
      minLength: 1,
      maxLength: 600,
      pattern: "^[^\\r\\n]+$",
    }),
    instructions: Type.String({
      minLength: 1,
      maxLength: 262_144,
      pattern: "\\S",
    }),
    visibility: AgentHubVisibilitySchema,
    ...SkillPresentationInputProperties,
  },
  { additionalProperties: false, $id: "kanvas.update-skill-draft-body.v1" },
);

export const SkillDraftPathSchema = Type.Object(
  { workspaceId: UlidSchema, skillDraftId: UlidSchema },
  { additionalProperties: false },
);

export const SkillDefinitionPathSchema = Type.Object(
  { workspaceId: UlidSchema, skillDefinitionId: UlidSchema },
  { additionalProperties: false },
);

export const SkillCandidatePathSchema = Type.Object(
  { workspaceId: UlidSchema, skillCandidateId: UlidSchema },
  { additionalProperties: false },
);

export const SkillRevisionPathSchema = Type.Object(
  { workspaceId: UlidSchema, skillRevisionId: UlidSchema },
  { additionalProperties: false },
);

export const SubmitSkillCandidateBodySchema = Type.Object(
  {
    expectedDraftVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
  },
  { additionalProperties: false },
);

export const ArchiveSkillDraftBodySchema = Type.Object(
  {
    expectedDraftVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
  },
  { additionalProperties: false },
);

export const RecordSkillCandidateTestBodySchema = Type.Object(
  {
    expectedCandidateDigest: Sha256DigestSchema,
    threadId: UlidSchema,
    runId: UlidSchema,
    artifactId: Type.Optional(UlidSchema),
    testRequest: Type.String({
      minLength: 1,
      maxLength: 2_000,
      pattern: "\\S",
    }),
  },
  { additionalProperties: false },
);

export const PublishSkillCandidateBodySchema = Type.Object(
  { expectedCandidateDigest: Sha256DigestSchema },
  { additionalProperties: false },
);

export const ChangeSkillRuntimeStatusBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    runtimeStatus: Type.Union([
      Type.Literal("enabled"),
      Type.Literal("disabled"),
      Type.Literal("revoked"),
    ]),
    reasonCode: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 120,
        pattern: "^[a-z0-9][a-z0-9._-]*$",
      }),
    ),
  },
  { additionalProperties: false },
);

export const SkillRuntimeStatusSchema = Type.Object(
  {
    skillRevisionId: UlidSchema,
    runtimeStatus: Type.Union([
      Type.Literal("enabled"),
      Type.Literal("disabled"),
      Type.Literal("revoked"),
    ]),
    reasonCode: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    updatedAt: IsoDateTimeSchema,
  },
  { additionalProperties: false },
);

const AgentHubAgentInputProperties = {
  displayName: Type.String({ minLength: 1, maxLength: 160, pattern: "\\S" }),
  summary: Type.String({ minLength: 1, maxLength: 600, pattern: "\\S" }),
  instructions: Type.String({ minLength: 1, maxLength: 8_000, pattern: "\\S" }),
  avatar: Type.Optional(AgentHubAgentAvatarSchema),
  visibility: AgentHubVisibilitySchema,
  coverAssetId: Type.Optional(UlidSchema),
  category: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  tags: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
    maxItems: 20,
    uniqueItems: true,
  }),
  skillDefinitionIds: Type.Array(UlidSchema, {
    maxItems: 40,
    uniqueItems: true,
  }),
  libraryIds: Type.Optional(
    Type.Array(UlidSchema, { maxItems: 8, uniqueItems: true }),
  ),
  brandKitIds: Type.Array(UlidSchema, {
    maxItems: 8,
    uniqueItems: true,
  }),
  workflowDefinitionIds: Type.Array(UlidSchema, {
    maxItems: 40,
    uniqueItems: true,
  }),
} as const;

export const CreateAgentHubAgentBodySchema = Type.Object(
  AgentHubAgentInputProperties,
  { additionalProperties: false },
);

export const UpdateAgentHubAgentBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    ...AgentHubAgentInputProperties,
  },
  { additionalProperties: false },
);

export const AgentHubAgentPathSchema = Type.Object(
  { workspaceId: UlidSchema, agentDefinitionId: UlidSchema },
  { additionalProperties: false },
);

export const AgentHubSubjectPathSchema = Type.Object(
  {
    workspaceId: UlidSchema,
    subjectKind: Type.Union([Type.Literal("agent"), Type.Literal("skill")]),
    subjectId: UlidSchema,
  },
  { additionalProperties: false },
);

export const SetAgentHubVisibilityBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    visibility: AgentHubVisibilitySchema,
  },
  { additionalProperties: false },
);

export type AgentHubAgent = Static<typeof AgentHubAgentSchema>;
export type AgentHubAgentAvatar = Static<typeof AgentHubAgentAvatarSchema>;
export type AgentHubAgentDetail = Static<typeof AgentHubAgentDetailSchema>;
export type AgentHubSkill = Static<typeof AgentHubSkillSchema>;
export type AgentHubSkillDetail = Static<typeof AgentHubSkillDetailSchema>;
export type AgentHubAgents = Static<typeof AgentHubAgentsSchema>;
export type AgentHubSkills = Static<typeof AgentHubSkillsSchema>;
export type CreateAgentHubAgentBody = Static<
  typeof CreateAgentHubAgentBodySchema
>;
export type UpdateAgentHubAgentBody = Static<
  typeof UpdateAgentHubAgentBodySchema
>;
export type AgentHubAgentPath = Static<typeof AgentHubAgentPathSchema>;
export type AgentHubSubjectPath = Static<typeof AgentHubSubjectPathSchema>;
export type SetAgentHubVisibilityBody = Static<
  typeof SetAgentHubVisibilityBodySchema
>;
export type SkillDraftSummary = Static<typeof SkillDraftSummarySchema>;
export type SkillDraftList = Static<typeof SkillDraftListSchema>;
export type SkillDraftDetail = Static<typeof SkillDraftDetailSchema>;
export type CreateSkillDraftBody = Static<typeof CreateSkillDraftBodySchema>;
export type UpdateSkillDraftBody = Static<typeof UpdateSkillDraftBodySchema>;
export type SkillDraftPath = Static<typeof SkillDraftPathSchema>;
export type SkillDefinitionPath = Static<typeof SkillDefinitionPathSchema>;
export type SkillCandidatePath = Static<typeof SkillCandidatePathSchema>;
export type SkillRevisionPath = Static<typeof SkillRevisionPathSchema>;
export type SubmitSkillCandidateBody = Static<
  typeof SubmitSkillCandidateBodySchema
>;
export type ArchiveSkillDraftBody = Static<typeof ArchiveSkillDraftBodySchema>;
export type RecordSkillCandidateTestBody = Static<
  typeof RecordSkillCandidateTestBodySchema
>;
export type PublishSkillCandidateBody = Static<
  typeof PublishSkillCandidateBodySchema
>;
export type ChangeSkillRuntimeStatusBody = Static<
  typeof ChangeSkillRuntimeStatusBodySchema
>;
export type SkillRuntimeStatus = Static<typeof SkillRuntimeStatusSchema>;

export const AgentModelSettingOptionSchema = Type.Object(
  {
    id: UlidSchema,
    modelName: Type.String({ minLength: 1, maxLength: 160 }),
    ready: Type.Boolean(),
    unavailableReasons: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
        maxItems: 16,
      }),
    ),
  },
  { additionalProperties: false },
);

export const AgentReasoningLevelSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
]);

export const AgentWebSearchModeSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("auto"),
  Type.Literal("required"),
]);

export const WorkspaceAgentModelSettingsSchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    currentDefaultModelId: Type.Optional(UlidSchema),
    currentFastModelId: Type.Optional(UlidSchema),
    reasoningLevel: AgentReasoningLevelSchema,
    webSearchMode: AgentWebSearchModeSchema,
    actionConfirmationRequired: Type.Boolean(),
    options: Type.Array(AgentModelSettingOptionSchema, { maxItems: 128 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-agent-model-settings.v1",
  },
);

export const UpdateWorkspaceAgentModelSettingsBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    defaultModelId: UlidSchema,
    fastModelId: UlidSchema,
    reasoningLevel: AgentReasoningLevelSchema,
    webSearchMode: AgentWebSearchModeSchema,
    actionConfirmationRequired: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.update-workspace-agent-model-settings-body.v1",
  },
);

export const WorkspaceAgentPathSchema = Type.Object(
  { workspaceId: UlidSchema },
  { additionalProperties: false },
);

export const AgentRunPathSchema = Type.Object(
  { agentRunId: UlidSchema },
  { additionalProperties: false },
);

export const AgentThreadPathSchema = Type.Object(
  { workspaceId: UlidSchema, threadId: UlidSchema },
  { additionalProperties: false },
);

export const AgentThreadListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 512,
        pattern: "^[A-Za-z0-9_-]+$",
      }),
    ),
    limit: Type.Optional(Type.String({ pattern: "^(?:[1-9]|[1-4][0-9]|50)$" })),
  },
  { additionalProperties: false },
);

export const AgentActionPathSchema = Type.Object(
  { actionReceiptId: UlidSchema },
  { additionalProperties: false },
);

export const AgentInteractionPathSchema = Type.Object(
  { interactionId: UlidSchema },
  { additionalProperties: false },
);

export const ConfirmAgentActionBodySchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const CompleteAgentCanvasExportBodySchema = Type.Union([
  Type.Object({ exportSessionId: UlidSchema }, { additionalProperties: false }),
  Type.Object(
    {
      error: Type.Object(
        {
          code: Type.String({ minLength: 1, maxLength: 120 }),
          message: Type.String({ minLength: 1, maxLength: 4000 }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);
export const AgentCanvasExportRequestSchema = Type.Object(
  {
    actionReceiptId: UlidSchema,
    canvasDraftId: UlidSchema,
    documentVersion: Type.Integer({ minimum: 1 }),
    pageId: Type.String({ minLength: 1, maxLength: 160 }),
  },
  { additionalProperties: false },
);
export type CompleteAgentCanvasExportBody = Static<
  typeof CompleteAgentCanvasExportBodySchema
>;

export const DeclineAgentActionBodySchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const CancelAgentRunBodySchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const RegenerateAgentResponseBodySchema = Type.Union(
  [
    Type.Object(
      { assistantMessageId: UlidSchema },
      { additionalProperties: false },
    ),
    Type.Object({ agentRunId: UlidSchema }, { additionalProperties: false }),
  ],
  {
    $id: "kanvas.regenerate-agent-response-body.v1",
  },
);

export const SelectAgentResponseBranchBodySchema = Type.Object(
  {
    assistantMessageId: UlidSchema,
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.select-agent-response-branch-body.v1",
  },
);

export const CreateWorkspaceAgentMessageBodySchema = Type.Object(
  {
    libraryIds: Type.Optional(
      Type.Array(UlidSchema, { maxItems: 8, uniqueItems: true }),
    ),
    browserCanvasExport: Type.Optional(Type.Boolean()),
    threadId: Type.Optional(UlidSchema),
    agentDefinitionId: Type.Optional(UlidSchema),
    skillCandidateId: Type.Optional(UlidSchema),
    skillRevisionId: Type.Optional(UlidSchema),
    message: Type.String({ minLength: 1, maxLength: 8_000, pattern: "\\S" }),
    attachments: Type.Optional(
      Type.Array(
        Type.Object(
          {
            assetId: Type.Optional(UlidSchema),
            artifactId: UlidSchema,
          },
          { additionalProperties: false },
        ),
        { maxItems: 8, uniqueItems: true },
      ),
    ),
    brandContext: Type.Optional(
      Type.Union([
        Type.Null(),
        Type.Object(
          {
            brandKitId: UlidSchema,
            brandKitRevisionId: UlidSchema,
          },
          { additionalProperties: false },
        ),
      ]),
    ),
    references: Type.Optional(
      Type.Array(
        Type.Union([
          Type.Object(
            {
              kind: Type.Literal("canvas"),
              resourceId: UlidSchema,
              version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
            },
            { additionalProperties: false },
          ),
          Type.Object(
            {
              kind: Type.Literal("workflow"),
              resourceId: UlidSchema,
            },
            { additionalProperties: false },
          ),
        ]),
        { maxItems: 12 },
      ),
    ),
    entryContext: Type.Optional(
      Type.Object(
        {
          originSurface: Type.Literal("canvas"),
          canvasDraftId: UlidSchema,
          canvasDraftVersion: Type.Integer({
            minimum: 1,
            maximum: 4_294_967_295,
          }),
          pageKey: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
          selectedElementKeys: Type.Array(
            Type.String({ minLength: 1, maxLength: 160 }),
            { maxItems: 200, uniqueItems: true },
          ),
          returnTo: Type.Optional(
            Type.String({ minLength: 1, maxLength: 2_048, pattern: "^/[^/]" }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.create-workspace-agent-message-body.v1",
  },
);

export const AgentRunAcceptedSchema = Type.Object(
  {
    threadId: UlidSchema,
    runId: UlidSchema,
    lifecycleStatus: Type.Literal("queued"),
  },
  { additionalProperties: false, $id: "kanvas.agent-run-accepted.v1" },
);

export const CancelledAgentRunSchema = Type.Object(
  {
    runId: UlidSchema,
    lifecycleStatus: Type.Literal("cancelled"),
  },
  { additionalProperties: false, $id: "kanvas.cancelled-agent-run.v1" },
);

export const AgentThreadLatestRunSchema = Type.Object(
  {
    id: UlidSchema,
    assistantMessageId: Type.Optional(UlidSchema),
    replacesMessageId: Type.Optional(UlidSchema),
    lifecycleStatus: Type.Union([
      Type.Literal("queued"),
      Type.Literal("running"),
      Type.Literal("waiting_approval"),
      Type.Literal("waiting_for_user"),
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Literal("cancelled"),
    ]),
    failureKind: Type.Optional(
      Type.Union([
        Type.Literal("model_setup"),
        Type.Literal("budget"),
        Type.Literal("access_changed"),
        Type.Literal("tools_changed"),
        Type.Literal("limit"),
        Type.Literal("runtime"),
      ]),
    ),
    updatedAt: IsoDateTimeSchema,
  },
  { additionalProperties: false },
);

export const AgentThreadSummarySchema = Type.Object(
  {
    id: UlidSchema,
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    lifecycleStatus: Type.Union([
      Type.Literal("active"),
      Type.Literal("archived"),
    ]),
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    latestRun: Type.Optional(AgentThreadLatestRunSchema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  { additionalProperties: false },
);

export const RenameAgentThreadBodySchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 240, pattern: "\\S" }),
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
  },
  { additionalProperties: false },
);

export const ArchiveAgentThreadBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
  },
  { additionalProperties: false },
);

export const AgentThreadListSchema = Type.Object(
  {
    items: Type.Array(AgentThreadSummarySchema, { maxItems: 50 }),
    nextCursor: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 512,
        pattern: "^[A-Za-z0-9_-]+$",
      }),
    ),
  },
  { additionalProperties: false },
);

export const AgentThreadRelatedContentSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("canvas"),
      Type.Literal("capability"),
      Type.Literal("workflow"),
      Type.Literal("brand"),
      Type.Literal("asset"),
      Type.Literal("artifact"),
    ]),
    resourceId: UlidSchema,
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
    state: Type.Union([Type.Literal("available"), Type.Literal("unavailable")]),
    pageCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 128 })),
    version: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    ),
    artifactId: Type.Optional(UlidSchema),
    assetId: Type.Optional(UlidSchema),
    brandKitRevisionId: Type.Optional(UlidSchema),
  },
  { additionalProperties: false },
);

export const AgentQuestionOptionSchema = Type.Object(
  {
    key: Type.String({
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-z][a-z0-9_-]{0,63}$",
    }),
    label: Type.String({ minLength: 1, maxLength: 80 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    recommended: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const AgentQuestionItemSchema = Type.Object(
  {
    key: Type.String({
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-z][a-z0-9_-]{0,63}$",
    }),
    header: Type.String({ minLength: 1, maxLength: 32 }),
    question: Type.String({ minLength: 1, maxLength: 400 }),
    multiSelect: Type.Optional(Type.Boolean()),
    options: Type.Array(AgentQuestionOptionSchema, {
      minItems: 2,
      maxItems: 4,
    }),
  },
  { additionalProperties: false },
);

export const AgentQuestionAnswerSchema = Type.Object(
  {
    questionKey: Type.String({ minLength: 1, maxLength: 64 }),
    optionKeys: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
      maxItems: 4,
      uniqueItems: true,
    }),
    customText: Type.Optional(
      Type.String({ minLength: 1, maxLength: 1_000, pattern: "\\S" }),
    ),
  },
  { additionalProperties: false },
);

export const AgentQuestionResponseSchema = Type.Union([
  Type.Object(
    {
      outcome: Type.Literal("submitted"),
      answers: Type.Array(AgentQuestionAnswerSchema, {
        minItems: 1,
        maxItems: 3,
      }),
      supplement: Type.Optional(
        Type.String({ minLength: 1, maxLength: 1_000, pattern: "\\S" }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { outcome: Type.Literal("skipped") },
    { additionalProperties: false },
  ),
  Type.Object(
    { outcome: Type.Literal("cancelled") },
    { additionalProperties: false },
  ),
]);

export const ResolveAgentInteractionBodySchema = Type.Union([
  Type.Object(
    {
      expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
      outcome: Type.Literal("submitted"),
      answers: Type.Array(AgentQuestionAnswerSchema, {
        minItems: 1,
        maxItems: 3,
      }),
      supplement: Type.Optional(
        Type.String({ minLength: 1, maxLength: 1_000, pattern: "\\S" }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
      outcome: Type.Literal("skipped"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
      outcome: Type.Literal("cancelled"),
    },
    { additionalProperties: false },
  ),
]);

export const AgentInteractionViewSchema = Type.Object(
  {
    id: UlidSchema,
    kind: Type.Literal("question"),
    lifecycleStatus: Type.Union([
      Type.Literal("pending"),
      Type.Literal("submitted"),
      Type.Literal("skipped"),
      Type.Literal("cancelled"),
    ]),
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    questions: Type.Array(AgentQuestionItemSchema, {
      minItems: 1,
      maxItems: 3,
    }),
    response: Type.Optional(AgentQuestionResponseSchema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  { additionalProperties: false },
);

export const ResolvedAgentInteractionSchema = Type.Object(
  {
    interactionId: UlidSchema,
    lifecycleStatus: Type.Union([
      Type.Literal("submitted"),
      Type.Literal("skipped"),
      Type.Literal("cancelled"),
    ]),
    runId: UlidSchema,
    runLifecycleStatus: Type.Union([
      Type.Literal("queued"),
      Type.Literal("cancelled"),
    ]),
  },
  { additionalProperties: false },
);

export const AgentThreadMessageSchema = Type.Object(
  {
    libraryUses: Type.Optional(
      Type.Array(
        Type.Object(
          {
            libraryId: UlidSchema,
            artifactId: Type.Optional(UlidSchema),
            revisionId: Type.Optional(UlidSchema),
            locations: Type.Optional(
              Type.Array(
                Type.Object({
                  number: Type.Integer({ minimum: 1 }),
                  startLine: Type.Integer({ minimum: 1 }),
                  endLine: Type.Integer({ minimum: 1 }),
                  startOffset: Type.Integer({ minimum: 0 }),
                  endOffset: Type.Integer({ minimum: 0 }),
                  page: Type.Optional(Type.Integer({ minimum: 1 })),
                }),
                { maxItems: 12 },
              ),
            ),
            libraryName: Type.String(),
            revisionNumber: Type.Integer({ minimum: 1 }),
            entryId: UlidSchema,
            name: Type.String(),
            kind: Type.Union([
              Type.Literal("text_read"),
              Type.Literal("image_view"),
              Type.Literal("tool_input"),
            ]),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    id: UlidSchema,
    role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
    parts: Type.Array(
      Type.Union([
        Type.Object(
          {
            type: Type.Literal("text"),
            text: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            type: Type.Literal("reasoning"),
            text: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            type: Type.Literal("tool-call"),
            toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
            toolName: Type.String({ minLength: 1, maxLength: 256 }),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            type: Type.Literal("source"),
            sourceType: Type.Literal("url"),
            id: Type.String({ minLength: 1, maxLength: 256 }),
            url: Type.String({
              minLength: 1,
              maxLength: 2_048,
              pattern: "^https://",
            }),
            title: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
          },
          { additionalProperties: false },
        ),
      ]),
      { maxItems: 64 },
    ),
    relatedContent: Type.Array(AgentThreadRelatedContentSchema, {
      maxItems: 32,
    }),
    selectedSkill: Type.Optional(
      Type.Object(
        {
          revisionId: UlidSchema,
          name: Type.String({ minLength: 1, maxLength: 240 }),
        },
        { additionalProperties: false },
      ),
    ),
    interactions: Type.Optional(
      Type.Array(AgentInteractionViewSchema, { maxItems: 16 }),
    ),
    branch: Type.Optional(
      Type.Object(
        {
          index: Type.Integer({ minimum: 1 }),
          count: Type.Integer({ minimum: 1 }),
          previousMessageId: Type.Optional(UlidSchema),
          nextMessageId: Type.Optional(UlidSchema),
        },
        { additionalProperties: false },
      ),
    ),
    createdAt: IsoDateTimeSchema,
  },
  { additionalProperties: false },
);

const AgentThreadTaskPresentationSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("skill_images_update"),
      imageCount: Type.Integer({ minimum: 1, maximum: 8 }),
      resourceName: Type.Optional(
        Type.String({ minLength: 1, maxLength: 240 }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("skill_create"),
      resourceName: Type.String({ minLength: 1, maxLength: 240 }),
      imageCount: Type.Integer({ minimum: 0, maximum: 8 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("brand_publish"),
      resourceName: Type.String({ minLength: 1, maxLength: 240 }),
    },
    { additionalProperties: false },
  ),
]);

export const AgentThreadTaskSchema = Type.Object(
  {
    id: UlidSchema,
    kind: Type.Union([
      Type.Literal("workflow"),
      Type.Literal("capability"),
      Type.Literal("image_processing"),
      Type.Literal("workflow_test"),
      Type.Literal("skill"),
      Type.Literal("brand"),
    ]),
    lifecycleStatus: Type.Union([
      Type.Literal("proposed"),
      Type.Literal("unavailable"),
      Type.Literal("waiting_approval"),
      Type.Literal("running"),
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Literal("cancelled"),
    ]),
    title: Type.String({ minLength: 1, maxLength: 240 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
    presentation: Type.Optional(AgentThreadTaskPresentationSchema),
    workflowRevisionId: Type.Optional(UlidSchema),
    capabilityContractRevisionId: Type.Optional(UlidSchema),
    input: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    messageId: Type.Optional(UlidSchema),
    agentRunId: Type.Optional(UlidSchema),
    brandContext: Type.Optional(
      Type.Object(
        {
          brandKitId: UlidSchema,
          brandKitRevisionId: UlidSchema,
          name: Type.String({ minLength: 1, maxLength: 240 }),
        },
        { additionalProperties: false },
      ),
    ),
    workflowRunId: Type.Optional(UlidSchema),
    capabilityRunId: Type.Optional(UlidSchema),
    browserExecution: Type.Optional(BrowserExecutionRequirementSchema),
    capabilityRunStatus: Type.Optional(
      Type.Union([
        Type.Literal("queued"),
        Type.Literal("running"),
        Type.Literal("completed"),
        Type.Literal("failed"),
        Type.Literal("cancelled"),
      ]),
    ),
    skillDraftId: Type.Optional(UlidSchema),
    brandKitId: Type.Optional(UlidSchema),
    brandKitRevisionId: Type.Optional(UlidSchema),
    resultArtifacts: Type.Optional(
      Type.Array(
        Type.Object(
          {
            resourceId: UlidSchema,
            kind: Type.Union([Type.Literal("image"), Type.Literal("other")]),
            assetId: Type.Optional(UlidSchema),
            title: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
            state: Type.Union([
              Type.Literal("available"),
              Type.Literal("unavailable"),
            ]),
          },
          { additionalProperties: false },
        ),
        { maxItems: 32 },
      ),
    ),
  },
  { additionalProperties: false },
);

export const AgentThreadViewSchema = Type.Object(
  {
    id: UlidSchema,
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    lifecycleStatus: Type.Union([
      Type.Literal("active"),
      Type.Literal("archived"),
    ]),
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    viewRevision: Type.Optional(
      Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    ),
    actionConfirmationRequired: Type.Boolean(),
    agent: Type.Optional(
      Type.Object(
        {
          id: UlidSchema,
          displayName: Type.String({ minLength: 1, maxLength: 160 }),
        },
        { additionalProperties: false },
      ),
    ),
    latestRun: Type.Optional(AgentThreadLatestRunSchema),
    brandContext: Type.Optional(
      Type.Union([
        Type.Null(),
        Type.Object(
          {
            brandKitId: UlidSchema,
            brandKitRevisionId: UlidSchema,
            name: Type.String({ minLength: 1, maxLength: 240 }),
          },
          { additionalProperties: false },
        ),
      ]),
    ),
    messages: Type.Array(AgentThreadMessageSchema, { maxItems: 200 }),
    relatedContent: Type.Array(AgentThreadRelatedContentSchema, {
      maxItems: 100,
    }),
    pendingCanvasExports: Type.Optional(
      Type.Array(AgentCanvasExportRequestSchema, { maxItems: 40 }),
    ),
    tasks: Type.Array(AgentThreadTaskSchema, { maxItems: 200 }),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  { additionalProperties: false },
);

export const AgentThreadEventStreamSchema = Type.String({
  description: "Server-sent Agent Thread view events.",
});

export const AgentRunViewSchema = Type.Object(
  {
    threadId: UlidSchema,
    runId: UlidSchema,
    lifecycleStatus: Type.Union([
      Type.Literal("queued"),
      Type.Literal("running"),
      Type.Literal("waiting_approval"),
      Type.Literal("waiting_for_user"),
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Literal("cancelled"),
    ]),
    messages: Type.Array(AgentThreadMessageSchema, { maxItems: 200 }),
    actions: Type.Array(
      Type.Object(
        {
          id: UlidSchema,
          lifecycleStatus: Type.Union([
            Type.Literal("waiting_approval"),
            Type.Literal("succeeded"),
            Type.Literal("failed"),
            Type.Literal("cancelled"),
          ]),
          title: Type.String({ minLength: 1, maxLength: 240 }),
          description: Type.String({ minLength: 1, maxLength: 1_000 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 128 },
    ),
  },
  { additionalProperties: false, $id: "kanvas.agent-run-view.v1" },
);

export const AgentDiscoveryDiagnosticsSchema = Type.Object(
  {
    catalogState: Type.Union([
      Type.Literal("ready"),
      Type.Literal("empty"),
      Type.Literal("no_match"),
      Type.Literal("partial"),
      Type.Literal("unavailable"),
      Type.Literal("error"),
    ]),
    complete: Type.Boolean(),
    evaluatedAt: IsoDateTimeSchema,
    durationMs: Type.Integer({ minimum: 0 }),
    exclusions: Type.Array(
      Type.Object(
        {
          key: Type.String({ minLength: 1, maxLength: 160 }),
          status: Type.Union([
            Type.Literal("unavailable"),
            Type.Literal("unknown"),
          ]),
          stage: Type.Union([
            Type.Literal("eligibility"),
            Type.Literal("binding"),
            Type.Literal("invocation"),
          ]),
          reason: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        },
        { additionalProperties: false },
      ),
      { maxItems: 50 },
    ),
  },
  { additionalProperties: false },
);
export type AgentDiscoveryDiagnostics = Static<
  typeof AgentDiscoveryDiagnosticsSchema
>;

export const AgentRunDiagnosticsSchema = Type.Object(
  {
    runtimeConfigurationVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    runId: UlidSchema,
    threadId: UlidSchema,
    lifecycleStatus: Type.String({ minLength: 1, maxLength: 32 }),
    reasonCode: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    truncated: Type.Boolean(),
    limits: Type.Optional(
      Type.Object(
        {
          maximumModelCalls: Type.Integer({ minimum: 1 }),
          maximumToolCalls: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
    actions: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: UlidSchema,
            actionNumber: Type.Integer({ minimum: 1 }),
            toolKey: Type.String({ minLength: 1, maxLength: 160 }),
            lifecycleStatus: Type.String({ minLength: 1, maxLength: 32 }),
            reasonCode: Type.Optional(
              Type.String({ minLength: 1, maxLength: 160 }),
            ),
            createdAt: IsoDateTimeSchema,
            updatedAt: IsoDateTimeSchema,
          },
          { additionalProperties: false },
        ),
        { maxItems: 128 },
      ),
    ),
    discoveries: Type.Optional(
      Type.Array(
        Type.Object(
          {
            actionId: UlidSchema,
            ...AgentDiscoveryDiagnosticsSchema.properties,
          },
          { additionalProperties: false },
        ),
        { maxItems: 128 },
      ),
    ),
    calls: Type.Array(
      Type.Object(
        {
          id: UlidSchema,
          callNumber: Type.Optional(Type.Integer({ minimum: 1 })),
          finishReason: Type.Optional(
            Type.String({ minLength: 1, maxLength: 40 }),
          ),
          modelProfileKey: Type.Optional(
            Type.String({ minLength: 1, maxLength: 160 }),
          ),
          inputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
          outputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
          purpose: Type.String({ minLength: 1, maxLength: 32 }),
          lifecycleStatus: Type.String({ minLength: 1, maxLength: 32 }),
          reasonCode: Type.Optional(
            Type.String({ minLength: 1, maxLength: 160 }),
          ),
          routeResolved: Type.Union([Type.Boolean(), Type.Null()]),
          providerAccepted: Type.Boolean(),
          requestId: Type.Optional(
            Type.String({ minLength: 1, maxLength: 512 }),
          ),
          createdAt: IsoDateTimeSchema,
          updatedAt: IsoDateTimeSchema,
        },
        { additionalProperties: false },
      ),
      { maxItems: 128 },
    ),
  },
  { additionalProperties: false, $id: "kanvas.agent-run-diagnostics.v1" },
);
export type AgentRunDiagnostics = Static<typeof AgentRunDiagnosticsSchema>;

export const ConfirmedAgentActionSchema = Type.Union(
  [
    Type.Object(
      {
        actionReceiptId: UlidSchema,
        outcomeKind: Type.Literal("capability_run"),
        capabilityRunId: UlidSchema,
        lifecycleStatus: Type.Literal("succeeded"),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        actionReceiptId: UlidSchema,
        outcomeKind: Type.Literal("workflow_run"),
        workflowRunId: UlidSchema,
        lifecycleStatus: Type.Literal("succeeded"),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        actionReceiptId: UlidSchema,
        outcomeKind: Type.Literal("skill_draft"),
        skillDraftId: UlidSchema,
        lifecycleStatus: Type.Literal("succeeded"),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        actionReceiptId: UlidSchema,
        outcomeKind: Type.Literal("brand_revision"),
        brandKitId: UlidSchema,
        brandKitRevisionId: UlidSchema,
        lifecycleStatus: Type.Literal("succeeded"),
      },
      { additionalProperties: false },
    ),
  ],
  { $id: "kanvas.confirmed-agent-action.v1" },
);

export const DeclinedAgentActionSchema = Type.Object(
  {
    actionReceiptId: UlidSchema,
    lifecycleStatus: Type.Literal("cancelled"),
  },
  { additionalProperties: false, $id: "kanvas.declined-agent-action.v1" },
);

export type CreateWorkspaceAgentMessageBody = Static<
  typeof CreateWorkspaceAgentMessageBodySchema
>;
export type AgentModelSettingOption = Static<
  typeof AgentModelSettingOptionSchema
>;
export type WorkspaceAgentModelSettings = Static<
  typeof WorkspaceAgentModelSettingsSchema
>;
export type UpdateWorkspaceAgentModelSettingsBody = Static<
  typeof UpdateWorkspaceAgentModelSettingsBodySchema
>;
export type AgentRunAccepted = Static<typeof AgentRunAcceptedSchema>;
export type RegenerateAgentResponseBody = Static<
  typeof RegenerateAgentResponseBodySchema
>;
export type SelectAgentResponseBranchBody = Static<
  typeof SelectAgentResponseBranchBodySchema
>;
export type CancelAgentRunBody = Static<typeof CancelAgentRunBodySchema>;
export type CancelledAgentRun = Static<typeof CancelledAgentRunSchema>;
export type AgentRunView = Static<typeof AgentRunViewSchema>;
export type AgentThreadListQuery = Static<typeof AgentThreadListQuerySchema>;
export type AgentThreadSummary = Static<typeof AgentThreadSummarySchema>;
export type AgentThreadList = Static<typeof AgentThreadListSchema>;
export type AgentThreadView = Static<typeof AgentThreadViewSchema>;
export type RenameAgentThreadBody = Static<typeof RenameAgentThreadBodySchema>;
export type ArchiveAgentThreadBody = Static<
  typeof ArchiveAgentThreadBodySchema
>;
export type ConfirmAgentActionBody = Static<
  typeof ConfirmAgentActionBodySchema
>;
export type ConfirmedAgentAction = Static<typeof ConfirmedAgentActionSchema>;
export type DeclineAgentActionBody = Static<
  typeof DeclineAgentActionBodySchema
>;
export type DeclinedAgentAction = Static<typeof DeclinedAgentActionSchema>;
export type AgentInteractionView = Static<typeof AgentInteractionViewSchema>;
export type AgentQuestionResponse = Static<typeof AgentQuestionResponseSchema>;
export type ResolveAgentInteractionBody = Static<
  typeof ResolveAgentInteractionBodySchema
>;
export type ResolvedAgentInteraction = Static<
  typeof ResolvedAgentInteractionSchema
>;

export const ManagedResourceStateSchema = Type.Union([
  Type.Literal("enabled"),
  Type.Literal("disabled"),
  Type.Literal("deleted"),
]);
export const ResourceStateListPathSchema = Type.Object(
  {
    workspaceId: UlidSchema,
    subjectKind: Type.Union([Type.Literal("agent"), Type.Literal("skill")]),
  },
  { additionalProperties: false },
);
export const ResourceStateListSchema = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          id: UlidSchema,
          displayName: Type.String(),
          summary: Type.String(),
          state: ManagedResourceStateSchema,
          version: Type.Integer({ minimum: 1 }),
          boundAgentCount: Type.Integer({ minimum: 0 }),
          draftIds: Type.Array(UlidSchema),
          canManage: Type.Boolean(),
          canEnable: Type.Boolean(),
          updatedAt: IsoDateTimeSchema,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false, $id: "kanvas.resource-state-list.v1" },
);
export const ChangeResourceStateBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    state: ManagedResourceStateSchema,
  },
  { additionalProperties: false, $id: "kanvas.change-resource-state-body.v1" },
);
export type ResourceStateList = Static<typeof ResourceStateListSchema>;
export type ResourceStateListPath = Static<typeof ResourceStateListPathSchema>;
export type ChangeResourceStateBody = Static<
  typeof ChangeResourceStateBodySchema
>;

export const AgentHubAgentReadQuerySchema = Type.Object(
  { threadId: Type.Optional(UlidSchema) },
  { additionalProperties: false },
);

export const AddWorkspaceMemberBodySchema = Type.Object(
  {
    email: EmailAddressSchema,
    role: WorkspaceRoleSchema,
  },
  { additionalProperties: false, $id: "kanvas.add-workspace-member-body.v1" },
);
export type AddWorkspaceMemberBody = Static<
  typeof AddWorkspaceMemberBodySchema
>;

export const InstanceWorkspaceMemberPathSchema = Type.Object(
  {
    workspaceId: UlidSchema,
    targetPrincipalId: UlidSchema,
  },
  { additionalProperties: false },
);
export const ChangeInstancePrincipalStatusBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1 }),
    status: Type.Union([Type.Literal("active"), Type.Literal("suspended")]),
  },
  {
    additionalProperties: false,
    $id: "kanvas.change-instance-principal-status-body.v1",
  },
);
export type ChangeInstancePrincipalStatusBody = Static<
  typeof ChangeInstancePrincipalStatusBodySchema
>;
export const ChangedInstancePrincipalStatusSchema = Type.Object(
  {
    principalId: UlidSchema,
    status: Type.Union([Type.Literal("active"), Type.Literal("suspended")]),
    version: Type.Integer({ minimum: 1 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.changed-instance-principal-status.v1",
  },
);
export type ChangedInstancePrincipalStatus = Static<
  typeof ChangedInstancePrincipalStatusSchema
>;

export const InstanceWorkspacePathSchema = Type.Object(
  { workspaceId: UlidSchema },
  { additionalProperties: false },
);
export const InstanceInvitationPathSchema = Type.Object(
  { workspaceId: UlidSchema, invitationId: UlidSchema },
  { additionalProperties: false },
);

export const TaskRecordKindSchema = Type.Union([
  Type.Literal("agent"),
  Type.Literal("workflow"),
  Type.Literal("capability"),
]);
export const TaskRecordQuerySchema = Type.Object(
  {
    locale: Type.Optional(
      Type.Union([Type.Literal("zh-CN"), Type.Literal("en-US")]),
    ),
    reference: Type.Optional(UlidSchema),
    kind: Type.Optional(TaskRecordKindSchema),
    status: Type.Optional(
      Type.Union([
        Type.Literal("active"),
        Type.Literal("succeeded"),
        Type.Literal("failed"),
        Type.Literal("cancelled"),
      ]),
    ),
    creator: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    from: Type.Optional(IsoDateTimeSchema),
    to: Type.Optional(IsoDateTimeSchema),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    limit: Type.Optional(
      Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|100)$" }),
    ),
  },
  { additionalProperties: false },
);
export const TaskRecordSchema = Type.Object(
  {
    id: UlidSchema,
    kind: TaskRecordKindSchema,
    title: Type.String({ maxLength: 1000 }),
    status: Type.String({ maxLength: 32 }),
    outcome: Type.Optional(Type.String({ maxLength: 32 })),
    creatorId: UlidSchema,
    creatorName: Type.String({ maxLength: 255 }),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    completedAt: Type.Optional(IsoDateTimeSchema),
    threadId: Type.Optional(UlidSchema),
    agentRunId: Type.Optional(UlidSchema),
  },
  { additionalProperties: false },
);
export const TaskRecordListSchema = Type.Object(
  {
    items: Type.Array(TaskRecordSchema, { maxItems: 100 }),
    nextCursor: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { additionalProperties: false, $id: "kanvas.task-record-list.v1" },
);
export const TaskTimelinePathSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("workflow"), Type.Literal("capability")]),
    taskRunId: UlidSchema,
  },
  { additionalProperties: false },
);
export const TaskTimelineSchema = Type.Object(
  {
    taskRunId: UlidSchema,
    kind: TaskTimelinePathSchema.properties.kind,
    generatedAt: IsoDateTimeSchema,
    items: OperationalTimelineSchema.properties.items,
    truncated: Type.Boolean(),
  },
  { additionalProperties: false, $id: "kanvas.task-timeline.v1" },
);
export type TaskRecordQuery = Static<typeof TaskRecordQuerySchema>;
export type TaskRecordList = Static<typeof TaskRecordListSchema>;
export type TaskTimeline = Static<typeof TaskTimelineSchema>;
