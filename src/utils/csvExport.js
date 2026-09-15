// Client-side CSV export. The dashboard has no server, so a download is a
// Blob + object URL + a synthetic anchor click; the URL is revoked on the
// next tick so Safari has time to start the download.

// RFC 4180 quoting: wrap in quotes and double any embedded quote whenever the
// cell contains a delimiter, quote, or newline. Sector labels like
// "Oil & gas, offshore" would otherwise split into two columns.
function escapeCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Numbers here are already unit-converted for display, so they carry float
// noise from the conversion multiply (0.30000000000000004). Eight significant
// digits is far past the precision of the underlying inversion while still
// leaving a Tons-scale total (~1e8) unrounded; Number() then drops the
// trailing zeros toPrecision leaves behind.
function formatNumber(v) {
  if (v == null || !Number.isFinite(v)) return '';
  return String(Number(v.toPrecision(8)));
}

// `columns` is [{ key, header }, ...]; rows are plain objects. Numeric cells
// go through formatNumber, everything else through escapeCell.
export function toCSV(rows, columns) {
  const lines = [columns.map(c => escapeCell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map(c => {
      const v = row[c.key];
      return typeof v === 'number' ? formatNumber(v) : escapeCell(v);
    }).join(','));
  }
  // Trailing newline so the file ends cleanly in a text editor / `cat`.
  return `${lines.join('\n')}\n`;
}

export function downloadCSV(filename, csvText) {
  // The BOM makes Excel read the file as UTF-8 rather than the local
  // codepage, which otherwise mangles sector labels containing ₂/&.
  const blob = new Blob(['﻿', csvText], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Collapses a place/year/label into a safe filename stem: spaces and
// punctuation become single hyphens (e.g. "Côte d'Ivoire" -> "Cote-d-Ivoire"
// after the accent strip below).
export function slugify(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'data';
}
