-- ============================================================
-- SEED / REPARO DOS ADMINS DE PLATAFORMA
-- Data: 2026-10-19
--
-- Contexto: em producao os logins falhavam porque:
--   - super_admins: gstd.digital@gmail.com existia com senha desconhecida
--   - admin (painel /admin/login): gstd.digital@gmail.com com senha
--     desconhecida e admin@admin.com AUSENTE
--
-- O que faz (idempotente):
--   1. Garante o super admin gstd.digital@gmail.com com senha
--      TEMPORARIA conhecida e must_change_password = 1
--      (o primeiro login obriga a troca via /api/admin/superadmin/change-password).
--   2. Espelha a conta na tabela `admin` para o painel /admin/login
--      (tokenVersion e incrementado -> invalida sessoes antigas).
--   3. Garante admin@admin.com na tabela `admin` (mesma senha admin123
--      ja usada no super admin / import.sql).
--
-- SENHA TEMPORARIA: Gstd@2026#Temp
--   Troque no primeiro login. Este hash e apenas um bootstrap; a conta
--   NAO deve permanecer com esta senha.
--
-- Roda uma unica vez por banco (schema_migrations). Em banco novo, roda
-- no primeiro boot logo apos a migracao 20261019_superadmin_*.
-- ============================================================

-- ----------------------------------------------------------
-- 1) Super admin gstd.digital@gmail.com
-- ----------------------------------------------------------
INSERT INTO `super_admins`
  (`uid`, `email`, `password`, `name`, `role`, `must_change_password`)
VALUES
  ('2254ff64-6c5c-4a30-9f62-e6fd31cc84f1',
   'gstd.digital@gmail.com',
   '$2b$10$sRL/6j8R9hs3tpC3luR7lOS4l8kB7sq.h8ar8BI2g3JiSiSRy6h8S',
   'GSTD Admin', 'super_admin', 1)
ON DUPLICATE KEY UPDATE
  `password` = VALUES(`password`),
  `name` = VALUES(`name`),
  `role` = 'super_admin',
  `must_change_password` = 1;

-- ----------------------------------------------------------
-- 2) Espelho no painel /admin/login (tabela admin nao tem UNIQUE em email)
-- ----------------------------------------------------------
UPDATE `admin`
   SET `password` = '$2b$10$sRL/6j8R9hs3tpC3luR7lOS4l8kB7sq.h8ar8BI2g3JiSiSRy6h8S',
       `role` = 'admin',
       `tokenVersion` = COALESCE(`tokenVersion`, 0) + 1
 WHERE `email` = 'gstd.digital@gmail.com';

INSERT INTO `admin` (`email`, `password`, `uid`, `role`, `tokenVersion`)
SELECT 'gstd.digital@gmail.com',
       '$2b$10$sRL/6j8R9hs3tpC3luR7lOS4l8kB7sq.h8ar8BI2g3JiSiSRy6h8S',
       '2254ff64-6c5c-4a30-9f62-e6fd31cc84f1',
       'admin', 1
 WHERE NOT EXISTS (
   SELECT 1 FROM `admin` WHERE `email` = 'gstd.digital@gmail.com'
 );

-- ----------------------------------------------------------
-- 3) admin@admin.com no painel /admin (hash de admin123 do import.sql)
-- ----------------------------------------------------------
INSERT INTO `admin` (`email`, `password`, `uid`, `role`, `tokenVersion`)
SELECT 'admin@admin.com',
       '$2b$10$GU7t8lVF6NZSK0607nC4CO2NIMhW8sFgNAF7riVMRlsYP/XsGot2G',
       'XhbfYkIAC1bYGhUodfJppmRCEUyGQJCZ',
       'admin', 1
 WHERE NOT EXISTS (
   SELECT 1 FROM `admin` WHERE `email` = 'admin@admin.com'
 );

-- ----------------------------------------------------------
-- 4) Conferencia
-- ----------------------------------------------------------
SELECT `id`, `email`, `role` FROM `admin`
 WHERE `email` IN ('admin@admin.com', 'gstd.digital@gmail.com');

SELECT `id`, `email`, `role`, `must_change_password` FROM `super_admins`
 WHERE `email` IN ('admin@admin.com', 'gstd.digital@gmail.com');
