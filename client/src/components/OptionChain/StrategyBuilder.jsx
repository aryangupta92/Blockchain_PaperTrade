import { useState, useMemo, useCallback, useRef } from 'react';
import { Plus, Trash2, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import AdvancedChart from '../Chart/AdvancedChart';
import api from '../../services/api';
import { UNDERLYINGS, getSpec, expiriesFor, expiryLabel, buildFOSymbol, legPayoff, payoffRange } from '../../utils/fo';
import './StrategyBuilder.css';

const C = {
  bg: '#131722',
  surface: '#1e222d',
  border: '#2a2e39',
  text: '#d1d4dc',
  muted: '#787b86',
  accent: '#2962ff',
  gain: '#089981',
  loss: '#f23645',
};

const CHART_SYMBOL = { NIFTY: '^NSEI', BANKNIFTY: '^NSEBANK', FINNIFTY: '^CNXFIN', SENSEX: '^BSESN', BANKEX: '^BSEBANKEX' };

function fmtINR(n, dp = 2) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  const sign = n < 0 ? '-' : '';
  return sign + '₹' + Math.abs(Number(n)).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function estimatePremium(spot, strike, optionType, step) {
  const moneyness = Math.abs(spot - strike) / step;
  const base = spot * 0.004;
  return Math.max(base * Math.exp(-moneyness * 0.45), spot * 0.0002);
}

function quoteFor(quotes, sym) {
  if (!sym) return null;
  return quotes[sym] || quotes[sym + '.NS'] || quotes[sym + '.BO'] || null;
}

function legGreek(quotes, leg, spot, step) {
  const sym = buildFOSymbol(leg.underlying, leg.expiry, leg.strike, leg.optionType, false);
  const q = quoteFor(quotes, sym);
  if (q && q.delta != null) {
    return { delta: q.delta, gamma: q.gamma ?? 0, theta: q.theta ?? 0, vega: q.vega ?? 0 };
  }
  const ceDelta = Math.min(0.98, Math.max(0.02, 0.5 + (spot - leg.strike) / (8 * step)));
  const delta = leg.optionType === 'CE' ? ceDelta : ceDelta - 1;
  const price = leg.premium || estimatePremium(spot, leg.strike, leg.optionType, step);
  return { delta, gamma: 0.008 * Math.exp(-Math.abs(spot - leg.strike) / (6 * step)), theta: -price * 0.03, vega: price * 0.06 };
}

const PRESETS = [
  { key: 'bullCall', label: 'Bull Call Spread' },
  { key: 'bearPut', label: 'Bear Put Spread' },
  { key: 'ironCondor', label: 'Iron Condor' },
  { key: 'straddle', label: 'Straddle' },
  { key: 'strangle', label: 'Strangle' },
  { key: 'butterfly', label: 'Butterfly' },
  { key: 'calendar', label: 'Calendar Spread' },
];

export default function StrategyBuilder({ spot, underlying, onTrade, balance, quotes }) {
  const spec = getSpec(underlying) || { lot: 1, step: 50, label: underlying };
  const lot = spec.lot;
  const step = spec.step;
  const expiries = expiriesFor(underlying);
  const [expiry, setExpiry] = useState(expiries[0]?.code || '');
  const [legs, setLegs] = useState([]);
  const [punching, setPunching] = useState(false);
  const [toast, setToast] = useState(null);
  const idSeq = useRef(0);

  const atmStrike = useMemo(() => Math.round(spot / step) * step, [spot, step]);
  const strikes = useMemo(() => {
    const out = [];
    for (let i = -10; i <= 10; i++) out.push(atmStrike + i * step);
    return out;
  }, [atmStrike, step]);

  const showToast = (msg, isErr) => {
    setToast({ msg, isErr });
    setTimeout(() => setToast(null), 3200);
  };

  const premiumFor = useCallback(
    (strike, optionType) => {
      const q = quoteFor(quotes, buildFOSymbol(underlying, expiry, strike, optionType, false));
      return q?.price ?? estimatePremium(spot, strike, optionType, step);
    },
    [quotes, underlying, expiry, spot, step]
  );

  const updateLeg = (id, patch) =>
    setLegs((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        if (patch.strike != null || patch.optionType != null || patch.expiry != null) {
          const type = next.optionType || 'CE';
          next.premium = premiumFor(next.strike, type);
        }
        return next;
      })
    );

  const addLeg = useCallback(() => {
    setLegs((prev) => [
      ...prev,
      {
        id: ++idSeq.current,
        underlying,
        expiry,
        optionType: 'CE',
        strike: atmStrike,
        qty: 1,
        side: 'buy',
        premium: premiumFor(atmStrike, 'CE'),
      },
    ]);
  }, [underlying, expiry, atmStrike, premiumFor]);

  const removeLeg = (id) => setLegs((prev) => prev.filter((l) => l.id !== id));

  const loadPreset = useCallback(
    (key) => {
      const mk = (side, optionType, strike, qty, exp) => ({
        id: ++idSeq.current,
        underlying,
        expiry: exp || expiry,
        optionType,
        strike,
        qty,
        side,
        premium: premiumFor(strike, optionType),
      });
      const up = atmStrike + step;
      const dn = atmStrike - step;
      const farUp = atmStrike + 2 * step;
      const farDn = atmStrike - 2 * step;
      const nextExp = expiries[1]?.code || expiry;
      switch (key) {
        case 'bullCall':
          setLegs([mk('buy', 'CE', atmStrike, 1), mk('sell', 'CE', up, 1)]);
          break;
        case 'bearPut':
          setLegs([mk('buy', 'PE', atmStrike, 1), mk('sell', 'PE', dn, 1)]);
          break;
        case 'ironCondor':
          setLegs([
            mk('buy', 'PE', farDn, 1),
            mk('sell', 'PE', dn, 1),
            mk('sell', 'CE', up, 1),
            mk('buy', 'CE', farUp, 1),
          ]);
          break;
        case 'straddle':
          setLegs([mk('buy', 'CE', atmStrike, 1), mk('buy', 'PE', atmStrike, 1)]);
          break;
        case 'strangle':
          setLegs([mk('buy', 'PE', dn, 1), mk('buy', 'CE', up, 1)]);
          break;
        case 'butterfly':
          setLegs([
            mk('buy', 'CE', dn, 1),
            mk('sell', 'CE', atmStrike, 2),
            mk('buy', 'CE', up, 1),
          ]);
          break;
        case 'calendar':
          setLegs([
            mk('buy', 'CE', atmStrike, 1, nextExp),
            mk('sell', 'CE', atmStrike, 1, expiry),
          ]);
          break;
        default:
          break;
      }
    },
    [underlying, expiry, atmStrike, step, premiumFor, expiries]
  );

  const points = useMemo(() => payoffRange(spot, step), [spot, step]);

  const payoff = useMemo(
    () =>
      points.map((s) =>
        legs.reduce((acc, l) => acc + legPayoff({ ...l, qty: l.qty * lot, underlying }, s), 0)
      ),
    [points, legs, lot]
  );

  const metrics = useMemo(() => {
    if (!legs.length) return null;
    let maxProfit = -Infinity;
    let maxLoss = Infinity;
    const breakevens = [];
    for (let i = 0; i < payoff.length; i++) {
      if (payoff[i] > maxProfit) maxProfit = payoff[i];
      if (payoff[i] < maxLoss) maxLoss = payoff[i];
      if (i > 0 && (payoff[i - 1] < 0) !== (payoff[i] < 0) && payoff[i] !== payoff[i - 1]) {
        const t = -payoff[i - 1] / (payoff[i] - payoff[i - 1]);
        breakevens.push(points[i - 1] + t * (points[i] - points[i - 1]));
      }
    }
    const rising = payoff[payoff.length - 1] - payoff[payoff.length - 2];
    const falling = payoff[1] - payoff[0];
    if (rising > Math.abs(maxLoss) * 0.02 + 1) maxProfit = Infinity;
    if (falling < -(Math.abs(maxProfit) * 0.02 + 1)) maxLoss = -Infinity;
    const netPremium = legs.reduce(
      (acc, l) => acc + (l.side === 'sell' ? 1 : -1) * l.premium * l.qty * lot,
      0
    );
    let margin = Math.max(0, -netPremium);
    legs.forEach((l) => {
      if (l.side === 'sell') margin += 0.09 * l.strike * l.qty * lot + l.premium * l.qty * lot;
    });
    return { maxProfit, maxLoss, breakevens, netPremium, margin };
  }, [legs, payoff, points, lot]);

  const greeks = useMemo(() => {
    if (!legs.length) return null;
    const g = { delta: 0, gamma: 0, theta: 0, vega: 0 };
    legs.forEach((l) => {
      const lg = legGreek(quotes, l, spot, step);
      const dir = l.side === 'buy' ? 1 : -1;
      g.delta += dir * lg.delta * l.qty;
      g.gamma += dir * lg.gamma * l.qty;
      g.theta += dir * lg.theta * l.qty;
      g.vega += dir * lg.vega * l.qty;
    });
    return g;
  }, [legs, quotes, spot, step]);

  const validLegs = legs.filter((l) => l.strike != null && l.expiry);
  const canPunch = validLegs.length > 0 && metrics && metrics.margin <= balance;

  const punchBasket = async () => {
    if (!validLegs.length) return;
    setPunching(true);
    try {
      const basket = {
        type: 'basket',
        underlying,
        productType: 'NRML',
        legs: validLegs.map((l) => ({
          symbol: buildFOSymbol(l.underlying, l.expiry, l.strike, l.optionType, false),
          side: l.side,
          quantity: l.qty * lot,
          orderType: 'MARKET',
        })),
      };
      if (onTrade) {
        onTrade(basket);
        showToast(`Basket punched: ${validLegs.length} leg(s), margin ${fmtINR(metrics.margin, 0)}`, false);
      } else {
        await api.placeBasket(basket.legs);
        showToast(`Basket order placed: ${validLegs.length} leg(s)`, false);
      }
    } catch (e) {
      showToast(e.message || 'Failed to punch basket order', true);
    } finally {
      setPunching(false);
    }
  };

  const W = 640;
  const H = 260;
  const PL = 56;
  const PR = 14;
  const PT = 16;
  const PB = 28;
  const iw = W - PL - PR;
  const ih = H - PT - PB;

  const { xFor, yFor } = useMemo(() => {
    if (!metrics) return { xFor: () => 0, yFor: () => 0 };
    const lo = Math.min(...payoff, 0);
    const hi = Math.max(...payoff, 0);
    const pad = (hi - lo || 1) * 0.12;
    const yLo = lo - pad;
    const yHi = hi + pad;
    const xMin = points[0];
    const xMax = points[points.length - 1];
    return {
      xFor: (s) => PL + ((s - xMin) / (xMax - xMin)) * iw,
      yFor: (v) => PT + (1 - (v - yLo) / (yHi - yLo)) * ih,
    };
  }, [metrics, payoff, points, iw, ih]);

  const linePath = useMemo(() => {
    if (!points.length) return '';
    return points.map((s, i) => `${i ? 'L' : 'M'}${xFor(s).toFixed(1)},${yFor(payoff[i]).toFixed(1)}`).join(' ');
  }, [points, payoff, xFor, yFor]);

  const areaSegments = useMemo(() => {
    if (!points.length) return { gain: '', loss: '' };
    let gain = '';
    let loss = '';
    const y0 = yFor(0);
    for (let i = 0; i < payoff.length - 1; i++) {
      const x1 = xFor(points[i]);
      const x2 = xFor(points[i + 1]);
      const y1 = yFor(payoff[i]);
      const y2 = yFor(payoff[i + 1]);
      const seg = `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}L${x2.toFixed(1)},${y0.toFixed(1)}L${x1.toFixed(1)},${y0.toFixed(1)}Z`;
      const mid = (payoff[i] + payoff[i + 1]) / 2;
      if (mid >= 0) gain += seg;
      else loss += seg;
    }
    return { gain, loss };
  }, [points, payoff, xFor, yFor]);

  const spotX = xFor(spot);
  const [hover, setHover] = useState(null);

  const onChartMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const xMin = points[0];
    const xMax = points[points.length - 1];
    const s = xMin + ((px - PL) / iw) * (xMax - xMin);
    let best = 0;
    let bd = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p - s);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover({ i: best, s: points[best], v: payoff[best] });
  };

  return (
    <div className="sb-page">
      <div className="sb-header">
        <div className="sb-title-wrap">
          <span className="sb-title">Strategy Builder</span>
          <span className="sb-sub">{spec.label} · Lot {lot} · {expiryLabel(expiries.find((e) => e.code === expiry))}</span>
        </div>
        <label className="sb-field">
          <span className="sb-label">Expiry</span>
          <select className="sb-input" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            {expiries.map((e) => (
              <option key={e.code} value={e.code}>{expiryLabel(e)}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="sb-grid">
        <div className="sb-col">
          <div className="sb-card">
            <div className="sb-card-head">
              <span className="sb-card-title">Strategy Presets</span>
              <TrendingUp size={14} color={C.accent} />
            </div>
            <div className="sb-presets">
              {PRESETS.map((p) => (
                <button key={p.key} className="sb-preset" onClick={() => loadPreset(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sb-card">
            <div className="sb-card-head">
              <span className="sb-card-title">Legs ({legs.length})</span>
              <button className="sb-add" onClick={addLeg}>
                <Plus size={13} /> Add Leg
              </button>
            </div>
            {legs.length === 0 && (
              <div className="sb-empty">Add legs manually or pick a preset above</div>
            )}
            <div className="sb-legs">
              {legs.map((l, idx) => (
                <div key={l.id} className="sb-leg">
                  <span className="sb-leg-num">{idx + 1}</span>
                  <select
                    className={`sb-input sb-side ${l.side}`}
                    value={l.side}
                    onChange={(e) => updateLeg(l.id, { side: e.target.value })}
                  >
                    <option value="buy">BUY</option>
                    <option value="sell">SELL</option>
                  </select>
                  <select
                    className="sb-input"
                    value={l.optionType}
                    onChange={(e) => updateLeg(l.id, { optionType: e.target.value })}
                  >
                    <option value="CE">CE</option>
                    <option value="PE">PE</option>
                  </select>
                  <select
                    className="sb-input sb-strike"
                    value={l.strike}
                    onChange={(e) => updateLeg(l.id, { strike: Number(e.target.value) })}
                  >
                    {strikes.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <select
                    className="sb-input sb-exp"
                    value={l.expiry}
                    onChange={(e) => updateLeg(l.id, { expiry: e.target.value })}
                  >
                    {expiries.map((e) => (
                      <option key={e.code} value={e.code}>{expiryLabel(e)}</option>
                    ))}
                  </select>
                  <input
                    className="sb-input sb-qty"
                    type="number"
                    min="1"
                    step="1"
                    value={l.qty}
                    onChange={(e) => updateLeg(l.id, { qty: Math.max(1, Number(e.target.value) || 1) })}
                  />
                  <input
                    className="sb-input sb-prem"
                    type="number"
                    min="0"
                    step="0.5"
                    value={l.premium?.toFixed(2)}
                    onChange={(e) => updateLeg(l.id, { premium: Math.max(0, Number(e.target.value) || 0) })}
                  />
                  <button className="sb-del" onClick={() => removeLeg(l.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="sb-adv">
            <AdvancedChart
              symbol={CHART_SYMBOL[underlying] || underlying}
              label={spec.label}
              quote={quotes[underlying] || quoteFor(quotes, underlying) || undefined}
            />
          </div>
        </div>

        <div className="sb-col">
          <div className="sb-card">
            <div className="sb-card-head">
              <span className="sb-card-title">Payoff at Expiry</span>
              {metrics && (
                <span className={`sb-net ${metrics.netPremium >= 0 ? 'pos' : 'neg'}`}>
                  {metrics.netPremium >= 0 ? 'Net Credit' : 'Net Debit'} {fmtINR(Math.abs(metrics.netPremium), 0)}
                </span>
              )}
            </div>
            <div className="sb-chart" onMouseMove={onChartMove} onMouseLeave={() => setHover(null)}>
              {legs.length === 0 ? (
                <div className="sb-empty sb-empty-chart">No legs yet</div>
              ) : (
                <svg viewBox={`0 0 ${W} ${H}`} className="sb-svg" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="sbGain" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.gain} stopOpacity="0.35" />
                      <stop offset="100%" stopColor={C.gain} stopOpacity="0.02" />
                    </linearGradient>
                    <linearGradient id="sbLoss" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.loss} stopOpacity="0.02" />
                      <stop offset="100%" stopColor={C.loss} stopOpacity="0.35" />
                    </linearGradient>
                  </defs>
                  <line x1={PL} y1={yFor(0)} x2={W - PR} y2={yFor(0)} stroke={C.muted} strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
                  {[-0.5, 0.5].map((f) => {
                    const v = (Math.max(...payoff) + Math.min(...payoff)) * f;
                    return (
                      <line key={f} x1={PL} y1={yFor(v)} x2={W - PR} y2={yFor(v)} stroke={C.border} strokeWidth="1" />
                    );
                  })}
                  <path d={areaSegments.gain} fill="url(#sbGain)" />
                  <path d={areaSegments.loss} fill="url(#sbLoss)" />
                  <path d={linePath} fill="none" stroke={C.accent} strokeWidth="2" strokeLinejoin="round" />
                  {metrics.breakevens.map((b, i) => (
                    <g key={i}>
                      <circle cx={xFor(b)} cy={yFor(0)} r="3.5" fill={C.bg} stroke={C.muted} strokeWidth="1.5" />
                      <text x={xFor(b)} y={H - 8} textAnchor="middle" fontSize="9" fill={C.muted} fontFamily="JetBrains Mono, monospace">
                        {Math.round(b).toLocaleString('en-IN')}
                      </text>
                    </g>
                  ))}
                  <line x1={spotX} y1={PT} x2={spotX} y2={H - PB} stroke={C.muted} strokeWidth="1" strokeDasharray="4 3" />
                  <text x={spotX} y={PT + 8} textAnchor="middle" fontSize="9" fill={C.muted} fontFamily="JetBrains Mono, monospace">
                    {Math.round(spot).toLocaleString('en-IN')}
                  </text>
                  {hover && (
                    <g>
                      <line x1={xFor(hover.s)} y1={PT} x2={xFor(hover.s)} y2={H - PB} stroke={C.text} strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
                      <circle cx={xFor(hover.s)} cy={yFor(hover.v)} r="4" fill={hover.v >= 0 ? C.gain : C.loss} stroke={C.bg} strokeWidth="1.5" />
                    </g>
                  )}
                  <text x={6} y={yFor(Math.max(...payoff)) + 10} fontSize="9" fill={C.gain} fontFamily="JetBrains Mono, monospace">
                    {fmtINR(Math.max(...payoff), 0)}
                  </text>
                  <text x={6} y={yFor(Math.min(...payoff)) - 4} fontSize="9" fill={C.loss} fontFamily="JetBrains Mono, monospace">
                    {fmtINR(Math.min(...payoff), 0)}
                  </text>
                </svg>
              )}
            </div>
          </div>

          <div className="sb-card">
            <div className="sb-metrics">
              <div className="sb-metric">
                <span className="sb-m-label">Max Profit</span>
                <span className="sb-m-val pos">
                  {metrics ? (metrics.maxProfit === Infinity ? '∞' : fmtINR(metrics.maxProfit, 0)) : '—'}
                </span>
              </div>
              <div className="sb-metric">
                <span className="sb-m-label">Max Loss</span>
                <span className="sb-m-val neg">
                  {metrics ? (metrics.maxLoss === -Infinity ? '∞' : fmtINR(metrics.maxLoss, 0)) : '—'}
                </span>
              </div>
              <div className="sb-metric">
                <span className="sb-m-label">Breakevens</span>
                <span className="sb-m-val">
                  {metrics ? metrics.breakevens.map((b) => Math.round(b).toLocaleString('en-IN')).join(', ') || '—' : '—'}
                </span>
              </div>
              <div className="sb-metric">
                <span className="sb-m-label">Net Premium</span>
                <span className={`sb-m-val ${metrics && metrics.netPremium >= 0 ? 'pos' : 'neg'}`}>
                  {metrics ? `${metrics.netPremium >= 0 ? '+' : ''}${fmtINR(metrics.netPremium, 0)}` : '—'}
                </span>
              </div>
              <div className="sb-metric">
                <span className="sb-m-label">Margin Req.</span>
                <span className={`sb-m-val ${metrics && metrics.margin > balance ? 'neg' : ''}`}>
                  {metrics ? fmtINR(metrics.margin, 0) : '—'}
                </span>
              </div>
              <div className="sb-metric">
                <span className="sb-m-label">Balance</span>
                <span className="sb-m-val">{fmtINR(balance, 0)}</span>
              </div>
            </div>
          </div>

          <div className="sb-card">
            <div className="sb-card-head">
              <span className="sb-card-title">Position Greeks</span>
              <TrendingDown size={14} color={C.accent} />
            </div>
            <div className="sb-greeks">
              {['delta', 'gamma', 'theta', 'vega'].map((k) => (
                <div key={k} className="sb-greek">
                  <span className="sb-g-label">{k[0].toUpperCase() + k.slice(1)}</span>
                  <span className={`sb-g-val ${greeks && greeks[k] > 0 ? 'pos' : greeks && greeks[k] < 0 ? 'neg' : ''}`}>
                    {greeks ? greeks[k].toFixed(2) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="sb-card sb-punch-card">
            {metrics && metrics.margin > balance && (
              <div className="sb-warn">
                <AlertTriangle size={14} />
                <span>Margin required exceeds available balance</span>
              </div>
            )}
            <button className="sb-punch" onClick={punchBasket} disabled={!validLegs.length || punching || (metrics && metrics.margin > balance)}>
              {punching ? 'Punching…' : `Punch Basket Order (${validLegs.length} leg${validLegs.length === 1 ? '' : 's'})`}
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className={`sb-toast ${toast.isErr ? 'err' : 'ok'}`}>
          {toast.isErr ? <AlertTriangle size={14} /> : <TrendingUp size={14} />}
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}
