-- Diagnostic: Check sales_embeddings table schema and status
-- Run this in Supabase SQL Editor to see current state

-- 1. Check if table exists and show columns
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'sales_embeddings'
ORDER BY ordinal_position;

-- 2. Check if pgvector extension is enabled
SELECT 
    extname AS extension_name,
    extversion AS version
FROM pg_extension
WHERE extname = 'vector';

-- 3. Check row count in sales_embeddings
SELECT 
    COUNT(*) as total_embeddings,
    COUNT(text_content) as has_text_content,
    COUNT(*) - COUNT(text_content) as missing_text_content
FROM public.sales_embeddings;

-- 4. Sample a few embeddings
SELECT 
    id,
    metadata->>'billing_type' as billing_type,
    metadata->>'country' as country,
    metadata->>'amount' as amount,
    CASE 
        WHEN text_content IS NOT NULL THEN substring(text_content, 1, 50) || '...'
        ELSE '(null)'
    END as text_preview,
    array_length(embedding::float[], 1) as embedding_dimensions
FROM public.sales_embeddings
LIMIT 5;

-- 5. Check if match function exists
SELECT 
    routine_name,
    routine_type,
    data_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE '%sales_embeddings%';

-- 6. Check indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'sales_embeddings';
