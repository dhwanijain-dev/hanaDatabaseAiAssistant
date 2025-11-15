"use client";

import React, { useState, useEffect, useRef } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Send, BarChart3, Table2, Loader2 } from "lucide-react";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend);

export default function SalesChatbot() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "bot"; text?: string; rows?: any[]; chart?: any; timestamp: Date }>>([]);
  const [loading, setLoading] = useState(false);
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

  async function send() {
    if (!prompt.trim()) return;
    const text = prompt.trim();
    setMessages((m) => [...m, { role: "user", text, timestamp: new Date() }]);
    setPrompt("");
    setLoading(true);
    
    try {
      console.log("Sending prompt to /api/sales-chat", text);
      const res = await fetch("/api/sales-chat", { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify({ prompt: text }) 
      });
      
      console.log("/api/sales-chat response status:", res.status);
      const data = await res.json();
      console.debug("/api/sales-chat response json:", data);
      
      if (data.error) {
        setMessages((m) => [...m, { role: "bot", text: `Error: ${data.error}`, timestamp: new Date() }]);
      } else if (data.type === "table") {
        setMessages((m) => [...m, { role: "bot", rows: data.rows, timestamp: new Date() }]);
      } else if (data.type === "chart") {
        setMessages((m) => [...m, { 
          role: "bot", 
          chart: { labels: data.labels, values: data.values, chartType: data.chartType },
          timestamp: new Date()
        }]);
      } else if (data.type === "help") {
        setMessages((m) => [...m, { 
          role: "bot", 
          text: data.message + "\n\nExamples:\n" + (data.examples || []).map((ex: string) => `• ${ex}`).join("\n"),
          timestamp: new Date()
        }]);
      } else {
        setMessages((m) => [...m, { role: "bot", text: JSON.stringify(data), timestamp: new Date() }]);
      }
    } catch (e: any) {
      console.error("Error calling /api/sales-chat:", e);
      setMessages((m) => [...m, { role: "bot", text: `Failed to connect: ${e.message}`, timestamp: new Date() }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-screen max-h-[900px] w-full x-auto bg-gradient-to-br from-slate-50 to-slate-100">
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
            <div className={`flex flex-col max-w-[85%] ${m.role === "user" ? "items-end" : "items-start"}`}>
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
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mt-2 w-full">
                  <div className="bg-gradient-to-r from-slate-50 to-slate-100 px-4 py-2 border-b border-slate-200 flex items-center gap-2">
                    <Table2 className="w-4 h-4 text-slate-600" />
                    <span className="text-sm font-medium text-slate-700">Data Results</span>
                    <span className="text-xs text-slate-500 ml-auto">{m.rows.length} rows</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          {(() => {
                            const firstRow = m.rows && m.rows[0] ? m.rows[0] : {};
                            return Object.keys(firstRow).slice(0, 8).map((h) => (
                              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider border-b border-slate-200">
                                {h}
                              </th>
                            ));
                          })()}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {m.rows.slice(0, 20).map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            {(() => {
                              const firstRow = m.rows && m.rows[0] ? m.rows[0] : {};
                              return Object.keys(firstRow).slice(0, 8).map((h) => (
                                <td key={h} className="px-4 py-3 text-slate-700">
                                  {String(r[h] ?? "")}
                                </td>
                              ));
                            })()}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {m.rows.length > 20 && (
                    <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-t border-slate-200">
                      Showing first 20 of {m.rows.length} rows
                    </div>
                  )}
                </div>
              )}

              {m.chart && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mt-2 w-full">
                  <div className="flex items-center gap-2 mb-4">
                    <BarChart3 className="w-4 h-4 text-sky-600" />
                    <span className="text-sm font-medium text-slate-700">Sales Chart</span>
                  </div>
                  <Bar
                    data={{
                      labels: m.chart.labels,
                      datasets: [{
                        label: "Sales Amount",
                        data: m.chart.values,
                        backgroundColor: "rgba(14, 165, 233, 0.8)",
                        borderColor: "rgba(14, 165, 233, 1)",
                        borderWidth: 2,
                        borderRadius: 6,
                      }]
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: true,
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          backgroundColor: "rgba(15, 23, 42, 0.9)",
                          padding: 12,
                          cornerRadius: 8,
                          titleFont: { size: 14, weight: 600 },
                          bodyFont: { size: 13 }
                        }
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                          grid: { color: "rgba(148, 163, 184, 0.1)" },
                          ticks: { color: "#64748b", font: { size: 11 } }
                        },
                        x: {
                          grid: { display: false },
                          ticks: { color: "#64748b", font: { size: 11 } }
                        }
                      }
                    }}
                  />
                </div>
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