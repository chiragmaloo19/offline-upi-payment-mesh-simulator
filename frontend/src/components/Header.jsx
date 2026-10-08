import { useState, useEffect } from 'react';
import { api } from '../services/api';

export default function Header() {
  const [status, setStatus] = useState('checking'); // 'online' | 'offline' | 'checking'

  useEffect(() => {
    let mounted = true;
    const check = () =>
      api.getHealth()
        .then(() => mounted && setStatus('online'))
        .catch(() => mounted && setStatus('offline'));
    check();
    const t = setInterval(check, 15000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="header-logo">U</div>
        <div>
          <div className="header-name">Offline UPI</div>
          <div className="header-sub">Offline Payment Mesh Simulator</div>
        </div>
      </div>
      <div className="header-status">
        <div className={`status-dot ${status}`} />
        <span className="status-label">
          {status === 'online' ? 'Backend Online' : status === 'offline' ? 'Backend Offline' : 'Connecting…'}
        </span>
        <span className="crypto-badge" title="AES-256-GCM + RSA-2048 OAEP hybrid encryption">
          AES-256-GCM + RSA-2048
        </span>
      </div>
    </header>
  );
}
