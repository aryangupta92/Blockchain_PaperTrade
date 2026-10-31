'use strict';
/**
 * options.js — High-Performance Options Chain & Greeks Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides sub-second option chain generation using the Black-Scholes-Merton model,
 * real volatility surfaces, Greeks (Delta, Gamma, Theta, Vega, Rho), Max Pain, PCR,
 * and Dhan API fallback when credentials are provided.
 */

const express = require('express');
const router  = express.Router();
const { getQuote, computeFOQuote } = require('../services/marketDataProvider');
const { calculateGreeks, blackScholes } = require('../services/optionsEngine');
const { getSpec, underlyingOf, expiriesFor } = require('../services/foMaster');
const { fetchRealChain, isoExpiry } = require('../services/optionChainService');

const RISK_FREE_RATE = 0.065; // 6.5%

function calculateTimeToMaturity(expiryStr) {
  if (!expiryStr) return 0.02;
  try {
    const expiryDate = new Date(expiryStr);
    expiryDate.setHours(15, 30, 0, 0);
    let ms = expiryDate.getTime() - Date.now();
    if (ms <= 0) return 0.001;
    return ms / (1000 * 60 * 60 * 24 * 365);
  } catch {
    return 0.02;
  }
}

// ── GET /api/options/chain ────────────────────────────────────────────────────
router.get('/chain', async (req, res) => {
  try {
    const { symbol = '^NSEI', expiry } = req.query;
    const underlying = underlyingOf(symbol) || 'NIFTY';
    const spec = getSpec(underlying) || { lot: 65, step: 50, exchange: 'NSE' };
    const lotSize = spec.lot;
    const step = spec.step;

    // 1. Resolve expiries (used by both real and model paths)
    const expList = expiriesFor(underlying, 8);
    const selectedExpiryObj = expiry
      ? expList.find(e => e.iso === expiry || e.code === expiry) || expList[0]
      : expList[0];
    const currentExpiryIso = isoExpiry(expiry) || selectedExpiryObj?.iso
      || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    // 2. Prefer real exchange data: Dhan live chain, then NSE public chain.
    const realChain = await fetchRealChain(underlying, currentExpiryIso);
    if (realChain) {
      const expiries = realChain.expiries?.length ? realChain.expiries : expList.map((e) => e.iso);
      const expiryCodes = expiries.map(
        (iso) => expList.find((e) => e.iso === iso)?.code || iso
      );
      return res.json({
        ...realChain,
        symbol,
        underlying,
        lotSize,
        step,
        expiries,
        expiryCodes,
      });
    }

    // 3. Model fallback requires a real underlying price - never invent a spot.
    const spotQuote = await getQuote(symbol).catch(() => null);
    const spotPrice = spotQuote?.price;
    if (!spotPrice) {
      return res.status(503).json({
        error: `No live ${underlying} price available for model fallback.`,
        symbol,
        underlying,
        source: 'UNAVAILABLE',
        estimated: true,
        chain: [],
      });
    }
    const T = Math.max(0.001, calculateTimeToMaturity(currentExpiryIso));

    // 4. Model fallback - deterministic, clearly marked estimated.
    const atmStrike = Math.round(spotPrice / step) * step;
    const STRIKE_COUNT_EACH_SIDE = 15; // 31 strikes total

    let totalCallOI = 0;
    let totalPutOI  = 0;
    let totalVolume = 0;

    const strikes = [];
    for (let i = -STRIKE_COUNT_EACH_SIDE; i <= STRIKE_COUNT_EACH_SIDE; i++) {
      strikes.push(atmStrike + i * step);
    }

    const chain = strikes.map(k => {
      const moneyness = spotPrice / k;
      // Realistically skewed Volatility Smile
      const baseIV = 0.135 + Math.abs(Math.log(moneyness)) * 0.42 + Math.sqrt(T) * 0.12;
      const iv = Math.min(0.70, Math.max(0.08, baseIV));

      // Premiums
      const callBS = blackScholes(spotPrice, k, T, RISK_FREE_RATE, iv, 'CE');
      const putBS  = blackScholes(spotPrice, k, T, RISK_FREE_RATE, iv, 'PE');
      const callLtp = +Math.max(0.05, callBS).toFixed(2);
      const putLtp  = +Math.max(0.05, putBS).toFixed(2);

      // Greeks
      const callGreeks = calculateGreeks(spotPrice, k, T, RISK_FREE_RATE, iv, 'CE');
      const putGreeks  = calculateGreeks(spotPrice, k, T, RISK_FREE_RATE, iv, 'PE');

      // Spreads
      const callSpread = Math.max(0.05, +(callLtp * 0.004).toFixed(2));
      const putSpread  = Math.max(0.05, +(putLtp * 0.004).toFixed(2));

      // Realistic OI Distribution (peaks around round strikes & near ATM)
      const distWeight = Math.exp(-Math.pow((k - spotPrice) / (step * 8), 2));
      const isRoundStrike = k % (step * 5) === 0 ? 1.8 : 1.0;
      const callOI = Math.floor((35000 + distWeight * 120000 * (k >= spotPrice ? 1.4 : 0.6)) * isRoundStrike);
      const putOI  = Math.floor((35000 + distWeight * 120000 * (k <= spotPrice ? 1.4 : 0.6)) * isRoundStrike);
      const mix = Math.abs(Math.sin(k * 0.017 + spotPrice * 0.001));
      const callVol = Math.floor(callOI * (0.15 + mix * 0.1));
      const putVol  = Math.floor(putOI * (0.18 - mix * 0.06));

      totalCallOI += callOI;
      totalPutOI  += putOI;
      totalVolume += (callVol + putVol);

      const callPrev = +(callLtp * 0.985).toFixed(2);
      const putPrev  = +(putLtp * 0.985).toFixed(2);
      const callOiChange = Math.floor((mix - 0.5) * 8000);
      const putOiChange = -Math.floor((mix - 0.5) * 6500);

      return {
        strike: k,
        call: {
          ltp:       callLtp,
          bid:       +(callLtp - callSpread).toFixed(2),
          ask:       +(callLtp + callSpread).toFixed(2),
          change:    +(callLtp - callPrev).toFixed(2),
          changePct: callPrev ? +(((callLtp - callPrev) / callPrev) * 100).toFixed(2) : 0,
          volume:    callVol,
          oi:        callOI,
          oiChange:  callOiChange,
          iv:        +(iv * 100).toFixed(2),
          ...callGreeks,
        },
        put: {
          ltp:       putLtp,
          bid:       +(putLtp - putSpread).toFixed(2),
          ask:       +(putLtp + putSpread).toFixed(2),
          change:    +(putLtp - putPrev).toFixed(2),
          changePct: putPrev ? +(((putLtp - putPrev) / putPrev) * 100).toFixed(2) : 0,
          volume:    putVol,
          oi:        putOI,
          oiChange:  putOiChange,
          iv:        +(iv * 100).toFixed(2),
          ...putGreeks,
        },
        atm: Math.abs(k - spotPrice) < step / 2,
        itm: {
          call: k < spotPrice,
          put:  k > spotPrice,
        },
      };
    });

    // 5. PCR & Max Pain Calculation
    const pcr = totalCallOI > 0 ? +(totalPutOI / totalCallOI).toFixed(2) : 1.0;
    let minPainLoss = Infinity;
    let maxPain = atmStrike;

    chain.forEach(row => {
      let pain = 0;
      chain.forEach(item => {
        if (item.strike < row.strike) pain += item.call.oi * (row.strike - item.strike);
        if (item.strike > row.strike) pain += item.put.oi * (item.strike - row.strike);
      });
      if (pain < minPainLoss) {
        minPainLoss = pain;
        maxPain = row.strike;
      }
    });

    const payload = {
      symbol,
      underlying,
      spotPrice,
      prevClose:   spotQuote?.prevClose || spotPrice,
      lotSize,
      step,
      pcr,
      maxPain,
      totalVolume,
      totalCallOI,
      totalPutOI,
      exchange:    spec.exchange,
      expiry:      currentExpiryIso,
      expiries:    expList.map(e => e.iso),
      expiryCodes: expList.map(e => e.code),
      chain,
      source:      'BLACK-SCHOLES-ESTIMATE',
      estimated:   true,
      notice:      'Model-generated premiums, OI and volume. Not exchange data.',
      timestamp:   new Date().toISOString(),
    };

    res.json(payload);
  } catch (err) {
    console.error('Option chain error:', err);
    res.status(500).json({ error: 'Failed to generate option chain', details: err.message });
  }
});

// ── GET /api/options/quote ────────────────────────────────────────────────────
router.get('/quote', async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol query parameter required' });

    const quote = computeFOQuote(symbol);
    if (!quote) return res.status(404).json({ error: 'Could not parse F&O contract: ' + symbol });

    res.json({ success: true, data: quote, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
