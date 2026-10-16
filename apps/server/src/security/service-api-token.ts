import { createHash } from "node:crypto";

const tokenPattern = /^[\x21-\x7E]{43,512}$/u;

export class ServiceApiTokenFormatError extends Error {
  public constructor() {
    super("Service API token has an invalid opaque token format.");
    this.name = "ServiceApiTokenFormatError";
  }
}

export function digestServiceApiToken(rawToken: string): string {
  if (!tokenPattern.test(rawToken)) {
    throw new ServiceApiTokenFormatError();
  }
  return `sha256:${createHash("sha256")
    .update("kanvas:service-api-token:v1\0")
    .update(rawToken, "ascii")
    .digest("hex")}`;
}

export function readBearerToken(
  authorization: string | undefined,
): string | undefined {
  if (!authorization) {
    return undefined;
  }
  const match = /^Bearer ([\x21-\x7E]+)$/u.exec(authorization);
  if (!match?.[1]) {
    throw new ServiceApiTokenFormatError();
  }
  return match[1];
}
