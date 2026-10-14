-- ============================================================
-- MIGRACAO ADITIVA / IDEMPOTENTE (TAREFA 4)
-- Backfill de dados legados para o tenant padrao/mestre.
--
-- O que faz:
--   1. Garante a coluna `tenant_id` nas tabelas de conversa/atribuicao
--      legadas que ainda nao tem (chats, agent_chats) — protege as
--      queries isoladas adicionadas em routes/ (TAREFA 1).
--   2. Cria o indice composto idx_tenant (tenant_id, uid(120)) nelas.
--   3. UPDATE ... WHERE tenant_id IS NULL em TODA tabela que possuir
--      a coluna, apontando para o tenant padrao (slug 'clinica-padrao',
--      seed da migração 02; fallback: menor id de `tenants`).
--
-- Seguranca / idempotencia:
--   - Pode rodar N vezes (guardas information_schema + WHERE IS NULL).
--   - Nenhuma tabela-alvo tem FK para `tenants` nem indice UNIQUE
--     contendo tenant_id -> sem risco de violar chaves estrangeiras
--     ou indices unicos.
--   - `tenant_users` (NOT NULL + FK) e ignorada por nao ter dados NULL.
--
-- Banco existente (initdb.d so roda no primeiro boot do volume):
--   docker exec -i <db> mysql -u root -p"$MYSQL_ROOT_PASSWORD" \
--     "$MYSQL_DATABASE" < database/migrations/20261014_backfill_legacy.sql
-- ============================================================

-- ----------------------------------------------------------
-- 0. Guardas idempotentes (mesmos helpers da migracao 02)
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
-- 1. Coluna tenant_id nas tabelas de conversa/atribuicao legadas
--    (presentes em routes/user.js e routes/agent.js — TAREFA 1)
-- ----------------------------------------------------------
CALL add_column_if_missing('chats',       'tenant_id', 'int(11) DEFAULT NULL');
CALL add_column_if_missing('agent_chats', 'tenant_id', 'int(11) DEFAULT NULL');

-- ----------------------------------------------------------
-- 2. Indice composto (prefixo 120: uid e varchar(999) > 3072 bytes)
-- ----------------------------------------------------------
CALL add_index_if_missing('chats',       'idx_tenant', 'tenant_id, uid(120)');
CALL add_index_if_missing('agent_chats', 'idx_tenant', 'tenant_id, uid(120)');

-- ----------------------------------------------------------
-- 3. Backfill: TODA tabela com coluna tenant_id e NULL => tenant padrao
-- ----------------------------------------------------------
DROP PROCEDURE IF EXISTS backfill_tenant_id;
DELIMITER $$
CREATE PROCEDURE backfill_tenant_id()
BEGIN
    DECLARE done    INT DEFAULT FALSE;
    DECLARE v_table VARCHAR(64);
    DECLARE v_tenant INT DEFAULT NULL;

    DECLARE cur CURSOR FOR
        SELECT c.TABLE_NAME
          FROM information_schema.COLUMNS c
         WHERE c.TABLE_SCHEMA = DATABASE()
           AND c.COLUMN_NAME = 'tenant_id'
           AND c.TABLE_NAME NOT IN ('tenants', 'tenant_users', 'super_admins');

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Tenant padrao/mestre: slug do seed da migracao 02
    SELECT id INTO v_tenant FROM tenants WHERE slug = 'clinica-padrao' LIMIT 1;
    -- Fallback: primeiro tenant existente
    IF v_tenant IS NULL THEN
        SELECT id INTO v_tenant FROM tenants ORDER BY id ASC LIMIT 1;
    END IF;

    IF v_tenant IS NULL THEN
        SELECT 'AVISO: nenhum tenant encontrado — backfill ignorado' AS msg;
    ELSE
        SET done = FALSE;  -- reseta handler disparado pelos SELECT INTO
        OPEN cur;
        read_loop: LOOP
            FETCH cur INTO v_table;
            IF done THEN
                LEAVE read_loop;
            END IF;
            SET @ddl = CONCAT('UPDATE `', v_table,
                              '` SET tenant_id = ', v_tenant,
                              ' WHERE tenant_id IS NULL');
            PREPARE stmt FROM @ddl;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
        END LOOP;
        CLOSE cur;
    END IF;
END$$
DELIMITER ;

CALL backfill_tenant_id();

-- ----------------------------------------------------------
-- 4. Limpeza (procedures nao precisam persistir)
-- ----------------------------------------------------------
DROP PROCEDURE IF EXISTS backfill_tenant_id;
DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS add_index_if_missing;
