# Sales Chatbot - Complete Setup Guide

## Quick Start (5 Steps)

### 1. Run the Database Migration

Copy and execute the SQL migration in your Supabase SQL Editor:

```bash
# View the migration file
cat lib/supabase/migrations/001_create_embeddings_table.sql
```

Or directly in Supabase Dashboard:
1. Go to SQL Editor
2. Paste the contents of `lib/supabase/migrations/001_create_embeddings_table.sql`
3. Click "Run"

This creates:
- ✓ `sales_embeddings` table with pgvector support
- ✓ Vector indexes for fast ANN search
- ✓ Helper functions (`match_sales_embeddings`, `get_ingestion_stats`)

### 2. Verify Environment Variables

Ensure your `.env.local` has:

```bash
# Required: Gemini API (primary embedding provider)
GEMINI_API_KEY=your_gemini_api_key_here

# Optional: OpenAI (fallback)
OPENAI_API_KEY=your_openai_key_here

# Supabase (should already be configured)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

**Get Gemini API Key** (Free tier available):
1. Go to https://aistudio.google.com/app/apikey
2. Create new API key
3. Copy to `.env.local`

### 3. Start Development Server

```bash
npm run dev
```

### 4. Run Initial Data Ingestion

In a new terminal:

```bash
# Check current status
npm run ingest:status

# Ingest all sales data (this may take 5-10 minutes for 1571 rows)
npm run ingest:full
```

You'll see progress output like:
```
Starting full ingestion...
Batch size: 100
Ingested 100/1571 rows (6%)
Ingested 200/1571 rows (13%)
...
✓ Ingestion complete!
  Processed: 1571 rows
  Duration: 347.2s
  Rate: 4.5 rows/sec
```

### 5. Test the RAG System

```bash
# Test RAG query
curl -X POST http://localhost:3000/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What are the top sales for billing type ZTES?",
    "topK": 12,
    "filters": {"billing_type": "ZTES"}
  }'
```

Or use the web UI at `http://localhost:3000/sales-chat`

---

## Current System Status

### ✅ Completed Components

1. **Database Schema**
   - ✓ `sales` table (1571 rows with mixed-case columns)
   - ✓ `sales_embeddings` table (ready for pgvector)
   - ✓ Column normalization (Amount, MATNR, Division, Plant)
   - ✓ Helper RPCs (`sales_aggregate`, `sales_years`, `match_sales_embeddings`)

2. **Embedding Infrastructure**
   - ✓ Gemini text-embedding-004 (768d) as primary
   - ✓ OpenAI text-embedding-3-small (768d) as fallback
   - ✓ Deterministic fallback for offline mode
   - ✓ In-memory caching (10K cache size, LRU eviction)
   - ✓ Exponential backoff and retry logic
   - ✓ Batch processing (100 rows/batch, 50 texts/sub-batch)

3. **Vector Storage & Search**
   - ✓ pgvector with ivfflat index (100 lists)
   - ✓ Hybrid search (vector + metadata filters)
   - ✓ Metadata filtering (billing_type, country, date range, amount)
   - ✓ Similarity threshold (0.2 cosine)
   - ✓ Top-K retrieval (default: 12 contexts)

4. **RAG Pipeline**
   - ✓ Full backfill ingestion endpoint
   - ✓ Incremental ingestion (only new rows)
   - ✓ Idempotent upserts by `bill_no`
   - ✓ Query endpoint with LLM generation
   - ✓ Citation/source tracking
   - ✓ Gemini 1.5 Flash for completions

5. **API Endpoints**
   - ✓ `POST /api/rag/ingest` - Ingest data
   - ✓ `GET /api/rag/ingest` - Get stats
   - ✓ `POST /api/rag/query` - RAG queries
   - ✓ `POST /api/sales-chat` - SQL-first queries
   - ✓ `GET /api/metrics` - Observability

6. **Observability**
   - ✓ Correlation IDs
   - ✓ Latency tracking
   - ✓ Request metrics (lib/metrics.ts)
   - ✓ Embedding stats (cache hits, provider calls, errors)
   - ✓ Ingestion progress logging

7. **Documentation**
   - ✓ RAG pipeline guide (docs/RAG_PIPELINE.md)
   - ✓ Setup instructions (this file)
   - ✓ Troubleshooting guides
   - ✓ Code comments and type definitions

### 🚧 In Progress

8. **Frontend Integration**
   - ⏳ RAG toggle in chat UI
   - ⏳ Source citation display
   - ⏳ Provenance (click bill_no to view details)

### 📋 Pending Tasks

9. **Testing**
   - ⬜ Unit tests for embedding/vector functions
   - ⬜ Integration tests for RAG endpoints
   - ⬜ E2E tests for chat UI

10. **Security & Optimization**
    - ⬜ Rate limiting on RAG endpoints
    - ⬜ Admin token for ingestion endpoint
    - ⬜ Cost monitoring alerts
    - ⬜ Query result caching (Redis)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interface                          │
│  components/sales-chatbot.tsx                                │
│  [SQL Mode] ←→ [RAG Mode Toggle] ←→ [Source Citations]      │
└────────────────┬────────────────────────────────────────────┘
                 │
      ┌──────────┴──────────┐
      │                     │
      ▼                     ▼
┌─────────────┐      ┌──────────────┐
│ SQL Route   │      │  RAG Route   │
│ /api/sales- │      │  /api/rag/   │
│ chat        │      │  query       │
└─────┬───────┘      └──────┬───────┘
      │                     │
      │              ┌──────┴──────┐
      │              │             │
      ▼              ▼             ▼
┌──────────┐   ┌─────────┐   ┌─────────┐
│Supabase  │   │ Vector  │   │  LLM    │
│  sales   │   │ Search  │   │(Gemini) │
│  table   │   │pgvector │   │         │
└──────────┘   └─────────┘   └─────────┘
                     │
              ┌──────┴──────┐
              │             │
              ▼             ▼
        ┌──────────┐  ┌──────────┐
        │Embedding │  │Metadata  │
        │(Gemini)  │  │Filters   │
        └──────────┘  └──────────┘
```

---

## Data Flow

### Ingestion Flow
```
Sales Table Row
    ↓
Build Text (bill_no, date, amount, product, country, etc.)
    ↓
Embed Text (Gemini API → 768d vector)
    ↓
Store in sales_embeddings (id=bill_no, embedding, metadata)
    ↓
Index with pgvector (ivfflat)
```

### Query Flow
```
User Question
    ↓
Embed Question (same model)
    ↓
Vector Search (cosine similarity) + Metadata Filters
    ↓
Top-K Contexts (12 most relevant rows)
    ↓
Build Prompt (system + contexts + question)
    ↓
LLM Generation (Gemini 1.5 Flash)
    ↓
Answer + Citations
```

---

## Usage Examples

### 1. Incremental Ingestion (Daily Sync)

```bash
# Add to cron for daily sync
0 2 * * * cd /path/to/project && npm run ingest >> /var/log/ingest.log 2>&1
```

### 2. Query with Filters

```bash
curl -X POST http://localhost:3000/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Show me sales above $10000 in Germany during 2024",
    "topK": 15,
    "filters": {
      "country": "DE",
      "min_amount": 10000,
      "date_start": "2024-01-01",
      "date_end": "2024-12-31"
    }
  }'
```

### 3. Monitor Ingestion Progress

```javascript
// In application code
import { getIngestionStats } from '@/lib/vector';

const stats = await getIngestionStats();
console.log(`Coverage: ${stats.total_embeddings}/${stats.total_sales_rows}`);
console.log(`Missing: ${stats.missing_embeddings} rows`);
```

### 4. Check Embedding Cache Efficiency

```javascript
import { getEmbeddingStats } from '@/lib/embeddings';

const stats = getEmbeddingStats();
const hitRate = (stats.cacheHits / stats.totalRequests * 100).toFixed(1);
console.log(`Cache hit rate: ${hitRate}%`);
```

---

## Performance Expectations

### Ingestion
- **Throughput**: 4-8 rows/sec (limited by embedding API)
- **1571 rows**: ~5-10 minutes
- **Cost**: ~$0.008 (Gemini embeddings)
- **Concurrency**: 2-4 parallel batches recommended

### Queries
- **Latency**: 1-3 seconds total
  - Vector search: 50-200ms
  - LLM generation: 800-2500ms
- **Throughput**: ~20-30 queries/minute
- **Cost per query**: ~$0.0001

### Caching
- **Embedding cache**: 90%+ hit rate after warmup
- **Memory usage**: ~50MB for 10K cached embeddings

---

## Troubleshooting

### Problem: "No relevant data found"

**Check 1**: Verify embeddings exist
```sql
SELECT COUNT(*) FROM public.sales_embeddings;
```

**Check 2**: Verify specific filter has data
```sql
SELECT COUNT(*) FROM public.sales_embeddings 
WHERE metadata->>'billing_type' = 'ZTES';
```

**Solution**: Run ingestion
```bash
npm run ingest
```

### Problem: High API costs

**Check**: Review embedding stats
```bash
npm run ingest:status
```

**Solution**: Increase cache size in `lib/embeddings.ts`:
```typescript
const CACHE_MAX_SIZE = 20000; // Increase from 10000
```

### Problem: Slow queries

**Check**: Verify index exists
```sql
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'sales_embeddings';
```

**Solution**: Rebuild index
```sql
REINDEX INDEX CONCURRENTLY sales_embeddings_vector_idx;
```

---

## Next Steps

1. **Complete Frontend Integration**
   ```bash
   # Update components/sales-chatbot.tsx
   # - Add RAG toggle
   # - Display source citations
   # - Show latency metrics
   ```

2. **Add Tests**
   ```bash
   npm test
   ```

3. **Deploy to Production**
   ```bash
   # Set production env vars
   # Run full ingestion
   # Monitor metrics endpoint
   ```

4. **Set Up Monitoring**
   - CloudWatch/Datadog for latency tracking
   - Sentry for error monitoring
   - Cost alerts for API usage

5. **Optimize**
   - Switch to HNSW index for better performance
   - Add Redis for query caching
   - Fine-tune embedding model for sales domain

---

## Support & Resources

- **Documentation**: `docs/RAG_PIPELINE.md`
- **Migration SQL**: `lib/supabase/migrations/001_create_embeddings_table.sql`
- **Example RPCs**: `lib/supabase/rpc-examples.sql`
- **Ingestion CLI**: `scripts/ingest.js`

For questions or issues, review the troubleshooting section or check server logs.
