-- Migration: Add text_content column if missing
-- Run this if you already have sales_embeddings table without text_content column

-- Add text_content column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'sales_embeddings' 
        AND column_name = 'text_content'
    ) THEN
        ALTER TABLE public.sales_embeddings ADD COLUMN text_content text;
        COMMENT ON COLUMN public.sales_embeddings.text_content IS 'Original text used to generate embedding (for debugging/reingestion)';
    END IF;
END $$;

-- Update the match function to use COALESCE for backward compatibility
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
