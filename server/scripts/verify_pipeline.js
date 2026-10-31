'use strict';
/* End-to-end boot test for the real-data layer. */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 5077;
const BASE = `http://localhost:${PORT}/api`;
const LOG = path.join(__dirname, '..', 'data', 'verify_server.log');
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
}

async function j(url, opts) {
  try {
    const r = await fetch(url, opts);
    const t = await r.text();
    try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t.slice(0, 200) }; }
  } catch (e) {
    return { status: 0, body: { error: e.message } };
  }
}

(async () => {
  try { fs.rmSync(LOG, { force: true }); } catch {}
  console.log(`\nBooting test server on :${PORT}\n`);

  const out = fs.createWriteStream(LOG, { flags: 'a' });
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.pipe(out);
  srv.stderr.pipe(out);

  const deadline = Date.now() + 25000;
  let up = false;
  while (Date.now() < deadline) {
    const h = await j(`${BASE}/system/health`);
    if (h.status === 200) { up = true; break; }
    await new Promise((r) => setTimeout(r, 700));
  }
  check('server boots', up);
  if (!up) {
    console.log('\n--- server log ---\n' + fs.readFileSync(LOG, 'utf8').slice(-3000));
    srv.kill();
    process.exit(1);
  }

  const health = await j(`${BASE}/system/health`);
  check('health endpoint', health.status === 200);
  check('mocks removed flag', health.body?.providers?.mocks === 'removed', health.body?.providers?.mocks);
  check('provider is DHAN', JSON.stringify(health.body?.providers?.providers || []) === '["DHAN"]');

  // ── auth account ───────────────────────────────────────────────────────────
  const email = `feedtest_${Date.now()}@example.in`;
  const password = 'FeedTest#2026';
  const reg = await j(`${BASE}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Feed Test', email, password, phone: '9999999999' }),
  });
  const token = reg.body?.token || reg.body?.accessToken;
  check('test account auth', Boolean(token), reg.body?.error || (token ? 'registered' : 'no token'));
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // ── auth state ─────────────────────────────────────────────────────────────
  const st = await j(`${BASE}/dhan/auth/status`, { headers: H });
  const alreadyAuthed = Boolean(st.body?.authenticated);
  check('dhan auth status', st.status === 200, `authenticated=${alreadyAuthed}`);
  check('app credentials detected', st.body?.hasAppCredentials === true, `clientIdSet=${st.body?.clientIdSet}`);

  // ── feed health (read-only, safe while IP-blocked) ─────────────────────────
  const fh = await j(`${BASE}/dhan/feed-health`, { headers: H });
  check('feed health', fh.status === 200, `instruments=${fh.body?.instruments?.count}`);
  check('instrument master loaded', (fh.body?.instruments?.count ?? 0) > 100000, String(fh.body?.instruments?.count));
  check('feed health explains itself', typeof fh.body?.explanation === 'string' && fh.body.explanation.length > 10, fh.body?.explanation);
  check('circuit snapshot exposed', typeof fh.body?.circuit?.state === 'string', `state=${fh.body?.circuit?.state}`);
  console.log(`         >>> ${fh.body?.explanation}`);

  // ── quotes: no fabricated prices (read-only) ───────────────────────────────
  const q = await j(`${BASE}/market/quotes?symbols=RELIANCE,^NSEI`);
  const arr = q.body?.data || [];
  const rel = arr.find((x) => (x.symbol || '').toUpperCase() === 'RELIANCE');
  check('quotes endpoint responds', q.status === 200, `rows=${arr.length}`);
  const price = rel && rel.price;
  if (typeof price === 'number' && price > 0) {
    // Token present: a real price is fine, but it must be labelled with its source
    const honest = ['DHAN', 'DHAN-CACHED', 'DHAN-REST'].includes(rel.source);
    check('real price is source-labelled', honest, `price=${price} source=${rel.source} freshness=${rel.freshness}`);
  } else {
    check('no synthetic price without data', true, 'price absent while unauthenticated');
    check('flagged UNAVAILABLE', rel == null || rel.freshness === 'UNAVAILABLE', `freshness=${rel && rel.freshness}`);
  }

  // ── candles: honest about source ───────────────────────────────────────────
  const c = await j(`${BASE}/market/candles?symbol=RELIANCE&range=5d&interval=5m`);
  const okSource = ['AUTH_REQUIRED', 'EMPTY', 'YAHOO', 'DHAN', 'CANDLE_STORE', 'CIRCUIT_OPEN'].includes(c.body?.source);
  check('candles honest about source', okSource, `source=${c.body?.source} bars=${c.body?.data?.length ?? 0}`);

  // ── token validation paths ─────────────────────────────────────────────────
  // Only exercised when NOT already authenticated, so we never risk pushing the
  // IP-level block further by making avoidable calls to Dhan.
  if (!alreadyAuthed) {
    const empty = await j(`${BASE}/dhan/auth/token`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('missing token rejected', empty.status === 400, `HTTP ${empty.status}`);
    const short = await j(`${BASE}/dhan/auth/token`, { method: 'POST', headers: H, body: JSON.stringify({ accessToken: 'tooshort' }) });
    check('too-short token rejected', short.status === 400, `HTTP ${short.status}`);
  } else {
    console.log('   SKIP  token rejection checks (already authenticated - avoiding extra Dhan calls)');
  }

  srv.kill();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed\n`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR', e && e.message);
  try { console.error(fs.readFileSync(LOG, 'utf8').slice(-2500)); } catch {}
  process.exit(1);
});
