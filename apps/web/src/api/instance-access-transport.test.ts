import { describe, expect, it, vi } from "vitest";

import {
  addWorkspaceMember,
  changeInstanceWorkspaceMembership,
  fetchInstanceAccessOverview,
  fetchInstanceRegistrationSettings,
  grantInstanceWorkspaceAccess,
  updateInstanceRegistrationPolicy,
} from "./transport.js";

describe("Instance access transport", () => {
  it("reads administrator registration and access projections", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          policy: {
            mode: "closed",
            emailPasswordEnabled: false,
            emailVerificationRequired: true,
            oidcProviderIds: [],
            version: 0,
          },
          capabilities: {
            emailPasswordRegistrationAvailable: false,
            emailVerificationDelivery: "unavailable",
            oidcProviders: [{ id: "matrix", name: "Internal SSO" }],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ principals: [], invitations: [], workspaces: [] }),
      );

    await fetchInstanceRegistrationSettings(fetcher);
    await fetchInstanceAccessOverview(fetcher);

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/v1/instance/registration-settings",
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/v1/instance/access-overview");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
    });
  });

  it("sends CSRF-protected policy and Workspace grant mutations", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
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
      )
      .mockResolvedValueOnce(
        Response.json({
          memberships: [
            {
              workspaceId: "01K00000000000000000000002",
              membershipId: "01K00000000000000000000003",
              role: "editor",
              status: "active",
              version: 1,
            },
          ],
        }),
      );

    await updateInstanceRegistrationPolicy(
      "csrf-token",
      {
        expectedVersion: 0,
        mode: "account_only",
        emailPasswordEnabled: false,
        emailVerificationRequired: true,
        oidcProviderIds: ["matrix"],
      },
      fetcher,
    );
    await grantInstanceWorkspaceAccess(
      "csrf-token",
      "01K00000000000000000000001",
      {
        assignments: [
          {
            workspaceId: "01K00000000000000000000002",
            role: "editor",
          },
        ],
      },
      fetcher,
    );

    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get("x-kanvas-csrf")).toBe(
        "csrf-token",
      );
    }
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "PUT" });
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "/api/v1/instance/principals/01K00000000000000000000001/workspace-memberships",
    );
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });
});

it("keeps workspace member additions and site administrator changes in distinct authority scopes", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
    Promise.resolve(
      Response.json({
        membershipId: "membership",
        role: "viewer",
        status: "active",
        version: 1,
      }),
    ),
  );
  await addWorkspaceMember(
    { workspaceId: "workspace-a", csrfToken: "csrf" },
    { email: "member@example.com", role: "viewer" },
    fetcher,
  );
  await changeInstanceWorkspaceMembership(
    "csrf",
    "workspace-b",
    "principal",
    { expectedVersion: 1, role: "editor", status: "active" },
    fetcher,
  );
  const workspaceHeaders = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
  const siteHeaders = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
  expect(workspaceHeaders.get("x-kanvas-workspace-id")).toBe("workspace-a");
  expect(siteHeaders.has("x-kanvas-workspace-id")).toBe(false);
  expect(siteHeaders.get("x-kanvas-csrf")).toBe("csrf");
  expect(fetcher.mock.calls[1]?.[0]).toBe(
    "/api/v1/instance/workspaces/workspace-b/members/principal",
  );
});
