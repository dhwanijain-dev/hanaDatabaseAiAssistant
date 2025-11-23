-- BEST Migration: Preserve RLS policies by copying data instead of renaming tables
-- This approach keeps your sales table intact with all its policies

BEGIN;

-- Step 1: Backup current sales data (optional safety measure)
CREATE TABLE IF NOT EXISTS sales_backup_old AS SELECT * FROM sales;

-- Step 2: Clear old data from sales table
TRUNCATE TABLE sales;

-- Step 3: First, we need to check if sales table has the new columns
-- If not, we'll add them

-- Get list of columns from new_sales_table and add missing ones to sales
DO $$
DECLARE
    col_record RECORD;
    alter_sql TEXT;
    sales_columns TEXT[];
BEGIN
    -- Get existing columns in sales table
    SELECT array_agg(column_name) INTO sales_columns
    FROM information_schema.columns 
    WHERE table_name = 'sales';
    
    -- Add missing columns from new_sales_table
    FOR col_record IN 
        SELECT 
            column_name, 
            data_type, 
            character_maximum_length,
            numeric_precision,
            numeric_scale,
            is_nullable,
            column_default
        FROM information_schema.columns 
        WHERE table_name = 'new_sales_table'
        ORDER BY ordinal_position
    LOOP
        -- Check if column exists in sales table
        IF NOT (col_record.column_name = ANY(sales_columns)) THEN
            -- Build ALTER TABLE statement
            alter_sql := 'ALTER TABLE sales ADD COLUMN "' || col_record.column_name || '" ' || col_record.data_type;
            
            -- Add length for varchar/char/character types only
            IF col_record.character_maximum_length IS NOT NULL AND 
               col_record.data_type IN ('character varying', 'character', 'varchar', 'char') THEN
                alter_sql := alter_sql || '(' || col_record.character_maximum_length || ')';
            END IF;
            
            -- Add precision/scale for numeric/decimal types only (not bigint, integer, etc.)
            IF col_record.numeric_precision IS NOT NULL AND 
               col_record.data_type IN ('numeric', 'decimal') THEN
                alter_sql := alter_sql || '(' || col_record.numeric_precision;
                IF col_record.numeric_scale IS NOT NULL AND col_record.numeric_scale > 0 THEN
                    alter_sql := alter_sql || ',' || col_record.numeric_scale;
                END IF;
                alter_sql := alter_sql || ')';
            END IF;
            
            -- Add default value if exists
            IF col_record.column_default IS NOT NULL THEN
                alter_sql := alter_sql || ' DEFAULT ' || col_record.column_default;
            END IF;
            
            EXECUTE alter_sql;
            RAISE NOTICE 'Added column: %', col_record.column_name;
        END IF;
    END LOOP;
END $$;

-- Step 4: Copy data from new_sales_table to sales
-- Build dynamic INSERT statement to match columns
DO $$
DECLARE
    insert_sql TEXT;
    column_list TEXT;
BEGIN
    -- Get common columns between both tables
    SELECT string_agg('"' || column_name || '"', ', ' ORDER BY ordinal_position)
    INTO column_list
    FROM information_schema.columns
    WHERE table_name = 'new_sales_table';
    
    -- Build and execute INSERT statement
    insert_sql := 'INSERT INTO sales (' || column_list || ') SELECT ' || column_list || ' FROM new_sales_table';
    EXECUTE insert_sql;
    
    RAISE NOTICE 'Copied % rows from new_sales_table to sales', (SELECT COUNT(*) FROM sales);
END $$;

-- Step 5: Clear old embeddings (they reference old invoice numbers)
TRUNCATE TABLE sales_embeddings;

COMMIT;

-- Verification queries
DO $$
DECLARE
    sales_count INTEGER;
    new_sales_count INTEGER;
    embeddings_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO sales_count FROM sales;
    SELECT COUNT(*) INTO new_sales_count FROM new_sales_table;
    SELECT COUNT(*) INTO embeddings_count FROM sales_embeddings;
    
    RAISE NOTICE '✅ Migration complete!';
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE 'Sales table rows: %', sales_count;
    RAISE NOTICE 'New sales table rows: %', new_sales_count;
    RAISE NOTICE 'Embeddings cleared: % → 0', embeddings_count;
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE '';
    RAISE NOTICE '📋 Next steps:';
    RAISE NOTICE '1. Verify RLS policies still work: SELECT * FROM sales LIMIT 5;';
    RAISE NOTICE '2. Test your app queries';
    RAISE NOTICE '3. Re-run embeddings ingestion: npm run ingest:full';
    RAISE NOTICE '4. After verification, drop backup: DROP TABLE sales_backup_old;';
    RAISE NOTICE '5. After verification, drop old table: DROP TABLE new_sales_table;';
END $$;

-- Optional: View column structure comparison
-- SELECT 
--     'sales' as table_name, 
--     column_name, 
--     data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'sales'
-- UNION ALL
-- SELECT 
--     'new_sales_table' as table_name, 
--     column_name, 
--     data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'new_sales_table'
-- ORDER BY column_name, table_name;
