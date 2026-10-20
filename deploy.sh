#!/usr/bin/env bash
# ============================================================
# Deploy do WhatsCRM (VPS / Dokploy) 
#
# Fluxo: código pelo git -> rebuild da imagem -> o APP aplica as
# migrações sozinho no boot (idempotente, via server/database/autoMigrate.js).
#
# Uso (na raiz do repositório, no servidor):
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

echo "==> 1/4 Baixando codigo (git pull)"
git pull --ff-only

echo "==> 2/4 Verificando codigo"
for f in server/server.js server/app.js server/routes/admin.js server/middlewares/superAdmin.js server/database/autoMigrate.js; do
  docker run --rm -v "$PWD/server:/app" -w /app node:20 node --check "${f#server/}" \
    || { echo "ERRO de sintaxe em $f"; exit 1; }
done

# ADITIVO: o MariaDB aborta DDL com "Errcode: 28" quando a raiz enche.
# Aborta o deploy antes do build se o filesystem do datadir (/) estiver critico.
DISK_USE=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
if [ "${DISK_USE:-0}" -ge 90 ]; then
  echo "ERRO: raiz '/' com ${DISK_USE}% de uso. Libere espaco antes do deploy:"
  echo "  docker builder prune -af && docker image prune -f && docker volume prune -f"
  exit 1
fi
echo "   disco '/': ${DISK_USE}% (ok)"

echo "==> 3/4 Build + subida do app"
docker compose up -d --build app

echo "==> 4/4 Aguardando o app aplicar as migracoes (auto-migrate no boot)"
APP=$(docker compose ps -q app 2>/dev/null | head -1 || true)
for _ in $(seq 1 40); do
  if docker exec whatscrm-db mariadb -u root -p"${DB_ROOT_PASS:-}" "${DBNAME}" \
       -e "SELECT 1 FROM schema_migrations LIMIT 1" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "   Logs do auto-migrate:"
docker logs whatscrm-app 2>&1 | grep "\[migrate\]" | tail -10 || echo "   (nada ainda)"

echo
echo "==> Conferencia"
docker exec -i whatscrm-db mariadb -u root -p"${DB_ROOT_PASS:-}" "${DBNAME}" -e \
  "SELECT name, applied_at FROM schema_migrations;
   SELECT id, email, role, must_change_password FROM super_admins;" 2>/dev/null || true

echo
echo "==> Pronto. Super admin: https://app.gstd.com.br/superadmin"
echo "    Se ainda nao existir um super admin, crie com:"
echo "      docker exec -i -w /app whatscrm-app node scripts/create-super-admin.js \\"
echo "        --email seu@email.com --name \"Seu Nome\" --force-change"
