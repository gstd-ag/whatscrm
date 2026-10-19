-- ============================================================
-- MIGRACAO: Troca obrigatoria de senha no primeiro login do Super Admin
-- Data: 2026-10-19
--
-- O que faz:
--   1. Adiciona a coluna `must_change_password` em `super_admins`.
--   2. (Comentado) Exemplo de como exigir a troca de um super admin.
--
-- IDEMPOTENTE: pode ser executada quantas vezes for necessario.
-- Requer MariaDB 10.11+ (ADD COLUMN IF NOT EXISTS).
--
-- Como executar (banco existente / volume ja inicializado):
--   docker exec -i whatscrm-db mariadb -u root -p"$DB_ROOT_PASS" whatscrm \
--     < database/migrations/20261019_superadmin_force_password_change.sql
-- ============================================================

-- ----------------------------------------------------------
-- 1. Flag de troca obrigatoria de senha
--    0 = senha normal
--    1 = ao logar, o super admin so pode acessar
--        POST /api/admin/superadmin/change-password ate trocar
-- ----------------------------------------------------------
ALTER TABLE `super_admins`
  ADD COLUMN IF NOT EXISTS `must_change_password` TINYINT(1) NOT NULL DEFAULT 0;

-- ----------------------------------------------------------
-- 2. Exemplo: exigir a troca no proximo login de um super admin
--    (descomente e ajuste o e-mail conforme necessario)
-- ----------------------------------------------------------
-- UPDATE `super_admins`
--    SET `must_change_password` = 1
--  WHERE `email` = 'admin@admin.com';

-- ----------------------------------------------------------
-- 3. Conferencia
-- ----------------------------------------------------------
SELECT `id`, `email`, `role`, `must_change_password`
  FROM `super_admins`;
