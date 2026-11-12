import { useEffect, useRef, useState } from 'react';
import 'katex/dist/katex.min.css';
import { DOC_PAGES, docPageUrl, loadDocPage } from '../utils/docsContent';

// Header buttons that open FAQ / Glossary content fetched live from the IMI docs.
export function DocsButtons({ openKey, onToggle }) {
  return (
    <div className="docs-buttons">
      {Object.entries(DOC_PAGES).map(([key, page]) => (
        <button
          key={key}
          type="button"
          className={`docs-btn ${openKey === key ? 'active' : ''}`}
          aria-expanded={openKey === key}
          aria-controls="docs-drawer"
          onClick={() => onToggle(key)}
        >
          {page.label}
        </button>
      ))}
    </div>
  );
}

// Groups the filter works on: glossary terms (a <dt> plus its <dd>s) and FAQ
// questions (the second-level <section>s, one per h2).
function getFilterGroups(root) {
  const terms = [...root.querySelectorAll('dl.glossary > dt')];
  if (terms.length) {
    return terms.map(dt => {
      const els = [dt];
      let n = dt.nextElementSibling;
      while (n && n.tagName === 'DD') { els.push(n); n = n.nextElementSibling; }
      return els;
    });
  }
  return [...root.querySelectorAll('section > section')].map(s => [s]);
}

// Rendered with key={pageKey}, so switching pages remounts with fresh state.
export function DocsDrawer({ pageKey, onClose }) {
  const page = DOC_PAGES[pageKey];
  const [loaded, setLoaded] = useState({ html: null, error: null });
  const [query, setQuery] = useState('');
  const [noMatches, setNoMatches] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const bodyRef = useRef(null);


  useEffect(() => {
    let cancelled = false;
    loadDocPage(pageKey).then(
      html  => { if (!cancelled) setLoaded({ html, error: null }); },
      error => { if (!cancelled) setLoaded({ html: null, error }); },
    );
    return () => { cancelled = true; };
  }, [pageKey, attempt]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Filtering toggles `hidden` on the rendered docs DOM. React leaves the
  // injected HTML alone on re-render because the __html string is unchanged.
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || !loaded.html) return;
    const q = query.trim().toLowerCase();
    let shown = 0;
    for (const group of getFilterGroups(root)) {
      const match = !q || group.some(el => el.textContent.toLowerCase().includes(q));
      group.forEach(el => { el.hidden = !match; });
      if (match) shown++;
    }
    setNoMatches(!!q && shown === 0);
  }, [query, loaded.html]);

  // In-page docs anchors scroll the drawer instead of touching the app URL.
  function handleBodyClick(e) {
    const a = e.target.closest('a[data-doc-anchor]');
    if (!a) return;
    e.preventDefault();
    const target = bodyRef.current?.querySelector(`[id="${CSS.escape(a.getAttribute('href').slice(1))}"]`);
    if (!target) return;
    if (target.hidden) setQuery('');
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.add('docs-flash');
      setTimeout(() => target.classList.remove('docs-flash'), 1200);
    });
  }

  const sourceUrl = docPageUrl(pageKey);

  return (
    <>
      <div className="docs-backdrop" onClick={onClose} />
      <aside id="docs-drawer" className="docs-drawer" role="dialog" aria-label={page.title}>
        <div className="docs-drawer-header">
          <h2>{page.title}</h2>
          <button type="button" className="docs-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="docs-drawer-toolbar">
          <input
            autoFocus
            type="search"
            className="docs-search"
            placeholder={pageKey === 'glossary' ? 'Filter terms…' : 'Filter questions…'}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <a className="docs-source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">
            View on docs site ↗
          </a>
        </div>

        <div className="docs-drawer-body">
          {!loaded.html && !loaded.error && <p className="docs-status">Loading from the IMI documentation…</p>}

          {loaded.error && (
            <div className="docs-status">
              <p>Couldn’t load this page from the IMI documentation.</p>
              <p>
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Open it on the docs site ↗</a>
                {' · '}
                <button type="button" className="docs-retry" onClick={() => { setLoaded({ html: null, error: null }); setAttempt(a => a + 1); }}>Try again</button>
              </p>
            </div>
          )}

          {loaded.html && (
            <>
              <div
                ref={bodyRef}
                className="docs-content"
                onClick={handleBodyClick}
                dangerouslySetInnerHTML={{ __html: loaded.html }}
              />
              {noMatches && <p className="docs-status">No matches for “{query.trim()}”.</p>}
              <p className="docs-attribution">
                Content from the <a href={sourceUrl} target="_blank" rel="noopener noreferrer">IMI documentation</a>.
              </p>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
