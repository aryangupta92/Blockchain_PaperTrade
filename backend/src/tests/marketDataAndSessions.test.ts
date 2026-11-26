import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { containsProviderLeak } from '../infrastructure/providerAnonymizer';
import {
  decodeDepth20Packet,
  decodeStandardPacket,
  isValidTickPrice,
  liveFeed,
} from '../services/market-data/liveWebSocketFeed';
import { resolvePreviousSessionClose } from '../services/market-data/marketDataService';
import { getMarketSession } from '../services/market-data/marketSessionClock';

describe('Phase 2 — Market Data Layer, Binary Decoders, Session Engine & Zero Provider Leakage', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('decodes little-endian Ticker and Full (5-level depth) binary packets accurately', () => {
    // Ticker packet (responseCode=2, segment=1 NSE_EQ, secId=1333, price=1525.50)
    const tickerBuf = Buffer.alloc(16);
    tickerBuf[0] = 2;
    tickerBuf.writeUInt16LE(16, 1);
    tickerBuf[3] = 1;
    tickerBuf.writeUInt32LE(1333, 4);
    tickerBuf.writeFloatLE(1525.5, 8);
    tickerBuf.writeInt32LE(1700000000, 12);

    const decodedTicker = decodeStandardPacket(tickerBuf);
    expect(decodedTicker?.kind).toBe('ticker');
    expect(decodedTicker?.wireSegment).toBe('NSE_EQ');
    expect(decodedTicker?.secId).toBe('1333');
    expect(decodedTicker?.price).toBeCloseTo(1525.5, 2);

    // Full packet (responseCode=8, 162 bytes, 5 levels of bid/ask depth)
    const fullBuf = Buffer.alloc(162);
    fullBuf[0] = 8;
    fullBuf.writeUInt16LE(162, 1);
    fullBuf[3] = 2; // NSE_FNO
    fullBuf.writeUInt32LE(50001, 4);
    fullBuf.writeFloatLE(245.25, 8);
    fullBuf.writeInt32LE(125000, 34); // OI
    // Level 0 at offset 62
    fullBuf.writeInt32LE(750, 62); // bidQty
    fullBuf.writeInt32LE(600, 66); // askQty
    fullBuf.writeInt16LE(12, 70);  // bidOrders
    fullBuf.writeInt16LE(9, 72);   // askOrders
    fullBuf.writeFloatLE(245.1, 74); // bidPrice
    fullBuf.writeFloatLE(245.3, 78); // askPrice

    const decodedFull = decodeStandardPacket(fullBuf);
    expect(decodedFull?.kind).toBe('full');
    expect(decodedFull?.openInterest).toBe(125000);
    expect(decodedFull?.bidDepth).toHaveLength(5);
    expect(decodedFull?.bidDepth?.[0]).toEqual({
      quantity: 750,
      orders: 12,
      price: '245.10',
    });
    expect(decodedFull?.askDepth?.[0]).toEqual({
      quantity: 600,
      orders: 9,
      price: '245.30',
    });
  });

  it('decodes 20-level binary market depth packets', () => {
    const buf = Buffer.alloc(12 + 20 * 16);
    buf[2] = 41; // BID
    buf[3] = 1;  // NSE_EQ
    buf.writeUInt32LE(1333, 4);
    buf.writeDoubleLE(845.5, 12);
    buf.writeUInt32LE(1500, 20);
    buf.writeUInt32LE(14, 24);

    const decoded = decodeDepth20Packet(buf);
    expect(decoded?.side).toBe('BID');
    expect(decoded?.secId).toBe('1333');
    expect(decoded?.levels[0]).toEqual({ price: '845.50', quantity: 1500, orders: 14 });
  });

  it('drops invalid or corrupted tick prints (negative, NaN, >60% jump)', () => {
    expect(isValidTickPrice(0)).toBe(false);
    expect(isValidTickPrice(-10)).toBe(false);
    expect(isValidTickPrice(Number.NaN)).toBe(false);
    expect(isValidTickPrice(500, 100)).toBe(false); // 400% corrupt spike
    expect(isValidTickPrice(105, 100)).toBe(true);
  });

  it('accurately computes IST Equity/F&O and MCX trading sessions including weekends & holidays', () => {
    // Monday 10:30 IST (05:00 UTC) -> Equity OPEN, MCX OPEN
    const monOpen = getMarketSession(new Date('2026-06-08T05:00:00.000Z'));
    expect(monOpen.equityAndFno.phase).toBe('OPEN');
    expect(monOpen.commoditiesMcx.phase).toBe('OPEN');

    // Monday 20:00 IST (14:30 UTC) -> Equity CLOSED, MCX OPEN
    const monEve = getMarketSession(new Date('2026-06-08T14:30:00.000Z'));
    expect(monEve.equityAndFno.phase).toBe('CLOSED');
    expect(monEve.commoditiesMcx.phase).toBe('OPEN');

    // Independence Day 2026-08-15 -> HOLIDAY
    const holiday = getMarketSession(new Date('2026-08-15T06:00:00.000Z'));
    expect(holiday.equityAndFno.phase).toBe('HOLIDAY');
  });

  it('exposes neutral /api/v1/market/status & /instruments/search with ZERO provider branding', async () => {
    const st = await app.inject({ method: 'GET', url: '/api/v1/market/status' });
    expect(st.statusCode).toBe(200);
    expect(containsProviderLeak(st.body)).toBe(false);
    expect(st.body).not.toContain('providerSecId');
    expect(st.body).not.toContain('providerSegment');

    const search = await app.inject({ method: 'GET', url: '/api/v1/market/instruments/search?q=NIFTY' });
    expect(search.statusCode).toBe(200);
    expect(containsProviderLeak(search.body)).toBe(false);
    expect(search.body).not.toContain('providerSecId');
    expect(search.json().count).toBeGreaterThan(0);
  });

  it('ignores zero IEEE754 floats in standard binary packets so prevClose is never wiped to 0', () => {
    const qBuf = Buffer.alloc(50);
    qBuf[0] = 4; // QUOTE
    qBuf.writeUInt16LE(50, 1);
    qBuf[3] = 1; // NSE_EQ
    qBuf.writeUInt32LE(2885, 4);
    qBuf.writeFloatLE(1396.2, 8);  // price
    qBuf.writeFloatLE(0, 18);      // vwap = 0
    qBuf.writeInt32LE(125000, 22); // volume
    qBuf.writeFloatLE(0, 34);      // open = 0
    qBuf.writeFloatLE(0, 38);      // prevClose = 0
    qBuf.writeFloatLE(0, 42);      // high = 0
    qBuf.writeFloatLE(0, 46);      // low = 0

    const pkt = decodeStandardPacket(qBuf);
    expect(pkt?.kind).toBe('quote');
    expect(pkt?.price).toBeCloseTo(1396.2, 1);
    expect(pkt?.prevClose).toBeUndefined();
    expect(pkt?.open).toBeUndefined();
    expect(pkt?.vwap).toBeUndefined();
  });

  it('stores and retrieves seeded previous-close prices via liveFeed.seedPrevClose', () => {
    liveFeed.seedPrevClose('EQ:NSE_EQ:999999', 1373.9);
    expect(liveFeed.getSeededPrevClose('EQ:NSE_EQ:999999')).toBeCloseTo(1373.9, 2);
  });

  it('resolves true previous-session close from 1D candles across market, post-close, weekend, and open', () => {
    const tNov25 = Math.floor(Date.UTC(2026, 10, 25, 10, 0, 0) / 1000); // 15:30 IST Nov 25
    const tNov26 = Math.floor(Date.UTC(2026, 10, 26, 10, 0, 0) / 1000); // 15:30 IST Nov 26
    const tNov27 = Math.floor(Date.UTC(2026, 10, 27, 10, 0, 0) / 1000); // 15:30 IST Nov 27

    const bars = [
      { time: tNov25, open: 25750, high: 25820, low: 25710, close: 25800, volume: 100 },
      { time: tNov26, open: 25810, high: 25900, low: 25790, close: 25884.5, volume: 120 },
    ];

    // Post-close same trading day (today's bar present, ltp === today's close): returns Nov 25 close
    expect(resolvePreviousSessionClose(bars, 25884.5, '2026-11-26')).toBe(25800);

    // Weekend (Saturday Nov 28) showing Friday Nov 27 close as LTP: returns Thursday Nov 26 close
    const friBars = [
      ...bars,
      { time: tNov27, open: 25890, high: 25960, low: 25870, close: 25950, volume: 140 },
    ];
    expect(resolvePreviousSessionClose(friBars, 25950, '2026-11-28')).toBe(25884.5);

    // Next morning pre-open/open (Monday Nov 30) before Monday daily bar exists, live LTP moved: returns Friday close
    expect(resolvePreviousSessionClose(friBars, 26015, '2026-11-30')).toBe(25950);
  });
});
