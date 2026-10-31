'use strict';
/* Phase 0 — verify DhanHQ v2 credentials before wiring them into the app. */
const axios = require('axios');

const CLIENT_ID = process.argv[2];
const TOKEN = process.argv[3];
const H = () => ({ 'access-token': TOKEN, 'client-id': CLIENT_ID, 'Content-Type': 'application/json', Accept: 'application/json' });

async function tryStep(name, fn) {
  const t = Date.now();
  try {
    const out = await fn();
    console.log(`[OK]   ${name} (${Date.now() - t}ms)`, out ? JSON.stringify(out).slice(0, 220) : '');
    return out;
  } catch (e) {
    console.log(`[FAIL] ${name} (${Date.now() - t}ms)`, e.response?.data ? JSON.stringify(e.response.data) : e.message);
    return null;
  }
}

(async () => {
  console.log('clientId=' + CLIENT_ID + ' tokenLen=' + (TOKEN || '').length);

  // 1. Auth check — cheapest authenticated call
  await tryStep('GET /v2/fundlimit (auth)', () => axios.get('https://api.dhan.co/v2/fundlimit', { headers: H(), timeout: 15000 }).then(r => r.data));

  // 2. Daily history (Data API)
  await tryStep('POST /v2/charts/historical (RELIANCE 1mo)', () => axios.post('https://api.dhan.co/v2/charts/historical', {
    securityId: '1333', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY',
    fromDate: '2026-09-01', toDate: '2026-10-01', oi: false,
  }, { headers: H(), timeout: 20000 }).then(r => {
    const c = r.data?.close || [];
    return { bars: c.length, lastClose: c[c.length - 1], keys: Object.keys(r.data || {}) };
  }));

  // 3. Intraday minute candles
  await tryStep('POST /v2/charts/intraday (1m, 90d chunk)', () => axios.post('https://api.dhan.co/v2/charts/intraday', {
    securityId: '1333', exchangeSegment: 'NSE_EQ', instrument: 'EQUITY', interval: '1', oi: false,
    fromDate: '2026-10-01 09:15:00', toDate: '2026-10-05 15:30:00',
  }, { headers: H(), timeout: 20000 }).then(r => {
    const c = r.data?.close || [];
    return { bars: c.length, lastClose: c[c.length - 1] };
  }));

  // 4. Quote API (LTP)
  await tryStep('POST /v2/marketfeed/quote', () => axios.post('https://api.dhan.co/v2/marketfeed/quote',
    { NSE_EQ: [1333, 2885] }, { headers: H(), timeout: 10000 }).then(r => r.data));

  // 5. Instrument master (public-ish CSV, but confirms data APIs tier)
  await tryStep('GET /v2/instrument/NSE_EQ (master list)', () => axios.get('https://api.dhan.co/v2/instrument/NSE_EQ', {
    headers: H(), timeout: 30000, responseType: 'arraybuffer',
  }).then(r => ({ bytes: r.data?.length })));

  // 6. WS feed URL shape check
  console.log('[INFO] WS: wss://api-feed.dhan.co?version=2&token=<TOKEN>&clientId=<ID>&authType=2');
})();
