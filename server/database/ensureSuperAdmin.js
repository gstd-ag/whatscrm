// ============================================================
// ENSURE SUPER ADMIN — cria o super admin inicial no boot
//
// Ativado por SUPERADMIN_EMAIL. Se a conta NAO existir, cria com
// senha temporaria e `must_change_password = 1` (o login so libera
// a troca de senha ate o operador definir uma nova).
//
// Se a conta JA existir, NADA e alterado (nem a senha) — redeploys
// nunca resetam credenciais.
//
// Env:
//   SUPERADMIN_EMAIL     e-mail do super admin (ativa o recurso)
//   SUPERADMIN_NAME      nome exibido        (default: "Super Admin")
//   SUPERADMIN_PASSWORD  senha temporaria    (default: "admin123")
//
// Requer as migracoes aplicadas (tabela super_admins).
// ============================================================
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const mysql = require("mysql2/promise");

async function ensureSuperAdmin() {
  const email = String(process.env.SUPERADMIN_EMAIL || "")
    .trim()
    .toLowerCase();

  if (!email) {
    return { skipped: true, reason: "SUPERADMIN_EMAIL nao definido" };
  }

  const name =
    String(process.env.SUPERADMIN_NAME || "Super Admin").trim() || "Super Admin";
  const password = String(process.env.SUPERADMIN_PASSWORD || "admin123");

  const conn = await mysql.createConnection({
    host: process.env.DBHOST || "localhost",
    port: Number(process.env.DBPORT || 3306),
    user: process.env.DBUSER,
    password: process.env.DBPASS,
    database: process.env.DBNAME,
    charset: "utf8mb4",
    connectTimeout: 15000,
  });

  try {
    const [existing] = await conn.query(
      `SELECT id, must_change_password FROM super_admins WHERE email = ? LIMIT 1`,
      [email],
    );

    if (existing.length) {
      const sa = existing[0];
      console.log(
        `[superadmin] ja existe: ${email} (id ${sa.id}` +
          (sa.must_change_password ? ", aguardando troca de senha" : "") +
          `) — senha preservada`,
      );
      return { existing: true, email, id: sa.id };
    }

    const hash = await bcrypt.hash(password, 10);
    const uid = crypto.randomUUID();

    const [r] = await conn.query(
      `INSERT INTO super_admins
         (uid, email, password, name, role, must_change_password)
       VALUES (?,?,?,?, 'super_admin', 1)`,
      [uid, email, hash, name],
    );

    console.log(`[superadmin] criado: ${email} (id ${r.insertId})`);
    console.log(`[superadmin] SENHA TEMPORARIA: ${password}`);
    console.log(
      `[superadmin] troca de senha OBRIGATORIA no primeiro login (must_change_password=1)`,
    );

    return { created: true, email, id: r.insertId };
  } catch (e) {
    if (/doesn't exist|Unknown table|Unknown column/i.test(e.message)) {
      console.error(
        `[superadmin] nao foi possivel criar ${email}: ${e.message} (migracoes pendentes?)`,
      );
    } else {
      console.error(`[superadmin] falhou ao criar ${email}: ${e.message}`);
    }
    return { error: e.message };
  } finally {
    try {
      await conn.end();
    } catch (e) {
      /* ignore */
    }
  }
}

module.exports = ensureSuperAdmin;
