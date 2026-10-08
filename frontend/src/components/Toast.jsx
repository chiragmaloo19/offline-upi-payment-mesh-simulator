import { useState, useEffect } from 'react';

// Simple imperative toast — pub/sub pattern
let _nextId = 0;
const _listeners = new Set();

export function addToast(msg, type = 'info') {
  const id = ++_nextId;
  _listeners.forEach(fn => fn({ id, msg, type }));
}

const ICONS = { success: '✓', error: '✕', info: 'ℹ' };

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handler = (toast) => {
      setToasts(prev => [...prev, toast]);
      setTimeout(() => {
        setToasts(prev => prev.map(t => t.id === toast.id ? { ...t, exiting: true } : t));
        setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== toast.id));
        }, 200);
      }, 3800);
    };
    _listeners.add(handler);
    return () => _listeners.delete(handler);
  }, []);

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}${t.exiting ? ' exiting' : ''}`}>
          <span className="toast-icon">{ICONS[t.type] ?? ICONS.info}</span>
          <span className="toast-msg">{t.msg}</span>
          <button
            className="toast-close"
            onClick={() => setToasts(p => p.filter(x => x.id !== t.id))}
          >×</button>
        </div>
      ))}
    </div>
  );
}
