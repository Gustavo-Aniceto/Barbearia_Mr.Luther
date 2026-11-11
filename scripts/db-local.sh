#!/usr/bin/env bash
# Recria o banco local "mrluder_neon" (Postgres 16+) e aplica migrations/ em ordem — mesmo SQL do Neon.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${PGDATABASE:-mrluder_neon}"
PSQL="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-54322} -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q -X"
$PSQL -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
for f in "$ROOT"/migrations/*.sql; do $PSQL -d "$DB" -f "$f"; done
echo "Banco local $DB pronto."
