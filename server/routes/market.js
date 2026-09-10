'use strict';
const express = require('express');
const router  = express.Router();
const axios   = require('axios');

const {
  toYahoo,
  sanitizeInterval,
  NIFTY50,
  INDICES,
  SECTORS,
  TTL,
  cacheGet,
  cacheSet,
  fetchQuoteSingle,
  fetchQuotesBatch,
  fetchHistory,
  fetchInrRate,
} = require('../services/marketDataService');

// ─── GET /api/market/quotes ───────────────────────────────────────────────────
// Returns live quotes for a comma-separated list of symbols
// Default: Nifty 50 index + Bank Nifty + Sensex
router.get('/quotes', async (req, res) => {
  try {
    const raw     = req.query.symbols || '^NSEI,^BSESN,^NSEBANK';
    const symbols = raw.split(',').map(s => s.trim()).filter(Boolean);
    const results = [];

    for (const sym of symbols) {
      const cacheKey = `quote:${sym}`;
      let data = cacheGet(cacheKey);
      if (!data) {
        data = await fetchQuoteSingle(toYahoo(sym));
        if (data) cacheSet(cacheKey, data, TTL.quotes);
      }
      if (data) results.push({ symbol: sym, ...data });
    }

    if (results.length === 0) {
      return res.status(503).json({ error: 'Market data source unreachable', data: [] });
    }
    res.json({ data: results, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Quotes error:', err.message);
    res.status(503).json({ error: 'Failed to fetch live market data', data: [] });
  }
});

// ─── GET /api/market/candles ──────────────────────────────────────────────────
// Returns OHLCV candlestick data for charting
router.get('/candles', async (req, res) => {
  try {
    let { symbol = '^NSEI', range = '5d', interval } = req.query;
    const yahooSym  = toYahoo(symbol);
    const cacheKey  = `candles:${yahooSym}:${range}:${interval || 'auto'}`;
    const safeInterval = sanitizeInterval(interval || 'auto');

    let cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const result = await fetchHistory(yahooSym, range, safeInterval === 'auto' ? null : safeInterval);

    const payload = {
      data:     result.data,
      symbol:   yahooSym,
      range,
      interval: result.interval,
      meta: {
        currency:            result.meta?.currency || 'INR',
        exchangeName:        result.meta?.exchangeName || 'NSE',
        firstTradeDate:      result.meta?.firstTradeDate || null,
        regularMarketPrice:  result.meta?.regularMarketPrice || null,
        previousClose:       result.meta?.previousClose || result.meta?.chartPreviousClose || null,
      },
      source:    result.source,
      timestamp: new Date().toISOString(),
    };

    cacheSet(cacheKey, payload, TTL.candles);
    res.json(payload);
  } catch (err) {
    console.error('Candles error:', err.message);
    res.status(503).json({ error: 'Historical chart data unavailable: ' + err.message, data: [] });
  }
});

// ─── GET /api/market/indices ──────────────────────────────────────────────────
// Returns all major Indian market indices in a single call
router.get('/indices', async (req, res) => {
  try {
    const cacheKey = 'indices:all';
    const cached   = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const ySymbols = INDICES.map(i => i.symbol);
    const quotes   = await fetchQuotesBatch(ySymbols, 7, 100);

    const data = quotes.map((q, idx) => {
      const meta = INDICES.find(i => i.symbol === q.yahooSymbol) || INDICES[idx] || {};
      return {
        symbol:       meta.symbol,
        name:         meta.name,
        shortName:    meta.shortName,
        price:        q.price,
        change:       +(q.change || 0).toFixed(2),
        changePercent:+(q.changePercent || 0).toFixed(2),
        previousClose:q.previousClose,
        source:       q.source,
      };
    });

    const payload = { data, timestamp: new Date().toISOString() };
    cacheSet(cacheKey, payload, TTL.indices);
    res.json(payload);
  } catch (err) {
    console.error('Indices error:', err.message);
    res.status(503).json({ error: 'Indices data unavailable: ' + err.message, data: [] });
  }
});

// ─── GET /api/market/movers ───────────────────────────────────────────────────
// Returns top gainers, losers, and most active from full Nifty 50
router.get('/movers', async (req, res) => {
  try {
    const cacheKey = 'movers:nifty50';
    const cached   = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const yahooSyms = NIFTY50.map(s => s + '.NS');
    const quotes    = await fetchQuotesBatch(yahooSyms, 10, 200);

    const stocks = quotes.map((q, i) => ({
      symbol:        NIFTY50[i] || q.inputSymbol?.replace('.NS', ''),
      shortName:     q.shortName || q.inputSymbol,
      price:         q.price,
      change:        +(q.change || 0).toFixed(2),
      changePercent: +(q.changePercent || 0).toFixed(2),
      volume:        q.volume || 0,
      previousClose: q.previousClose,
    })).filter(s => s.price > 0);

    if (stocks.length === 0) throw new Error('Movers data fetch failed for all symbols');

    const gainers = [...stocks].sort((a, b) => b.changePercent - a.changePercent).slice(0, 10);
    const losers  = [...stocks].sort((a, b) => a.changePercent - b.changePercent).slice(0, 10);
    const active  = [...stocks].sort((a, b) => b.volume - a.volume).slice(0, 10);

    const payload = { gainers, losers, active, total: stocks.length, timestamp: new Date().toISOString() };
    cacheSet(cacheKey, payload, TTL.movers);
    res.json(payload);
  } catch (err) {
    console.error('Movers error:', err.message);
    res.status(503).json({ gainers: [], losers: [], active: [], error: err.message });
  }
});

// ─── GET /api/market/top-stocks ───────────────────────────────────────────────
// Returns all Nifty 50 stocks with live prices (full list for watchlist / portfolio)
router.get('/top-stocks', async (req, res) => {
  try {
    const cacheKey = 'top-stocks:nifty50';
    const cached   = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const yahooSyms = NIFTY50.map(s => s + '.NS');
    const quotes    = await fetchQuotesBatch(yahooSyms, 10, 150);

    const data = quotes.map((q, i) => ({
      symbol:        NIFTY50[i] || q.inputSymbol?.replace('.NS', ''),
      yahooSymbol:   q.yahooSymbol,
      shortName:     q.shortName || q.yahooSymbol,
      price:         q.price,
      change:        +(q.change || 0).toFixed(2),
      changePercent: +(q.changePercent || 0).toFixed(2),
      volume:        q.volume || 0,
      previousClose: q.previousClose,
      marketCap:     q.marketCap || null,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh || null,
      fiftyTwoWeekLow:  q.fiftyTwoWeekLow  || null,
      currency:      q.currency || 'INR',
      source:        q.source,
    })).filter(s => s.price > 0);

    const payload = { data, count: data.length, timestamp: new Date().toISOString() };
    cacheSet(cacheKey, payload, TTL.quotes);
    res.json(payload);
  } catch (err) {
    console.error('Top stocks error:', err.message);
    res.status(503).json({ data: [], error: err.message });
  }
});

// ─── GET /api/market/sectors ──────────────────────────────────────────────────
// Returns sector-wise average performance across Nifty sectors
router.get('/sectors', async (req, res) => {
  try {
    const cacheKey = 'sectors:all';
    const cached   = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // Flatten all sector symbols, deduplicate
    const allSymbols = [...new Set(Object.values(SECTORS).flat())];
    const yahooSyms  = allSymbols.map(s => s + '.NS');
    const quotes     = await fetchQuotesBatch(yahooSyms, 10, 150);

    // Build a quick lookup: NSE symbol → quote
    const lookup = {};
    quotes.forEach(q => {
      const nseSym = (q.yahooSymbol || '').replace('.NS', '');
      lookup[nseSym] = q;
    });

    const sectorData = Object.entries(SECTORS).map(([sectorName, stocks]) => {
      const sectorQuotes = stocks.map(s => lookup[s]).filter(Boolean);
      if (sectorQuotes.length === 0) {
        return { sector: sectorName, stocks: [], avgChange: 0, avgChangePercent: 0, advancers: 0, decliners: 0 };
      }
      const totalPct = sectorQuotes.reduce((acc, q) => acc + (q.changePercent || 0), 0);
      const avgPct   = totalPct / sectorQuotes.length;
      const advancers  = sectorQuotes.filter(q => q.changePercent > 0).length;
      const decliners  = sectorQuotes.filter(q => q.changePercent < 0).length;
      return {
        sector:           sectorName,
        avgChangePercent: +avgPct.toFixed(2),
        advancers,
        decliners,
        stocks: sectorQuotes.map(q => ({
          symbol:        (q.yahooSymbol || '').replace('.NS', ''),
          price:         q.price,
          changePercent: +(q.changePercent || 0).toFixed(2),
        })),
      };
    });

    const payload = {
      data:      sectorData.sort((a, b) => b.avgChangePercent - a.avgChangePercent),
      timestamp: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL.sectors);
    res.json(payload);
  } catch (err) {
    console.error('Sectors error:', err.message);
    res.status(503).json({ data: [], error: err.message });
  }
});

// ─── GET /api/market/search ───────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ results: [] });

    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&enableFuzzyQuery=true`;
    const YF_HEADERS = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept': 'application/json',
    };
    const response = await axios.get(url, { headers: YF_HEADERS, timeout: 10000 });

    const rawQuotes = response.data?.quotes || [];
    const results   = rawQuotes
      .filter(item => item.quoteType === 'EQUITY' || item.quoteType === 'ETF' || item.quoteType === 'INDEX')
      .map(item => ({
        symbol:    item.symbol,
        shortname: item.shortname || item.longname,
        exchange:  item.exchDisp || item.exchange,
        type:      item.quoteType,
      }))
      .filter(item => item.symbol.endsWith('.NS') || item.symbol.endsWith('.BO') || item.symbol.startsWith('^'));

    res.json({ results: results.slice(0, 8), timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(503).json({ results: [], error: err.message });
  }
});

// ─── GET /api/market/news ─────────────────────────────────────────────────────
// Multi-source: Yahoo Finance news + RSS feeds (Economic Times, Moneycontrol)
router.get('/news', async (req, res) => {
  try {
    const cacheKey = 'news:indian-market';
    const cached   = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const YF_HEADERS = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept': 'application/json',
    };

    const newsResults = await Promise.allSettled([
      // Source 1: Yahoo Finance India Nifty market news
      axios.get(
        'https://query2.finance.yahoo.com/v1/finance/search?q=Nifty+BSE+NSE+India+stock&newsCount=15&enableFuzzyQuery=false&quotesCount=0',
        { headers: YF_HEADERS, timeout: 10000 }
      ),
      // Source 2: Yahoo Finance - RBI / SEBI / Indian economy news
      axios.get(
        'https://query2.finance.yahoo.com/v1/finance/search?q=RBI+SEBI+India+economy+rupee&newsCount=10&enableFuzzyQuery=false&quotesCount=0',
        { headers: YF_HEADERS, timeout: 10000 }
      ),
      // Source 3: RSS to JSON — Economic Times Markets RSS
      axios.get(
        'https://rss-to-json-serverless-api.vercel.app/rssToJson?rssUrl=https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
        { timeout: 8000 }
      ).catch(() => null),
    ]);

    const news = [];
    const seenTitles = new Set();

    // Parse Yahoo Finance results
    [newsResults[0], newsResults[1]].forEach(r => {
      if (r.status === 'fulfilled') {
        const items = r.value?.data?.news || [];
        items.forEach(n => {
          if (!seenTitles.has(n.title)) {
            seenTitles.add(n.title);
            news.push({
              title:       n.title,
              publisher:   n.publisher,
              link:        n.link,
              publishedAt: n.providerPublishTime
                ? new Date(n.providerPublishTime * 1000).toISOString()
                : new Date().toISOString(),
              thumbnail:   n.thumbnail?.resolutions?.[0]?.url || null,
              source:      'yahoo-finance',
            });
          }
        });
      }
    });

    // Parse Economic Times RSS
    if (newsResults[2].status === 'fulfilled' && newsResults[2].value) {
      const etItems = newsResults[2].value?.data?.items || [];
      etItems.slice(0, 8).forEach(n => {
        if (!seenTitles.has(n.title)) {
          seenTitles.add(n.title);
          news.push({
            title:       n.title,
            publisher:   'Economic Times',
            link:        n.link,
            publishedAt: n.pubDate ? new Date(n.pubDate).toISOString() : new Date().toISOString(),
            thumbnail:   n.thumbnail || null,
            source:      'economic-times-rss',
          });
        }
      });
    }

    const payload = { news: news.slice(0, 25), count: Math.min(news.length, 25), timestamp: new Date().toISOString() };
    cacheSet(cacheKey, payload, TTL.news);
    res.json(payload);
  } catch (err) {
    console.error('News error:', err.message);
    res.status(503).json({ news: [], error: err.message });
  }
});

// ─── GET /api/market/breadth ──────────────────────────────────────────────────
// Market breadth: advances, declines, unchanged derived from Nifty 50 live data
// Also returns FII/DII approximation from index movement
router.get('/breadth', async (req, res) => {
  try {
    const cacheKey = 'breadth:nifty50';
    const cached   = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // Reuse movers cache if available, else fetch
    let moversData = cacheGet('movers:nifty50');
    if (!moversData) {
      const yahooSyms = NIFTY50.map(s => s + '.NS');
      const quotes    = await fetchQuotesBatch(yahooSyms, 10, 150);
      const stocks    = quotes.map(q => ({ changePercent: q.changePercent || 0 }));
      moversData = { _stocks: stocks };
    }

    const allStocks = moversData._stocks || [
      ...moversData.gainers || [],
      ...moversData.losers  || [],
      ...moversData.active  || [],
    ].filter((s, i, arr) => arr.findIndex(x => x.symbol === s.symbol) === i);

    const advances  = allStocks.filter(s => s.changePercent > 0).length;
    const declines  = allStocks.filter(s => s.changePercent < 0).length;
    const unchanged = allStocks.filter(s => s.changePercent === 0).length;
    const total     = advances + declines + unchanged;

    // Get Nifty index to infer institutional flow direction
    const niftyData = cacheGet('quote:^NSEI') || await fetchQuoteSingle('^NSEI');
    const niftyPct  = niftyData?.changePercent || 0;

    // FII/DII: use index direction as a proxy when real data unavailable
    // Positive Nifty → typically net FII buyers; negative → net sellers
    // These are directionally approximate, not precise
    const fiiNetDirection = niftyPct >= 0 ? 'Net Buyers' : 'Net Sellers';
    const diiNetDirection = niftyPct >= 0 ? 'Net Buyers' : 'Net Buyers'; // DII typically counter-cyclical

    const payload = {
      advances,
      declines,
      unchanged,
      total,
      advanceDeclineRatio: declines > 0 ? +(advances / declines).toFixed(2) : null,
      // FII/DII directional signals (approximate, based on index movement)
      fii: {
        direction:  fiiNetDirection,
        note:       'Directional signal based on index movement. Register at Dhan API for precise data.',
      },
      dii: {
        direction:  diiNetDirection,
        note:       'DII typically absorbs FII selling. Register at Dhan API for precise data.',
      },
      niftyChange:        niftyData?.change || 0,
      niftyChangePercent: +(niftyPct).toFixed(2),
      date:      new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      timestamp: new Date().toISOString(),
    };

    cacheSet(cacheKey, payload, TTL.movers);
    res.json(payload);
  } catch (err) {
    console.error('Breadth error:', err.message);
    res.status(503).json({ error: err.message });
  }
});

// ─── GET /api/market/inr-rate ─────────────────────────────────────────────────
// Returns live USD → INR exchange rate from Frankfurter (free, no auth)
router.get('/inr-rate', async (req, res) => {
  try {
    const data = await fetchInrRate();
    res.json(data);
  } catch (err) {
    console.error('INR rate error:', err.message);
    res.status(503).json({ error: err.message });
  }
});

// ─── GET /api/market/fii-dii ──────────────────────────────────────────────────
// Retained for backward compatibility — now returns breadth-derived data
router.get('/fii-dii', async (req, res) => {
  try {
    // Reuse the breadth endpoint logic
    const niftyData = cacheGet('quote:^NSEI') || await fetchQuoteSingle('^NSEI');
    const niftyPct  = niftyData?.changePercent || 0;

    res.json({
      fii: {
        buy:       null,
        sell:      null,
        net:       null,
        label:     niftyPct >= 0 ? 'Net Buyers (estimated)' : 'Net Sellers (estimated)',
        note:      'Live FII/DII data requires Dhan API credentials. This is directional estimate.',
      },
      dii: {
        buy:   null,
        sell:  null,
        net:   null,
        label: 'Net Buyers (estimated)',
        note:  'DII typically absorbs FII selling pressure.',
      },
      advances:  null,
      declines:  null,
      unchanged: null,
      date:      new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      timestamp: new Date().toISOString(),
      dataQuality: 'estimated',
    });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

module.exports = router;
