#!/usr/bin/env bash
set -euo pipefail

# ─── CERNIQ Database Backup Script ───────────────────────
# Usage: ./scripts/db-backup.sh [output_dir]
# Requires: DATABASE_URL env var or pg connection params
#
# Creates a compressed pg_dump with timestamp.
# Designed for cron: 0 2 * * * /path/to/db-backup.sh /backups
# ──────────────────────────────────────────────────────────

OUTPUT_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${OUTPUT_DIR}/cerniq_backup_${TIMESTAMP}.sql.gz"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

mkdir -p "$OUTPUT_DIR"

echo "[backup] Starting CERNIQ database backup at $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[backup] ERROR: DATABASE_URL not set"
  exit 1
fi

# Extract connection params from DATABASE_URL
# Format: postgresql://<user>@host:port/dbname
PGHOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
PGPORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
PGDATABASE=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')
PGUSER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')
PGPASSWORD=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')

export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD

# Run pg_dump with compression
pg_dump \
  --format=custom \
  --compress=9 \
  --verbose \
  --no-owner \
  --no-privileges \
  --exclude-table-data='_prisma_migrations' \
  2>&1 | gzip > "$BACKUP_FILE"

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[backup] Backup created: $BACKUP_FILE ($BACKUP_SIZE)"

# Cleanup old backups
DELETED=$(find "$OUTPUT_DIR" -name "cerniq_backup_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[backup] Cleaned up $DELETED backups older than ${RETENTION_DAYS} days"
fi

echo "[backup] Complete at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
