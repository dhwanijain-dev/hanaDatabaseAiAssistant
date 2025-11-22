#!/usr/bin/env node
/**
 * CLI tool for RAG ingestion and management
 * Usage:
 *   npm run ingest          # Incremental ingestion (new rows only)
 *   npm run ingest:full     # Full backfill (all rows)
 *   npm run ingest:status   # Check ingestion stats
 */

const API_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

async function ingest(mode = 'incremental', batchSize = 100, limit = null) {
  console.log(`Starting ${mode} ingestion...`);
  console.log(`Batch size: ${batchSize}`);
  if (limit) console.log(`Limit: ${limit} rows`);
  
  const start = Date.now();
  
  try {
    const response = await fetch(`${API_BASE}/api/rag/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, batchSize, limit }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ingestion failed: ${response.status} ${error}`);
    }
    
    const result = await response.json();
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    
    console.log('\n✓ Ingestion complete!');
    console.log(`  Mode: ${result.mode}`);
    console.log(`  Processed: ${result.processed} rows`);
    console.log(`  Total: ${result.total} rows`);
    console.log(`  Duration: ${duration}s`);
    console.log(`  Rate: ${(result.processed / duration).toFixed(1)} rows/sec`);
    
    if (result.embeddingStats) {
      console.log('\nEmbedding stats:');
      console.log(`  Total requests: ${result.embeddingStats.totalRequests}`);
      console.log(`  Cache hits: ${result.embeddingStats.cacheHits}`);
      console.log(`  Gemini calls: ${result.embeddingStats.geminiCalls}`);
      console.log(`  OpenAI calls: ${result.embeddingStats.openaiCalls}`);
      console.log(`  Fallback calls: ${result.embeddingStats.fallbackCalls}`);
      console.log(`  Errors: ${result.embeddingStats.errors}`);
    }
    
    return result;
  } catch (error) {
    console.error('\n✗ Ingestion failed:', error.message);
    process.exit(1);
  }
}

async function getStatus() {
  console.log('Fetching ingestion status...\n');
  
  try {
    const response = await fetch(`${API_BASE}/api/rag/ingest`);
    
    if (!response.ok) {
      throw new Error(`Status check failed: ${response.status}`);
    }
    
    const result = await response.json();
    
    console.log('Database status:');
    console.log(`  Total sales rows: ${result.stats.total_sales_rows}`);
    console.log(`  Total embeddings: ${result.stats.total_embeddings}`);
    console.log(`  Missing embeddings: ${result.stats.missing_embeddings}`);
    if (result.stats.last_updated) {
      console.log(`  Last updated: ${new Date(result.stats.last_updated).toLocaleString()}`);
    }
    
    const coverage = ((result.stats.total_embeddings / result.stats.total_sales_rows) * 100).toFixed(1);
    console.log(`  Coverage: ${coverage}%`);
    
    if (result.embeddingStats) {
      console.log('\nEmbedding cache stats:');
      const hitRate = result.embeddingStats.totalRequests > 0
        ? ((result.embeddingStats.cacheHits / result.embeddingStats.totalRequests) * 100).toFixed(1)
        : '0';
      console.log(`  Hit rate: ${hitRate}%`);
      console.log(`  Total requests: ${result.embeddingStats.totalRequests}`);
    }
    
    if (result.stats.missing_embeddings > 0) {
      console.log(`\n⚠ ${result.stats.missing_embeddings} rows need ingestion`);
      console.log('  Run: npm run ingest');
    } else {
      console.log('\n✓ All rows ingested!');
    }
    
    return result;
  } catch (error) {
    console.error('\n✗ Status check failed:', error.message);
    process.exit(1);
  }
}

// Parse command line arguments
const command = process.argv[2] || 'status';
const batchSize = parseInt(process.argv[3]) || 100;
const limit = process.argv[4] ? parseInt(process.argv[4]) : null;

async function main() {
  switch (command) {
    case 'full':
      await ingest('full', batchSize, limit);
      break;
    case 'incremental':
      await ingest('incremental', batchSize, limit);
      break;
    case 'status':
      await getStatus();
      break;
    default:
      console.log('RAG Ingestion CLI');
      console.log('');
      console.log('Usage:');
      console.log('  node scripts/ingest.js status                  # Check status');
      console.log('  node scripts/ingest.js incremental [batch]     # Ingest new rows');
      console.log('  node scripts/ingest.js full [batch] [limit]    # Full backfill');
      console.log('');
      console.log('Examples:');
      console.log('  node scripts/ingest.js status');
      console.log('  node scripts/ingest.js incremental 100');
      console.log('  node scripts/ingest.js full 50 500');
      process.exit(1);
  }
}

main().catch(console.error);
