import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Layout,
  Save,
  Trash2,
  Plus,
  Grid,
  Copy,
  Download,
  Upload,
  Check,
  X,
  ChevronDown,
  FilePlus2,
  PanelTop,
} from 'lucide-react';

const STORAGE_KEY = 'bt_chart_layouts';

const GRID_OPTIONS = [
  { id: '1x1', label: 'Single', gridTemplate: 'repeat(1, 1fr) / repeat(1, 1fr)', count: 1 },
  { id: '1x2', label: 'Vertical Split', gridTemplate: 'repeat(1, 1fr) / repeat(2, 1fr)', count: 2 },
  { id: '2x1', label: 'Horizontal Split', gridTemplate: 'repeat(2, 1fr) / repeat(1, 1fr)', count: 2 },
  { id: '2x2', label: 'Quad', gridTemplate: 'repeat(2, 1fr) / repeat(2, 1fr)', count: 4 },
];

const CHART_TYPES = ['line', 'candles', 'area', 'bars'];

const generateId = () =>
  `layout_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const createLayoutFromCurrent = (name, props) => ({
  id: generateId(),
  name,
  symbol: props.currentSymbol,
  timeframe: props.currentTimeframe,
  chartType: props.currentChartType,
  indicators: props.currentIndicators ? { ...props.currentIndicators } : {},
  drawings: [],
  createdAt: Date.now(),
});

const formatDate = (ts) => {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getIndicatorSummary = (indicators) => {
  if (!indicators) return 'None';
  const active = Object.entries(indicators).filter(([, cfg]) => cfg && (cfg.enabled || cfg.params));
  if (!active.length) return 'None';
  return active.map(([name]) => name.toUpperCase()).join(', ');
};

const MiniChartPreview = ({ layout }) => {
  const bars = useMemo(() => {
    let seed = 0;
    for (const ch of (layout.symbol || 'BTC')) seed += ch.charCodeAt(0);
    const pts = [];
    let v = 50;
    for (let i = 0; i < 24; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      v += ((seed / 233280) - 0.5) * 8;
      v = Math.max(8, Math.min(92, v));
      pts.push(v);
    }
    return pts;
  }, [layout.symbol]);

  const points = bars
    .map((v, i) => `${(i / (bars.length - 1)) * 100},${100 - v}`)
    .join(' ');

  return (
    <div
      style={{
        width: 84,
        height: 48,
        flexShrink: 0,
        borderRadius: 4,
        background: '#0d1117',
        border: '1px solid #2a2e39',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {layout.chartType === 'line' || layout.chartType === 'area' ? (
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          {layout.chartType === 'area' && (
            <polygon points={`0,100 ${points} 100,100`} fill="#2962ff" fillOpacity="0.15" />
          )}
          <polyline
            points={points}
            fill="none"
            stroke="#2962ff"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : (
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          {bars.map((v, i) => {
            const bw = 100 / bars.length;
            const isUp = i === 0 || v >= bars[i - 1];
            return (
              <line
                key={i}
                x1={i * bw + bw / 2}
                y1={100 - Math.max(...bars) - 4}
                x2={i * bw + bw / 2}
                y2={100 - v}
                stroke={isUp ? '#089981' : '#f23645'}
                strokeWidth="1"
              />
            );
          })}
        </svg>
      )}
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: 4,
          fontSize: 7,
          fontWeight: 700,
          color: '#d1d4dc',
          letterSpacing: 0.4,
        }}
      >
        {layout.symbol}
      </span>
    </div>
  );
};

export default function ChartLayoutManager({
  currentSymbol = 'BTCUSDT',
  currentTimeframe = '1h',
  currentIndicators = {},
  currentChartType = 'candles',
  onLoad,
  showToast,
}) {
  const [layouts, setLayouts] = useState([]);
  const [activeLayoutId, setActiveLayoutId] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [gridView, setGridView] = useState('1x1');
  const [autoSave, setAutoSave] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [previewIds, setPreviewIds] = useState([]);
  const [duplicateId, setDuplicateId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);

  const currentLayout = useMemo(
    () => layouts.find((l) => l.id === activeLayoutId) || null,
    [layouts, activeLayoutId]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setLayouts(parsed);
          if (parsed.length) setActiveLayoutId(parsed[0].id);
        }
      }
    } catch (e) {
      console.error('Failed to load chart layouts', e);
    }
  }, []);

  useEffect(() => {
    if (layouts.length) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
      } catch (e) {
        console.error('Failed to persist chart layouts', e);
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [layouts]);

  useEffect(() => {
    if (!autoSave) return;
    if (!currentSymbol && !currentTimeframe) return;
    const timer = setTimeout(() => {
      setLayouts((prev) => {
        const snapshot = prev.find((l) => l.id === '__autosave__');
        const next = {
          id: '__autosave__',
          name: 'Auto-Saved Layout',
          symbol: currentSymbol,
          timeframe: currentTimeframe,
          chartType: currentChartType,
          indicators: currentIndicators ? { ...currentIndicators } : {},
          drawings: snapshot ? snapshot.drawings : [],
          createdAt: Date.now(),
        };
        const others = prev.filter((l) => l.id !== '__autosave__');
        return [next, ...others];
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [currentSymbol, currentTimeframe, currentChartType, currentIndicators, autoSave]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectLayout = useCallback(
    (layout) => {
      setActiveLayoutId(layout.id);
      setDropdownOpen(false);
      if (onLoad && layout.id !== '__autosave__') {
        onLoad(layout);
        showToast && showToast(`Loaded layout "${layout.name}"`);
      }
    },
    [onLoad, showToast]
  );

  const handleSaveLayout = useCallback(() => {
    const name = saveName.trim() || `Layout ${layouts.filter((l) => l.id !== '__autosave__').length + 1}`;
    const existingNamed = layouts.find((l) => l.name === name);
    if (existingNamed && existingNamed.id !== duplicateId) {
      showToast && showToast(`A layout named "${name}" already exists`);
      return;
    }
    const layout = {
      id: duplicateId || generateId(),
      name,
      symbol: currentSymbol,
      timeframe: currentTimeframe,
      chartType: currentChartType,
      indicators: currentIndicators ? { ...currentIndicators } : {},
      drawings: currentLayout ? [...currentLayout.drawings] : [],
      createdAt: Date.now(),
    };
    setLayouts((prev) => {
      const others = prev.filter((l) => l.id !== layout.id);
      return [layout, ...others];
    });
    setActiveLayoutId(layout.id);
    setSaveDialogOpen(false);
    setSaveName('');
    setDuplicateId(null);
    showToast && showToast(`Saved layout "${name}"`);
  }, [
    saveName,
    layouts,
    currentSymbol,
    currentTimeframe,
    currentChartType,
    currentIndicators,
    currentLayout,
    duplicateId,
    showToast,
  ]);

  const handleQuickSave = useCallback(() => {
    const layout = createLayoutFromCurrent(
      `Layout ${layouts.filter((l) => l.id !== '__autosave__').length + 1}`,
      { currentSymbol, currentTimeframe, currentChartType, currentIndicators }
    );
    setLayouts((prev) => [layout, ...prev.filter((l) => l.id !== '__autosave__')]);
    setActiveLayoutId(layout.id);
    showToast && showToast(`Saved layout "${layout.name}"`);
  }, [layouts, currentSymbol, currentTimeframe, currentChartType, currentIndicators, showToast]);

  const handleDeleteLayout = useCallback(
    (id) => {
      setLayouts((prev) => prev.filter((l) => l.id !== id));
      if (activeLayoutId === id) setActiveLayoutId(null);
      setDeleteConfirmId(null);
      showToast && showToast('Layout deleted');
    },
    [activeLayoutId, showToast]
  );

  const handleDuplicateLayout = useCallback(
    (layout) => {
      const copyLayout = {
        ...JSON.parse(JSON.stringify(layout)),
        id: generateId(),
        name: `${layout.name} (Copy)`,
        createdAt: Date.now(),
      };
      setLayouts((prev) => [copyLayout, ...prev]);
      showToast && showToast(`Duplicated "${layout.name}"`);
    },
    [showToast]
  );

  const handleExportLayouts = useCallback(() => {
    const data = JSON.stringify(layouts, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bt-chart-layouts-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast && showToast(`Exported ${layouts.length} layout(s)`);
  }, [layouts, showToast]);

  const handleExportSingle = useCallback(
    (layout) => {
      const data = JSON.stringify(layout, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${layout.name.replace(/[^a-z0-9_-]+/gi, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast && showToast(`Exported "${layout.name}"`);
    },
    [showToast]
  );

  const handleImportLayouts = useCallback(
    (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          const incoming = Array.isArray(parsed) ? parsed : [parsed];
          const valid = incoming.filter(
            (l) => l && typeof l === 'object' && (l.symbol || l.name)
          );
          if (!valid.length) {
            showToast && showToast('No valid layouts found in file');
            return;
          }
          const imported = valid.map((l) => ({
            ...l,
            id: generateId(),
            name: l.name || `Imported ${l.symbol || 'Layout'}`,
            symbol: l.symbol || currentSymbol,
            timeframe: l.timeframe || currentTimeframe,
            chartType: l.chartType || currentChartType,
            indicators: l.indicators || {},
            drawings: Array.isArray(l.drawings) ? l.drawings : [],
            createdAt: Date.now(),
          }));
          setLayouts((prev) => [...imported, ...prev]);
          setActiveLayoutId(imported[0].id);
          showToast && showToast(`Imported ${imported.length} layout(s)`);
        } catch (e) {
          showToast && showToast('Failed to import: invalid JSON file');
        }
      };
      reader.readAsText(file);
    },
    [currentSymbol, currentTimeframe, currentChartType, showToast]
  );

  useEffect(() => {
    const handleKeyDown = (e) => {
      const inInput = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (inInput) return;
        setSaveDialogOpen(true);
        setSaveName('');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        if (inInput) return;
        if (currentLayout) {
          onLoad && onLoad(currentLayout);
          showToast && showToast(`Loaded layout "${currentLayout.name}"`);
        } else {
          showToast && showToast('No layout to load');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentLayout, onLoad, showToast]);

  const togglePreview = useCallback((id) => {
    setPreviewIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id].slice(-4)
    );
  }, []);

  const activeGrid = GRID_OPTIONS.find((g) => g.id === gridView) || GRID_OPTIONS[0];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 10,
        background: '#131722',
        border: '1px solid #2a2e39',
        borderRadius: 8,
        color: '#d1d4dc',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Layout size={15} color="#2962ff" />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Chart Layouts</span>
          {currentLayout && (
            <span
              style={{
                fontSize: 10,
                color: '#8b93a7',
                background: '#1e222d',
                padding: '2px 8px',
                borderRadius: 10,
              }}
            >
              {currentLayout.name}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: 4 }}>
            <Grid size={13} color="#8b93a7" />
            {GRID_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                title={opt.label}
                onClick={() => setGridView(opt.id)}
                style={{
                  padding: '4px 7px',
                  borderRadius: 4,
                  border: '1px solid #2a2e39',
                  background: gridView === opt.id ? '#2962ff' : '#1e222d',
                  color: gridView === opt.id ? '#fff' : '#8b93a7',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {opt.id}
              </button>
            ))}
          </div>

          <button
            title="Import layouts from JSON"
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '5px 8px',
              borderRadius: 4,
              border: '1px solid #2a2e39',
              background: '#1e222d',
              color: '#d1d4dc',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
            }}
          >
            <Upload size={12} /> Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportLayouts}
          />

          <button
            title="Export all layouts as JSON"
            onClick={handleExportLayouts}
            style={{
              padding: '5px 8px',
              borderRadius: 4,
              border: '1px solid #2a2e39',
              background: '#1e222d',
              color: '#d1d4dc',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
            }}
          >
            <Download size={12} /> Export
          </button>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              cursor: 'pointer',
              fontSize: 11,
              color: autoSave ? '#089981' : '#8b93a7',
            }}
          >
            <input
              type="checkbox"
              checked={autoSave}
              onChange={(e) => setAutoSave(e.target.checked)}
              style={{ accentColor: '#089981', cursor: 'pointer' }}
            />
            Auto-save
          </label>
        </div>
      </div>

      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen((o) => !o)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '7px 10px',
            borderRadius: 6,
            border: '1px solid #2a2e39',
            background: '#1e222d',
            color: '#d1d4dc',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PanelTop size={13} color="#2962ff" />
            {currentLayout ? (
              <span>
                {currentLayout.name}{' '}
                <span style={{ color: '#8b93a7', fontSize: 10 }}>
                  {currentLayout.symbol} · {currentLayout.timeframe} · {currentLayout.chartType}
                </span>
              </span>
            ) : (
              <span style={{ color: '#8b93a7' }}>Select a layout…</span>
            )}
          </span>
          <ChevronDown
            size={14}
            style={{
              transform: dropdownOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s',
            }}
          />
        </button>

        {dropdownOpen && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              background: '#1e222d',
              border: '1px solid #2a2e39',
              borderRadius: 6,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              zIndex: 100,
              maxHeight: 340,
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 10px',
                borderBottom: '1px solid #2a2e39',
              }}
            >
              <button
                onClick={() => {
                  setSaveDialogOpen(true);
                  setSaveName('');
                  setDuplicateId(null);
                  setDropdownOpen(false);
                }}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  padding: '6px',
                  borderRadius: 4,
                  border: '1px solid #2962ff',
                  background: '#2962ff',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                <Plus size={12} /> Save Current (Ctrl+S)
              </button>
              <button
                onClick={handleQuickSave}
                title="Quick save with auto name"
                style={{
                  padding: '6px',
                  borderRadius: 4,
                  border: '1px solid #2a2e39',
                  background: '#131722',
                  color: '#d1d4dc',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Save size={12} />
              </button>
            </div>

            {layouts.length === 0 && (
              <div
                style={{
                  padding: 18,
                  textAlign: 'center',
                  color: '#8b93a7',
                  fontSize: 11,
                }}
              >
                No saved layouts yet.
                <br />
                Configure your chart and press Save.
              </div>
            )}

            {layouts.map((layout) => (
              <div
                key={layout.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderBottom: '1px solid #1a1f2b',
                  background:
                    layout.id === activeLayoutId ? 'rgba(41,98,255,0.08)' : 'transparent',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    onClick={() => handleSelectLayout(layout)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <MiniChartPreview layout={layout} />
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#d1d4dc',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {layout.id === activeLayoutId && (
                          <Check size={11} color="#089981" style={{ marginRight: 4 }} />
                        )}
                        {layout.name}
                      </div>
                      <div style={{ fontSize: 10, color: '#8b93a7', marginTop: 1 }}>
                        {layout.symbol} · {layout.timeframe} · {layout.chartType}
                      </div>
                      <div style={{ fontSize: 10, color: '#5c6373', marginTop: 1 }}>
                        {getIndicatorSummary(layout.indicators)} · {formatDate(layout.createdAt)}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <button
                    title="Load layout (Ctrl+L)"
                    onClick={() => handleSelectLayout(layout)}
                    style={{
                      padding: 4,
                      borderRadius: 4,
                      border: 'none',
                      background: 'transparent',
                      color: '#2962ff',
                      cursor: 'pointer',
                      display: 'flex',
                    }}
                  >
                    <PanelTop size={13} />
                  </button>
                  <button
                    title="Duplicate"
                    onClick={() => handleDuplicateLayout(layout)}
                    style={{
                      padding: 4,
                      borderRadius: 4,
                      border: 'none',
                      background: 'transparent',
                      color: '#8b93a7',
                      cursor: 'pointer',
                      display: 'flex',
                    }}
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    title="Export layout"
                    onClick={() => handleExportSingle(layout)}
                    style={{
                      padding: 4,
                      borderRadius: 4,
                      border: 'none',
                      background: 'transparent',
                      color: '#8b93a7',
                      cursor: 'pointer',
                      display: 'flex',
                    }}
                  >
                    <Download size={13} />
                  </button>
                  {deleteConfirmId === layout.id ? (
                    <div style={{ display: 'flex', gap: 3 }}>
                      <button
                        onClick={() => handleDeleteLayout(layout.id)}
                        title="Confirm delete"
                        style={{
                          padding: 4,
                          borderRadius: 4,
                          border: 'none',
                          background: '#f23645',
                          color: '#fff',
                          cursor: 'pointer',
                          display: 'flex',
                        }}
                      >
                        <Check size={13} />
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        title="Cancel"
                        style={{
                          padding: 4,
                          borderRadius: 4,
                          border: '1px solid #2a2e39',
                          background: '#131722',
                          color: '#8b93a7',
                          cursor: 'pointer',
                          display: 'flex',
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <button
                      title="Delete"
                      onClick={() => setDeleteConfirmId(layout.id)}
                      style={{
                        padding: 4,
                        borderRadius: 4,
                        border: 'none',
                        background: 'transparent',
                        color: '#f23645',
                        cursor: 'pointer',
                        display: 'flex',
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {saveDialogOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setSaveDialogOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1e222d',
              border: '1px solid #2a2e39',
              borderRadius: 8,
              padding: 18,
              width: 320,
              boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 12,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <FilePlus2 size={15} color="#2962ff" /> Save Chart Layout
            </div>
            <input
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveLayout();
                if (e.key === 'Escape') setSaveDialogOpen(false);
              }}
              placeholder={`e.g. ${currentSymbol} ${currentTimeframe} setup`}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 10px',
                borderRadius: 5,
                border: '1px solid #2a2e39',
                background: '#131722',
                color: '#d1d4dc',
                fontSize: 12,
                outline: 'none',
                marginBottom: 12,
              }}
            />
            <div
              style={{
                fontSize: 10,
                color: '#8b93a7',
                marginBottom: 14,
                lineHeight: 1.5,
              }}
            >
              Captures symbol, timeframe, chart type
              {Object.keys(currentIndicators || {}).length > 0 &&
                ` and ${Object.keys(currentIndicators).length} indicator(s)`}
              .
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setSaveDialogOpen(false)}
                style={{
                  padding: '7px 12px',
                  borderRadius: 5,
                  border: '1px solid #2a2e39',
                  background: 'transparent',
                  color: '#8b93a7',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveLayout}
                style={{
                  padding: '7px 14px',
                  borderRadius: 5,
                  border: '1px solid #2962ff',
                  background: '#2962ff',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Save Layout
              </button>
            </div>
          </div>
        </div>
      )}

      {previewIds.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(previewIds.length, 2)}, 1fr)`,
            gap: 8,
          }}
        >
          {previewIds.map((id) => {
            const layout = layouts.find((l) => l.id === id);
            if (!layout) return null;
            const isGain = layout.id === activeLayoutId;
            return (
              <div
                key={id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 8,
                  borderRadius: 6,
                  background: '#1e222d',
                  border: `1px solid ${isGain ? '#089981' : '#2a2e39'}`,
                  cursor: 'pointer',
                }}
                onClick={() => handleSelectLayout(layout)}
              >
                <MiniChartPreview layout={layout} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: isGain ? '#089981' : '#d1d4dc',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {layout.name}
                  </div>
                  <div style={{ fontSize: 10, color: '#8b93a7', marginTop: 2 }}>
                    {layout.symbol} · {layout.timeframe} · {layout.chartType}
                  </div>
                  <div style={{ fontSize: 10, color: '#5c6373', marginTop: 2 }}>
                    Indicators: {getIndicatorSummary(layout.indicators)}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePreview(id);
                  }}
                  title="Remove preview"
                  style={{
                    padding: 4,
                    borderRadius: 4,
                    border: 'none',
                    background: 'transparent',
                    color: '#8b93a7',
                    cursor: 'pointer',
                    display: 'flex',
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 10,
          color: '#5c6373',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <span>
          Grid: {activeGrid.label} ({activeGrid.count} chart{activeGrid.count > 1 ? 's' : ''}) ·{' '}
          {layouts.length} saved
        </span>
        <span>Ctrl+S save · Ctrl+L load</span>
      </div>
    </div>
  );
}
