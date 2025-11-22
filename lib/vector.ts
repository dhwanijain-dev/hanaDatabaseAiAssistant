import { createClient } from "@/lib/supabase/server";
import { embedText, embedTextBatch } from "./embeddings";

/**
 * Production vector helper with:
 * - Batch ingestion with progress tracking
 * - Idempotent upserts by bill_no
 * - Hybrid search (vector + metadata filters)
 * - Incremental ingestion support
 */

export interface SalesRow {
  bill_no: number;
  billing_date?: string;
  Amount?: string;
  MATNR?: string;
  mat_description?: string;
  country?: string;
  company_code?: string;
  coustmer_code?: string;
  billing_type?: string;
  Division?: string;
  Plant?: string;
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
  
  parts.push(`Bill Number: ${row.bill_no}`);
  if (row.billing_date) parts.push(`Date: ${row.billing_date}`);
  if (row.Amount) parts.push(`Amount: ${row.Amount}`);
  if (row.MATNR) parts.push(`Product Code: ${row.MATNR}`);
  if (row.mat_description) parts.push(`Product: ${row.mat_description}`);
  if (row.country) parts.push(`Country: ${row.country}`);
  if (row.billing_type) parts.push(`Billing Type: ${row.billing_type}`);
  if (row.company_code) parts.push(`Company: ${row.company_code}`);
  if (row.coustmer_code) parts.push(`Customer: ${row.coustmer_code}`);
  if (row.Division) parts.push(`Division: ${row.Division}`);
  if (row.Plant) parts.push(`Plant: ${row.Plant}`);
  
  return parts.join(" | ");
}

// Extract searchable metadata from a sales row
export function extractMetadata(row: SalesRow): Record<string, any> {
  return {
    bill_no: row.bill_no,
    billing_date: row.billing_date || null,
    amount: row.Amount ? parseFloat(row.Amount) : null,
    matnr: row.MATNR || null,
    mat_description: row.mat_description || null,
    country: row.country || null,
    company_code: row.company_code || null,
    coustmer_code: row.coustmer_code || null,
    billing_type: row.billing_type || null,
    division: row.Division || null,
    plant: row.Plant || null,
  };
}

// Build text from metadata (fallback when text_content is missing)
function buildTextFromMetadata(metadata: Record<string, any>): string {
  const parts: string[] = [];
  
  if (metadata.bill_no) parts.push(`Bill Number: ${metadata.bill_no}`);
  if (metadata.billing_date) parts.push(`Date: ${metadata.billing_date}`);
  if (metadata.amount) parts.push(`Amount: ${metadata.amount}`);
  if (metadata.matnr) parts.push(`Product Code: ${metadata.matnr}`);
  if (metadata.mat_description) parts.push(`Product: ${metadata.mat_description}`);
  if (metadata.country) parts.push(`Country: ${metadata.country}`);
  if (metadata.billing_type) parts.push(`Billing Type: ${metadata.billing_type}`);
  if (metadata.company_code) parts.push(`Company: ${metadata.company_code}`);
  if (metadata.coustmer_code) parts.push(`Customer: ${metadata.coustmer_code}`);
  if (metadata.division) parts.push(`Division: ${metadata.division}`);
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
  
  while (processed < total) {
    const currentBatchSize = Math.min(batchSize, total - processed);
    
    // Fetch batch
    const { data: rows, error } = await supabase
      .from("sales")
      .select("bill_no, billing_date, Amount, MATNR, mat_description, country, company_code, coustmer_code, billing_type, Division, Plant")
      .range(processed, processed + currentBatchSize - 1)
      .order("bill_no");
    
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    
    // Deduplicate rows by bill_no (keep last occurrence)
    const uniqueRowsMap = new Map();
    rows.forEach(row => {
      uniqueRowsMap.set(String(row.bill_no), row);
    });
    const uniqueRows = Array.from(uniqueRowsMap.values());
    
    // Build texts for embedding
    const texts = uniqueRows.map(buildTextForEmbedding);
    
    // Generate embeddings in batch
    const embeddings = await embedTextBatch(texts, 50); // Sub-batch for API limits
    
    // Prepare records for upsert (without text_content for compatibility)
    const records = uniqueRows.map((row, idx) => ({
      id: String(row.bill_no),
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
  
  // Find bill_nos that don't have embeddings yet
  const { data: allSales } = await supabase
    .from("sales")
    .select("bill_no");
  
  const { data: existingEmbeddings } = await supabase
    .from("sales_embeddings")
    .select("id");
  
  const existingIds = new Set((existingEmbeddings || []).map((e: any) => e.id));
  const missingBillNos = (allSales || [])
    .map((s: any) => String(s.bill_no))
    .filter((id) => !existingIds.has(id));
  
  // eslint-disable-next-line no-console
  console.log(`Found ${missingBillNos.length} sales rows without embeddings`);
  
  if (missingBillNos.length === 0) {
    return { processed: 0, total: 0 };
  }
  
  let processed = 0;
  
  for (let i = 0; i < missingBillNos.length; i += batchSize) {
    const batchIds = missingBillNos.slice(i, i + batchSize);
    
    // Fetch rows
    const { data: rows, error } = await supabase
      .from("sales")
      .select("bill_no, billing_date, Amount, MATNR, mat_description, country, company_code, coustmer_code, billing_type, Division, Plant")
      .in("bill_no", batchIds.map((id) => parseInt(id, 10)));
    
    if (error) throw error;
    if (!rows || rows.length === 0) continue;
    
    // Deduplicate rows by bill_no (keep last occurrence)
    const uniqueRowsMap = new Map();
    rows.forEach(row => {
      uniqueRowsMap.set(String(row.bill_no), row);
    });
    const uniqueRows = Array.from(uniqueRowsMap.values());
    
    const texts = uniqueRows.map(buildTextForEmbedding);
    const embeddings = await embedTextBatch(texts, 50);
    
    const records = uniqueRows.map((row, idx) => ({
      id: String(row.bill_no),
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
  
  return { processed, total: missingBillNos.length };
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
