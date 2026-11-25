import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CandleBar,
  evaluateLatestSignal,
  runBacktest,
  STRATEGY_PRESETS,
  StrategyDefinition,
} from '@broker/shared';
import { requireAuth } from '../infrastructure/authMiddleware';
import { getPrisma } from '../infrastructure/database';
import { marketDataService } from '../services/market-data/marketDataService';
import { resolveInstrument } from '../services/market-data/instrumentMaster';

const OperandSchema = z.object({
  type: z.enum([
    'PRICE_OPEN', 'PRICE_HIGH', 'PRICE_LOW', 'PRICE_CLOSE', 'VOLUME',
    'SMA', 'EMA', 'VWAP', 'RSI',
    'MACD_LINE', 'MACD_SIGNAL', 'MACD_HIST',
    'BB_UPPER', 'BB_MIDDLE', 'BB_LOWER',
    'SUPERTREND', 'CONSTANT',
  ]),
  period: z.number().int().min(1).max(400).optional(),
  fast: z.number().int().min(1).max(200).optional(),
  slow: z.number().int().min(1).max(400).optional(),
  signal: z.number().int().min(1).max(200).optional(),
  stdMult: z.number().positive().max(10).optional(),
  multiplier: z.number().positive().max(20).optional(),
  value: z.number().finite().optional(),
});

const ConditionSchema = z.object({
  id: z.string().optional(),
  left: OperandSchema,
  operator: z.enum(['>', '<', '>=', '<=', 'CROSSES_ABOVE', 'CROSSES_BELOW']),
  right: OperandSchema,
});

const StrategyDefinitionSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(400).optional(),
  exchange: z.enum(['NSE', 'BSE', 'MCX']).default('NSE'),
  segment: z.enum(['EQ', 'FNO', 'ETF', 'COMM']).default('EQ'),
  instrumentKind: z.enum(['EQUITY', 'INDEX', 'ETF', 'FUTURES', 'OPTIONS']).default('EQUITY'),
  product: z.enum(['CNC', 'MIS', 'NRML']).default('CNC'),
  direction: z.enum(['LONG', 'SHORT', 'BOTH']).default('LONG'),
  entryCombinator: z.enum(['AND', 'OR']).default('AND'),
  entryConditions: z.array(ConditionSchema).min(1).max(12),
  exitCombinator: z.enum(['AND', 'OR']).default('OR'),
  exitConditions: z.array(ConditionSchema).max(12).default([]),
  shortEntryCombinator: z.enum(['AND', 'OR']).optional(),
  shortEntryConditions: z.array(ConditionSchema).max(12).optional(),
  risk: z.object({
    stopLossPct: z.number().positive().max(50).nullable().default(2),
    targetPct: z.number().positive().max(200).nullable().default(5),
    trailingStopPct: z.number().positive().max(50).nullable().default(null),
    maxHoldingBars: z.number().int().positive().max(500).nullable().default(null),
    sizingMode: z.enum(['FIXED_QTY', 'FIXED_CAPITAL', 'RISK_PER_TRADE_PCT']).default('FIXED_CAPITAL'),
    fixedQty: z.number().int().positive().default(10),
    fixedCapital: z.number().min(1000).max(100_000_000).default(100_000),
    riskPerTradePct: z.number().positive().max(25).default(1),
    slippageBps: z.number().min(0).max(200).default(5),
    maxTradesPerDay: z.number().int().positive().max(100).nullable().default(3),
    misSquareOffIST: z.string().regex(/^\d{2}:\d{2}$/).default('15:15'),
  }),
});

const SaveStrategyBody = z.object({
  id: z.string().uuid().optional(),
  definition: StrategyDefinitionSchema,
});

const BacktestRunBody = z.object({
  strategyId: z.string().uuid().optional(),
  strategy: StrategyDefinitionSchema,
  symbol: z.string().min(1),
  interval: z.enum(['1m', '3m', '5m', '15m', '30m', '1h', '1D', '1W']).default('1D'),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  initialCapital: z.number().min(1000).max(100_000_000).default(200_000),
  saveRun: z.boolean().optional().default(true),
  /** Optional explicit candles strictly for deterministic automated tests. */
  barsOverride: z
    .array(
      z.object({
        time: z.number(),
        open: z.number(),
        high: z.number(),
        low: z.number(),
        close: z.number(),
        volume: z.number(),
        oi: z.number().optional(),
      })
    )
    .optional(),
});

const ScanSignalBody = z.object({
  strategy: StrategyDefinitionSchema,
  symbol: z.string().min(1),
  interval: z.enum(['5m', '15m', '30m', '1h', '1D']).default('1D'),
});

export async function strategyRoutes(app: FastifyInstance) {
  // Starter presets catalog
  app.get('/presets', async () => {
    return { presets: STRATEGY_PRESETS };
  });

  // List user's saved strategies
  app.get('/', { preHandler: [requireAuth] }, async (req) => {
    const rows = await getPrisma().tradingStrategy.findMany({
      where: { userId: req.authUser!.id },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      count: rows.length,
      strategies: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        exchange: r.exchange,
        segment: r.segment,
        product: r.product,
        definition: JSON.parse(r.definitionJson) as StrategyDefinition,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  });

  // Save or update a strategy AST
  app.post('/', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = SaveStrategyBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid strategy definition', details: parsed.error.issues });
    }
    const { id, definition } = parsed.data;
    const prisma = getPrisma();
    const userId = req.authUser!.id;

    if (id) {
      const existing = await prisma.tradingStrategy.findUnique({ where: { id } });
      if (!existing || existing.userId !== userId) {
        return reply.status(404).send({ error: 'Strategy not found' });
      }
      const updated = await prisma.tradingStrategy.update({
        where: { id },
        data: {
          name: definition.name,
          description: definition.description || null,
          exchange: definition.exchange,
          segment: definition.segment,
          product: definition.product,
          definitionJson: JSON.stringify(definition),
        },
      });
      return {
        id: updated.id,
        name: updated.name,
        definition: JSON.parse(updated.definitionJson),
        updatedAt: updated.updatedAt.toISOString(),
      };
    }

    const created = await prisma.tradingStrategy.create({
      data: {
        userId,
        name: definition.name,
        description: definition.description || null,
        exchange: definition.exchange,
        segment: definition.segment,
        product: definition.product,
        definitionJson: JSON.stringify(definition),
      },
    });
    return reply.status(201).send({
      id: created.id,
      name: created.name,
      definition: JSON.parse(created.definitionJson),
      createdAt: created.createdAt.toISOString(),
    });
  });

  // Delete a saved strategy
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const existing = await prisma.tradingStrategy.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.authUser!.id) {
      return reply.status(404).send({ error: 'Strategy not found' });
    }
    await prisma.tradingStrategy.delete({ where: { id: req.params.id } });
    return { deleted: true };
  });

  // Run Zero-Look-Ahead Historical Backtest with Exact Indian Statutory Charges & Slippage
  app.post('/backtest', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = BacktestRunBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid backtest request', details: parsed.error.issues });
    }

    const d = parsed.data;
    const inst = await resolveInstrument(d.symbol).catch(() => null);

    let bars: CandleBar[];
    if (d.barsOverride && d.barsOverride.length >= 3) {
      bars = d.barsOverride;
    } else {
      bars = await marketDataService.getCandles({
        instrumentId: inst?.instrumentId ?? d.symbol,
        interval: d.interval,
        from: d.fromDate,
        to: d.toDate,
      });
    }

    if (bars.length < 3) {
      return reply.status(422).send({
        error: `Not enough historical candles returned for ${d.symbol} (${bars.length} bars between ${d.fromDate} and ${d.toDate}). Widen the date range or verify active market-data session.`,
        code: 'INSUFFICIENT_HISTORY',
      });
    }

    // Align strategy metadata cleanly with resolved exchange/segment/lotSize when available
    const effectiveStrategy: StrategyDefinition = {
      ...d.strategy,
      exchange: inst?.exchange ?? d.strategy.exchange,
      segment: inst?.segment ?? d.strategy.segment,
      instrumentKind: inst?.instrumentKind ?? d.strategy.instrumentKind,
    };

    const result = runBacktest({
      strategy: effectiveStrategy,
      symbol: inst?.tradingSymbol ?? d.symbol.toUpperCase(),
      interval: d.interval,
      bars,
      initialCapital: d.initialCapital,
      lotSize: inst?.lotSize ?? 1,
    });

    let runId: string | null = null;
    if (d.saveRun) {
      const saved = await getPrisma().backtestRun.create({
        data: {
          userId: req.authUser!.id,
          strategyId: d.strategyId ?? null,
          strategyName: effectiveStrategy.name,
          symbol: result.symbol,
          exchange: effectiveStrategy.exchange,
          segment: effectiveStrategy.segment,
          interval: result.interval,
          fromDate: result.fromDate,
          toDate: result.toDate,
          initialCapital: result.metrics.initialCapital,
          finalEquity: result.metrics.finalEquity,
          netReturnPct: String(result.metrics.netReturnPct),
          maxDrawdownPct: String(result.metrics.maxDrawdownPct),
          sharpeRatio: String(result.metrics.sharpeRatio),
          totalTrades: result.metrics.totalTrades,
          totalCharges: result.metrics.totalChargesPaid,
          metricsJson: JSON.stringify(result.metrics),
          equityCurveJson: JSON.stringify(result.equityCurve),
          tradesJson: JSON.stringify(result.trades),
        },
      });
      runId = saved.id;
    }

    return {
      runId,
      ...result,
    };
  });

  // List saved backtest runs for side-by-side comparison
  app.get('/backtests', { preHandler: [requireAuth] }, async (req) => {
    const rows = await getPrisma().backtestRun.findMany({
      where: { userId: req.authUser!.id },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        id: true,
        strategyId: true,
        strategyName: true,
        symbol: true,
        exchange: true,
        segment: true,
        interval: true,
        fromDate: true,
        toDate: true,
        initialCapital: true,
        finalEquity: true,
        netReturnPct: true,
        maxDrawdownPct: true,
        sharpeRatio: true,
        totalTrades: true,
        totalCharges: true,
        createdAt: true,
      },
    });
    return { count: rows.length, runs: rows };
  });

  // Retrieve full stored backtest run (equity curve + trade log)
  app.get<{ Params: { id: string } }>('/backtests/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const row = await getPrisma().backtestRun.findUnique({ where: { id: req.params.id } });
    if (!row || row.userId !== req.authUser!.id) {
      return reply.status(404).send({ error: 'Backtest run not found' });
    }
    return {
      runId: row.id,
      strategyName: row.strategyName,
      symbol: row.symbol,
      interval: row.interval,
      fromDate: row.fromDate,
      toDate: row.toDate,
      metrics: JSON.parse(row.metricsJson),
      equityCurve: JSON.parse(row.equityCurveJson),
      trades: JSON.parse(row.tradesJson),
      createdAt: row.createdAt.toISOString(),
    };
  });

  // Evaluate latest live signal for a strategy on recent candles (for 1-click DEMO practice)
  app.post('/scan-signal', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = ScanSignalBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid signal scan request', details: parsed.error.issues });
    }
    const { strategy, symbol, interval } = parsed.data;
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const lookbackDays = interval === '1D' ? 180 : 20;
    const from = new Date(now.getTime() - lookbackDays * 86400 * 1000).toISOString().slice(0, 10);

    const bars = await marketDataService.getCandles({
      instrumentId: symbol,
      interval,
      from,
      to,
    });
    return {
      symbol: symbol.toUpperCase(),
      interval,
      barsChecked: bars.length,
      ...evaluateLatestSignal(strategy as StrategyDefinition, bars),
    };
  });
}
