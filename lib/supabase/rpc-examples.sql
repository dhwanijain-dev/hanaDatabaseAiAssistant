-- Example RPC (Postgres) functions for efficient server-side aggregation.
-- Adjust table/column names to match your actual schema.
-- Deploy these in Supabase SQL editor or migration workflow.

-- Monthly totals (optionally filtered by country or product)
CREATE OR REPLACE FUNCTION public.monthly_sales(
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL,
  country_filter text DEFAULT NULL,
  product_filter text DEFAULT NULL
)
RETURNS TABLE(month text, total_amount numeric) AS $$
  SELECT to_char(s.billing_date, 'YYYY-MM') AS month,
         SUM(s.Amount) AS total_amount
  FROM sales s
  WHERE (start_date IS NULL OR s.billing_date >= start_date)
    AND (end_date IS NULL OR s.billing_date <= end_date)
    AND (country_filter IS NULL OR s.country = country_filter)
    AND (product_filter IS NULL OR s.MATNR = product_filter)
  GROUP BY 1
  ORDER BY 1;
$$ LANGUAGE sql STABLE;

-- Totals grouped by country
CREATE OR REPLACE FUNCTION public.country_sales(
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL,
  product_filter text DEFAULT NULL
)
RETURNS TABLE(country text, total_amount numeric) AS $$
  SELECT COALESCE(s.country, '(none)') AS country,
         SUM(s.Amount) AS total_amount
  FROM sales s
  WHERE (start_date IS NULL OR s.billing_date >= start_date)
    AND (end_date IS NULL OR s.billing_date <= end_date)
    AND (product_filter IS NULL OR s.MATNR = product_filter)
  GROUP BY 1
  ORDER BY total_amount DESC;
$$ LANGUAGE sql STABLE;

-- Totals grouped by product (MATNR)
CREATE OR REPLACE FUNCTION public.product_sales(
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL,
  country_filter text DEFAULT NULL
)
RETURNS TABLE(matnr text, total_amount numeric) AS $$
  SELECT COALESCE(s.MATNR, '(none)') AS matnr,
         SUM(s.Amount) AS total_amount
  FROM sales s
  WHERE (start_date IS NULL OR s.billing_date >= start_date)
    AND (end_date IS NULL OR s.billing_date <= end_date)
    AND (country_filter IS NULL OR s.country = country_filter)
  GROUP BY 1
  ORDER BY total_amount DESC;
$$ LANGUAGE sql STABLE;

-- Suggested indexes to support these aggregations efficiently
-- CREATE INDEX IF NOT EXISTS idx_sales_billing_date ON sales (billing_date);
-- CREATE INDEX IF NOT EXISTS idx_sales_billing_date_country ON sales (billing_date, country);
-- CREATE INDEX IF NOT EXISTS idx_sales_billing_date_matnr ON sales (billing_date, MATNR);

-- ---------------------------------------------------------------------------
-- Yearly totals (backward-compatible helper)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_years(
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL,
  country_filter text DEFAULT NULL,
  product_filter text DEFAULT NULL
)
RETURNS TABLE(year text, total_amount numeric) AS $$
  SELECT to_char(s.billing_date, 'YYYY') AS year,
         SUM(s.Amount) AS total_amount
  FROM sales s
  WHERE (start_date IS NULL OR s.billing_date >= start_date)
    AND (end_date IS NULL OR s.billing_date <= end_date)
    AND (country_filter IS NULL OR s.country = country_filter)
    AND (product_filter IS NULL OR s.MATNR = product_filter)
  GROUP BY 1
  ORDER BY 1;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- Generic aggregation RPC: sales_aggregate(granularity, start_date, end_date, country_filter, product_filter)
-- Returns rows with (period text, total_amount numeric). The server code normalizes this shape.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_aggregate(
  granularity text,
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL,
  country_filter text DEFAULT NULL,
  product_filter text DEFAULT NULL
)
RETURNS TABLE(period text, total_amount numeric) AS $$
  SELECT
    CASE
      WHEN granularity = 'month' THEN to_char(date_trunc('month', s.billing_date), 'YYYY-MM')
      WHEN granularity = 'year' THEN to_char(date_trunc('year', s.billing_date), 'YYYY')
      WHEN granularity = 'country' THEN COALESCE(s.country, '(none)')
      WHEN granularity = 'product' THEN COALESCE(s.MATNR, '(none)')
      ELSE to_char(date_trunc('month', s.billing_date), 'YYYY-MM')
    END AS period,
    SUM(s.Amount) AS total_amount
  FROM sales s
  WHERE (country_filter IS NULL OR s.country = country_filter)
    AND (product_filter IS NULL OR s.MATNR = product_filter)
    AND (start_date IS NULL OR s.billing_date >= start_date)
    AND (end_date IS NULL OR s.billing_date <= end_date)
  GROUP BY 1
  ORDER BY 1;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- Vector embeddings table example (for RAG)
-- Adjust types if you have pgvector installed (vector type) or use float8[] as shown.
-- ---------------------------------------------------------------------------
-- CREATE TABLE public.sales_embeddings (
--   id uuid PRIMARY KEY,
--   content text NOT NULL,
--   metadata jsonb,
--   embedding float8[] -- or vector if pgvector extension is installed
-- );
--
-- -- If using pgvector, you'd use `vector` type and an ivfflat index:
-- -- ALTER TABLE public.sales_embeddings ALTER COLUMN embedding TYPE vector USING embedding::vector;
-- -- CREATE INDEX IF NOT EXISTS idx_sales_embeddings_embedding ON public.sales_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
--
-- CREATE INDEX IF NOT EXISTS idx_sales_embeddings_metadata ON public.sales_embeddings USING gin (metadata jsonb_path_ops);
--
-- Note: If your sales table uses `bill_no` as the primary key and you want deterministic
-- upserts into the embeddings table, create `sales_embeddings.id` as TEXT (or UUID and
-- store the bill_no string there). The ingestion helper in `lib/vector.ts` will use
-- `bill_no` as the upsert id when present to prevent duplicate embeddings for the
-- same invoice.
-- Example (use text id to avoid cast issues):
-- CREATE TABLE public.sales_embeddings (
--   id text PRIMARY KEY,
--   content text NOT NULL,
--   metadata jsonb,
--   embedding float8[]
-- );
--
