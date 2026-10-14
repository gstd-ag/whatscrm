// ============================================================
// MIDDLEWARE: resolveTenant / verifyTenantOuSuperAdmin
// Purpose: Detect tenant from subdomain, header, query or logged user
// Injects: req.tenantId, req.tenant, req.tenantSlug, req.isSuperAdmin
// ============================================================
const { query } = require("../database/dbpromise.js");

// Subdominios que NUNCA sao um tenant
const RESERVED_SUBDOMAINS = [
  "www",
  "api",
  "app",
  "admin",
  "superadmin",
  "dashboard",
  "mail",
  "ftp",
  "cdn",
  "assets",
];

/**
 * Extrair slug do subdominio: "clinica1.app.gstd.com.br" -> "clinica1"
 * Retorna null quando o hostname nao representa um tenant.
 */
function extractSlugFromHostname(hostname) {
  if (!hostname) return null;

  const host = String(hostname).split(":")[0].toLowerCase();
  const cleanHost = host.startsWith("www.") ? host.slice(4) : host;

  // Padrrao oficial: <slug>.app.gstd.com.br
  const gstdMatch = cleanHost.match(/^([a-z0-9-]+)\.app\.gstd\.com\.br$/i);
  if (gstdMatch) {
    const slug = gstdMatch[1];
    return RESERVED_SUBDOMAINS.includes(slug) ? null : slug;
  }

  // Dominio raiz (app.gstd.com.br, gstd.com.br) -> sem tenant
  if (cleanHost === "app.gstd.com.br" || cleanHost === "gstd.com.br") {
    return null;
  }

  // Dominio personalizado do cliente (fase futura): nao resolve por hostname aqui.
  return null;
}

/**
 * Verificar se o usuario e super admin (tabela super_admins).
 * Aceita uid ou email.
 */
async function isSuperAdmin(identity) {
  if (!identity) return false;
  try {
    const rows = await query(
      `SELECT id FROM super_admins WHERE email = ? OR uid = ? LIMIT 1`,
      [identity, identity],
    );
    return rows.length > 0;
  } catch (err) {
    console.error("[tenant] isSuperAdmin error:", err.message);
    return false;
  }
}

/**
 * Verificar se o usuario pertence ao tenant ativo.
 */
async function belongsToTenant(userUid, tenantId) {
  if (!userUid || !tenantId) return false;
  try {
    const rows = await query(
      `SELECT id FROM tenant_users WHERE user_uid = ? AND tenant_id = ? AND is_active = 1 LIMIT 1`,
      [userUid, tenantId],
    );
    return rows.length > 0;
  } catch (err) {
    console.error("[tenant] belongsToTenant error:", err.message);
    return false;
  }
}

/**
 * Listar tenants do usuario logado.
 */
async function getUserTenants(userUid) {
  if (!userUid) return [];
  try {
    const rows = await query(
      `SELECT t.id, t.slug, t.name, t.status, tu.role
         FROM tenant_users tu
         JOIN tenants t ON t.id = tu.tenant_id
        WHERE tu.user_uid = ? AND tu.is_active = 1
        ORDER BY t.name`,
      [userUid],
    );
    return rows;
  } catch (err) {
    console.error("[tenant] getUserTenants error:", err.message);
    return [];
  }
}

/**
 * Middleware principal de resolucao de tenant.
 * Ordem de prioridade:
 *  1. JWT (payload tenant_id) - setado pelo middleware de auth
 *  2. Subdominio (clinica1.app.gstd.com.br)
 *  3. Header X-Tenant-Slug
 *  4. Query param ?tenant=
 *  5. Unico tenant do usuario logado (fallback)
 *  6. Super admin -> acesso global (req.tenantId = null permitido)
 *
 * IMPORTANTE: em ambientes sem as tabelas multi-tenant criadas, o
 * middleware degrada graciosamente (next()) para nao derrubar o deploy.
 */
async function resolveTenant(req, res, next) {
  try {
    // Sem tabelas multi-tenant (migracao pendente) -> nada a resolver
    if (!(await tablesAvailable())) {
      req.tenantId = null;
      req.tenantResolvedBy = "tenant_tables_absent";
      return next();
    }

    let tenantId = null;
    let tenant = null;
    let tenantSlug = null;
    let resolvedBy = "none";

    const userUid = req.decode?.uid || null;

    // 1. JWT ja carrega o tenant
    if (req.decode?.tenant_id) {
      tenantId = Number(req.decode.tenant_id) || null;
      tenantSlug = req.decode.tenant_slug || null;
      resolvedBy = "jwt";
      if (tenantId) {
        const rows = await query(`SELECT * FROM tenants WHERE id = ?`, [tenantId]);
        if (rows.length) tenant = rows[0];
      }
    }

    // 2. Subdominio
    if (!tenantId && !tenantSlug) {
      const hostname =
        req.get("x-forwarded-host") || req.get("host") || req.hostname || "";
      tenantSlug = extractSlugFromHostname(hostname);
      if (tenantSlug) resolvedBy = "subdomain";
    }

    // 3. Header explicito
    if (!tenantId && !tenantSlug) {
      const headerSlug = req.get("x-tenant-slug");
      if (headerSlug) {
        tenantSlug = String(headerSlug).toLowerCase();
        resolvedBy = "header";
      }
    }

    // 4. Query param
    if (!tenantId && !tenantSlug && req.query?.tenant) {
      tenantSlug = String(req.query.tenant).toLowerCase();
      resolvedBy = "query";
    }

    // 5. Lookup por slug
    if (!tenantId && tenantSlug) {
      const rows = await query(`SELECT * FROM tenants WHERE slug = ? LIMIT 1`, [
        tenantSlug,
      ]);
      if (rows.length) {
        tenantId = rows[0].id;
        tenant = rows[0];
      }
    }

    // 6. Fallback: usuario logado com um unico tenant
    if (!tenantId && userUid) {
      const myTenants = await getUserTenants(userUid);
      if (myTenants.length === 1) {
        tenantId = myTenants[0].id;
        tenantSlug = myTenants[0].slug;
        resolvedBy = "user_single_tenant";
        const rows = await query(`SELECT * FROM tenants WHERE id = ?`, [tenantId]);
        if (rows.length) tenant = rows[0];
      } else if (myTenants.length > 1) {
        req.userTenants = myTenants;
        resolvedBy = "user_multi_tenant";
      }
    }

    const superAdmin = userUid ? await isSuperAdmin(userUid) : false;

    // Super admin sem tenant explicito -> acesso global (permitido)
    if (!tenantId && superAdmin) {
      req.isSuperAdmin = true;
      req.tenantId = null;
      req.tenant = null;
      req.tenantSlug = tenantSlug;
      req.tenantResolvedBy = "super_admin";
      return next();
    }

    // Sem tenant resolvido: NUNCA nega aqui.
    // Este middleware roda globalmente ANTES da autenticacao (req.decode
    // ainda nao existe), entao negar quebraria login e rotas publicas.
    // O isolamento de verdade e feito nas rotas via verifyTenantOuSuperAdmin.
    if (!tenantId) {
      req.tenantId = null;
      req.tenantResolvedBy = tenantSlug ? "slug_not_found" : "no_tenant";
      return next();
    }

    // Validar pertencimento ao tenant (apenas quando ja ha decode).
    // Se nao pertencer, apenas sinaliza - a decisao de negar e da rota.
    if (userUid && !superAdmin) {
      const belongs = await belongsToTenant(userUid, tenantId);
      if (!belongs && (await tablesAvailable())) {
        req.tenantAccessDenied = true;
      }
    }

    req.isSuperAdmin = superAdmin;
    req.tenantId = tenantId;
    req.tenant = tenant;
    req.tenantSlug = tenantSlug;
    req.tenantResolvedBy = resolvedBy;

    next();
  } catch (err) {
    console.error("[tenant] resolveTenant error:", err);
    // Nao derruba a aplicacao: degrada sem isolamento e registra o erro
    req.tenantId = null;
    req.tenantResolveError = err.message;
    next();
  }
}

// Cache simples (30s) para evitar query a cada request
let tablesAvailableCache = { value: null, ts: 0 };
async function tablesAvailable() {
  const now = Date.now();
  if (tablesAvailableCache.value !== null && now - tablesAvailableCache.ts < 30000) {
    return tablesAvailableCache.value;
  }
  try {
    const rows = await query(
      `SELECT COUNT(*) as c FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'tenants'`,
    );
    tablesAvailableCache = {
      value: Number(rows?.[0]?.c || 0) > 0,
      ts: now,
    };
  } catch (err) {
    tablesAvailableCache = { value: false, ts: now };
  }
  return tablesAvailableCache.value;
}

/**
 * Guarda de autorizacao: super admin OU membro ativo do tenant.
 * Usar apos adminValidator/validateUser e apos resolveTenant.
 */
async function verifyTenantOuSuperAdmin(req, res, next) {
  try {
    const userUid = req.decode?.uid;
    if (!userUid) {
      return res.status(401).json({ success: false, msg: "Unauthenticated" });
    }

    const superAdmin = await isSuperAdmin(req.decode.email || userUid);
    if (superAdmin) {
      req.isSuperAdmin = true;
      return next();
    }

    if (req.tenantId) {
      const rows = await query(
        `SELECT role, permissions FROM tenant_users
          WHERE user_uid = ? AND tenant_id = ? AND is_active = 1 LIMIT 1`,
        [userUid, req.tenantId],
      );
      if (rows.length) {
        req.tenantUserRole = rows[0].role;
        req.tenantUserPermissions = rows[0].permissions;
        return next();
      }
    }

    // Sem tabelas multi-tenant ainda -> mantem comportamento legado
    if (!(await tablesAvailable())) {
      return next();
    }

    return res.status(403).json({
      success: false,
      msg: "Acesso negado. Verifique suas permissoes ou tenant.",
    });
  } catch (err) {
    console.error("[tenant] verifyTenantOuSuperAdmin error:", err);
    res.status(500).json({
      success: false,
      msg: "Falha na verificacao de permissoes",
      error: err.message,
    });
  }
}

module.exports = {
  resolveTenant,
  verifyTenantOuSuperAdmin,
  isSuperAdmin,
  belongsToTenant,
  getUserTenants,
  extractSlugFromHostname,
  tablesAvailable,
};
