#!/usr/bin/env node
/* eslint-disable no-console */
// ============================================================
// Cria / atualiza um Super Admin da plataforma WhatsCRM.
//
// Uso (dentro do container do app):
//   docker exec -i -w /app whatscrm-app node scripts/create-super-admin.js \
//     --email usuario@dominio.com --name "Nome" \
//     [--password "SenhaTemp"] [--force-change]
//
// - Sem --password: gera uma senha temporaria forte e imprime no final.
// - Com --force-change: marca must_change_password = 1. Nesse estado o
//   super admin so consegue chamar POST /api/admin/superadmin/change-password
//   ate definir uma senha nova.
//
// Requer as migracoes aplicadas (tabelas super_admins).
// ============================================================

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const pool = require("../database/config");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

function has(flag) {
  return process.argv.includes(`--${flag}`);
}

(async () => {
  const email = String(arg("email", "") || "")
    .trim()
    .toLowerCase();
  const name = String(arg("name", "Super Admin") || "Super Admin").trim();
  const forceChange = has("force-change");
  let password = arg("password", null);
  let generated = false;

  if (!email) {
    console.error("ERRO: informe --email");
    process.exit(1);
  }

  if (!password) {
    password = "Gstd@" + crypto.randomBytes(8).toString("hex");
    generated = true;
  }

  try {
    const p = pool.promise();
    const hash = await bcrypt.hash(password, 10);
    const uid = crypto.randomUUID();

    const [existing] = await p.query(
      "SELECT id FROM super_admins WHERE email = ? LIMIT 1",
      [email],
    );

    if (existing.length) {
      await p.query(
        `UPDATE super_admins
            SET password = ?, name = ?, role = 'super_admin', must_change_password = ?
          WHERE id = ?`,
        [hash, name, forceChange ? 1 : 0, existing[0].id],
      );
      console.log(`Super admin ATUALIZADO: ${email} (id ${existing[0].id})`);
    } else {
      const [r] = await p.query(
        `INSERT INTO super_admins (uid, email, password, name, role, must_change_password)
         VALUES (?,?,?,?, 'super_admin', ?)`,
        [uid, email, hash, name, forceChange ? 1 : 0],
      );
      console.log(`Super admin CRIADO: ${email} (id ${r.insertId})`);
    }

    console.log(
      `must_change_password: ${forceChange ? "1 (troca obrigatoria no 1o login)" : "0"}`,
    );

    if (generated) {
      console.log("");
      console.log("  SENHA TEMPORARIA: " + password);
      console.log("  (troque no primeiro login)");
    }

    process.exit(0);
  } catch (e) {
    console.error("ERRO:", e.message);
    if (/super_admins/.test(e.message)) {
      console.error(
        "Dica: aplique a migracao server/database/migrations/20261014_01_multi_tenant_core.sql",
      );
    }
    process.exit(1);
  }
})();
