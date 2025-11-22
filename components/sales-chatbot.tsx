"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { Send, BarChart3, Table2, Loader2 } from "lucide-react";
import { FixedSizeList as List } from "react-window";

// Lazy load chart implementation only when needed
import type { SalesChartProps } from "./SalesChartLazy";
const LazyBarChart = dynamic<SalesChartProps>(() => import("./SalesChartLazy").then((m) => m.default), { ssr: false });

// Simple debounce hook for future auto-suggest / throttled send
function useDebouncedCallback(cb: (...args: any[]) => void, delay: number) {
  const t = useRef<NodeJS.Timeout | null>(null);
  return (...args: any[]) => {
    if (t.current) clearTimeout(t.current as any);
    t.current = setTimeout(() => cb(...args), delay) as unknown as NodeJS.Timeout;
  };
}

export default function SalesChatbot() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "bot"; text?: string; rows?: any[]; chart?: any; timestamp: Date; correlationId?: string; durationMs?: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [useRag, setUseRag] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const STORAGE_KEY = "salesChatHistory";

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // Load chat history from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Array<any>;
      const restored = parsed.map((m) => ({ ...m, timestamp: m.timestamp ? new Date(m.timestamp) : new Date() }));
      setMessages(restored);
      // eslint-disable-next-line no-console
      console.log(`Loaded ${restored.length} messages from localStorage`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Failed to load chat history from localStorage:", e);
    }
  }, []);

  // Persist chat history to localStorage when messages change (keep last 200 entries)
  useEffect(() => {
    try {
      const toSave = messages.slice(-200).map((m) => ({ ...m, timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      // eslint-disable-next-line no-console
      console.debug(`Saved ${toSave.length} messages to localStorage`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Failed to save chat history to localStorage:", e);
    }
  }, [messages]);

  const clearHistory = () => {
    if (!confirm("Clear chat history? This cannot be undone.")) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Failed to remove chat history from localStorage:", e);
    }
    setMessages([]);
  };

  const COOLDOWN_MS = 400;
  const lastSendRef = useRef<number>(0);

  async function sendImmediate(text: string) {
    setMessages((m) => [...m, { role: "user", text, timestamp: new Date() }]);
    setPrompt("");
    setLoading(true);
    try {
      if (useRag) {
        // Prefer RAG endpoint first. If no useful RAG result, fall back to SQL endpoint.
        console.log("Sending prompt to /api/rag/query (RAG-first)", text);
        const ragRes = await fetch("/api/rag/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text })
        });
        const ragData = await ragRes.json().catch(() => null);
        console.debug("/api/rag/query response json:", ragData);

        if (ragData && ragData.type === "rag_answer") {
          setMessages((m) => [...m, { role: "bot", text: ragData.answer, correlationId: ragData.correlationId, durationMs: ragData.durationMs, timestamp: new Date() }]);
          return;
        }
        // fall through to SQL fallback
      }

      // SQL fallback (or RAG disabled)
      console.log("Sending prompt to /api/sales-chat", text);
      const res = await fetch("/api/sales-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text })
      });
      const data = await res.json();
      console.debug("/api/sales-chat response json:", data);
      if (data.error) {
        setMessages((m) => [...m, { role: "bot", text: `Error: ${data.error}`, timestamp: new Date() }]);
      } else if (data.type === "table") {
        setMessages((m) => [...m, { role: "bot", rows: data.rows, correlationId: data.correlationId, durationMs: data.durationMs, timestamp: new Date() }]);
      } else if (data.type === "chart") {
        setMessages((m) => [...m, { role: "bot", chart: { labels: data.labels, values: data.values, chartType: data.chartType }, correlationId: data.correlationId, durationMs: data.durationMs, timestamp: new Date() }]);
      } else if (data.type === "help") {
        setMessages((m) => [...m, { role: "bot", text: data.message + "\n\nExamples:\n" + (data.examples || []).map((ex: string) => `• ${ex}`).join("\n"), correlationId: data.correlationId, durationMs: data.durationMs, timestamp: new Date() }]);
      } else if (data.type === "summary") {
        setMessages((m) => [...m, { role: "bot", text: JSON.stringify(data.summary, null, 2), correlationId: data.correlationId, durationMs: data.durationMs, timestamp: new Date() }]);
      } else {
        setMessages((m) => [...m, { role: "bot", text: JSON.stringify(data), correlationId: data.correlationId, durationMs: data.durationMs, timestamp: new Date() }]);
      }
    } catch (e: any) {
      console.error("Error calling API:", e);
      setMessages((m) => [...m, { role: "bot", text: `Failed to connect: ${e?.message ?? String(e)}`, timestamp: new Date() }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  const send = () => {
    const text = prompt.trim();
    if (!text) return;
    const now = Date.now();
    if (now - lastSendRef.current < COOLDOWN_MS) return; // cooldown enforcement
    lastSendRef.current = now;
    void sendImmediate(text);
  };
  const debouncedSend = useDebouncedCallback(send, 120);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      debouncedSend();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-screen  w-full x-auto bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3 w-full">
          <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-blue-600 rounded-lg flex items-center justify-center shadow-md">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Sales Analytics Assistant</h2>
            <p className="text-sm text-slate-500">Ask me about your sales data</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={clearHistory}
              className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded px-2 py-1 bg-white"
              title="Clear chat history"
            >
              Clear history
            </button>
            <button
              onClick={() => setUseRag((s) => !s)}
              className={`text-xs font-medium px-2 py-1 rounded ${useRag ? 'bg-sky-100 text-sky-700 border border-sky-200' : 'bg-white text-slate-600 border border-slate-200'}`}
              title="Toggle RAG-first"
            >
              RAG: {useRag ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-60">
            <div className="w-16 h-16 bg-gradient-to-br from-sky-100 to-blue-100 rounded-2xl flex items-center justify-center">
              <BarChart3 className="w-8 h-8 text-sky-600" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-slate-700 mb-2">Start a conversation</h3>
              <p className="text-sm text-slate-500 max-w-md">
                Ask questions about your sales data, request charts, or get insights
              </p>
              <div className="mt-4 space-y-2 text-xs text-slate-400">
                <p>Try: "Show me top 5 sales"</p>
                <p>Or: "Give me a chart of monthly sales"</p>
              </div>
            </div>
          </div>
        )}

        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}
          >
            <div className={`flex flex-col ${m.rows || m.chart ? "w-full" : "max-w-[85%]"} ${m.role === "user" ? "items-end" : "items-start"}`}>
              {m.text && (
                <div
                  className={`px-4 py-3 rounded-2xl shadow-sm transition-all hover:shadow-md ${
                    m.role === "user"
                      ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white rounded-tr-sm"
                      : "bg-white text-slate-800 border border-slate-200 rounded-tl-sm"
                  }`}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.text}</p>
                </div>
              )}

              {m.rows && Array.isArray(m.rows) && m.rows.length > 0 && (
                <OptimizedTable rows={m.rows} />
              )}
            
              {m.chart && (
                // Guard: only render chart if labels exist and at least one non-zero value
                (() => {
                  const labels = m.chart.labels || [];
                  const values = m.chart.values || [];
                  const hasData = Array.isArray(values) && values.some((v: any) => Math.abs(Number(v) || 0) > 0) && labels.length > 0;
                  if (!hasData) {
                    return (
                      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mt-2 w-full">
                        <div className="flex items-center gap-2 mb-4">
                          <BarChart3 className="w-4 h-4 text-sky-600" />
                          <span className="text-sm font-medium text-slate-700">Sales Chart</span>
                        </div>
                        <div className="text-sm text-slate-600">No chartable data available for the requested query. Try widening the date range or removing filters.</div>
                      </div>
                    );
                  }
                  return (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mt-2 w-full">
                      <div className="flex items-center gap-2 mb-4">
                        <BarChart3 className="w-4 h-4 text-sky-600" />
                        <span className="text-sm font-medium text-slate-700">Sales Chart</span>
                      </div>
                      <LazyBarChart labels={labels} values={values} />
                    </div>
                  );
                })()
              )}

              <span className="text-xs text-slate-400 mt-1 px-1">
                {formatTime(m.timestamp)}
              </span>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start animate-fade-in">
            <div className="bg-white text-slate-800 border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
              <span className="text-sm text-slate-600">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="bg-white border-t border-slate-200 px-6 py-4 shadow-lg">
        <div className="flex gap-3 items-end">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyPress={handleKeyPress}
              className="w-full rounded-xl border text-black border-slate-300 px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all text-sm placeholder:text-slate-400 bg-slate-50 focus:bg-white"
              placeholder="Ask about sales data, request charts, or get insights..."
              disabled={loading}
            />
          </div>
          <button
            onClick={send}
            disabled={loading || !prompt.trim()}
            className="px-5 py-3 bg-gradient-to-r from-sky-500 to-blue-600 text-white rounded-xl disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-2 font-medium"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2 text-center">
          Press Enter to send • Shift+Enter for new line
        </p>
      </div>

      <style jsx global>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}

// Optimized table component with memoized headers and virtualization
function OptimizedTable({ rows }: { rows: any[] }) {
  const firstRow = rows[0] || {};
  const headers = useMemo(() => Object.keys(firstRow).slice(0, 8), [firstRow]);
  const useVirtualized = rows.length > 50;

  if (!useVirtualized) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mt-2 w-full">
        <div className="bg-gradient-to-r from-slate-50 to-slate-100 px-4 py-2 border-b border-slate-200 flex items-center gap-2">
          <Table2 className="w-4 h-4 text-slate-600" />
          <span className="text-sm font-medium text-slate-700">Data Results</span>
          <span className="text-xs text-slate-500 ml-auto">{rows.length} rows</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-black uppercase tracking-wider border-b border-slate-200">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, 200).map((r, i) => (
                <tr key={i} className="hover:bg-slate-50 transition-colors">
                  {headers.map((h) => (
                    <td key={h} className="px-4 py-3 text-black">
                      {String(r[h] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 200 && (
          <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-t border-slate-200">Showing first 200 of {rows.length} rows</div>
        )}
      </div>
    );
  }

  const itemCount = Math.min(rows.length, 1000);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = React.useState<number>(800);

  React.useEffect(() => {
    function handleResize() {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        // Avoid too small width that breaks layout
        setListWidth(Math.max(w, 300));
      }
    }
    handleResize();
    const ro = new ResizeObserver(handleResize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const r = rows[index];
    return (
      <div style={style} className="flex border-b border-slate-100 hover:bg-slate-50 text-sm">
        {headers.map((h) => (
          <div key={h} className="px-4 py-2 flex-1 truncate text-black">
            {String(r[h] ?? "")}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mt-2 w-full" ref={containerRef}>
      <div className="bg-gradient-to-r from-slate-50 to-slate-100 px-4 py-2 border-b border-slate-200 flex items-center gap-2">
        <Table2 className="w-4 h-4 text-slate-600" />
        <span className="text-sm font-medium text-black">Data Results (virtualized)</span>
        <span className="text-xs text-slate-500 ml-auto">{rows.length} rows</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-full">
          <div className="bg-slate-50 border-b border-slate-200 flex text-xs font-semibold text-black uppercase tracking-wider">
            {headers.map((h) => (
              <div key={h} className="px-4 py-3 flex-1 text-black">{h}</div>
            ))}
          </div>
          <List height={400} width={listWidth} itemCount={itemCount} itemSize={40} className="select-none">
            {Row}
          </List>
        </div>
      </div>
      {rows.length > itemCount && (
        <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-t border-slate-200">Showing first {itemCount} of {rows.length} rows</div>
      )}
    </div>
  );
}