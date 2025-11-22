import type { SupabaseClient } from '@supabase/supabase-js';

let cached: Record<string, boolean> | null = null;

/**
 * Probe the database for availability of common RPCs.
 * Caches results in-memory for the process lifetime.
 */
export async function checkRpcsAvailable(supabase: SupabaseClient) {
  if (cached) return cached;
  const candidates = [
    'sales_aggregate',
    'monthly_sales',
    'sales_years',
    'country_sales',
    'product_sales',
  ];
  const results: Record<string, boolean> = {};

  for (const name of candidates) {
    try {
      // Try a lightweight RPC call with NULL/default args. If function exists it should return (possibly empty) rows.
      // We ignore the returned data; we're only checking for presence and whether call errors with "function not found".
      // Note: calling some RPCs may be expensive depending on implementation; these are typically small aggregation functions.
      // eslint-disable-next-line no-await-in-loop
      const { error } = await (supabase as any).rpc(name, {});
      results[name] = !error;
    } catch (e) {
      results[name] = false;
    }
  }

  // cache snapshot
  cached = results;
  // eslint-disable-next-line no-console
  console.info('RPC probe results:', results);
  return results;
}

export function clearRpcCache() {
  cached = null;
}
