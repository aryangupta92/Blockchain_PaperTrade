import { describe, it, expect } from 'vitest';
import { CandleBar } from '../marketTypes';
import { runBacktest, STRATEGY_PRESETS, StrategyDefinition } from '../strategyBacktester';

const baseRisk = {
  stopLossPct: null,
  targetPct: null,
  trailingStopPct: null,
  maxHoldingBars: null,
  sizingMode: 'FIXED_QTY' as const,
  fixedQty: 10,
  fixedCapital: 100000,
  riskPerTradePct: 1,
  slippageBps: 0,
  maxTradesPerDay: null,
  misSquareOffIST: '15:15',
};

describe('Zero-Look-Ahead Strategy Backtesting Engine', () => {
  it('executes strictly at NEXT bar OPEN (zero look-ahead bias) and deducts Finance Act 2026 statutory charges', () => {
    // Bar 0 close=100, Bar 1 close=105 (> 102 triggers signal at bar 1 close!) -> MUST fill at Bar 2 OPEN (110), NOT Bar 1 close!
    const bars: CandleBar[] = [
      { time: Math.floor(new Date('2026-05-04T09:15:00+05:30').getTime() / 1000), open: 99, high: 101, low: 98, close: 100, volume: 1000 },
      { time: Math.floor(new Date('2026-05-05T09:15:00+05:30').getTime() / 1000), open: 100, high: 106, low: 100, close: 105, volume: 1000 },
      { time: Math.floor(new Date('2026-05-06T09:15:00+05:30').getTime() / 1000), open: 110, high: 115, low: 109, close: 114, volume: 1000 },
      { time: Math.floor(new Date('2026-05-07T09:15:00+05:30').getTime() / 1000), open: 114, high: 122, low: 113, close: 120, volume: 1000 },
    ];

    const strat: StrategyDefinition = {
      name: 'Simple Breakout',
      exchange: 'NSE',
      segment: 'EQ',
      instrumentKind: 'EQUITY',
      product: 'CNC',
      direction: 'LONG',
      entryCombinator: 'AND',
      entryConditions: [{ left: { type: 'PRICE_CLOSE' }, operator: '>', right: { type: 'CONSTANT', value: 102 } }],
      exitCombinator: 'OR',
      exitConditions: [],
      risk: baseRisk,
    };

    const res = runBacktest({ strategy: strat, symbol: 'RELIANCE', interval: '1D', bars, initialCapital: 100000 });
    expect(res.trades).toHaveLength(1);
    expect(res.trades[0].entryPrice).toBe('110.00'); // Strictly bar 2 OPEN!
    expect(res.trades[0].exitPrice).toBe('120.00');
    expect(res.trades[0].grossPnl).toBe('100.00');
    expect(Number(res.trades[0].totalCharges)).toBeGreaterThan(15); // Includes CNC STT + DP + GST!
    expect(Number(res.trades[0].netPnl)).toBeLessThan(100);
  });

  it('fills gap-down overnight stop-loss at actual gap OPEN price and applies conservative tie-break when SL & Target both sit inside one bar', () => {
    // Signal bar 0 -> enters bar 1 open=100 (SL=95, Target=105). Bar 2 gaps down to open=88 -> MUST fill at 88.00 (STOP_LOSS_GAP)!
    const gapBars: CandleBar[] = [
      { time: Math.floor(new Date('2026-05-04T09:15:00+05:30').getTime() / 1000), open: 95, high: 101, low: 95, close: 101, volume: 1000 },
      { time: Math.floor(new Date('2026-05-05T09:15:00+05:30').getTime() / 1000), open: 100, high: 102, low: 98, close: 100, volume: 1000 },
      { time: Math.floor(new Date('2026-05-06T09:15:00+05:30').getTime() / 1000), open: 88, high: 92, low: 85, close: 90, volume: 1000 },
    ];
    const strat: StrategyDefinition = {
      name: 'Gap SL Test',
      exchange: 'NSE',
      segment: 'EQ',
      instrumentKind: 'EQUITY',
      product: 'CNC',
      direction: 'LONG',
      entryCombinator: 'AND',
      entryConditions: [{ left: { type: 'PRICE_CLOSE' }, operator: '>', right: { type: 'CONSTANT', value: 100 } }],
      exitCombinator: 'OR',
      exitConditions: [],
      risk: { ...baseRisk, stopLossPct: 5, targetPct: 5 },
    };

    const gapRes = runBacktest({ strategy: strat, symbol: 'TCS', interval: '1D', bars: gapBars, initialCapital: 100000 });
    expect(gapRes.trades[0].exitReason).toBe('STOP_LOSS_GAP');
    expect(gapRes.trades[0].exitPrice).toBe('88.00');

    // Conservative tie-break: bar 2 has open=100, low=90 (hits SL 95) AND high=112 (hits Target 105) -> SL MUST win!
    const tieBars: CandleBar[] = [
      gapBars[0],
      gapBars[1],
      { time: gapBars[2].time, open: 100, high: 112, low: 90, close: 110, volume: 1000 },
    ];
    const tieRes = runBacktest({ strategy: strat, symbol: 'TCS', interval: '1D', bars: tieBars, initialCapital: 100000 });
    expect(tieRes.trades[0].exitReason).toBe('STOP_LOSS');
    expect(tieRes.trades[0].exitPrice).toBe('95.00');
  });

  it('enforces MIS 15:15 IST intraday auto square-off and SEBI CNC short-selling prohibition', () => {
    const intradayBars: CandleBar[] = [
      { time: Math.floor(new Date('2026-05-04T09:30:00+05:30').getTime() / 1000), open: 100, high: 102, low: 99, close: 101, volume: 500 },
      { time: Math.floor(new Date('2026-05-04T10:00:00+05:30').getTime() / 1000), open: 102, high: 104, low: 101, close: 103, volume: 500 },
      { time: Math.floor(new Date('2026-05-04T15:15:00+05:30').getTime() / 1000), open: 103, high: 105, low: 102, close: 104, volume: 500 },
      { time: Math.floor(new Date('2026-05-05T09:15:00+05:30').getTime() / 1000), open: 120, high: 122, low: 118, close: 121, volume: 500 },
    ];

    const misStrat: StrategyDefinition = {
      name: 'MIS Intraday',
      exchange: 'NSE',
      segment: 'EQ',
      instrumentKind: 'EQUITY',
      product: 'MIS',
      direction: 'LONG',
      entryCombinator: 'AND',
      entryConditions: [{ left: { type: 'PRICE_CLOSE' }, operator: '>', right: { type: 'CONSTANT', value: 100 } }],
      exitCombinator: 'OR',
      exitConditions: [],
      risk: baseRisk,
    };

    const res = runBacktest({ strategy: misStrat, symbol: 'HDFCBANK', interval: '15m', bars: intradayBars, initialCapital: 100000 });
    expect(res.trades[0].exitReason).toBe('MIS_AUTO_SQUAREOFF');
    expect(res.trades[0].exitPrice).toBe('104.00'); // Never held overnight into 120!

    // CNC short warning check
    const cncShortRes = runBacktest({
      strategy: { ...misStrat, product: 'CNC', direction: 'SHORT' },
      symbol: 'HDFCBANK',
      interval: '1D',
      bars: intradayBars,
      initialCapital: 100000,
    });
    expect(cncShortRes.warnings.some((w) => w.includes('SEBI CNC Rule'))).toBe(true);
  });

  it('runs built-in EMA Crossover preset cleanly across a synthetic trend series', () => {
    const start = Math.floor(new Date('2026-01-01T09:15:00+05:30').getTime() / 1000);
    const bars: CandleBar[] = [];
    for (let i = 0; i < 80; i++) {
      const px = 1000 + Math.sin(i / 6) * 80 + i * 2;
      bars.push({
        time: start + i * 86400,
        open: Number(px.toFixed(2)),
        high: Number((px + 8).toFixed(2)),
        low: Number((px - 8).toFixed(2)),
        close: Number((px + 2).toFixed(2)),
        volume: 50000,
      });
    }
    const res = runBacktest({
      strategy: STRATEGY_PRESETS[0],
      symbol: 'RELIANCE',
      interval: '1D',
      bars,
      initialCapital: 200000,
    });
    expect(res.barsAnalyzed).toBe(80);
    expect(res.equityCurve).toHaveLength(80);
    expect(res.metrics.totalTrades).toBeGreaterThanOrEqual(1);
  });
});
