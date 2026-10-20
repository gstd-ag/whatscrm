// ============================================================
// BOOTSTRAP — roda no boot da aplicação, em ordem:
//
//   1. autoMigrate      -> aplica as migrações pendentes (idempotente)
//   2. ensureSuperAdmin -> cria o super admin inicial, se configurado
//
// Nada aqui derruba o app: cada etapa é isolada e só loga erros.
// ============================================================
const autoMigrate = require("./autoMigrate");
const ensureSuperAdmin = require("./ensureSuperAdmin");

async function bootstrap() {
  let migration;
  try {
    migration = await autoMigrate();
  } catch (e) {
    console.error("[migrate] falhou:", e.message);
    migration = { error: e.message };
  }

  let superadmin;
  try {
    superadmin = await ensureSuperAdmin();
  } catch (e) {
    console.error("[superadmin] falhou:", e.message);
    superadmin = { error: e.message };
  }

  return { migration, superadmin };
}

module.exports = bootstrap;
