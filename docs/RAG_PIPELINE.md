# RAG Pipeline Documentation

## Overview

This sales chatbot uses a production-grade RAG (Retrieval-Augmented Generation) pipeline to provide intelligent, context-aware answers about sales data.

## Architecture

```
User Question
    ↓
Embed Question (Gemini/OpenAI)
    ↓
Vector Search (pgvector) + Metadata Filters
    ↓
Top-K Contexts Retrieved
    ↓
Prompt Assembly (System + Contexts + Question)
    ↓
LLM Generation (Gemini/OpenAI)
    ↓
Answer + Citations
```

## Setup Steps

### 1. Database Setup

Run the migration to create the embeddings table:

```bash
# Copy SQL to Supabase SQL Editor and execute
cat lib/supabase/migrations/001_create_embeddings_table.sql
```

This creates:
- `sales_embeddings` table with vector column
- pgvector indexes (ivfflat for ANN search)
- Helper functions: `match_sales_embeddings`, `get_ingestion_stats`

### 2. Environment Variables

Required in `.env.local`:

```bash
# Primary embedding provider (768 dimensions)
GEMINI_API_KEY=your_gemini_api_key

# Fallback (optional, will use 768d if configured)
OPENAI_API_KEY=your_openai_key

# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3. Initial Data Ingestion

Ingest all sales rows into the vector database:

```bash
# Full backfill (all rows)
curl -X POST http://localhost:3000/api/rag/ingest \
  -H "Content-Type: application/json" \
  -d '{"mode":"full","batchSize":100,"limit":null}'

# Or incremental (only new rows)
curl -X POST http://localhost:3000/api/rag/ingest \
  -H "Content-Type: application/json" \
  -d '{"mode":"incremental","batchSize":100}'
```

Monitor progress in server logs. For 1571 rows with batchSize=100:
- Expected time: ~5-10 minutes (depending on API rate limits)
- API calls: ~16 batches × ~2 sub-batches = ~32 embedding API calls
- Cost: ~$0.10-0.50 (Gemini embeddings are cheaper than OpenAI)

### 4. Check Ingestion Status

```bash
curl http://localhost:3000/api/rag/ingest
```

Response:
```json
{
  "ok": true,
  "stats": {
    "total_sales_rows": 1571,
    "total_embeddings": 1571,
    "missing_embeddings": 0,
    "last_updated": "2025-11-22T10:30:00Z"
  },
  "embeddingStats": {
    "totalRequests": 1571,
    "cacheHits": 0,
    "geminiCalls": 1571,
    "openaiCalls": 0,
    "fallbackCalls": 0,
    "errors": 0
  }
}
```

## Usage

### Query the RAG System

```bash
curl -X POST http://localhost:3000/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What were the top sales for billing type ZTES in 2024?",
    "topK": 12,
    "filters": {
      "billing_type": "ZTES",
      "date_start": "2024-01-01",
      "date_end": "2024-12-31"
    }
  }'
```

Response:
```json
{
  "type": "rag_answer",
  "answer": "Based on the sales data, the top sales for billing type ZTES in 2024 were:\n\n1. [Source 1] Bill 789456 on 2024-06-15: Product P1234 to Country US for $15,430\n2. [Source 3] Bill 789123 on 2024-03-20: Product P5678 to Country DE for $12,850\n...",
  "sources": [
    {
      "id": "789456",
      "bill_no": 789456,
      "score": 0.89,
      "preview": "Bill Number: 789456 | Date: 2024-06-15 | Amount: 15430 | Product Code: P1234..."
    }
  ],
  "contextCount": 12,
  "correlationId": "abc-123-def-456",
  "durationMs": 2341
}
```

### Frontend Integration

The chatbot UI (`components/sales-chatbot.tsx`) includes:
- RAG toggle (switch between RAG and SQL-first modes)
- Source citations (click to view original sales records)
- Latency display
- Fallback to SQL when no context found

## Optimization

### Performance Tuning

1. **Batch Size**
   - Ingestion: 100-200 rows per batch (balance API limits vs throughput)
   - Embedding sub-batches: 50 texts (matches Gemini API limits)

2. **Vector Search**
   - topK: 12-20 contexts (balance relevance vs LLM token limits)
   - Similarity threshold: 0.2 (cosine similarity; adjust based on precision/recall)
   - HNSW index parameters: For >10k rows, increase `m` value

3. **Caching**
   - Embedding cache: 10,000 unique texts in memory
   - LRU eviction when limit reached
   - Cache hit rate monitored in `embeddingStats.cacheHits`

### Cost Controls

Embeddings cost (Gemini text-embedding-004):
- ~$0.00005/1K tokens
- Average sales row: ~100 tokens
- 1571 rows ≈ $0.008 total

LLM cost (Gemini 1.5 Flash):
- ~$0.0001/1K input tokens
- ~$0.0003/1K output tokens
- Average query: ~500 input + 200 output ≈ $0.0001

**Total cost for 1000 queries: ~$0.10**

Set rate limits in production:
- Max 100 queries/user/hour
- Max 1000 ingestions/day

### Monitoring

Key metrics to track:
```typescript
// lib/embeddings.ts
getEmbeddingStats()
// Returns: { totalRequests, cacheHits, geminiCalls, openaiCalls, fallbackCalls, errors }

// lib/vector.ts
getIngestionStats()
// Returns: { total_sales_rows, total_embeddings, missing_embeddings, last_updated }

// lib/metrics.ts
getMetrics()
// Returns: { requestCount, avgLatency, errorRate, intents: {...} }
```

## Incremental Updates

### Continuous Sync

Run incremental ingestion on a schedule (cron/webhook):

```bash
# Every hour via cron
0 * * * * curl -X POST http://localhost:3000/api/rag/ingest -d '{"mode":"incremental"}' -H "Content-Type: application/json"
```

Or trigger via database webhook:
```sql
-- Supabase Database Webhook
-- Trigger on INSERT to public.sales
-- Webhook URL: https://your-app.com/api/rag/ingest
```

### Reingest Specific Rows

```typescript
// In application code
import { ingestSalesRowsToVectors } from '@/lib/vector';

// Reingest specific range
await ingestSalesRowsToVectors(100, 500, (p, t) => {
  console.log(`Progress: ${p}/${t}`);
});
```

## Troubleshooting

### No contexts found

**Symptom**: RAG returns "No relevant data found"

**Diagnosis**:
```sql
-- Check embeddings exist
SELECT COUNT(*) FROM public.sales_embeddings;

-- Check for specific filter
SELECT COUNT(*) FROM public.sales_embeddings 
WHERE metadata->>'billing_type' = 'ZTES';

-- Sample embeddings
SELECT id, metadata FROM public.sales_embeddings LIMIT 10;
```

**Solutions**:
1. Run ingestion: `POST /api/rag/ingest` with `mode: "incremental"`
2. Check embedding dimension matches (768 for Gemini)
3. Lower similarity threshold in `findNearestContexts`

### Low quality answers

**Symptoms**: Answers don't match context or hallucinate

**Solutions**:
1. Increase topK (more context)
2. Adjust similarity threshold
3. Improve prompt template in `/api/rag/query/route.ts`
4. Use lower LLM temperature (currently 0.1)

### High latency

**Symptoms**: Queries take >5 seconds

**Diagnosis**:
- Check `durationMs` in response
- Monitor embedding cache hit rate

**Solutions**:
1. Ensure pgvector index exists and is healthy:
   ```sql
   REINDEX INDEX sales_embeddings_vector_idx;
   ```
2. Increase embedding cache size
3. Use HNSW instead of ivfflat for index
4. Reduce topK parameter

### API errors

**Gemini quota exceeded**: Fallback to OpenAI will activate automatically

**OpenAI errors**: Check API key validity and quota

**Both fail**: System uses deterministic fallback (semantic quality degraded but functional)

## Security

### API Key Rotation

```bash
# 1. Update .env.local with new keys
GEMINI_API_KEY=new_key

# 2. Restart Next.js server
npm run dev  # or restart production deployment

# 3. Test
curl -X POST http://localhost:3000/api/rag/query -d '{"question":"test"}'
```

### Access Control

Protect endpoints with middleware:

```typescript
// middleware.ts
export async function middleware(request: Request) {
  const url = new URL(request.url);
  
  if (url.pathname.startsWith('/api/rag/ingest')) {
    // Require admin token for ingestion
    const token = request.headers.get('x-admin-token');
    if (token !== process.env.ADMIN_TOKEN) {
      return new Response('Unauthorized', { status: 401 });
    }
  }
}
```

### Database Security

Use Row Level Security (RLS) in Supabase:

```sql
-- Only allow authenticated users to query embeddings
ALTER TABLE public.sales_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" 
  ON public.sales_embeddings 
  FOR SELECT 
  TO authenticated 
  USING (true);

-- Restrict writes to service role only
CREATE POLICY "Service role only writes" 
  ON public.sales_embeddings 
  FOR INSERT 
  TO service_role 
  USING (true);
```

## Advanced Features

### Custom Metadata Filters

Extend `SearchFilters` interface in `lib/vector.ts`:

```typescript
export interface SearchFilters {
  billing_type?: string;
  country?: string;
  date_start?: string;
  date_end?: string;
  min_amount?: number;
  max_amount?: number;
  // Add custom filters
  division?: string;
  plant?: string;
  customer_code?: string;
}
```

### Hybrid Ranking

Combine vector similarity with business logic:

```typescript
// In findNearestContexts
scored = scored.map(item => ({
  ...item,
  combined_score: (
    item.score * 0.7 +  // Vector similarity weight
    (item.metadata.amount / maxAmount) * 0.2 +  // Amount ranking
    (isRecent(item.metadata.billing_date) ? 0.1 : 0)  // Recency bonus
  )
}));
scored.sort((a, b) => b.combined_score - a.combined_score);
```

### Multi-language Support

Update text building to support translations:

```typescript
export function buildTextForEmbedding(row: SalesRow, language = 'en'): string {
  const labels = TRANSLATIONS[language];
  return `${labels.billNumber}: ${row.bill_no} | ${labels.date}: ${row.billing_date}...`;
}
```

## Testing

### Unit Tests

```bash
npm test -- lib/vector.test.ts
```

Example test:
```typescript
describe('buildTextForEmbedding', () => {
  it('includes all relevant fields', () => {
    const row = { bill_no: 123, Amount: '1000', MATNR: 'P1' };
    const text = buildTextForEmbedding(row);
    expect(text).toContain('Bill Number: 123');
    expect(text).toContain('Amount: 1000');
  });
});
```

### Integration Tests

Test full RAG pipeline:
```typescript
describe('RAG pipeline', () => {
  it('ingests and retrieves context', async () => {
    await ingestSalesRowsToVectors(10, 10);
    const contexts = await findNearestContexts('product P1');
    expect(contexts.length).toBeGreaterThan(0);
    expect(contexts[0].metadata.matnr).toContain('P1');
  });
});
```

## Maintenance

### Index Rebuild

Rebuild vector index monthly or after large ingestions:

```sql
REINDEX INDEX CONCURRENTLY sales_embeddings_vector_idx;
```

### Vacuum

Clean up deleted rows:

```sql
VACUUM ANALYZE public.sales_embeddings;
```

### Backup

Export embeddings for backup:

```bash
pg_dump -t sales_embeddings > embeddings_backup.sql
```

## Roadmap

Planned improvements:
- [ ] Streaming LLM responses
- [ ] Multi-modal support (images, charts)
- [ ] Fine-tuned embedding model for sales domain
- [ ] A/B testing framework for prompt templates
- [ ] Automated quality evaluation (RAGAS metrics)
- [ ] Vector store migration to dedicated service (Pinecone/Weaviate)

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review server logs for error details
3. Test with diagnostic SQL queries
4. Contact: dhwanijain-dev
