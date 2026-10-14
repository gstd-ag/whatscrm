# Plano de Implementação Multi-Tenant - WhatsCRM

## 1. Banco de Dados - Novas Tabelas e Migrações

### 1.1 Tabela `tenants` (clientes/clínicas)
```sql
CREATE TABLE tenants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uid VARCHAR(36) UNIQUE NOT NULL,           -- UUID público
  slug VARCHAR(100) UNIQUE NOT NULL,         -- subdomínio: clinica1
  name VARCHAR(255) NOT NULL,                -- Nome da clínica
  domain VARCHAR(255) UNIQUE NULL,           -- Domínio próprio: clinica.com.br
  status ENUM('active','suspended','trial','expired') DEFAULT 'trial',
  plan_id INT NULL,                          -- FK para plans
  plan_expires_at DATETIME NULL,
  trial_ends_at DATETIME NULL,
  settings JSON NULL,                        -- Configurações white-label
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_slug (slug),
  INDEX idx_domain (domain),
  INDEX idx_status (status)
);
```

### 1.2 Tabela `tenant_users` (relação usuário-tenant com roles)
```sql
CREATE TABLE tenant_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  user_uid VARCHAR(36) NOT NULL,             -- FK para user.uid
  role ENUM('owner','admin','manager','agent','receptionist','doctor','finance') DEFAULT 'agent',
  permissions JSON NULL,                     -- Permissões customizadas
  is_active BOOLEAN DEFAULT TRUE,
  invited_by VARCHAR(36) NULL,
  invited_at TIMESTAMP NULL,
  joined_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_tenant_user (tenant_id, user_uid),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
```

### 1.3 Atualizar tabelas existentes com `tenant_id`
Todas as tabelas de dados do cliente devem ter `tenant_id`:
- `agents` → adicionar `tenant_id`
- `instance` → adicionar `tenant_id`
- `chats` / `beta_chats` → adicionar `tenant_id`
- `beta_conversation` → adicionar `tenant_id`
- `contact` → adicionar `tenant_id`
- `phonebook` → adicionar `tenant_id`
- `broadcast` → adicionar `tenant_id`
- `chatbot` / `beta_chatbot` → adicionar `tenant_id`
- `flow` / `beta_flows` → adicionar `tenant_id`
- `templets` → adicionar `tenant_id`
- `campaign` / `beta_campaign` → adicionar `tenant_id`
- `webhook_logs` → adicionar `tenant_id`
- `orders` → adicionar `tenant_id`

### 1.4 Tabela `super_admins` (administradores da plataforma)
```sql
CREATE TABLE super_admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role ENUM('super_admin','support','billing') DEFAULT 'support',
  permissions JSON NULL,
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

---

## 2. Backend - Middleware e Resolução de Tenant

### 2.1 Middleware `resolveTenant.js`
```javascript
// Resolve tenant por: subdomínio > domínio customizado > header > query param
// Injeta req.tenant e req.tenantId em todas as rotas
```

### 2.2 Middleware `tenantIsolation.js`
```javascript
// Garante que todas as queries incluam tenant_id
// Valida se usuário pertence ao tenant
```

### 2.3 Atualização de todos os models/queries
- Adicionar `tenant_id` em todos os INSERT/UPDATE/SELECT
- Índices compostos: `(tenant_id, uid)`, `(tenant_id, created_at)`

---

## 3. Autenticação e Login

### 3.1 Login Unificado (`/login`)
- Detecta tenant por email ou subdomínio
- Se usuário pertence a múltiplos tenants → mostra seletor
- Redireciona para subdomínio do tenant

### 3.2 Login por Subdomínio (`clinica1.app.gstd.com.br/login`)
- Mostra logo/branding do tenant
- Valida se email pertence ao tenant
- Auto-preenche tenant

### 3.3 JWT com tenant_id
```javascript
// Payload do token
{
  uid: "user_uid",
  tenant_id: 1,
  tenant_slug: "clinica1",
  role: "agent",
  tenant_role: "doctor",
  permissions: [...]
}
```

---

## 4. Super Admin Panel (`/superadmin`)

### 4.1 Rotas Protegidas
- `/superadmin/dashboard` - Visão geral da plataforma
- `/superadmin/tenants` - CRUD de tenants
- `/superadmin/tenants/:id/users` - Gerenciar usuários do tenant
- `/superadmin/tenants/:id/impersonate` - Entrar como admin do tenant
- `/superadmin/plans` - Gerenciar planos globais
- `/superadmin/billing` - Faturas, pagamentos, assinaturas
- `/superadmin/analytics` - Métricas globais
- `/superadmin/settings` - Configurações da plataforma

### 4.2 Funcionalidades
- Criar tenant (trial ou pago)
- Suspender/reativar tenant
- Alterar plano do tenant
- Ver logs de uso (conexões WhatsApp, mensagens, armazenamento)
- Impersonate: entrar no painel do tenant para suporte

---

## 5. Tenant Admin Panel (Painel do Cliente)

### 5.1 Rotas do Tenant
- `/dashboard` - Dashboard da clínica
- `/settings` - Configurações da clínica (white-label, horários, etc)
- `/users` - Gerenciar atendentes (convidar, roles, permissões)
- `/whatsapp` - Conectar números WhatsApp
- `/contacts` - Agenda de pacientes
- `/inbox` - Atendimento
- `/flows` - Chatbots/Fluxos
- `/campaigns` - Disparos
- `/reports` - Relatórios

---

## 6. White-Label por Tenant

### 6.1 Configurações em `tenants.settings` (JSON)
```json
{
  "branding": {
    "name": "Clínica Saúde Total",
    "logo": "media/tenants/1/logo.png",
    "favicon": "media/tenants/1/favicon.ico",
    "primary_color": "#0066CC",
    "secondary_color": "#10B981"
  },
  "login": {
    "custom_title": "Portal do Paciente",
    "custom_subtitle": "Agende sua consulta",
    "background_image": "media/tenants/1/login-bg.jpg"
  },
  "features": {
    "enable_whatsapp": true,
    "enable_instagram": false,
    "enable_telegram": false,
    "enable_scheduling": true,
    "enable_payments": false
  },
  "business": {
    "timezone": "America/Sao_Paulo",
    "business_hours": {...},
    "appointment_types": [...]
  }
}
```

### 6.2 Aplicação dinâmica
- `patchIndexHtml()` lê `tenant.settings.branding`
- CSS variables injetadas no `<head>`
- Assets servidos via `/media/tenants/:tenantId/...`

---

## 7. Frontend - React

### 7.1 Detecção de Tenant no Cliente
```javascript
// src/utils/tenant.js
export const getTenantFromUrl = () => {
  const hostname = window.location.hostname;
  // subdomínio: clinica1.app.gstd.com.br
  // domínio próprio: clinica.com.br
};
```

### 7.2 Rotas Protegidas por Tenant
- `PrivateRoute` verifica `tenant_id` no token
- Redireciona para login se tenant não corresponde

### 7.3 Seletor de Tenant (para usuários multi-tenant)
- Dropdown no header para trocar de clínica

---

## 8. API Pública por Tenant

### 8.1 Endpoints com escopo de tenant
```
GET    /api/v1/contacts           → Lista contatos DO tenant
POST   /api/v1/messages           → Envia mensagem PELO tenant
GET    /api/v1/instances          → Instâncias DO tenant
```

### 8.2 Rate Limiting por Tenant
- Redis key: `ratelimit:tenant:{tenant_id}:{endpoint}`
- Limites baseados no plano

---

## 9. Infraestrutura

### 9.1 DNS Wildcard
```
*.app.gstd.com.br → A record → IP da VPS
```

### 9.2 NGINX Config
- `server_name ~^(?<subdomain>.+)\.app\.gstd\.com\.br$;`
- Proxy para app com header `X-Tenant-Slug: $subdomain`
- Suporte a domínios customizados via mapa Redis

### 9.3 Docker Compose
- Adicionar serviço `tenant-resolver` (opcional, para domínios customizados)
- Redis para cache de tenant_slug → tenant_id

---

## 10. Ordem de Implementação

### Fase 1 - Base (Semana 1)
1. [ ] Migração SQL: criar tabelas `tenants`, `tenant_users`, `super_admins`
2. [ ] Adicionar `tenant_id` nas tabelas existentes (migração)
3. [ ] Middleware `resolveTenant` + `tenantIsolation`
4. [ ] Atualizar `database/config.js` para pool por tenant (opcional)

### Fase 2 - Auth (Semana 1-2)
5. [ ] Atualizar login (unificado + subdomínio)
6. [ ] JWT com tenant_id
7. [ ] Middleware `validateTenantUser`
8. [ ] Atualizar todas as rotas para usar `req.tenantId`

### Fase 3 - Super Admin (Semana 2)
9. [ ] Rotas `/superadmin/*` com `superAdminValidator`
10. [ ] CRUD de tenants
11. [ ] Impersonate
12. [ ] Dashboard com métricas

### Fase 4 - Tenant Admin (Semana 2-3)
13. [ ] Painel de configurações do tenant (white-label)
14. [ ] Gerenciar usuários/atendentes do tenant
15. [ ] Convite de usuários por email

### Fase 5 - White-Label (Semana 3)
16. [ ] Upload de assets por tenant (logo, favicon, backgrounds)
17. [ ] `patchIndexHtml` dinâmico por tenant
18. [ ] CSS variables por tenant
19. [ ] Temas salvos em `tenants.settings`

### Fase 6 - Frontend (Semana 3-4)
20. [ ] Detecção de tenant no React
21. [ ] Login page adaptativa (branding do tenant)
22. [ ] Seletor de tenant no header
23. [ ] Rotas protegidas por tenant

### Fase 7 - Infra (Semana 4)
24. [ ] DNS wildcard
25. [ ] NGINX com resolução de subdomínio
26. [ ] Domínios customizados (mapa Redis)
27. [ ] SSL automático (certbot wildcard ou per-domain)

### Fase 8 - Testes e Deploy (Semana 4)
28. [ ] Testes de isolamento (tenant A não vê dados do B)
29. [ ] Testes de login (unificado, subdomínio, multi-tenant user)
30. [ ] Testes white-label
31. [ ] Deploy em staging
32. [ ] Deploy em produção