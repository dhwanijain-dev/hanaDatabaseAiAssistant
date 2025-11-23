-- Check current RLS status and policies on sales table

-- Step 1: Check if RLS is enabled
SELECT 
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename = 'sales';

-- Step 2: List all policies on sales table
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'sales';

-- Step 3: Check if table is accessible (this will fail if RLS blocks it)
SELECT COUNT(*) as total_rows FROM sales;

-- If you need to set up basic RLS policies, uncomment and customize below:

/*
-- Enable RLS on sales table
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow authenticated users to read all sales data
CREATE POLICY "Allow authenticated users to read sales"
ON sales
FOR SELECT
TO authenticated
USING (true);

-- Policy 2: Allow service role to do everything
CREATE POLICY "Allow service role full access"
ON sales
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Policy 3: (Optional) Allow public read access
-- CREATE POLICY "Allow public to read sales"
-- ON sales
-- FOR SELECT
-- TO anon
-- USING (true);

-- Policy 4: (Optional) Restrict by user/tenant if you have user_id column
-- CREATE POLICY "Users can only see their own sales"
-- ON sales
-- FOR SELECT
-- TO authenticated
-- USING (auth.uid() = user_id);

*/

-- Verification: Test access
DO $$
DECLARE
    row_count INTEGER;
    rls_status BOOLEAN;
BEGIN
    -- Check RLS status
    SELECT rowsecurity INTO rls_status
    FROM pg_tables 
    WHERE tablename = 'sales';
    
    -- Try to count rows
    BEGIN
        SELECT COUNT(*) INTO row_count FROM sales;
        RAISE NOTICE '✅ RLS Status: %, Total rows accessible: %', 
            CASE WHEN rls_status THEN 'ENABLED' ELSE 'DISABLED' END,
            row_count;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '❌ Cannot access sales table - RLS may be blocking access';
        RAISE NOTICE 'Error: %', SQLERRM;
    END;
END $$;
