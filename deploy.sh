#!/usr/bin/env bash
# ============================================================
# Deploy do WhatsCRM (VPS) — atualiza o código, rebuilda o app
# e aplica as migrações pendentes (idempotentes).
#
# Uso (na raiz do repositório, na VPS):
#   ./deploy.sh
#
# Requer o arquivo .env na raiz com DB_ROOT_PASS definido.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

DBNAME="${DBNAME:-whatscrm}"

if [ ! -f .env ]; then
  echo "ERRO: arquivo .env nao encontrado na raiz do repositorio."
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

if [ -z "${DB_ROOT_PASS:-}" ]; then
  echo "ERRO: defina DB_ROOT_PASS no .env"
  exit 1
fi

echo "==> 1/4 Baixando codigo (git pull)"
git pull --ff-only

echo "==> 2/4 Verificando codigo"
for f in server/server.js server/routes/admin.js server/middlewares/superAdmin.js; do
  docker run --rm -v "$PWD/server:/app" -w /app node:20 node --check "${f#server/}" \
    || { echo "ERRO de sintaxe em $f"; exit 1; }
done

echo "==> 3/4 Build + subida do app"
docker compose up -d --build app

echo "==> 4/4 Aguardando o banco e aplicando migracoes"
for _ in $(seq 1 40); do
  if docker exec whatscrm-db healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

run_migration() {
  local name="$1"
  local file="database/migrations/${name}.sql"
  if [ ! -f "$file" ]; then
    echo "   ! $file nao encontrado (ignorado)"
    return 0
  fi
  echo "   - $name"
  docker exec -i whatscrm-db mariadb -u root -p"${DB_ROOT_PASS}" "${DBNAME}" \
    < "$file" >/dev/null
}

run_migration 20261014_multi_tenant_core
run_migration 20261014_backfill_legacy
run_migration 20261019_superadmin_force_password_change

echo
echo "==> Conferencia"
docker exec -i whatscrm-db mariadb -u root -p"${DB_ROOT_PASS}" "${DBNAME}" -e \
  "SELECT id, email, role, must_change_password FROM super_admins;" 2>/dev/null || true

echo
echo "==> Pronto. App em http://127.0.0.1:3010"
echo "    Super admin: https://app.gstd.com.br/superadmin"
echo
echo "    Se ainda nao existir um super admin, crie com:"
echo "      docker exec -i -w /app whatscrm-app node scripts/create-super-admin.js \\"
echo "        --email seu@email.com --name \"Seu Nome\" --force-change"
