import { describe, expect, it } from "vitest";

import { validateRegistrationFields } from "./registration-form.js";

describe("registration form", () => {
  it("accepts a complete verified-email registration request", () => {
    expect(
      validateRegistrationFields({
        displayName: "Kanvas Member",
        email: "member@example.com",
        password: "correct horse battery staple",
        passwordConfirmation: "correct horse battery staple",
      }),
    ).toEqual({});
  });

  it("reports invalid identity and password fields without hiding mismatches", () => {
    expect(
      validateRegistrationFields({
        displayName: " ",
        email: "not-an-email",
        password: "short",
        passwordConfirmation: "different",
      }),
    ).toEqual({
      displayName: "required",
      email: "invalid",
      password: "length",
      passwordConfirmation: "mismatch",
    });
  });
});
