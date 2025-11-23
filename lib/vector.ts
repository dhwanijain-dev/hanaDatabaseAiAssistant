import { createClient } from "@/lib/supabase/server";
import { embedText, embedTextBatch } from "./embeddings";
import { NEW_COLUMN_NAMES } from "./column-mapping";

/**
 * Production vector helper with:
 * - Batch ingestion with progress tracking
 * - Idempotent upserts by invoice number
 * - Hybrid search (vector + metadata filters)
 * - Incremental ingestion support
 */

export interface SalesRow {
  [key: string]: any; // Support dynamic column names
}

export interface EmbeddingRecord {
  id: string;
  embedding: number[];
  metadata: Record<string, any>;
  text_content: string;
  updated_at?: string;
}

export interface SearchFilters {
  billing_type?: string;
  country?: string;
  date_start?: string;
  date_end?: string;
  min_amount?: number;
  max_amount?: number;
}

// Build text representation of a sales row for embedding
export function buildTextForEmbedding(row: SalesRow): string {
  const parts: string[] = [];
  
  const invoiceNo = row[NEW_COLUMN_NAMES.invoiceNumber];
  const invoiceDate = row[NEW_COLUMN_NAMES.invoiceDate];
  const amount = row[NEW_COLUMN_NAMES.amount];
  const materialCode = row[NEW_COLUMN_NAMES.materialCode];
  const description = row[NEW_COLUMN_NAMES.description];
  const country = row[NEW_COLUMN_NAMES.country];
  const billingDocType = row[NEW_COLUMN_NAMES.billingDocType];
  const customerCode = row[NEW_COLUMN_NAMES.customerCode];
  const customerName = row[NEW_COLUMN_NAMES.customerName];
  const plant = row[NEW_COLUMN_NAMES.plant];
  
  if (invoiceNo) parts.push(`Invoice Number: ${invoiceNo}`);
  if (invoiceDate) parts.push(`Date: ${invoiceDate}`);
  if (amount) parts.push(`Amount: ${amount}`);
  if (materialCode) parts.push(`Product Code: ${materialCode}`);
  if (description) parts.push(`Product: ${description}`);
  if (country) parts.push(`Country: ${country}`);
  if (billingDocType) parts.push(`Billing Type: ${billingDocType}`);
  if (customerCode) parts.push(`Customer Code: ${customerCode}`);
  if (customerName) parts.push(`Customer: ${customerName}`);
  if (plant) parts.push(`Plant: ${plant}`);
  
  return parts.join(" | ");
}

// Extract searchable metadata from a sales row
export function extractMetadata(row: SalesRow): Record<string, any> {
  return {
    invoice_no: row[NEW_COLUMN_NAMES.invoiceNumber] || null,
    invoice_date: row[NEW_COLUMN_NAMES.invoiceDate] || null,
    amount: row[NEW_COLUMN_NAMES.amount] ? parseFloat(String(row[NEW_COLUMN_NAMES.amount]).replace(/\./g, '').replace(',', '.')) : null,
    material_code: row[NEW_COLUMN_NAMES.materialCode] || null,
    description: row[NEW_COLUMN_NAMES.description] || null,
    country: row[NEW_COLUMN_NAMES.country] || null,
    customer_code: row[NEW_COLUMN_NAMES.customerCode] || null,
    customer_name: row[NEW_COLUMN_NAMES.customerName] || null,
    billing_doc_type: row[NEW_COLUMN_NAMES.billingDocType] || null,
    plant: row[NEW_COLUMN_NAMES.plant] || null,
  };
}

// Build text from metadata (fallback when text_content is missing)
function buildTextFromMetadata(metadata: Record<string, any>): string {
  const parts: string[] = [];
  
  if (metadata.invoice_no) parts.push(`Invoice Number: ${metadata.invoice_no}`);
  if (metadata.invoice_date) parts.push(`Date: ${metadata.invoice_date}`);
  if (metadata.amount) parts.push(`Amount: ${metadata.amount}`);
  if (metadata.material_code) parts.push(`Product Code: ${metadata.material_code}`);
  if (metadata.description) parts.push(`Product: ${metadata.description}`);
  if (metadata.country) parts.push(`Country: ${metadata.country}`);
  if (metadata.billing_doc_type) parts.push(`Billing Type: ${metadata.billing_doc_type}`);
  if (metadata.customer_code) parts.push(`Customer Code: ${metadata.customer_code}`);
  if (metadata.customer_name) parts.push(`Customer: ${metadata.customer_name}`);
  if (metadata.plant) parts.push(`Plant: ${metadata.plant}`);
  
  return parts.join(" | ");
}

/**
 * Ingest sales rows to embeddings table in batches
 * @param batchSize Number of rows to process at once
 * @param limit Maximum total rows to ingest (null = all)
 * @param onProgress Callback with progress updates
 */
export async function ingestSalesRowsToVectors(
  batchSize = 100,
  limit: number | null = null,
  onProgress?: (processed: number, total: number) => void
) {
  const supabase = await createClient();
  
  // Get total count of rows to ingest
  const { count: totalRows } = await supabase
    .from("sales")
    .select("*", { count: "exact", head: true });
  
  const total = limit && limit < (totalRows || 0) ? limit : totalRows || 0;
  let processed = 0;
  
  // eslint-disable-next-line no-console
  console.log(`Starting ingestion of ${total} sales rows in batches of ${batchSize}...`);
  
  // Helper to quote column names with spaces/special chars
  const quoteCol = (name: string) => `"${name.replace(/"/g, '""')}"`;
  
  // Build select string for the columns we need
  const selectCols = [
    quoteCol(NEW_COLUMN_NAMES.invoiceNumber),
    quoteCol(NEW_COLUMN_NAMES.invoiceDate),
    quoteCol(NEW_COLUMN_NAMES.amount),
    quoteCol(NEW_COLUMN_NAMES.materialCode),
    quoteCol(NEW_COLUMN_NAMES.description),
    quoteCol(NEW_COLUMN_NAMES.country),
    quoteCol(NEW_COLUMN_NAMES.customerCode),
    quoteCol(NEW_COLUMN_NAMES.customerName),
    quoteCol(NEW_COLUMN_NAMES.billingDocType),
    quoteCol(NEW_COLUMN_NAMES.plant),
  ].join(', ');
  
  while (processed < total) {
    const currentBatchSize = Math.min(batchSize, total - processed);
    
    // Fetch batch
    const { data: rows, error } = await supabase
      .from("sales")
      .select(selectCols)
      .range(processed, processed + currentBatchSize - 1)
      .order(quoteCol(NEW_COLUMN_NAMES.invoiceNumber));
    
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    
    // Deduplicate rows by invoice number (keep last occurrence)
    const uniqueRowsMap = new Map();
    const invoiceNumberCol = NEW_COLUMN_NAMES.invoiceNumber;
    rows.forEach((row: any) => {
      const invoiceNo = row[invoiceNumberCol];
      uniqueRowsMap.set(String(invoiceNo), row);
    });
    const uniqueRows = Array.from(uniqueRowsMap.values());
    
    // Build texts for embedding
    const texts = uniqueRows.map(buildTextForEmbedding);
    
    // Generate embeddings in batch
    const embeddings = await embedTextBatch(texts, 50); // Sub-batch for API limits
    
    // Prepare records for upsert (without text_content for compatibility)
    const records = uniqueRows.map((row: any, idx) => ({
      id: String(row[invoiceNumberCol]),
      embedding: embeddings[idx],
      metadata: extractMetadata(row),
    }));
    
    // Upsert to database
    const { error: upsertError } = await supabase
      .from("sales_embeddings")
      .upsert(records, { onConflict: "id" });
    
    if (upsertError) {
      // eslint-disable-next-line no-console
      console.error(`Upsert error at batch ${processed}:`, upsertError);
      throw upsertError;
    }
    
    processed += rows.length;
    
    if (onProgress) {
      onProgress(processed, total);
    }
    
    // eslint-disable-next-line no-console
    console.log(`Ingested ${processed}/${total} rows (${Math.round((processed / total) * 100)}%)`);
  }
  
  return { processed, total };
}

/**
 * Incremental ingestion: only ingest rows not yet in embeddings table
 */
export async function ingestNewSalesRows(batchSize = 100, onProgress?: (processed: number) => void) {
  const supabase = await createClient();
  
  // Helper to quote column names
  const quoteCol = (name: string) => `"${name.replace(/"/g, '""')}"`;
  const invoiceNumberCol = NEW_COLUMN_NAMES.invoiceNumber;
  
  // Find invoice numbers that don't have embeddings yet
  const { data: allSales } = await supabase
    .from("sales")
    .select(quoteCol(invoiceNumberCol));
  
  const { data: existingEmbeddings } = await supabase
    .from("sales_embeddings")
    .select("id");
  
  const existingIds = new Set((existingEmbeddings || []).map((e: any) => e.id));
  const missingInvoiceNos = (allSales || [])
    .map((s: any) => String(s[invoiceNumberCol]))
    .filter((id) => !existingIds.has(id));
  
  // eslint-disable-next-line no-console
  console.log(`Found ${missingInvoiceNos.length} sales rows without embeddings`);
  
  if (missingInvoiceNos.length === 0) {
    return { processed: 0, total: 0 };
  }
  
  let processed = 0;
  
  // Build select string for the columns we need
  const selectCols = [
    quoteCol(NEW_COLUMN_NAMES.invoiceNumber),
    quoteCol(NEW_COLUMN_NAMES.invoiceDate),
    quoteCol(NEW_COLUMN_NAMES.amount),
    quoteCol(NEW_COLUMN_NAMES.materialCode),
    quoteCol(NEW_COLUMN_NAMES.description),
    quoteCol(NEW_COLUMN_NAMES.country),
    quoteCol(NEW_COLUMN_NAMES.customerCode),
    quoteCol(NEW_COLUMN_NAMES.customerName),
    quoteCol(NEW_COLUMN_NAMES.billingDocType),
    quoteCol(NEW_COLUMN_NAMES.plant),
  ].join(', ');
  
  for (let i = 0; i < missingInvoiceNos.length; i += batchSize) {
    const batchIds = missingInvoiceNos.slice(i, i + batchSize);
    
    // Fetch rows
    const { data: rows, error } = await supabase
      .from("sales")
      .select(selectCols)
      .in(quoteCol(invoiceNumberCol), batchIds);
    
    if (error) throw error;
    if (!rows || rows.length === 0) continue;
    
    // Deduplicate rows by invoice number (keep last occurrence)
    const uniqueRowsMap = new Map();
    rows.forEach((row: any) => {
      uniqueRowsMap.set(String(row[invoiceNumberCol]), row);
    });
    const uniqueRows = Array.from(uniqueRowsMap.values());
    
    const texts = uniqueRows.map(buildTextForEmbedding);
    const embeddings = await embedTextBatch(texts, 50);
    
    const records = uniqueRows.map((row: any, idx) => ({
      id: String(row[invoiceNumberCol]),
      embedding: embeddings[idx],
      metadata: extractMetadata(row),
    }));
    
    const { error: upsertError } = await supabase
      .from("sales_embeddings")
      .upsert(records, { onConflict: "id" });
    
    if (upsertError) throw upsertError;
    
    processed += uniqueRows.length;
    
    if (onProgress) {
      onProgress(processed);
    }
  }
  
  return { processed, total: missingInvoiceNos.length };
}

/**
 * Hybrid search: vector similarity + metadata filtering
 */
export async function findNearestContexts(
  query: string,
  topK = 12,
  filters?: SearchFilters
): Promise<Array<{ id: string; score: number; content: string; metadata: any }>> {
  const supabase = await createClient();
  const queryEmbedding = await embedText(query);
  
  // Try using the match_sales_embeddings RPC if available
  try {
    const { data, error } = await supabase.rpc("match_sales_embeddings", {
      query_embedding: queryEmbedding,
      filter_billing_type: filters?.billing_type || null,
      filter_country: filters?.country || null,
      filter_date_start: filters?.date_start || null,
      filter_date_end: filters?.date_end || null,
      match_threshold: 0.0, // Lower threshold to get more results (0.2 was too strict)
      match_count: topK * 2, // Get more candidates for post-filtering
    });
    
    if (!error && data) {
      let results = data.map((row: any) => ({
        id: row.id,
        score: row.similarity,
        content: buildTextFromMetadata(row.metadata),
        metadata: row.metadata,
      }));
      
      // Apply amount filters if specified
      if (filters?.min_amount !== undefined || filters?.max_amount !== undefined) {
        results = results.filter((r: any) => {
          const amount = r.metadata?.amount;
          if (amount === null || amount === undefined) return false;
          if (filters.min_amount !== undefined && amount < filters.min_amount) return false;
          if (filters.max_amount !== undefined && amount > filters.max_amount) return false;
          return true;
        });
      }
      
      return results.slice(0, topK);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("match_sales_embeddings RPC not available, falling back to in-process search:", e);
  }
  
  // Fallback: fetch all and compute similarity in-process
  let dbQuery: any = supabase
    .from("sales_embeddings")
    .select("id, metadata, embedding");
  
  // Apply metadata filters
  if (filters?.billing_type) {
    // Note: jsonb filter syntax depends on your Supabase setup
    // This might need adjustment based on your actual schema
  }
  
  const { data: rows, error } = await dbQuery.limit(1000);
  
  if (error) throw error;
  if (!rows || rows.length === 0) return [];
  
  // Compute cosine similarity
  function cosineSimilarity(a: number[], b: number[]) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(a.length, b.length);
    
    for (let i = 0; i < len; i++) {
      dot += (a[i] || 0) * (b[i] || 0);
      normA += (a[i] || 0) * (a[i] || 0);
      normB += (b[i] || 0) * (b[i] || 0);
    }
    
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
  }
  
  let scored = rows.map((row: any) => ({
    id: row.id,
    score: cosineSimilarity(queryEmbedding, row.embedding as number[]),
    content: buildTextFromMetadata(row.metadata),
    metadata: row.metadata,
  }));
  
  // Apply filters
  scored = scored.filter((item: any) => {
    const meta = item.metadata;
    if (filters?.billing_type && meta.billing_type !== filters.billing_type) return false;
    if (filters?.country && meta.country !== filters.country) return false;
    if (filters?.date_start && (!meta.billing_date || meta.billing_date < filters.date_start)) return false;
    if (filters?.date_end && (!meta.billing_date || meta.billing_date > filters.date_end)) return false;
    if (filters?.min_amount !== undefined && (meta.amount === null || meta.amount < filters.min_amount)) return false;
    if (filters?.max_amount !== undefined && (meta.amount === null || meta.amount > filters.max_amount)) return false;
    return item.score >= 0.2; // Minimum similarity threshold
  });
  
  // Sort by score and take top K
  scored.sort((a: any, b: any) => b.score - a.score);
  
  return scored.slice(0, topK);
}

/**
 * Get ingestion statistics
 */
export async function getIngestionStats() {
  const supabase = await createClient();
  
  try {
    const { data, error } = await supabase.rpc("get_ingestion_stats");
    if (!error && data && data.length > 0) {
      return data[0];
    }
  } catch (e) {
    // Fallback if RPC not available
  }
  
  const { count: salesCount } = await supabase
    .from("sales")
    .select("*", { count: "exact", head: true });
  
  const { count: embeddingsCount } = await supabase
    .from("sales_embeddings")
    .select("*", { count: "exact", head: true });
  
  return {
    total_sales_rows: salesCount || 0,
    total_embeddings: embeddingsCount || 0,
    missing_embeddings: (salesCount || 0) - (embeddingsCount || 0),
  };
}
