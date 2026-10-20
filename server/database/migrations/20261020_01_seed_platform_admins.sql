-- ============================================================
-- REPARO: admin@admin.com no painel /admin/login
-- Data: 2026-10-19
--
-- ATENCAO (revisao): a versao anterior deste arquivo criava/atualizava
-- `gstd.digital@gmail.com` com uma SENHA HARDCODED no repositorio
-- (e usava ON DUPLICATE KEY UPDATE password, sobrescrevendo a senha).
-- Isso foi removido porque:
--   1. senha fixa no git e ma pratica de seguranca;
--   2. sobrescrevia a senha a cada execucao;
--   3. o super admin inicial agora e criado no boot por SUPERADMIN_EMAIL
--      (server/database/ensureSuperAdmin.js), com senha temporaria e
--      must_change_password = 1 -> troca obrigatoria no primeiro login.
--
-- O que resta (idempotente e sem credencial embutida):
--   garante `admin@admin.com` na tabela `admin` (painel /admin/login),
--   usando o hash padrao de admin123 que ja existe no import.sql.
--   Se a conta ja existir, NADA e alterado.
-- ============================================================

INSERT INTO `admin` (`email`, `password`, `uid`, `role`, `tokenVersion`)
SELECT 'admin@admin.com',
       '$2b$10$GU7t8lVF6NZSK0607nC4CO2NIMhW8sFgNAF7riVMRlsYP/XsGot2G',
       'XhbfYkIAC1bYGhUodfJppmRCEUyGQJCZ',
       'admin', 1
 WHERE NOT EXISTS (
   SELECT 1 FROM (SELECT `email` FROM `admin`) t
    WHERE t.`email` = 'admin@admin.com'
 );

-- Conferencia
SELECT `id`, `email`, `role`, `tokenVersion` FROM `admin`
 WHERE `email` = 'admin@admin.com';
