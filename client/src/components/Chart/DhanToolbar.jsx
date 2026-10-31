import { MousePointer2, TrendingUp, Minus, BoxSelect, Percent, Type, Magnet, Ruler, ZoomIn, ZoomOut, RotateCcw, Trash2, Save } from 'lucide-react';

/**
 * TradingView-style left drawing toolbar.
 * Controlled: activeTool in {null,'TRENDLINE','HORIZONTAL','RECTANGLE','FIB','TEXT'}
 */
export default function DhanToolbar({
  activeTool,
  onTool,
  magnet,
  onMagnet,
  onClear,
  onSave,
  saveState,
  onZoomIn,
  onZoomOut,
  onResetView,
  onMeasure,
  measureActive = false,
}) {
  const tools = [
    { id: 'TRENDLINE', icon: <TrendingUp size={15} />, tip: 'Trend line (click 2 points on chart)' },
    { id: 'HORIZONTAL', icon: <Minus size={15} />, tip: 'Horizontal level (click price)' },
    { id: 'RECTANGLE', icon: <BoxSelect size={15} />, tip: 'Rectangle zone (drag 2 corners)' },
    { id: 'FIB', icon: <Percent size={15} />, tip: 'Fibonacci retracement (click swing low then high)' },
    { id: 'TEXT', icon: <Type size={15} />, tip: 'Text note (click chart, type)' },
  ];

  return (
    <div className="cpage-tools" style={{ width: 44 }}>
      {/* Cursor / Select */}
      <button
        className={`cpage-tool-btn ${activeTool === null && !measureActive ? 'active' : ''}`}
        title="Cursor / Select (Esc)"
        onClick={() => onTool(null)}
      >
        <MousePointer2 size={15} />
      </button>

      <div className="cpage-tool-divider" />

      {/* Drawing tools */}
      {tools.map((t) => (
        <button
          key={t.id}
          className={`cpage-tool-btn ${activeTool === t.id ? 'active' : ''}`}
          title={t.tip}
          onClick={() => onTool(activeTool === t.id ? null : t.id)}
        >
          {t.icon}
        </button>
      ))}

      <div className="cpage-tool-divider" />

      {/* Magnet + Measure */}
      <button
        className={`cpage-tool-btn ${magnet ? 'active' : ''}`}
        title="Magnet: snap to OHLC (H/L/C)"
        onClick={onMagnet}
      >
        <Magnet size={15} />
      </button>
      <button
        className={`cpage-tool-btn ${measureActive ? 'active' : ''}`}
        title="Measure tool (click and drag on chart)"
        onClick={onMeasure}
      >
        <Ruler size={15} />
      </button>

      <div className="cpage-tool-divider" />

      {/* Zoom controls */}
      <button className="cpage-tool-btn" title="Zoom in" onClick={onZoomIn}>
        <ZoomIn size={15} />
      </button>
      <button className="cpage-tool-btn" title="Zoom out" onClick={onZoomOut}>
        <ZoomOut size={15} />
      </button>
      <button className="cpage-tool-btn" title="Reset view" onClick={onResetView}>
        <RotateCcw size={15} />
      </button>

      <div className="cpage-tool-divider" />

      {/* Clear + Save */}
      <button className="cpage-tool-btn" title="Delete all drawings for this symbol" onClick={onClear}>
        <Trash2 size={15} />
      </button>
      <button className="cpage-tool-btn" title={saveState || 'Save drawings (auto-saves)'} onClick={onSave}>
        <Save size={15} />
      </button>
    </div>
  );
}
