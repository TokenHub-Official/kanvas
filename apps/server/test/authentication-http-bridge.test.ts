import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import {
  registerAuthenticationHttpBridge,
  trustedClientIpHeader,
  type AuthenticationHttpHandler,
} from "../src/auth/authentication-http-bridge.js";

describe("Better Auth Fastify HTTP bridge", () => {
  let instance: FastifyInstance | undefined;

  it("publishes only safe login metadata without invoking authentication", async () => {
    instance = fastify();
    registerAuthenticationHttpBridge(
      instance,
      {
        handler: () => {
          throw new Error("must not authenticate metadata");
        },
      },
      {
        baseUrl: "http://127.0.0.1:3000",
        basePath: "/api/auth",
        loginConfiguration: {
          baseUrl: "http://127.0.0.1:3000",
          basePath: "/api/auth",
          secret: "private-auth-secret",
          trustedOrigins: [],
          secureCookies: false,
          emailAndPasswordEnabled: false,
          sessionExpiresInSeconds: 3600,
          sessionUpdateAgeSeconds: 600,
          oauthProviders: [
            {
              id: "github",
              name: "GitHub",
              type: "github",
              clientId: "private-client",
              clientSecret: "private-secret",
            },
          ],
        },
      },
    );
    const response = await instance.inject({
      method: "GET",
      url: "/api/auth/login-methods",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      emailAndPasswordEnabled: false,
      emailPasswordInvitationEnabled: false,
      emailPasswordRegistrationEnabled: false,
      emailVerificationRequired: true,
      providers: [{ id: "github", name: "GitHub", type: "github" }],
    });
    expect(response.body).not.toContain("private");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("publishes email registration only when delivery and policy both allow it", async () => {
    instance = fastify();
    registerAuthenticationHttpBridge(
      instance,
      { handler: () => Promise.resolve(new Response()) },
      {
        baseUrl: "http://127.0.0.1:3000",
        basePath: "/api/auth",
        loginConfiguration: {
          baseUrl: "http://127.0.0.1:3000",
          basePath: "/api/auth",
          secret: "private-auth-secret",
          trustedOrigins: [],
          secureCookies: false,
          emailAndPasswordEnabled: true,
          emailVerificationDelivery: {
            kind: "development_outbox",
            file: "/tmp/kanvas-email-outbox.jsonl",
            fromAddress: "kanvas@localhost.invalid",
            fromName: "Kanvas",
          },
          sessionExpiresInSeconds: 3600,
          sessionUpdateAgeSeconds: 600,
        },
        readRegistrationPolicy: () =>
          Promise.resolve({
            mode: "account_only",
            emailPasswordEnabled: true,
            emailVerificationRequired: true,
          }),
      },
    );

    const response = await instance.inject({
      method: "GET",
      url: "/api/auth/login-methods",
    });
    expect(response.json()).toMatchObject({
      emailAndPasswordEnabled: true,
      emailPasswordInvitationEnabled: true,
      emailPasswordRegistrationEnabled: true,
      emailVerificationRequired: true,
    });
  });

  it("keeps invitation email available when autonomous registration is closed", async () => {
    instance = fastify();
    registerAuthenticationHttpBridge(
      instance,
      { handler: () => Promise.resolve(new Response()) },
      {
        baseUrl: "http://127.0.0.1:3000",
        basePath: "/api/auth",
        loginConfiguration: {
          baseUrl: "http://127.0.0.1:3000",
          basePath: "/api/auth",
          secret: "private-auth-secret",
          trustedOrigins: [],
          secureCookies: false,
          emailAndPasswordEnabled: true,
          emailVerificationDelivery: {
            kind: "development_outbox",
            file: "/tmp/kanvas-email-outbox.jsonl",
            fromAddress: "kanvas@localhost.invalid",
            fromName: "Kanvas",
          },
          sessionExpiresInSeconds: 3600,
          sessionUpdateAgeSeconds: 600,
        },
        readRegistrationPolicy: () =>
          Promise.resolve({
            mode: "closed",
            emailPasswordEnabled: false,
            emailVerificationRequired: true,
          }),
      },
    );

    const response = await instance.inject({
      method: "GET",
      url: "/api/auth/login-methods",
    });
    expect(response.json()).toMatchObject({
      emailPasswordInvitationEnabled: true,
      emailPasswordRegistrationEnabled: false,
      emailVerificationRequired: true,
    });
  });

  it("publishes registration and invitation email without delivery when verification is exempt", async () => {
    instance = fastify();
    registerAuthenticationHttpBridge(
      instance,
      { handler: () => Promise.resolve(new Response()) },
      {
        baseUrl: "http://127.0.0.1:3000",
        basePath: "/api/auth",
        loginConfiguration: {
          baseUrl: "http://127.0.0.1:3000",
          basePath: "/api/auth",
          secret: "private-auth-secret",
          trustedOrigins: [],
          secureCookies: false,
          emailAndPasswordEnabled: true,
          sessionExpiresInSeconds: 3600,
          sessionUpdateAgeSeconds: 600,
        },
        readRegistrationPolicy: () =>
          Promise.resolve({
            mode: "account_only",
            emailPasswordEnabled: true,
            emailVerificationRequired: false,
          }),
      },
    );

    const response = await instance.inject({
      method: "GET",
      url: "/api/auth/login-methods",
    });
    expect(response.json()).toMatchObject({
      emailPasswordInvitationEnabled: true,
      emailPasswordRegistrationEnabled: true,
      emailVerificationRequired: false,
    });
  });

  it("fails closed when public registration policy lookup is unavailable", async () => {
    instance = fastify();
    registerAuthenticationHttpBridge(
      instance,
      { handler: () => Promise.resolve(new Response()) },
      {
        baseUrl: "http://127.0.0.1:3000",
        basePath: "/api/auth",
        readRegistrationPolicy: () =>
          Promise.reject(new Error("database unavailable")),
      },
    );

    const response = await instance.inject({
      method: "GET",
      url: "/api/auth/login-methods",
    });
    expect(response.json()).toMatchObject({
      emailPasswordRegistrationEnabled: false,
      emailVerificationRequired: true,
    });
  });

  afterEach(async () => {
    await instance?.close();
    instance = undefined;
  });

  it("preserves method, URL, JSON body and repeated Set-Cookie headers", async () => {
    let received: Request | undefined;
    const headers = new Headers({
      "content-type": "application/json",
      location: "/signed-in",
    });
    headers.append(
      "set-cookie",
      "kanvas.session_token=one; Path=/; HttpOnly; SameSite=Lax",
    );
    headers.append(
      "set-cookie",
      "kanvas.oauth_state=two; Path=/; HttpOnly; SameSite=Lax",
    );
    const auth: AuthenticationHttpHandler = {
      handler: (request) => {
        received = request;
        return Promise.resolve(
          new Response(JSON.stringify({ accepted: true }), {
            status: 201,
            headers,
          }),
        );
      },
    };
    instance = fastify();
    registerAuthenticationHttpBridge(instance, auth, {
      baseUrl: "http://127.0.0.1:3000",
      basePath: "/api/auth",
    });

    const response = await instance.inject({
      method: "POST",
      url: "/api/auth/sign-in/email?return=1",
      headers: {
        cookie: "kanvas.session_token=old",
        [trustedClientIpHeader]: "203.0.113.99",
      },
      payload: {
        email: "designer@example.com",
        password: "not-a-real-password",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe("/signed-in");
    expect(response.cookies.map(({ name }) => name)).toEqual([
      "kanvas.session_token",
      "kanvas.oauth_state",
    ]);
    expect(received?.method).toBe("POST");
    expect(received?.url).toBe(
      "http://127.0.0.1:3000/api/auth/sign-in/email?return=1",
    );
    expect(received?.headers.get("cookie")).toBe("kanvas.session_token=old");
    expect(received?.headers.get(trustedClientIpHeader)).toBe("127.0.0.1");
    await expect(received?.json()).resolves.toEqual({
      email: "designer@example.com",
      password: "not-a-real-password",
    });
  });

  it("rejects parsed body types the Auth handler cannot interpret", async () => {
    const auth: AuthenticationHttpHandler = {
      handler: () => {
        throw new Error("must not reach the auth engine");
      },
    };
    instance = fastify();
    instance.addContentTypeParser(
      "application/x-auth-test",
      (_request, body, done) => {
        body.resume();
        done(null, { unsupported: true });
      },
    );
    registerAuthenticationHttpBridge(instance, auth, {
      baseUrl: "http://127.0.0.1:3000",
      basePath: "/api/auth",
    });

    const response = await instance.inject({
      method: "POST",
      url: "/api/auth/custom",
      headers: {
        "content-type": "application/x-auth-test",
      },
      payload: "opaque",
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toEqual({
      code: "auth_http.unsupported_media_type",
    });
  });
});
