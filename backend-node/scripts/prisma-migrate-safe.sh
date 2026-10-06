#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash ./scripts/prisma-migrate-safe.sh status
  ALLOW_SCHEMA_MIGRATIONS=true bash ./scripts/prisma-migrate-safe.sh apply

Commands:
  status  Show Prisma migration status for the configured DATABASE_URL
  apply   Apply pending migrations explicitly. Refuses to run unless
          ALLOW_SCHEMA_MIGRATIONS=true is set in the environment.

Notes:
  - Production app startup must not mutate schema state.
  - Run this script from a controlled release step before deploying code that
    depends on new schema changes.
EOF
}

require_database_url() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is required." >&2
    exit 1
  fi
}

command="${1:-status}"

case "${command}" in
  status)
    require_database_url
    npx prisma migrate status
    ;;
  apply)
    require_database_url
    if [[ "${ALLOW_SCHEMA_MIGRATIONS:-false}" != "true" ]]; then
      echo "Refusing to run schema migrations without ALLOW_SCHEMA_MIGRATIONS=true." >&2
      exit 1
    fi

    echo "Checking migration status..."
    if ! npx prisma migrate status; then
      echo "Prisma reported pending migrations or schema drift; continuing with deploy." >&2
    fi
    echo "Applying pending migrations..."
    npx prisma migrate deploy
    echo "Refreshing Prisma client..."
    npx prisma generate
    echo "Migration apply completed successfully."
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: ${command}" >&2
    usage >&2
    exit 1
    ;;
esac
