'use strict';
/* Test every candidate FREE (no-key, no-account) Indian market data source
   so the provider chain is built on what actually works, not guesses. */

const axios = require('axios');
const { loadMaster } = require('../services/data/instrumentMaster');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const results = [];

function ok(name, detail) { results.push({ name, ok: true, detail }); console.log(`   PASS  ${name} :: ${detail}`); }
function bad(name, detail) { results.push({ name, ok: false, detail }); console.log(`   FAIL  ${name} :: ${detail}`); }

async function timed(label, fn) {
  const t = Date.now();
  try {
    const out = await fn();
    return { out, ms: Date.now() - t };
  } catch (e) {
    throw e;
  }
}

async function testYahooQuotes() {
  try {
    const r = await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?interval=1d&range=1d', {
      headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 12000,
    });
    const m = r.data?.chart?.result?.[0]?.meta;
    if (!m?.regularMarketPrice) throw new Error('no price in payload');
    ok('Yahoo v8 quote (RELIANCE.NS)', `price=${m.regularMarketPrice} prevClose=${m.chartPreviousClose}`);
  } catch (e) { bad('Yahoo v8 quote', e.response?.status || e.message); }
}

async function testYahooBatch() {
  try {
    const syms = ['RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'SBIN.NS'];
    const rs = await Promise.all(syms.map((s) =>
      axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=1d&range=1d`, { headers: { 'User-Agent': UA }, timeout: 12000 })
        .then((r) => r.data?.chart?.result?.[0]?.meta?.regularMarketPrice).catch(() => null)
    ));
    const got = rs.filter(Boolean).length;
    if (got === syms.length) ok('Yahoo batch quote (5 symbols)', `${got}/${syms.length} prices`);
    else bad('Yahoo batch quote', `${got}/${syms.length} prices`);
  } catch (e) { bad('Yahoo batch quote', e.message); }
}

async function testYahooCandles() {
  try {
    const r = await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?interval=5m&range=5d', { headers: { 'User-Agent': UA }, timeout: 15000 });
    const res = r.data?.chart?.result?.[0];
    const n = res?.timestamp?.length || 0;
    if (n > 10) ok('Yahoo v8 candles (5m x 5d)', `${n} bars, last=${res.indicators.quote[0].close?.[n - 1]}`);
    else bad('Yahoo v8 candles', `only ${n} bars`);
  } catch (e) { bad('Yahoo v8 candles', e.response?.status || e.message); }
}

/** NSE with the documented cookie handshake (homepage first, then API). */
async function testNse(handshake = true) {
  const jar = { cookies: [] };
  let cookieHeader = '';
  const label = handshake ? 'NSE (cookie handshake)' : 'NSE (no handshake)';

  const nseHeaders = () => ({
    'User-Agent': UA,
    Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://www.nseindia.com/market-data/live-equity-market',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  });

  try {
    if (handshake) {
      const home = await axios.get('https://www.nseindia.com/', { headers: { 'User-Agent': UA }, timeout: 15000 });
      const raw = home.headers['set-cookie'] || [];
      cookieHeader = raw.map((c) => c.split(';')[0]).join('; ');
    }
    const r = await axios.get('https://www.nseindia.com/api/market-status', { headers: nseHeaders(), timeout: 15000 });
    const status = r.data?.marketState?.[0]?.marketStatus || r.data?.status || 'unknown';
    ok(label, `HTTP ${r.status} marketStatus=${status}`);
  } catch (e) {
    const s = e.response?.status;
    bad(label, s ? `HTTP ${s}` : e.message);
  }
}

async function testNseEquity() {
  let cookieHeader = '';
  try {
    const home = await axios.get('https://www.nseindia.com/', { headers: { 'User-Agent': UA }, timeout: 15000 });
    cookieHeader = (home.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  } catch {}
  try {
    const r = await axios.get('https://www.nseindia.com/api/quote-equity?symbol=RELIANCE', {
      headers: {
        'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.nseindia.com/get-quotes/equity?symbol=RELIANCE',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      }, timeout: 15000,
    });
    const p = r.data?.priceInfo?.lastPrice;
    if (p) ok('NSE quote-equity (RELIANCE)', `lastPrice=${p}`);
    else bad('NSE quote-equity', 'no lastPrice in payload');
  } catch (e) {
    bad('NSE quote-equity', e.response?.status ? `HTTP ${e.response.status} (often 403 = blocked)` : e.message);
  }
}

async function testNseOptionChain() {
  let cookieHeader = '';
  try {
    const home = await axios.get('https://www.nseindia.com/', { headers: { 'User-Agent': UA }, timeout: 15000 });
    cookieHeader = (home.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  } catch {}
  try {
    const r = await axios.get('https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY', {
      headers: {
        'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.nseindia.com/option-chain',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      }, timeout: 15000,
    });
    const n = r.data?.records?.data?.length || 0;
    const spot = r.data?.records?.underlyingValue;
    ok('NSE option-chain (NIFTY)', `${n} strikes, spot=${spot}`);
  } catch (e) {
    bad('NSE option-chain', e.response?.status ? `HTTP ${e.response.status}` : e.message);
  }
}

async function testBse() {
  try {
    const r = await axios.get('https://api.bseindia.com/BseIndiaAPI/api/StockReachGraph/w?scripcode=532977&flag=0&fromdate=&todate=&seriesid=', {
      headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.bseindia.com/' }, timeout: 12000,
    });
    ok('BSE scrip data (532977)', `HTTP ${r.status} rows=${Array.isArray(r.data) ? r.data.length : 'n/a'}`);
  } catch (e) {
    bad('BSE scrip data', e.response?.status ? `HTTP ${e.response.status}` : e.message);
  }
}

async function testDhanMaster() {
  try {
    const m = await loadMaster();
    ok('Dhan scrip master (public CSV, no auth)', `${m.raw.length} instruments`);
  } catch (e) { bad('Dhan scrip master', e.message); }
}

(async () => {
  console.log('\n=== Testing free Indian market data sources ===\n');
  await testYahooQuotes();
  await testYahooBatch();
  await testYahooCandles();
  await testNse(true);
  await testNse(false);
  await testNseEquity();
  await testNseOptionChain();
  await testBse();
  await testDhanMaster();

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== ${pass}/${results.length} sources usable ===\n`);
  console.log('Usable (no key, no account):');
  results.filter((r) => r.ok).forEach((r) => console.log('   + ' + r.name));
  console.log('Blocked:');
  results.filter((r) => !r.ok).forEach((r) => console.log('   - ' + r.name));
  process.exit(0);
})();
