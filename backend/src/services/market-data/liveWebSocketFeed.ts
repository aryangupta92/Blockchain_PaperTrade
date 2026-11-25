import WebSocket from 'ws';
import { DepthLevel, NormalizedQuote } from '@broker/shared';
import { requireSessionToken } from './providerTokenManager';
import { MasterInstrument, resolveByWireKey } from './instrumentMaster';

// Internal server-only binary WebSocket streams (never exposed to clients)
const UPSTREAM_FEED_WS = 'wss://api-feed.dhan.co';
const UPSTREAM_DEPTH20_WS = 'wss://depth-api-feed.dhan.co/twentydepth';

const REQ_CODE = {
  DISCONNECT: 12,
  SUB_TICKER: 15,
  SUB_QUOTE: 17,
  SUB_FULL: 21,
  SUB_DEPTH20: 23,
} as const;

const RESP_CODE = {
  INDEX: 1,
  TICKER: 2,
  QUOTE: 4,
  OI: 5,
  PREV_CLOSE: 6,
  MARKET_STATUS: 7,
  FULL: 8,
  DEPTH20_BID: 41,
  DEPTH20_ASK: 51,
  DISCONNECT: 50,
} as const;

const WIRE_SEG_NAME: Record<number, string> = {
  0: 'IDX_I',
  1: 'NSE_EQ',
  2: 'NSE_FNO',
  3: 'NSE_CURRENCY',
  4: 'BSE_EQ',
  5: 'MCX_COMM',
  7: 'BSE_CURRENCY',
  8: 'BSE_FNO',
};

export interface Depth20Update {
  instrumentId: string;
  symbol: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
  timestamp: string;
}

type QuoteListener = (quote: NormalizedQuote) => void;
type Depth20Listener = (depth: Depth20Update) => void;

/** Validate tick price sanity: drop zero, negative, NaN, or extreme corrupted prints. */
export function isValidTickPrice(price: number, prevClose?: number | null): boolean {
  if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) return false;
  if (prevClose && Number.isFinite(prevClose) && prevClose > 0) {
    const ratio = Math.abs(price - prevClose) / prevClose;
    if (ratio > 0.6) return false; // Drop corrupt single-tick prints (>60% jump)
  }
  return true;
}

/** Decode little-endian binary market-feed packets cleanly. */
export function decodeStandardPacket(buf: Buffer): {
  kind: string;
  wireSegment: string;
  secId: string;
  price?: number;
  prevClose?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  vwap?: number;
  openInterest?: number;
  bidDepth?: DepthLevel[];
  askDepth?: DepthLevel[];
  disconnectCode?: number;
} | null {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  const code = buf[0];
  const segByte = buf[3];
  const wireSegment = WIRE_SEG_NAME[segByte] || '';
  const secId = String(buf.readUInt32LE(4));

  switch (code) {
    case RESP_CODE.INDEX:
      return buf.length >= 12 ? { kind: 'index', wireSegment, secId, price: buf.readFloatLE(8) } : null;

    case RESP_CODE.TICKER:
      return buf.length >= 16 ? { kind: 'ticker', wireSegment, secId, price: buf.readFloatLE(8) } : null;

    case RESP_CODE.PREV_CLOSE:
      return buf.length >= 16 ? { kind: 'prevClose', wireSegment, secId, prevClose: buf.readFloatLE(8) } : null;

    case RESP_CODE.OI:
      return buf.length >= 12 ? { kind: 'oi', wireSegment, secId, openInterest: buf.readInt32LE(8) } : null;

    case RESP_CODE.QUOTE:
      if (buf.length < 50) return null;
      return {
        kind: 'quote',
        wireSegment,
        secId,
        price: buf.readFloatLE(8),
        vwap: buf.readFloatLE(18),
        volume: buf.readInt32LE(22),
        open: buf.readFloatLE(34),
        prevClose: buf.readFloatLE(38),
        high: buf.readFloatLE(42),
        low: buf.readFloatLE(46),
      };

    case RESP_CODE.FULL: {
      if (buf.length < 162) return null;
      const bidDepth: DepthLevel[] = [];
      const askDepth: DepthLevel[] = [];
      for (let i = 0; i < 5; i++) {
        const o = 62 + i * 20;
        bidDepth.push({
          quantity: buf.readInt32LE(o),
          orders: buf.readInt16LE(o + 8),
          price: buf.readFloatLE(o + 12).toFixed(2),
        });
        askDepth.push({
          quantity: buf.readInt32LE(o + 4),
          orders: buf.readInt16LE(o + 10),
          price: buf.readFloatLE(o + 16).toFixed(2),
        });
      }
      return {
        kind: 'full',
        wireSegment,
        secId,
        price: buf.readFloatLE(8),
        vwap: buf.readFloatLE(18),
        volume: buf.readInt32LE(22),
        openInterest: buf.readInt32LE(34),
        open: buf.readFloatLE(46),
        prevClose: buf.readFloatLE(50),
        high: buf.readFloatLE(54),
        low: buf.readFloatLE(58),
        bidDepth,
        askDepth,
      };
    }

    case RESP_CODE.DISCONNECT:
      return buf.length >= 10
        ? { kind: 'disconnect', wireSegment, secId, disconnectCode: buf.readInt16LE(8) }
        : null;

    default:
      return null;
  }
}

/** Decode 20-level binary market depth packet (12-byte header + 20 * 16-byte levels). */
export function decodeDepth20Packet(buf: Buffer): {
  side: 'BID' | 'ASK';
  wireSegment: string;
  secId: string;
  levels: DepthLevel[];
} | null {
  if (!Buffer.isBuffer(buf) || buf.length < 12 + 16) return null;
  const code = buf[2];
  if (code !== RESP_CODE.DEPTH20_BID && code !== RESP_CODE.DEPTH20_ASK) return null;
  const wireSegment = WIRE_SEG_NAME[buf[3]] || '';
  const secId = String(buf.readUInt32LE(4));
  const levels: DepthLevel[] = [];
  for (let i = 0; i < 20; i++) {
    const o = 12 + i * 16;
    if (o + 16 > buf.length) break;
    const price = buf.readDoubleLE(o);
    const quantity = buf.readUInt32LE(o + 8);
    const orders = buf.readUInt32LE(o + 12);
    if (Number.isFinite(price) && price > 0) {
      levels.push({ price: price.toFixed(2), quantity, orders });
    }
  }
  return {
    side: code === RESP_CODE.DEPTH20_BID ? 'BID' : 'ASK',
    wireSegment,
    secId,
    levels,
  };
}

class LiveMarketFeedManager {
  private ws: WebSocket | null = null;
  private depthWs: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private lastTickAt: number | null = null;

  private readonly quotesById = new Map<string, NormalizedQuote>();
  private readonly depth20ById = new Map<string, Depth20Update>();
  private readonly subscribedInstruments = new Map<string, { inst: MasterInstrument; mode: 'quote' | 'full' }>();
  private readonly depthSubscribed = new Map<string, MasterInstrument>();
  private readonly quoteListeners = new Set<QuoteListener>();
  private readonly depth20Listeners = new Set<Depth20Listener>();

  public onQuote(cb: QuoteListener): () => void {
    this.quoteListeners.add(cb);
    return () => this.quoteListeners.delete(cb);
  }

  public onDepth20(cb: Depth20Listener): () => void {
    this.depth20Listeners.add(cb);
    return () => this.depth20Listeners.delete(cb);
  }

  public getCachedQuote(instrumentId: string): NormalizedQuote | null {
    const q = this.quotesById.get(instrumentId);
    if (!q) return null;
    const ageMs = Date.now() - new Date(q.timestamp).getTime();
    return {
      ...q,
      freshness: ageMs <= 15_000 ? 'LIVE' : ageMs <= 12 * 60 * 60 * 1000 ? 'CACHED' : 'STALE',
    };
  }

  public getCachedDepth20(instrumentId: string): Depth20Update | null {
    return this.depth20ById.get(instrumentId) || null;
  }

  public status() {
    return {
      connected: Boolean(this.ws && this.ws.readyState === WebSocket.OPEN),
      depth20Connected: Boolean(this.depthWs && this.depthWs.readyState === WebSocket.OPEN),
      subscribedCount: this.subscribedInstruments.size,
      trackedQuotes: this.quotesById.size,
      lastTickAgeMs: this.lastTickAt ? Date.now() - this.lastTickAt : null,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  public async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const session = requireSessionToken();
      const url = `${UPSTREAM_FEED_WS}?version=2&token=${encodeURIComponent(session.token)}&clientId=${encodeURIComponent(session.clientId)}&authType=2`;

      await new Promise<void>((resolve, reject) => {
        const sock = new WebSocket(url);
        const timer = setTimeout(() => {
          sock.terminate();
          reject(new Error('Market data stream connection timed out'));
        }, 12_000);

        sock.on('open', () => {
          clearTimeout(timer);
          this.ws = sock;
          this.reconnectAttempts = 0;

          const hb = setInterval(() => {
            if (sock.readyState === WebSocket.OPEN) sock.ping();
            else clearInterval(hb);
          }, 10_000);
          hb.unref?.();

          this.resubscribeAll();
          resolve();
        });

        sock.on('message', (raw: WebSocket.RawData) => {
          const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
          this.handleStandardMessage(buf).catch(() => {});
        });

        sock.on('error', () => {
          clearTimeout(timer);
          reject(new Error('Market data stream unavailable'));
        });

        sock.on('close', () => {
          if (this.ws === sock) this.ws = null;
          this.scheduleReconnect();
        });
      });
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts || this.subscribedInstruments.size === 0) return;
    this.reconnectAttempts++;
    const delayMs = Math.min(60_000, 3_000 * Math.pow(2, this.reconnectAttempts - 1));
    setTimeout(() => {
      this.ensureConnected().catch(() => {});
    }, delayMs).unref?.();
  }

  private sendBatch(sock: WebSocket | null, code: number, list: MasterInstrument[]) {
    if (!sock || sock.readyState !== WebSocket.OPEN || list.length === 0) return;
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      sock.send(
        JSON.stringify({
          RequestCode: code,
          InstrumentCount: chunk.length,
          InstrumentList: chunk.map((x) => ({
            ExchangeSegment: x.providerSegment,
            SecurityId: x.providerSecId,
          })),
        })
      );
    }
  }

  private resubscribeAll() {
    const quoteList: MasterInstrument[] = [];
    const fullList: MasterInstrument[] = [];
    for (const entry of this.subscribedInstruments.values()) {
      if (entry.mode === 'full') fullList.push(entry.inst);
      else quoteList.push(entry.inst);
    }
    this.sendBatch(this.ws, REQ_CODE.SUB_QUOTE, quoteList);
    this.sendBatch(this.ws, REQ_CODE.SUB_FULL, fullList);
  }

  public async subscribe(instruments: MasterInstrument[], mode: 'quote' | 'full' = 'full'): Promise<void> {
    if (instruments.length === 0) return;
    for (const inst of instruments) {
      this.subscribedInstruments.set(inst.instrumentId, { inst, mode });
    }
    await this.ensureConnected();
    this.sendBatch(this.ws, mode === 'full' ? REQ_CODE.SUB_FULL : REQ_CODE.SUB_QUOTE, instruments);
  }

  /** Subscribe to 20-level L3 market depth (max 50 instruments concurrently per Data API plan). */
  public async subscribeDepth20(inst: MasterInstrument): Promise<void> {
    this.depthSubscribed.set(inst.instrumentId, inst);
    if (!this.depthWs || this.depthWs.readyState !== WebSocket.OPEN) {
      const session = requireSessionToken();
      const url = `${UPSTREAM_DEPTH20_WS}?token=${encodeURIComponent(session.token)}&clientId=${encodeURIComponent(session.clientId)}&authType=2`;
      await new Promise<void>((resolve, reject) => {
        const sock = new WebSocket(url);
        const timer = setTimeout(() => {
          sock.terminate();
          reject(new Error('Depth stream connection timed out'));
        }, 10_000);
        sock.on('open', () => {
          clearTimeout(timer);
          this.depthWs = sock;
          resolve();
        });
        sock.on('message', (raw: WebSocket.RawData) => {
          const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
          this.handleDepth20Message(buf).catch(() => {});
        });
        sock.on('error', () => {
          clearTimeout(timer);
          reject(new Error('Depth stream unavailable'));
        });
        sock.on('close', () => {
          if (this.depthWs === sock) this.depthWs = null;
        });
      });
    }
    this.sendBatch(this.depthWs, REQ_CODE.SUB_DEPTH20, [inst]);
  }

  private async handleStandardMessage(buf: Buffer) {
    const pkt = decodeStandardPacket(buf);
    if (!pkt || pkt.kind === 'disconnect') return;

    const inst = await resolveByWireKey(pkt.wireSegment, pkt.secId);
    if (!inst) return;

    const prev = this.quotesById.get(inst.instrumentId);
    const prevCloseNum = pkt.prevClose ?? (prev?.prevClose ? Number(prev.prevClose) : null);

    if (pkt.price !== undefined && !isValidTickPrice(pkt.price, prevCloseNum)) {
      return; // Drop bad print
    }

    const ltpNum = pkt.price ?? (prev?.ltp ? Number(prev.ltp) : null);
    const changeNum =
      ltpNum != null && prevCloseNum != null && prevCloseNum > 0 ? ltpNum - prevCloseNum : null;
    const changePctNum =
      changeNum != null && prevCloseNum && prevCloseNum > 0 ? (changeNum / prevCloseNum) * 100 : null;

    const nowIso = new Date().toISOString();
    const quote: NormalizedQuote = {
      instrumentId: inst.instrumentId,
      symbol: inst.instrumentKind === 'INDEX' ? inst.symbol : inst.tradingSymbol,
      exchange: inst.exchange,
      segment: inst.segment,
      ltp: ltpNum != null ? ltpNum.toFixed(2) : null,
      prevClose: prevCloseNum != null ? prevCloseNum.toFixed(2) : null,
      open: pkt.open != null ? pkt.open.toFixed(2) : (prev?.open ?? null),
      high: pkt.high != null ? pkt.high.toFixed(2) : (prev?.high ?? null),
      low: pkt.low != null ? pkt.low.toFixed(2) : (prev?.low ?? null),
      change: changeNum != null ? changeNum.toFixed(2) : null,
      changePercent: changePctNum != null ? changePctNum.toFixed(2) : null,
      volume: pkt.volume ?? prev?.volume ?? null,
      vwap: pkt.vwap != null ? pkt.vwap.toFixed(2) : (prev?.vwap ?? null),
      openInterest: pkt.openInterest ?? prev?.openInterest ?? null,
      bidDepth: pkt.bidDepth ?? prev?.bidDepth ?? [],
      askDepth: pkt.askDepth ?? prev?.askDepth ?? [],
      freshness: 'LIVE',
      timestamp: nowIso,
    };

    this.lastTickAt = Date.now();
    this.quotesById.set(inst.instrumentId, quote);
    for (const listener of this.quoteListeners) {
      try {
        listener(quote);
      } catch {
        // Never allow a slow/failing listener to break feed ingestion
      }
    }
  }

  private async handleDepth20Message(buf: Buffer) {
    const pkt = decodeDepth20Packet(buf);
    if (!pkt) return;
    const inst = await resolveByWireKey(pkt.wireSegment, pkt.secId);
    if (!inst) return;

    const existing = this.depth20ById.get(inst.instrumentId) || {
      instrumentId: inst.instrumentId,
      symbol: inst.symbol,
      bids: [],
      asks: [],
      timestamp: new Date().toISOString(),
    };
    const updated: Depth20Update = {
      ...existing,
      bids: pkt.side === 'BID' ? pkt.levels : existing.bids,
      asks: pkt.side === 'ASK' ? pkt.levels : existing.asks,
      timestamp: new Date().toISOString(),
    };
    this.depth20ById.set(inst.instrumentId, updated);
    for (const listener of this.depth20Listeners) {
      try {
        listener(updated);
      } catch {
        // isolate listeners
      }
    }
  }

  public disconnectAll() {
    try { this.ws?.close(); } catch {}
    try { this.depthWs?.close(); } catch {}
    this.ws = null;
    this.depthWs = null;
  }
}

export const liveFeed = new LiveMarketFeedManager();
