import DOMPurify from 'dompurify';
import katex from 'katex';

// FAQ and glossary content is pulled live from the IMI ReadTheDocs site so it
// stays in sync with the docs without a redeploy. The site sends
// Access-Control-Allow-Origin: *, so the browser can fetch it directly.
export const DOCS_BASE = 'https://imi.readthedocs.io/en/latest/';

export const DOC_PAGES = {
  faq:      { label: 'FAQ',      title: 'Frequently Asked Questions', path: 'getting-started/faqs.html' },
  glossary: { label: 'Glossary', title: 'Glossary',                   path: 'getting-started/glossary.html' },
};

export function docPageUrl(key) {
  return new URL(DOC_PAGES[key].path, DOCS_BASE).href;
}

// Docs element ids get this prefix so they can't collide with ids in the app.
export const DOC_ID_PREFIX = 'imidoc-';

// One in-flight/settled promise per page for the session. Failures are evicted
// so reopening the drawer retries.
const cache = new Map();

export function loadDocPage(key) {
  if (!cache.has(key)) {
    const p = fetchDocPage(key).catch(err => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, p);
  }
  return cache.get(key);
}

async function fetchDocPage(key) {
  const url = docPageUrl(key);
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Docs request failed (${res.status})`);
  const html = await res.text();

  // Sphinx (sphinx_rtd_theme) wraps the page body in [itemprop=articleBody].
  // If the theme changes and that disappears, fail loudly so the drawer falls
  // back to the plain link instead of showing the whole docs chrome.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const article = doc.querySelector('[itemprop="articleBody"]');
  if (!article) throw new Error('Could not find the page content on the docs site');

  // Third-party HTML: sanitize before it goes anywhere near the page.
  const frag = DOMPurify.sanitize(article.innerHTML, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'],
    FORBID_ATTR: ['style'],
  });

  // Pilcrow "link to this heading" anchors and the page h1 (the drawer header
  // already shows the title).
  frag.querySelectorAll('a.headerlink, h1').forEach(el => el.remove());

  frag.querySelectorAll('[id]').forEach(el => { el.id = DOC_ID_PREFIX + el.id; });

  frag.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href.startsWith('#')) {
      // In-page anchor; DocsDrawer intercepts the click and scrolls itself.
      a.setAttribute('href', '#' + DOC_ID_PREFIX + href.slice(1));
      a.dataset.docAnchor = 'true';
    } else {
      a.setAttribute('href', new URL(href, url).href);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });

  // MathJax-style inline \( … \) and display \[ … \] spans → KaTeX. KaTeX
  // escapes its input, so this is safe to do after sanitizing.
  frag.querySelectorAll('.math').forEach(el => {
    const src = el.textContent.trim();
    const display = src.startsWith('\\[');
    const tex = src.replace(/^\\[([]/, '').replace(/\\[)\]]$/, '');
    try {
      el.innerHTML = katex.renderToString(tex, { displayMode: display, throwOnError: false });
    } catch {
      // leave the raw TeX visible rather than dropping it
    }
  });

  const wrapper = document.createElement('div');
  wrapper.appendChild(frag);
  return wrapper.innerHTML;
}
