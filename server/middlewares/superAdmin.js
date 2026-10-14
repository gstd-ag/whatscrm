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
      try {
        const rows = await query(
          `SELECT id, email, name, role FROM super_admins
            WHERE email = ? LIMIT 1`,
          [decode.email],
        );
        if (rows.length > 0) {
          isSuper = true;
          req.superAdmin = rows[0];
        }
      } catch (dbErr) {
        // Tabela ainda nao criada (migracao pendente) -> nega com msg clara
        logger.log("[superAdminValidator] tabela super_admins ausente:", dbErr.message);
      }

      if (!isSuper) {
        return res.json({
          success: false,
          msg: "Acesso restrito ao Super Admin",
          logout: true,
        });
      }

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
