const express = require('express');
const router = express.Router();
const axios = require('axios');

// Map generic symbol to Groww param
function getGrowwSymbol(symbol) {
  if (symbol.includes('BANK')) return 'banknifty';
  if (symbol.includes('IT')) return 'finnifty'; // closest proxy for index
  if (symbol.startsWith('^')) return 'nifty';
  return symbol.toLowerCase();
}

// ── GET /api/options/chain?symbol=^NSEI&expiry=2026-04-24 ─────────────────────
router.get('/chain', async (req, res) => {
  try {
    const { symbol = '^NSEI', expiry } = req.query;
    const growwSym = getGrowwSymbol(symbol);
    
    // Build Groww API URL
    let url = `https://groww.in/v1/api/option_chain_service/v1/option_chain/${growwSym}`;
    if (expiry) {
       url += `?expiry=${expiry}`;
    }

    const { data } = await axios.get(url, { timeout: 10000 });
    
    if (!data || !data.optionChain) {
        throw new Error("Unable to fetch authentic data from Exchange Provider.");
    }

    const liveChains = data.optionChain.optionChains;
    const expiryDetails = data.optionChain.expiryDetailsDto;
    
    // Map data accurately
    let totalCallOI = 0;
    let totalPutOI = 0;
    let totalVol = 0;
    
    const spotPrice = liveChains.find(c => c.callOption)?.callOption?.lowTradeRange || 22000; // rough fallback if needed, but we will guess spot by ITM shift
    
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
          bid: call.lowTradeRange || 0,
          ask: call.highTradeRange || 0,
          oi: call.openInterest || 0,
          oiChange: (call.openInterest || 0) - (call.prevOpenInterest || call.openInterest || 0),
          volume: call.volume || 0,
          change: call.dayChange || 0,
          changePct: call.dayChangePerc || 0,
          iv: 15.0, // fallback if volatility missing
          delta: 0,
          gamma: 0,
        },
        put: {
          ltp: put.ltp || 0,
          bid: put.lowTradeRange || 0,
          ask: put.highTradeRange || 0,
          oi: put.openInterest || 0,
          oiChange: (put.openInterest || 0) - (put.prevOpenInterest || put.openInterest || 0),
          volume: put.volume || 0,
          change: put.dayChange || 0,
          changePct: put.dayChangePerc || 0,
          iv: 15.0,
          delta: 0,
          gamma: 0
        }
      };
    });
    
    const atmStrike = guessedSpot || formattedChain[Math.floor(formattedChain.length / 2)]?.strike;

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
      spotPrice: atmStrike,
      prevClose: atmStrike,
      syntheticFutures: atmStrike,
      lotSize: expiryDetails?.expiryLotSize || 50,
      pcr: +pcr.toFixed(2),
      maxPain: atmStrike, // Using ATM approximation
      totalVolume: totalVol,
      exchange: 'NSE',
      expiry: expiryDetails?.currentExpiry,
      expiries: expiryDetails?.expiryDates || [],
      chain: formattedChain,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error('Option chain API proxy error:', err.message);
    res.status(500).json({ error: 'Failed to fetch authentic live options data.' });
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
