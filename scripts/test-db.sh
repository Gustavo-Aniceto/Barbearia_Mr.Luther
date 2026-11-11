#!/usr/bin/env bash
# Testes de regras de negócio, segurança e concorrência no Postgres local.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PGDATABASE="${PGDATABASE:-mrluder_neon}"
"$ROOT/scripts/db-local.sh" >/dev/null
psql -h ${PGHOST:-/tmp} -p ${PGPORT:-54322} -U ${PGUSER:-postgres} -d "$PGDATABASE" -v ON_ERROR_STOP=1 -X -f "$ROOT/tests/db/business_rules.test.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  /  /p; /FALHOU\|ERROR\|✔/p'
"$ROOT/tests/db/concurrency.test.sh"
