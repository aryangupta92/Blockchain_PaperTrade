'use strict';
/* Unit-test the Dhan binary packet decoder without a live connection.
   Packets built from the struct tables in dhan-api-docs.md (little-endian). */

const feed = require('../services/data/binaryFeed');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = Math.abs(got - want) < 0.01;
  if (ok) { pass++; console.log(`   PASS  ${label}: ${got}`); }
  else { fail++; console.log(`   FAIL  ${label}: got ${got}, expected ${want}`); }
}

// ── Header: code=2 (ticker), msgLen, seg=1 (NSE_EQ), securityId=1333 ──
function header(code, len, seg, id) {
  const b = Buffer.alloc(8);
  b[0] = code;
  b.writeUInt16LE(len, 1);
  b[3] = seg;
  b.writeUInt32LE(id, 4);
  return b;
}

// ── Ticker packet: LTP 1530.40 @ epoch 1788450308 ──
{
  const b = header(2, 16, 1, 1333);
  const p = Buffer.alloc(16);
  p.set(b, 0);
  p.writeFloatLE(1530.4, 8);
  p.writeInt32LE(1788450308, 12);
  const d = feed.decodePacket(p, { segmentOf: (s) => ({ 1: 'NSE_EQ' })[s] || '' });
  console.log('\nTicker packet (NSE_EQ:1333, LTP 1530.40)');
  eq('price', d.price, 1530.4);
  eq('ltt', d.ltt, 1788450308);
  eq('key', d.key === 'NSE_EQ:1333' ? 1 : 0, 1);
  eq('kind', d.kind === 'ticker' ? 1 : 0, 1);
}

// ── PrevClose packet (code 6): close 1522.80, prevOI 0 ──
{
  const p = Buffer.alloc(16);
  p.set(header(6, 16, 1, 1333), 0);
  p.writeFloatLE(1522.8, 8);
  p.writeInt32LE(0, 12);
  const d = feed.decodePacket(p, { segmentOf: () => 'NSE_EQ' });
  console.log('\nPrev-close packet (1522.80)');
  eq('prevClose', d.prevClose, 1522.8);
}

// ── Quote packet (code 4) with volume/OI/day bounds ──
{
  const p = Buffer.alloc(50);
  p.set(header(4, 50, 1, 1333), 0);
  p.writeFloatLE(1531.25, 8);   // LTP
  p.writeInt16LE(12, 12);       // last traded qty
  p.writeInt32LE(1788450310, 14);
  p.writeFloatLE(1530.9, 18);   // ATP
  p.writeInt32LE(14850000, 22); // volume
  p.writeInt32LE(2200000, 26);  // total sell qty
  p.writeInt32LE(2150000, 30);  // total buy qty
  p.writeFloatLE(1518.0, 34);   // day open
  p.writeFloatLE(1522.8, 38);   // day close (post-close only)
  p.writeFloatLE(1542.6, 42);   // day high
  p.writeFloatLE(1515.2, 46);   // day low
  const d = feed.decodePacket(p, { segmentOf: () => 'NSE_EQ' });
  console.log('\nQuote packet (LTP 1531.25, vol 14,850,000)');
  eq('price', d.price, 1531.25);
  eq('volume', d.volume, 14850000);
  eq('dayHigh', d.high, 1542.6);
  eq('dayLow', d.low, 1515.2);
  eq('dayOpen', d.open, 1518.0);
}

// ── Full packet (code 8) with 5-level depth at offset 62 ──
{
  const p = Buffer.alloc(162);
  p.set(header(8, 162, 1, 2885), 0);
  p.writeFloatLE(2945.5, 8);      // LTP RELIANCE
  p.writeInt16LE(40, 12);
  p.writeInt32LE(1788450320, 14);
  p.writeFloatLE(2944.2, 18);
  p.writeInt32LE(4850000, 22);   // volume
  p.writeInt32LE(910000, 26);
  p.writeInt32LE(880000, 30);
  p.writeInt32LE(0, 34);        // OI
  p.writeInt32LE(0, 38);
  p.writeInt32LE(0, 42);
  p.writeFloatLE(2932.1, 46);  // open
  p.writeFloatLE(2932.1, 50);  // close
  p.writeFloatLE(2960.0, 54);  // high
  p.writeFloatLE(2925.0, 58);  // low
  // 5 depth levels, 20 bytes each starting at 62
  for (let i = 0; i < 5; i++) {
    const o = 62 + i * 20;
    p.writeInt32LE(1200 - i * 50, o);       // bid qty
    p.writeInt32LE(1100 - i * 40, o + 4);   // ask qty
    p.writeInt16LE(14 - i, o + 8);           // bid orders
    p.writeInt16LE(12 - i, o + 10);          // ask orders
    p.writeFloatLE(2945.45 - i * 0.05, o + 12); // bid price
    p.writeFloatLE(2945.55 + i * 0.05, o + 16); // ask price
  }
  const d = feed.decodePacket(p, { segmentOf: () => 'NSE_EQ' });
  console.log('\nFull packet (RELIANCE 2885, LTP 2945.50, 5-level depth)');
  eq('price', d.price, 2945.5);
  eq('volume', d.volume, 4850000);
  eq('depth levels', d.depth.length, 5);
  eq('L1 bid price', d.depth[0].bidPrice, 2945.45);
  eq('L1 ask price', d.depth[0].askPrice, 2945.55);
  eq('L1 bid qty', d.depth[0].bidQty, 1200);
  eq('L5 bid qty', d.depth[4].bidQty, 1000);
  eq('L1 spread', d.depth[0].askPrice - d.depth[0].bidPrice, 0.1);
}

// ── OI packet (code 5) ──
{
  const p = Buffer.alloc(12);
  p.set(header(5, 12, 2, 52175), 0);
  p.writeInt32LE(14625000, 8);
  const d = feed.decodePacket(p, { segmentOf: () => 'NSE_FNO' });
  console.log('\nOI packet (NSE_FNO:52175, OI 14,625,000)');
  eq('openInterest', d.openInterest, 14625000);
}

// ── Disconnect packet (code 50) ──
{
  const p = Buffer.alloc(10);
  p.set(header(50, 10, 1, 1333), 0);
  p.writeInt16LE(805, 8);
  const d = feed.decodePacket(p, { segmentOf: () => 'NSE_EQ' });
  console.log('\nDisconnect packet (code 805 = >5 connections)');
  eq('kind', d.kind === 'disconnect' ? 1 : 0, 1);
  eq('code', d.code, 805);
}

// ── Index packet (code 1), IDX_I segment 0 ──
{
  const p = Buffer.alloc(12);
  p.set(header(1, 12, 0, 13), 0);
  p.writeFloatLE(22650.4, 8);
  const d = feed.decodePacket(p, { segmentOf: (s) => ({ 0: 'IDX_I' })[s] || '' });
  console.log('\nIndex packet (IDX_I:13 NIFTY 50, 22650.40)');
  eq('price', d.price, 22650.4);
  eq('key', d.key === 'IDX_I:13' ? 1 : 0, 1);
}

// ── Feed request/response codes match the docs ──
console.log('\nFeed codes');
eq('SUB_QUOTE', feed.FEED_REQUEST.SUB_QUOTE, 17);
eq('SUB_FULL', feed.FEED_REQUEST.SUB_FULL, 21);
eq('TICKER resp', feed.FEED_RESPONSE.TICKER, 2);
eq('QUOTE resp', feed.FEED_RESPONSE.QUOTE, 4);
eq('FULL resp', feed.FEED_RESPONSE.FULL, 8);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
