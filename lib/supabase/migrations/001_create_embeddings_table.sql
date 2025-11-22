-- Migration: Create sales_embeddings table with pgvector support
-- This table stores vector embeddings of sales records for RAG/semantic search

-- Enable pgvector extension (required for vector operations)
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the embeddings table
-- Each row represents one sales record with its vector embedding and metadata
CREATE TABLE IF NOT EXISTS public.sales_embeddings (
  id text PRIMARY KEY,                -- Keyed by bill_no for idempotent upserts
  embedding vector(768),              -- 768 dimensions for Gemini text-embedding-004 (adjust if using different model)
  metadata jsonb NOT NULL,            -- Stored fields: billing_date, matnr, billing_type, amount, country, etc.
  text_content text,                  -- Original text used to generate embedding (for debugging/reingestion)
  updated_at timestamptz DEFAULT now()
);

-- Create HNSW index for fast approximate nearest neighbor search
-- Using ivfflat as a fallback if HNSW not available; adjust parameters based on dataset size
-- For production with >10k rows, consider HNSW with higher m value
CREATE INDEX IF NOT EXISTS sales_embeddings_vector_idx 
  ON public.sales_embeddings 
  USING ivfflat (embedding vector_cosine_ops) 
  WITH (lists = 100);

-- Optional: create GIN index on metadata for hybrid filtering
CREATE INDEX IF NOT EXISTS sales_embeddings_metadata_idx 
  ON public.sales_embeddings 
  USING gin (metadata);

-- Create index on updated_at for incremental ingestion queries
CREATE INDEX IF NOT EXISTS sales_embeddings_updated_at_idx 
  ON public.sales_embeddings (updated_at DESC);

-- Create a helper function for similarity search with metadata filtering
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
  metadata jsonb,
  text_content text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sales_embeddings.id,
    1 - (sales_embeddings.embedding <=> query_embedding) AS similarity,
    sales_embeddings.metadata,
    COALESCE(sales_embeddings.text_content, ''::text) AS text_content
  FROM public.sales_embeddings
  WHERE 
    -- Apply metadata filters if provided
    (filter_billing_type IS NULL OR sales_embeddings.metadata->>'billing_type' = filter_billing_type)
    AND (filter_country IS NULL OR sales_embeddings.metadata->>'country' = filter_country)
    AND (filter_date_start IS NULL OR (sales_embeddings.metadata->>'billing_date')::date >= filter_date_start)
    AND (filter_date_end IS NULL OR (sales_embeddings.metadata->>'billing_date')::date <= filter_date_end)
    AND (1 - (sales_embeddings.embedding <=> query_embedding)) >= match_threshold
  ORDER BY sales_embeddings.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Create function to get ingestion progress
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

-- Grant permissions (adjust based on your RLS policies)
-- GRANT SELECT ON public.sales_embeddings TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION match_sales_embeddings TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION get_ingestion_stats TO anon, authenticated;

COMMENT ON TABLE public.sales_embeddings IS 'Vector embeddings of sales records for RAG/semantic search';
COMMENT ON COLUMN public.sales_embeddings.id IS 'Primary key: bill_no from sales table';
COMMENT ON COLUMN public.sales_embeddings.embedding IS 'Vector embedding (768d for Gemini text-embedding-004)';
COMMENT ON COLUMN public.sales_embeddings.metadata IS 'Searchable metadata: billing_date, MATNR, billing_type, amount, country, etc.';
COMMENT ON FUNCTION match_sales_embeddings IS 'Find similar sales records using vector similarity with optional metadata filters';
