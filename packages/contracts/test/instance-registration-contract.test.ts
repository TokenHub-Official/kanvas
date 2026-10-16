import { Value } from "@sinclair/typebox/value";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  AddWorkspaceMemberBodySchema,
  ChangeInstancePrincipalStatusBodySchema,
  GrantInstanceWorkspaceAccessBodySchema,
  InstanceAccessOverviewSchema,
  InstanceRegistrationSettingsSchema,
  UpdateInstanceRegistrationPolicyBodySchema,
  getInstanceAccessOverviewRoute,
  getInstanceRegistrationSettingsRoute,
  grantInstanceWorkspaceAccessRoute,
  routeRegistry,
  updateInstanceRegistrationPolicyRoute,
} from "../src/api/index.js";

describe("Instance Registration contracts", () => {
  it("registers an Instance Administrator read and mutation surface", () => {
    expect(getInstanceRegistrationSettingsRoute).toMatchObject({
      method: "GET",
      path: "/api/v1/instance/registration-settings",
      security: ["browserSession"],
    });
    expect(updateInstanceRegistrationPolicyRoute).toMatchObject({
      method: "PUT",
      path: "/api/v1/instance/registration-settings",
      security: ["browserSession"],
    });
    expect(routeRegistry).toContain(getInstanceRegistrationSettingsRoute);
    expect(routeRegistry).toContain(updateInstanceRegistrationPolicyRoute);
    expect(getInstanceAccessOverviewRoute).toMatchObject({
      method: "GET",
      security: ["browserSession"],
    });
    expect(grantInstanceWorkspaceAccessRoute).toMatchObject({
      method: "POST",
      security: ["browserSession"],
    });
    expect(routeRegistry).toContain(getInstanceAccessOverviewRoute);
    expect(routeRegistry).toContain(grantInstanceWorkspaceAccessRoute);
  });

  it("keeps policy state separate from deployment capabilities", () => {
    expect(
      Value.Check(InstanceRegistrationSettingsSchema, {
        policy: {
          mode: "account_only",
          emailPasswordEnabled: false,
          emailVerificationRequired: true,
          oidcProviderIds: ["matrix"],
          version: 1,
        },
        capabilities: {
          emailPasswordRegistrationAvailable: false,
          emailVerificationDelivery: "unavailable",
          oidcProviders: [{ id: "matrix", name: "Internal SSO" }],
        },
      }),
    ).toBe(true);
  });

  it("requires an explicit email verification policy when saving", () => {
    const update = {
      expectedVersion: 0,
      mode: "account_only",
      emailPasswordEnabled: true,
      oidcProviderIds: [],
    };
    expect(
      Value.Check(UpdateInstanceRegistrationPolicyBodySchema, update),
    ).toBe(false);
    expect(
      Value.Check(UpdateInstanceRegistrationPolicyBodySchema, {
        ...update,
        emailVerificationRequired: false,
      }),
    ).toBe(true);
  });

  it("bounds updates to canonical registration methods", () => {
    expect(
      Value.Check(UpdateInstanceRegistrationPolicyBodySchema, {
        expectedVersion: 0,
        mode: "account_only",
        emailPasswordEnabled: false,
        emailVerificationRequired: true,
        oidcProviderIds: ["matrix"],
      }),
    ).toBe(true);
    expect(
      Value.Check(UpdateInstanceRegistrationPolicyBodySchema, {
        expectedVersion: 0,
        mode: "account_only",
        emailPasswordEnabled: false,
        emailVerificationRequired: true,
        oidcProviderIds: ["Matrix Provider"],
      }),
    ).toBe(false);
  });

  it("projects account and membership facts while retaining explicit role grants", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    (addFormats as unknown as (instance: Ajv2020) => unknown)(ajv);
    expect(
      ajv.compile(InstanceAccessOverviewSchema)({
        principals: [
          {
            principalId: "01K00000000000000000000001",
            displayName: "Member",
            email: "member@example.com",
            emailVerified: true,
            registeredAt: "2026-09-15T00:00:00.000Z",
            status: "active",
            version: 1,
            isInstanceAdministrator: false,
            memberships: [],
          },
        ],
        invitations: [],
        workspaces: [
          {
            organizationId: "01K00000000000000000000002",
            organizationName: "Kanvas",
            workspaceId: "01K00000000000000000000003",
            workspaceName: "Design",
          },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(GrantInstanceWorkspaceAccessBodySchema, {
        assignments: [
          {
            workspaceId: "01K00000000000000000000003",
            role: "editor",
          },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(GrantInstanceWorkspaceAccessBodySchema, {
        assignments: [
          {
            workspaceId: "01K00000000000000000000003",
            role: "owner",
          },
        ],
      }),
    ).toBe(false);
  });
});

it("validates explicit account addition and bounded account status changes", () => {
  expect(
    Value.Check(AddWorkspaceMemberBodySchema, {
      email: "member@example.com",
      role: "editor",
    }),
  ).toBe(true);
  expect(
    Value.Check(AddWorkspaceMemberBodySchema, {
      email: "not-email",
      role: "editor",
    }),
  ).toBe(false);
  expect(
    Value.Check(ChangeInstancePrincipalStatusBodySchema, {
      expectedVersion: 1,
      status: "suspended",
    }),
  ).toBe(true);
  expect(
    Value.Check(ChangeInstancePrincipalStatusBodySchema, {
      expectedVersion: 1,
      status: "revoked",
    }),
  ).toBe(false);
});
