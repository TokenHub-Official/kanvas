import { describe, expect, it } from "vitest";

import { emailVerificationCallbackUrl } from "./email-verification.js";

describe("email verification callback", () => {
  it("keeps a bounded local return path inside the callback URL", () => {
    expect(
      emailVerificationCallbackUrl(
        "http://127.0.0.1:5173",
        "/w/01K00000000000000000000000?view=home",
      ),
    ).toBe(
      "http://127.0.0.1:5173/email-verification?returnTo=%2Fw%2F01K00000000000000000000000%3Fview%3Dhome",
    );
  });
});
