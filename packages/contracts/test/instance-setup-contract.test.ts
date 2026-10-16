import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  InstanceSetupSummarySchema,
  InstanceSetupRedemptionBodySchema,
  RegisterInstanceSetupAccountBodySchema,
  redeemInstanceSetupRoute,
  registerInstanceSetupAccountRoute,
  resolveInstanceSetupRoute,
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

describe("instance setup API contract", () => {
  it("is a Human Session mutation without an existing Workspace scope", () => {
    expect(redeemInstanceSetupRoute.security).toEqual(["browserSession"]);
    expect(redeemInstanceSetupRoute.idempotency).toBe("none");
    expect(routeRegistry).toContain(redeemInstanceSetupRoute);
  });

  it("allows only a valid setup grant to resolve and register the first account", () => {
    expect(resolveInstanceSetupRoute.security).toEqual(["public"]);
    expect(registerInstanceSetupAccountRoute.security).toEqual(["public"]);
    expect(routeRegistry).toContain(resolveInstanceSetupRoute);
    expect(routeRegistry).toContain(registerInstanceSetupAccountRoute);

    const validateRegistration = createAjv().compile(
      RegisterInstanceSetupAccountBodySchema,
    );
    expect(
      validateRegistration({
        setupToken: "knv_setup_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi01234567",
        email: "owner@example.com",
        displayName: "Owner",
        password: "long-enough-password",
      }),
    ).toBe(true);
    expect(
      validateRegistration({
        setupToken: "knv_setup_v1_incomplete",
        email: "owner@example.com",
        displayName: "Owner",
        password: "short",
      }),
    ).toBe(false);

    const validateSummary = createAjv().compile(InstanceSetupSummarySchema);
    expect(validateSummary({ accountRegistration: "available" })).toBe(true);
    expect(validateSummary({ accountRegistration: "unrestricted" })).toBe(
      false,
    );
  });

  it("accepts only the bounded one-time grant and initial scope names", () => {
    const validate = createAjv().compile(InstanceSetupRedemptionBodySchema);
    const body = {
      setupToken: "knv_setup_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi01234567",
      organizationSlug: "kanvas",
      organizationName: "Kanvas",
      workspaceSlug: "design",
      workspaceName: "Design",
    };

    expect(validate(body)).toBe(true);
    expect(validate({ ...body, role: "owner" })).toBe(false);
    expect(
      validate({
        ...body,
        organizationSlug: "../escape",
      }),
    ).toBe(false);
  });
});
