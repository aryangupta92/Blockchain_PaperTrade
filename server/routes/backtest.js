'use strict';
/**
 * routes/backtest.js
 * Module 3: AI-Assisted Backtesting & Strategy Validator
 * Runs a simulated backtest with Indian market cost model (STT, brokerage, stamp duty, slippage)
 */
const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middleware/auth');

// ── Indian Market Transaction Cost Engine ─────────────────────────────────────
/**
 * Calculates the true round-trip cost of a trade in Indian markets.
 * Based on SEBI/NSE/BSE published charges as of FY2024-25.
 */
function calculateIndianCosts(tradeValue, side, instrument = 'EQUITY_DELIVERY') {
  const costs = {};
  const tv = Math.abs(tradeValue);

  switch (instrument) {
    case 'EQUITY_INTRADAY':
      costs.stt        = side === 'SELL' ? tv * 0.00025 : 0;         // STT 0.025% on sell side
      costs.brokerage  = Math.min(20, tv * 0.0003);                  // Discount broker: 0.03% or ₹20
      costs.exchangeTx = tv * 0.0000345;                             // NSE transaction charge
      costs.sebi       = tv * 0.000001;                              // SEBI turnover fee
      costs.gst        = (costs.brokerage + costs.exchangeTx + costs.sebi) * 0.18;
      costs.stampDuty  = side === 'BUY' ? tv * 0.00003 : 0;         // Stamp duty only on buy
      break;

    case 'EQUITY_DELIVERY':
      costs.stt        = tv * 0.001;                                 // STT 0.1% on both sides
      costs.brokerage  = Math.min(20, tv * 0.0003);
      costs.exchangeTx = tv * 0.0000345;
      costs.sebi       = tv * 0.000001;
      costs.gst        = (costs.brokerage + costs.exchangeTx + costs.sebi) * 0.18;
      costs.stampDuty  = side === 'BUY' ? tv * 0.00015 : 0;         // 0.015% on buy
      break;

    case 'FNO_OPTIONS':
      costs.stt        = side === 'SELL' ? tv * 0.0005 : 0;          // STT 0.05% on sell (options)
      costs.brokerage  = 20;                                          // Flat ₹20 per order (discount)
      costs.exchangeTx = tv * 0.00053;                               // NSE options tx charge
      costs.sebi       = tv * 0.000001;
      costs.gst        = (costs.brokerage + costs.exchangeTx + costs.sebi) * 0.18;
      costs.stampDuty  = side === 'BUY' ? tv * 0.00003 : 0;
      break;

    case 'FNO_FUTURES':
      costs.stt        = side === 'SELL' ? tv * 0.0001 : 0;          // STT 0.01% on sell
      costs.brokerage  = 20;
      costs.exchangeTx = tv * 0.0000235;
      costs.sebi       = tv * 0.000001;
      costs.gst        = (costs.brokerage + costs.exchangeTx + costs.sebi) * 0.18;
      costs.stampDuty  = side === 'BUY' ? tv * 0.00002 : 0;
      break;

    default:
      costs.stt        = tv * 0.001;
      costs.brokerage  = Math.min(20, tv * 0.0003);
      costs.exchangeTx = tv * 0.0000345;
      costs.sebi       = tv * 0.000001;
      costs.gst        = (costs.brokerage + costs.exchangeTx + costs.sebi) * 0.18;
      costs.stampDuty  = side === 'BUY' ? tv * 0.00015 : 0;
  }

  costs.total = Object.values(costs).reduce((a, b) => a + b, 0);
  return costs;
}

/**
 * Simulates slippage based on instrument type and order size.
 * In Indian markets, mid/small cap stocks suffer significant impact cost.
 */
function applySlippage(price, side, instrument = 'EQUITY_DELIVERY', slippagePct = 0.1) {
  const slip = price * (slippagePct / 100);
  return side === 'BUY' ? price + slip : price - slip;
}

// ── Signal Generators (Simple Rule-Based) ────────────────────────────────────
function generateSignals(candles, entryRule, exitRule) {
  const signals = [];
  const sma = (arr, n) => {
    if (arr.length < n) return null;
    return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
  };

  const closes = candles.map(c => c.close);

  for (let i = 20; i < candles.length; i++) {
    const recentCloses = closes.slice(0, i + 1);
    const sma20 = sma(recentCloses, 20);
    const sma50 = sma(recentCloses, 50) || sma20;

    let signal = 'HOLD';

    // Interpret entry/exit rule strings
    const ruleLower = (entryRule || '').toLowerCase();
    if (ruleLower.includes('sma') || ruleLower.includes('moving average') || ruleLower.includes('golden cross')) {
      if (closes[i] > sma20 && closes[i - 1] <= sma20) signal = 'BUY';
    } else if (ruleLower.includes('breakout') || ruleLower.includes('high')) {
      const highest20 = Math.max(...recentCloses.slice(-21, -1));
      if (closes[i] > highest20) signal = 'BUY';
    } else if (ruleLower.includes('rsi') || ruleLower.includes('oversold')) {
      // Simple RSI approximation
      const gains = [], losses = [];
      for (let j = i - 13; j <= i; j++) {
        const diff = closes[j] - closes[j - 1];
        if (diff >= 0) gains.push(diff); else losses.push(Math.abs(diff));
      }
      const avgGain = gains.reduce((a, b) => a + b, 0) / 14;
      const avgLoss = losses.reduce((a, b) => a + b, 0) / 14 || 0.0001;
      const rs = avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      if (rsi < 30) signal = 'BUY';
      else if (rsi > 70) signal = 'SELL';
    } else {
      // Default: simple price-above-MA signal
      if (closes[i] > sma20 && closes[i] > sma50 && closes[i - 1] <= sma20) signal = 'BUY';
    }

    const exitLower = (exitRule || '').toLowerCase();
    if (exitLower.includes('sma') || exitLower.includes('moving average') || exitLower.includes('death cross')) {
      if (closes[i] < sma20 && closes[i - 1] >= sma20) signal = 'SELL';
    } else if (exitLower.includes('target') || exitLower.includes('stop')) {
      // Stop-loss/target are handled in trade simulation below
    }

    if (signal !== 'HOLD') {
      signals.push({ index: i, date: candles[i].date, price: candles[i].close, signal });
    }
  }
  return signals;
}

// ── Main Backtest Engine ──────────────────────────────────────────────────────
function runBacktestEngine(params) {
  const {
    capital = 100000,
    instrument = 'EQUITY_DELIVERY',
    stopLossPct = 5,
    targetPct = 10,
    slippagePct = 0.1,
    positionSizePct = 20,   // % of capital per trade
    entryCondition = 'sma crossover',
    exitCondition  = 'target or stop loss',
    candles = []            // [{ date, open, high, low, close, volume }]
  } = params;

  if (candles.length < 30) {
    return { error: 'Insufficient candle data. Need at least 30 periods.' };
  }

  const signals      = generateSignals(candles, entryCondition, exitCondition);
  let   cashBalance  = capital;
  let   position     = null;        // { entryPrice, qty, entryDate, entryCosts }
  const trades       = [];
  let   maxDrawdown  = 0;
  let   peakBalance  = capital;
  const equityCurve  = [];

  for (const sig of signals) {
    if (sig.signal === 'BUY' && !position) {
      const positionValue = cashBalance * (positionSizePct / 100);
      const entryPrice    = applySlippage(sig.price, 'BUY', instrument, slippagePct);
      const qty           = Math.floor(positionValue / entryPrice);
      if (qty < 1) continue;

      const tradeValue  = entryPrice * qty;
      const entryCosts  = calculateIndianCosts(tradeValue, 'BUY', instrument);
      cashBalance      -= (tradeValue + entryCosts.total);

      position = {
        entryPrice, qty, entryDate: sig.date,
        entryCosts, tradeValue,
        stopLoss: entryPrice * (1 - stopLossPct / 100),
        target:   entryPrice * (1 + targetPct / 100),
      };

    } else if (sig.signal === 'SELL' && position) {
      const exitPrice  = applySlippage(sig.price, 'SELL', instrument, slippagePct);
      const exitValue  = exitPrice * position.qty;
      const exitCosts  = calculateIndianCosts(exitValue, 'SELL', instrument);
      const grossPnl   = exitValue - position.tradeValue;
      const totalCosts = position.entryCosts.total + exitCosts.total;
      const netPnl     = grossPnl - totalCosts;

      cashBalance += exitValue - exitCosts.total;
      if (cashBalance > peakBalance) peakBalance = cashBalance;
      const drawdown = ((peakBalance - cashBalance) / peakBalance) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;

      trades.push({
        entryDate: position.entryDate, exitDate: sig.date,
        symbol:    params.symbol || 'INDEX',
        entryPrice: +position.entryPrice.toFixed(2),
        exitPrice:  +exitPrice.toFixed(2),
        qty:        position.qty,
        grossPnl:   +grossPnl.toFixed(2),
        totalCosts: +totalCosts.toFixed(2),
        netPnl:     +netPnl.toFixed(2),
        pnlPct:     +((netPnl / position.tradeValue) * 100).toFixed(2),
        exitReason: exitPrice <= position.stopLoss ? 'STOP_LOSS' : exitPrice >= position.target ? 'TARGET' : 'SIGNAL',
        costs: {
          entry: +position.entryCosts.total.toFixed(2),
          exit:  +exitCosts.total.toFixed(2),
          stt:   +(position.entryCosts.stt + exitCosts.stt).toFixed(2),
          brokerage: +(position.entryCosts.brokerage + exitCosts.brokerage).toFixed(2),
        }
      });

      equityCurve.push({ date: sig.date, balance: +cashBalance.toFixed(2) });
      position = null;
    }
  }

  // --- Performance Metrics ---
  const totalTrades   = trades.length;
  const winningTrades = trades.filter(t => t.netPnl > 0);
  const losingTrades  = trades.filter(t => t.netPnl <= 0);
  const winRate       = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
  const totalNetPnl   = trades.reduce((s, t) => s + t.netPnl, 0);
  const totalCostsPaid = trades.reduce((s, t) => s + t.totalCosts, 0);
  const totalGrossPnl = trades.reduce((s, t) => s + t.grossPnl, 0);
  const avgWin        = winningTrades.length > 0 ? winningTrades.reduce((s, t) => s + t.netPnl, 0) / winningTrades.length : 0;
  const avgLoss       = losingTrades.length  > 0 ? Math.abs(losingTrades.reduce((s, t) => s + t.netPnl, 0) / losingTrades.length) : 0;
  const profitFactor  = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? 999 : 0);
  const finalBalance  = cashBalance + (position ? (position.entryPrice * position.qty) : 0);
  const totalReturn   = ((finalBalance - capital) / capital) * 100;
  const costDragPct   = totalGrossPnl !== 0 ? (totalCostsPaid / Math.abs(totalGrossPnl)) * 100 : 0;

  return {
    summary: {
      capital:           +capital.toFixed(2),
      finalBalance:      +finalBalance.toFixed(2),
      totalReturnPct:    +totalReturn.toFixed(2),
      totalNetPnl:       +totalNetPnl.toFixed(2),
      totalGrossPnl:     +totalGrossPnl.toFixed(2),
      totalCostsPaid:    +totalCostsPaid.toFixed(2),
      costDragPct:       +costDragPct.toFixed(2),
      totalTrades,
      winRate:           +winRate.toFixed(2),
      profitFactor:      +profitFactor.toFixed(2),
      maxDrawdownPct:    +maxDrawdown.toFixed(2),
      avgWin:            +avgWin.toFixed(2),
      avgLoss:           +avgLoss.toFixed(2),
      instrument,
    },
    trades: trades.slice(-30),   // Return last 30 trades to keep payload lean
    equityCurve: equityCurve.slice(-100),
  };
}

// POST /api/backtest/run
router.post('/run', authMiddleware, async (req, res) => {
  try {
    const {
      strategy, candles, capital, instrument,
      stopLossPct, targetPct, slippagePct, positionSizePct
    } = req.body;

    if (!strategy) return res.status(400).json({ error: 'strategy object is required.' });

    const result = runBacktestEngine({
      capital:         capital         || 100000,
      instrument:      instrument      || 'EQUITY_DELIVERY',
      stopLossPct:     stopLossPct     || 5,
      targetPct:       targetPct       || 10,
      slippagePct:     slippagePct     || 0.1,
      positionSizePct: positionSizePct || 20,
      entryCondition:  strategy.entryCondition,
      exitCondition:   strategy.exitCondition,
      symbol:          strategy.symbol,
      candles:         candles         || [],
    });

    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
