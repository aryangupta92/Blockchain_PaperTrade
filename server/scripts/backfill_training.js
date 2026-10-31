'use strict';
/* Backfill training-grade history: 6 months of 5m + 2y of daily for key symbols. */
const registry = require('../services/data/registry');

const SYMBOLS = ['^NSEI', '^NSEBANK', '^BSESN', 'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'SBIN', 'ITC'];

(async () => {
  console.log('\n=== Backfilling training history ===\n');
  for (const s of SYMBOLS) {
    for (const [tf, range] of [['5m', '1mo'], ['15m', '3mo'], ['1D', '2y']]) {
      try {
        const r = await registry.getCandles(s, tf, range);
        console.log(`   ${s.padEnd(10)} ${tf.padEnd(3)} ${String(r.data.length).padStart(5)} bars (${r.source})`);
      } catch (e) {
        console.log(`   ${s.padEnd(10)} ${tf.padEnd(3)} FAILED: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  console.log('\nDone.\n');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
