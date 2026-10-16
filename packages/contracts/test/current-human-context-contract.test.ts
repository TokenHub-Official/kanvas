import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  CurrentHumanContextSchema,
  getCurrentHumanContextRoute,
  routeRegistry,
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

describe("current Human context contract", () => {
  it("registers a browser-session query without accepting a Workspace scope", () => {
    expect(getCurrentHumanContextRoute).toMatchObject({
      method: "GET",
      path: "/api/v1/auth/current-human-context",
      security: ["browserSession"],
      idempotency: "none",
    });
    expect(
      "request" in getCurrentHumanContextRoute
        ? getCurrentHumanContextRoute.request
        : undefined,
    ).toBeUndefined();
    expect(routeRegistry).toContain(getCurrentHumanContextRoute);
  });

  it("projects only display identity, accessible Workspaces, permissions, and bounded versions", () => {
    const validate = createAjv().compile(CurrentHumanContextSchema);
    const response = {
      authenticated: true,
      csrfToken: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi01234567",
      human: {
        principalId: "01K00000000000000000000001",
        status: "active",
        displayName: "Lin",
        verifiedEmail: "lin@example.com",
      },
      workspaces: [
        {
          id: "01K00000000000000000000002",
          slug: "visual-design",
          name: "视觉设计",
          organization: {
            id: "01K00000000000000000000003",
            name: "Kanvas",
          },
          membership: {
            id: "01K00000000000000000000004",
            role: "editor",
            version: 2,
          },
          permissions: [
            "workspace.read",
            "canvas.read",
            "canvas.write",
            "asset.read",
          ],
        },
      ],
      authorizationModelVersion: 1,
      contextVersion:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };

    expect(validate(response)).toBe(true);
    expect(
      validate({
        ...response,
        sessionId: "secret-session",
      }),
    ).toBe(false);
    expect(
      validate({
        ...response,
        workspaces: [
          {
            ...response.workspaces[0],
            permissions: [
              ...response.workspaces[0]!.permissions,
              "provider.secret.read",
            ],
          },
        ],
      }),
    ).toBe(false);
  });
});
