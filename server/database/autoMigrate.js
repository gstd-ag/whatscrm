// ============================================================
// AUTO-MIGRATE — aplica as migrações SQL no boot da aplicação
//
// Por que existe: o `initdb.d` do docker-compose só roda em volume
// NOVO. Em bancos que já existem (ex.: produção), as migrações
// precisam ser aplicadas de alguma forma. Este módulo faz isso
// automaticamente a cada boot, de forma IDEMPOTENTE:
//
//   - lê todos os .sql de ./migrations (em ordem alfabética)
//   - controla o que já rodou na tabela `schema_migrations`
//   - entende `DELIMITER` (usado pelas procedures das migrações)
//
// Nunca derruba o app: qualquer erro é logado e a aplicação segue.
// Desligar com:  AUTO_MIGRATE=0
// ============================================================
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// Divide um arquivo .sql em comandos, respeitando `DELIMITER x`.
function splitStatements(sql) {
  const lines = sql.split(/\r?\n/);
  const statements = [];
  let delimiter = ";";
  let buf = "";

  const flush = () => {
    let s = buf.trim();
    if (!s) {
      buf = "";
      return;
    }
    // remove o delimitador do fim
    if (s.endsWith(delimiter)) {
      s = s.slice(0, s.length - delimiter.length).trim();
    }
    // ignora blocos que só têm comentários
    const meaningful = s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("--") && !l.startsWith("#"))
      .join("");
    if (meaningful) statements.push(s);
    buf = "";
  };

  for (const line of lines) {
    const m = /^DELIMITER\s+(\S+)\s*$/i.exec(line.trim());
    if (m) {
      flush();
      delimiter = m[1];
      continue;
    }
    buf += line + "\n";
    if (buf.trimEnd().endsWith(delimiter)) flush();
  }
  flush();

  return statements;
}

async function ensureLedger(conn) {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name VARCHAR(255) NOT NULL,
       applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (name)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}

async function autoMigrate() {
  if (String(process.env.AUTO_MIGRATE ?? "1") === "0") {
    console.log("[migrate] desativado (AUTO_MIGRATE=0)");
    return { skipped: true, reason: "AUTO_MIGRATE=0" };
  }
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    // Falha silenciosa era o pior sintoma: subia "saudavel" sem aplicar nada.
    console.error(
      `[migrate] pasta de migrações ausente (${MIGRATIONS_DIR}) — nenhuma migração aplicada`,
    );
    return { skipped: true, reason: "sem pasta de migrações" };
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (!files.length) return { skipped: true, reason: "nenhuma migração" };

  const conn = await mysql.createConnection({
    host: process.env.DBHOST || "localhost",
    port: Number(process.env.DBPORT || 3306),
    user: process.env.DBUSER,
    password: process.env.DBPASS,
    database: process.env.DBNAME,
    charset: "utf8mb4",
    multipleStatements: false,
    connectTimeout: 15000,
  });

  const result = { applied: [], skipped: [], failed: [] };

  try {
    await ensureLedger(conn);
    const [rows] = await conn.query(`SELECT name FROM schema_migrations`);
    const done = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (done.has(file)) {
        result.skipped.push(file);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const statements = splitStatements(sql);
      let ok = true;

      for (let i = 0; i < statements.length; i++) {
        try {
          await conn.query(statements[i]);
        } catch (e) {
          ok = false;
          const trecho = statements[i].replace(/\s+/g, " ").slice(0, 140);
          console.error(
            `[migrate] ${file} comando #${i + 1} falhou: ${e.message} | ${trecho}`,
          );
        }
      }

      if (ok) {
        await conn.query(`INSERT INTO schema_migrations (name) VALUES (?)`, [
          file,
        ]);
        result.applied.push(file);
        console.log(
          `[migrate] aplicada: ${file} (${statements.length} comandos)`,
        );
      } else {
        result.failed.push(file);
        console.error(
          `[migrate] ${file} terminou com erro — NÃO marcada como aplicada (roda de novo no próximo boot)`,
        );
      }
    }

    if (!result.applied.length) {
      console.log(
        `[migrate] banco já atualizado (${result.skipped.length} migrações)`,
      );
    }
  } finally {
    try {
      await conn.end();
    } catch (e) {
      /* ignore */
    }
  }

  return result;
}

module.exports = autoMigrate;
module.exports.splitStatements = splitStatements;
