-- Quick fix: Change id column from uuid to text
-- Run this in Supabase SQL Editor

-- Step 0: Enable pgvector extension (required for vector type)
-- If this fails, go to Database > Extensions in Supabase dashboard and enable "vector"
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- Step 1: Drop existing table if you haven't ingested data yet
DROP TABLE IF EXISTS public.sales_embeddings CASCADE;

-- Step 2: Recreate with correct schema
CREATE TABLE public.sales_embeddings (
  id text PRIMARY KEY,                -- TEXT not UUID (keyed by bill_no)
  embedding vector(768),              
  metadata jsonb NOT NULL,            
  updated_at timestamptz DEFAULT now()
);

-- Step 3: Create index
CREATE INDEX sales_embeddings_vector_idx 
  ON public.sales_embeddings 
  USING ivfflat (embedding vector_cosine_ops) 
  WITH (lists = 100);

-- Step 4: Create metadata index
CREATE INDEX sales_embeddings_metadata_idx 
  ON public.sales_embeddings 
  USING gin (metadata);

-- Step 5: Create updated_at index
CREATE INDEX sales_embeddings_updated_at_idx 
  ON public.sales_embeddings (updated_at DESC);

-- Step 6: Create match function
CREATE OR REPLACE FUNCTION match_sales_embeddings(
  query_embedding vector(768),
  filter_billing_type text DEFAULT NULL,
  filter_country text DEFAULT NULL,
  filter_date_start date DEFAULT NULL,
  filter_date_end date DEFAULT NULL,
  match_threshold float DEFAULT 0.2,
  match_count int DEFAULT 50
)
RETURNS TABLE (
  id text,
  similarity float,
  metadata jsonb
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sales_embeddings.id,
    1 - (sales_embeddings.embedding <=> query_embedding) AS similarity,
    sales_embeddings.metadata
  FROM public.sales_embeddings
  WHERE 
    (filter_billing_type IS NULL OR sales_embeddings.metadata->>'billing_type' = filter_billing_type)
    AND (filter_country IS NULL OR sales_embeddings.metadata->>'country' = filter_country)
    AND (filter_date_start IS NULL OR (sales_embeddings.metadata->>'billing_date')::date >= filter_date_start)
    AND (filter_date_end IS NULL OR (sales_embeddings.metadata->>'billing_date')::date <= filter_date_end)
    AND (1 - (sales_embeddings.embedding <=> query_embedding)) >= match_threshold
  ORDER BY sales_embeddings.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Step 7: Create stats function
CREATE OR REPLACE FUNCTION get_ingestion_stats()
RETURNS TABLE (
  total_sales_rows bigint,
  total_embeddings bigint,
  missing_embeddings bigint,
  last_updated timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM public.sales)::bigint,
    (SELECT COUNT(*) FROM public.sales_embeddings)::bigint,
    (SELECT COUNT(*) FROM public.sales WHERE bill_no::text NOT IN (SELECT id FROM public.sales_embeddings))::bigint,
    (SELECT MAX(updated_at) FROM public.sales_embeddings)
  ;
END;
$$;

-- Verify
SELECT 'Setup complete!' as status;
