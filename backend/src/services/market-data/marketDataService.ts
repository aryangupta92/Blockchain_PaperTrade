import fs from 'fs';
import path from 'path';
import {
  CandleBar,
  DataFreshness,
  DepthLevel,
  MarketDataProvider,
  NormalizedQuote,
} from '@broker/shared';
import { marketCache } from './marketDataCache';
import { getMarketSession } from './marketSessionClock';
import { getActiveSessionToken, getTokenStatus, refreshViaTotp, requireSessionToken } from './providerTokenManager';
import {
  getCoreIndices,
  getMasterIndex,
  MasterInstrument,
  refreshInstrumentMaster,
  resolveInstrument,
} from './instrumentMaster';
import { getCircuitStatus, providerClient, UpstreamProfile } from './providerHttpClient';
import { liveFeed } from './liveWebSocketFeed';

export interface NormalizedOptionLeg {
  ltp: string | null;
  bid: string | null;
  ask: string | null;
  volume: number;
  oi: number;
  oiChange: number;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

export interface NormalizedOptionRow {
  strike: number;
  atm: boolean;
  itmCall: boolean;
  itmPut: boolean;
  call: NormalizedOptionLeg;
  put: NormalizedOptionLeg;
}

export interface NormalizedOptionChain {
  underlying: string;
  exchange: string;
  spotPrice: string;
  expiry: string;
  expiries: string[];
  totalCallOI: number;
  totalPutOI: number;
  pcr: number | null;
  maxPain: number | null;
  rows: NormalizedOptionRow[];
  timestamp: string;
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function positiveNumOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n != null && n > 0 ? n : null;
}

function parseOptionLeg(raw: Record<string, unknown> | undefined): NormalizedOptionLeg {
  const greeks = (raw?.greeks as Record<string, unknown> | undefined) || {};
  const oi = numOrNull(raw?.oi) ?? 0;
  const prevOi = numOrNull(raw?.previous_oi);
  const ltp = numOrNull(raw?.last_price);
  const bid = numOrNull(raw?.top_bid_price);
  const ask = numOrNull(raw?.top_ask_price);

  return {
    ltp: ltp != null ? ltp.toFixed(2) : null,
    bid: bid != null ? bid.toFixed(2) : null,
    ask: ask != null ? ask.toFixed(2) : null,
    volume: numOrNull(raw?.volume) ?? 0,
    oi,
    oiChange: prevOi != null ? oi - prevOi : 0,
    iv: numOrNull(raw?.implied_volatility),
    delta: numOrNull(greeks.delta),
    gamma: numOrNull(greeks.gamma),
    theta: numOrNull(greeks.theta),
    vega: numOrNull(greeks.vega),
  };
}

function computeMaxPain(rows: NormalizedOptionRow[]): number | null {
  if (rows.length === 0) return null;
  let bestStrike: number | null = null;
  let minLoss = Infinity;
  for (const candidate of rows) {
    let pain = 0;
    for (const r of rows) {
      if (r.strike < candidate.strike) pain += r.call.oi * (candidate.strike - r.strike);
      if (r.strike > candidate.strike) pain += r.put.oi * (r.strike - candidate.strike);
    }
    if (pain < minLoss) {
      minLoss = pain;
      bestStrike = candidate.strike;
    }
  }
  return bestStrike;
}

function mapIntervalToUpstream(interval: string): { kind: 'daily' | 'intraday'; step?: '1' | '5' | '15' | '25' | '60' } {
  switch (interval) {
    case '1m': return { kind: 'intraday', step: '1' };
    case '3m':
    case '5m': return { kind: 'intraday', step: '5' };
    case '15m': return { kind: 'intraday', step: '15' };
    case '30m': return { kind: 'intraday', step: '25' };
    case '1h': return { kind: 'intraday', step: '60' };
    default: return { kind: 'daily' };
  }
}

const INDEX_ROOTS = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYIT', 'SENSEX', 'BANKEX', 'INDIAVIX']);
const LAST_QUOTES_PATH = path.resolve(__dirname, '../../../data/last_quotes.json');

function instrumentTypeForHistory(inst: MasterInstrument): string {
  if (inst.instrumentKind === 'INDEX') return 'INDEX';
  const root = inst.symbol.split('-')[0].split(' ')[0].toUpperCase();
  const isIdx = INDEX_ROOTS.has(root);
  if (inst.instrumentKind === 'FUTURES') return inst.segment === 'COMM' ? 'FUTCOM' : isIdx ? 'FUTIDX' : 'FUTSTK';
  if (inst.instrumentKind === 'OPTIONS') return inst.segment === 'COMM' ? 'OPTFUT' : isIdx ? 'OPTIDX' : 'OPTSTK';
  return 'EQUITY';
}

function unavailableQuote(symbol: string, inst?: MasterInstrument | null): NormalizedQuote {
  return {
    instrumentId: inst?.instrumentId ?? symbol.toUpperCase(),
    symbol: inst?.symbol ?? symbol.toUpperCase(),
    exchange: inst?.exchange ?? 'NSE',
    segment: inst?.segment ?? 'EQ',
    ltp: null,
    prevClose: null,
    open: null,
    high: null,
    low: null,
    change: null,
    changePercent: null,
    volume: null,
    vwap: null,
    openInterest: null,
    bidDepth: [],
    askDepth: [],
    freshness: 'UNAVAILABLE',
    timestamp: new Date().toISOString(),
  };
}

class PrimaryMarketDataService implements MarketDataProvider {
  private dailyRefreshTimer: NodeJS.Timeout | null = null;
  private lastKnownQuotes = new Map<string, NormalizedQuote>();
  private lastQuoteFlushAt = 0;

  constructor() {
    this.loadLastKnownQuotes();
  }

  private loadLastKnownQuotes(): void {
    try {
      if (!fs.existsSync(LAST_QUOTES_PATH)) return;
      const arr = JSON.parse(fs.readFileSync(LAST_QUOTES_PATH, 'utf8')) as NormalizedQuote[];
      if (Array.isArray(arr)) {
        for (const q of arr) {
          if (q?.instrumentId && q?.ltp) {
            this.lastKnownQuotes.set(q.instrumentId, { ...q, freshness: 'CACHED' });
          }
        }
      }
    } catch { /* ignore */ }
  }

  private saveLastKnownQuotesThrottled(force = false): void {
    if (process.env.NODE_ENV === 'test') return;
    if (!force && Date.now() - this.lastQuoteFlushAt < 8_000) return;
    this.lastQuoteFlushAt = Date.now();
    try {
      fs.mkdirSync(path.dirname(LAST_QUOTES_PATH), { recursive: true });
      fs.writeFileSync(LAST_QUOTES_PATH, JSON.stringify([...this.lastKnownQuotes.values()].slice(0, 600)));
    } catch { /* ignore */ }
  }

  /** Start daily pre-market instrument master refresh (08:30 IST) & automated TOTP session refresh (08:45 IST). */
  public startDailyScheduler(): void {
    if (this.dailyRefreshTimer) return;
    let lastTotpDate = '';
    this.dailyRefreshTimer = setInterval(() => {
      const session = getMarketSession();
      const hhmm = session.istTime.slice(11, 16);
      if (session.weekday && hhmm === '08:30') {
        refreshInstrumentMaster().catch(() => {});
      }
      if (
        session.weekday &&
        hhmm === '08:45' &&
        lastTotpDate !== session.istDate &&
        getTokenStatus().totpAutoRefreshConfigured
      ) {
        lastTotpDate = session.istDate;
        refreshViaTotp().catch(() => {});
      }
    }, 60_000);
    this.dailyRefreshTimer.unref?.();
  }

  public async getHealth() {
    const tokenSt = getTokenStatus();
    if (tokenSt.authenticated && process.env.NODE_ENV !== 'test') {
      const session = getActiveSessionToken();
      if (session?.token) {
        liveFeed.resetReconnectIfTokenChanged(session.token);
      }
      if (!liveFeed.status().connected) {
        if (liveFeed.status().subscribedCount === 0) {
          liveFeed.subscribe(getCoreIndices(), 'full').catch(() => {});
        } else {
          liveFeed.ensureConnected().catch(() => {});
        }
      }
    }
    const feedSt = liveFeed.status();
    const master = await getMasterIndex();

    let profile: UpstreamProfile | null = marketCache.get<UpstreamProfile>('provider:profile');
    if (!profile && tokenSt.authenticated) {
      try {
        profile = await providerClient.getProfile();
        marketCache.set('provider:profile', profile, 5 * 60 * 1000);
      } catch {
        profile = null;
      }
    }

    const dataActive = profile?.dataPlan ? profile.dataPlan.toLowerCase() === 'active' : null;
    const freshness: DataFreshness = feedSt.connected
      ? 'LIVE'
      : tokenSt.authenticated
        ? 'CACHED'
        : 'UNAVAILABLE';

    return {
      connected: feedSt.connected,
      depth20Connected: feedSt.depth20Connected,
      authenticated: tokenSt.authenticated,
      credentialsConfigured: tokenSt.credentialsConfigured,
      totpAutoRefreshConfigured: tokenSt.totpAutoRefreshConfigured,
      tokenExpiresAt: tokenSt.expiresAt,
      tokenMinutesRemaining: tokenSt.minutesRemaining,
      dataSubscriptionActive: dataActive,
      dataSubscriptionExpiry: profile?.dataValidity ?? null,
      activeSegments: profile?.activeSegment
        ? profile.activeSegment.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      instrumentCount: master.list.length,
      subscribedInstruments: feedSt.subscribedCount,
      freshness,
      circuit: getCircuitStatus(),
      cache: marketCache.stats(),
      session: getMarketSession(),
    };
  }

  public async getQuotes(symbolsOrIds: string[]): Promise<NormalizedQuote[]> {
    const resolvedList: Array<{ raw: string; inst: MasterInstrument | null }> = await Promise.all(
      symbolsOrIds.map(async (raw) => ({ raw, inst: await resolveInstrument(raw) }))
    );

    const out = new Map<string, NormalizedQuote>();
    const needRest: MasterInstrument[] = [];

    for (const item of resolvedList) {
      if (!item.inst) {
        out.set(item.raw, unavailableQuote(item.raw, null));
        continue;
      }
      // 1) Check live WebSocket tick store first
      const wsQuote = liveFeed.getCachedQuote(item.inst.instrumentId);
      if (wsQuote && wsQuote.freshness === 'LIVE') {
        out.set(item.raw, wsQuote);
        continue;
      }
      // 2) Check short-TTL REST quote cache (2s)
      const cached = marketCache.get<NormalizedQuote>(`quote:${item.inst.instrumentId}`);
      if (cached) {
        out.set(item.raw, cached);
        continue;
      }
      needRest.push(item.inst);
    }

    if (needRest.length > 0 && getTokenStatus().authenticated) {
      const grouped: Record<string, number[]> = {};
      for (const inst of needRest) {
        const secNum = Number(inst.providerSecId);
        if (!Number.isFinite(secNum)) continue;
        (grouped[inst.providerSegment] = grouped[inst.providerSegment] || []).push(secNum);
      }

      try {
        const resp = await providerClient.getFullQuotes(grouped);
        const nowIso = new Date().toISOString();

        for (const inst of needRest) {
          const segData = resp?.data?.[inst.providerSegment];
          const rawObj = segData?.[inst.providerSecId];
          const ohlc = (rawObj?.ohlc as Record<string, unknown> | undefined) || {};
          const rawLtp = numOrNull(rawObj?.last_price);
          const prevClose = numOrNull(ohlc.close);
          const ltp = rawLtp != null && rawLtp > 0 ? rawLtp : prevClose;
          if (!rawObj || ltp == null || ltp <= 0) continue;

          const change = prevClose != null ? ltp - prevClose : null;
          const changePct = change != null && prevClose && prevClose > 0 ? (change / prevClose) * 100 : null;

          const depthObj = (rawObj.depth as { buy?: Array<Record<string, unknown>>; sell?: Array<Record<string, unknown>> } | undefined) || {};
          const mapLevels = (arr?: Array<Record<string, unknown>>): DepthLevel[] =>
            (arr || [])
              .map((lvl) => ({
                price: (numOrNull(lvl.price) ?? 0).toFixed(2),
                quantity: numOrNull(lvl.quantity) ?? 0,
                orders: numOrNull(lvl.orders) ?? 0,
              }))
              .filter((lvl) => Number(lvl.price) > 0);

          const normalized: NormalizedQuote = {
            instrumentId: inst.instrumentId,
            symbol: inst.instrumentKind === 'INDEX' ? inst.symbol : inst.tradingSymbol,
            exchange: inst.exchange,
            segment: inst.segment,
            ltp: ltp.toFixed(2),
            prevClose: prevClose != null ? prevClose.toFixed(2) : null,
            open: numOrNull(ohlc.open)?.toFixed(2) ?? null,
            high: numOrNull(ohlc.high)?.toFixed(2) ?? null,
            low: numOrNull(ohlc.low)?.toFixed(2) ?? null,
            change: change != null ? change.toFixed(2) : null,
            changePercent: changePct != null ? changePct.toFixed(2) : null,
            volume: numOrNull(rawObj.volume),
            vwap: positiveNumOrNull(rawObj.average_price)?.toFixed(2) ?? null,
            openInterest: numOrNull(rawObj.oi),
            bidDepth: mapLevels(depthObj.buy),
            askDepth: mapLevels(depthObj.sell),
            upperCircuit: positiveNumOrNull(rawObj.upper_circuit_limit)?.toFixed(2) ?? inst.upperCircuit ?? null,
            lowerCircuit: positiveNumOrNull(rawObj.lower_circuit_limit)?.toFixed(2) ?? inst.lowerCircuit ?? null,
            week52High: positiveNumOrNull(rawObj['52_week_high'])?.toFixed(2) ?? null,
            week52Low: positiveNumOrNull(rawObj['52_week_low'])?.toFixed(2) ?? null,
            totalBuyQty: numOrNull(rawObj.buy_quantity),
            totalSellQty: numOrNull(rawObj.sell_quantity),
            ltq: numOrNull(rawObj.last_quantity),
            ltt: typeof rawObj.last_trade_time === 'string' ? rawObj.last_trade_time : null,
            oiDayHigh: numOrNull(rawObj.oi_day_high),
            oiDayLow: numOrNull(rawObj.oi_day_low),
            freshness: 'LIVE',
            timestamp: nowIso,
          };

          marketCache.set(`quote:${inst.instrumentId}`, normalized, 5_000);
          this.lastKnownQuotes.set(inst.instrumentId, normalized);
          this.saveLastKnownQuotesThrottled();
        }
      } catch {
        // Fall through cleanly to cached or persistent last-known quote
      }

      // 3) Off-hours / holiday closing-bar backfill via historical daily OHLCV when REST quote map is empty
      const missingFromRest = needRest.filter(
        (inst) =>
          !marketCache.get<NormalizedQuote>(`quote:${inst.instrumentId}`) &&
          !this.lastKnownQuotes.get(inst.instrumentId)?.ltp
      );
      if (missingFromRest.length > 0 && process.env.NODE_ENV !== 'test' && getTokenStatus().authenticated) {
        const todayStr = new Date().toISOString().slice(0, 10);
        const yearAgoStr = new Date(Date.now() - 366 * 86400 * 1000).toISOString().slice(0, 10);
        const sess = getMarketSession();
        const ttlMs = sess.equityAndFno.isTradable || sess.commoditiesMcx.isTradable ? 5_000 : 60_000;
        await Promise.all(
          missingFromRest.slice(0, 15).map(async (inst) => {
            try {
              const bars = await this.getCandles({
                instrumentId: inst.instrumentId,
                interval: '1D',
                from: yearAgoStr,
                to: todayStr,
              });
              if (!bars || bars.length === 0) return;
              const lastBar = bars[bars.length - 1];
              const prevBar = bars.length >= 2 ? bars[bars.length - 2] : null;
              const prevClose = prevBar ? prevBar.close : lastBar.open;
              const ltp = lastBar.close;
              if (!ltp || ltp <= 0) return;
              const chg = prevClose > 0 ? ltp - prevClose : 0;
              const chgPct = prevClose > 0 ? (chg / prevClose) * 100 : 0;
              let w52H = lastBar.high;
              let w52L = lastBar.low;
              for (const b of bars) {
                if (b.high > w52H) w52H = b.high;
                if (b.low > 0 && b.low < w52L) w52L = b.low;
              }
              const approxVwap = (lastBar.high + lastBar.low + lastBar.close) / 3;
              const cachedQuote: NormalizedQuote = {
                instrumentId: inst.instrumentId,
                symbol: inst.instrumentKind === 'INDEX' ? inst.symbol : inst.tradingSymbol,
                exchange: inst.exchange,
                segment: inst.segment,
                ltp: ltp.toFixed(2),
                prevClose: prevClose > 0 ? prevClose.toFixed(2) : null,
                open: lastBar.open.toFixed(2),
                high: lastBar.high.toFixed(2),
                low: lastBar.low.toFixed(2),
                change: chg.toFixed(2),
                changePercent: chgPct.toFixed(2),
                volume: lastBar.volume ?? null,
                vwap: approxVwap > 0 ? approxVwap.toFixed(2) : null,
                openInterest: lastBar.oi ?? null,
                bidDepth: [],
                askDepth: [],
                upperCircuit: inst.upperCircuit ?? null,
                lowerCircuit: inst.lowerCircuit ?? null,
                week52High: w52H > 0 ? w52H.toFixed(2) : null,
                week52Low: w52L > 0 ? w52L.toFixed(2) : null,
                freshness: 'CACHED',
                timestamp: new Date().toISOString(),
              };
              marketCache.set(`quote:${inst.instrumentId}`, cachedQuote, ttlMs);
              this.lastKnownQuotes.set(inst.instrumentId, cachedQuote);
            } catch {
              // ignore individual backfill failures
            }
          })
        );
        this.saveLastKnownQuotesThrottled(true);
      }
    }

    return resolvedList.map(({ raw, inst }) => {
      if (out.has(raw)) return out.get(raw)!;
      if (inst) {
        const fresh = marketCache.get<NormalizedQuote>(`quote:${inst.instrumentId}`);
        if (fresh) return fresh;
        const stale = liveFeed.getCachedQuote(inst.instrumentId);
        if (stale && stale.ltp) return stale;
        const persisted = this.lastKnownQuotes.get(inst.instrumentId);
        if (persisted && persisted.ltp) return { ...persisted, freshness: 'CACHED' };
      }
      return unavailableQuote(raw, inst);
    });
  }

  public async getCandles(params: {
    instrumentId: string;
    interval: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '1D' | '1W';
    from: string;
    to: string;
  }): Promise<CandleBar[]> {
    const inst = await resolveInstrument(params.instrumentId);
    if (!inst) return [];

    const cacheKey = `candles:${inst.instrumentId}:${params.interval}:${params.from}:${params.to}`;
    const cached = marketCache.get<CandleBar[]>(cacheKey);
    if (cached) return cached;

    const mapped = mapIntervalToUpstream(params.interval);
    const instrument = instrumentTypeForHistory(inst);
    const includeOi = inst.segment === 'FNO' || inst.segment === 'COMM';

    const toBars = (rawResp: {
      open?: number[];
      high?: number[];
      low?: number[];
      close?: number[];
      volume?: number[];
      timestamp?: number[];
      open_interest?: number[];
    } | null | undefined): CandleBar[] => {
      if (!rawResp) return [];
      const ts = rawResp.timestamp || [];
      const outBars: CandleBar[] = [];
      for (let i = 0; i < ts.length; i++) {
        const open = rawResp.open?.[i];
        const high = rawResp.high?.[i];
        const low = rawResp.low?.[i];
        const close = rawResp.close?.[i];
        if (open == null || high == null || low == null || close == null) continue;
        outBars.push({
          time: ts[i],
          open,
          high,
          low,
          close,
          volume: rawResp.volume?.[i] ?? 0,
          ...(rawResp.open_interest?.[i] != null ? { oi: rawResp.open_interest[i] } : {}),
        });
      }
      return outBars;
    };

    const todayStr = new Date().toISOString().slice(0, 10);
    const wider25From = new Date(Date.now() - 25 * 86400 * 1000).toISOString().slice(0, 10);
    const wider90From = new Date(Date.now() - 90 * 86400 * 1000).toISOString().slice(0, 10);

    let bars: CandleBar[] = [];
    if (mapped.kind === 'daily') {
      const raw = await providerClient.getDailyHistory({
        securityId: inst.providerSecId,
        exchangeSegment: inst.providerSegment,
        instrument,
        fromDate: params.from.slice(0, 10),
        toDate: params.to.slice(0, 10),
        oi: includeOi,
      }).catch(() => null);
      bars = toBars(raw);
      if (bars.length === 0 && (inst.instrumentKind === 'OPTIONS' || inst.instrumentKind === 'FUTURES')) {
        const fallbackIntraday = await providerClient.getIntradayHistory({
          securityId: inst.providerSecId,
          exchangeSegment: inst.providerSegment,
          instrument,
          interval: '60',
          fromDate: `${wider25From} 09:15:00`,
          toDate: `${todayStr} 23:30:00`,
          oi: includeOi,
        }).catch(() => null);
        bars = toBars(fallbackIntraday);
      }
    } else {
      const raw = await providerClient.getIntradayHistory({
        securityId: inst.providerSecId,
        exchangeSegment: inst.providerSegment,
        instrument,
        interval: mapped.step!,
        fromDate: params.from.includes(' ') ? params.from : `${params.from.slice(0, 10)} 09:15:00`,
        toDate: params.to.includes(' ') ? params.to : `${params.to.slice(0, 10)} 23:30:00`,
        oi: includeOi,
      }).catch(() => null);
      bars = toBars(raw);
      if (bars.length === 0) {
        const retryWide = await providerClient.getIntradayHistory({
          securityId: inst.providerSecId,
          exchangeSegment: inst.providerSegment,
          instrument,
          interval: mapped.step!,
          fromDate: `${wider25From} 09:15:00`,
          toDate: `${todayStr} 23:30:00`,
          oi: includeOi,
        }).catch(() => null);
        bars = toBars(retryWide);
      }
      if (bars.length === 0) {
        const dailyFallback = await providerClient.getDailyHistory({
          securityId: inst.providerSecId,
          exchangeSegment: inst.providerSegment,
          instrument,
          fromDate: wider90From,
          toDate: todayStr,
          oi: includeOi,
        }).catch(() => null);
        bars = toBars(dailyFallback);
      }
    }

    if (bars.length > 0) {
      marketCache.set(cacheKey, bars, mapped.kind === 'daily' ? 5 * 60_000 : 30_000);
    }
    return bars;
  }

  public async getExpiryList(underlying: string): Promise<string[]> {
    const inst = await resolveInstrument(underlying);
    if (!inst) return [];

    const cacheKey = `expiries:${inst.instrumentId}`;
    const cached = marketCache.get<string[]>(cacheKey);
    if (cached) return cached;

    const resp = await providerClient.getExpiryList({
      UnderlyingScrip: Number(inst.providerSecId),
      UnderlyingSeg: inst.providerSegment,
    });
    const list = Array.isArray(resp.data) ? resp.data : [];
    marketCache.set(cacheKey, list, 15 * 60_000);
    return list;
  }

  public async getOptionChain(underlying: string, expiry?: string): Promise<NormalizedOptionChain | null> {
    const inst = await resolveInstrument(underlying);
    if (!inst) return null;

    const expiries = await this.getExpiryList(underlying);
    const chosenExpiry = expiry || expiries[0];
    if (!chosenExpiry) return null;

    const cacheKey = `oc:${inst.instrumentId}:${chosenExpiry}`;
    const cached = marketCache.get<NormalizedOptionChain>(cacheKey);
    if (cached) return cached;

    const resp = await providerClient.getOptionChain({
      UnderlyingScrip: Number(inst.providerSecId),
      UnderlyingSeg: inst.providerSegment,
      Expiry: chosenExpiry,
    });

    const oc = resp?.data?.oc;
    const spot = numOrNull(resp?.data?.last_price);
    if (!oc || spot == null || spot <= 0) return null;

    const sorted = Object.entries(oc)
      .map(([k, v]) => ({ strike: Number(k), ce: v.ce, pe: v.pe }))
      .filter((r) => Number.isFinite(r.strike))
      .sort((a, b) => a.strike - b.strike);

    const step = sorted.length > 1 ? Math.abs(sorted[1].strike - sorted[0].strike) : 50;
    let totalCallOI = 0;
    let totalPutOI = 0;

    const rows: NormalizedOptionRow[] = sorted.map((r) => {
      const call = parseOptionLeg(r.ce);
      const put = parseOptionLeg(r.pe);
      totalCallOI += call.oi;
      totalPutOI += put.oi;
      return {
        strike: r.strike,
        atm: Math.abs(r.strike - spot) <= step / 2,
        itmCall: r.strike < spot,
        itmPut: r.strike > spot,
        call,
        put,
      };
    });

    const normalized: NormalizedOptionChain = {
      underlying: inst.symbol,
      exchange: inst.exchange,
      spotPrice: spot.toFixed(2),
      expiry: chosenExpiry,
      expiries,
      totalCallOI,
      totalPutOI,
      pcr: totalCallOI > 0 ? Number((totalPutOI / totalCallOI).toFixed(2)) : null,
      maxPain: computeMaxPain(rows),
      rows,
      timestamp: new Date().toISOString(),
    };

    marketCache.set(cacheKey, normalized, 4_000);
    return normalized;
  }

  public async getRollingOptionHistory(params: {
    underlying: string;
    interval: '1' | '5' | '15' | '25' | '60';
    expiryFlag: 'WEEK' | 'MONTH';
    expiryCode: number;
    strike: string;
    optionType: 'CALL' | 'PUT';
    fromDate: string;
    toDate: string;
  }) {
    const inst = await resolveInstrument(params.underlying);
    if (!inst) throw new Error('Underlying instrument not found');
    return providerClient.getRollingOptionHistory({
      exchangeSegment: inst.exchange === 'BSE' ? 'BSE_FNO' : 'NSE_FNO',
      interval: params.interval,
      securityId: Number(inst.providerSecId),
      instrument: inst.instrumentKind === 'INDEX' ? 'OPTIDX' : 'OPTSTK',
      expiryFlag: params.expiryFlag,
      expiryCode: params.expiryCode,
      strike: params.strike,
      drvOptionType: params.optionType,
      requiredData: ['open', 'high', 'low', 'close', 'volume', 'iv', 'oi', 'spot'],
      fromDate: params.fromDate,
      toDate: params.toDate,
    });
  }

  public async calculateExchangeMargin(legs: Array<{
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    product: 'CNC' | 'MIS' | 'NRML' | 'MTF';
    price: number;
    triggerPrice?: number;
  }>) {
    const session = requireSessionToken();
    const mappedProduct = (p: 'CNC' | 'MIS' | 'NRML' | 'MTF') =>
      p === 'MIS' ? 'INTRADAY' : p === 'NRML' ? 'MARGIN' : p === 'MTF' ? 'MTF' : 'CNC';

    const resolvedLegs = await Promise.all(
      legs.map(async (leg) => {
        const inst = await resolveInstrument(leg.symbol);
        if (!inst) throw new Error(`Instrument not found: ${leg.symbol}`);
        return {
          exchangeSegment: inst.providerSegment,
          transactionType: leg.side,
          quantity: leg.quantity,
          productType: mappedProduct(leg.product) as 'CNC' | 'INTRADAY' | 'MARGIN' | 'MTF',
          securityId: inst.providerSecId,
          price: leg.price,
          ...(leg.triggerPrice ? { triggerPrice: leg.triggerPrice } : {}),
        };
      })
    );

    if (resolvedLegs.length === 1) {
      return providerClient.calculateMargin({
        dhanClientId: session.clientId,
        ...resolvedLegs[0],
      });
    }

    return providerClient.calculateMultiMargin({
      dhanClientId: session.clientId,
      includePosition: false,
      includeOrder: false,
      scripList: resolvedLegs,
    });
  }

  /** Fetch company fundamentals snapshot (companyInfo cached 6h, merged dynamically with live/closing quote). */
  public async getCompanyFundamentals(symbolOrId: string) {
    const inst = await resolveInstrument(symbolOrId);
    if (!inst) return null;

    const infoCacheKey = `companyinfo:${inst.instrumentId}`;
    let companyData: Record<string, unknown> | null =
      marketCache.get<Record<string, unknown>>(infoCacheKey) || null;

    if (!companyData && (inst.providerSegment === 'NSE_EQ' || inst.providerSegment === 'BSE_EQ') && getTokenStatus().authenticated) {
      try {
        const res = await providerClient.getCompanyInfo({
          securityId: inst.providerSecId,
          exchangeSegment: inst.providerSegment as 'NSE_EQ' | 'BSE_EQ',
          instrument: 'EQUITY',
          metrics: ['CO'],
        });
        companyData = (res?.data as Record<string, unknown>) || null;
        if (companyData) {
          marketCache.set(infoCacheKey, companyData, 6 * 60 * 60 * 1000);
        }
      } catch {
        companyData = null;
      }
    }

    const [quote] = await this.getQuotes([inst.instrumentId]).catch(() => [null]);

    let week52High = quote?.week52High ?? null;
    let week52Low = quote?.week52Low ?? null;
    if ((!week52High || !week52Low) && process.env.NODE_ENV !== 'test' && getTokenStatus().authenticated) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const yearAgoStr = new Date(Date.now() - 366 * 86400 * 1000).toISOString().slice(0, 10);
      const bars = await this.getCandles({
        instrumentId: inst.instrumentId,
        interval: '1D',
        from: yearAgoStr,
        to: todayStr,
      }).catch(() => []);
      if (bars.length > 0) {
        let hi = bars[0].high;
        let lo = bars[0].low;
        for (const b of bars) {
          if (b.high > hi) hi = b.high;
          if (b.low > 0 && b.low < lo) lo = b.low;
        }
        week52High = week52High ?? hi.toFixed(2);
        week52Low = week52Low ?? lo.toFixed(2);
      }
    }

    return {
      instrumentId: inst.instrumentId,
      symbol: inst.symbol,
      tradingSymbol: inst.tradingSymbol,
      displayName: inst.displayName,
      exchange: inst.exchange,
      segment: inst.segment,
      isin: inst.isin ?? null,
      lotSize: inst.lotSize,
      tickSize: inst.tickSize,
      mtfLeverage: inst.mtfLeverage ?? '4.00',
      upperCircuit: quote?.upperCircuit ?? inst.upperCircuit ?? null,
      lowerCircuit: quote?.lowerCircuit ?? inst.lowerCircuit ?? null,
      week52High,
      week52Low,
      asmGsmFlag: inst.asmGsmFlag ?? null,
      quote,
      companyInfo: companyData,
      updatedAt: new Date().toISOString(),
    };
  }

  public refreshInstrumentMaster = refreshInstrumentMaster;
}

export const marketDataService = new PrimaryMarketDataService();
