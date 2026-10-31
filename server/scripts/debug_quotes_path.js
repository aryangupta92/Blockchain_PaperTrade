'use strict';
/* Time each step of the quotes path to locate the hang. */
require('dotenv').config();

const registry = require('../services/data/registry');
const provider = require('../services/marketDataProvider');
const sync = require('../services/data/continuousSync');
const yahoo = require('../services/data/providers/yahooProvider');

const T = (label, t) => console.log(`   ${label}: ${Date.now() - t}ms`);

(async () => {
  console.log('registry order:', registry.order().join(' -> '));
  console.log('DHAN reason   :', registry.providers.DHAN.reason);

  let t = Date.now();
  try { await sync.start(); T('continuousSync.start', t); } catch (e) { console.log('   sync.start threw:', e.message); }

  t = Date.now();
  try { const r = await registry.getQuotes(['RELIANCE']); T('registry.getQuotes(RELIANCE)', t); console.log('   ->', r[0] && r[0].price, r[0] && r[0].source, r[0] && r[0].freshness); }
  catch (e) { T('registry.getQuotes threw', t); console.log('   ->', e.message); }

  t = Date.now();
  try { const r = await yahoo.getQuote('RELIANCE'); T('yahoo.getQuote', t); console.log('   ->', r && r.price, r && r.source); }
  catch (e) { T('yahoo.getQuote threw', t); console.log('   ->', e.message); }

  t = Date.now();
  try { const r = await provider.getQuotesBatch(['RELIANCE']); T('provider.getQuotesBatch', t); console.log('   ->', r[0] && r[0].price, r[0] && r[0].source, r[0] && r[0].freshness); }
  catch (e) { T('provider.getQuotesBatch threw', t); console.log('   ->', e.message); }

  const cached = sync.cached('RELIANCE');
  console.log(`   cached quote: ${cached ? cached.price + ' ' + cached.source : 'none'}`);

  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
