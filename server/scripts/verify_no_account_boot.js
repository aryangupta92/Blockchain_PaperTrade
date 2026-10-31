'use strict';
/* Boot the app with NO Dhan credentials and prove every feature has real data.
   This is the deployment mode for a user who does not own a Dhan account. */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 5088;
const BASE = `http://localhost:${PORT}/api`;
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
}
async function j(url, opts) {
  try {
    const r = await fetch(url, opts);
    const t = await r.text();
    try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t.slice(0, 300) }; }
  } catch (e) { return { status: 0, body: { error: e.message } }; }
}

(async () => {
  console.log('\n=== Boot with NO Dhan account ===\n');

  const env = { ...process.env, PORT: String(PORT) };
  // strip all Dhan credentials so this truly simulates a no-account deploy
  delete env.DHAN_APP_ID;
  delete env.DHAN_APP_SECRET;
  delete env.DHAN_ACCESS_TOKEN;
  delete env.DHAN_CLIENT_ID;

  const logFile = path.join(__dirname, '..', 'data', 'noacct_boot.log');
  const out = fs.createWriteStream(logFile, { flags: 'w' });

  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.pipe(out);
  srv.stderr.pipe(out);

  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 25000) {
    const h = await j(`${BASE}/system/health`);
    if (h.status === 200) { up = true; break; }
    await new Promise((r) => setTimeout(r, 600));
  }
  if (!up) {
    console.log('server failed to boot. Log:\n' + fs.readFileSync(logFile, 'utf8').slice(-3000));
    srv.kill();
    process.exit(1);
  }
  check('server boots without a Dhan account', true);

  // wait for the first sync cycle
  await new Promise((r) => setTimeout(r, 45000));

  const reg = await j(`${BASE}/dhan/feed-health`, { headers: authHeaders(await login()) });
  const yahooOk = reg.body?.registry?.order?.[0] === 'YAHOO';
  check('registry falls back to Yahoo (free)', yahooOk, `order=${(reg.body?.registry?.order || []).join(' -> ')} active=${reg.body?.registry?.active}`);
  check('accountRequired is true', reg.body?.accountRequired === true);
  console.log(`         >>> ${reg.body?.explanation}`);
  check('continuous sync ran', (reg.body?.sync?.quoteCycles ?? 0) >= 1, `cycles=${reg.body?.sync?.quoteCycles} symbols=${reg.body?.sync?.symbolsTracked}`);

  // quotes for every sector
  const sectors = ['^NSEI', '^NSEBANK', '^CNXIT', '^CNXPHARMA', '^CNXAUTO', '^CNXFMCG', '^CNXMETAL', '^CNXENERGY', '^CNXREALTY'];
  const q = await j(`${BASE}/market/quotes?symbols=${encodeURIComponent(sectors.join(','))}`);
  const rows = q.body?.data || [];
  const priced = rows.filter((r) => r.price != null && r.price > 0);
  check('all sector indices have real prices', priced.length === sectors.length, `${priced.length}/${sectors.length} (${rows.map((r) => r.symbol).join(' ')})`);
  check('source labelled YAHOO', rows.every((r) => r.source === 'YAHOO'), `sample=${rows[0]?.source}`);

  // Nifty 50 stocks
  const stocks = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'ITC', 'LT', 'MARUTI', 'BHARTIARTL'];
  const q2 = await j(`${BASE}/market/quotes?symbols=${stocks.join(',')}`);
  const priced2 = (q2.body?.data || []).filter((r) => r.price != null && r.price > 0);
  check('Nifty 50 sample priced', priced2.length === stocks.length, `${priced2.length}/${stocks.length}`);

  // candles for charts
  const c1 = await j(`${BASE}/market/candles?symbol=RELIANCE&range=5d&interval=5m`);
  check('intraday candles for charts', (c1.body?.data?.length ?? 0) > 50, `bars=${c1.body?.data?.length} source=${c1.body?.source}`);

  const c2 = await j(`${BASE}/market/candles?symbol=^NSEI&range=1y&interval=1d`);
  check('daily candles for charts', (c2.body?.data?.length ?? 0) > 100, `bars=${c2.body?.data?.length} source=${c2.body?.source}`);

  // movers + sectors
  const mv = await j(`${BASE}/market/movers`);
  check('movers (gainers/losers)', (mv.body?.gainers?.length ?? 0) > 0 && (mv.body?.losers?.length ?? 0) > 0, `gainers=${mv.body?.gainers?.length} losers=${mv.body?.losers?.length}`);

  const sec = await j(`${BASE}/market/sectors`);
  check('sector performance', (sec.body?.data?.length ?? 0) > 0, `${sec.body?.data?.length} sectors`);

  // search
  const sr = await j(`${BASE}/market/search?q=infosys`);
  check('symbol search', (sr.body?.results?.length ?? 0) > 0, `${sr.body?.results?.[0]?.symbol}`);

  const h = await j(`${BASE}/system/health`);
  check('health is honest', h.body?.providers?.mocks === 'removed');

  srv.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    const log = fs.readFileSync(logFile, 'utf8');
    console.log('\n--- boot log tail ---\n' + log.slice(-1500));
  }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });

async function login() {
  const r = await fetch(`${BASE}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'NoAcct', email: `na_${Date.now()}@x.in`, password: 'FeedTest#2026', phone: '9999999999' }),
  });
  return r.json();
}
function authHeaders(json) {
  return json?.token ? { Authorization: `Bearer ${json.token}` } : {};
}
