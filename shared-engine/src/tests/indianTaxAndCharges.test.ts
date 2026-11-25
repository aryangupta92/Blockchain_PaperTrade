import { describe, it, expect } from 'vitest';
import { calculateTradeCharges } from '../indianTaxAndCharges';
import { formatINR, validateDemoBalanceRange } from '../decimalMoney';

describe('Charges Engine — Finance Act 2026 & SEBI Statutory Breakdown (Worked Examples)', () => {
  it('1. Equity Delivery (CNC) BUY on NSE — ₹1,00,000 turnover (Apr 2026)', () => {
    const res = calculateTradeCharges({
      exchange: 'NSE',
      segment: 'EQ',
      instrumentKind: 'EQUITY',
      product: 'CNC',
      side: 'BUY',
      quantity: 100,
      price: '1000',
      asOfDate: '2026-04-15',
    });

    // Turnover: 100,000.00
    // Brokerage (CNC ₹0): 0.00
    // STT (0.1% Buy): 100.00
    // Exchange Txn (0.00297%): 2.97
    // SEBI Turnover (0.0001%): 0.10
    // Stamp Duty (0.015% Buy): 15.00
    // GST (18% of 0 + 2.97 + 0.10 = 3.07): 0.55
    // Total Charges: 118.62
    expect(res.turnover).toBe('100000.00');
    expect(res.brokerage).toBe('0.00');
    expect(res.sttOrCtt).toBe('100.00');
    expect(res.exchangeTransactionCharge).toBe('2.97');
    expect(res.sebiTurnoverFee).toBe('0.10');
    expect(res.stampDuty).toBe('15.00');
    expect(res.dpChargeExclGst).toBe('0.00');
    expect(res.gst).toBe('0.55');
    expect(res.totalCharges).toBe('118.62');
    expect(res.netCashImpact).toBe('-100118.62');
  });

  it('2. Equity Delivery (CNC) SELL on NSE with DP Charge — ₹1,00,000 turnover', () => {
    const res = calculateTradeCharges({
      exchange: 'NSE',
      segment: 'EQ',
      instrumentKind: 'EQUITY',
      product: 'CNC',
      side: 'SELL',
      quantity: 100,
      price: '1000',
      applyDpCharge: true,
      asOfDate: '2026-04-15',
    });

    // STT 0.1% = 100.00; Exch = 2.97; SEBI = 0.10; Stamp = 0; DP excl GST = 13.50
    // GST 18% on (0 + 2.97 + 0.10 + 13.50 = 16.57) = 2.98
    // Total = 119.55; Net Cash = +99880.45
    expect(res.sttOrCtt).toBe('100.00');
    expect(res.stampDuty).toBe('0.00');
    expect(res.dpChargeExclGst).toBe('13.50');
    expect(res.gst).toBe('2.98');
    expect(res.totalCharges).toBe('119.55');
    expect(res.netCashImpact).toBe('99880.45');
  });

  it('3. Equity Intraday (MIS) SELL on NSE — ₹1,00,000 turnover (brokerage capped at ₹20)', () => {
    const res = calculateTradeCharges({
      exchange: 'NSE',
      segment: 'EQ',
      instrumentKind: 'EQUITY',
      product: 'MIS',
      side: 'SELL',
      quantity: 100,
      price: '1000',
      asOfDate: '2026-04-15',
    });

    // Brokerage: min(0.03% of 100,000 = 30, 20) = 20.00
    // STT (0.025% sell): 25.00
    // Exch: 2.97; SEBI: 0.10; Stamp: 0
    // GST (18% of 23.07): 4.15
    // Total: 52.22
    expect(res.brokerage).toBe('20.00');
    expect(res.sttOrCtt).toBe('25.00');
    expect(res.gst).toBe('4.15');
    expect(res.totalCharges).toBe('52.22');
  });

  it('4. Equity Futures SELL — Finance Act 2026 (0.05% STT) vs Pre-Apr-2026 (0.02% STT)', () => {
    const post2026 = calculateTradeCharges({
      exchange: 'NSE',
      segment: 'FNO',
      instrumentKind: 'FUTURES',
      product: 'NRML',
      side: 'SELL',
      quantity: 65,
      price: '24000',
      asOfDate: '2026-04-01',
    });
    const pre2026 = calculateTradeCharges({
      exchange: 'NSE',
      segment: 'FNO',
      instrumentKind: 'FUTURES',
      product: 'NRML',
      side: 'SELL',
      quantity: 65,
      price: '24000',
      asOfDate: '2026-03-31',
    });

    // Turnover = 65 * 24000 = 15,60,000
    // Post Apr 2026 STT = 0.05% = 780.00
    // Pre Apr 2026 STT = 0.02% = 312.00
    expect(post2026.turnover).toBe('1560000.00');
    expect(post2026.sttOrCtt).toBe('780.00');
    expect(pre2026.sttOrCtt).toBe('312.00');
    expect(post2026.brokerage).toBe('20.00');
  });

  it('5. Equity Options SELL (0.15% on premium) & Exercised ITM Option (0.15% on intrinsic)', () => {
    const optSell = calculateTradeCharges({
      exchange: 'NSE',
      segment: 'FNO',
      instrumentKind: 'OPTIONS',
      product: 'NRML',
      side: 'SELL',
      quantity: 65,
      price: '200', // Premium turnover = 13,000
      asOfDate: '2026-05-10',
    });

    // STT = 0.15% of 13,000 = 19.5 -> rounded to nearest rupee = 20.00
    expect(optSell.turnover).toBe('13000.00');
    expect(optSell.brokerage).toBe('20.00');
    expect(optSell.sttOrCtt).toBe('20.00');

    const optExercise = calculateTradeCharges({
      exchange: 'NSE',
      segment: 'FNO',
      instrumentKind: 'OPTIONS',
      product: 'NRML',
      side: 'BUY',
      quantity: 65,
      price: '24500', // Settlement price
      strikePrice: '24000', // Intrinsic = 500 * 65 = 32,500
      isOptionExercise: true,
      asOfDate: '2026-05-10',
    });

    // STT = 0.15% of 32,500 = 48.75 -> nearest rupee = 49.00
    expect(optExercise.sttOrCtt).toBe('49.00');
  });

  it('6. MCX Commodity Futures SELL — CTT & Exchange Charges', () => {
    const mcxSell = calculateTradeCharges({
      exchange: 'MCX',
      segment: 'COMM',
      instrumentKind: 'FUTURES',
      product: 'NRML',
      side: 'SELL',
      quantity: 100,
      price: '6000', // ₹6,00,000
      asOfDate: '2026-06-01',
    });

    expect(mcxSell.turnover).toBe('600000.00');
    expect(mcxSell.brokerage).toBe('20.00');
    expect(mcxSell.sttOrCtt).toBe('60.00'); // 0.01% CTT
    expect(mcxSell.exchangeTransactionCharge).toBe('12.60'); // 0.0021%
  });
});

describe('Decimal Money & DEMO Range Validation', () => {
  it('formats Indian currency correctly', () => {
    expect(formatINR('10000000')).toBe('₹1,00,00,000.00');
    expect(formatINR('-250500.5')).toBe('-₹2,50,500.50');
  });

  it('validates DEMO balance strictly between ₹1,000 and ₹1,00,00,000', () => {
    expect(validateDemoBalanceRange(999.99).valid).toBe(false);
    expect(validateDemoBalanceRange(1000).valid).toBe(true);
    expect(validateDemoBalanceRange(10000000).valid).toBe(true);
    expect(validateDemoBalanceRange(10000000.01).valid).toBe(false);
  });
});
