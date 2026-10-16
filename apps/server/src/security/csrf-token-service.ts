import { createHmac, timingSafeEqual } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import type { ServerConfig } from "../config.js";
import { SERVER_CONFIG } from "../tokens.js";

const csrfDomain = "kanvas:browser-csrf:v1";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;

function material(sessionId: string): string {
  return `${csrfDomain}\0${sessionId}`;
}

@Injectable()
export class CsrfTokenService {
  public constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  public issue(sessionId: string): string {
    return createHmac("sha256", this.config.auth.secret)
      .update(material(sessionId))
      .digest("base64url");
  }

  public verify(sessionId: string, candidate: string): boolean {
    if (!tokenPattern.test(candidate)) {
      return false;
    }
    const expected = Buffer.from(this.issue(sessionId), "ascii");
    const received = Buffer.from(candidate, "ascii");
    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }
}
