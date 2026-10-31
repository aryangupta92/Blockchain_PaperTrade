import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Bell, BellOff, Plus, Trash2, Edit, Pause, Play, CheckCircle } from 'lucide-react';

const THEME = {
  bg: '#131722',
  surface: '#1e222d',
  text: '#d1d4dc',
  accent: '#2962ff',
  gain: '#089981',
  loss: '#f23645',
  border: '#2a2e39',
  muted: '#787b86',
};

const DEFAULT_ALERTS = [
  { id: 'seed-1', symbol: 'RELIANCE', condition: 'above', targetPrice: 2950, note: 'Breakout above resistance', active: true, triggered: false, triggeredAt: null, createdAt: Date.now() - 86400000 * 2 },
  { id: 'seed-2', symbol: 'TCS', condition: 'below', targetPrice: 3400, note: 'Buy the dip zone', active: true, triggered: false, triggeredAt: null, createdAt: Date.now() - 86400000 },
];

function fmtPrice(n) {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function calcDistance(current, target, condition) {
  if (!current || !target) return null;
  const pct = ((target - current) / current) * 100;
  return condition === 'above' ? pct : -pct;
}

function SectionTitle({ icon, title, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span style={{ color: THEME.accent, display: 'flex' }}>{icon}</span>
      <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0, color: THEME.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </h3>
      {count != null && (
        <span style={{ fontSize: 11, color: THEME.muted, background: THEME.bg, border: `1px solid ${THEME.border}`, borderRadius: 12, padding: '1px 8px' }}>
          {count}
        </span>
      )}
    </div>
  );
}

function AlertRow({ alert, currentPrice, dist, isNewlyTriggered, onStartEdit, onTogglePause, onDelete, onResetTriggered }) {
  const distColor = dist == null ? THEME.muted : dist >= 0 ? THEME.gain : THEME.loss;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 8,
        background: isNewlyTriggered ? 'rgba(8,153,129,0.15)' : THEME.bg,
        border: `1px solid ${isNewlyTriggered ? THEME.gain : THEME.border}`,
        transition: 'all 0.4s ease',
        animation: isNewlyTriggered ? 'alertPulse 1s ease-in-out 3' : undefined,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: THEME.text }}>{alert.symbol}</span>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 20,
            background: alert.condition === 'above' ? 'rgba(8,153,129,0.15)' : 'rgba(242,54,69,0.15)',
            color: alert.condition === 'above' ? THEME.gain : THEME.loss,
          }}>
            {alert.condition === 'above' ? '▲ ABOVE' : '▼ BELOW'}
          </span>
          {alert.triggered && (
            <span style={{ fontSize: 10, color: THEME.gain, display: 'flex', alignItems: 'center', gap: 3 }}>
              <CheckCircle size={11} /> TRIGGERED
            </span>
          )}
          {!alert.active && !alert.triggered && (
            <span style={{ fontSize: 10, color: THEME.muted, display: 'flex', alignItems: 'center', gap: 3 }}>
              <Pause size={11} /> PAUSED
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: THEME.muted }}>
          Target ₹{fmtPrice(alert.targetPrice)}
          {alert.note && <span style={{ marginLeft: 8, fontStyle: 'italic' }}>“{alert.note}”</span>}
        </div>
        {alert.triggered && alert.triggeredAt && (
          <div style={{ fontSize: 10, color: THEME.gain, marginTop: 2 }}>Triggered at {fmtTime(alert.triggeredAt)}</div>
        )}
      </div>

      <div style={{ textAlign: 'right', minWidth: 80 }}>
        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: THEME.text }}>
          {currentPrice ? '₹' + fmtPrice(currentPrice) : '—'}
        </div>
        <div style={{ fontSize: 11, color: distColor, fontFamily: 'monospace' }}>
          {dist != null ? `${dist >= 0 ? '+' : ''}${dist.toFixed(2)}%` : '—'}
        </div>
      </div>

      {!alert.triggered && (
        <div style={{ display: 'flex', gap: 2 }}>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.muted, padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }} title="Edit" onClick={() => onStartEdit(alert)}>
            <Edit size={14} />
          </button>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.muted, padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }} title={alert.active ? 'Pause' : 'Resume'} onClick={() => onTogglePause(alert.id)}>
            {alert.active ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.loss, padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }} title="Delete" onClick={() => onDelete(alert.id)}>
            <Trash2 size={14} />
          </button>
        </div>
      )}
      {alert.triggered && (
        <div style={{ display: 'flex', gap: 2 }}>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.gain, padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }} title="Reset to active" onClick={() => onResetTriggered(alert.id)}>
            <Play size={14} />
          </button>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.loss, padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }} title="Delete" onClick={() => onDelete(alert.id)}>
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = i === 1 ? 1046.5 : 783.99;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.22);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.22);
    });
  } catch { /* audio not available */ }
}

export default function PriceAlerts({ quotes, watchlist, showToast }) {
  const [alerts, setAlerts] = useState(() => {
    try {
      const saved = localStorage.getItem('price_alerts');
      return saved ? JSON.parse(saved) : DEFAULT_ALERTS;
    } catch {
      return DEFAULT_ALERTS;
    }
  });
  const [symbolInput, setSymbolInput] = useState('');
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);
  const [condition, setCondition] = useState('above');
  const [targetPrice, setTargetPrice] = useState('');
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [filterSymbol, setFilterSymbol] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortByDistance, setSortByDistance] = useState(false);
  const [justTriggeredId, setJustTriggeredId] = useState(null);
  const [notifPermission, setNotifPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  const prevTriggeredRef = useRef({});
  const symbolRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('price_alerts', JSON.stringify(alerts));
  }, [alerts]);

  useEffect(() => {
    const handler = (e) => {
      if (symbolRef.current && !symbolRef.current.contains(e.target)) setShowSymbolDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const checkTriggers = useCallback(() => {
    setAlerts(prev => {
      let changed = false;
      const next = prev.map(a => {
        if (!a.active || a.triggered) return a;
        const q = quotes[a.symbol];
        if (!q || !q.price) return a;
        const hit = a.condition === 'above' ? q.price >= a.targetPrice : q.price <= a.targetPrice;
        if (!hit) return a;
        if (!prevTriggeredRef.current[a.id]) {
          changed = true;
          prevTriggeredRef.current[a.id] = true;
          setJustTriggeredId(a.id);
          playAlertSound();
          if (notifPermission === 'granted') {
            new Notification(`Price Alert: ${a.symbol}`, {
              body: `${a.symbol} is ${a.condition === 'above' ? 'above' : 'below'} ₹${fmtPrice(a.targetPrice)} (LTP ₹${fmtPrice(q.price)})`,
            });
          }
          if (showToast) showToast(`${a.symbol} triggered ${a.condition} ₹${fmtPrice(a.targetPrice)}`, 'success');
          return { ...a, triggered: true, triggeredAt: Date.now(), active: false };
        }
        return a;
      });
      return changed ? next : prev;
    });
  }, [quotes, notifPermission, showToast]);

  useEffect(() => {
    checkTriggers();
  }, [checkTriggers]);

  useEffect(() => {
    if (!justTriggeredId) return;
    const t = setTimeout(() => setJustTriggeredId(null), 4000);
    return () => clearTimeout(t);
  }, [justTriggeredId]);

  const requestNotificationPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
  }, []);

  const filteredSymbols = useMemo(() => {
    const list = watchlist && watchlist.length ? watchlist : ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'WIPRO', 'BAJFINANCE', 'BHARTIARTL', 'AXISBANK', 'KOTAKBANK', 'LT', 'ASIANPAINT', 'MARUTI', 'SUNPHARMA', 'TITAN'];
    const seen = [...new Set(list)];
    if (!symbolInput.trim()) return seen;
    const q = symbolInput.trim().toUpperCase();
    return seen.filter(s => s.includes(q)).slice(0, 8);
  }, [symbolInput, watchlist]);

  const visibleAlerts = useMemo(() => {
    let list = [...alerts];
    if (filterSymbol) list = list.filter(a => a.symbol === filterSymbol);
    if (filterStatus === 'active') list = list.filter(a => a.active && !a.triggered);
    else if (filterStatus === 'triggered') list = list.filter(a => a.triggered);
    else if (filterStatus === 'paused') list = list.filter(a => !a.active && !a.triggered);
    if (sortByDistance) {
      list.sort((a, b) => {
        const da = calcDistance(quotes[a.symbol]?.price, a.targetPrice, a.condition);
        const db = calcDistance(quotes[b.symbol]?.price, b.targetPrice, b.condition);
        const va = da == null ? Infinity : Math.abs(da);
        const vb = db == null ? Infinity : Math.abs(db);
        return va - vb;
      });
    } else {
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    return list;
  }, [alerts, filterSymbol, filterStatus, sortByDistance, quotes]);

  const activeAlerts = useMemo(() => visibleAlerts.filter(a => a.active && !a.triggered), [visibleAlerts]);
  const triggeredAlerts = useMemo(() => visibleAlerts.filter(a => a.triggered).sort((a, b) => (b.triggeredAt || 0) - (a.triggeredAt || 0)), [visibleAlerts]);
  const pausedAlerts = useMemo(() => visibleAlerts.filter(a => !a.active && !a.triggered), [visibleAlerts]);

  const stats = useMemo(() => {
    const todayStart = new Date().setHours(0, 0, 0, 0);
    return {
      active: alerts.filter(a => a.active && !a.triggered).length,
      triggeredToday: alerts.filter(a => a.triggered && a.triggeredAt && a.triggeredAt >= todayStart).length,
      paused: alerts.filter(a => !a.active && !a.triggered).length,
      total: alerts.length,
    };
  }, [alerts]);

  const uniqueSymbols = useMemo(() => [...new Set(alerts.map(a => a.symbol))].sort(), [alerts]);

  const resetForm = useCallback(() => {
    setSymbolInput('');
    setCondition('above');
    setTargetPrice('');
    setNote('');
    setEditingId(null);
    setShowSymbolDropdown(false);
  }, []);

  const handleSubmit = useCallback(() => {
    const price = parseFloat(targetPrice);
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) { if (showToast) showToast('Select a symbol', 'error'); return; }
    if (!price || price <= 0) { if (showToast) showToast('Enter a valid target price', 'error'); return; }

    if (editingId) {
      setAlerts(prev => prev.map(a => a.id === editingId ? { ...a, symbol, condition, targetPrice: price, note: note.trim() } : a));
      if (showToast) showToast(`Alert updated for ${symbol}`, 'success');
    } else {
      const dup = alerts.find(a => a.symbol === symbol && a.condition === condition && a.targetPrice === price && a.active && !a.triggered);
      if (dup) { if (showToast) showToast('An identical active alert already exists', 'error'); return; }
      const newAlert = {
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        symbol,
        condition,
        targetPrice: price,
        note: note.trim(),
        active: true,
        triggered: false,
        triggeredAt: null,
        createdAt: Date.now(),
      };
      setAlerts(prev => [newAlert, ...prev]);
      if (showToast) showToast(`Alert created for ${symbol}`, 'success');
    }
    resetForm();
  }, [symbolInput, condition, targetPrice, note, editingId, alerts, showToast, resetForm]);

  const startEdit = useCallback((alert) => {
    setEditingId(alert.id);
    setSymbolInput(alert.symbol);
    setCondition(alert.condition);
    setTargetPrice(String(alert.targetPrice));
    setNote(alert.note || '');
    setShowSymbolDropdown(false);
  }, []);

  const handleDelete = useCallback((id) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
    if (editingId === id) resetForm();
    if (showToast) showToast('Alert deleted', 'info');
  }, [editingId, resetForm, showToast]);

  const togglePause = useCallback((id) => {
    setAlerts(prev => prev.map(a => {
      if (a.id !== id || a.triggered) return a;
      const newActive = !a.active;
      if (showToast) showToast(`Alert ${newActive ? 'resumed' : 'paused'}`, 'info');
      return { ...a, active: newActive };
    }));
  }, [showToast]);

  const resetTriggered = useCallback((id) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, triggered: false, triggeredAt: null, active: true } : a));
    if (showToast) showToast('Alert reset to active', 'success');
  }, [showToast]);

  const closeForm = useCallback(() => {
    resetForm();
  }, [resetForm]);

  const distFor = useCallback((a) => calcDistance(quotes[a.symbol]?.price, a.targetPrice, a.condition), [quotes]);

  const cardStyle = {
    background: THEME.surface,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
  };

  const inputStyle = {
    background: THEME.bg,
    border: `1px solid ${THEME.border}`,
    borderRadius: 6,
    color: THEME.text,
    padding: '8px 10px',
    fontSize: 13,
    width: '100%',
    outline: 'none',
  };

  const selectStyle = { ...inputStyle, cursor: 'pointer', width: 130 };

  return (
    <div style={{ padding: 20, background: THEME.bg, minHeight: '100vh', color: THEME.text }}>
      <style>{`
        @keyframes alertPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(8,153,129,0); }
          50% { box-shadow: 0 0 0 4px rgba(8,153,129,0.3); }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Bell size={20} style={{ color: THEME.accent }} />
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Price Alerts</h2>
        </div>
        {notifPermission !== 'granted' && (
          <button
            onClick={requestNotificationPermission}
            style={{
              background: 'none',
              border: `1px solid ${THEME.accent}`,
              color: THEME.accent,
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <BellOff size={13} /> Enable Notifications
          </button>
        )}
        {notifPermission === 'granted' && (
          <span style={{ fontSize: 11, color: THEME.gain, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Bell size={13} /> Notifications on
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Active', value: stats.active, color: THEME.accent },
          { label: 'Triggered Today', value: stats.triggeredToday, color: THEME.gain },
          { label: 'Paused', value: stats.paused, color: THEME.muted },
          { label: 'Total Alerts', value: stats.total, color: THEME.text },
        ].map(s => (
          <div key={s.label} style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 0 }}>
            <span style={{ fontSize: 11, color: THEME.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</span>
          </div>
        ))}
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Plus size={15} style={{ color: THEME.accent }} />
          <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {editingId ? 'Edit Alert' : 'New Alert'}
          </h3>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div ref={symbolRef} style={{ position: 'relative', flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: 11, color: THEME.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Symbol</label>
            <input
              style={inputStyle}
              placeholder="Search symbol..."
              value={symbolInput}
              onChange={e => { setSymbolInput(e.target.value); setShowSymbolDropdown(true); }}
              onFocus={() => setShowSymbolDropdown(true)}
            />
            {showSymbolDropdown && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                background: THEME.bg,
                border: `1px solid ${THEME.border}`,
                borderRadius: 6,
                marginTop: 4,
                maxHeight: 180,
                overflowY: 'auto',
                zIndex: 50,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}>
                {filteredSymbols.map(s => (
                  <div
                    key={s}
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      fontSize: 13,
                      display: 'flex',
                      justifyContent: 'space-between',
                      color: symbolInput.toUpperCase() === s ? THEME.accent : THEME.text,
                    }}
                    onMouseDown={() => { setSymbolInput(s); setShowSymbolDropdown(false); }}
                  >
                    <span style={{ fontWeight: 600 }}>{s}</span>
                    {quotes[s]?.price && <span style={{ color: THEME.muted, fontFamily: 'monospace', fontSize: 11 }}>₹{fmtPrice(quotes[s].price)}</span>}
                  </div>
                ))}
                {filteredSymbols.length === 0 && (
                  <div style={{ padding: '8px 12px', fontSize: 12, color: THEME.muted }}>No symbols found</div>
                )}
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: THEME.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Condition</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {['above', 'below'].map(c => (
                <button
                  key={c}
                  onClick={() => setCondition(c)}
                  style={{
                    background: condition === c ? (c === 'above' ? THEME.gain : THEME.loss) : THEME.bg,
                    border: `1px solid ${condition === c ? (c === 'above' ? THEME.gain : THEME.loss) : THEME.border}`,
                    color: condition === c ? '#fff' : THEME.muted,
                    borderRadius: 6,
                    padding: '8px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                  }}
                >
                  {c === 'above' ? '▲' : '▼'} {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: THEME.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target Price (₹)</label>
            <input
              style={{ ...inputStyle, width: 130, fontFamily: 'monospace' }}
              placeholder="0.00"
              type="number"
              min="0"
              step="0.01"
              value={targetPrice}
              onChange={e => setTargetPrice(e.target.value)}
            />
          </div>

          <div style={{ flex: '2 1 180px' }}>
            <label style={{ display: 'block', fontSize: 11, color: THEME.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Note (optional)</label>
            <input
              style={inputStyle}
              placeholder="e.g. Breakout confirmation"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={80}
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSubmit}
              style={{
                background: THEME.accent,
                border: 'none',
                color: '#fff',
                borderRadius: 6,
                padding: '9px 18px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {editingId ? <CheckCircle size={14} /> : <Plus size={14} />}
              {editingId ? 'Update' : 'Create'}
            </button>
            {editingId && (
              <button
                onClick={closeForm}
                style={{
                  background: 'none',
                  border: `1px solid ${THEME.border}`,
                  color: THEME.muted,
                  borderRadius: 6,
                  padding: '9px 14px',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={selectStyle} value={filterSymbol} onChange={e => setFilterSymbol(e.target.value)}>
          <option value="">All Symbols</option>
          {uniqueSymbols.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={selectStyle} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="triggered">Triggered</option>
        </select>
        <button
          onClick={() => setSortByDistance(v => !v)}
          style={{
            background: sortByDistance ? THEME.accent : THEME.surface,
            border: `1px solid ${sortByDistance ? THEME.accent : THEME.border}`,
            color: sortByDistance ? '#fff' : THEME.muted,
            borderRadius: 6,
            padding: '8px 14px',
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {sortByDistance ? 'Sorted by Distance' : 'Sort by Distance'}
        </button>
      </div>

      <div style={cardStyle}>
        <SectionTitle icon={<Bell size={15} />} title="Active Alerts" count={activeAlerts.length} />
        {activeAlerts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: THEME.muted, fontSize: 13 }}>
            No active alerts. Create one above to get started.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeAlerts.map(a => (
              <AlertRow
                key={a.id}
                alert={a}
                currentPrice={quotes[a.symbol]?.price}
                dist={distFor(a)}
                isNewlyTriggered={justTriggeredId === a.id}
                onStartEdit={startEdit}
                onTogglePause={togglePause}
                onDelete={handleDelete}
                onResetTriggered={resetTriggered}
              />
            ))}
          </div>
        )}
      </div>

      {pausedAlerts.length > 0 && (
        <div style={cardStyle}>
          <SectionTitle icon={<Pause size={15} />} title="Paused Alerts" count={pausedAlerts.length} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pausedAlerts.map(a => (
              <AlertRow
                key={a.id}
                alert={a}
                currentPrice={quotes[a.symbol]?.price}
                dist={distFor(a)}
                isNewlyTriggered={false}
                onStartEdit={startEdit}
                onTogglePause={togglePause}
                onDelete={handleDelete}
                onResetTriggered={resetTriggered}
              />
            ))}
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <SectionTitle icon={<CheckCircle size={15} />} title="Triggered History" count={triggeredAlerts.length} />
        {triggeredAlerts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: THEME.muted, fontSize: 13 }}>
            No triggered alerts yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {triggeredAlerts.map(a => (
              <AlertRow
                key={a.id}
                alert={a}
                currentPrice={quotes[a.symbol]?.price}
                dist={distFor(a)}
                isNewlyTriggered={justTriggeredId === a.id}
                onStartEdit={startEdit}
                onTogglePause={togglePause}
                onDelete={handleDelete}
                onResetTriggered={resetTriggered}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
