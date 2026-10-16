import type { FastifyInstance } from "fastify";

export const trustedImageUploadContentTypes = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/octet-stream",
] as const);

export const skillPackageUploadContentTypes = Object.freeze([
  "application/zip",
  "application/x-zip-compressed",
] as const);

export function isSkillPackageUploadContentType(value: unknown): boolean {
  return (
    typeof value === "string" &&
    [...skillPackageUploadContentTypes, "application/octet-stream"].includes(
      value.toLowerCase(),
    )
  );
}

export function isBrowserOutputContentType(value: unknown): boolean {
  return (
    typeof value === "string" &&
    trustedImageUploadContentTypes.includes(
      value.toLowerCase() as (typeof trustedImageUploadContentTypes)[number],
    )
  );
}

export const isTrustedImageUploadContentType = isBrowserOutputContentType;

/**
 * Fastify does not accept arbitrary binary request bodies by default. Keep
 * these payloads as streams so the trusted storage adapter, rather than the
 * HTTP framework, owns byte limits and backpressure.
 */
export function registerRawUploadContentParser(fastify: FastifyInstance): void {
  fastify.addContentTypeParser(
    [...trustedImageUploadContentTypes, ...skillPackageUploadContentTypes],
    (_request, payload, done) => {
      done(null, payload);
    },
  );
}
