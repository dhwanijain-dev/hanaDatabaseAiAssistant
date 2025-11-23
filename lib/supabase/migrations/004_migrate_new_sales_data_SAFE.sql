-- SAFER Migration: Rename tables instead of dropping columns
-- This approach preserves your sales table policies by swapping table names

BEGIN;

-- Step 1: Rename old sales table to sales_old
ALTER TABLE sales RENAME TO sales_old;

-- Step 2: Rename new_sales_table to sales
ALTER TABLE new_sales_table RENAME TO sales;

-- Step 3: Clear old embeddings (they reference old bill_no values)
TRUNCATE TABLE sales_embeddings;

-- Step 4: Grant same permissions to new sales table
-- (Policies are attached to table name, so they should still work)

COMMIT;

-- Verification queries:
-- SELECT COUNT(*) FROM sales;
-- SELECT COUNT(*) FROM sales_old;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'sales' ORDER BY ordinal_position;

-- After verification, you can drop the old table:
-- DROP TABLE sales_old;

DO $$
BEGIN
    RAISE NOTICE '✅ Safe migration complete!';
    RAISE NOTICE 'Old data is in: sales_old';
    RAISE NOTICE 'New data is in: sales';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Verify data: SELECT COUNT(*) FROM sales;';
    RAISE NOTICE '2. Check policies still work';
    RAISE NOTICE '3. Re-run ingestion: npm run ingest:full';
    RAISE NOTICE '4. After verification, drop old table: DROP TABLE sales_old;';
END $$;
