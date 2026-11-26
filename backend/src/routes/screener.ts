import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../infrastructure/authMiddleware';
import { getPrisma } from '../infrastructure/database';
import { marketDataService } from '../services/market-data/marketDataService';

// Representative liquid Indian equity universe across major NSE sectors for real-time scanning & treemap heatmaps
const SCAN_UNIVERSE: Array<{ symbol: string; sector: string; mcapWeight: number }> = [
  { symbol: 'RELIANCE', sector: 'Energy', mcapWeight: 10.5 },
  { symbol: 'ONGC', sector: 'Energy', mcapWeight: 2.4 },
  { symbol: 'NTPC', sector: 'Energy', mcapWeight: 3.1 },
  { symbol: 'POWERGRID', sector: 'Energy', mcapWeight: 2.5 },
  { symbol: 'HDFCBANK', sector: 'Banking', mcapWeight: 11.2 },
  { symbol: 'ICICIBANK', sector: 'Banking', mcapWeight: 8.1 },
  { symbol: 'SBIN', sector: 'Banking', mcapWeight: 5.8 },
  { symbol: 'AXISBANK', sector: 'Banking', mcapWeight: 3.4 },
  { symbol: 'KOTAKBANK', sector: 'Banking', mcapWeight: 3.2 },
  { symbol: 'BAJFINANCE', sector: 'Finance', mcapWeight: 3.8 },
  { symbol: 'BAJAJFINSV', sector: 'Finance', mcapWeight: 2.1 },
  { symbol: 'TCS', sector: 'IT', mcapWeight: 8.6 },
  { symbol: 'INFY', sector: 'IT', mcapWeight: 6.2 },
  { symbol: 'HCLTECH', sector: 'IT', mcapWeight: 3.5 },
  { symbol: 'WIPRO', sector: 'IT', mcapWeight: 2.2 },
  { symbol: 'TECHM', sector: 'IT', mcapWeight: 1.5 },
  { symbol: 'BHARTIARTL', sector: 'Telecom', mcapWeight: 6.9 },
  { symbol: 'LT', sector: 'Infra', mcapWeight: 4.4 },
  { symbol: 'ADANIPORTS', sector: 'Infra', mcapWeight: 2.3 },
  { symbol: 'ULTRACEMCO', sector: 'Infra', mcapWeight: 2.6 },
  { symbol: 'ITC', sector: 'FMCG', mcapWeight: 4.7 },
  { symbol: 'HINDUNILVR', sector: 'FMCG', mcapWeight: 4.5 },
  { symbol: 'NESTLEIND', sector: 'FMCG', mcapWeight: 1.9 },
  { symbol: 'MARUTI', sector: 'Auto', mcapWeight: 3.3 },
  { symbol: 'M&M', sector: 'Auto', mcapWeight: 3.1 },
  { symbol: 'TMPV', sector: 'Auto', mcapWeight: 2.9 },
  { symbol: 'SUNPHARMA', sector: 'Pharma', mcapWeight: 3.6 },
  { symbol: 'DRREDDY', sector: 'Pharma', mcapWeight: 1.5 },
  { symbol: 'CIPLA', sector: 'Pharma', mcapWeight: 1.4 },
  { symbol: 'TATASTEEL', sector: 'Metals', mcapWeight: 2.0 },
  { symbol: 'JSWSTEEL', sector: 'Metals', mcapWeight: 2.1 },
  { symbol: 'HINDALCO', sector: 'Metals', mcapWeight: 1.7 },
  { symbol: 'TITAN', sector: 'Consumer', mcapWeight: 2.7 },
  { symbol: 'ASIANPAINT', sector: 'Consumer', mcapWeight: 2.3 },
  { symbol: 'COALINDIA', sector: 'Metals', mcapWeight: 2.2 },
  { symbol: 'GRASIM', sector: 'Infra', mcapWeight: 1.6 },
];

export interface ScreenerRule {
  field: 'ltp' | 'changePercent' | 'volume' | 'vwapDiffPct' | 'dayRangePosPct' | 'openGapPct';
  op: 'GT' | 'GTE' | 'LT' | 'LTE' | 'BETWEEN';
  value: number | [number, number];
}

export interface ScreenerPreset {
  id: string;
  name: string;
  category: 'INTRADAY' | 'TECHNICAL' | 'FNO' | 'FUNDAMENTAL';
  description: string;
  logic: 'AND' | 'OR';
  rules: ScreenerRule[];
  sortBy: string;
  sortDir: 'ASC' | 'DESC';
}

const SYSTEM_PRESETS: ScreenerPreset[] = [
  { id: 'TOP_GAINERS', name: 'Intraday Top Gainers', category: 'INTRADAY', description: 'Stocks up > 1% today sorted by highest % gain', logic: 'AND', rules: [{ field: 'changePercent', op: 'GTE', value: 1 }], sortBy: 'changePercent', sortDir: 'DESC' },
  { id: 'TOP_LOSERS', name: 'Intraday Top Losers', category: 'INTRADAY', description: 'Stocks down > 1% today sorted by steepest drop', logic: 'AND', rules: [{ field: 'changePercent', op: 'LTE', value: -1 }], sortBy: 'changePercent', sortDir: 'ASC' },
  { id: 'ABOVE_VWAP_MOMENTUM', name: 'Above VWAP Momentum', category: 'TECHNICAL', description: 'Trading above VWAP with positive intraday strength', logic: 'AND', rules: [{ field: 'vwapDiffPct', op: 'GT', value: 0.2 }, { field: 'changePercent', op: 'GT', value: 0 }], sortBy: 'vwapDiffPct', sortDir: 'DESC' },
  { id: 'BELOW_VWAP_WEAK', name: 'Below VWAP Breakdown', category: 'TECHNICAL', description: 'Trading below VWAP with negative day return', logic: 'AND', rules: [{ field: 'vwapDiffPct', op: 'LT', value: -0.2 }, { field: 'changePercent', op: 'LT', value: 0 }], sortBy: 'vwapDiffPct', sortDir: 'ASC' },
  { id: 'NEAR_DAY_HIGH', name: 'Near Day High Breakout', category: 'INTRADAY', description: 'LTP in top 15% of intraday high-low range', logic: 'AND', rules: [{ field: 'dayRangePosPct', op: 'GTE', value: 85 }], sortBy: 'changePercent', sortDir: 'DESC' },
  { id: 'NEAR_DAY_LOW', name: 'Near Day Low Weakness', category: 'INTRADAY', description: 'LTP in bottom 15% of intraday high-low range', logic: 'AND', rules: [{ field: 'dayRangePosPct', op: 'LTE', value: 15 }], sortBy: 'changePercent', sortDir: 'ASC' },
  { id: 'GAP_UP_OPEN', name: 'Gap Up Open (> 0.75%)', category: 'INTRADAY', description: 'Opened significantly above previous close', logic: 'AND', rules: [{ field: 'openGapPct', op: 'GTE', value: 0.75 }], sortBy: 'openGapPct', sortDir: 'DESC' },
  { id: 'GAP_DOWN_OPEN', name: 'Gap Down Open (< -0.75%)', category: 'INTRADAY', description: 'Opened significantly below previous close', logic: 'AND', rules: [{ field: 'openGapPct', op: 'LTE', value: -0.75 }], sortBy: 'openGapPct', sortDir: 'ASC' },
  { id: 'HIGH_VOLUME_ACTIVE', name: 'Volume Leaders (> 10L)', category: 'FNO', description: 'Liquid institutional leaders with heavy participation', logic: 'AND', rules: [{ field: 'volume', op: 'GTE', value: 1_000_000 }], sortBy: 'volume', sortDir: 'DESC' },
  { id: 'ALL_NIFTY_CORE', name: 'Full Core Universe', category: 'FUNDAMENTAL', description: 'All tracked liquid blue-chips across sectors', logic: 'AND', rules: [{ field: 'ltp', op: 'GT', value: 0 }], sortBy: 'changePercent', sortDir: 'DESC' },
];

const RunScreenerBody = z.object({
  presetId: z.string().optional(),
  sector: z.string().optional(),
  logic: z.enum(['AND', 'OR']).optional().default('AND'),
  rules: z
    .array(
      z.object({
        field: z.enum(['ltp', 'changePercent', 'volume', 'vwapDiffPct', 'dayRangePosPct', 'openGapPct']),
        op: z.enum(['GT', 'GTE', 'LT', 'LTE', 'BETWEEN']),
        value: z.union([z.number(), z.tuple([z.number(), z.number()])]),
      })
    )
    .optional()
    .default([]),
  sortBy: z.string().optional().default('changePercent'),
  sortDir: z.enum(['ASC', 'DESC']).optional().default('DESC'),
});

const SaveTemplateBody = z.object({
  name: z.string().trim().min(1).max(60),
  category: z.enum(['INTRADAY', 'TECHNICAL', 'FNO', 'FUNDAMENTAL']).default('TECHNICAL'),
  ast: z.record(z.unknown()),
});

function evalRule(metricVal: number | null, rule: ScreenerRule): boolean {
  if (metricVal == null || !Number.isFinite(metricVal)) return false;
  if (rule.op === 'BETWEEN' && Array.isArray(rule.value)) {
    return metricVal >= rule.value[0] && metricVal <= rule.value[1];
  }
  const v = Array.isArray(rule.value) ? rule.value[0] : rule.value;
  if (rule.op === 'GT') return metricVal > v;
  if (rule.op === 'GTE') return metricVal >= v;
  if (rule.op === 'LT') return metricVal < v;
  if (rule.op === 'LTE') return metricVal <= v;
  return false;
}

export async function screenerRoutes(app: FastifyInstance) {
  // List all pre-built ScanX screeners
  app.get('/presets', async () => {
    return { count: SYSTEM_PRESETS.length, presets: SYSTEM_PRESETS };
  });

  // Execute a pre-built or custom AST screener over live batch quotes
  app.post('/run', async (req, reply) => {
    const parsed = RunScreenerBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid screener query', details: parsed.error.issues });
    }
    const preset = parsed.data.presetId
      ? SYSTEM_PRESETS.find((p) => p.id === parsed.data.presetId)
      : null;
    const logic = preset ? preset.logic : parsed.data.logic;
    const rules: ScreenerRule[] = preset ? preset.rules : (parsed.data.rules as ScreenerRule[]);
    const sortBy = preset ? preset.sortBy : parsed.data.sortBy;
    const sortDir = preset ? preset.sortDir : parsed.data.sortDir;

    const universe = parsed.data.sector && parsed.data.sector !== 'ALL'
      ? SCAN_UNIVERSE.filter((u) => u.sector.toLowerCase() === parsed.data.sector!.toLowerCase())
      : SCAN_UNIVERSE;

    const quotes = await marketDataService.getQuotes(universe.map((u) => u.symbol)).catch(() => []);
    const bySym = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

    const enriched = universe
      .map((u) => {
        const q = bySym.get(u.symbol);
        const ltp = q?.ltp ? Number(q.ltp) : null;
        const prev = q?.prevClose ? Number(q.prevClose) : null;
        const open = q?.open ? Number(q.open) : null;
        const high = q?.high ? Number(q.high) : null;
        const low = q?.low ? Number(q.low) : null;
        const vwap = q?.vwap ? Number(q.vwap) : null;
        const changePercent = q?.changePercent ? Number(q.changePercent) : 0;
        const volume = q?.volume ?? 0;

        const vwapDiffPct = ltp != null && vwap && vwap > 0 ? Number((((ltp - vwap) / vwap) * 100).toFixed(2)) : 0;
        const dayRangePosPct =
          ltp != null && high != null && low != null && high > low
            ? Number((((ltp - low) / (high - low)) * 100).toFixed(1))
            : 50;
        const openGapPct = open != null && prev && prev > 0 ? Number((((open - prev) / prev) * 100).toFixed(2)) : 0;

        return {
          symbol: u.symbol,
          sector: u.sector,
          mcapWeight: u.mcapWeight,
          exchange: q?.exchange ?? 'NSE',
          segment: q?.segment ?? 'EQ',
          ltp,
          prevClose: prev,
          open,
          high,
          low,
          vwap,
          changePercent,
          volume,
          vwapDiffPct,
          dayRangePosPct,
          openGapPct,
          freshness: q?.freshness ?? 'UNAVAILABLE',
        };
      })
      .filter((row) => {
        if (rules.length === 0) return true;
        if (logic === 'OR') {
          return rules.some((r) => evalRule(row[r.field] as number | null, r));
        }
        return rules.every((r) => evalRule(row[r.field] as number | null, r));
      });

    enriched.sort((a, b) => {
      const av = Number((a as Record<string, unknown>)[sortBy] ?? 0);
      const bv = Number((b as Record<string, unknown>)[sortBy] ?? 0);
      return sortDir === 'ASC' ? av - bv : bv - av;
    });

    return {
      presetId: preset?.id ?? null,
      matchedCount: enriched.length,
      universeCount: universe.length,
      results: enriched,
      timestamp: new Date().toISOString(),
    };
  });

  // Treemap Stock & Sector Heatmap + Advance/Decline Breadth
  app.get('/heatmap', async () => {
    const quotes = await marketDataService.getQuotes(SCAN_UNIVERSE.map((u) => u.symbol)).catch(() => []);
    const bySym = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

    let advancers = 0;
    let decliners = 0;
    let unchanged = 0;
    const bySector = new Map<string, Array<{ symbol: string; mcapWeight: number; ltp: string | null; changePercent: number; volume: number }>>();

    for (const u of SCAN_UNIVERSE) {
      const q = bySym.get(u.symbol);
      const chg = q?.changePercent ? Number(q.changePercent) : 0;
      if (chg > 0) advancers++;
      else if (chg < 0) decliners++;
      else unchanged++;

      const arr = bySector.get(u.sector) || [];
      arr.push({
        symbol: u.symbol,
        mcapWeight: u.mcapWeight,
        ltp: q?.ltp ?? null,
        changePercent: chg,
        volume: q?.volume ?? 0,
      });
      bySector.set(u.sector, arr);
    }

    const sectors = [...bySector.entries()].map(([sector, stocks]) => {
      const avgChange = stocks.reduce((s, x) => s + x.changePercent, 0) / Math.max(1, stocks.length);
      const totalWeight = stocks.reduce((s, x) => s + x.mcapWeight, 0);
      return {
        sector,
        avgChangePercent: Number(avgChange.toFixed(2)),
        totalWeight: Number(totalWeight.toFixed(1)),
        advancers: stocks.filter((s) => s.changePercent > 0).length,
        decliners: stocks.filter((s) => s.changePercent < 0).length,
        stocks: stocks.sort((a, b) => b.mcapWeight - a.mcapWeight),
      };
    });

    return {
      breadth: {
        advancers,
        decliners,
        unchanged,
        adRatio: decliners > 0 ? Number((advancers / decliners).toFixed(2)) : advancers,
      },
      sectors: sectors.sort((a, b) => b.totalWeight - a.totalWeight),
      timestamp: new Date().toISOString(),
    };
  });

  // Saved Custom Screener Templates CRUD
  app.get('/templates', { preHandler: [requireAuth] }, async (req) => {
    const prisma = getPrisma();
    const rows = await prisma.screenerTemplate.findMany({
      where: { userId: req.authUser!.id },
      orderBy: { createdAt: 'desc' },
    });
    return {
      count: rows.length,
      templates: rows.map((r) => ({ id: r.id, name: r.name, category: r.category, ast: JSON.parse(r.astJson), createdAt: r.createdAt })),
    };
  });

  app.post('/templates', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = SaveTemplateBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid screener template' });
    const prisma = getPrisma();
    const created = await prisma.screenerTemplate.create({
      data: {
        userId: req.authUser!.id,
        name: parsed.data.name,
        category: parsed.data.category,
        astJson: JSON.stringify(parsed.data.ast),
      },
    });
    return reply.status(201).send({ id: created.id, name: created.name, category: created.category, ast: parsed.data.ast });
  });

  app.delete<{ Params: { id: string } }>('/templates/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const del = await prisma.screenerTemplate.deleteMany({ where: { id: req.params.id, userId: req.authUser!.id } });
    if (del.count === 0) return reply.status(404).send({ error: 'Template not found' });
    return { deleted: true };
  });
}
