'use strict';
/* Verify instrument master resolution against the real Dhan scrip master. */
const im = require('../services/data/instrumentMaster');

(async () => {
  const m = await im.loadMaster();
  console.log('scrips:', m.raw.length, ' index keys:', m.byKey.size);

  const rows = m.raw.filter((r) => r.symbol === 'RELIANCE' || r.tradingSymbol === 'RELIANCE');
  console.log('\nRELIANCE rows in master:');
  rows.slice(0, 4).forEach((r) => console.log(`   ${r.exchange}/${r.segment} secId=${r.securityId} instr=${r.instrument} tsym=${r.tradingSymbol} lot=${r.lotSize}`));

  const tests = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'MARUTI', 'SBIN', '^NSEI', '^NSEBANK', '^CNXIT', 'NIFTY', 'BANKNIFTY', 'RELIANCE.NS'];
  console.log('\nResolution:');
  for (const t of tests) {
    const p = await im.resolvePairSmart(t);
    const rec = p && p.record ? p.record : null;
    console.log(`   ${t.padEnd(14)} -> ${p ? (p.exchangeSegment + ':' + p.securityId).padEnd(16) + ' "' + (rec ? rec.tradingSymbol : '') + '"' : 'UNRESOLVED'}`);
  }
  process.exit(0);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
