import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRpcsAvailable } from "@/lib/supabase/rpc-check";
import { recordRequest } from "@/lib/metrics";

// Query efficiency constants
const MAX_TOP_N = 100; // hard cap for top queries
const TABLE_ROW_LIMIT = 500; // generic table limit when filters applied
const CHART_FALLBACK_ROW_LIMIT = 5000; // cap raw rows for local aggregation fallback

// Columns lists for different intents (adjust according to actual schema)
const TABLE_COLUMNS = [
  "billing_date",
  "Amount",
  "MATNR",
  "mat_description",
  "country",
  "company_code",
  "coustmer_code",
  "billing_type",
];
const CHART_COLUMNS = ["billing_date", "Amount", "MATNR", "country", "company_code", "billing_type"];

// Helper to build select string from whitelist
// Quote identifiers to preserve casing and handle mixed-case columns like "Amount"
const quoteIdentifier = (s: string) => `"${s.replace(/"/g, '""')}"`;
const selectColumns = (cols: string[]) => cols.map(quoteIdentifier).join(", ");

// Normalize rows returned from the DB into a consistent shape for the frontend and RAG.
// Preserves original keys but adds lowercase/canonical properties where helpful.
const normalizeRow = (r: any) => {
  if (!r || typeof r !== "object") return r;
  const out: any = { ...r };
  // Amount may be stored as mixed-case "Amount" (text). Provide numeric alias `amount`.
  if (r.Amount !== undefined) {
    out.amount = Number(r.Amount) || 0;
  } else if (r.amount !== undefined) {
    out.amount = Number(r.amount) || 0;
  }
  // Common mixed-case columns -> lowercase aliases
  if (r.MATNR !== undefined) out.matnr = r.MATNR;
  if (r.Division !== undefined) out.division = r.Division;
  if (r.Plant !== undefined) out.plant = r.Plant;
  // Ensure billing_date is normalized to ISO date string (YYYY-MM-DD) when possible
  if (r.billing_date) {
    const d = new Date(r.billing_date);
    out.billing_date = !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : r.billing_date;
  }
  return out;
};

// Minimal placeholder POST while we stabilize the route file
export async function POST(request: Request) {
  const correlationId = crypto.randomUUID();
  const start = performance.now();
  let intent = "unknown";
  let rowCount = 0;
  let filters: Record<string, any> = {};
  const finalize = (payload: any, error?: string) => {
    const durationMs = performance.now() - start;
    try {
      recordRequest(correlationId, intent, durationMs, rowCount, filters, error);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("metrics record failed", e);
    }
    return NextResponse.json({ correlationId, durationMs: Math.round(durationMs), intent, ...payload });
  };
  try {
    const body = await request.json();
    const prompt: string = (body.prompt || "").toString();
    // eslint-disable-next-line no-console
    console.log("/api/sales-chat POST prompt:", prompt);
    if (!prompt) {
      intent = "missing-prompt";
      return finalize({ error: "Missing prompt" }, "Missing prompt");
    }

    const supabase = await createClient();
    const lower = prompt.toLowerCase();

    const extractNumber = (text: string) => {
      const m = text.match(/(top|first|last)\s+(\d+)/) || text.match(/(\d+)\s+(records|rows|sales)/);
      if (m) return parseInt(m[m.length - 1], 10);
      return null;
    };

    const parseDate = (s: string) => {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d;
      return null;
    };

    const extractDateRange = (text: string) => {
      const iso = text.match(/(\d{4}-\d{2}-\d{2})/g);
      if (iso && iso.length >= 2) return [parseDate(iso[0]), parseDate(iso[1])];
      const fromTo = text.match(/from\s+([\w\- ]+)\s+to\s+([\w\- ]+)/);
      if (fromTo) {
        const a = parseDate(fromTo[1].trim());
        const b = parseDate(fromTo[2].trim());
        if (a && b) return [a, b];
      }
      return null;
    };

    const buildFilters = (text: string) => {
      const filters: Record<string, any> = {};
      const countryMatch = text.match(/country\s+(is\s+)?([a-z0-9\-]+)/i);
      if (countryMatch) filters.country = countryMatch[2];
      const matMatch = text.match(/(?:matnr|product|item|material)\s+([\w\-]+)/i);
      if (matMatch) filters.MATNR = matMatch[1];
      const comp = text.match(/company\s*code\s*(is\s*)?([\w\-]+)/i);
      if (comp) filters.company_code = comp[2];
      const cust = text.match(/cust(?:omer)?\s*code\s*(is\s*)?([\w\-]+)/i);
      if (cust) filters.coustmer_code = cust[2];
      // NEW: billing type filter support
      // Matches: "billing type RE", "billing type: RE", "billing type = RE", "billing type is RE"
  // Accept variants like "billing_type", "billing-type", "billingtype", and common minor typos
  const billingType = text.match(/bill(?:ing|int)[\s_\-]*type\s*(?:is|=|:)?\s*([A-Za-z0-9_\-]+)/i);
      if (billingType) {
        // Adjust the column name below if your table uses a different identifier (e.g. billing_type_code)
        filters.billing_type = billingType[1];
      }
      // Generic pattern: "sales with billing type RE" or "sales with country US" could be supported in future
      return filters;
    };

    // Extract amount comparisons (> < between)
    const extractAmountComparisons = (text: string) => {
      // Normalize thousands separators and currency symbols
      const cleanNumber = (raw: string) => parseFloat(raw.replace(/[$,]/g, ""));
      const out: { minAmount?: number; maxAmount?: number } = {};
      // between X and Y
      const between = text.match(/(?:amount|sales)?\s*between\s*([$\d,\.]+)\s*(?:and|to)\s*([$\d,\.]+)/i);
      if (between) {
        const a = cleanNumber(between[1]);
        const b = cleanNumber(between[2]);
        if (!isNaN(a) && !isNaN(b)) {
          out.minAmount = Math.min(a, b);
          out.maxAmount = Math.max(a, b);
        }
      }
      // greater than / more than / above
      const greater = text.match(/(?:amount|sales)?\s*(?:greater than|more than|above|> )\s*([$\d,\.]+)/i);
      if (greater) {
        const val = cleanNumber(greater[1]);
        if (!isNaN(val)) out.minAmount = val;
      }
      // less than / below / under
      const less = text.match(/(?:amount|sales)?\s*(?:less than|below|under|< )\s*([$\d,\.]+)/i);
      if (less) {
        const val = cleanNumber(less[1]);
        if (!isNaN(val)) out.maxAmount = val;
      }
      // Simple operators: >1000, <500
      const gtOp = text.match(/>([$\d,\.]+)/);
      if (gtOp) {
        const val = cleanNumber(gtOp[1]);
        if (!isNaN(val)) out.minAmount = Math.max(out.minAmount || 0, val);
      }
      const ltOp = text.match(/<([$\d,\.]+)/);
      if (ltOp) {
        const val = cleanNumber(ltOp[1]);
        if (!isNaN(val)) out.maxAmount = out.maxAmount ? Math.min(out.maxAmount, val) : val;
      }
      return out;
    };

    const amountRange = extractAmountComparisons(prompt);

  filters = buildFilters(prompt);
    const topN = extractNumber(prompt);

    if (topN && lower.includes("top")) {
      const n = Math.max(1, Math.min(MAX_TOP_N, topN || 10));
      // Interpret "top" as highest Amount unless user specifies a different field later
      let qry: any = supabase.from("sales").select(selectColumns(TABLE_COLUMNS));
      Object.entries(filters).forEach(([k, v]) => (qry = qry.eq(k, v)));
      if (amountRange.minAmount !== undefined) qry = qry.gte("Amount", amountRange.minAmount);
      if (amountRange.maxAmount !== undefined) qry = qry.lte("Amount", amountRange.maxAmount);
      const { data, error } = await qry.order("Amount", { ascending: false }).limit(n);
      if (error) {
        console.error("Supabase query error (top N):", error.message || error);
        intent = "top";
        return finalize({ error: error.message }, error.message);
      }
      intent = "top";
  rowCount = (data || []).length;
  return finalize({ type: "table", rows: (data || []).map(normalizeRow) });
    }

    if (lower.includes("earliest") || lower.includes("oldest") || lower.includes("first records") || (lower.includes("earliest") && topN)) {
      const n = topN ? Math.max(1, Math.min(500, topN)) : 1;
  let qry: any = supabase.from("sales").select(selectColumns(TABLE_COLUMNS));
      Object.entries(filters).forEach(([k, v]) => (qry = qry.eq(k, v)));
  if (amountRange.minAmount !== undefined) qry = qry.gte("Amount", amountRange.minAmount);
  if (amountRange.maxAmount !== undefined) qry = qry.lte("Amount", amountRange.maxAmount);
      const { data, error } = await qry.order("billing_date", { ascending: true }).limit(n);
      if (error) {
        console.error("Supabase query error (earliest):", error.message || error);
        intent = "earliest";
        return finalize({ error: error.message }, error.message);
      }
      intent = "earliest";
  rowCount = (data || []).length;
  return finalize({ type: "table", rows: (data || []).map(normalizeRow) });
    }

    if (lower.includes("latest") || lower.includes("recent") || lower.includes("most recent") || lower.includes("last records")) {
      const n = topN ? Math.max(1, Math.min(500, topN)) : 10;
  let qry: any = supabase.from("sales").select(selectColumns(TABLE_COLUMNS));
      Object.entries(filters).forEach(([k, v]) => (qry = qry.eq(k, v)));
  if (amountRange.minAmount !== undefined) qry = qry.gte("Amount", amountRange.minAmount);
  if (amountRange.maxAmount !== undefined) qry = qry.lte("Amount", amountRange.maxAmount);
      const { data, error } = await qry.order("billing_date", { ascending: false }).limit(n);
      if (error) {
        console.error("Supabase query error (latest):", error.message || error);
        intent = "latest";
        return finalize({ error: error.message }, error.message);
      }
      intent = "latest";
  rowCount = (data || []).length;
  return finalize({ type: "table", rows: (data || []).map(normalizeRow) });
    }

    if (lower.includes("chart") || lower.match(/sum|total|average|avg|count/)) {
      const range = extractDateRange(prompt);
      const rangeStartISO = range?.[0] ? range[0].toISOString().slice(0, 10) : null;
      const rangeEndISO = range?.[1] ? range[1].toISOString().slice(0, 10) : null;

      const wantsMonthly = lower.includes("month") || lower.includes("monthly") || lower.includes("by month");
        const wantsYear = lower.includes("year") || lower.includes("annual") || lower.includes("annually") || lower.includes("by year");
        const wantsCountry = lower.includes("by country");
        const wantsProduct = lower.includes("by product") || lower.includes("by matnr") || lower.includes("by material");

      // Attempt RPC-based aggregation first for efficiency.
      // Strategy:
      // 1) Prefer a single, generic `sales_aggregate` RPC that accepts a `granularity` param
      //    (e.g. 'month', 'year', 'country', 'product') and returns { period, total_amount } rows.
      // 2) If not available, fall back to legacy RPC names (monthly_sales, country_sales, product_sales, yearly_sales).
      // 3) If RPCs are missing or return errors, fall back to local aggregation.
      const tryRpcAggregation = async () => {
        // Probe which RPCs are available (cached) and log once.
        try {
          await checkRpcsAvailable(supabase);
        } catch (e) {
          // ignore probe errors
        }
        const rpcArgs = {
          granularity: wantsYear ? 'year' : wantsMonthly ? 'month' : wantsCountry ? 'country' : wantsProduct ? 'product' : 'month',
          start_date: rangeStartISO,
          end_date: rangeEndISO,
          country_filter: filters.country || null,
          product_filter: filters.MATNR || null,
        };

        // 1) Try the generic sales_aggregate RPC first
        try {
          const { data, error } = await supabase.rpc("sales_aggregate", rpcArgs as any);
          if (!error && data) return { kind: rpcArgs.granularity, data } as const;
          // If error is a function-not-found, we'll fall through to legacy names
          if (error) throw error;
        } catch (err: any) {
          // swallow and try legacy names
          // eslint-disable-next-line no-console
          console.debug("sales_aggregate RPC not available or failed:", err?.message || err);
        }

        // 2) Legacy RPCs (kept for compatibility). Try names based on intent.
        const legacyAttempts: Array<() => Promise<{ kind: string; data: any } | null>> = [];

        if (wantsMonthly) {
          legacyAttempts.push(async () => {
            try {
              const { data, error } = await supabase.rpc("monthly_sales", {
                start_date: rangeStartISO,
                end_date: rangeEndISO,
                country_filter: filters.country || null,
                product_filter: filters.MATNR || null,
              });
              if (error) throw error;
              return { kind: "monthly", data } as const;
            } catch (e) {
              return null;
            }
          });
          // also try yearly name if user asked for months but db exposes yearly aggregation under a different name
          legacyAttempts.push(async () => {
            try {
              const { data, error } = await supabase.rpc("sales_years", {
                start_date: rangeStartISO,
                end_date: rangeEndISO,
                country_filter: filters.country || null,
                product_filter: filters.MATNR || null,
              });
              if (error) throw error;
              return { kind: "year", data } as const;
            } catch (e) {
              return null;
            }
          });
        }

        if (wantsCountry) {
          legacyAttempts.push(async () => {
            try {
              const { data, error } = await supabase.rpc("country_sales", {
                start_date: rangeStartISO,
                end_date: rangeEndISO,
                product_filter: filters.MATNR || null,
              });
              if (error) throw error;
              return { kind: "country", data } as const;
            } catch (e) {
              return null;
            }
          });
        }

        if (wantsProduct) {
          legacyAttempts.push(async () => {
            try {
              const { data, error } = await supabase.rpc("product_sales", {
                start_date: rangeStartISO,
                end_date: rangeEndISO,
                country_filter: filters.country || null,
              });
              if (error) throw error;
              return { kind: "product", data } as const;
            } catch (e) {
              return null;
            }
          });
        }

        for (const attempt of legacyAttempts) {
          try {
            const result = await attempt();
            if (result) return result;
          } catch (_) {
            // ignore and continue
          }
        }

        return null;
      };

      let aggregated: any = null;
      try {
        aggregated = await tryRpcAggregation();
      } catch (rpcErr: any) {
        console.warn("RPC aggregation failed, falling back to local aggregation:", rpcErr?.message || rpcErr);
      }

      if (aggregated) {
        // Normalize RPC result shapes so both generic `sales_aggregate` (period/total_amount)
        // and legacy RPCs (month/total_amount, country/total_amount, matnr/total_amount) work.
        const rows = Array.isArray(aggregated.data) ? aggregated.data : [];
        const kind = (aggregated.kind || '').toString();

        const readValue = (r: any) => Number(r?.total_amount ?? r?.totalamount ?? r?.total ?? r?.value ?? 0) || 0;
        const readLabel = (r: any) => {
          return (
            r?.month ?? r?.year ?? r?.period ?? r?.country ?? r?.matnr ?? r?.product ?? r?.label ?? '(none)'
          );
        };

        const labels = rows.map((r: any) => String(readLabel(r)));
        const values = rows.map((r: any) => readValue(r));
        const hasData = values.some((v: number) => Math.abs(Number(v)) > 0);

        // Create a friendly kind label for telemetry (month/year/country/product)
        let friendlyKind = kind;
        if (kind === 'monthly' || kind === 'month') friendlyKind = 'month';
        if (kind === 'yearly' || kind === 'year') friendlyKind = 'year';

        intent = hasData ? `chart-${friendlyKind}-rpc` : `chart-${friendlyKind}-rpc-empty`;
        rowCount = rows.length;

        if (!labels.length || !hasData) {
          return finalize({ type: 'help', message: 'No data available for the requested chart. Try adjusting filters or date range.' });
        }

        return finalize({ type: 'chart', chartType: 'bar', labels, values, source: 'rpc' });
      }

      // Fallback: local aggregation on limited raw rows
      let qry: any = supabase.from("sales").select(selectColumns(CHART_COLUMNS));
      Object.entries(filters).forEach(([k, v]) => (qry = qry.eq(k, v)));
      if (rangeStartISO && rangeEndISO) {
        qry = qry.gte("billing_date", rangeStartISO).lte("billing_date", rangeEndISO);
      }
      if (amountRange.minAmount !== undefined) qry = qry.gte("Amount", amountRange.minAmount);
      if (amountRange.maxAmount !== undefined) qry = qry.lte("Amount", amountRange.maxAmount);
      const { data, error } = await qry.limit(CHART_FALLBACK_ROW_LIMIT);
      if (error) {
        console.error("Supabase query error (chart/aggregate fallback):", error.message || error);
        intent = "chart-fallback-error";
        return finalize({ error: error.message }, error.message);
      }
      const rows = data || [];
      if (wantsMonthly) {
        const map = new Map<string, number>();
        rows.forEach((r: any) => {
          const dt = r.billing_date ? new Date(r.billing_date) : null;
          if (!dt || isNaN(dt.getTime())) return;
          const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
          const amt = Number(r.Amount) || 0;
          map.set(key, (map.get(key) || 0) + amt);
        });
        const labels = Array.from(map.keys()).sort();
        const values = labels.map((k) => map.get(k) || 0);
        const hasData = values.some((v) => Math.abs(Number(v)) > 0);
        intent = hasData ? "chart-monthly-fallback" : "chart-monthly-fallback-empty";
        rowCount = rows.length;
        if (!labels.length || !hasData) {
          return finalize({ type: "help", message: "No data available for the requested monthly chart. Try adjusting filters or date range." });
        }
        return finalize({ type: "chart", chartType: "bar", labels, values, source: "fallback" });
      }
      if (wantsCountry) {
        const map = new Map<string, number>();
        rows.forEach((r: any) => {
          const key = r.country || "(none)";
          const amt = Number(r.Amount) || 0;
          map.set(key, (map.get(key) || 0) + amt);
        });
        const labels = Array.from(map.keys()).sort();
        const values = labels.map((k) => map.get(k) || 0);
        const hasData = values.some((v) => Math.abs(Number(v)) > 0);
        intent = hasData ? "chart-country-fallback" : "chart-country-fallback-empty";
        rowCount = rows.length;
        if (!labels.length || !hasData) {
          return finalize({ type: "help", message: "No data available for the requested country chart. Try adjusting filters or date range." });
        }
        return finalize({ type: "chart", chartType: "bar", labels, values, source: "fallback" });
      }
      if (wantsProduct) {
        const map = new Map<string, number>();
        rows.forEach((r: any) => {
          const key = r.MATNR || "(none)";
          const amt = Number(r.Amount) || 0;
          map.set(key, (map.get(key) || 0) + amt);
        });
        const labels = Array.from(map.keys()).sort();
        const values = labels.map((k) => map.get(k) || 0);
        const hasData = values.some((v) => Math.abs(Number(v)) > 0);
        intent = hasData ? "chart-product-fallback" : "chart-product-fallback-empty";
        rowCount = rows.length;
        if (!labels.length || !hasData) {
          return finalize({ type: "help", message: "No data available for the requested product chart. Try adjusting filters or date range." });
        }
        return finalize({ type: "chart", chartType: "bar", labels, values, source: "fallback" });
      }
      if (lower.match(/sum|total/) || lower.match(/average|avg/) || lower.match(/count/)) {
        const total = rows.reduce((s: number, r: any) => s + (Number(r.Amount) || 0), 0);
        const count = rows.length;
        const avg = count ? total / count : 0;
        intent = "summary";
        rowCount = rows.length;
        return finalize({ type: "summary", summary: { total, count, average: avg } });
      }
  intent = "chart-fallback-raw";
  rowCount = rows.length;
  return finalize({ type: "table", rows: rows.map(normalizeRow).slice(0, 200) });
    }

    if (Object.keys(filters).length > 0 || amountRange.minAmount !== undefined || amountRange.maxAmount !== undefined) {
      let qry: any = supabase.from("sales").select(selectColumns(TABLE_COLUMNS));
      Object.entries(filters).forEach(([k, v]) => (qry = qry.eq(k, v)));
      if (amountRange.minAmount !== undefined) qry = qry.gte("Amount", amountRange.minAmount);
      if (amountRange.maxAmount !== undefined) qry = qry.lte("Amount", amountRange.maxAmount);
      const { data, error } = await qry.limit(TABLE_ROW_LIMIT);
      if (error) {
        console.error("Supabase query error (filters):", error.message || error);
        intent = "filtered-table-error";
        return finalize({ error: error.message }, error.message);
      }
  intent = "filtered-table";
  rowCount = (data || []).length;
  return finalize({ type: "table", rows: (data || []).map(normalizeRow) });
    }

    intent = "help";
    return finalize({
      type: "help",
      message:
        "I can return top N sales (e.g. 'show me top 3 sales'), earliest/latest records, or a monthly chart (e.g. 'give me chart for all the sales from months'). I also support filters: country, MATNR (product), company code, customer code, and simple date ranges.",
      examples: ["show me top 3 sales", "give me chart for all the sales from months", "show me sales in country US", "show me earliest sales", "total sales between 2024-01-01 and 2024-06-30"],
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("/api/sales-chat error:", err?.message || err);
    intent = intent === "unknown" ? "unhandled-error" : intent;
    return finalize({ error: err?.message || String(err) }, err?.message || String(err));
  }
}
