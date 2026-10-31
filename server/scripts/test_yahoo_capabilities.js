'use strict';
/* Map out everything Yahoo Finance v8/v10 can give us for free, so the
   feature set can be built on verified endpoints rather than guesses. */

const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const y = (url) => axios.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 12000 });

const tests = [
  ['Indices (meta)', 'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1m&range=1d', (d) => {
    const m = d.chart?.result?.[0]?.meta;
    return `NIFTY=${m?.regularMarketPrice} chg%=${m?.regularMarketChangePercent?.toFixed?.(2)}`;
  }],
  ['Sectoral index (BANKNIFTY)', 'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEBANK?interval=1d&range=5d', (d) => {
    const m = d.chart?.result?.[0]?.meta;
    return `BANKNIFTY=${m?.regularMarketPrice}`;
  }],
  ['Equity quote + meta', 'https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?interval=1d&range=1y', (d) => {
    const m = d.chart?.result?.[0]?.meta;
    return `price=${m?.regularMarketPrice} 52wH=${m?.fiftyTwoWeekHigh} 52wL=${m?.fiftyTwoWeekLow} cap=${m?.marketCap}`;
  }],
  ['1-minute intraday candles', 'https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?interval=1m&range=1d', (d) => {
    const n = d.chart?.result?.[0]?.timestamp?.length || 0;
    return `${n} bars`;
  }],
  ['60m candles 1 month', 'https://query1.finance.yahoo.com/v8/finance/chart/HDFCBANK.NS?interval=60m&range=1mo', (d) => {
    const n = d.chart?.result?.[0]?.timestamp?.length || 0;
    return `${n} bars`;
  }],
  ['Daily candles 5 years', 'https://query1.finance.yahoo.com/v8/finance/chart/INFY.NS?interval=1d&range=5y', (d) => {
    const n = d.chart?.result?.[0]?.timestamp?.length || 0;
    return `${n} bars`;
  }],
  ['Symbol search', 'https://query1.finance.yahoo.com/v1/finance/search?q=tata&quotesCount=6&newsCount=0', (d) => {
    const q = d.quotes || [];
    return `${q.length} results e.g. ${q.slice(0, 3).map((x) => x.symbol).join(',')}`;
  }],
  ['F&O symbol (monthly expiry)', 'https://query1.finance.yahoo.com/v8/finance/chart/NIFTY%20%3D-CE%20.NS', () => 'n/a'],
  ['Multiple symbols in one call', 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=RELIANCE.NS,TCS.NS', (d) => {
    const r = d.quoteResponse?.result || [];
    return `${r.length} rows`;
  }],
  ['Screener (equity queries)', 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=5', (d) => {
    const q = d.finance?.result?.[0]?.quotes || [];
    return `${q.length} gainers e.g. ${q.slice(0, 3).map((x) => x.symbol).join(',')}`;
  }],
];

(async () => {
  let pass = 0;
  for (const [name, url, describe] of tests) {
    try {
      const r = await y(url);
      const d = describe ? describe(r.data) : 'ok';
      console.log(`   PASS  ${name} :: ${d}`);
      pass++;
    } catch (e) {
      const code = e.response?.status ? `HTTP ${e.response.status}` : e.message;
      console.log(`   FAIL  ${name} :: ${code}`);
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  console.log(`\n${pass}/${tests.length} Yahoo endpoints usable`);
  process.exit(0);
})();
