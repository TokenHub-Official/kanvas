#!/usr/bin/env node

import { randomBytes } from "node:crypto";

import { ulid } from "ulid";

import { loadDatabaseConnectionConfig } from "../configuration/database-config.js";
import { createDatabaseRuntime } from "../runtime/database-runtime.js";
import {
  digestInstanceSetupBinding,
  digestInstanceSetupToken,
  instanceSetupTokenPrefix,
  normalizeVerifiedEmail,
  type InstanceSetupBindingMode,
} from "../runtime/instance-bootstrap-store.js";
import { formatInstanceSetupUrl } from "./bootstrap-admin-url.js";

const unboundAcknowledgement = "I_ACKNOWLEDGE_UNBOUND_INSTANCE_BOOTSTRAP";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = process.argv
    .slice(2)
    .find((candidate) => candidate.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
  return value || undefined;
}

function parseExpiryHours(value: string | undefined): number {
  const hours = value === undefined ? 1 : Number(value);
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > 168) {
    throw new Error("--expires-in-hours must be an integer between 1 and 168.");
  }
  return hours;
}

const authSubject = argument("auth-subject");
const email = argument("email");
const allowUnbound = argument("allow-unbound");
const requestedBindings = [
  authSubject !== undefined,
  email !== undefined,
  allowUnbound !== undefined,
].filter(Boolean).length;
if (requestedBindings !== 1) {
  throw new Error(
    "Choose exactly one setup binding: --auth-subject, --email, or --allow-unbound.",
  );
}
if (allowUnbound !== undefined && allowUnbound !== unboundAcknowledgement) {
  throw new Error(
    `Unbound setup requires --allow-unbound=${unboundAcknowledgement}.`,
  );
}

let bindingMode: InstanceSetupBindingMode;
let bindingHash: string | undefined;
if (authSubject) {
  bindingMode = "auth_subject";
  bindingHash = digestInstanceSetupBinding(bindingMode, authSubject);
} else if (email) {
  bindingMode = "verified_email_hash";
  bindingHash = digestInstanceSetupBinding(
    bindingMode,
    normalizeVerifiedEmail(email),
  );
} else {
  bindingMode = "unbound";
}

const instanceId = process.env.KANVAS_INSTANCE_ID?.trim();
if (!instanceId) {
  throw new Error(
    "Missing required deployment configuration: KANVAS_INSTANCE_ID",
  );
}
const now = new Date();
const expiresAt = new Date(
  now.getTime() +
    parseExpiryHours(argument("expires-in-hours")) * 60 * 60 * 1000,
);
const rawToken = `knv_setup_v1_${randomBytes(32).toString("base64url")}`;
const database = createDatabaseRuntime({
  connection: loadDatabaseConnectionConfig(process.env),
  instanceId,
});

try {
  const issued = await database.instanceBootstrap.issueSetupToken({
    setupTokenId: ulid(),
    tokenPrefix: instanceSetupTokenPrefix(rawToken),
    tokenHash: digestInstanceSetupToken(rawToken),
    hashVersion: 1,
    bindingMode,
    ...(bindingHash ? { bindingHash } : {}),
    expiresAt,
    now,
    auditEventId: ulid(),
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        setupUrl: formatInstanceSetupUrl(
          rawToken,
          process.env.KANVAS_AUTH_BASE_URL,
        ),
        setupToken: rawToken,
        bindingMode: issued.bindingMode,
        expiresAt: issued.expiresAt.toISOString(),
        warning:
          bindingMode === "unbound"
            ? "HIGH RISK: any authenticated Human holding this one-time token can initialize the instance."
            : "Open setupUrl in a browser. The embedded one-time token is shown only in this output. Do not place it in logs, shell arguments, configuration, or source control.",
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await database.close();
}
