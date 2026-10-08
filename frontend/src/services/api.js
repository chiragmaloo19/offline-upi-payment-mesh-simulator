const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
  }
  return res.json();
}

export const api = {
  getHealth:      ()       => request('/health'),
  getAccounts:    ()       => request('/accounts'),
  getTransactions:()       => request('/transactions'),
  getMeshState:   ()       => request('/mesh/state'),
  getServerKey:   ()       => request('/server-key'),

  sendPayment: (payload)   => request('/demo/send', { method: 'POST', body: JSON.stringify(payload) }),
  runGossip:   (rounds=1)  => request(`/mesh/gossip${rounds > 1 ? `?rounds=${rounds}` : ''}`, { method: 'POST' }),
  flushBridge: ()          => request('/mesh/flush',  { method: 'POST' }),
  resetSimulation: ()      => request('/mesh/reset',  { method: 'POST' }),

  bridgeIngest: (ciphertext, bridgeNodeId='unknown', hopCount=0) =>
    request('/bridge/ingest', {
      method: 'POST',
      headers: { 'X-Bridge-Node-Id': bridgeNodeId, 'X-Hop-Count': String(hopCount) },
      body: JSON.stringify({ ciphertext }),
    }),
};
