#!/bin/sh
set -eu
if [ "$#" -eq 0 ]; then set -- all; fi
if [ "$1" = all ] && [ "$#" -gt 1 ]; then
  echo 'The all command does not accept arguments. Use server/worker --check-config for offline validation.' >&2
  exit 1
fi
# The complete image initializes before any business process can claim work.
# Split roles default to read-only checks; a release job owns their DDL.
case "$1" in
  all|server|worker)
    if [ "${2:-}" != "--check-config" ]; then
      default_migration_mode=check
      if [ "$1" = all ]; then default_migration_mode=auto; fi
      # NODE_OPTIONS restores Matrix transport variables inside Node. The parent
      # shell cannot see a child's decoded environment, so resolve the mode there.
      migration_mode=$(node -e 'const mode=process.env.KANVAS_DB_MIGRATION_MODE || process.argv[1]; if (!["auto","check"].includes(mode)) { console.error("KANVAS_DB_MIGRATION_MODE must be auto or check."); process.exit(1); } process.stdout.write(mode);' "$default_migration_mode")
      case "$migration_mode" in
        auto) node /app/server/node_modules/@kanvas/database/dist/cli/main.js migrate ;;
        check) ;;
        *) echo 'KANVAS_DB_MIGRATION_MODE must be auto or check.' >&2; exit 1 ;;
      esac
      node /app/server/node_modules/@kanvas/database/dist/cli/main.js check
    fi
    ;;
esac
case "$1" in
  all) shift; exec node /app/runtime/supervisor.mjs "$@" ;;
  server) shift; cd /app/server; exec node dist/main.js "$@" ;;
  worker) shift; cd /app/worker; exec node dist/main.js "$@" ;;
  preflight)
    shift
    node /app/server/dist/main.js --check-config
    node /app/worker/dist/main.js --check-config
    node /app/server/node_modules/@kanvas/database/dist/cli/main.js check
    exec node /app/server/node_modules/@kanvas/database/dist/cli/deployment-readiness.js "$@"
    ;;
  backup|recovery)
    export KANVAS_MIGRATIONS_DIRECTORY="${KANVAS_MIGRATIONS_DIRECTORY:-/app/server/node_modules/@kanvas/database/migrations}"
    exec node /app/recovery/dist/cli/main.js "$@"
    ;;
  db) shift; exec node /app/server/node_modules/@kanvas/database/dist/cli/main.js "$@" ;;
  admin)
    shift
    node /app/server/node_modules/@kanvas/database/dist/cli/main.js check
    exec node /app/server/node_modules/@kanvas/database/dist/cli/bootstrap-admin.js "$@"
    ;;
  *) exec "$@" ;;
esac
