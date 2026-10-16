import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AuthenticationEngine } from "./authentication-engine.js";
import type { ServerConfig } from "../config.js";

export type AuthenticationHttpHandler = Pick<AuthenticationEngine, "handler">;

interface PublicRegistrationPolicy {
  readonly mode: "closed" | "account_only";
  readonly emailPasswordEnabled: boolean;
  readonly emailVerificationRequired: boolean;
}

const bodylessMethods = new Set(["GET", "HEAD"]);
const bodyLimitBytes = 1024 * 1024;
export const trustedClientIpHeader = "x-kanvas-trusted-client-ip";

function contentType(request: FastifyRequest): string {
  return request.headers["content-type"]?.split(";", 1)[0]?.trim() ?? "";
}

function serializedBody(
  request: FastifyRequest,
): string | Uint8Array | URLSearchParams | undefined {
  const body: unknown = request.body;
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === "string" || body instanceof Uint8Array) {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body;
  }
  const mediaType = contentType(request);
  if (mediaType === "application/json" || mediaType.endsWith("+json")) {
    return JSON.stringify(body);
  }
  throw new Error("auth_http.unsupported_parsed_body");
}

function toWebRequest(request: FastifyRequest, baseUrl: string): Request {
  const method = request.method.toUpperCase();
  const headers = fromNodeHeaders(request.raw.headers);
  const body = bodylessMethods.has(method)
    ? undefined
    : serializedBody(request);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set(trustedClientIpHeader, request.ip);

  return new Request(new URL(request.raw.url ?? request.url, baseUrl), {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

async function sendWebResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  response: Response,
): Promise<void> {
  reply.status(response.status);
  for (const [name, value] of response.headers) {
    const lowerName = name.toLowerCase();
    if (lowerName !== "set-cookie" && lowerName !== "content-length") {
      reply.header(name, value);
    }
  }
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length > 0) {
    reply.header("set-cookie", setCookies);
  }
  if (
    request.method === "HEAD" ||
    response.status === 204 ||
    response.status === 304
  ) {
    await reply.send();
    return;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await reply.send(Buffer.from(bytes));
}

export function registerAuthenticationHttpBridge(
  fastify: FastifyInstance,
  auth: AuthenticationHttpHandler,
  options: {
    readonly baseUrl: string;
    readonly basePath: string;
    readonly loginConfiguration?: ServerConfig["auth"];
    readonly readRegistrationPolicy?: () => Promise<PublicRegistrationPolicy>;
  },
): void {
  if (!options.basePath.startsWith("/")) {
    throw new Error("Authentication basePath must start with '/'.");
  }
  fastify.get(`${options.basePath}/login-methods`, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    let registrationPolicy: PublicRegistrationPolicy = {
      mode: "closed",
      emailPasswordEnabled: false,
      emailVerificationRequired: true,
    };
    try {
      registrationPolicy =
        (await options.readRegistrationPolicy?.()) ?? registrationPolicy;
    } catch {
      // This endpoint is public. Configuration lookup fails closed without
      // disclosing database failures or changing existing sign-in methods.
    }
    const emailAndPasswordEnabled =
      options.loginConfiguration?.emailAndPasswordEnabled ?? true;
    const emailVerificationAvailable = Boolean(
      options.loginConfiguration?.emailVerificationDelivery,
    );
    return {
      emailAndPasswordEnabled,
      emailPasswordInvitationEnabled:
        emailAndPasswordEnabled &&
        (!registrationPolicy.emailVerificationRequired ||
          emailVerificationAvailable),
      emailPasswordRegistrationEnabled:
        registrationPolicy.mode === "account_only" &&
        registrationPolicy.emailPasswordEnabled &&
        emailAndPasswordEnabled &&
        (!registrationPolicy.emailVerificationRequired ||
          emailVerificationAvailable),
      emailVerificationRequired: registrationPolicy.emailVerificationRequired,
      providers: (options.loginConfiguration?.oauthProviders ?? []).map(
        ({ id, name, type }) => ({ id, name, type }),
      ),
    };
  });
  fastify.route({
    method: ["GET", "POST", "OPTIONS"],
    url: `${options.basePath}/*`,
    bodyLimit: bodyLimitBytes,
    handler: async (request, reply) => {
      try {
        const webRequest = toWebRequest(request, options.baseUrl);
        const webResponse = await auth.handler(webRequest);
        await sendWebResponse(request, reply, webResponse);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "auth_http.unsupported_parsed_body"
        ) {
          await reply.status(415).send({
            code: "auth_http.unsupported_media_type",
          });
          return;
        }
        throw error;
      }
    },
  });
}
