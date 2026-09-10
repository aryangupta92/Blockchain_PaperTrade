'use strict';
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { fetchQuoteSingle, toYahoo } = require('../services/marketDataService');
const { calculateGreeks, calculateIV } = require('../services/optionsEngine');

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  'Accept': 'application/json',
};

const DHAN_CLIENT_ID = process.env.DHAN_CLIENT_ID || '';
const DHAN_ACCESS_TOKEN = process.env.DHAN_ACCESS_TOKEN || '';

function getDhanSymbol(symbol) {
  const symbolMap = { '^NSEI': 'NIFTY', '^BSESN': 'SENSEX', '^NSEBANK': 'BANKNIFTY', '^CNXIT': 'FINNIFTY' };
  return symbolMap[symbol] || symbol.toUpperCase();
}

function getGrowwSymbol(symbol) {
  if (symbol.includes('BANK')) return 'banknifty';
  if (symbol.includes('IT') || symbol.includes('FINN')) return 'finnifty';
  if (symbol.startsWith('^')) return 'nifty';
  return symbol.toLowerCase();
}

function calculateTimeToMaturity(expiryStr) {
  if (!expiryStr) return 0;
  const expiryDate = new Date(expiryStr);
  expiryDate.setHours(15, 30, 0, 0);
  let ms = expiryDate.getTime() - Date.now();
  if (ms < 0) ms = 0;
  return ms / (1000 * 60 * 60 * 24 * 365); // in years
}

router.get('/chain', async (req, res) => {
  try {
    const { symbol = '^NSEI', expiry } = req.query;
    let chainData = null;
    let error = null;

    try {
      const dhanSymbol = getDhanSymbol(symbol);
      const dhanUrl = `https://api.dhan.co/option-chain?symbol=${dhanSymbol}&expiry=${expiry || ''}`;
      const dhanResponse = await axios.get(dhanUrl, {
        headers: { 'Authorization': `Bearer ${DHAN_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        timeout: 8000
      });
      if (dhanResponse.data && dhanResponse.data.data) chainData = dhanResponse.data.data;
    } catch (dhanErr) {
      console.warn('Dhan API failed, falling back to Groww:', dhanErr.message);
    }

    if (!chainData) {
      try {
        const growwSym = getGrowwSymbol(symbol);
        const growwUrls = [
          `https://groww.in/v1/api/option_chain_service/v2/option_chain/index/${growwSym}`,
          `https://groww.in/v1/api/option_chain_service/v1/option_chain/${growwSym}`,
        ];
        for (const url of growwUrls) {
          try {
            const fullUrl = expiry ? `${url}?expiry=${expiry}` : url;
            const { data } = await axios.get(fullUrl, { timeout: 8000 });
            if (data && (data.optionChain || data.data)) {
              chainData = data.optionChain || data.data;
              break;
            }
          } catch (_) { }
        }
      } catch (growwErr) {
        console.warn('Groww API failed:', growwErr.message);
      }
    }

    const r = 0.05; // 5% risk free rate assumed for India

    if (!chainData) {
      try {
        const yhSym = toYahoo(symbol);
        const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(yhSym)}`;
        const { data } = await axios.get(url, { headers: YF_HEADERS, timeout: 10000 });
        const optionResult = data?.optionChain?.result?.[0];
        if (!optionResult) throw new Error('No Yahoo options data');

        const spotPrice = optionResult.quote?.regularMarketPrice || 0;
        const expiryTs  = optionResult.expirationDates || [];
        const options   = optionResult.options?.[0] || {};
        const calls     = options.calls  || [];
        const puts      = options.puts   || [];

        const t = calculateTimeToMaturity(options.expirationDate ? new Date(options.expirationDate * 1000) : null);

        const strikeMap = {};
        calls.forEach(c => {
          if (!strikeMap[c.strike]) strikeMap[c.strike] = {};
          const iv = c.impliedVolatility || calculateIV(c.lastPrice, spotPrice, c.strike, t, r, 'CE');
          const greeks = calculateGreeks(spotPrice, c.strike, t, r, iv, 'CE');
          
          strikeMap[c.strike].call = {
            ltp: c.lastPrice || 0, bid: c.bid || 0, ask: c.ask || 0,
            oi: c.openInterest || 0, volume: c.volume || 0,
            iv: +(iv * 100).toFixed(2),
            oiChange: 0, change: c.change || 0, changePct: c.percentChange || 0,
            ...greeks
          };
        });
        puts.forEach(p => {
          if (!strikeMap[p.strike]) strikeMap[p.strike] = {};
          const iv = p.impliedVolatility || calculateIV(p.lastPrice, spotPrice, p.strike, t, r, 'PE');
          const greeks = calculateGreeks(spotPrice, p.strike, t, r, iv, 'PE');
          
          strikeMap[p.strike].put = {
            ltp: p.lastPrice || 0, bid: p.bid || 0, ask: p.ask || 0,
            oi: p.openInterest || 0, volume: p.volume || 0,
            iv: +(iv * 100).toFixed(2),
            oiChange: 0, change: p.change || 0, changePct: p.percentChange || 0,
            ...greeks
          };
        });

        const chain = Object.entries(strikeMap)
          .sort(([a], [b]) => +a - +b)
          .map(([strike, sides]) => ({
            strike: +strike,
            call:   sides.call || { ltp:0, bid:0, ask:0, oi:0, volume:0, iv:0, oiChange:0, change:0, changePct:0, delta:0, gamma:0, theta:0, vega:0 },
            put:    sides.put  || { ltp:0, bid:0, ask:0, oi:0, volume:0, iv:0, oiChange:0, change:0, changePct:0, delta:0, gamma:0, theta:0, vega:0 },
            atm:    Math.abs(+strike - spotPrice) === Math.min(...Object.keys(strikeMap).map(s => Math.abs(+s - spotPrice))),
            itm:    { call: +strike < spotPrice, put: +strike > spotPrice },
          }));

        const totalCallOI = calls.reduce((s, c) => s + (c.openInterest || 0), 0);
        const totalPutOI  = puts.reduce((s,  p) => s + (p.openInterest || 0), 0);
        const pcr = totalCallOI > 0 ? +(totalPutOI / totalCallOI).toFixed(2) : 0;

        return res.json({
          symbol,
          spotPrice,
          prevClose:         optionResult.quote?.regularMarketPreviousClose || spotPrice,
          lotSize:           50,
          pcr,
          maxPain:           null,
          totalVolume:       options.calls?.reduce((s,c) => s+(c.volume||0), 0) || 0,
          exchange:          'NSE',
          expiry:            expiryTs[0] ? new Date(expiryTs[0] * 1000).toISOString().split('T')[0] : null,
          expiries:          expiryTs.map(ts => new Date(ts * 1000).toISOString().split('T')[0]),
          chain,
          source:            'yahoo-finance',
          timestamp:         new Date().toISOString(),
        });
      } catch (yfErr) {
        throw new Error('All option chain providers failed');
      }
    }

    if (chainData.optionChains) {
      const liveChains = chainData.optionChains;
      const expiryDetails = chainData.expiryDetailsDto;
      const t = calculateTimeToMaturity(expiryDetails?.currentExpiry);
      
      let totalCallOI = 0, totalPutOI = 0, totalVol = 0;
      let guessedSpot = 0, minLtpDiff = Infinity;

      let formattedChain = liveChains.map(row => {
        const call = row.callOption || {};
        const put = row.putOption || {};
        const k = row.strikePrice / 100;
        
        if (call.ltp && put.ltp) {
          const diff = Math.abs(call.ltp - put.ltp);
          if (diff < minLtpDiff) { minLtpDiff = diff; guessedSpot = k; }
        }

        totalCallOI += call.openInterest || 0;
        totalPutOI += put.openInterest || 0;
        totalVol += (call.volume || 0) + (put.volume || 0);

        return {
          strike: k,
          callRaw: call,
          putRaw: put
        };
      });

      // Calculate Greeks with guessedSpot
      formattedChain = formattedChain.map(row => {
        const k = row.strike;
        const call = row.callRaw;
        const put = row.putRaw;

        const callIV = call.impliedVolatility || calculateIV(call.ltp || 0, guessedSpot, k, t, r, 'CE');
        const putIV = put.impliedVolatility || calculateIV(put.ltp || 0, guessedSpot, k, t, r, 'PE');

        const callGreeks = calculateGreeks(guessedSpot, k, t, r, callIV, 'CE');
        const putGreeks = calculateGreeks(guessedSpot, k, t, r, putIV, 'PE');

        return {
          strike: k,
          call: {
            ltp: call.ltp || 0, bid: call.lowTradeRange || call.bid || 0, ask: call.highTradeRange || call.ask || 0,
            oi: call.openInterest || 0, oiChange: (call.openInterest || 0) - (call.prevOpenInterest || call.openInterest || 0),
            volume: call.volume || 0, change: call.dayChange || 0, changePct: call.dayChangePercent || 0,
            iv: +(callIV * 100).toFixed(2), ...callGreeks
          },
          put: {
            ltp: put.ltp || 0, bid: put.lowTradeRange || put.bid || 0, ask: put.highTradeRange || put.ask || 0,
            oi: put.openInterest || 0, oiChange: (put.openInterest || 0) - (put.prevOpenInterest || put.openInterest || 0),
            volume: put.volume || 0, change: put.dayChange || 0, changePct: put.dayChangePercent || 0,
            iv: +(putIV * 100).toFixed(2), ...putGreeks
          },
          atm: k === guessedSpot,
          itm: { call: k < guessedSpot, put: k > guessedSpot },
        };
      });

      const pcr = totalCallOI > 0 ? +(totalPutOI / totalCallOI).toFixed(2) : 0;
      let maxPain = null;
      let minPainVal = Infinity;
      formattedChain.forEach(row => {
        let pain = 0;
        formattedChain.forEach(opt => {
          if (opt.strike < row.strike) pain += opt.call.oi * (row.strike - opt.strike);
          if (opt.strike > row.strike) pain += opt.put.oi * (opt.strike - row.strike);
        });
        if (pain < minPainVal) { minPainVal = pain; maxPain = row.strike; }
      });

      return res.json({
        symbol, spotPrice: guessedSpot, prevClose: guessedSpot, lotSize: 50, pcr, maxPain, totalVolume: totalVol,
        exchange: 'NSE', expiry: expiryDetails?.currentExpiry, expiries: expiryDetails?.expiries || [],
        chain: formattedChain, source: 'dhan', timestamp: new Date().toISOString(),
      });
    }
    
    // Groww format parsing logic (simplified fallback)
    if (chainData.records) {
      const records = chainData.records;
      const spotPrice = chainData.underlyingValue;
      const t = calculateTimeToMaturity(expiry);
      
      const chain = records.map(r => {
        const callIV = r.CE?.impliedVolatility || calculateIV(r.CE?.lastPrice || 0, spotPrice, r.strikePrice, t, r, 'CE');
        const putIV = r.PE?.impliedVolatility || calculateIV(r.PE?.lastPrice || 0, spotPrice, r.strikePrice, t, r, 'PE');
        const callGreeks = calculateGreeks(spotPrice, r.strikePrice, t, r, callIV, 'CE');
        const putGreeks = calculateGreeks(spotPrice, r.strikePrice, t, r, putIV, 'PE');
        
        return {
          strike: r.strikePrice,
          call: {
            ltp: r.CE?.lastPrice || 0, oi: r.CE?.openInterest || 0, oiChange: r.CE?.changeinOpenInterest || 0, volume: r.CE?.totalTradedVolume || 0,
            iv: +(callIV * 100).toFixed(2), change: r.CE?.change || 0, changePct: r.CE?.pChange || 0, bid: 0, ask: 0, ...callGreeks
          },
          put: {
            ltp: r.PE?.lastPrice || 0, oi: r.PE?.openInterest || 0, oiChange: r.PE?.changeinOpenInterest || 0, volume: r.PE?.totalTradedVolume || 0,
            iv: +(putIV * 100).toFixed(2), change: r.PE?.change || 0, changePct: r.PE?.pChange || 0, bid: 0, ask: 0, ...putGreeks
          },
          atm: Math.abs(r.strikePrice - spotPrice) < 50,
          itm: { call: r.strikePrice < spotPrice, put: r.strikePrice > spotPrice }
        };
      });

      const totalCallOI = records.reduce((s, r) => s + (r.CE?.openInterest || 0), 0);
      const totalPutOI = records.reduce((s, r) => s + (r.PE?.openInterest || 0), 0);
      const pcr = totalCallOI > 0 ? +(totalPutOI / totalCallOI).toFixed(2) : 0;
      
      return res.json({
        symbol, spotPrice, prevClose: spotPrice, lotSize: 50, pcr, maxPain: null, totalVolume: 0,
        exchange: 'NSE', expiry, expiries: [], chain, source: 'groww', timestamp: new Date().toISOString()
      });
    }

    throw new Error('Unsupported format');
  } catch (err) {
    res.status(503).json({ error: 'Failed to fetch options chain data', details: err.message });
  }
});

module.exports = router;
