import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Simple parser for a couple of supported intents: top N sales, monthly chart
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt: string = (body.prompt || "").toString();
    // log incoming prompt for debugging
    // eslint-disable-next-line no-console
    console.log("/api/sales-chat POST prompt:", prompt);
    if (!prompt) return NextResponse.json({ error: "Missing prompt" }, { status: 400 });

    const supabase = await createClient();

    const lower = prompt.toLowerCase();

    // top N sales: e.g. "show me top 3 sales"
    const topMatch = lower.match(/top\s+(\d+)/);
    if (topMatch) {
      const n = Math.max(1, Math.min(100, parseInt(topMatch[1], 10) || 3));
      // eslint-disable-next-line no-console
      console.log(`Detected top N request, n=${n}`);

      const { data, error } = await supabase
        .from("sales")
        .select("*")
        // Amount may be stored as text; ordering by Amount desc might require cast, but we'll assume numeric
        .order("Amount", { ascending: false })
        .limit(n);

      if (error) {
        // eslint-disable-next-line no-console
        console.error("Supabase query error (top N):", error.message || error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // eslint-disable-next-line no-console
      console.log("Top N query returned rows:", Array.isArray(data) ? data.length : 0);

      return NextResponse.json({ type: "table", rows: data || [] });
    }

    // Chart by month: "give me chart for all the sales from months" or "chart monthly"
    if (lower.includes("chart") && (lower.includes("month") || lower.includes("monthly"))) {
      // fetch billing_date and Amount for all rows
      // eslint-disable-next-line no-console
      console.log("Detected chart by month request - fetching billing_date and Amount");

      const { data, error } = await supabase
        .from("sales")
        .select("billing_date, Amount");

      if (error) {
        // eslint-disable-next-line no-console
        console.error("Supabase query error (chart):", error.message || error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // eslint-disable-next-line no-console
      console.log("Chart query rows fetched:", Array.isArray(data) ? data.length : 0);

      // Group by YYYY-MM
      const map = new Map<string, number>();
      (data || []).forEach((r: any) => {
        const dt = r.billing_date ? new Date(r.billing_date) : null;
        if (!dt || isNaN(dt.getTime())) return;
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
        const amt = Number(r.Amount) || 0;
        map.set(key, (map.get(key) || 0) + amt);
      });

      const labels = Array.from(map.keys()).sort();
      const values = labels.map((k) => map.get(k) || 0);

      return NextResponse.json({ type: "chart", chartType: "bar", labels, values });
    }

    // Fallback: attempt to interpret simple filters like "show me top 5 sales in country US"
    // Very basic: try to detect "in country <code>" or "for country <code>"
    const countryMatch = lower.match(/country\s+(is\s+)?([a-z0-9\-]+)/);
    if (countryMatch) {
      const country = countryMatch[2];
      // eslint-disable-next-line no-console
      console.log("Detected country filter request for:", country);

      const { data, error } = await supabase
        .from("sales")
        .select("*")
        .eq("country", country)
        .limit(50);

      if (error) {
        // eslint-disable-next-line no-console
        console.error("Supabase query error (country):", error.message || error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // eslint-disable-next-line no-console
      console.log("Country query returned rows:", Array.isArray(data) ? data.length : 0);

      return NextResponse.json({ type: "table", rows: data || [] });
    }

    // If nothing matched, return a short help message and sample suggestions
    return NextResponse.json({
      type: "help",
      message:
        "I can return top N sales (e.g. 'show me top 3 sales') or a monthly chart (e.g. 'give me chart for all the sales from months').",
      examples: ["show me top 3 sales", "give me chart for all the sales from months", "show me sales in country US"],
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("/api/sales-chat error:", err?.message || err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
