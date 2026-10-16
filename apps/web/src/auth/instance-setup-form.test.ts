import { describe, expect, it } from "vitest";

import {
  captureInstanceSetupToken,
  clearCapturedInstanceSetupToken,
  clearInstanceSetupFieldError,
  firstInstanceSetupErrorField,
  instanceSetupFailureRecovery,
  instanceSetupSessionStorageKey,
  instanceSetupTokenFromHash,
  normalizeInstanceSetupSlug,
  validateInstanceSetupFields,
} from "./instance-setup-form.js";

const validValues = {
  setupToken: `knv_setup_v1_${"a".repeat(43)}`,
  organizationName: "多麦视觉中心",
  organizationSlug: "example-studio-visual",
  workspaceName: "视觉实验室",
  workspaceSlug: "visual-lab",
} as const;

describe("instance setup form", () => {
  it("returns field-specific messages in interaction order", () => {
    const errors = validateInstanceSetupFields({
      setupToken: "",
      organizationName: "",
      organizationSlug: "",
      workspaceName: "",
      workspaceSlug: "",
    });

    expect(errors).toMatchObject({
      setupToken: "setupTokenRequired",
      organizationName: "organizationNameRequired",
      workspaceName: "workspaceNameRequired",
    });
    expect(firstInstanceSetupErrorField(errors)).toBe("setupToken");
  });

  it("rejects malformed tokens and URL identifiers before submission", () => {
    const errors = validateInstanceSetupFields({
      ...validValues,
      setupToken: "knv_setup_v1_incomplete",
      organizationSlug: "-invalid",
      workspaceSlug: "invalid-",
    });

    expect(errors.setupToken).toBe("setupTokenInvalid");
    expect(errors.organizationSlug).toBe("slugInvalid");
    expect(errors.workspaceSlug).toBe("slugInvalid");
  });

  it("accepts values aligned with the setup Contract", () => {
    expect(validateInstanceSetupFields(validValues)).toEqual({});
  });

  it("reads the one-time key from a URL fragment without accepting malformed material", () => {
    expect(
      instanceSetupTokenFromHash(
        `#setup=${encodeURIComponent(validValues.setupToken)}`,
      ),
    ).toBe(validValues.setupToken);
    expect(
      instanceSetupTokenFromHash("#setup=knv_setup_v1_incomplete"),
    ).toBeUndefined();
    expect(instanceSetupTokenFromHash("")).toBeUndefined();
  });

  it("keeps the setup key in tab storage instead of a login return URL", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(
      captureInstanceSetupToken(`#setup=${validValues.setupToken}`, storage),
    ).toBe(validValues.setupToken);
    expect(values.get(instanceSetupSessionStorageKey)).toBe(
      validValues.setupToken,
    );
    expect(captureInstanceSetupToken("", storage)).toBe(validValues.setupToken);

    clearCapturedInstanceSetupToken(storage);
    expect(captureInstanceSetupToken("", storage)).toBeUndefined();
  });

  it("normalizes Latin names but does not invent English for Chinese names", () => {
    expect(normalizeInstanceSetupSlug("  Example Studio Visual  ")).toBe(
      "example-studio-visual",
    );
    expect(normalizeInstanceSetupSlug("多麦视觉中心")).toBe("");
  });

  it("clears only the field being corrected", () => {
    expect(
      clearInstanceSetupFieldError(
        {
          organizationName: "organizationNameRequired",
          organizationSlug: "organizationSlugRequired",
        },
        "organizationName",
      ),
    ).toEqual({
      organizationSlug: "organizationSlugRequired",
    });
  });

  it("keeps service failures separate from field validation", () => {
    expect(instanceSetupFailureRecovery(503, "api_request_failed")).toEqual({
      errorCode: "unavailable",
      switchAccount: false,
    });
  });

  it("offers account switching only for a bound identity mismatch", () => {
    expect(
      instanceSetupFailureRecovery(403, "instance_setup.identity_mismatch"),
    ).toEqual({
      errorCode: "identityMismatch",
      switchAccount: true,
    });
    expect(
      instanceSetupFailureRecovery(403, "instance_setup.token_rejected"),
    ).toEqual({
      errorCode: "tokenRejected",
      setupTokenFieldError: "setupTokenRejected",
      switchAccount: false,
    });
    expect(
      instanceSetupFailureRecovery(403, "authentication.csrf_invalid"),
    ).toEqual({
      errorCode: "unavailable",
      switchAccount: false,
    });
  });

  it("routes expired sessions and concurrent setup separately", () => {
    expect(instanceSetupFailureRecovery(401, "unauthorized")).toEqual({
      errorCode: "sessionExpired",
      switchAccount: false,
    });
    expect(instanceSetupFailureRecovery(409, "instance_setup.changed")).toEqual(
      {
        errorCode: "conflict",
        switchAccount: false,
      },
    );
  });
});
