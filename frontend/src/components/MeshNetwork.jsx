import { useState } from 'react';

// Fixed positions for the 5 devices in a pentagon-ish layout
const POSITIONS = {
  'phone-alice':    { top: '10%',  left: '20%' },
  'phone-stranger1':{ top: '10%',  left: '62%' },
  'phone-stranger2':{ top: '55%',  left: '5%'  },
  'phone-stranger3':{ top: '55%',  left: '76%' },
  'phone-bridge':   { top: '62%',  left: '40%' },
};

const ICONS = {
  'phone-bridge': '🌐',
};
const DEFAULT_ICON = '📱';

export default function MeshNetwork({ meshState, gossiping }) {
  const devices = meshState?.devices ?? [];

  return (
    <div className="card mesh-section">
      <div className="card-header">
        <span className="card-title">Mesh Network</span>
        <span className="text-sm text-muted">{devices.length} devices</span>
      </div>
      <div className="card-body" style={{ padding: '10px 20px 20px' }}>
        <div className="mesh-canvas">
          {/* SVG connection lines */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-hidden>
            {/* draw lines between all offline devices and bridge */}
            <line x1="28%" y1="20%" x2="69%" y2="20%" stroke="#dee2e6" strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="28%" y1="20%" x2="14%" y2="67%" stroke="#dee2e6" strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="28%" y1="20%" x2="54%" y2="74%" stroke="#dee2e6" strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="69%" y1="20%" x2="83%" y2="67%" stroke="#dee2e6" strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="69%" y1="20%" x2="54%" y2="74%" stroke="#dee2e6" strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="14%" y1="67%" x2="54%" y2="74%" stroke="#dee2e6" strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="83%" y1="67%" x2="54%" y2="74%" stroke="#dee2e6" strokeWidth="1.5" strokeDasharray="4 4" />
          </svg>

          {devices.map(d => {
            const pos = POSITIONS[d.deviceId] ?? { top: '50%', left: '50%' };
            const isBridge = d.hasInternet;
            const hasPackets = d.packetCount > 0;
            const shortId = d.deviceId.replace('phone-', '');
            return (
              <div key={d.deviceId} className="mesh-device" style={pos}>
                <div className={`device-icon${isBridge ? ' bridge' : ''}${hasPackets ? ' has-packets' : ''}${gossiping ? ' gossiping' : ''}`}>
                  {ICONS[d.deviceId] ?? DEFAULT_ICON}
                </div>
                <div className="device-label">{shortId}</div>
                <span className={`device-badge ${isBridge ? 'online' : 'offline'}`}>
                  {isBridge ? 'Internet Bridge' : 'Offline'}
                </span>
                {hasPackets && (
                  <div className="device-packet-count">{d.packetCount} {d.packetCount === 1 ? 'packet' : 'packets'}</div>
                )}
              </div>
            );
          })}

          {devices.length === 0 && (
            <div className="empty-state" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              Loading mesh…
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
