import React, { useEffect, useId, useRef, useState } from 'react';
import { ControlPanel } from './ControlPanel';

// Floating button in the map pane's top-right corner that opens a popover
// holding the dataset's map controls (source, year, opacity, color scale…).
export function MapSettings() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const panelId = useId();

  // Close on Escape or on a click anywhere outside the button + panel.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    const onPointer = e => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div className="map-settings" ref={rootRef}>
      <button
        type="button"
        className={`map-settings-btn ${open ? 'active' : ''}`}
        aria-label="Map settings"
        title="Map settings"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(o => !o)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
             fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="6"  x2="20" y2="6"  />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
          <circle cx="9"  cy="6"  r="2" fill="var(--bg-secondary)" />
          <circle cx="15" cy="12" r="2" fill="var(--bg-secondary)" />
          <circle cx="7"  cy="18" r="2" fill="var(--bg-secondary)" />
        </svg>
      </button>

      {/* Kept mounted while closed so slider/select state isn't torn down */}
      <div
        id={panelId}
        className="map-settings-panel"
        role="dialog"
        aria-label="Map settings"
        hidden={!open}
      >
        <div className="map-settings-header">
          <span className="map-settings-title">Map Settings</span>
          <button
            type="button"
            className="map-settings-close"
            aria-label="Close map settings"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
        <ControlPanel />
      </div>
    </div>
  );
}
