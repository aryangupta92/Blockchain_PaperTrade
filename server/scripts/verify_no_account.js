'use strict';
/* Prove the app gets REAL data with NO Dhan account:
   the registry must fall back to Yahoo and label the source honestly. */

// Simulate "no Dhan account": clear the Dhan env credentials
delete process.env.DHAN_APP_ID;
delete process.env.DHAN_APP_SECRET;
delete process.env.DHAN_ACCESS_TOKEN;
delete process.env.DHAN_CLIENT_ID;

const registry = require('../services/data/registry');

(async () => {
  console.log('\n=== Registry with NO Dhan account configured ===\n');

  const h = registry.health();
  console.log('provider order      :', h.order.join(' -> ') || '(none)');
  console.log('DHAN available      :', h.providers.DHAN.available, `(${h.providers.DHAN.reason})`);
  console.log('YAHOO available     :', h.providers.YAHOO.available);
  console.log('active provider     :', h.active);
  console.log('');

  const quotes = await registry.getQuotes(['^NSEI', '^NSEBANK', 'RELIANCE', 'TCS', 'HDFCBANK', 'SBIN', 'INFY', '^CNXIT']);
  let good = 0;
  console.log('quotes:');
  for (const q of quotes) {
    const has = q.price != null && q.price > 0;
    if (has) good++;
    console.log(`   ${q.symbol.padEnd(12)} ${has ? ('Rs ' + q.price + ' ' + (q.changePercent ?? 0) + '%').padEnd(28) : 'NO DATA'.padEnd(28)} src=${q.source} fresh=${q.freshness}`);
  }
  console.log(`\n-> ${good}/${quotes.length} symbols have REAL prices from Yahoo with no account.\n`);

  const c = await registry.getCandles('RELIANCE', '5m', '5d');
  console.log(`candles: source=${c.source} bars=${c.data.length}`);
  if (c.data.length) {
    console.log(`   first=${c.data[0].time} close=${c.data[0].close}`);
    console.log(`   last =${c.data[c.data.length - 1].time} close=${c.data[c.data.length - 1].close}`);
  }

  const s = await registry.search('reliance');
  console.log(`\nsearch "reliance": ${s.length} results -> ${s.slice(0, 4).map((x) => x.symbol).join(', ')}`);

  const g = await registry.screener('gainers', 5);
  console.log(`screener gainers: ${g.length} -> ${g.map((x) => x.symbol).join(', ')}`);

  process.exit(good > 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
