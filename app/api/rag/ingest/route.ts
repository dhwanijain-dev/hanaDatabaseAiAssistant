import { NextResponse } from "next/server";
import { ingestSalesRowsToVectors, ingestNewSalesRows, getIngestionStats } from "@/lib/vector";
import { getEmbeddingStats } from "@/lib/embeddings";

/**
 * POST /api/rag/ingest
 * Ingest sales rows into embeddings table
 * Body: { mode: "full" | "incremental", batchSize?: number, limit?: number }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = body.mode || "incremental"; // default to incremental
    const batchSize = body.batchSize && Number(body.batchSize) ? Number(body.batchSize) : 100;
    const limit = body.limit && Number(body.limit) ? Number(body.limit) : null;
    
    // eslint-disable-next-line no-console
    console.log(`Starting ${mode} ingestion with batchSize=${batchSize}, limit=${limit}`);
    
    let result;
    
    if (mode === "incremental") {
      result = await ingestNewSalesRows(batchSize, (processed) => {
        // eslint-disable-next-line no-console
        console.log(`Incremental ingestion progress: ${processed} new rows processed`);
      });
    } else {
      result = await ingestSalesRowsToVectors(batchSize, limit, (processed, total) => {
        // eslint-disable-next-line no-console
        console.log(`Full ingestion progress: ${processed}/${total} (${Math.round((processed / total) * 100)}%)`);
      });
    }
    
    const embStats = getEmbeddingStats();
    
    return NextResponse.json({
      ok: true,
      mode,
      processed: result.processed,
      total: result.total,
      embeddingStats: embStats,
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("/api/rag/ingest error:", err?.message || err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

/**
 * GET /api/rag/ingest
 * Get ingestion statistics
 */
export async function GET() {
  try {
    const stats = await getIngestionStats();
    const embStats = getEmbeddingStats();
    
    return NextResponse.json({
      ok: true,
      stats,
      embeddingStats: embStats,
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("/api/rag/ingest GET error:", err?.message || err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

