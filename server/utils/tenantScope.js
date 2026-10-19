// ============================================================
// Helper ADITIVO de isolamento multi-tenant para queries.
//
// Uso (padrao do projeto: dbpromise retorna o array direto):
//
//   const t = tenantScope(req);
//   const rows = await query(
//     `SELECT * FROM contact WHERE uid = ?${t.filter("AND")}`,
//     [uid, ...t.params],
//   );
//
//   const ins = tenantInsert(req);
//   await query(
//     `INSERT INTO contact (uid, name${ins.cols}) VALUES (?,?${ins.vals})`,
//     [uid, name, ...ins.params],
//   );
//
// Fallback defensivo:
//   - req.tenantId indefinido/legado  -> filtro NAO e aplicado (query original)
//   - nunca injeta "tenant_id = undefined" na query
//
// MODO DE TRANSICAO (OR tenant_id IS NULL):
//   Enquanto houver dados legados sem backfill, o filtro inclui
//   "OR tenant_id IS NULL" — registros NULL nunca pertencem a outro
//   tenant, entao nao ha vazamento cross-tenant. Apos executar
//   server/database/migrations/20261014_02_backfill_legacy.sql, defina
//   TENANT_STRICT=1 no .env para endurecer para "tenant_id = ?" puro
//   (mudanca em um unico ponto: TENANT_STRICT_MODE abaixo).
// ============================================================

const TENANT_STRICT_MODE = process.env.TENANT_STRICT === "1";

/**
 * Monta o trecho "AND ..." de isolamento + parametros.
 * @param {object} req        requisicao express (usa req.tenantId)
 * @param {string} alias      alias da tabela quando houver JOIN (ex: "c")
 * @param {string} connector  "AND" (default) ou "WHERE" para inicio de clause
 */
function tenantFilter(req, alias = "", connector = "AND") {
  const tenantId = req?.tenantId;
  if (tenantId === undefined || tenantId === null || tenantId === "") {
    // Fallback legado: sem contexto de tenant -> query original
    return { sql: "", params: [] };
  }

  const col = alias ? `${alias}.tenant_id` : "tenant_id";
  const expr = TENANT_STRICT_MODE
    ? `${col} = ?`
    : `(${col} = ? OR ${col} IS NULL)`;

  return {
    sql: ` ${connector} ${expr}`,
    params: [tenantId],
  };
}

/**
 * Monta a parte de colunas/valores de INSERT incluindo tenant_id.
 * Sem contexto de tenant -> vazio (comportamento legado inalterado).
 */
function tenantInsert(req) {
  const tenantId = req?.tenantId;
  if (tenantId === undefined || tenantId === null || tenantId === "") {
    return { cols: "", vals: "", params: [] };
  }
  return {
    cols: ", tenant_id",
    vals: ", ?",
    params: [tenantId],
  };
}

/**
 * Extrai tenant_id defensivamente (null quando ausente).
 */
function getTenantId(req) {
  const tenantId = req?.tenantId;
  return tenantId === undefined || tenantId === null || tenantId === ""
    ? null
    : tenantId;
}

/**
 * Guarda de rota opcional: quando TENANT_STRICT=1 e a rota exige tenant,
 * recusa requisicoes sem contexto de tenant. Uso:
 *   router.get("/x", validateUser, requireTenant, handler)
 */
function requireTenant(req, res, next) {
  if (getTenantId(req) === null && TENANT_STRICT_MODE) {
    return res.status(401).json({
      success: false,
      msg: "Tenant nao resolvido para esta rota",
    });
  }
  next();
}

module.exports = {
  tenantFilter,
  tenantInsert,
  getTenantId,
  requireTenant,
  TENANT_STRICT_MODE,
};
