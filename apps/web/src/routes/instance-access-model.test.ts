import { describe, expect, it } from "vitest";

import { registrationControlDisabled } from "./instance-access-model.js";

describe("Instance access registration controls", () => {
  it("disables a closed policy when the deployment has no registration method", () => {
    expect(
      registrationControlDisabled({
        enabled: false,
        emailRegistrationAvailable: false,
        oidcProviderCount: 0,
      }),
    ).toBe(true);
  });

  it("lets an administrator close a stale open policy after its methods disappear", () => {
    expect(
      registrationControlDisabled({
        enabled: true,
        emailRegistrationAvailable: false,
        oidcProviderCount: 0,
      }),
    ).toBe(false);
  });
});
