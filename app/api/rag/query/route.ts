import { NextResponse } from "next/server";
import { findNearestContexts, SearchFilters } from "@/lib/vector";
import { recordRequest } from "@/lib/metrics";

/**
 * Call LLM with Gemini (primary) or OpenAI (fallback)
 */
async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  // Try Gemini first (using generativelanguage.googleapis.com)
  const geminiKey = process.env.GEMINI_API_KEY;
  
  if (geminiKey) {
    try {
      const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent";
      const res = await fetch(`${url}?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: `${systemPrompt}\n\n${userPrompt}` }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 800,
          }
        }),
      });
      
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error ${res.status}: ${errText}`);
      }
      
      const json = await res.json();
      const answer = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (answer) {
        return answer;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Gemini LLM call failed, trying OpenAI fallback:", e);
    }
  }

  // Fallback to OpenAI
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error("No LLM API keys configured (GEMINI_API_KEY or OPENAI_API_KEY required)");
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errText}`);
  }

  const json = await res.json();
  const answer = json?.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error("No answer from LLM");
  }

  return answer;
}

/**
 * POST /api/rag/query
 * Query the RAG system with optional filters
 * Body: { 
 *   question: string, 
 *   topK?: number,
 *   filters?: { billing_type, country, date_start, date_end, min_amount, max_amount }
 * }
 */
export async function POST(request: Request) {
  const start = performance.now();
  const correlationId = crypto.randomUUID();
  
  try {
    const body = await request.json();
    const question: string = (body.question || body.prompt || "").toString();
    const topK = body.topK && Number(body.topK) ? Number(body.topK) : 12;
    const filters: SearchFilters | undefined = body.filters;
    
    if (!question) {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    // eslint-disable-next-line no-console
    console.log(`RAG query [${correlationId}]: "${question}" with topK=${topK}, filters=`, filters);

    // Find nearest contexts with hybrid filtering
    const contexts = await findNearestContexts(question, topK, filters);
    const rowCount = contexts.length;

    if (!contexts || contexts.length === 0) {
      const durationMs = performance.now() - start;
      try {
        recordRequest(correlationId, "rag-query-no-context", durationMs, 0, { topK, filters }, undefined);
      } catch (e) {
        // ignore metrics error
      }
      
      return NextResponse.json({
        type: "help",
        message: "No relevant data found in the vector store. Try ingesting data first using /api/rag/ingest or adjusting your query.",
        correlationId,
        durationMs: Math.round(durationMs),
      });
    }

    // Build RAG prompt with context
    const contextText = contexts
      .map((c, i) => {
        const meta = c.metadata;
        return `[Source ${i + 1} - Bill ${meta.bill_no}]
${c.content}
(Similarity: ${(c.score * 100).toFixed(1)}%)`;
      })
      .join("\n\n---\n\n");

    const systemPrompt = `You are an expert sales analytics assistant. Use ONLY the provided context to answer questions accurately and concisely.

Rules:
1. Base your answer strictly on the provided context sources
2. Cite sources using [Source N] notation
3. If the answer isn't in the context, say "I don't have enough information to answer that"
4. Provide specific numbers, dates, and product codes when available
5. Keep answers clear and professional
6. If asked for SQL, generate syntactically correct PostgreSQL queries using the public.sales table`;

    const userPrompt = `Context from sales database:

${contextText}

Question: ${question}

Please provide a clear, accurate answer based on the context above.`;

    // Call LLM
    const answer = await callLLM(systemPrompt, userPrompt);
    const durationMs = performance.now() - start;

    // Record metrics
    try {
      recordRequest(correlationId, "rag-query", durationMs, rowCount, { topK, filters }, undefined);
    } catch (e) {
      // ignore metrics error
    }

    return NextResponse.json({
      type: "rag_answer",
      answer,
      sources: contexts.map((c) => ({
        id: c.id,
        bill_no: c.metadata.bill_no,
        score: Math.round(c.score * 100) / 100,
        preview: c.content.slice(0, 150) + "...",
      })),
      contextCount: contexts.length,
      correlationId,
      durationMs: Math.round(durationMs),
    });
  } catch (err: any) {
    const durationMs = performance.now() - start;
    
    try {
      recordRequest(correlationId, "rag-query-error", durationMs, 0, {}, err?.message || String(err));
    } catch (e) {
      // ignore metrics error
    }
    
    // eslint-disable-next-line no-console
    console.error("/api/rag/query error:", err?.message || err);
    
    return NextResponse.json(
      {
        error: err?.message || String(err),
        correlationId,
        durationMs: Math.round(durationMs),
      },
      { status: 500 }
    );
  }
}

