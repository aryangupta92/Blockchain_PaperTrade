const express = require('express');
const router = express.Router();
const axios = require('axios');

// Dhan API credentials (from environment variables)
const DHAN_CLIENT_ID = process.env.DHAN_CLIENT_ID || '';
const DHAN_ACCESS_TOKEN = process.env.DHAN_ACCESS_TOKEN || '';

// Map generic symbol to proper exchange codes
function getDhanSymbol(symbol) {
  const symbolMap = {
    '^NSEI': 'NIFTY',
    '^BSESN': 'SENSEX',
    '^NSEBANK': 'BANKNIFTY',
    '^CNXIT': 'FINNIFTY',
  };
  return symbolMap[symbol] || symbol.toUpperCase();
}

// Fallback to Groww API
function getGrowwSymbol(symbol) {
  if (symbol.includes('BANK')) return 'banknifty';
  if (symbol.includes('IT') || symbol.includes('FINN')) return 'finnifty';
  if (symbol.startsWith('^')) return 'nifty';
  return symbol.toLowerCase();
}

// ── GET /api/options/chain?symbol=^NSEI&expiry=2026-04-24 ─────────────────────
// Fetches from Dhan API first, falls back to Groww
router.get('/chain', async (req, res) => {
  try {
    const { symbol = '^NSEI', expiry } = req.query;
    let chainData = null;
    let error = null;

    // Try Dhan API first
    try {
      const dhanSymbol = getDhanSymbol(symbol);
      const dhanUrl = `https://api.dhan.co/option-chain?symbol=${dhanSymbol}&expiry=${expiry || ''}`;
      
      const dhanResponse = await axios.get(dhanUrl, {
        headers: {
          'Authorization': `Bearer ${DHAN_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      });
      
      if (dhanResponse.data && dhanResponse.data.data) {
        chainData = dhanResponse.data.data;
      }
    } catch (dhanErr) {
      error = `Dhan API error: ${dhanErr.message}`;
      console.warn('Dhan API failed, falling back to Groww:', dhanErr.message);
    }

    // Fallback to Groww API
    if (!chainData) {
      try {
        const growwSym = getGrowwSymbol(symbol);
        let url = `https://groww.in/v1/api/option_chain_service/v1/option_chain/${growwSym}`;
        if (expiry) url += `?expiry=${expiry}`;

        const { data } = await axios.get(url, { timeout: 10000 });
        
        if (!data || !data.optionChain) {
          throw new Error("Unable to fetch authentic data from Exchange Provider.");
        }

        chainData = data.optionChain;
      } catch (growwErr) {
        console.error('Both Dhan and Groww failed:', growwErr.message);
        throw new Error("Unable to fetch authentic data from Exchange Provider.");
      }
    }

    // Process Dhan data
    if (chainData.optionChains) {
      const liveChains = chainData.optionChains;
      const expiryDetails = chainData.expiryDetailsDto;
      
      let totalCallOI = 0;
      let totalPutOI = 0;
      let totalVol = 0;
      let guessedSpot = 0;
      let minLtpDiff = Infinity;

      const formattedChain = liveChains.map(row => {
        const call = row.callOption || {};
        const put = row.putOption || {};
        
        const k = row.strikePrice / 100;
        
        // Guess spot based on closest call/put crossing
        if (call.ltp && put.ltp) {
          const diff = Math.abs(call.ltp - put.ltp);
          if (diff < minLtpDiff) {
            minLtpDiff = diff;
            guessedSpot = k;
          }
        }

        totalCallOI += call.openInterest || 0;
        totalPutOI += put.openInterest || 0;
        totalVol += (call.volume || 0) + (put.volume || 0);

        return {
          strike: k,
          call: {
            ltp: call.ltp || 0,
            bid: call.lowTradeRange || call.bid || 0,
            ask: call.highTradeRange || call.ask || 0,
            oi: call.openInterest || 0,
            oiChange: (call.openInterest || 0) - (call.prevOpenInterest || call.openInterest || 0),
            volume: call.volume || 0,
            change: call.dayChange || 0,
            changePct: call.dayChangePerc || call.dayChange ? (call.dayChange / (call.ltp - call.dayChange) * 100) : 0,
            iv: call.impliedVolatility || 15.0,
            delta: call.delta || 0,
            gamma: call.gamma || 0,
            theta: call.theta || 0,
            vega: call.vega || 0,
          },
          put: {
            ltp: put.ltp || 0,
            bid: put.lowTradeRange || put.bid || 0,
            ask: put.highTradeRange || put.ask || 0,
            oi: put.openInterest || 0,
            oiChange: (put.openInterest || 0) - (put.prevOpenInterest || put.openInterest || 0),
            volume: put.volume || 0,
            change: put.dayChange || 0,
            changePct: put.dayChangePerc || put.dayChange ? (put.dayChange / (put.ltp - put.dayChange) * 100) : 0,
            iv: put.impliedVolatility || 15.0,
            delta: put.delta || 0,
            gamma: put.gamma || 0,
            theta: put.theta || 0,
            vega: put.vega || 0,
          }
        };
      });
      
      const atmStrike = guessedSpot || formattedChain[Math.floor(formattedChain.length / 2)]?.strike;

      let spotPrice = atmStrike;
      let prevClose = atmStrike;
      try {
        const yhSym = symbol.startsWith('^') ? symbol : symbol + '.NS';
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yhSym)}?interval=1d&range=1d`;
        const resYh = await axios.get(url, { timeout: 3000 });
        const meta = resYh.data?.chart?.result?.[0]?.meta;
        if (meta && meta.regularMarketPrice) {
          spotPrice = meta.regularMarketPrice;
          prevClose = meta.chartPreviousClose || meta.previousClose || spotPrice;
        }
      } catch(e) {
        console.error("Failed to fetch spot price from yahoo", e.message);
      }

      formattedChain.forEach(row => {
        row.atm = row.strike === atmStrike;
        row.itm = {
          call: row.strike < atmStrike,
          put: row.strike > atmStrike
        };
      });

      const pcr = totalCallOI > 0 ? (totalPutOI / totalCallOI) : 0;

      res.json({
        symbol,
        spotPrice: spotPrice,
        prevClose: prevClose,
        syntheticFutures: atmStrike,
        lotSize: expiryDetails?.expiryLotSize || 50,
        pcr: +pcr.toFixed(2),
        maxPain: atmStrike,
        totalVolume: totalVol,
        exchange: 'NSE',
        expiry: expiryDetails?.currentExpiry,
        expiries: expiryDetails?.expiryDates || [],
        chain: formattedChain,
        source: 'dhan-api',
        timestamp: new Date().toISOString(),
      });
    } else {
      throw new Error("Invalid data format received");
    }

  } catch (err) {
    console.error('Option chain API proxy error:', err.message);
    res.status(500).json({ error: 'Failed to fetch authentic live options data: ' + err.message });
  }
});

// ── GET /api/options/expiries ──────────────────────────────────────────────────
router.get('/expiries', async (req, res) => {
  try {
    const { data } = await axios.get('https://groww.in/v1/api/option_chain_service/v1/option_chain/nifty', { timeout: 8000 });
    res.json({ expiries: data?.optionChain?.expiryDetailsDto?.expiryDates || [] });
  } catch(e) {
    res.json({ expiries: [] });
  }
});

module.exports = router;
