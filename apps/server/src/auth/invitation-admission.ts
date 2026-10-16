import { createHmac, timingSafeEqual } from "node:crypto";

import { createAuthMiddleware } from "better-auth/api";

import type { ServerConfig } from "../config.js";

const admissionLifetimeSeconds = 5 * 60;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const admissionVersion = 1;

interface InvitationAdmissionPayload {
  readonly expiresAt: number;
  readonly invitationTokenHash: string;
  readonly version: typeof admissionVersion;
}

type InvitationAdmissionConfig = Pick<
  ServerConfig["auth"],
  "secret" | "secureCookies"
>;

function cookieName(config: InvitationAdmissionConfig): string {
  return `${config.secureCookies ? "__Host-" : ""}kanvas.invitation_admission`;
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update("kanvas:invitation-admission:v1\0")
    .update(payload)
    .digest();
}

function cookieValue(headers: Headers | undefined, name: string) {
  const cookie = headers?.get("cookie");
  if (!cookie) return undefined;
  for (const entry of cookie.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    return entry.slice(separator + 1).trim();
  }
  return undefined;
}

function serializeCookie(
  name: string,
  value: string,
  maxAge: number,
  expiresAt: Date,
  secure: boolean,
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${String(maxAge)}`,
    `Expires=${expiresAt.toUTCString()}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function issueInvitationAdmissionCookie(options: {
  readonly config: InvitationAdmissionConfig;
  readonly invitationExpiresAt: Date;
  readonly invitationTokenHash: string;
  readonly now: Date;
}): string {
  if (!digestPattern.test(options.invitationTokenHash)) {
    throw new TypeError("Invitation admission requires a token digest.");
  }
  const expiresAt = new Date(
    Math.min(
      options.invitationExpiresAt.getTime(),
      options.now.getTime() + admissionLifetimeSeconds * 1_000,
    ),
  );
  const maxAge = Math.floor(
    (expiresAt.getTime() - options.now.getTime()) / 1_000,
  );
  if (maxAge < 1) {
    throw new RangeError("Invitation admission is already expired.");
  }
  const payload: InvitationAdmissionPayload = {
    expiresAt: Math.floor(expiresAt.getTime() / 1_000),
    invitationTokenHash: options.invitationTokenHash,
    version: admissionVersion,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const value = `${encodedPayload}.${signature(encodedPayload, options.config.secret).toString("base64url")}`;
  return serializeCookie(
    cookieName(options.config),
    value,
    maxAge,
    expiresAt,
    options.config.secureCookies,
  );
}

export function clearInvitationAdmissionCookie(
  config: InvitationAdmissionConfig,
): string {
  return serializeCookie(
    cookieName(config),
    "",
    0,
    new Date(0),
    config.secureCookies,
  );
}

export function invitationAdmissionTokenHash(
  headers: Headers | undefined,
  config: InvitationAdmissionConfig,
  now: Date,
): string | undefined {
  const value = cookieValue(headers, cookieName(config));
  if (!value || value.length > 1_024) return undefined;
  const [encodedPayload, encodedSignature, extra] = value.split(".");
  if (!encodedPayload || !encodedSignature || extra !== undefined) {
    return undefined;
  }
  let actualSignature: Buffer;
  try {
    actualSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    return undefined;
  }
  const expectedSignature = signature(encodedPayload, config.secret);
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return undefined;
  }
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return undefined;
    }
    const record = payload as Readonly<Record<string, unknown>>;
    if (
      record.version !== admissionVersion ||
      typeof record.expiresAt !== "number" ||
      !Number.isSafeInteger(record.expiresAt) ||
      record.expiresAt <= Math.floor(now.getTime() / 1_000) ||
      typeof record.invitationTokenHash !== "string" ||
      !digestPattern.test(record.invitationTokenHash)
    ) {
      return undefined;
    }
    return record.invitationTokenHash;
  } catch {
    return undefined;
  }
}

export function clearInvitationAdmissionAfterOAuth(
  config: InvitationAdmissionConfig,
) {
  return createAuthMiddleware((context) => {
    if (
      !context.path.startsWith("/oauth2/callback/") &&
      !context.path.startsWith("/callback/")
    ) {
      return Promise.resolve();
    }
    if (!cookieValue(context.headers, cookieName(config))) {
      return Promise.resolve();
    }
    const headers = context.context.responseHeaders ?? new Headers();
    headers.append("set-cookie", clearInvitationAdmissionCookie(config));
    context.context.responseHeaders = headers;
    return Promise.resolve();
  });
}
