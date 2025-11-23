-- Cleanup: Drop old columns that are NULL (from old schema)
-- Run this AFTER the data migration (005_migrate_preserving_policies.sql)

BEGIN;

-- Drop old columns that don't exist in the new schema
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

-- Add any other old columns you want to drop here
-- ALTER TABLE sales DROP COLUMN IF EXISTS old_column_name;

COMMIT;

-- Verification: Check remaining columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'sales'
ORDER BY ordinal_position;

-- Check for NULL columns
DO $$
DECLARE
    col_name TEXT;
    null_count INTEGER;
    total_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_count FROM sales;
    
    FOR col_name IN 
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'sales'
    LOOP
        EXECUTE format('SELECT COUNT(*) FROM sales WHERE %I IS NULL', col_name) INTO null_count;
        
        IF null_count = total_count AND total_count > 0 THEN
            RAISE NOTICE 'Column "%" has ALL NULL values (% rows)', col_name, null_count;
        ELSIF null_count > 0 THEN
            RAISE NOTICE 'Column "%" has % NULL values out of % rows', col_name, null_count, total_count;
        END IF;
    END LOOP;
END $$;
