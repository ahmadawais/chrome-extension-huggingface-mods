(() => {
  'use strict';

  const CACHE_TTL = 12 * 60 * 60 * 1000;
  const CACHE_PREFIX = 'hfms:v1:';
  const MAX_PAGES = 20;

  const RESERVED = new Set([
    'models', 'datasets', 'spaces', 'collections', 'blog', 'docs', 'pricing',
    'enterprise', 'tasks', 'chat', 'posts', 'papers', 'settings', 'login',
    'join', 'logout', 'new', 'search', 'organizations', 'notifications',
    'welcome', 'inference', 'security', 'terms-of-service', 'privacy',
    'huggingface', 'api', 'oauth', 'integrations', 'partners', 'learn',
  ]);

  const sizePromises = new Map();

  const ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<line x1="22" y1="12" x2="2" y2="12"/>' +
    '<path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>' +
    '<line x1="6" y1="16" x2="6.01" y2="16"/>' +
    '<line x1="10" y1="16" x2="10.01" y2="16"/>' +
    '</svg>';

  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return null;
    const units = ['Bytes', 'kB', 'MB', 'GB', 'TB', 'PB'];
    let v = bytes;
    let i = 0;
    while (v >= 1000 && i < units.length - 1) {
      v /= 1000;
      i++;
    }
    const s = v < 10 ? v.toFixed(2) : v.toFixed(1);
    return `${s} ${units[i]}`;
  }

  function readCache(id) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + id);
      if (!raw) return undefined;
      const { s, t } = JSON.parse(raw);
      if (typeof s !== 'number' || Date.now() - t > CACHE_TTL) return undefined;
      return s;
    } catch {
      return undefined;
    }
  }

  function writeCache(id, size) {
    try {
      localStorage.setItem(CACHE_PREFIX + id, JSON.stringify({ s: size, t: Date.now() }));
    } catch {
      // storage full or blocked — ignore
    }
  }

  function parseNextLink(header) {
    if (!header) return null;
    const m = header.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (!m) return null;
    try {
      const u = new URL(m[1]);
      return u.pathname + u.search;
    } catch {
      return null;
    }
  }

  async function fetchRepoSize(id) {
    const cached = readCache(id);
    if (cached !== undefined) return cached > 0 ? cached : null;

    const encoded = id.split('/').map(encodeURIComponent).join('/');
    let url = `/api/models/${encoded}/tree/main?recursive=true`;
    let total = 0;

    try {
      for (let page = 0; url && page < MAX_PAGES; page++) {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) return null;
        const files = await res.json();
        if (!Array.isArray(files)) return null;
        for (const f of files) {
          if (f.type === 'file' && typeof f.size === 'number') total += f.size;
        }
        url = parseNextLink(res.headers.get('link'));
      }
    } catch {
      return null;
    }

    writeCache(id, total);
    return total > 0 ? total : null;
  }

  function getSize(id) {
    let p = sizePromises.get(id);
    if (!p) {
      p = fetchRepoSize(id);
      sizePromises.set(id, p);
    }
    return p;
  }

  function repoIdFromPath(path) {
    const m = path.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (!m || RESERVED.has(m[1])) return null;
    return `${m[1]}/${m[2]}`;
  }

  function resolveBadge(size, badge, extraEls) {
    if (!badge.isConnected) return;
    if (size == null) {
      badge.remove();
      for (const el of extraEls) el.remove();
      return;
    }
    badge.querySelector('.hfms-val').textContent = formatSize(size);
    badge.title = `Total size of all files in this repo (${size.toLocaleString('en-US')} bytes)`;
  }

  function enhanceListingCards() {
    if (location.pathname !== '/models') return;

    for (const article of document.querySelectorAll('article.overview-card-wrapper:not([data-hfms])')) {
      const a = article.querySelector('a[href^="/"]');
      if (!a) continue;
      const id = repoIdFromPath(new URL(a.href, location.origin).pathname);
      if (!id) continue;
      article.dataset.hfms = '1';
      article.dataset.hfmsId = id;

      const meta = a.querySelector('header')?.nextElementSibling;
      if (!meta) continue;

      const sep = document.createElement('span');
      sep.className = 'px-1.5 text-gray-300 dark:text-gray-500 hfms-sep';
      sep.textContent = '•';

      const badge = document.createElement('span');
      badge.className = 'inline-flex flex-none items-center hfms-badge';
      badge.title = 'Total size of all files in this repo';
      badge.innerHTML = `${ICON_SVG}<span class="hfms-val">…</span>`;

      meta.append(sep, badge);
      getSize(id).then((size) => resolveBadge(size, badge, [sep]));
    }
  }

  function enhanceModelPage() {
    const id = repoIdFromPath(location.pathname);
    if (!id) return;

    const h1 = document.querySelector('h1');
    const row = h1?.nextElementSibling;
    if (!row || !row.classList || !row.classList.contains('flex-wrap')) return;
    if (row.querySelector('.hfms-model-pill')) return;

    const pill = document.createElement('a');
    pill.className = 'mb-1 mr-1 md:mb-1.5 md:mr-1.5 rounded-lg hfms-model-pill';
    pill.href = `/${id}/tree/main`;
    pill.title = 'Total size of all files in this repo';
    pill.innerHTML = `<div class="tag tag-white hfms-model-tag">${ICON_SVG}<span class="hfms-val">…</span></div>`;
    row.appendChild(pill);

    getSize(id).then((size) => resolveBadge(size, pill, []));
  }

  // --- Client-side "Sort by size" injected into HF's sort dropdown ---

  const NATIVE_SORT_LABELS = [
    'Trending', 'Most likes', 'Most downloads', 'Recently created',
    'Recently updated', 'Most parameters', 'Least parameters',
  ];
  const SIZE_SORTS = [
    ['Largest size', 'desc', 'Size ↓'],
    ['Smallest size', 'asc', 'Size ↑'],
  ];

  let sizeSort = null;

  async function applySizeSort(dir) {
    if (location.pathname !== '/models') return;
    const grid = document.querySelector('div.grid:has(> article.overview-card-wrapper)');
    if (!grid) return;

    const articles = [...grid.querySelectorAll(':scope > article.overview-card-wrapper')];
    await Promise.all(
      articles.map(async (a) => {
        if (!a.dataset.hfmsId) return;
        const size = await getSize(a.dataset.hfmsId);
        a.dataset.hfmsSize = size ?? -1;
      }),
    );
    if (sizeSort !== dir) return;

    const live = articles.filter((el) => el.isConnected && el.parentElement === grid);
    const sorted = live.slice().sort((a, b) => {
      const sa = Number(a.dataset.hfmsSize ?? -1);
      const sb = Number(b.dataset.hfmsSize ?? -1);
      if (sa < 0 && sb < 0) return 0;
      if (sa < 0) return 1;
      if (sb < 0) return -1;
      return dir === 'desc' ? sb - sa : sa - sb;
    });
    if (sorted.every((a, i) => live[i] === a)) return;
    for (const a of sorted) grid.appendChild(a);
  }

  function findSortMenu() {
    const items = [...document.querySelectorAll('a, button')].filter(
      (el) => NATIVE_SORT_LABELS.includes(el.textContent.trim()) && el.offsetParent !== null,
    );
    if (items.length < 3) return null;
    let menu = items[0].parentElement;
    while (menu && !items.every((i) => menu.contains(i))) menu = menu.parentElement;
    return menu;
  }

  function findSortButton() {
    return [...document.querySelectorAll('button')].find((b) =>
      /^\s*Sort\s*:/.test(b.textContent),
    );
  }

  function updateSortButtonLabel(text) {
    const btn = findSortButton();
    if (!btn) return;
    for (const node of btn.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('Sort')) {
        node.textContent = node.textContent.replace(/Sort\s*:.*$/s, `Sort: ${text}`);
      }
    }
  }

  function closeSortMenu(menu) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    setTimeout(() => {
      if (menu.isConnected && menu.offsetParent !== null) findSortButton()?.click();
    }, 80);
  }

  function injectSortItems() {
    const menu = findSortMenu();
    if (!menu || menu.querySelector('.hfms-sort-item')) return;
    const ref = [...menu.querySelectorAll('a, button')].find((el) =>
      NATIVE_SORT_LABELS.includes(el.textContent.trim()),
    );
    if (!ref) return;

    for (const [label, dir, shortLabel] of SIZE_SORTS) {
      const item = ref.cloneNode(true);
      item.removeAttribute('href');
      item.classList.add('hfms-sort-item');
      item.textContent = (sizeSort === dir ? '✓ ' : '') + label;
      item.addEventListener('click', (e) => {
        e.preventDefault();
        sizeSort = dir;
        applySizeSort(dir);
        updateSortButtonLabel(shortLabel);
        setTimeout(() => closeSortMenu(menu), 50);
      });
      menu.appendChild(item);
    }
  }

  document.addEventListener(
    'click',
    (e) => {
      if (location.pathname !== '/models') return;
      const el = e.target.closest('button, a');
      if (!el) return;
      const label = el.textContent.trim();
      if (NATIVE_SORT_LABELS.includes(label)) {
        sizeSort = null;
        return;
      }
      if (/^\s*Sort\s*:/.test(label)) {
        setTimeout(injectSortItems, 60);
        setTimeout(injectSortItems, 250);
      }
    },
    true,
  );

  // --- Wiring ---

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      enhanceListingCards();
      enhanceModelPage();
      if (sizeSort) applySizeSort(sizeSort);
    }, 250);
  }

  enhanceListingCards();
  enhanceModelPage();

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

  for (const type of ['pushState', 'replaceState']) {
    const orig = history[type];
    history[type] = function (...args) {
      const r = orig.apply(this, args);
      if (new URL(location.href).searchParams.has('sort')) sizeSort = null;
      schedule();
      return r;
    };
  }
  window.addEventListener('popstate', schedule);
})();
