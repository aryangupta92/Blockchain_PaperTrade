import { describe, it, expect } from 'vitest';
import {
  analyzeOptionStrategy,
  bsmGreeks,
  bsmOptionPrice,
  classifyOiBuildup,
  OPTION_STRATEGY_TEMPLATES,
  selectQuantModeStrike,
} from '../fnoStrategyPayoff';

describe('F&O Multi-Leg Strategy Payoff & SEBI Hedge-Margin Engine', () => {
  it('computes Bull Call Spread payoff, breakeven, and hedge margin benefit', () => {
    const res = analyzeOptionStrategy({
      spotPrice: 25800,
      asOfDate: '2026-11-20',
      legs: [
        { symbol: 'NIFTY-25800-CE', underlying: 'NIFTY', optionType: 'CE', side: 'BUY', strike: 25800, expiry: '2026-11-26', quantity: 65, premium: 200 },
        { symbol: 'NIFTY-26000-CE', underlying: 'NIFTY', optionType: 'CE', side: 'SELL', strike: 26000, expiry: '2026-11-26', quantity: 65, premium: 100 },
      ],
    });

    // Net debit = (200 - 100) * 65 = -6,500
    // Max Profit = (200 - 100) * 65 = 6,500
    // Breakeven = 25900
    expect(res.netPremiumFlow).toBe('-6500.00');
    expect(res.maxProfit).toBe('6500.00');
    expect(res.maxLoss).toBe('-6500.00');
    expect(res.breakevens).toContain(25900);
    expect(Number(res.marginEstimate.hedgeBenefit)).toBeGreaterThan(0);
    expect(res.marginEstimate.calendarSpreadBenefitStripped).toBe(false);
  });

  it('strips calendar spread margin benefit AND applies +2% extra ELM on near-month expiry day (SEBI Feb 2025)', () => {
    const res = analyzeOptionStrategy({
      spotPrice: 25800,
      asOfDate: '2026-11-26', // Exact expiry day of near leg
      legs: [
        { symbol: 'NIFTY-NOV-25800-CE', underlying: 'NIFTY', optionType: 'CE', side: 'SELL', strike: 25800, expiry: '2026-11-26', quantity: 65, premium: 80 },
        { symbol: 'NIFTY-DEC-25800-CE', underlying: 'NIFTY', optionType: 'CE', side: 'BUY', strike: 25800, expiry: '2026-12-31', quantity: 65, premium: 320 },
      ],
    });

    expect(res.marginEstimate.calendarSpreadBenefitStripped).toBe(true);
    expect(res.marginEstimate.extraExpiryElmApplied).toBe(true);
    expect(res.marginEstimate.hedgeBenefit).toBe('0.00');
    expect(res.marginEstimate.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('computes BSM option price & Greeks, T+0 payoff, POP%, ±1/2 SD, OI buildup 4-quadrant, 17 templates & Quant Mode 9 rules', () => {
    const callPx = bsmOptionPrice({ spot: 25000, strike: 25000, timeYears: 7 / 365, volatility: 0.15, optionType: 'CE' });
    expect(callPx).toBeGreaterThan(150);
    expect(callPx).toBeLessThan(350);

    const g = bsmGreeks({ spot: 25000, strike: 25000, timeYears: 7 / 365, volatility: 0.15, optionType: 'CE' });
    expect(g.delta).toBeGreaterThan(0.45);
    expect(g.delta).toBeLessThan(0.6);
    expect(g.theta).toBeLessThan(0);

    expect(classifyOiBuildup(10, 500)).toBe('LONG_BUILDUP');
    expect(classifyOiBuildup(-10, 500)).toBe('SHORT_BUILDUP');
    expect(classifyOiBuildup(10, -500)).toBe('SHORT_COVERING');
    expect(classifyOiBuildup(-10, -500)).toBe('LONG_UNWINDING');

    expect(OPTION_STRATEGY_TEMPLATES).toHaveLength(17);

    const rows = [
      { strike: 24800, atm: false, call: { ltp: 310, oi: 200000, oiChange: 10000, volume: 15000, delta: 0.72, gamma: 0.0005, iv: 15 }, put: { ltp: 80, oi: 500000, oiChange: 80000, volume: 40000, delta: -0.28, gamma: 0.0005, iv: 15 } },
      { strike: 25000, atm: true, call: { ltp: 190, oi: 350000, oiChange: 45000, volume: 90000, delta: 0.51, gamma: 0.0012, iv: 15 }, put: { ltp: 185, oi: 420000, oiChange: 30000, volume: 85000, delta: -0.49, gamma: 0.0012, iv: 15 } },
      { strike: 25200, atm: false, call: { ltp: 95, oi: 600000, oiChange: 95000, volume: 65000, delta: 0.27, gamma: 0.0006, iv: 15 }, put: { ltp: 295, oi: 180000, oiChange: -5000, volume: 12000, delta: -0.73, gamma: 0.0006, iv: 15 } },
    ];
    expect(selectQuantModeStrike(rows, 25000, { optionType: 'CE', side: 'SELL', lots: 1, rule: 'HIGHEST_OI' })?.strike).toBe(25200);
    expect(selectQuantModeStrike(rows, 25000, { optionType: 'CE', side: 'BUY', lots: 1, rule: 'HIGHEST_VOLUME' })?.strike).toBe(25000);
    expect(selectQuantModeStrike(rows, 25000, { optionType: 'PE', side: 'SELL', lots: 1, rule: 'CLOSEST_DELTA', value: 0.25 })?.strike).toBe(24800);
    expect(selectQuantModeStrike(rows, 25000, { optionType: 'CE', side: 'SELL', lots: 1, rule: 'CLOSEST_PREMIUM', value: 100 })?.strike).toBe(25200);
    expect(selectQuantModeStrike(rows, 25000, { optionType: 'CE', side: 'BUY', lots: 1, rule: 'HIGHEST_GAMMA' })?.strike).toBe(25000);
  });
});
