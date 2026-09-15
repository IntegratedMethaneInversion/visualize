import React from 'react';
import { toCSV, downloadCSV } from '../utils/csvExport';

// Small header-row button that serializes rows to CSV on click. `rows` and
// `columns` are built lazily by the caller only when they're cheap (the
// sector chart already has its rows in hand), so no work happens until the
// user actually clicks.
export function DownloadCSVButton({ rows, columns, filename, title = 'Download this chart’s data as CSV' }) {
  if (!rows?.length) return null;

  return (
    <button
      type="button"
      className="chart-download-btn"
      title={title}
      aria-label={title}
      onClick={() => downloadCSV(filename, toCSV(rows, columns))}
    >
      {/* Tray-with-down-arrow glyph, sized to the surrounding .chart-header text */}
      <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="M8 1.5v8m0 0L4.75 6.25M8 9.5l3.25-3.25M2 11.5v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      CSV
    </button>
  );
}
