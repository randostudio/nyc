// Petal Health NYC — client. Hash routes: #/  #/c/:slug  #/search?q=  #/saved
const app = document.getElementById('app');
const detailDialog = document.getElementById('detail');
const submitDialog = document.getElementById('submit');

const STRIPES = {
  '#ff7eb6': ['#ffd6e8', '#ffe6f1'],
  '#b9a4ff': ['#e2d9ff', '#efe9ff'],
  '#c9f27a': ['#dff6b8', '#ecfad2'],
  '#8fd3ff': ['#dff1fb', '#ecf7fd'],
  '#ffa05a': ['#ffe0c7', '#fff0e3'],
  '#ffd84d': ['#fff1b8', '#fff8dc'],
  '#9be8c8': ['#d5f5e8', '#e9faf2'],
  '#f2a6ff': ['#fbdcff', '#fdeeff'],
};

const TAG_LABELS = {
  'free': 'Free',
  'low-cost': 'Low cost',
  'sliding-scale': 'Sliding scale',
  'student-friendly': 'Student-friendly',
  'no-insurance-ok': 'No insurance OK',
  'medicaid': 'Takes Medicaid',
  'women-focused': 'Women-focused',
  'lgbtq-affirming': 'LGBTQ+ affirming',
  'walk-in': 'Walk-ins',
  'confidential': 'Confidential',
  'telehealth': 'Virtual OK',
  '24-7': '24/7',
  'evening-hours': 'Evening hours',
  'beginner-friendly': 'Beginner-friendly',
  'outdoor': 'Outdoor',
  'spanish': 'Habla español',
  'chinese': '中文 spoken',
  'yoga': 'Yoga classes',
  'pilates': 'Pilates classes',
};

const STATIONS = [
  { lines: [['J', '#996633'], ['Z', '#996633']], name: 'Bowery', walk: '2 min' },
  { lines: [['B', '#ff6319'], ['D', '#ff6319']], name: 'Grand St', walk: '3 min' },
  { lines: [['F', '#ff6319'], ['M', '#ff6319'], ['J', '#996633'], ['Z', '#996633']], name: 'Delancey St–Essex St', walk: '6 min' },
  { lines: [['6', '#00933c']], name: 'Spring St', walk: '8 min' },
];

// Reach filters, measured from 303 Broome. Train times are estimates (see listing_view).
const REACH = [
  ['any', 'Anywhere', () => true],
  ['walk', 'Walkable (≤ 20 min)', (l) => l.walk_minutes != null && l.walk_minutes <= 20],
  ['t30', '≤ 30 min by train', (l) => l.walk_minutes != null && (l.walk_minutes <= 20 || l.train_minutes <= 30)],
  ['t45', '≤ 45 min by train', (l) => l.walk_minutes != null && (l.walk_minutes <= 20 || l.train_minutes <= 45)],
];

const QUICK = [
  ['therapy sliding scale', 'sliding-scale therapy'],
  ['free yoga', 'free yoga'],
  ['run club', 'run club'],
  ['STI testing', 'walk-in STI testing'],
  ['birth control', 'birth control'],
  ['LGBTQ+ affirming care', 'lgbtq'],
];

let meta = null;
let saved = loadSaved();
const listingCache = new Map();

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

function loadSaved() {
  try { return new Set(JSON.parse(localStorage.getItem('petal-saved') || '[]')); } catch { return new Set(); }
}
function persistSaved() {
  try { localStorage.setItem('petal-saved', JSON.stringify([...saved])); } catch { /* private mode */ }
  document.getElementById('saved-link').textContent = `Saved (${saved.size})`;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

function stripeVars(color) {
  const [a, b] = STRIPES[color] || STRIPES['#ff7eb6'];
  return `--stripe-a:${a};--stripe-b:${b}`;
}

function distanceLabel(l) {
  if (l.walk_minutes == null) return l.neighborhood;
  if (l.walk_minutes <= 20) return `${l.neighborhood} · ${l.walk_minutes} min walk`;
  return `${l.neighborhood} · ~${l.train_minutes} min by train`;
}

function directionsUrl(l) {
  const dest = l.address || `${l.name}, ${l.neighborhood}, New York, NY`;
  const mode = l.walk_minutes != null && l.walk_minutes <= 20 ? 'walking' : 'transit';
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(meta.home.address)}&destination=${encodeURIComponent(dest)}&travelmode=${mode}`;
}

function tagPills(l, max = 3) {
  const lead = l.is_free ? `<span class="pill sm lime">Free</span>` : (l.cost ? `<span class="pill sm yellow">${esc(l.cost)}</span>` : '');
  // The cost pill already says "sliding scale" / "low cost", so skip those tags beside it.
  const hidden = l.is_free || !l.cost ? ['free'] : ['free', 'sliding-scale', 'low-cost'];
  const rest = l.tags.filter((t) => !hidden.includes(t) && TAG_LABELS[t]).slice(0, max)
    .map((t) => `<span class="pill sm">${esc(TAG_LABELS[t])}</span>`).join('');
  return lead + rest;
}

function flower(style) {
  return `<div class="flower" style="${style}"></div>`;
}

// ---------- maps ----------
function makeMap(el, listings, { onPinClick, zoom = 14 } = {}) {
  if (!window.L || !el) return null;
  const map = L.map(el, { scrollWheelZoom: false, zoomControl: true }).setView([meta.home.lat, meta.home.lng], zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  L.marker([meta.home.lat, meta.home.lng], {
    icon: L.divIcon({ className: '', html: `<div class="home-pin">${flower('--s:1;--r:12deg')}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
    zIndexOffset: 1000,
  }).addTo(map).bindPopup(`<b>Home base</b><br>${esc(meta.home.address)}`);

  const pins = new Map();
  const bounds = [[meta.home.lat, meta.home.lng]];
  for (const l of listings) {
    if (l.lat == null) continue;
    const marker = L.marker([l.lat, l.lng], {
      icon: L.divIcon({ className: '', html: `<div class="pin" style="--pin:${l.category_color}"></div>`, iconSize: [30, 30], iconAnchor: [15, 30] }),
      title: l.name,
    }).addTo(map);
    marker.on('click', () => onPinClick?.(l.slug));
    pins.set(l.slug, marker);
    bounds.push([l.lat, l.lng]);
  }
  const fit = () => { if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 }); };
  fit();
  setTimeout(() => map.invalidateSize(), 50);

  // Expand / collapse the whole card into a near-fullscreen overlay.
  const card = el.parentElement;
  card.querySelector('.map-expand')?.remove();
  setMapExpanded(card, false);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'map-expand';
  btn.textContent = '⤢ Expand map';
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => {
    const open = !card.classList.contains('expanded');
    setMapExpanded(card, open);
    btn.textContent = open ? '✕ Close map' : '⤢ Expand map';
    btn.setAttribute('aria-expanded', String(open));
    open ? map.scrollWheelZoom.enable() : map.scrollWheelZoom.disable();
    setTimeout(() => { map.invalidateSize(); fit(); }, 60);
  });
  card.appendChild(btn);
  return { map, pins };
}

function setMapExpanded(card, open) {
  card.classList.toggle('expanded', open);
  document.body.classList.toggle('map-open', open);
}

function closeExpandedMap() {
  document.querySelector('.card.expanded .map-expand')?.click();
}

// ---------- pages ----------
async function renderHome() {
  const nearest = (await api('/api/listings?sort=distance&limit=60'));
  nearest.forEach((l) => listingCache.set(l.slug, l));
  const cats = Object.fromEntries(meta.categories.map((c) => [c.slug, c]));
  const big = ['doctors', 'mental-health'].map((s) => cats[s]);
  const small = ['workouts', 'clubs', 'beauty', 'resources'].map((s) => cats[s]).filter(Boolean);
  const featured = pickFeatured(nearest);

  app.innerHTML = `
    <section class="hero">
      ${flower('top:70px;right:150px;--s:3.2;--r:14deg')}
      ${flower('top:290px;right:360px;--s:1.6;--r:-18deg;--p:var(--lilac);--c:var(--cream)')}
      ${flower('bottom:60px;right:90px;--s:2.2;--r:30deg;--p:var(--orange);--c:var(--pink)')}
      <div class="sticker" style="top:200px;right:110px;background:var(--lime);transform:rotate(8deg)">zero gatekeeping ✦</div>
      <div class="sticker" style="top:360px;right:180px;width:120px;height:120px;border-radius:50%;padding:0;display:grid;place-items:center;text-align:center;background:var(--yellow);font-size:15px;line-height:1.1;transform:rotate(-12deg)">by college<br>girls, for<br>college girls</div>
      <div class="hero-inner">
        <span class="pill count">${meta.total} spots · ${meta.walkable} walkable · ${meta.within45} within 45 min by train</span>
        <h1>Your NYC era,<br>in full <span class="bloom">bloom</span>.</h1>
        <p class="lede">The gyno who doesn't rush you, the therapist on a sliding scale, the free yoga class — plus your future besties. All a short walk or subway ride from 303 Broome St.</p>
        <form class="search-bar" id="hero-search" role="search">
          <label for="hero-q">I need a</label>
          <input id="hero-q" name="q" placeholder="gyno who takes student insurance" autocomplete="off">
          <div class="divider"></div>
          <div class="near"><span>near</span> <b>303 Broome</b></div>
          <button type="submit">Find it</button>
        </form>
        <div class="quick">
          ${QUICK.map(([label, q]) => `<a class="pill" href="#/search?q=${encodeURIComponent(q)}">${esc(label)}</a>`).join('')}
        </div>
      </div>
    </section>

    <section class="section wrap">
      <div class="section-head"><h2>Pick your vibe</h2><a href="#/search?q=">See all ${meta.total} spots →</a></div>
      <div class="bento-wrap">
        <div class="bento">
          ${big.map((c, i) => `
            <a class="tile big" href="#/c/${c.slug}" style="background:${c.color}">
              ${i === 0
                ? `<div class="blob" style="right:-70px;bottom:-85px;width:150px;height:150px;background:var(--blush)"></div>`
                : `<div class="blob" style="right:24px;top:24px;width:70px;height:70px;background:var(--yellow)"></div>`}
              <span class="badge">${esc(c.badge || '')}</span>
              <div><div class="t-name">${esc(c.name)}</div><div class="t-blurb">${esc(c.blurb)} ${c.count} spots.</div></div>
            </a>`).join('')}
          ${small.map((c) => `
            <a class="tile" href="#/c/${c.slug}" style="background:${c.color}">
              <div class="t-name">${esc(c.name)}</div><div class="t-blurb">${c.count} spots</div>
            </a>`).join('')}
        </div>
      </div>
    </section>

    <section class="section wrap">
      <div class="section-head"><h2>Home base: 303 Broome</h2></div>
      <div class="home-base">
        <div class="card info">
          <h3>Getting around</h3>
          <div>Everything here is measured from <b>${esc(meta.home.address)}</b> on the Lower East Side. Four subway stations are under 10 minutes away:</div>
          <ul class="stations">
            ${STATIONS.map((s) => `<li>${s.lines.map(([l, c]) => `<span class="line-bullet" style="background:${c}">${l}</span>`).join('')}<b>${s.name}</b><span style="opacity:.7">· ${s.walk} walk</span></li>`).join('')}
          </ul>
          <div style="font-size:14px">Jersey City &amp; Hoboken spots are a PATH ride away — take the F/M to 14 St or walk from Chambers St (J/Z) to the WTC PATH.</div>
          <div style="font-size:14px;opacity:.8">Walk and train times are estimates. Every listing has a one-tap “Directions from 303 Broome” button.</div>
        </div>
        <div class="card home-map"><div class="map-inner" id="home-map" aria-label="Map of listings around 303 Broome St"></div></div>
      </div>
    </section>

    <section class="section wrap">
      <div class="section-head"><h2>Steps from home base</h2><a href="#/search?q=&walkable=1">All ${meta.walkable} walkable spots →</a></div>
      <div class="near-grid">
        ${featured.map((l) => `
          <article class="card near-card" data-slug="${esc(l.slug)}" tabindex="0" style="${stripeVars(l.category_color)}">
            <div class="near-art">
              <span class="pill sm ${l.is_free ? 'lime' : 'yellow'}">${esc(l.is_free ? 'free ✓' : l.category_name)}</span>
              <div class="mins">${l.walk_minutes} min<small>walk from 303 Broome</small></div>
            </div>
            <div class="near-body">
              <div class="eyebrow">${esc(l.kind)} · ${esc(l.neighborhood)}</div>
              <div class="title">${esc(l.name)}</div>
              <div class="desc">${esc(l.description)}</div>
            </div>
          </article>`).join('')}
      </div>
    </section>

    <section class="cta">
      ${flower('left:52%;top:40px;--s:1.8;--r:10deg;--p:var(--lime);--c:var(--pink);filter:none')}
      <div><h2>Know a gem? Spill.</h2><p>Add a doctor, studio or club you love. We verify, the girls benefit.</p></div>
      <button class="btn yellow" type="button" data-open-submit>Submit a spot</button>
    </section>
    ${footer()}`;

  document.getElementById('hero-search').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `#/search?q=${encodeURIComponent(e.target.q.value.trim())}`;
  });
  makeMap(document.getElementById('home-map'), nearest, { onPinClick: openDetail, zoom: 14 });
}

// One close spot each from care, mind and movement so the row feels varied.
function pickFeatured(listings) {
  const out = [];
  for (const cat of ['doctors', 'mental-health', 'workouts', 'clubs', 'resources']) {
    const hit = listings.find((l) => l.category_slug === cat && l.walk_minutes != null && !out.includes(l));
    if (hit) out.push(hit);
    if (out.length === 3) break;
  }
  return out;
}

function footer() {
  return `<footer class="site-footer wrap">
    <span style="font-weight:600">In crisis? Call or text 988 — 24/7, free. Emergency: 911.</span>
    <span class="muted">Listings are community-maintained — confirm hours, prices &amp; eligibility before you go.</span>
    <span class="muted">Petal Health NYC · made with love on the Lower East Side</span>
  </footer>`;
}

// Category, search and saved pages share one results layout.
async function renderResults({ category, q = '', savedOnly = false, initial = {} }) {
  const cat = category ? meta.categories.find((c) => c.slug === category) : null;
  if (category && !cat) return renderNotFound();

  const state = { kind: '', tags: new Set(initial.tag ? [initial.tag] : []), reach: initial.walkable === '1' ? 'walk' : 'any', borough: '', free: false, sort: 'distance' };
  const color = cat?.color || (savedOnly ? '#ff7eb6' : '#ffd6e8');
  const title = cat ? cat.name : savedOnly ? 'Your saved spots' : q ? `“${q}”` : 'Every spot';
  const blurb = cat ? cat.blurb
    : savedOnly ? 'Hearts are stored on this device.'
    : 'Search across doctors, therapists, workouts, yoga, Pilates, clubs and resources near 303 Broome St.';

  app.innerHTML = `
    <section class="band" style="background:${cat ? color : 'var(--blush)'}">
      ${flower('top:44px;right:120px;--s:2.4;--r:-10deg')}
      <div class="sticker" style="top:110px;right:250px;background:var(--cream);transform:rotate(-6deg);font-size:14px;padding:8px 14px;box-shadow:3px 3px 0 var(--ink)">no judgment zone</div>
      <div class="wrap">
        <div class="crumbs"><a href="#/">Home</a> / ${cat ? 'Directory' : savedOnly ? 'Saved' : 'Search'} / ${esc(cat ? cat.name : savedOnly ? 'Saved' : 'Results')}</div>
        <h1>${esc(title)}</h1>
        <p>${esc(blurb)}</p>
        ${savedOnly ? '' : `
        <form class="search-bar" id="band-search" role="search" style="max-width:560px;margin-bottom:${cat ? '22px' : '0'}">
          <label class="sr-only" for="band-q">Search</label>
          <input id="band-q" name="q" value="${esc(q)}" placeholder="${cat ? `Search ${esc(cat.name.toLowerCase())}…` : 'Search doctors, studios, clubs…'}" autocomplete="off">
          <button type="submit">Find it</button>
        </form>`}
        <div class="chips" id="kind-chips"></div>
      </div>
    </section>
    <div class="results-layout wrap">
      <aside class="filters" id="filters" aria-label="Filters"></aside>
      <section class="results" id="results" aria-live="polite"><div class="loading">finding spots…</div></section>
      <div class="aside">
        <div class="card map-card"><div class="map-inner" id="results-map" aria-label="Map of results"></div></div>
        ${tipCard(category)}
      </div>
    </div>
    ${footer()}`;

  document.getElementById('band-search')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const term = e.target.q.value.trim();
    if (cat) { q = term; load(); } else location.hash = `#/search?q=${encodeURIComponent(term)}`;
  });

  let all = [];
  let mapCtl = null;

  async function load() {
    const params = new URLSearchParams({ sort: state.sort });
    if (category) params.set('category', category);
    if (q) params.set('q', q);
    all = await api(`/api/listings?${params}`);
    if (savedOnly) all = all.filter((l) => saved.has(l.slug));
    all.forEach((l) => listingCache.set(l.slug, l));
    renderKinds();
    renderFilters();
    renderList();
  }

  function visible() {
    return all.filter((l) =>
      (!state.kind || l.kind === state.kind) &&
      REACH.find(([key]) => key === state.reach)[2](l) &&
      (!state.borough || l.borough === state.borough) &&
      (!state.free || l.is_free) &&
      [...state.tags].every((t) => l.tags.includes(t)));
  }

  function renderKinds() {
    const counts = {};
    for (const l of all) counts[l.kind] = (counts[l.kind] || 0) + 1;
    const kinds = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    const el = document.getElementById('kind-chips');
    if (kinds.length < 2) { el.innerHTML = ''; return; }
    el.innerHTML = ['', ...kinds].map((k) =>
      `<button type="button" class="pill ${state.kind === k ? 'on' : ''}" data-kind="${esc(k)}">${esc(k || 'All')}</button>`).join('');
  }

  function renderFilters() {
    const counts = {};
    for (const l of all) for (const t of l.tags) if (TAG_LABELS[t] && t !== 'free') counts[t] = (counts[t] || 0) + 1;
    const tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const freeN = all.filter((l) => l.is_free).length;
    const boroughs = [...new Set(all.map((l) => l.borough))].sort((a, b) => (a === 'Citywide / online') - (b === 'Citywide / online') || a.localeCompare(b));
    document.getElementById('filters').innerHTML = `
      <div>
        <div class="filter-title">From 303 Broome</div>
        ${REACH.map(([key, label, test]) => `<label class="check"><input type="radio" name="reach" data-reach="${key}" ${state.reach === key ? 'checked' : ''}><span class="box round"></span>${label}<span class="n">${all.filter(test).length}</span></label>`).join('')}
        <label class="check" style="margin-top:8px"><input type="checkbox" data-flag="free" ${state.free ? 'checked' : ''}><span class="box"></span>Free only<span class="n">${freeN}</span></label>
      </div>
      ${boroughs.length > 1 ? `<div>
        <div class="filter-title">Borough</div>
        <div class="tag-cloud">${boroughs.map((b) => `<button type="button" class="pill ${state.borough === b ? 'on' : ''}" data-borough="${esc(b)}">${esc(b)}</button>`).join('')}</div>
      </div>` : ''}
      ${tags.length ? `<div>
        <div class="filter-title">The vibe</div>
        <div class="tag-cloud">${tags.map((t) => `<button type="button" class="pill ${state.tags.has(t) ? 'on' : ''}" data-tag="${t}">${esc(TAG_LABELS[t])}</button>`).join('')}</div>
      </div>` : ''}`;
  }

  function renderList() {
    const rows = visible();
    const el = document.getElementById('results');
    el.innerHTML = `
      <div class="results-top">
        <b>${rows.length} ${rows.length === 1 ? 'spot' : 'spots'}${q ? ` for “${esc(q)}”` : ''} near 303 Broome</b>
        <label>Sort: <select id="sort">
          <option value="distance" ${state.sort === 'distance' ? 'selected' : ''}>Closest</option>
          <option value="saves" ${state.sort === 'saves' ? 'selected' : ''}>Most saved</option>
          <option value="name" ${state.sort === 'name' ? 'selected' : ''}>A–Z</option>
        </select></label>
      </div>
      ${rows.length ? rows.map(resultCard).join('') : emptyState()}`;
    document.getElementById('sort').addEventListener('change', (e) => { state.sort = e.target.value; load(); });

    const mapEl = document.getElementById('results-map');
    if (mapCtl) { mapCtl.map.remove(); mapCtl = null; }
    mapEl.innerHTML = '';
    mapCtl = makeMap(mapEl, rows, { onPinClick: openDetail });
  }

  function emptyState() {
    if (savedOnly && !saved.size) {
      return `<div class="card empty"><h3>Nothing saved yet</h3><p>Tap the ♡ on any spot to keep it here.</p><a class="btn" href="#/">Browse spots</a></div>`;
    }
    return `<div class="card empty"><h3>No spots match… yet</h3><p>Try fewer filters or a different word. Know one we're missing?</p><button class="btn" type="button" data-open-submit>Submit a spot</button></div>`;
  }

  app.addEventListener('click', onClick);
  app.addEventListener('change', onChange);
  app.addEventListener('mouseover', onHover);
  cleanup = () => {
    app.removeEventListener('click', onClick);
    app.removeEventListener('change', onChange);
    app.removeEventListener('mouseover', onHover);
    mapCtl?.map.remove();
  };

  function onClick(e) {
    const kind = e.target.closest('[data-kind]');
    if (kind) { state.kind = kind.dataset.kind; renderKinds(); renderList(); return; }
    const borough = e.target.closest('[data-borough]');
    if (borough) {
      state.borough = state.borough === borough.dataset.borough ? '' : borough.dataset.borough;
      renderFilters(); renderList(); return;
    }
    const tag = e.target.closest('[data-tag]');
    if (tag) {
      const t = tag.dataset.tag;
      state.tags.has(t) ? state.tags.delete(t) : state.tags.add(t);
      renderFilters(); renderList();
    }
  }
  function onChange(e) {
    const flag = e.target.dataset?.flag;
    if (flag) { state[flag] = e.target.checked; renderList(); }
    if (e.target.dataset?.reach) { state.reach = e.target.dataset.reach; renderList(); }
  }
  function onHover(e) {
    const card = e.target.closest('.result');
    for (const [slug, m] of mapCtl?.pins || []) {
      m.getElement()?.firstElementChild?.classList.toggle('hl', slug === card?.dataset.slug);
    }
  }

  await load();
}

function resultCard(l) {
  const isSaved = saved.has(l.slug);
  const thumb = l.walk_minutes == null
    ? `<b>${l.phone && !l.lat ? '☎' : '✦'}</b><small>${l.phone && !l.lat ? 'call / text' : 'online / citywide'}</small>`
    : l.walk_minutes <= 20 ? `<b>${l.walk_minutes}</b><small>min walk</small>` : `<b>~${l.train_minutes}</b><small>min by train</small>`;
  return `
    <article class="card result" data-slug="${esc(l.slug)}" tabindex="0" style="${stripeVars(l.category_color)}">
      <div class="thumb">${thumb}</div>
      <div>
        <div class="r-head">
          <div><div class="r-name">${esc(l.name)}</div><div class="r-sub">${esc(l.kind)} · ${esc(distanceLabel(l))}</div></div>
          <button type="button" class="heart ${isSaved ? 'on' : ''}" data-save="${esc(l.slug)}" aria-pressed="${isSaved}" aria-label="${isSaved ? 'Unsave' : 'Save'} ${esc(l.name)}">${isSaved ? '♥' : '♡'}</button>
        </div>
        <div class="r-desc">${esc(l.description)}</div>
        <div class="r-tags">${tagPills(l)}</div>
      </div>
    </article>`;
}

function tipCard(category) {
  const tips = {
    'doctors': ['First gyno visit?', 'You can ask for a woman provider, bring a friend, and say “stop” at any time. Many clinics above see you without insurance.', 'Find low-cost care', '#/search?q=no%20insurance'],
    'mental-health': ['Not sure where to start?', 'Your campus counseling center is usually free. For anything urgent, call or text 988 — any time.', 'See crisis lines', '#/search?q=crisis'],
    'workouts': ['Free is a whole vibe', 'NYC Parks runs free Shape Up NYC classes, NYRR Open Runs are free every week, and most yoga & Pilates studios have a cheap intro offer.', 'See free workouts', '#/search?q=free%20fitness'],
    'clubs': ['Make the first move', 'Bookstore events and volunteering are the easiest no-pressure ways to meet people.', 'Free events', '#/search?q=free%20events'],
    'beauty': ['Glow up for less', 'Beauty schools offer discounted cuts, color and facials by supervised students — perfect on a student budget.', 'See beauty-school deals', '#/search?q=beauty%20school'],
    'resources': ['Your library card is a cheat code', 'Free study space, Wi-Fi, printing and Culture Pass museum tickets.', 'Find a library', '#/search?q=library'],
  };
  const [h, p, link, href] = tips[category] || ['In crisis?', 'Call or text 988, any time, for free and confidential support.', 'Mental health spots', '#/c/mental-health'];
  return `<div class="card tip" style="background:var(--lilac)"><h3>${h}</h3><p>${p}</p><a href="${href}" style="font-weight:700;text-underline-offset:4px">${link} →</a></div>`;
}

function renderNotFound() {
  app.innerHTML = `<section class="band" style="background:var(--blush)"><div class="wrap"><h1>Lost in the sauce</h1><p>That page doesn't exist.</p><a class="btn" href="#/">Back home</a></div></section>${footer()}`;
}

// ---------- detail dialog ----------
async function openDetail(slug) {
  const l = listingCache.get(slug) || await api(`/api/listings/${encodeURIComponent(slug)}`);
  const isSaved = saved.has(slug);
  const where = l.address
    ? `${esc(l.address)}${l.walk_minutes != null ? `<br><span style="opacity:.7">${l.miles.toFixed(1)} mi · ${l.walk_minutes <= 20 ? `about ${l.walk_minutes} min on foot` : `roughly ${l.train_minutes} min by subway (estimate)`}</span>` : ''}`
    : esc(l.neighborhood);
  const phoneHref = l.phone && /^[\d\-\s()+]+$/.test(l.phone) ? `tel:${l.phone.replace(/[^\d+]/g, '')}` : null;

  detailDialog.innerHTML = `
    <div class="d-top" style="background:${l.category_color}">
      <button class="d-close" type="button" data-close aria-label="Close">×</button>
      <span class="pill sm">${esc(l.category_name)} · ${esc(l.kind)}</span>
      <h2 id="detail-title">${esc(l.name)}</h2>
      <div class="r-tags">${tagPills(l, 8)}</div>
    </div>
    <div class="d-body">
      <p>${esc(l.description)}</p>
      <dl class="facts">
        <dt>Where</dt><dd>${where}</dd>
        ${l.transit ? `<dt>From 303 Broome</dt><dd>${esc(l.transit)}</dd>` : ''}
        ${l.cost ? `<dt>Cost</dt><dd>${esc(l.cost)}</dd>` : ''}
        ${l.phone ? `<dt>Phone</dt><dd>${phoneHref ? `<a href="${phoneHref}">${esc(l.phone)}</a>` : esc(l.phone)}</dd>` : ''}
        ${l.website ? `<dt>Website</dt><dd><a href="${esc(l.website)}" target="_blank" rel="noopener">${esc(l.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a></dd>` : ''}
      </dl>
      <div class="d-actions">
        ${l.lat != null || l.address ? `<a class="btn" href="${directionsUrl(l)}" target="_blank" rel="noopener">Directions from 303 Broome</a>` : ''}
        ${phoneHref ? `<a class="btn ghost" href="${phoneHref}">Call ${esc(l.phone)}</a>` : ''}
        ${l.website ? `<a class="btn ghost" href="${esc(l.website)}" target="_blank" rel="noopener">Website ↗</a>` : ''}
        <button class="btn ghost" type="button" data-save="${esc(l.slug)}" aria-pressed="${isSaved}">${isSaved ? '♥ Saved' : '♡ Save'}</button>
      </div>
      <div class="d-note">Hours, prices and eligibility change — confirm with the provider before you go.</div>
    </div>`;
  if (!detailDialog.open) detailDialog.showModal();
}

async function toggleSave(slug) {
  const nowSaved = !saved.has(slug);
  nowSaved ? saved.add(slug) : saved.delete(slug);
  persistSaved();
  document.querySelectorAll(`[data-save="${CSS.escape(slug)}"]`).forEach((b) => {
    b.classList.toggle('on', nowSaved);
    b.setAttribute('aria-pressed', nowSaved);
    b.textContent = b.classList.contains('heart') ? (nowSaved ? '♥' : '♡') : (nowSaved ? '♥ Saved' : '♡ Save');
  });
  toast(nowSaved ? 'Saved ♥' : 'Removed from saved');
  try {
    const { saves } = await api(`/api/listings/${encodeURIComponent(slug)}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ saved: nowSaved }),
    });
    const cached = listingCache.get(slug);
    if (cached) cached.saves = saves;
  } catch { /* count is best-effort */ }
}

// ---------- submissions ----------
function openSubmit() {
  const sel = document.getElementById('submit-category');
  sel.innerHTML = `<option value="">Not sure</option>` + meta.categories.map((c) => `<option value="${c.slug}">${esc(c.name)}</option>`).join('');
  submitDialog.showModal();
}

document.getElementById('submit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    await api('/api/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    e.target.reset();
    submitDialog.close();
    toast('Thank you! We’ll verify it and add it ✦');
  } catch (err) {
    toast(err.message);
  }
});

// ---------- global events ----------
document.addEventListener('click', (e) => {
  const save = e.target.closest('[data-save]');
  if (save) { e.stopPropagation(); toggleSave(save.dataset.save); return; }
  if (e.target.closest('[data-open-submit]')) { openSubmit(); return; }
  if (e.target.closest('[data-close]')) { e.target.closest('dialog').close(); return; }
  if (e.target.tagName === 'DIALOG') { e.target.close(); return; } // backdrop click
  if (e.target === document.body && document.body.classList.contains('map-open')) { closeExpandedMap(); return; }
  const card = e.target.closest('[data-slug]');
  if (card) openDetail(card.dataset.slug);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('map-open') && !document.querySelector('dialog[open]')) { closeExpandedMap(); return; }
  const card = e.target.closest?.('[data-slug]');
  if (card && (e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); openDetail(card.dataset.slug); }
});
window.addEventListener('scroll', () => {
  document.getElementById('header').classList.toggle('scrolled', window.scrollY > 10);
}, { passive: true });

// ---------- router ----------
let cleanup = null;
async function route() {
  cleanup?.(); cleanup = null;
  document.body.classList.remove('map-open');
  if (detailDialog.open) detailDialog.close();
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);

  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', parts[0] === 'c' && a.dataset.cat === parts[1]));
  window.scrollTo(0, 0);
  try {
    if (!parts.length) await renderHome();
    else if (parts[0] === 'c' && (parts[1] === 'yoga' || parts[1] === 'pilates')) location.replace(`#/c/workouts?tag=${parts[1]}`);
    else if (parts[0] === 'c' && parts[1]) await renderResults({ category: parts[1], initial: Object.fromEntries(params) });
    else if (parts[0] === 'search') await renderResults({ q: params.get('q') || '', initial: Object.fromEntries(params) });
    else if (parts[0] === 'saved') await renderResults({ savedOnly: true });
    else renderNotFound();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="loading">Couldn't load the directory — is the server running? (${esc(err.message)})</div>`;
  }
}

meta = await api('/api/meta');
persistSaved();
window.addEventListener('hashchange', route);
route();
