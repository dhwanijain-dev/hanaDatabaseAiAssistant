-- Migration: Copy data from new_sales_table to sales table
-- This script will:
-- 1. Backup old sales data (optional)
-- 2. Add new columns to sales table
-- 3. Copy data from new_sales_table to sales
-- 4. Update embeddings to reference new invoice numbers

-- Step 1: Create backup of old sales data (OPTIONAL - uncomment if needed)
-- CREATE TABLE IF NOT EXISTS sales_backup_old AS SELECT * FROM sales;

-- Step 2: Drop old columns and add new columns to sales table
-- WARNING: This will delete existing data in the sales table!
-- If you want to keep old data, skip this step and manually map columns

BEGIN;

-- First, let's see what we're working with
-- Run this query first to understand the structure:
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'sales' ORDER BY ordinal_position;

-- Step 2a: Drop old sales data (you mentioned it's old dummy data)
TRUNCATE TABLE sales;

-- Step 2b: Drop old columns from sales table
ALTER TABLE sales DROP COLUMN IF EXISTS bill_no;
ALTER TABLE sales DROP COLUMN IF EXISTS billing_date;
ALTER TABLE sales DROP COLUMN IF EXISTS "Amount";
ALTER TABLE sales DROP COLUMN IF EXISTS "MATNR";
ALTER TABLE sales DROP COLUMN IF EXISTS mat_description;
ALTER TABLE sales DROP COLUMN IF EXISTS country;
ALTER TABLE sales DROP COLUMN IF EXISTS company_code;
ALTER TABLE sales DROP COLUMN IF EXISTS coustmer_code;
ALTER TABLE sales DROP COLUMN IF EXISTS billing_type;
ALTER TABLE sales DROP COLUMN IF EXISTS "Division";
ALTER TABLE sales DROP COLUMN IF EXISTS "Plant";
ALTER TABLE sales DROP COLUMN IF EXISTS currency;
ALTER TABLE sales DROP COLUMN IF EXISTS state_code;

-- Step 2c: Add all new columns to sales table
-- Copy column definitions from new_sales_table
DO $$
DECLARE
    col_record RECORD;
    alter_sql TEXT;
BEGIN
    -- Get all columns from new_sales_table and add them to sales
    FOR col_record IN 
        SELECT column_name, data_type, character_maximum_length, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'new_sales_table' 
        AND column_name NOT IN (SELECT column_name FROM information_schema.columns WHERE table_name = 'sales')
        ORDER BY ordinal_position
    LOOP
        alter_sql := 'ALTER TABLE sales ADD COLUMN IF NOT EXISTS "' || col_record.column_name || '" ' || col_record.data_type;
        
        -- Add length constraint for varchar/char types
        IF col_record.character_maximum_length IS NOT NULL THEN
            alter_sql := alter_sql || '(' || col_record.character_maximum_length || ')';
        END IF;
        
        -- Add NOT NULL constraint if needed
        IF col_record.is_nullable = 'NO' THEN
            alter_sql := alter_sql || ' NOT NULL';
        END IF;
        
        EXECUTE alter_sql;
        RAISE NOTICE 'Added column: %', col_record.column_name;
    END LOOP;
END $$;

-- Step 3: Copy data from new_sales_table to sales
INSERT INTO sales 
SELECT * FROM new_sales_table;

-- Step 4: Clear old embeddings (they reference old bill_no values)
-- The new ingestion will create embeddings for new invoice numbers
TRUNCATE TABLE sales_embeddings;

COMMIT;

-- Verification queries (run these after the migration):
-- SELECT COUNT(*) as sales_count FROM sales;
-- SELECT COUNT(*) as new_sales_count FROM new_sales_table;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'sales' ORDER BY ordinal_position;

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ Migration complete!';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Verify data: SELECT COUNT(*) FROM sales;';
    RAISE NOTICE '2. Re-run ingestion: npm run ingest:full';
    RAISE NOTICE '3. (Optional) Drop old table: DROP TABLE new_sales_table;';
END $$;
