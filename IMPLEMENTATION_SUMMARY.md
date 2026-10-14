# WHATSCRM — Resumo da Implementação Multi-Tenant (estado real)

> Documento revisado após auditoria técnica (2026-10-14).
> Tudo abaixo foi **testado de ponta a ponta** em MariaDB 10.11 + Node 20.

---

## 1. Visão geral

Transformação do WhatsCRM em SaaS White-Label/Multi-Tenant, com:

- Resolução de tenant por **subdomínio** (`clinica1.app.gstd.com.br`), header
  `X-Tenant-Slug` ou query `?tenant=`
- **Super Admin** em `/superadmin` (painel global: tenants, usuários, billing)
- Login admin legado **mantido e funcionando** (sem regressão)
- Isolamento preparado por `tenant_id` nas tabelas de dados
- Tolerância a falhas: se a migração ainda não foi aplicada, o sistema
  **continua funcionando no modo legado** (nenhuma quebra de deploy)

## 2. Arquivos alterados (diff real sobre `662c5ae`)

| Arquivo | Tipo | O que faz |
|---|---|---|
| `server/middlewares/tenant.js` | **novo** | `resolveTenant` (injetor de contexto), `verifyTenantOuSuperAdmin` (guarda), `isSuperAdmin`, `belongsToTenant`, `getUserTenants`, `extractSlugFromHostname`, `tablesAvailable` (cache 30s) |
| `server/middlewares/superAdmin.js` | **novo** | `superAdminValidator` — exige JWT com `role === "super_admin"` **e** cadastro em `super_admins` (validação dupla) |
| `database/migrations/20261014_multi_tenant_core.sql` | **novo** | Tabelas `tenants`, `tenant_users`, `super_admins` + seeds + `ALTER` idempotentes (procedimentos guardados) |
| `server/routes/admin.js` | **aditivo** | +7 rotas `/api/admin/superadmin/*` e `POST /superadmin/login`. **Nenhuma rota removida** (62 → 69) |
| `server/routes/user.js` | **aditivo** | Login anexa `tenant_id`/`tenant_slug` ao JWT e devolve seletor quando multi-tenant. **Nenhuma rota removida** (73 → 73) |
| `server/server.js` | **aditivo** | `app.use("/api", resolveTenant)` — middleware global apenas **enriquecedor** (nunca nega) |
| `database/import.sql` | **cirúrgico** | `tenant_id` + índice `idx_tenant` em 20 tabelas-alvo; 16 `INSERT` convertidos para lista explícita de colunas |
| `docker-compose.yml` | **aditivo** | Migração em `initdb.d/02-multitenant.sql` (idempotente) |
| `DEPLOY_HOSTINGER_KVM4.md` | doc | Guia de deploy VPS Hostinger KVM 4 (Dokploy coexistente) |
| `MULTI_TENANT_PLAN.md` | doc | Roadmap em 8 fases |
| `IMPLEMENTATION_SUMMARY.md` | doc | Este documento |

## 3. Fluxo de autenticação

```
POST /api/admin/login            → JWT { role:"admin" }         → painel do tenant
POST /api/admin/superadmin/login → JWT { role:"super_admin" }   → painel global
POST /api/user/login             → JWT { role:"user", tenant_id?, tenant_slug? }
```

- `superAdminValidator` **recusa** token emitido para o painel admin
  mesmo que os emails coincidam (exigência de `role` no payload).
- `verifyTenantOuSuperAdmin` guarda opcional para rotas que quiserem
  exigir membership (fase de isolamento ativo).

## 4. Resolução de tenant (prioridade)

1. `req.decode.tenant_id` (JWT)
2. Subdomínio: `<slug>.app.gstd.com.br` (reservados: www, api, app, admin…)
3. Header `X-Tenant-Slug`
4. Query `?tenant=<slug>`
5. Único tenant do usuário logado (fallback)
6. Super admin → contexto global (`tenantId = null`)

**Testado**: 6 casos (subdomínio, domínio raiz, www, header, query,
subdomínio+header) — todos resolvem o tenant correto.

## 5. Estratégia de isolamento de dados

- Coluna `tenant_id` + índice composto `(tenant_id, uid(120))` em 20 tabelas
  (`agents`, `instance`, `beta_chats`, `beta_conversation`, `contact`,
  `phonebook`, `broadcast`, `beta_chatbot`, `beta_flows`, `templets`,
  `beta_campaign`, `orders`, `webhook_logs`, etc.)
- Índices com **prefixo (120)** porque `uid` é `varchar(999)` — sem isso o
  MariaDB rejeita (`key too long`, 3072 bytes)
- Fase seguinte: aplicar `WHERE tenant_id = ?` nas queries das rotas usando
  `req.tenantId` (ver `MULTI_TENANT_PLAN.md`)

## 6. Validações executadas (testes reais)

| Teste | Resultado |
|---|---|
| `node --check` em todos os `.js` alterados | OK |
| Import `import.sql` em MariaDB 10.11 limpo | exit 0 |
| Migração multi-tenant | exit 0 |
| Migração executada **2x** (idempotência) | exit 0, sem duplicatas |
| Boot do servidor + `GET /api/web/get-default-language` | `{"default":"Portuguese"}` |
| `POST /api/admin/login` (admin@admin.com/admin123) | token emitido |
| `POST /api/admin/superadmin/login` | token com `role:super_admin` |
| `GET /api/admin/superadmin/tenants` (token válido) | lista tenants |
| `GET /api/admin/superadmin/platform-status` | contagens |
| Token inválido | negado |
| **Token do admin legado em rota superadmin** | **negado** (correção de segurança) |
| Criar tenant / slug duplicado / status inválido | criar OK, duplicado negado, status inválido negado |
| Invite de usuário ao tenant | OK |
| Rotas legadas (`/admin/get_web_public`) | inalteradas |

## 7. Correções de segurança aplicadas nesta auditoria

1. **Reescrita destrutiva revertida**: `admin.js` havia perdido 49 rotas e
   `user.js` 61 rotas (incluindo `POST /login`); `import.sql` tinha
   `CREATE TABLE` duplicado e `ALTER TABLE` antes do `DROP`. Tudo restaurado
   da base `662c5ae` e reaplicado de forma **puramente aditiva**.
2. **Erros de sintaxe JS** (`--` em vez de `//`, `await` em função síncrona,
   `recoverEmail`/`moment` duplicados, `uuidv4` sem import) — eliminados.
3. **Confusão de API do `dbpromise`**: `const [rows] = await query(...)`
   extrai a primeira *linha*, não o array. Padrão corrigido para
   `const rows = await query(...)` nos arquivos novos.
4. **Middleware global negando logins**: `resolveTenant` foi ajustado para
   nunca rejeitar (apenas injetar contexto); a negação real fica nas rotas.
5. **Token cruzado entre painéis**: `superAdminValidator` agora exige
   `role === "super_admin"` no JWT além do lookup no banco.
6. **Senhas de exemplo** removidas do guia de deploy (agora `openssl rand`).

## 8. Pendências conhecidas (fases seguintes)

| Item | Prioridade | Nota |
|---|---|---|
| Aplicar `WHERE tenant_id = ?` nas queries das rotas | Alta | Pré-requisito para liberar a múltiplos clientes |
| Isolamento por tenant no Socket.IO (`sendToUid`) | Alta | Salas por tenant no `socket.js` |
| White-label por tenant no `index.html` | Alta | Hoje `patchIndexHtml` grava **1 arquivo global** — branding de um tenant afetaria todos; precisa injeção por request |
| Sessões Baileys indexadas por tenant | Média | Verificar `extractUidFromSessionId`/mapa de conexões |
| Backfill dos dados legados (UPDATE tenant_id) | Média | Script comentado na seção 9 da migração |
| Seed `tenant_users` vazio em instalação nova | Baixa | Dump não tem usuário `admin@admin.com` na tabela `user`; vincular via convite no painel |
| Handler `unhandledRejection` global | Baixa | Não existe hoje; logs de erro assíncronos podem morrer em silêncio |
| Remover `server/.env.audit` local | Baixa | Já está no `.gitignore`, não vai ao Git |

## 9. Comandos de teste (staging)

```bash
# 1. Stack limpa
docker compose down -v && docker compose up -d --build

# 2. Esperar healthy
docker compose ps

# 3. API viva
curl -f http://localhost:3010/api/web/get-default-language
# {"success":true,"default":"Portuguese"}

# 4. Admin legado
curl -X POST http://localhost:3010/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@admin.com","password":"admin123"}'
# {"success":true,"token":"eyJ..."}

# 5. Super Admin
ST=$(curl -s -X POST http://localhost:3010/api/admin/superadmin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@admin.com","password":"admin123"}' | jq -r .token)
curl http://localhost:3010/api/admin/superadmin/tenants -H "Authorization: Bearer $ST"

# 6. Isolamento de tenant (deve resolver rafael)
curl -H "X-Tenant-Slug: rafael" http://localhost:3010/api/user/get_me \
  -H "Authorization: Bearer <token_do_usuario>"

# 7. Logs sem erros
docker compose logs app | grep -iE "error|unhandled" | head
```
