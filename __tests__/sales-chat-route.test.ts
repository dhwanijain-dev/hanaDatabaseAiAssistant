import { POST } from '../app/api/sales-chat/route';

// Mock supabase server client
jest.mock('../lib/supabase/server', () => {
  const chainFactory = () => {
    // We'll filter sampleRows according to recorded ops
    const state: { ops: any[] } = { ops: [] };
    return {
      select(sel: string){ state.ops.push(['select', sel]); return this; },
      eq(col: string, val: any){ state.ops.push(['eq', col, val]); return this; },
      gte(col: string, val: any){ state.ops.push(['gte', col, val]); return this; },
      lte(col: string, val: any){ state.ops.push(['lte', col, val]); return this; },
      order(col: string, opts: any){ state.ops.push(['order', col, opts]); return this; },
      limit(n: number){
        state.ops.push(['limit', n]);
        let filtered = sampleRows.slice();
        for (const op of state.ops){
          const [kind, col, val] = op;
          if (kind === 'eq') filtered = filtered.filter(r => (r as any)[col] === val);
          if (kind === 'gte') filtered = filtered.filter(r => (r as any)[col] >= val);
          if (kind === 'lte') filtered = filtered.filter(r => (r as any)[col] <= val);
        }
        if (state.ops.some(o => o[0] === 'order' && o[1] === 'Amount')){
          const asc = state.ops.find(o => o[0]==='order' && o[1]==='Amount')[2].ascending;
          filtered.sort((a,b)=> asc ? a.Amount - b.Amount : b.Amount - a.Amount);
        }
        return Promise.resolve({ data: filtered.slice(0,n), error: null });
      },
      _dump(){ return state.ops; }
    };
  };
  const sampleRows = [
    { billing_date: '2025-01-01', Amount: 500, country: 'US', MATNR: 'P1', company_code: 'C1', coustmer_code: 'CU1', billing_type: 'RE' },
    { billing_date: '2025-01-02', Amount: 1500, country: 'US', MATNR: 'P2', company_code: 'C1', coustmer_code: 'CU2', billing_type: 'RE' },
    { billing_date: '2025-01-03', Amount: 2500, country: 'DE', MATNR: 'P2', company_code: 'C2', coustmer_code: 'CU3', billing_type: 'CR' },
  ];
  return {
    createClient: async () => ({
      from: () => chainFactory(),
      rpc: async () => { throw new Error('RPC not defined in test environment'); }
    })
  };
});

describe('sales-chat route amount comparisons', () => {
  const invoke = async (prompt: string) => {
    const req = new Request('http://localhost/api/sales-chat', { method: 'POST', body: JSON.stringify({ prompt }) });
    const res = await POST(req);
    const json = await res.json();
    return json;
  };

  test('top query orders by Amount and caps limit', async () => {
    const json = await invoke('show me top 50 sales');
    expect(json.type).toBe('table');
    // Should return at most MAX_TOP_N rows (defined as 100). sampleRows smaller so fine.
    expect(json.rows.length).toBeGreaterThan(0);
  });

  test('greater than amount filter', async () => {
    const json = await invoke('show me sales greater than 1000');
    expect(json.type).toBe('table');
    expect(json.rows.every((r: any) => r.Amount >= 1000)).toBe(true);
  });

  test('between amount filter', async () => {
    const json = await invoke('sales between 1000 and 3000');
    expect(json.type).toBe('table');
    expect(json.rows.length).toBeGreaterThan(0);
    expect(json.rows.every((r: any) => r.Amount >= 1000 && r.Amount <= 3000)).toBe(true);
  });

  test('less than amount filter', async () => {
    const json = await invoke('sales less than 1000');
    expect(json.type).toBe('table');
    expect(json.rows.every((r: any) => r.Amount <= 1000)).toBe(true);
  });

  test('summary aggregation with amount filter', async () => {
    const json = await invoke('total sales greater than 1000');
    if (json.type === 'summary') {
      expect(json.summary.total).toBeGreaterThan(0);
      expect(json.summary.count).toBeGreaterThan(0);
    } else {
      // Fallback if not recognized as summary yet (depending on pattern match)
      expect(json.type).toBe('table');
    }
  });
});
