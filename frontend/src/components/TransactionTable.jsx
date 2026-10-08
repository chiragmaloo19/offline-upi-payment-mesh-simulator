import StatusBadge from './StatusBadge';

function fmtAmount(raw) {
  if (raw == null) return '—';
  const val = typeof raw === 'object' && raw.$numberDecimal
    ? parseFloat(raw.$numberDecimal)
    : parseFloat(raw);
  return '₹' + val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTime(raw) {
  if (!raw) return '—';
  return new Date(raw).toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function shortVpa(vpa) {
  return vpa?.split('@')[0] ?? vpa;
}

export default function TransactionTable({ transactions, loading }) {
  return (
    <div className="card txns-section">
      <div className="card-header">
        <span className="card-title">Recent Transactions</span>
        <span className="text-sm text-muted">last 20</span>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        <div className="table-wrap">
          {loading ? (
            <div className="section-loading">Loading transactions…</div>
          ) : transactions.length === 0 ? (
            <div className="empty-state">No transactions yet. Send a payment and flush the bridge.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Sender</th>
                  <th>Receiver</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Bridge</th>
                  <th>Hops</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, i) => (
                  <tr key={tx._id ?? i} className="fade-in">
                    <td className="td-mono">{tx.senderVpa}</td>
                    <td className="td-mono">{tx.receiverVpa}</td>
                    <td className="td-amount">{fmtAmount(tx.amount)}</td>
                    <td><StatusBadge status={tx.status} /></td>
                    <td className="td-mono" style={{ fontSize: '.74rem' }}>{tx.bridgeNodeId ?? '—'}</td>
                    <td style={{ textAlign: 'center' }}>{tx.hopCount ?? 0}</td>
                    <td className="td-mono">{fmtTime(tx.settledAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
