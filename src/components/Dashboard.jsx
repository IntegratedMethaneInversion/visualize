import React from 'react';
import { useDatasetContext } from '../context/DatasetContext';
import { FamilySelector }   from './FamilySelector';
import { DatasetSelector }  from './DatasetSelector';
import { SectorSelector }   from './SectorSelector';
import { ControlPanel }     from './ControlPanel';
import { UnitsSelector }    from './UnitsSelector';
import { DataTotals }       from './DataTotals';
import { UploadPanel }      from './UploadPanel';
import { MapView }          from './MapView';
import { Legend }           from './Legend';
import { SectorBarChart }   from './SectorBarChart';
import { TimeSeriesPlot }   from './TimeSeriesPlot';

// Splits a description on its citation text (e.g. "Hancock et al. (2026)")
// and wraps that portion in a link, leaving the surrounding text untouched.
function renderDescription(description, citation) {
  if (!citation?.text) return description;
  const idx = description.indexOf(citation.text);
  if (idx === -1) return description;
  return (
    <>
      {description.slice(0, idx)}
      <a className="citation-link" href={citation.url} target="_blank" rel="noopener noreferrer">{citation.text}</a>
      {description.slice(idx + citation.text.length)}
    </>
  );
}

export function Dashboard() {
  const { activeDataset, activeFamily, datasetsInActiveFamily, uploadedData } = useDatasetContext();

  const datasetTitle = activeDataset.id === 'user-upload'
    ? (uploadedData?.meta?.name || activeDataset.name)
    : activeDataset.name;

  return (
    <div className="dashboard" data-family={activeFamily.id}>

      <header className="dashboard-header">
        <h1 className="dashboard-title">{activeFamily.dashboardTitle}</h1>
        <FamilySelector />
      </header>

      {activeFamily.id === 'CO2' && (
        <div className="family-warning-banner">
          There is no IMI output data for CO₂ at this time.
        </div>
      )}

      <div className="dashboard-body">
        <aside className="dashboard-sidebar">

          <div className="dataset-badge-row">
            <span className="dataset-family-badge">{activeFamily.label}</span>
            {activeDataset.satellites?.map(sat => (
              <span key={sat} className="satellite-badge">{sat}</span>
            ))}
          </div>

          {/* Family description was dropped dashboard-wide for being redundant with
              the dataset description, but the Upload family's covers input file
              requirements that live nowhere else in the UI — keep it there only. */}
          {activeFamily.id === 'UPLOAD' && (
            <p className="family-description">{activeFamily.description}</p>
          )}

          <div className="sidebar-selectors">
            {/* Only one dataset in this family (e.g. uploads) — nothing to switch between */}
            {datasetsInActiveFamily.length > 1 && <DatasetSelector />}
            <SectorSelector />
          </div>

          {/* Dataset title + description */}
          <div className="dataset-info">
            <h2>{datasetTitle}</h2>
            <p>{renderDescription(activeDataset.description, activeDataset.citation)}</p>
          </div>

          {/* ── Emissions totals summary ──────────────────────────────── */}
          <UnitsSelector />
          <DataTotals />

          {activeDataset.id === 'user-upload' && <UploadPanel />}

          <ControlPanel />
          <Legend />
          <SectorBarChart />
          <TimeSeriesPlot />

        </aside>

        <main className="dashboard-main">
          <MapView />
        </main>

      </div>
    </div>
  );
}