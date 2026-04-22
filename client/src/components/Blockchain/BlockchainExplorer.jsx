import { useState, useEffect } from 'react';
import './Blockchain.css';
import { Link, Shield, ShieldCheck, ShieldAlert, Hash, Clock, Package, CheckCircle2, AlertTriangle } from 'lucide-react';
import api from '../../services/api';

function truncate(str, n = 20) {
  if (!str) return '—';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function Block({ block, isLatest }) {
  const [expanded, setExpanded] = useState(false);
  const isGenesis = block.index === 0;
  const trade = block.tradeData;

  return (
    <div className={`block-card ${isGenesis ? 'genesis' : ''} ${isLatest ? 'latest-block' : ''}`}>
      {/* Block Header */}
      <div className="block-header" onClick={() => setExpanded(!expanded)}>
        <div className="block-index">
          <Package size={13} />
          Block #{block.index}
        </div>
        {isGenesis && <span className="genesis-badge">GENESIS</span>}
        {isLatest && !isGenesis && <span className="latest-badge">LATEST</span>}
        <span className="block-expand">{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Trade Type pill */}
      {!isGenesis && (
        <div className={`block-trade-pill ${trade.type === 'buy' ? 'gain' : 'loss'}`}>
          {trade.type?.toUpperCase()} · {trade.symbol} · {trade.quantity} shares @ ₹{trade.price?.toLocaleString('en-IN')}
        </div>
      )}

      {/* Hash display */}
      <div className="block-hash-row">
        <span className="hash-label">Hash</span>
        <span className="hash-val mono">{truncate(block.hash, 32)}</span>
      </div>
      <div className="block-hash-row">
        <span className="hash-label">Prev</span>
        <span className="hash-val mono" style={{ color: 'var(--text-disabled)' }}>{truncate(block.previousHash, 32)}</span>
      </div>

      {/* Timestamp */}
      <div className="block-time">
        <Clock size={11} />
        {new Date(block.timestamp).toLocaleString('en-IN')}
        <span style={{ marginLeft: 'auto', color: 'var(--text-disabled)', fontSize: 10 }}>nonce: {block.nonce}</span>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="block-expanded">
          <div className="block-detail-grid">
            <div className="detail-item">
              <span className="detail-label">Full Hash</span>
              <span className="detail-val mono">{block.hash}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Previous Hash</span>
              <span className="detail-val mono">{block.previousHash}</span>
            </div>
            {!isGenesis && (
              <>
                <div className="detail-item">
                  <span className="detail-label">Trade ID</span>
                  <span className="detail-val mono">{trade.tradeId}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Total Value</span>
                  <span className="detail-val">₹{trade.totalValue?.toLocaleString('en-IN')}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Order Type</span>
                  <span className="detail-val">{trade.orderType?.toUpperCase()}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Executed At</span>
                  <span className="detail-val">{new Date(trade.executedAt).toLocaleString('en-IN')}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function BlockchainExplorer({ trades }) {
  const [chainData, setChainData] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchChain = () => {
    setLoading(true);
    api.getBlockchain()
      .then(data => setChainData(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchChain();
  }, [trades]); // refresh when new trade is made

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const result = await api.verifyChain();
      setVerifyResult(result);
    } catch (e) {
      setVerifyResult({ valid: false, reason: e.message });
    } finally {
      setVerifying(false);
    }
  };

  const chain = chainData?.chain || [];
  const stats = chainData?.stats || {};

  return (
    <div className="blockchain-page">
      {/* Header */}
      <div className="blockchain-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Link size={20} style={{ color: 'var(--accent-primary)' }} />
            <h1 style={{ fontSize: 20, fontWeight: 800 }}>Blockchain Explorer</h1>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Every trade is immutably recorded as a SHA-256 linked block
          </p>
        </div>
        <button className="btn btn-primary" onClick={handleVerify} disabled={verifying}>
          <Shield size={14} />
          {verifying ? 'Verifying…' : 'Verify Chain'}
        </button>
      </div>

      {/* Verify Result */}
      {verifyResult && (
        <div className={`verify-banner ${verifyResult.valid ? 'valid' : 'invalid'}`}>
          {verifyResult.valid
            ? <><ShieldCheck size={16} /> Chain Integrity Verified — All {stats.totalBlocks} blocks are valid</>
            : <><ShieldAlert size={16} /> Chain Integrity Compromised — {verifyResult.reason} at block #{verifyResult.invalidAt}</>
          }
        </div>
      )}

      {/* Stats Bar */}
      <div className="chain-stats-bar">
        {[
          { label: 'Total Blocks', value: stats.totalBlocks || 1, icon: Package },
          { label: 'Total Trades', value: stats.totalTrades || 0, icon: Hash },
          { label: 'Buy Orders', value: stats.totalBuys || 0, icon: CheckCircle2, color: 'var(--gain)' },
          { label: 'Sell Orders', value: stats.totalSells || 0, icon: AlertTriangle, color: 'var(--loss)' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="chain-stat">
            <Icon size={14} style={{ color: color || 'var(--accent-primary)' }} />
            <div className="chain-stat-val" style={{ color }}>{value}</div>
            <div className="chain-stat-label">{label}</div>
          </div>
        ))}
        <div className="chain-stat" style={{ gridColumn: 'span 2' }}>
          <Hash size={14} style={{ color: 'var(--accent-secondary)' }} />
          <div className="chain-stat-val mono" style={{ fontSize: 11 }}>{truncate(stats.latestHash, 28)}</div>
          <div className="chain-stat-label">Latest Block Hash</div>
        </div>
      </div>

      {/* Chain Visual */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 100, borderRadius: 12 }} />)}
        </div>
      ) : (
        <div className="chain-list">
          {[...chain].reverse().map((block, i) => (
            <div key={block.index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Block block={block} isLatest={i === 0 && block.index > 0} />
              {i < chain.length - 1 && (
                <div className="chain-connector">
                  <div className="connector-line" />
                  <span className="connector-label">← linked via previousHash</span>
                  <div className="connector-line" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
