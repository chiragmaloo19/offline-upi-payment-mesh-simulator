import { useState } from 'react';
import { api } from '../services/api';
import { addToast } from './Toast';

const DEVICES = ['phone-alice', 'phone-stranger1', 'phone-stranger2', 'phone-stranger3', 'phone-bridge'];

export default function PaymentForm({ accounts, onSuccess }) {
  const [form, setForm] = useState({
    senderVpa: '',
    receiverVpa: '',
    amount: '',
    pin: '',
    startDevice: 'phone-alice',
    ttl: 5,
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { ok, packetId, error }

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const vpaOptions = accounts.length
    ? accounts.map(a => <option key={a.vpa} value={a.vpa}>{a.holderName} ({a.vpa})</option>)
    : <option value="">Loading accounts…</option>;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amt = parseFloat(form.amount);
    if (!form.senderVpa || !form.receiverVpa) return addToast('Select sender and receiver', 'error');
    if (form.senderVpa === form.receiverVpa) return addToast('Sender and receiver must differ', 'error');
    if (isNaN(amt) || amt <= 0) return addToast('Enter a valid positive amount', 'error');
    if (!form.pin) return addToast('PIN is required', 'error');

    setLoading(true);
    setResult(null);
    try {
      const data = await api.sendPayment({
        senderVpa: form.senderVpa,
        receiverVpa: form.receiverVpa,
        amount: amt,
        pin: form.pin,
        ttl: Number(form.ttl) || 5,
        startDevice: form.startDevice,
      });
      setResult({ ok: true, packetId: data.packetId, injectedAt: data.injectedAt, ttl: data.ttl });
      addToast(`Payment packet injected at ${data.injectedAt}`, 'success');
      setForm(prev => ({ ...prev, amount: '', pin: '' }));
      onSuccess?.();
    } catch (err) {
      setResult({ ok: false, error: err.message });
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card payment-section">
      <div className="card-header">
        <span className="card-title">Send Offline Payment</span>
        <span className="crypto-badge">Encrypted</span>
      </div>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">From</label>
              <select className="form-control" value={form.senderVpa} onChange={e => set('senderVpa', e.target.value)} required>
                <option value="">Select sender…</option>
                {vpaOptions}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">To</label>
              <select className="form-control" value={form.receiverVpa} onChange={e => set('receiverVpa', e.target.value)} required>
                <option value="">Select receiver…</option>
                {vpaOptions}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Amount (₹)</label>
              <input className="form-control" type="number" min="0.01" step="0.01"
                placeholder="e.g. 500" value={form.amount}
                onChange={e => set('amount', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">PIN</label>
              <input className="form-control" type="password" maxLength={6}
                placeholder="••••" value={form.pin}
                onChange={e => set('pin', e.target.value)} required />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Start Device</label>
              <select className="form-control" value={form.startDevice} onChange={e => set('startDevice', e.target.value)}>
                {DEVICES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">TTL (hops)</label>
              <input className="form-control" type="number" min={1} max={10}
                value={form.ttl} onChange={e => set('ttl', e.target.value)} />
            </div>
          </div>

          <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
            {loading ? (
              <><span className="btn-spinner" /> Processing…</>
            ) : (
              '⬆ Send Offline Payment'
            )}
          </button>
        </form>

        {result && (
          <div className={`payment-result ${result.ok ? 'success' : 'error'}`}>
            {result.ok ? (
              <>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>✓ Payment packet created</div>
                <table className="result-table">
                  <tbody>
                    <tr>
                      <td>Origin</td>
                      <td>{result.injectedAt}</td>
                    </tr>
                    <tr>
                      <td>Packet ID</td>
                      <td title={result.packetId} style={{ cursor: 'help' }}>
                        {result.packetId.substring(0, 8)}...{result.packetId.slice(-5)}
                      </td>
                    </tr>
                    <tr>
                      <td>TTL</td>
                      <td>{result.ttl} hops</td>
                    </tr>
                    <tr>
                      <td>Status</td>
                      <td>Waiting for mesh propagation</td>
                    </tr>
                  </tbody>
                </table>
              </>
            ) : (
              <><strong>✕ Failed:</strong> {result.error}</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
