import { useState } from 'react';
import { api } from '../services/api';
import { addToast } from './Toast';
import StatusBadge from './StatusBadge';

export default function SimulationControls({ onRefresh, setGossiping }) {
  const [gossipRounds, setGossipRounds] = useState(1);
  const [gossipLoading, setGossipLoading] = useState(false);
  const [flushLoading, setFlushLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [flushResults, setFlushResults] = useState(null);

  const handleGossip = async () => {
    setGossipLoading(true);
    setGossiping(true);
    try {
      const rounds = Math.max(1, Math.min(10, Number(gossipRounds) || 1));
      const data = await api.runGossip(rounds);
      const transfers = data.transfers ?? data.totalTransfers ?? 0;
      addToast(`Gossip done · ${transfers} transfer${transfers !== 1 ? 's' : ''}${rounds > 1 ? ` across ${rounds} rounds` : ''}`, 'success');
      await onRefresh('mesh');
    } catch (err) {
      addToast('Gossip failed: ' + err.message, 'error');
    } finally {
      setGossipLoading(false);
      setTimeout(() => setGossiping(false), 700);
    }
  };

  const handleFlush = async () => {
    setFlushLoading(true);
    setFlushResults(null);
    try {
      const data = await api.flushBridge();
      setFlushResults(data.results ?? []);
      const settled = (data.results ?? []).filter(r => r.outcome === 'SETTLED').length;
      const dups = (data.results ?? []).filter(r => r.outcome === 'DUPLICATE_DROPPED').length;
      addToast(
        data.uploadsAttempted === 0
          ? 'No packets on bridge to flush'
          : `Flushed ${data.uploadsAttempted} packet(s) · ${settled} settled · ${dups} duplicate`,
        'success'
      );
      await onRefresh('all');
    } catch (err) {
      addToast('Flush failed: ' + err.message, 'error');
    } finally {
      setFlushLoading(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset the mesh simulation?\n\nThis clears all device packets and the idempotency cache.\nAccount balances in MongoDB are NOT affected.')) return;
    setResetLoading(true);
    setFlushResults(null);
    try {
      await api.resetSimulation();
      addToast('Mesh and idempotency cache cleared', 'info');
      await onRefresh('all');
    } catch (err) {
      addToast('Reset failed: ' + err.message, 'error');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="card controls-section">
      <div className="card-header">
        <span className="card-title">Simulation Controls</span>
      </div>
      <div className="card-body">
        <div className="controls-row">
          <span className="controls-label">Rounds:</span>
          <input
            className="gossip-rounds-input"
            type="number"
            min={1} max={10} value={gossipRounds}
            onChange={e => setGossipRounds(e.target.value)}
          />
          <button className="btn btn-secondary" onClick={handleGossip} disabled={gossipLoading}>
            {gossipLoading ? <><span className="btn-spinner" style={{ borderTopColor: 'var(--text)' }} /> Gossiping…</> : '📡 Run Gossip'}
          </button>

          <div className="controls-divider" />

          <button className="btn btn-secondary" onClick={handleFlush} disabled={flushLoading}>
            {flushLoading ? <><span className="btn-spinner" style={{ borderTopColor: 'var(--text)' }} /> Sending…</> : '⬆ Send to Bridge'}
          </button>

          <div className="controls-divider" />

          <button className="btn btn-danger" onClick={handleReset} disabled={resetLoading}>
            {resetLoading ? <><span className="btn-spinner" style={{ borderTopColor: 'var(--danger)' }} /> Resetting…</> : '↺ Reset Simulation'}
          </button>
        </div>

        {flushResults !== null && flushResults.length === 0 && (
          <div className="section-gap">
            <div className="empty-state" style={{ padding: '12px', textAlign: 'left' }}>
              No packets were held by bridge devices.
            </div>
          </div>
        )}

        {flushResults && flushResults.length > 0 && (
          <div className="flush-results fade-in">
            {flushResults.map((r, i) => (
              <div key={i} className="flush-result-item">
                <span className="mono" style={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>{r.bridgeNode}</span>
                <span className="mono" style={{ fontSize: '.72rem', opacity: .6 }}>#{r.packetId}</span>
                <StatusBadge status={r.outcome} />
                {r.reason && <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>{r.reason}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
