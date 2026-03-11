// ── Type → color mapping ──────────────────────────────────────────────────
const TYPE_COLORS = {};
const PALETTE = ['#e74c3c', '#2980b9', '#27ae60', '#8e44ad', '#e67e22', '#16a085', '#c0392b', '#2c3e50'];
let paletteIdx = 0;

function colorForType(type) {
  const key = type || 'Sonstige';
  if (!TYPE_COLORS[key]) {
    TYPE_COLORS[key] = PALETTE[paletteIdx % PALETTE.length];
    paletteIdx++;
  }
  return TYPE_COLORS[key];
}

// Type文字列をカンマ分割して個別タグの配列にする
function tagsOf(type) {
  if (!type) return [];
  return type.split(',').map(t => t.trim()).filter(Boolean);
}

function collectTags(features) {
  const tags = new Set();
  features.forEach(f => {
    tagsOf(f.properties && f.properties.Type).forEach(tag => tags.add(tag));
  });
  return [...tags];
}

// ── Create colored circle marker ─────────────────────────────────────────
function makeIcon(type) {
  // 最初のタグの色をマーカーに使う
  const firstTag = tagsOf(type)[0] || type;
  const color = colorForType(firstTag);
  return L.divIcon({
    className: '',
    html: `<div class="custom-marker" style="width:14px;height:14px;background:${color};"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  });
}

// ── Build popup HTML ──────────────────────────────────────────────────────
function buildPopup(p) {
  const badges = tagsOf(p.Type).map(tag =>
    `<span class="popup-type-badge" style="background:${colorForType(tag)}">${tag}</span>`
  ).join(' ');

  const rows = [
    ['Adresse', p.Adresse],
    ['Gehdistanz', p.Gehdistanz],
    ['Sa-Öffnung', p.Öffnungszeiten_Sa],
    p.Notiz ? ['Notiz', p.Notiz] : null,
  ].filter(Boolean);

  const tableRows = rows.map(([k, v]) =>
    `<tr><td>${k}</td><td>${v}</td></tr>`
  ).join('');

  return `
    <div class="popup-content">
      <div style="margin-bottom:6px">${badges || '–'}</div>
      <h3>${p.Name}</h3>
      <table>${tableRows}</table>
    </div>
  `;
}

// ── Build sidebar list item ───────────────────────────────────────────────
function buildListItem(feature, marker) {
  const p = feature.properties;
  const tagBadges = tagsOf(p.Type).map(tag =>
    `<span class="result-type" style="background:${colorForType(tag)}">${tag}</span>`
  ).join(' ');

  const div = document.createElement('div');
  div.className = 'result-item';
  div.innerHTML = `
    <div class="result-name">${p.Name}</div>
    <div class="result-addr">${p.Adresse}</div>
    <div>${tagBadges || '–'}</div>
  `;
  div.addEventListener('click', () => {
    const coords = feature.geometry.coordinates;
    const latlng = L.latLng(coords[1], coords[0]);
    map.setView(latlng, 17, { animate: true });
    marker.openPopup();
    setActive(div);
    showRoute(latlng);
    // Auf Mobilgeräten Sidebar schließen und Karte zeigen
    if (window.matchMedia('(max-width: 640px)').matches) {
      document.getElementById('sidebar').classList.remove('open');
    }
  });
  return div;
}

// ── State ─────────────────────────────────────────────────────────────────
let allMarkers = [];
let activeFilter = 'all';
let searchQuery = '';
let activeItem = null;

// ── Mobile sidebar toggle ─────────────────────────────────────────────────
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ── Routing state ─────────────────────────────────────────────────────────
let userLocation = null;
let userMarker = null;
let routeLayer = null;

function setActive(listItem) {
  if (activeItem) activeItem.classList.remove('active');
  activeItem = listItem;
  if (activeItem) {
    activeItem.classList.add('active');
    activeItem.scrollIntoView({ block: 'nearest' });
  }
}

// ── Map init ──────────────────────────────────────────────────────────────
const map = L.map('map').setView([47.3735, 8.5505], 15);

// ── Geolocation ───────────────────────────────────────────────────────────
document.getElementById('locate-btn').addEventListener('click', () => {
  map.locate({ setView: true, maxZoom: 16 });
});

map.on('locationfound', e => {
  userLocation = e.latlng;

  if (userMarker) {
    userMarker.setLatLng(e.latlng);
  } else {
    userMarker = L.circleMarker(e.latlng, {
      radius: 8,
      color: '#fff',
      weight: 2,
      fillColor: '#3498db',
      fillOpacity: 1,
    }).addTo(map).bindPopup('Mein Standort');
  }

  const btn = document.getElementById('locate-btn');
  btn.textContent = 'Standort ✓';
  btn.classList.add('located');
});

map.on('locationerror', () => {
  alert('Standort konnte nicht ermittelt werden. Bitte erlauben Sie den Standortzugriff im Browser.');
});

// ── Routing (OSRM foot profile) ───────────────────────────────────────────
async function showRoute(destLatlng) {
  if (!userLocation) return;

  const { lat: sLat, lng: sLng } = userLocation;
  const { lat: dLat, lng: dLng } = destLatlng;
  const url =
    `https://router.project-osrm.org/route/v1/foot/` +
    `${sLng},${sLat};${dLng},${dLat}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes.length) return;

    const route = data.routes[0];

    if (routeLayer) routeLayer.remove();
    routeLayer = L.geoJSON(route.geometry, {
      style: { color: '#3498db', weight: 4, opacity: 0.75, dashArray: '6,4' },
    }).addTo(map);

    const distM = route.distance;
    const distStr = distM >= 1000
      ? `${(distM / 1000).toFixed(1)} km`
      : `${Math.round(distM)} m`;
    const minStr = `${Math.round(route.duration / 60)} Min.`;

    document.getElementById('route-distance').textContent = `🚶 ${distStr}`;
    document.getElementById('route-duration').textContent = `(${minStr})`;
    document.getElementById('route-info').hidden = false;
  } catch {
    console.warn('Route konnte nicht geladen werden.');
  }
}

function clearRoute() {
  if (routeLayer) { routeLayer.remove(); routeLayer = null; }
  document.getElementById('route-info').hidden = true;
}

document.getElementById('route-clear').addEventListener('click', clearRoute);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

// ── Update visibility ─────────────────────────────────────────────────────
function updateDisplay() {
  let count = 0;
  allMarkers.forEach(({ feature, marker, listItem }) => {
    const p = feature.properties;
    const matchesType = activeFilter === 'all' || tagsOf(p.Type).includes(activeFilter);
    const matchesSearch = !searchQuery ||
      (p.Name && p.Name.toLowerCase().includes(searchQuery)) ||
      (p.Adresse && p.Adresse.toLowerCase().includes(searchQuery)) ||
      (p.Type && p.Type.toLowerCase().includes(searchQuery)) ||
      (p.Notiz && p.Notiz.toLowerCase().includes(searchQuery));

    const visible = matchesType && matchesSearch;
    listItem.style.display = visible ? '' : 'none';
    if (visible) {
      marker.addTo(map);
      count++;
    } else {
      marker.remove();
    }
  });

  document.getElementById('result-count').textContent =
    `${count} Ergebnis${count !== 1 ? 'se' : ''}`;

  const allBtn = document.querySelector('.filter-btn[data-type="all"]');
  if (allBtn) allBtn.classList.toggle('active', activeFilter === 'all');
}

// ── Filter buttons ────────────────────────────────────────────────────────
function buildFilterButtons(tags) {
  const container = document.getElementById('filter-buttons');

  document.querySelector('.filter-btn[data-type="all"]').addEventListener('click', () => {
    activeFilter = 'all';
    updateFilterButtons();
    updateDisplay();
  });

  tags.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn';
    btn.dataset.type = tag;
    btn.textContent = tag;
    btn.style.borderColor = colorForType(tag);
    btn.addEventListener('click', () => {
      activeFilter = (activeFilter === tag) ? 'all' : tag;
      updateFilterButtons();
      updateDisplay();
    });
    container.appendChild(btn);
  });
}

function updateFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    const t = btn.dataset.type;
    const isActive = t === activeFilter || (t === 'all' && activeFilter === 'all');
    btn.classList.toggle('active', isActive);
    if (isActive && t !== 'all') {
      btn.style.background = colorForType(t);
    } else if (t !== 'all') {
      btn.style.background = '#fff';
    }
  });
}

// ── Search input ──────────────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value.toLowerCase().trim();
  updateDisplay();
});

// ── Load GeoJSON ──────────────────────────────────────────────────────────
fetch('essentrinken.json')
  .then(r => r.json())
  .then(data => {
    const tags = collectTags(data.features);
    tags.forEach(t => colorForType(t));

    buildFilterButtons(tags);

    const resultList = document.getElementById('result-list');
    data.features.forEach(feature => {
      const p = feature.properties;
      const coords = feature.geometry.coordinates;
      const latlng = [coords[1], coords[0]];

      const marker = L.marker(latlng, { icon: makeIcon(p.Type) })
        .bindPopup(buildPopup(p), { minWidth: 220 })
        .addTo(map);

      const listItem = buildListItem(feature, marker);
      resultList.appendChild(listItem);

      marker.on('click', () => {
        setActive(listItem);
        showRoute(L.latLng(coords[1], coords[0]));
      });

      allMarkers.push({ feature, marker, listItem });
    });

    updateDisplay();
  });
