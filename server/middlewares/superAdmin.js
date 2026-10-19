// ============================================================
// MIDDLEWARE: superAdminValidator
// Valida JWT de Super Admin (tabela super_admins) - painel /superadmin
// Diferente do adminValidator (tabela admin do tenant), este valida
// acesso GLOBAL a plataforma (tenants, usuarios, billing).
// ============================================================
const jwt = require("jsonwebtoken");
const { query } = require("../database/dbpromise");
const logger = require("../utils/logger");

const superAdminValidator = async (req, res, next) => {
  try {
    const token = req.get("Authorization");
    if (!token) {
      return res.json({ success: false, msg: "No token found", logout: true });
    }

    jwt.verify(token.split(" ")[1], process.env.JWTKEY, async (err, decode) => {
      if (err) {
        return res.json({
          success: false,
          msg: "Invalid token found",
          logout: true,
        });
      }

      // Exige o ROLE correto no JWT: impede que um token emitido para o
      // painel admin do tenant seja usado no painel super admin (mesmo
      // quando os emails coincidem).
      if (decode.role !== "super_admin") {
        return res.json({
          success: false,
          msg: "Acesso restrito ao Super Admin",
          logout: true,
        });
      }

      // Somente super admins autenticados passam
      let isSuper = false;
      let adminRow = null;
      try {
        const rows = await query(
          `SELECT id, email, name, role, must_change_password FROM super_admins
            WHERE email = ? LIMIT 1`,
          [decode.email],
        );
        if (rows.length > 0) {
          isSuper = true;
          adminRow = rows[0];
        }
      } catch (dbErr) {
        // Coluna nova ainda nao migrada? Cai no SELECT legado (tolerancia a falhas)
        try {
          const rows = await query(
            `SELECT id, email, name, role FROM super_admins
              WHERE email = ? LIMIT 1`,
            [decode.email],
          );
          if (rows.length > 0) {
            isSuper = true;
            adminRow = rows[0];
          }
        } catch (dbErr2) {
          // Tabela ainda nao criada (migracao pendente) -> nega com msg clara
          logger.log(
            "[superAdminValidator] tabela super_admins ausente:",
            dbErr2.message,
          );
        }
      }

      if (!isSuper) {
        return res.json({
          success: false,
          msg: "Acesso restrito ao Super Admin",
          logout: true,
        });
      }

      // ── Gate: troca obrigatoria de senha no primeiro login ──────────
      // Enquanto `must_change_password = 1`, TODAS as rotas super admin
      // ficam bloqueadas, exceto o proprio endpoint de troca de senha.
      const rawPath = (req.originalUrl || req.url || "").split("?")[0];
      const isPasswordChangeRoute = rawPath.endsWith(
        "/superadmin/change-password",
      );

      if (Number(adminRow.must_change_password) === 1 && !isPasswordChangeRoute) {
        return res.json({
          success: false,
          must_change_password: true,
          msg: "Troca de senha obrigatoria no primeiro login",
          logout: false,
        });
      }

      req.superAdmin = adminRow;
      req.decode = decode;
      req.isSuperAdmin = true;
      req.tenantId = null; // super admin opera globalmente
      next();
    });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "server error" });
  }
};

module.exports = superAdminValidator;
