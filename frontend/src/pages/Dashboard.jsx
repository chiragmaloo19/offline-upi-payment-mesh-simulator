import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { addToast } from '../components/Toast';
import AccountCard from '../components/AccountCard';
import PaymentForm from '../components/PaymentForm';
import MeshNetwork from '../components/MeshNetwork';
import SimulationControls from '../components/SimulationControls';
import TransactionTable from '../components/TransactionTable';

export default function Dashboard() {
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [meshState, setMeshState] = useState(null);
  const [txLoading, setTxLoading] = useState(true);
  const [gossiping, setGossiping] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try { setAccounts(await api.getAccounts()); }
    catch { /* silently handled — DB may be offline */ }
  }, []);

  const fetchTransactions = useCallback(async () => {
    setTxLoading(true);
    try { setTransactions(await api.getTransactions()); }
    catch { /* silently handled */ }
    finally { setTxLoading(false); }
  }, []);

  const fetchMesh = useCallback(async () => {
    try { setMeshState(await api.getMeshState()); }
    catch { /* silently handled */ }
  }, []);

  // Targeted refresh — avoids full-page reload feel
  const onRefresh = useCallback(async (what) => {
    if (what === 'mesh' || what === 'all') await fetchMesh();
    if (what === 'accounts' || what === 'all') await fetchAccounts();
    if (what === 'txns' || what === 'all') await fetchTransactions();
  }, [fetchAccounts, fetchTransactions, fetchMesh]);

  // Initial load
  useEffect(() => {
    fetchAccounts();
    fetchTransactions();
    fetchMesh();
  }, []);

  return (
    <main className="dashboard-grid">
      {/* Accounts */}
      <section className="card accounts-section">
        <div className="card-header">
          <span className="card-title">Account Balances</span>
          <button
            className="btn btn-secondary"
            style={{ padding: '5px 12px', fontSize: '.76rem' }}
            onClick={() => fetchAccounts()}
          >↻ Refresh</button>
        </div>
        <div className="card-body">
          {accounts.length === 0 ? (
            <div className="empty-state">
              No accounts found. Make sure MongoDB is running and accounts are seeded.
            </div>
          ) : (
            <div className="accounts-row">
              {accounts.map(a => <AccountCard key={a.vpa} account={a} />)}
            </div>
          )}
        </div>
      </section>

      {/* Payment Form */}
      <PaymentForm
        accounts={accounts}
        onSuccess={() => onRefresh('mesh')}
      />

      {/* Mesh Network */}
      <MeshNetwork meshState={meshState} gossiping={gossiping} />

      {/* Simulation Controls */}
      <SimulationControls
        onRefresh={onRefresh}
        setGossiping={setGossiping}
      />

      {/* How It Works */}
      <section className="howitworks-section">
        <div className="card-header" style={{ border: 'none', paddingBottom: 0 }}>
          <span className="card-title">How Offline Payment Works</span>
        </div>
        <div className="flow-steps fade-in">
          <div className="flow-step">Create Payment</div>
          <div className="flow-arrow">↓</div>
          <div className="flow-step">Encrypt Packet</div>
          <div className="flow-arrow">↓</div>
          <div className="flow-step">Mesh Gossip</div>
          <div className="flow-arrow">↓</div>
          <div className="flow-step">Internet Bridge</div>
          <div className="flow-arrow">↓</div>
          <div className="flow-step">Decrypt & Verify</div>
          <div className="flow-arrow">↓</div>
          <div className="flow-step">Settle Transaction</div>
        </div>
      </section>

      {/* Transactions */}
      <TransactionTable
        transactions={transactions}
        loading={txLoading}
      />
    </main>
  );
}
