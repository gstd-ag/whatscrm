# 📂 Docs — WHATScrm Multi-Tenant

Documentação do projeto, ordenada por **ordem de leitura/execução**:

| # | Arquivo | O que é | Quando ler |
|---|---|---|---|
| **00** | [`00.MULTI_TENANT_PLAN.md`](00.MULTI_TENANT_PLAN.md) | Plano arquitetônico e roadmap em 8 fases | Antes de tudo — visão geral da arquitetura |
| **01** | [`01.IMPLEMENTATION_SUMMARY.md`](01.IMPLEMENTATION_SUMMARY.md) | Estado real do que está implementado, validado e pendências | Para entender o que já existe no código |
| **02** | [`02.DEPLOY_HOSTINGER_KVM4.md`](02.DEPLOY_HOSTINGER_KVM4.md) | Guia completo de deploy — VPS Hostinger KVM 4 + Dokploy + migrações | Na hora de subir em produção |
| **03** | [`03.conversa-whatscrm-2026-10-14.md`](03.conversa-whatscrm-2026-10-14.md) | Registro histórico da sessão de desenvolvimento de 14/10/2026 | Consulta/arquivo |
| **04** | [`04.CONCEITOS_GIT_E_MIGRACOES.md`](04.CONCEITOS_GIT_E_MIGRACOES.md) | 🔑 Conceito-chave: código vai pelo git, migrações rodam no banco (auto-migrate) | Antes de mexer em deploy/schema |

## Fluxo recomendado de execução

1. **00** — ler o plano (arquitetura de tenants por subdomínio, white-label, fases).
2. **01** — conferir o estado implementado + pendências restantes (§8).
3. **02** — deploy: volume novo roda migrações sozinho; banco existente exige
   `02-multitenant.sql` + `03-backfill.sql` manuais (comandos na seção de migração).
4. **03** — histórico (não é instrução operacional).
