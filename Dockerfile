FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS build

# CPU binaries are bundled; skip the optional Linux x64 CUDA download.
ENV ONNXRUNTIME_NODE_INSTALL=skip
# Public default keeps open-source builds portable; CI supplies its existing mirror.
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/agent-runtime/package.json packages/agent-runtime/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/image-atomic-core/package.json packages/image-atomic-core/package.json
COPY packages/recovery/package.json packages/recovery/package.json
COPY packages/secrets/package.json packages/secrets/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY tools/background-remove-eval/package.json tools/background-remove-eval/package.json
COPY tools/image-atomic-eval/package.json tools/image-atomic-eval/package.json
COPY tools/scenario-validator/package.json tools/scenario-validator/package.json

COPY patches ./patches

RUN --mount=type=cache,id=kanvas-pnpm,target=/pnpm/store,sharing=locked \
    export COREPACK_NPM_REGISTRY="${NPM_REGISTRY%/}" && \
    pnpm --registry="$NPM_REGISTRY" --store-dir /pnpm/store install --frozen-lockfile

COPY . .

RUN COREPACK_NPM_REGISTRY="${NPM_REGISTRY%/}" pnpm build && pnpm licenses:generate

RUN --mount=type=cache,id=kanvas-pnpm,target=/pnpm/store,sharing=locked \
    export COREPACK_NPM_REGISTRY="${NPM_REGISTRY%/}" && \
    pnpm --registry="$NPM_REGISTRY" --store-dir /pnpm/store --filter @kanvas/server --prod deploy /out/server && \
    pnpm --registry="$NPM_REGISTRY" --store-dir /pnpm/store --filter @kanvas/worker --prod deploy /out/worker && \
    pnpm --registry="$NPM_REGISTRY" --store-dir /pnpm/store --filter @kanvas/recovery --prod deploy /out/recovery

FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS server

ENV NODE_ENV=production
WORKDIR /app
COPY LICENSE THIRD_PARTY.md /app/
COPY --from=build /workspace/third-party /app/third-party
COPY --from=build --chown=10001:10001 /out/server ./
COPY --from=build --chown=10001:10001 /workspace/catalog-packages/kanvas-default /app/catalog-packages/kanvas-default
ENV KANVAS_DEFAULT_CATALOG_DIRECTORY=/app/catalog-packages/kanvas-default
COPY --chmod=0555 deploy/kanvas-db /usr/local/bin/kanvas-db
USER 10001:10001
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS worker

ENV NODE_ENV=production
WORKDIR /app
COPY LICENSE THIRD_PARTY.md /app/
COPY --from=build /workspace/third-party /app/third-party
COPY --from=build --chown=10001:10001 /out/worker ./
USER 10001:10001
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM nginx:1.31.3-alpine@sha256:4a73073bd557c65b759505da037898b61f1be6cbcc3c2c3aeac22d2a470c1752 AS web

COPY LICENSE THIRD_PARTY.md /usr/share/nginx/html/
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /workspace/third-party /usr/share/nginx/html/third-party
COPY --from=build --chown=10001:10001 /workspace/apps/web/dist /usr/share/nginx/html
USER 10001:10001
EXPOSE 8080

# Default self-hosted artifact: one container, one HTTP port, all application roles.
FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS standalone
RUN apt-get update && apt-get install -y --no-install-recommends nginx tini \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /var/lib/kanvas/objects && chown 10001:10001 /var/lib/kanvas/objects \
    && chmod 0700 /var/lib/kanvas/objects
ENV NODE_ENV=production
ENV KANVAS_DEFAULT_CATALOG_DIRECTORY=/app/catalog-packages/kanvas-default
WORKDIR /app/server
COPY LICENSE THIRD_PARTY.md /app/
COPY --from=build /workspace/third-party /app/third-party
COPY --from=build --chown=10001:10001 /out/server /app/server
COPY --from=build --chown=10001:10001 /out/worker /app/worker
COPY --from=build --chown=10001:10001 /out/recovery /app/recovery
COPY --from=build /workspace/third-party /usr/share/nginx/html/third-party
COPY --from=build --chown=10001:10001 /workspace/apps/web/dist /usr/share/nginx/html
COPY --from=build --chown=10001:10001 /workspace/catalog-packages/kanvas-default /app/catalog-packages/kanvas-default
COPY deploy/runtime/supervisor.mjs /app/runtime/supervisor.mjs
COPY deploy/runtime/decode-env.mjs /app/runtime/decode-env.mjs
COPY deploy/runtime/standalone-env.mjs /app/runtime/standalone-env.mjs
ENV NODE_OPTIONS="--import=/app/runtime/standalone-env.mjs"
COPY deploy/runtime/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=0555 deploy/runtime/entrypoint.sh /usr/local/bin/kanvas
COPY --chmod=0555 deploy/runtime/kanvas-db /usr/local/bin/kanvas-db
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/kanvas"]
CMD ["all"]
