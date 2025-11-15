"use client";

import React, { useState } from "react";

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

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend);

export default function SalesChatbot() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "bot"; text?: string; rows?: any[]; chart?: any }>>([]);
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!prompt.trim()) return;
    const text = prompt.trim();
    setMessages((m) => [...m, { role: "user", text }]);
    setPrompt("");
    setLoading(true);
    try {
      // eslint-disable-next-line no-console
      console.log("Sending prompt to /api/sales-chat", text);
      const res = await fetch("/api/sales-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: text }) });
      // eslint-disable-next-line no-console
      console.log("/api/sales-chat response status:", res.status);
      const data = await res.json();
      // eslint-disable-next-line no-console
      console.debug("/api/sales-chat response json:", data);
      if (data.error) {
        setMessages((m) => [...m, { role: "bot", text: `Error: ${data.error}` }]);
      } else if (data.type === "table") {
        setMessages((m) => [...m, { role: "bot", rows: data.rows }]);
      } else if (data.type === "chart") {
        setMessages((m) => [...m, { role: "bot", chart: { labels: data.labels, values: data.values, chartType: data.chartType } }]);
      } else if (data.type === "help") {
        setMessages((m) => [...m, { role: "bot", text: data.message + "\nExamples: " + (data.examples || []).join(" | ") }]);
      } else {
        setMessages((m) => [...m, { role: "bot", text: JSON.stringify(data) }]);
      }
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error("Error calling /api/sales-chat:", e);
      setMessages((m) => [...m, { role: "bot", text: String(e) }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-4xl mx-auto p-4">
      <h2 className="text-xl font-semibold mb-4">Sales Chatbot</h2>

      <div className="mb-4 flex flex-col gap-3">
        {messages.map((m, idx) => (
          <div key={idx} className={m.role === "user" ? "text-right" : "text-left"}>
            {m.text && (
              <div className={`inline-block px-3 py-2 rounded ${m.role === "user" ? "bg-sky-500 text-white" : "bg-gray-100"}`}>{m.text}</div>
            )}

            {m.rows && Array.isArray(m.rows) && m.rows.length > 0 && (
              <div className="overflow-auto border rounded mt-2">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {(() => {
                        const firstRow = m.rows && m.rows[0] ? m.rows[0] : {};
                        return Object.keys(firstRow).slice(0, 8).map((h) => (
                          <th key={h} className="px-2 py-1 text-left border-b">{h}</th>
                        ));
                      })()}
                    </tr>
                  </thead>
                  <tbody>
                    {m.rows.slice(0, 20).map((r, i) => (
                      <tr key={i} className="odd:bg-white even:bg-gray-50">
                        {(() => {
                          const firstRow = m.rows && m.rows[0] ? m.rows[0] : {};
                          return Object.keys(firstRow).slice(0, 8).map((h) => (
                            <td key={h} className="px-2 py-1 border-b">{String(r[h] ?? "")}</td>
                          ));
                        })()}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {m.rows.length > 20 && <div className="p-2 text-xs">Showing first 20 rows</div>}
              </div>
            )}

            {m.chart && (
              <div className="mt-3">
                <Bar
                  data={{ labels: m.chart.labels, datasets: [{ label: "Sales Amount", data: m.chart.values, backgroundColor: "rgba(59,130,246,0.7)" }] }}
                  options={{ responsive: true, plugins: { legend: { display: false } } }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} className="flex-1 rounded border px-3 py-2" placeholder="Ask: show me top 3 sales OR give me chart for all the sales from months" />
        <button onClick={send} disabled={loading} className="px-4 py-2 bg-sky-600 text-white rounded disabled:opacity-60">{loading ? "..." : "Send"}</button>
      </div>
    </div>
  );
}
