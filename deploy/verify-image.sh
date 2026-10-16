#!/bin/sh
set -eu

target=${1:?Supply standalone, server, worker or web}
image=${2:?Supply the built image reference}

# Verify the artifact itself, even when built outside the repository Dockerfile.
if [ "$target" = standalone ] || [ "$target" = server ] || [ "$target" = worker ]; then
  docker run --rm --network none --read-only "$image" node --input-type=module --eval \
    'import {readdirSync} from "node:fs"; function check(path) { for(const e of readdirSync(path,{withFileTypes:true})) { const p=path+"/"+e.name; if(e.isDirectory()) check(p); else if(e.name.startsWith(".env") && !e.name.endsWith(".example")) throw new Error("Unexpected environment file in runtime package"); } } check("/app"); for (const path of ["/app/LICENSE", "/app/THIRD_PARTY.md", "/app/third-party/NOTICES.txt"]) { if (!readdirSync(path.slice(0, path.lastIndexOf("/"))).includes(path.slice(path.lastIndexOf("/") + 1))) throw new Error("Missing distribution notice: " + path); } console.log("Runtime package contains no environment files.");'
fi

# Only fake configuration is used. Checks run with no network access and do not
# start workers or invoke any model. This is packaging evidence, not runtime E2E.
case "$target" in
  standalone)
    docker run --rm --network none --read-only "$image" db --help
    docker run --rm --network none --read-only "$image" db plan
    docker run --rm --network none --read-only "$image" node /app/recovery/dist/cli/main.js --help
    docker run --rm --network none --read-only "$image" node --input-type=module --eval 'import {statSync} from "node:fs"; statSync("/app/server/node_modules/@kanvas/database/dist/cli/deployment-readiness.js");'
    docker run --rm --network none --read-only --tmpfs /tmp:mode=1777 "$image" nginx -t
    docker run --rm --network none --read-only "$image" node --input-type=module --eval \
      'import {statSync} from "node:fs"; if(!statSync("/usr/share/nginx/html/index.html").size) throw Error("Missing web bundle"); const {loadDefaultCatalogPackageV1}=await import("@kanvas/database"); const c=await loadDefaultCatalogPackageV1(); if(!c.assets.length) throw Error("Missing Catalog");'
    for role in server worker; do
      docker run --rm --network none --read-only \
        -e KANVAS_ENVIRONMENT=production \
        -e KANVAS_INSTANCE_ID=packaging-verification \
        -e KANVAS_DATABASE_URL=mysql://test:test@127.0.0.1/unused \
        -e KANVAS_REDIS_URL=redis://:test@127.0.0.1/0 \
        -e KANVAS_AUTH_BASE_URL=https://example.invalid \
        -e KANVAS_AUTH_SECRET=packaging-only-auth-secret-not-a-real-key \
        "$image" "$role" --check-config
    done
    docker run --rm -i --network none --read-only --tmpfs /tmp:mode=1777 \
      "$image" node --input-type=module < deploy/runtime/container-smoke.mjs
    ;;
  server)
    docker run --rm --network none --read-only "$image" kanvas-db --help
    docker run --rm --network none --read-only "$image" kanvas-db plan
    docker run --rm --network none --read-only "$image" \
      node --input-type=module --eval \
      'const {loadDefaultCatalogPackageV1}=await import("@kanvas/database"); const catalog=await loadDefaultCatalogPackageV1(); if(!catalog.assets.length) throw new Error("Missing bundled Catalog assets"); console.log("Bundled Catalog loaded.");'
    docker run --rm --network none --read-only \
      -e KANVAS_ENVIRONMENT=production \
      -e KANVAS_INSTANCE_ID=packaging-verification \
      -e KANVAS_DATABASE_URL=mysql://test:test@127.0.0.1/unused \
      -e KANVAS_AUTH_BASE_URL=https://example.invalid \
      -e KANVAS_AUTH_SECRET=packaging-only-auth-secret-not-a-real-key \
      "$image" node dist/main.js --check-config
    ;;
  worker)
    docker run --rm --network none --read-only \
      -e KANVAS_ENVIRONMENT=production \
      -e KANVAS_INSTANCE_ID=packaging-verification \
      -e KANVAS_DATABASE_URL=mysql://test:test@127.0.0.1/unused \
      -e KANVAS_REDIS_URL=redis://:test@127.0.0.1/0 \
      "$image" node dist/main.js --check-config
    ;;
  web)
    docker run --rm --network none --read-only \
      --add-host server:127.0.0.1 \
      --tmpfs /tmp:mode=1777 --tmpfs /var/run:mode=1777 \
      --entrypoint sh "$image" -ec \
      'test -s /usr/share/nginx/html/index.html; test -s /usr/share/nginx/html/LICENSE; test -s /usr/share/nginx/html/third-party/NOTICES.txt; nginx -t'
    ;;
  *)
    echo 'Unknown image target; expected standalone, server, worker or web.' >&2
    exit 2
    ;;
esac
