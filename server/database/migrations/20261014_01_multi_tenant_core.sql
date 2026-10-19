-- ============================================================
-- MIGRACAO: Multi-Tenant Core (WhatsCRM)
-- Data: 2026-10-14
-- Compativel: MariaDB 10.11 / MySQL 8
-- IDEMPOTENTE: pode ser executada mais de uma vez sem erro.
--
-- Executar:
--   mysql -u root -p <nome_do_banco> \
--     < server/database/migrations/20261014_01_multi_tenant_core.sql
--
-- NOTA: database/import.sql ja contem a coluna `tenant_id` e o indice
-- idx_tenant nas tabelas-alvo (instalacoes novas). Esta migracao cobre
-- bancos existentes e cria as tabelas de controle.
-- ============================================================

-- ----------------------------------------------------------
-- 0. Guarda idempotente: adiciona coluna apenas se nao existir
-- ----------------------------------------------------------
DROP PROCEDURE IF EXISTS add_column_if_missing;
DELIMITER $$
CREATE PROCEDURE add_column_if_missing(
    IN p_table VARCHAR(64),
    IN p_column VARCHAR(64),
    IN p_def VARCHAR(255)
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = p_table
           AND COLUMN_NAME = p_column
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', p_table,
                          '` ADD COLUMN `', p_column, '` ', p_def);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS add_index_if_missing;
DELIMITER $$
CREATE PROCEDURE add_index_if_missing(
    IN p_table VARCHAR(64),
    IN p_index VARCHAR(64),
    IN p_cols VARCHAR(255)
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = p_table
           AND INDEX_NAME = p_index
        LIMIT 1
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', p_table,
                          '` ADD INDEX `', p_index, '` (', p_cols, ')');
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

-- ----------------------------------------------------------
-- 1. Tabela: tenants (clientes / clinicas)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tenants` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `uid` varchar(36) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `name` varchar(255) NOT NULL,
  `domain` varchar(255) DEFAULT NULL,
  `status` enum('active','suspended','trial','expired') DEFAULT 'trial',
  `plan_id` int(11) DEFAULT NULL,
  `plan_expires_at` datetime DEFAULT NULL,
  `trial_ends_at` datetime DEFAULT NULL,
  `settings` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_uid` (`uid`),
  UNIQUE KEY `uq_tenant_slug` (`slug`),
  UNIQUE KEY `uq_tenant_domain` (`domain`),
  KEY `idx_tenant_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------
-- 2. Tabela: tenant_users (relacao usuario x tenant + role)
--    Roles: owner, admin, manager, agent (+ especializacoes
--    do nicho saude: receptionist, triage, doctor, finance)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tenant_users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tenant_id` int(11) NOT NULL,
  `user_uid` varchar(36) NOT NULL,
  `role` enum('owner','admin','manager','agent',
              'receptionist','triage','doctor','finance') DEFAULT 'agent',
  `permissions` json DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `invited_by` varchar(36) DEFAULT NULL,
  `joined_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_user` (`tenant_id`,`user_uid`),
  KEY `idx_tu_user` (`user_uid`),
  CONSTRAINT `fk_tenant_users_tenant`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------
-- 3. Tabela: super_admins (operadores da plataforma)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `super_admins` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `uid` varchar(36) DEFAULT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `role` enum('super_admin','support','billing') DEFAULT 'super_admin',
  `last_login_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sa_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------
-- 4. Super admin padrao
--    Email: admin@admin.com   Senha: admin123
--    (hash bcrypt identico ao do admin do dump - TROQUE APOS O 1o LOGIN)
-- ----------------------------------------------------------
INSERT INTO `super_admins` (`uid`,`email`,`password`,`name`,`role`)
SELECT 'XhbfYkIAC1bYGhUodfJppmRCEUyGQJCZ',
       'admin@admin.com',
       '$2b$10$GU7t8lVF6NZSK0607nC4CO2NIMhW8sFgNAF7riVMRlsYP/XsGot2G',
       'Super Admin WhatsCRM',
       'super_admin'
WHERE NOT EXISTS (
    SELECT 1 FROM (SELECT email FROM `super_admins`) t
     WHERE t.email = 'admin@admin.com'
);

-- ----------------------------------------------------------
-- 5. Tenant padrao (primeira clinica / instancia legada)
-- ----------------------------------------------------------
INSERT INTO `tenants` (`uid`,`slug`,`name`,`status`,`settings`)
SELECT 'a1b2c3d4-0000-4000-8000-000000000001',
       'clinica-padrao',
       'Clinica Padrao',
       'active',
       '{"branding":{"name":"Clinica Padrao","primary_color":"#0066CC"},
         "features":{"enable_whatsapp":true,"enable_scheduling":true}}'
WHERE NOT EXISTS (
    SELECT 1 FROM (SELECT slug FROM `tenants`) t
     WHERE t.slug = 'clinica-padrao'
);

-- ----------------------------------------------------------
-- 6. Vincular o usuario dono existente (admin@admin.com) ao tenant
--    (usuario da tabela `user`; se nao existir, ignora)
-- ----------------------------------------------------------
INSERT INTO `tenant_users` (`tenant_id`,`user_uid`,`role`,`is_active`,`joined_at`)
SELECT t.id, u.uid, 'owner', 1, NOW()
  FROM `tenants` t
  JOIN `user` u ON u.email = 'admin@admin.com'
 WHERE t.slug = 'clinica-padrao'
   AND NOT EXISTS (
        SELECT 1 FROM `tenant_users` tu
         WHERE tu.tenant_id = t.id AND tu.user_uid = u.uid
   );

-- ----------------------------------------------------------
-- 7. tenant_id nas tabelas existentes (apenas bancos antigos;
--    instalacoes novas ja vem com a coluna do import.sql)
-- ----------------------------------------------------------
CALL add_column_if_missing('agents',              'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('agent_task',          'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('instance',            'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('beta_chats',          'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('beta_conversation',   'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('beta_chatbot',        'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('beta_flows',          'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('beta_campaign',       'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('beta_campaign_logs',  'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('beta_api_logs',       'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('contact',             'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('phonebook',           'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('broadcast',           'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('broadcast_log',       'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('templets',            'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('orders',              'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('webhook_logs',        'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('chat_tags',           'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('quick_reply',         'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('qr_campaigns',        'tenant_id', 'int(11) DEFAULT NULL');

-- ----------------------------------------------------------
-- 8. Indices compostos (tenant_id + coluna de agrupamento)
-- ----------------------------------------------------------
CALL add_index_if_missing('agents',            'idx_tenant', 'tenant_id, uid(120)');
CALL add_index_if_missing('agent_task',        'idx_tenant', 'tenant_id, owner_uid(120)');
CALL add_index_if_missing('instance',          'idx_tenant', 'tenant_id, uniqueId(120)');
CALL add_index_if_missing('beta_chats',        'idx_tenant', 'tenant_id, uid(120)');
CALL add_index_if_missing('beta_conversation', 'idx_tenant', 'tenant_id, createdAt');
CALL add_index_if_missing('beta_chatbot',      'idx_tenant', 'tenant_id, uid(120)');
CALL add_index_if_missing('beta_flows',        'idx_tenant', 'tenant_id, uid(120)');
CALL add_index_if_missing('beta_campaign',     'idx_tenant', 'tenant_id, uid(120)');
CALL add_index_if_missing('contact',           'idx_tenant', 'tenant_id, uid(120)');
CALL add_index_if_missing('phonebook',         'idx_tenant', 'tenant_id, uid(120)');
CALL add_index_if_missing('broadcast',         'idx_tenant', 'tenant_id, uid(120)');
CALL add_index_if_missing('templets',          'idx_tenant', 'tenant_id, uid(120)');
CALL add_index_if_missing('orders',            'idx_tenant', 'tenant_id, uid(120)');
CALL add_index_if_missing('webhook_logs',      'idx_tenant', 'tenant_id, uid(120)');

-- ----------------------------------------------------------
-- 9. Backfill: dados legados (sem tenant) => tenant padrao
--    Executar UMA vez apos a migracao:
--
-- UPDATE agents            SET tenant_id = (SELECT id FROM tenants WHERE slug='clinica-padrao') WHERE tenant_id IS NULL;
-- UPDATE instance          SET tenant_id = (SELECT id FROM tenants WHERE slug='clinica-padrao') WHERE tenant_id IS NULL;
-- UPDATE beta_chats        SET tenant_id = (SELECT id FROM tenants WHERE slug='clinica-padrao') WHERE tenant_id IS NULL;
-- UPDATE contact           SET tenant_id = (SELECT id FROM tenants WHERE slug='clinica-padrao') WHERE tenant_id IS NULL;
--
-- (descomente acima apos validar o slug do tenant padrao)
-- ----------------------------------------------------------

-- ----------------------------------------------------------
-- 10. Limpeza dos procedimentos auxiliares
-- ----------------------------------------------------------
DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS add_index_if_missing;

-- FIM DA MIGRACAO
