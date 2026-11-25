import { describe, it, expect } from 'vitest';
import { CandleBar } from '../marketTypes';
import {
  computeADX,
  computeATR,
  computeBollingerBands,
  computeCCI,
  computeDonchian,
  computeEMA,
  computeHeikinAshi,
  computeKeltner,
  computeMACD,
  computeOBV,
  computePivotPoints,
  computeRSI,
  computeSMA,
  computeStochRSI,
  computeSupertrend,
  computeVWAP,
  computeWMA,
  computeXIRR,
} from '../technicalIndicators';

function sampleBars(count = 50): CandleBar[] {
  const start = 1775000000;
  const bars: CandleBar[] = [];
  let px = 1000;
  for (let i = 0; i < count; i++) {
    const open = px;
    const delta = Math.sin(i / 4) * 12 + 2;
    const close = Number((open + delta).toFixed(2));
    const high = Number((Math.max(open, close) + 5).toFixed(2));
    const low = Number((Math.min(open, close) - 4).toFixed(2));
    bars.push({
      time: start + i * 300,
      open,
      high,
      low,
      close,
      volume: 10000 + i * 250,
      oi: 50000 + i * 100,
    });
    px = close;
  }
  return bars;
}

describe('Technical Indicators & Heikin Ashi Engine', () => {
  const bars = sampleBars(60);

  it('computes Heikin Ashi candles preserving length and OHLC invariants', () => {
    const ha = computeHeikinAshi(bars);
    expect(ha).toHaveLength(bars.length);
    for (const b of ha) {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
    }
  });

  it('computes SMA, EMA, VWAP, Bollinger Bands, RSI, MACD, and Supertrend accurately', () => {
    const sma = computeSMA(bars, 20);
    expect(sma).toHaveLength(41);

    const ema = computeEMA(bars, 20);
    expect(ema).toHaveLength(41);

    const vwap = computeVWAP(bars);
    expect(vwap).toHaveLength(bars.length);

    const bb = computeBollingerBands(bars, 20, 2);
    expect(bb).toHaveLength(41);
    for (const p of bb) {
      expect(p.upper).toBeGreaterThanOrEqual(p.middle);
      expect(p.middle).toBeGreaterThanOrEqual(p.lower);
    }

    const rsi = computeRSI(bars, 14);
    expect(rsi.length).toBeGreaterThan(30);
    for (const r of rsi) {
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThanOrEqual(100);
    }

    const macd = computeMACD(bars, 12, 26, 9);
    expect(macd.length).toBeGreaterThan(20);

    const st = computeSupertrend(bars, 10, 3);
    expect(st).toHaveLength(50);
    expect(['UP', 'DOWN']).toContain(st[0].direction);
  });

  it('computes WMA, ATR, StochRSI, CCI, ADX, OBV, Donchian, Keltner, Pivot/CPR, and XIRR accurately', () => {
    expect(computeWMA(bars, 20)).toHaveLength(41);
    const atr = computeATR(bars, 14);
    expect(atr.length).toBeGreaterThan(40);
    expect(atr[0].value).toBeGreaterThan(0);

    const srsi = computeStochRSI(bars, 14, 14);
    expect(srsi.length).toBeGreaterThan(15);
    expect(srsi[0].value).toBeGreaterThanOrEqual(0);
    expect(srsi[0].value).toBeLessThanOrEqual(100);

    expect(computeCCI(bars, 20).length).toBe(41);
    expect(computeADX(bars, 14).length).toBeGreaterThan(10);
    expect(computeOBV(bars)).toHaveLength(bars.length);

    const dc = computeDonchian(bars, 20);
    expect(dc).toHaveLength(41);
    expect(dc[0].upper).toBeGreaterThanOrEqual(dc[0].lower);

    const kc = computeKeltner(bars, 20, 10, 2);
    expect(kc.length).toBeGreaterThan(30);
    expect(kc[0].upper).toBeGreaterThan(kc[0].lower);

    const piv = computePivotPoints({ high: 25200, low: 24800, close: 25100 });
    expect(piv.pivot).toBeCloseTo(25033.33, 1);
    expect(piv.r1).toBeGreaterThan(piv.pivot);
    expect(piv.s1).toBeLessThan(piv.pivot);
    expect(piv.tc).toBeGreaterThanOrEqual(piv.bc);

    // ₹1,00,000 invested 1 year ago worth ₹1,20,000 today => ~20% XIRR
    const xirr = computeXIRR([
      { amount: -100000, date: new Date('2025-01-01T00:00:00Z') },
      { amount: 120000, date: new Date('2026-01-01T00:00:00Z') },
    ]);
    expect(xirr).not.toBeNull();
    expect(xirr!).toBeGreaterThan(19);
    expect(xirr!).toBeLessThan(21);
  });
});
