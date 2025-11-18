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
