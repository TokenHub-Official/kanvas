import type { FastifyInstance } from "fastify";

// 2 MiB becomes 2,796,204 Base64 characters; leave room for JSON and metadata.
export const siteToolUploadBodyLimit = 2_850_000;

/** Nest RouteConfig is Fastify custom config, not top-level route options. */
export function registerSiteToolUploadLimit(instance: FastifyInstance): void {
  instance.addHook("onRoute", (options) => {
    const config = options.config as { siteToolUpload?: boolean } | undefined;
    if (config?.siteToolUpload === true)
      options.bodyLimit = siteToolUploadBodyLimit;
  });
}
