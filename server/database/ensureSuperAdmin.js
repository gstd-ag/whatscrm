// ============================================================
// ENSURE SUPER ADMIN — cria/repara o super admin inicial no boot
//
// Ativado por SUPERADMIN_EMAIL. Comportamento:
//   - conta NAO existe  -> cria com senha temporaria e
//                          must_change_password = 1 (troca obrigatoria)
//   - conta JA existe   -> NADA e alterado (redeploy nunca reseta senha)
//   - SUPERADMIN_RESET_PASSWORD=1 -> forca a senha temporaria na conta
//                          existente (use UMA vez, para recuperar acesso)
//
// Env:
//   SUPERADMIN_EMAIL                e-mail do super admin (ativa o recurso)
//   SUPERADMIN_NAME                 nome exibido       (default "Super Admin")
//   SUPERADMIN_PASSWORD             senha temporaria   (default "admin123")
//   SUPERADMIN_RESET_PASSWORD=1     redefine a senha de conta existente
//   SUPERADMIN_SYNC_ADMIN=1         espelha a conta no painel /admin/login
//
// Requer as migracoes aplicadas (tabelas super_admins / admin).
// ============================================================
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const mysql = require("mysql2/promise");

const flag = (name) => String(process.env[name] || "") === "1";

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
  const reset = flag("SUPERADMIN_RESET_PASSWORD");
  const syncAdmin = flag("SUPERADMIN_SYNC_ADMIN");

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

    let hash = null;
    let changed = false;
    let id = null;

    if (existing.length && !reset) {
      id = existing[0].id;
      console.log(
        `[superadmin] ja existe: ${email} (id ${id}` +
          (existing[0].must_change_password ? ", aguardando troca de senha" : "") +
          `) — senha preservada`,
      );
    } else {
      hash = await bcrypt.hash(password, 10);

      if (existing.length) {
        id = existing[0].id;
        await conn.query(
          `UPDATE super_admins
              SET password = ?, name = ?, role = 'super_admin',
                  must_change_password = 1
            WHERE id = ?`,
          [hash, name, id],
        );
        console.log(`[superadmin] senha REDEFINIDA: ${email} (id ${id})`);
        console.log(
          "[superadmin] ATENCAO: SUPERADMIN_RESET_PASSWORD=1 — remova essa variavel apos recuperar o acesso!",
        );
      } else {
        const uid = crypto.randomUUID();
        const [r] = await conn.query(
          `INSERT INTO super_admins
             (uid, email, password, name, role, must_change_password)
           VALUES (?,?,?,?, 'super_admin', 1)`,
          [uid, email, hash, name],
        );
        id = r.insertId;
        console.log(`[superadmin] criado: ${email} (id ${id})`);
      }

      changed = true;
      console.log(`[superadmin] SENHA TEMPORARIA: ${password}`);
      console.log(
        "[superadmin] troca de senha OBRIGATORIA no primeiro login (must_change_password=1)",
      );
    }

    // ── Espelho opcional no painel do tenant (/admin/login) ──────────
    if (syncAdmin) {
      const [adm] = await conn.query(
        `SELECT id FROM admin WHERE email = ? LIMIT 1`,
        [email],
      );

      if (adm.length) {
        if (changed && hash) {
          await conn.query(
            `UPDATE admin
                SET password = ?, role = 'admin',
                    tokenVersion = COALESCE(tokenVersion, 0) + 1
              WHERE id = ?`,
            [hash, adm[0].id],
          );
          console.log(`[superadmin] espelho /admin/login atualizado: ${email}`);
        } else {
          console.log(
            `[superadmin] espelho /admin/login ja existe: ${email} (senha preservada)`,
          );
        }
      } else if (hash) {
        await conn.query(
          `INSERT INTO admin (email, password, uid, role, tokenVersion)
           VALUES (?,?,?, 'admin', 1)`,
          [email, hash, crypto.randomUUID()],
        );
        console.log(`[superadmin] espelho /admin/login criado: ${email}`);
      } else {
        console.log(
          `[superadmin] espelho /admin/login NAO criado: conta existe com senha desconhecida (use SUPERADMIN_RESET_PASSWORD=1)`,
        );
      }
    }

    return { email, id, created: changed, reset, syncedAdmin: syncAdmin };
  } catch (e) {
    if (/doesn't exist|Unknown table|Unknown column/i.test(e.message)) {
      console.error(
        `[superadmin] nao foi possivel processar ${email}: ${e.message} (migracoes pendentes?)`,
      );
    } else {
      console.error(`[superadmin] falhou ao processar ${email}: ${e.message}`);
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
