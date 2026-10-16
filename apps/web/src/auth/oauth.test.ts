import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  email: vi.fn(),
  social: vi.fn(),
  oidc: vi.fn(),
  linkSocial: vi.fn(),
  linkOidc: vi.fn(),
}));
vi.mock("./auth-client.js", () => ({
  authClient: {
    signIn: {
      email: calls.email,
      social: calls.social,
      oauth2: calls.oidc,
    },
    linkSocial: calls.linkSocial,
    oauth2: { link: calls.linkOidc },
  },
}));
import {
  emailRegistrationRequiresVerification,
  fetchLoginMethods,
  oauthErrorKey,
  signInEmailRegistration,
  startOAuth,
} from "./oauth.js";

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
describe("OAuth login and linking redirects", () => {
  it("reads the current email-verification policy with the login methods", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          emailAndPasswordEnabled: true,
          emailPasswordRegistrationEnabled: true,
          emailPasswordInvitationEnabled: true,
          emailVerificationRequired: false,
          providers: [],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(fetchLoginMethods()).resolves.toMatchObject({
      emailVerificationRequired: false,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/auth/login-methods", {
      cache: "no-store",
    });
  });

  it("defaults legacy login-method responses to verification and explicitly signs in when verification is disabled", async () => {
    expect(emailRegistrationRequiresVerification(undefined)).toBe(true);
    expect(
      emailRegistrationRequiresVerification({
        emailVerificationRequired: true,
      }),
    ).toBe(true);
    expect(
      emailRegistrationRequiresVerification({
        emailVerificationRequired: false,
      }),
    ).toBe(false);

    calls.email.mockResolvedValue({ data: { user: { id: "human" } } });
    await signInEmailRegistration("new@example.com", "password-123");
    expect(calls.email).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "password-123",
      rememberMe: true,
    });
  });

  it("fails the registration continuation when explicit sign-in is rejected", async () => {
    calls.email.mockResolvedValue({ error: { status: 401 } });
    await expect(
      signInEmailRegistration("new@example.com", "password-123"),
    ).rejects.toThrow("Registered account sign-in failed");
  });

  it.each([false, true])(
    "uses the installed OIDC client endpoint (link=%s)",
    async (link) => {
      const assign = vi.fn();
      vi.stubGlobal("window", { location: { assign } });
      const request = link ? calls.linkOidc : calls.oidc;
      request.mockResolvedValue({
        data: { url: "https://identity.example.com/authorize" },
      });
      await startOAuth(
        { id: "company", type: "oidc", name: "Company" },
        "/invite/preserved",
        "/login?returnTo=%2Finvite%2Fpreserved",
        link,
      );
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: "company",
          callbackURL: "/invite/preserved",
          errorCallbackURL: "/login?returnTo=%2Finvite%2Fpreserved",
        }),
      );
      expect(assign).toHaveBeenCalledWith(
        "https://identity.example.com/authorize",
      );
    },
  );
  it("does not navigate when the sign-in service rejects the request", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    calls.social.mockResolvedValue({ error: { status: 403 }, data: null });
    await expect(
      startOAuth(
        { id: "github", name: "GitHub", type: "github" },
        "/",
        "/login",
      ),
    ).rejects.toThrow();
    expect(assign).not.toHaveBeenCalled();
  });
  it("maps callback errors into recovery messages without echoing raw errors", () => {
    expect(oauthErrorKey("account_not_linked")).toBe("linkRequired");
    expect(oauthErrorKey("signup_disabled")).toBe("registrationClosed");
    expect(oauthErrorKey("signup disabled")).toBe("registrationClosed");
    expect(oauthErrorKey("email_doesn't_match")).toBe("emailMismatch");
    expect(oauthErrorKey("state_mismatch")).toBe("stateExpired");
    expect(oauthErrorKey("state_security_mismatch")).toBe("stateExpired");
    expect(oauthErrorKey("untrusted provider error text")).toBe("oauthFailed");
  });
});
