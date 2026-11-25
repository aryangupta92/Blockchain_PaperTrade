import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { api, BlockchainBlockDTO, ChainVerificationDTO } from '../apiClient';

export function BlockchainPage() {
  const [filter, setFilter] = useState<'ALL' | 'DEMO' | 'REAL'>('ALL');
  const [verification, setVerification] = useState<ChainVerificationDTO | null>(null);
  const [blocks, setBlocks] = useState<BlockchainBlockDTO[]>([]);
  const [selectedProof, setSelectedProof] = useState<{
    verified: boolean;
    hash: string;
    recalculatedHash: string;
    previousLinkValid: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.blockchainBlocks(filter);
      setVerification(res.verification);
      setBlocks(res.blocks);
    } finally {
      setBusy(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const verifySingle = async (hash: string) => {
    const res = await api.verifyBlockHash(hash);
    setSelectedProof({
      verified: res.verified,
      hash: res.block.hash,
      recalculatedHash: res.block.recalculatedHash,
      previousLinkValid: res.previousLinkValid,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <h3><ShieldCheck size={16} /> Immutable SHA-256 Trade &amp; Ledger Blockchain</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {(['ALL', 'DEMO', 'REAL'] as const).map((m) => (
              <button
                key={m}
                className={`preset-btn ${filter === m ? 'active' : ''}`}
                onClick={() => setFilter(m)}
              >
                {m}
              </button>
            ))}
            <button className="theme-toggle" onClick={load} disabled={busy}>
              <RefreshCw size={13} /> Verify Chain
            </button>
          </div>
        </div>

        {verification && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>CHAIN STATUS</div>
              <div style={{ marginTop: 4 }}>
                <span className={`badge ${verification.valid ? 'badge-gain' : 'badge-warn'}`}>
                  {verification.valid ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  {verification.valid ? 'CRYPTOGRAPHICALLY VERIFIED' : `TAMPER DETECTED (#${verification.invalidAtIndex})`}
                </span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>TOTAL BLOCKS</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{verification.totalBlocks}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>MERKLE ROOT (SHA-256)</div>
              <div className="mono" style={{ fontSize: 11.5, wordBreak: 'break-all', marginTop: 4 }}>
                {verification.merkleRoot}
              </div>
            </div>
          </div>
        )}
      </section>

      {selectedProof && (
        <section className="card" style={{ borderColor: selectedProof.verified ? 'var(--gain)' : 'var(--loss)' }}>
          <h3>Individual Block Cryptographic Proof</h3>
          <div className="mono" style={{ fontSize: 12, lineHeight: 1.7 }}>
            <div>Result: <strong>{selectedProof.verified ? 'VALID — Hash & Chain Link Verified' : 'INVALID'}</strong></div>
            <div>Stored Hash: {selectedProof.hash}</div>
            <div>Recalculated: {selectedProof.recalculatedHash}</div>
            <div>Previous Block Linkage: {selectedProof.previousLinkValid ? 'INTACT' : 'BROKEN'}</div>
          </div>
        </section>
      )}

      <section className="card">
        <h3>Verifiable Blocks ({blocks.length})</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Block #</th>
                <th>Account</th>
                <th>Event Kind</th>
                <th>Timestamp</th>
                <th>Nonce</th>
                <th>SHA-256 Hash</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.hash}>
                  <td className="mono">#{b.index}</td>
                  <td><span className={`badge ${b.accountMode === 'DEMO' ? 'badge-warn' : 'badge-gain'}`}>{b.accountMode}</span></td>
                  <td className="mono">{b.kind}</td>
                  <td className="mono">{new Date(b.timestamp).toLocaleString('en-IN')}</td>
                  <td className="mono">{b.nonce}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{b.hash.slice(0, 22)}...</td>
                  <td>
                    <button className="preset-btn" onClick={() => verifySingle(b.hash)}>
                      Verify Proof
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
