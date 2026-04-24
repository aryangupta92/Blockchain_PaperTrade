const express = require('express');
const router = express.Router();
const axios = require('axios');

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Map internal symbol to Yahoo Finance
function toYahoo(symbol) {
  if (symbol.startsWith('^')) return symbol;
  if (symbol.endsWith('.NS') || symbol.endsWith('.BO')) return symbol;
  return symbol + '.NS';
}

// Single quote via v8 chart endpoint (most reliable, works without auth)
async function fetchQuoteSingle(yahooSymbol) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`;
  const res = await axios.get(url, { headers: YF_HEADERS, timeout: 8000 });
  const meta = res.data?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  return {
    yahooSymbol,
    shortName: meta.shortName || yahooSymbol,
    price: meta.regularMarketPrice || 0,
    change: meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose) || 0,
    changePercent: ((meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose)) / (meta.chartPreviousClose || meta.previousClose)) * 100 || 0,
    volume: meta.regularMarketVolume || 0,
    previousClose: meta.chartPreviousClose || meta.previousClose || 0,
  };
}

// ─── GET /api/market/quotes ───────────────────────────────────────────────────
router.get('/quotes', async (req, res) => {
  try {
    const raw = req.query.symbols || '^NSEI,^BSESN,^NSEBANK';
    const symbols = raw.split(',').map(s => s.trim()).filter(Boolean);
    const yahooSymbols = symbols.map(toYahoo);

    const batchSize = 8;
    const allData = [];
    for (let i = 0; i < yahooSymbols.length; i += batchSize) {
      const batch = yahooSymbols.slice(i, i + batchSize);
      const batchSymbols = symbols.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map(fetchQuoteSingle));
      results.forEach((r, j) => {
        if (r.status === 'fulfilled' && r.value) {
          allData.push({
            symbol: batchSymbols[j],
            yahooSymbol: batch[j],
            ...r.value,
          });
        }
      });
      if (i + batchSize < yahooSymbols.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
    
    if (allData.length === 0) {
        throw new Error("Authentic Market Data Source is currently unreachable.");
    }

    res.json({ data: allData, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Quotes error:', err.message);
    res.status(503).json({ error: "Failed to fetch live authentic market data.", data: [] });
  }
});

// ─── GET /api/market/candles ─────────────────────────────────────────────────
const RANGE_INTERVAL_MAP = {
  '1d': '1m', '5d': '15m', '1mo': '1h',
  '3mo': '1d', '6mo': '1d', '1y': '1wk',
  '2y': '1wk', '5y': '1mo', 'max': '1mo',
};

router.get('/candles', async (req, res) => {
  try {
    let { symbol = '^NSEI', range = '5d', interval } = req.query;
    const yahooSym = toYahoo(symbol);

    if (!interval || interval === 'auto') {
      interval = RANGE_INTERVAL_MAP[range] || '1d';
    }
    const safeInterval = sanitizeInterval(interval);

    let url;
    if (range === 'max') {
      url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=${safeInterval}&range=max`;
    } else {
      url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=${safeInterval}&range=${range}`;
    }

    const response = await axios.get(url, { headers: YF_HEADERS, timeout: 20000 });
    const result = response.data?.chart?.result?.[0];
    if (!result) throw new Error('No authentic chart data returned from provider');

    const timestamps = result.timestamp || [];
    const ohlcv = result.indicators?.quote?.[0] || {};
    const meta = result.meta || {};

    const data = timestamps
      .map((t, i) => ({
        time: t,
        open:   parseFloat(((ohlcv.open   || [])[i] || 0).toFixed(2)),
        high:   parseFloat(((ohlcv.high   || [])[i] || 0).toFixed(2)),
        low:    parseFloat(((ohlcv.low    || [])[i] || 0).toFixed(2)),
        close:  parseFloat(((ohlcv.close  || [])[i] || 0).toFixed(2)),
        volume: (ohlcv.volume || [])[i] || 0,
      }))
      .filter(d => d.open > 0 && d.close > 0 && d.time > 0);

    res.json({
      data,
      symbol: yahooSym,
      range,
      interval: safeInterval,
      meta: {
        currency: meta.currency,
        exchangeName: meta.exchangeName,
        firstTradeDate: meta.firstTradeDate,
        regularMarketPrice: meta.regularMarketPrice,
        previousClose: meta.previousClose,
      }
    });
  } catch (err) {
    console.error('Candles error:', err.message);
    res.status(503).json({ error: "Authentic historical charting data unavailable: " + err.message, data: [] });
  }
});

// ─── GET /api/market/movers ───────────────────────────────────────────────────
router.get('/movers', async (req, res) => {
  try {
    const nifty25 = [
      'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
      'HINDUNILVR', 'SBIN', 'BAJFINANCE', 'BHARTIARTL', 'WIPRO',
      'AXISBANK', 'KOTAKBANK', 'LT', 'ASIANPAINT', 'MARUTI',
      'SUNPHARMA', 'TITAN', 'NTPC', 'TECHM', 'HCLTECH',
      'ONGC', 'COALINDIA', 'JSWSTEEL', 'POWERGRID', 'ULTRACEMCO',
    ];

    const yahooSyms = nifty25.map(s => s + '.NS');
    const results = await Promise.allSettled(yahooSyms.map(fetchQuoteSingle));

    const stocks = results
      .map((r, i) => {
        if (r.status !== 'fulfilled' || !r.value) return null;
        return {
          symbol: nifty25[i],
          shortName: r.value.shortName || nifty25[i],
          price: r.value.price,
          change: r.value.change,
          changePercent: r.value.changePercent,
          volume: r.value.volume,
        };
      })
      .filter(Boolean);
      
    if (stocks.length === 0) throw new Error("Movers data fetch failed");

    const gainers = [...stocks].sort((a, b) => b.changePercent - a.changePercent).slice(0, 8);
    const losers = [...stocks].sort((a, b) => a.changePercent - b.changePercent).slice(0, 8);
    const active = [...stocks].sort((a, b) => b.volume - a.volume).slice(0, 8);

    res.json({ gainers, losers, active, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Movers error:', err.message);
    res.status(503).json({ gainers: [], losers: [], active: [], error: err.message });
  }
});

// ─── GET /api/market/search ────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ results: [] });
    
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&enableFuzzyQuery=true`;
    const response = await axios.get(url, { headers: YF_HEADERS, timeout: 10000 });
    
    // Filter to prioritize Indian exchanges (NSE, BSE)
    const rawQuotes = response.data?.quotes || [];
    const results = rawQuotes
        .filter(item => item.quoteType === 'EQUITY' || item.quoteType === 'ETF' || item.quoteType === 'INDEX')
        .map(item => ({
            symbol: item.symbol,
            shortname: item.shortname || item.longname,
            exchange: item.exchDisp || item.exchange,
            type: item.quoteType
        }))
        // Filter out options/currencies and prioritize NSE/BSE
        .filter(item => item.symbol.endsWith('.NS') || item.symbol.endsWith('.BO') || item.symbol.startsWith('^'));

    res.json({ results: results.slice(0, 8), timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(503).json({ results: [], error: err.message });
  }
});

// ─── GET /api/market/news ────────────────────────────────────────────────────
router.get('/news', async (req, res) => {
  try {
    const url = 'https://query2.finance.yahoo.com/v1/finance/search?q=NSE+India+Nifty+stock+market&newsCount=15&enableFuzzyQuery=false&quotesCount=0';
    const response = await axios.get(url, { headers: YF_HEADERS, timeout: 10000 });
    const newsItems = response.data?.news || [];

    const news = newsItems.map(n => ({
      title: n.title,
      publisher: n.publisher,
      link: n.link,
      publishedAt: n.providerPublishTime
        ? new Date(n.providerPublishTime * 1000).toISOString()
        : new Date().toISOString(),
      thumbnail: n.thumbnail?.resolutions?.[0]?.url || null,
    }));

    res.json({ news, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('News error:', err.message);
    res.status(503).json({ news: [], error: err.message });
  }
});

// ─── GET /api/market/fii-dii ─────────────────────────────────────────────────
router.get('/fii-dii', async (req, res) => {
  res.json({
    fii: { buy: 12450.5, sell: 14200.2, net: -1749.7 },
    dii: { buy: 10800.4, sell: 8300.1, net: 2500.3 },
    timestamp: new Date().toISOString()
  });
});

function sanitizeInterval(interval) {
  const valid = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo'];
  return valid.includes(interval) ? interval : '1d';
}

module.exports = router;
