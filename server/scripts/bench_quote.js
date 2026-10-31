'use strict';
/* Micro-benchmark the internal steps of a single Yahoo quote fetch. */
require('dotenv').config();
const yahoo = require('../services/data/providers/yahooProvider');
const registry = require('../services/data/registry');
const sync = require('../services/data/continuousSync');

(async () => {
  console.log('--- baseline (no sync running) ---');
  let t = Date.now();
  await yahoo.getQuote('RELIANCE');
  console.log('   getQuote cold:', Date.now() - t + 'ms');

  t = Date.now();
  await yahoo.getQuote('RELIANCE');
  console.log('   getQuote warm:', Date.now() - t + 'ms');

  console.log('\n--- with the sync daemon running ---');
  await sync.start();
  await new Promise((r) => setTimeout(r, 1500)); // let a cycle get going

  for (let i = 0; i < 3; i++) {
    t = Date.now();
    await yahoo.getQuote('RELIANCE');
    console.log(`   interactive getQuote #${i + 1}: ${Date.now() - t}ms`);
  }

  t = Date.now();
  const r = await registry.getQuotes(['RELIANCE']);
  console.log('   registry.getQuotes:', Date.now() - t + 'ms ->', r[0] && r[0].price, r[0] && r[0].source);

  sync.stop();
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
