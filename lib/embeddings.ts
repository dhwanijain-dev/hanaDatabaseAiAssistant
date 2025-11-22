/*
  Production-grade embedding helper with:
  - Primary: Gemini text-embedding-004 (768d)
  - Fallback: OpenAI text-embedding-3-small (1536d, can be reduced)
  - Last resort: deterministic local fallback
  - In-memory caching by text hash
  - Batching support
  - Retry with exponential backoff
*/

import crypto from "crypto";

// In-memory cache: hash(text) -> embedding
const embeddingCache = new Map<string, number[]>();
const CACHE_MAX_SIZE = 10000; // Prevent unbounded growth

// Stats for monitoring
export const embeddingStats = {
  totalRequests: 0,
  cacheHits: 0,
  geminiCalls: 0,
  openaiCalls: 0,
  fallbackCalls: 0,
  errors: 0,
};

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Single text embedding with caching
export async function embedText(text: string): Promise<number[]> {
  embeddingStats.totalRequests++;
  
  // Check cache first
  const hash = hashText(text);
  const cached = embeddingCache.get(hash);
  if (cached) {
    embeddingStats.cacheHits++;
    return cached;
  }

  const embedding = await embedTextUncached(text);
  
  // Cache result (with size limit)
  if (embeddingCache.size < CACHE_MAX_SIZE) {
    embeddingCache.set(hash, embedding);
  } else if (embeddingCache.size === CACHE_MAX_SIZE) {
    // Clear oldest 20% when limit reached
    const toDelete = Math.floor(CACHE_MAX_SIZE * 0.2);
    const keys = Array.from(embeddingCache.keys()).slice(0, toDelete);
    keys.forEach((k) => embeddingCache.delete(k));
    embeddingCache.set(hash, embedding);
  }
  
  return embedding;
}

// Batch embedding with automatic batching and retry
export async function embedTextBatch(texts: string[], batchSize = 100): Promise<number[][]> {
  const results: number[][] = [];
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((t) => embedText(t)));
    results.push(...batchResults);
    
    // Rate limiting: small delay between batches
    if (i + batchSize < texts.length) {
      await sleep(100);
    }
  }
  
  return results;
}

// Core embedding logic without cache (with retry)
async function embedTextUncached(text: string, retries = 3): Promise<number[]> {
  let lastError: any = null;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s, 4s
      await sleep(1000 * Math.pow(2, attempt - 1));
    }
    
    // Try Gemini first
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const embedding = await callGeminiEmbedding(text, geminiKey);
        if (embedding) {
          embeddingStats.geminiCalls++;
          return embedding;
        }
      } catch (e) {
        lastError = e;
        // eslint-disable-next-line no-console
        console.warn(`Gemini embedding attempt ${attempt + 1} failed:`, e);
      }
    }
    
    // Try OpenAI second
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        const embedding = await callOpenAIEmbedding(text, openaiKey);
        if (embedding) {
          embeddingStats.openaiCalls++;
          return embedding;
        }
      } catch (e) {
        lastError = e;
        // eslint-disable-next-line no-console
        console.warn(`OpenAI embedding attempt ${attempt + 1} failed:`, e);
      }
    }
  }
  
  // All retries exhausted, use deterministic fallback
  embeddingStats.errors++;
  embeddingStats.fallbackCalls++;
  // eslint-disable-next-line no-console
  console.error("All embedding providers failed, using deterministic fallback. Last error:", lastError);
  return deterministicFallback(text);
}

async function callGeminiEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  // Gemini text-embedding-004 returns 768 dimensions
  const url = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";
  
  const res = await fetch(`${url}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/text-embedding-004",
      content: { parts: [{ text }] },
    }),
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }
  
  const json = await res.json();
  const embedding = json?.embedding?.values;
  
  if (Array.isArray(embedding) && embedding.length > 0) {
    return embedding;
  }
  
  return null;
}

async function callOpenAIEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  // OpenAI text-embedding-3-small returns 1536 dimensions by default
  // Can be reduced to 768 with dimensions parameter for consistency
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
      dimensions: 768, // Match Gemini dimensions
    }),
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errText}`);
  }
  
  const json = await res.json();
  const embedding = json?.data?.[0]?.embedding;
  
  if (Array.isArray(embedding) && embedding.length > 0) {
    return embedding;
  }
  
  return null;
}

function deterministicFallback(text: string): number[] {
  // Create deterministic 768-dim vector from text (not semantic, but consistent)
  const dims = 768;
  const vec: number[] = new Array(dims).fill(0);
  
  // Use multiple passes with different hash seeds for better distribution
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      const idx = (i * 7 + pass * 17 + c) % dims;
      vec[idx] += (c % 127) / 127;
    }
  }
  
  // Normalize to unit vector
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function getEmbeddingStats() {
  return { ...embeddingStats };
}

export function resetEmbeddingCache() {
  embeddingCache.clear();
  embeddingStats.cacheHits = 0;
}
