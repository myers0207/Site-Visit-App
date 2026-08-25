/* Thermal Field Survey — GPS tracking, live weather, geotagged notes/photos,
   and a 7-point UTCI-aligned thermal comfort survey. All data stored
   on-device (IndexedDB). Weather comes from the free Open-Meteo API
   (no key required) and is fetched live over the network when available. */

// ---------- IndexedDB ----------
const DB_NAME = 'thermal-field-db';
const STORES = ['tracks', 'surveys', 'notes', 'meta'];
let dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    STORES.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function dbPut(store, obj) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(obj);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbGetAll(store) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbDelete(store, id) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClearAll() {
  const db = await dbPromise;
  return Promise.all(STORES.map((s) => new Promise((resolve, reject) => {
    const tx = db.transaction(s, 'readwrite');
    tx.objectStore(s).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  })));
}

// ---------- Helpers ----------
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}
function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function timestampSlug() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }
function fmtTime(ts) { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function fmtDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function haversineM(a, b) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fileToDataURL(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
}
function downscaleImage(dataUrl, maxDim = 1600, quality = 0.75) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale); height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ---------- GPS ----------
function getCurrentPosition(opts = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000, ...opts });
  });
}

// ---------- Thermal comfort scale (UTCI-aligned, 7-point) ----------
const THERMAL_SCALE = [
  { label: 'Extreme heat stress / discomfort', color: 'var(--t1)' },
  { label: 'Very strong heat stress / discomfort', color: 'var(--t2)' },
  { label: 'Strong heat stress / discomfort', color: 'var(--t3)' },
  { label: 'Moderate heat stress / discomfort', color: 'var(--t4)' },
  { label: 'Slight heat stress / discomfort', color: 'var(--t5)' },
  { label: 'Comfortable / no thermal stress', color: 'var(--t6)' },
  { label: 'Cool / no stress', color: 'var(--t7)' },
];

// ---------- Weather (Open-Meteo, no API key) ----------
let lastWeather = null; // {temp, humidity, ts, lat, lng}

async function fetchWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m&temperature_unit=celsius`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('weather fetch failed');
  const data = await res.json();
  const reading = {
    temp: data.current.temperature_2m,
    humidity: data.current.relative_humidity_2m,
    ts: Date.now(),
    lat, lng,
  };
  lastWeather = reading;
  await dbPut('meta', { id: 'lastWeather', ...reading });
  return reading;
}

function renderWeather(reading, stale) {
  const tempBox = document.getElementById('temp-box');
  const humBox = document.getElementById('humidity-box');
  tempBox.classList.toggle('readout-stale', !!stale);
  humBox.classList.toggle('readout-stale', !!stale);
  if (!reading) {
    document.getElementById('temp-val').innerHTML = '—';
    document.getElementById('humidity-val').innerHTML = '—';
    document.getElementById('weather-meta').textContent = 'Not yet fetched';
    return;
  }
  document.getElementById('temp-val').innerHTML = `${reading.temp.toFixed(1)}<span class="unit">°C</span>`;
  document.getElementById('humidity-val').innerHTML = `${Math.round(reading.humidity)}<span class="unit">%</span>`;
  document.getElementById('weather-meta').textContent = (stale ? 'Last synced (offline): ' : 'Synced: ') + fmtTime(reading.ts);
}

async function refreshWeatherAtCurrentLocation() {
  document.getElementById('weather-meta').textContent = 'Locating…';
  try {
    const pos = await getCurrentPosition();
    document.getElementById('weather-meta').textContent = 'Fetching conditions…';
    const reading = await fetchWeather(pos.coords.latitude, pos.coords.longitude);
    renderWeather(reading, false);
    toast('Conditions updated');
  } catch (e) {
    renderWeather(lastWeather, true);
    toast(navigator.onLine ? 'Could not get a GPS fix' : 'Offline — showing last synced reading');
  }
}

document.getElementById('btn-refresh-weather').addEventListener('click', refreshWeatherAtCurrentLocation);

// ---------- View navigation ----------
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  const titles = { track: 'Track', survey: 'Thermal Survey', notes: 'Field Notes', log: 'Log', export: 'Export', detail: 'Entry Detail' };
  document.getElementById('topbar-title').textContent = titles[name] || '';
  if (name === 'log') renderLog();
  if (name === 'export') renderExportStats();
  if (name === 'survey') updateGpsMini('survey');
  if (name === 'notes') updateGpsMini('notes');
}
document.querySelectorAll('.navbtn').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.view)));

// ---------- Shared GPS mini-readout (survey/notes tabs) ----------
async function updateGpsMini(prefix) {
  const dot = document.getElementById(prefix + '-gps-dot');
  const text = document.getElementById(prefix + '-gps-text');
  text.textContent = 'Getting fix…';
  dot.className = 'dot';
  try {
    const pos = await getCurrentPosition();
    const { latitude, longitude, accuracy } = pos.coords;
    dot.className = 'dot ' + (accuracy <= 20 ? 'fix-good' : 'fix-poor');
    text.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)} · ±${Math.round(accuracy)}m`;
  } catch (e) {
    dot.className = 'dot fix-none';
    text.textContent = 'No fix — check location permission';
  }
}

// ============================================================
// TRACK RECORDING
// ============================================================
let trackState = 'idle'; // idle | recording | paused
let trackPoints = [];
let trackWatchId = null;
let trackStartTs = null;
let trackElapsedBeforePause = 0;
let trackPauseStartTs = null;
let trackTimerInterval = null;
let trackWeatherStart = null;

function updateTrackGpsMini(accuracy) {
  const dot = document.getElementById('track-gps-dot');
  const text = document.getElementById('track-gps-text');
  if (accuracy == null) { dot.className = 'dot'; text.textContent = 'No fix yet'; return; }
  dot.className = 'dot ' + (accuracy <= 20 ? 'fix-good' : 'fix-poor');
  text.textContent = `±${Math.round(accuracy)}m accuracy · ${trackPoints.length} points logged`;
}

function computeStats() {
  let dist = 0;
  for (let i = 1; i < trackPoints.length; i++) dist += haversineM(trackPoints[i - 1], trackPoints[i]);
  const elapsedMs = trackState === 'paused'
    ? trackElapsedBeforePause
    : trackElapsedBeforePause + (trackStartTs ? Date.now() - trackStartTs : 0);
  const elapsedSec = elapsedMs / 1000;
  const km = dist / 1000;
  const paceMinPerKm = km > 0.02 ? (elapsedSec / 60) / km : null;
  return { distM: dist, elapsedSec, paceMinPerKm };
}

function renderTrackPath() {
  const svg = document.getElementById('track-svg');
  const emptyMsg = document.getElementById('track-empty-msg');
  if (trackPoints.length < 2) { svg.style.display = 'none'; emptyMsg.style.display = 'block'; return; }
  svg.style.display = 'block'; emptyMsg.style.display = 'none';

  const lats = trackPoints.map((p) => p.lat), lngs = trackPoints.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const padding = 20, W = 300, H = 225;
  const spanLat = Math.max(maxLat - minLat, 0.00005);
  const spanLng = Math.max(maxLng - minLng, 0.00005);
  // preserve aspect: scale by whichever span is more constrained
  const scaleX = (W - padding * 2) / spanLng;
  const scaleY = (H - padding * 2) / spanLat;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = (W - spanLng * scale) / 2;
  const offsetY = (H - spanLat * scale) / 2;

  const toXY = (p) => {
    const x = offsetX + (p.lng - minLng) * scale;
    const y = H - (offsetY + (p.lat - minLat) * scale); // flip Y (lat increases north = up)
    return [x, y];
  };
  const pts = trackPoints.map(toXY);
  document.getElementById('track-polyline').setAttribute('points', pts.map((p) => p.join(',')).join(' '));
  const [sx, sy] = pts[0]; const [ex, ey] = pts[pts.length - 1];
  document.getElementById('track-start-dot').setAttribute('cx', sx); document.getElementById('track-start-dot').setAttribute('cy', sy);
  document.getElementById('track-end-dot').setAttribute('cx', ex); document.getElementById('track-end-dot').setAttribute('cy', ey);
}

function tickTrackUI() {
  const { distM, elapsedSec, paceMinPerKm } = computeStats();
  document.getElementById('stat-distance').innerHTML = `${(distM / 1000).toFixed(2)}<span class="unit"> km</span>`;
  document.getElementById('stat-duration').textContent = fmtDuration(elapsedSec);
  document.getElementById('stat-pace').textContent = paceMinPerKm ? `${Math.floor(paceMinPerKm)}:${String(Math.round((paceMinPerKm % 1) * 60)).padStart(2, '0')}` : '—';
  renderTrackPath();
}

async function startTracking() {
  trackState = 'recording';
  trackPoints = [];
  trackElapsedBeforePause = 0;
  trackStartTs = Date.now();
  trackWeatherStart = lastWeather;

  document.getElementById('btn-record').style.display = 'none';
  document.getElementById('record-sub-row').style.display = 'flex';
  document.getElementById('btn-pause-resume').textContent = 'Pause';

  trackWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      trackPoints.push({ lat: latitude, lng: longitude, accuracy, ts: Date.now() });
      updateTrackGpsMini(accuracy);
    },
    (err) => { toast('GPS signal lost — will keep trying'); },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
  );
  trackTimerInterval = setInterval(tickTrackUI, 1000);
  toast('Recording started');
}

function pauseTracking() {
  trackState = 'paused';
  trackElapsedBeforePause += Date.now() - trackStartTs;
  if (trackWatchId !== null) navigator.geolocation.clearWatch(trackWatchId);
  trackWatchId = null;
  document.getElementById('btn-pause-resume').textContent = 'Resume';
  toast('Paused');
}

function resumeTracking() {
  trackState = 'recording';
  trackStartTs = Date.now();
  trackWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      trackPoints.push({ lat: latitude, lng: longitude, accuracy, ts: Date.now() });
      updateTrackGpsMini(accuracy);
    },
    () => { toast('GPS signal lost — will keep trying'); },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
  );
  document.getElementById('btn-pause-resume').textContent = 'Pause';
  toast('Resumed');
}

async function stopTracking() {
  if (trackState === 'recording') trackElapsedBeforePause += Date.now() - trackStartTs;
  if (trackWatchId !== null) navigator.geolocation.clearWatch(trackWatchId);
  trackWatchId = null;
  clearInterval(trackTimerInterval);

  const { distM, elapsedSec } = computeStats();

  if (trackPoints.length < 2) {
    toast('Track too short to save');
  } else {
    const track = {
      id: uuid(),
      type: 'track',
      startedAt: trackStartTs - trackElapsedBeforePause, // approx
      createdAt: Date.now(),
      points: trackPoints,
      distanceM: distM,
      durationS: elapsedSec,
      weatherStart: trackWeatherStart,
    };
    await dbPut('tracks', track);
    toast('Track saved');
  }

  trackState = 'idle';
  trackPoints = [];
  document.getElementById('btn-record').style.display = 'block';
  document.getElementById('record-sub-row').style.display = 'none';
  document.getElementById('stat-distance').innerHTML = '0.00<span class="unit"> km</span>';
  document.getElementById('stat-duration').textContent = '00:00';
  document.getElementById('stat-pace').textContent = '—';
  updateTrackGpsMini(null);
  renderTrackPath();
}

document.getElementById('btn-record').addEventListener('click', startTracking);
document.getElementById('btn-pause-resume').addEventListener('click', () => {
  if (trackState === 'recording') pauseTracking(); else resumeTracking();
});
document.getElementById('btn-stop-track').addEventListener('click', stopTracking);

// ============================================================
// THERMAL SURVEY
// ============================================================
const surveyGrid = document.getElementById('survey-grid');
THERMAL_SCALE.forEach((opt, i) => {
  const btn = document.createElement('button');
  btn.className = 'survey-btn';
  btn.innerHTML = `<span class="swatch" style="background:${opt.color}"></span><span><span class="num">${i + 1}</span><span class="label">${opt.label}</span></span>`;
  btn.addEventListener('click', () => submitSurvey(i, opt.label));
  surveyGrid.appendChild(btn);
});

async function submitSurvey(index, label) {
  toast('Getting location…');
  try {
    const pos = await getCurrentPosition();
    const entry = {
      id: uuid(),
      type: 'survey',
      createdAt: Date.now(),
      categoryIndex: index,
      categoryLabel: label,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      weatherSnapshot: lastWeather && (Date.now() - lastWeather.ts < 30 * 60 * 1000) ? lastWeather : null,
    };
    await dbPut('surveys', entry);
    toast(`Logged: ${label}`);
  } catch (e) {
    const entry = {
      id: uuid(), type: 'survey', createdAt: Date.now(),
      categoryIndex: index, categoryLabel: label,
      lat: null, lng: null, accuracy: null, weatherSnapshot: null,
    };
    await dbPut('surveys', entry);
    toast('Logged (no GPS fix available)');
  }
}

// ============================================================
// NOTES
// ============================================================
let currentPhotos = [];
const photoGrid = document.getElementById('photo-grid');
const photoInput = document.getElementById('photo-input');

function renderPhotoGrid() {
  photoGrid.innerHTML = '';
  currentPhotos.forEach((p, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'photo-thumb';
    thumb.innerHTML = `<img src="${p}"><div class="remove" data-i="${i}">✕</div>`;
    photoGrid.appendChild(thumb);
  });
  const addBtn = document.createElement('label');
  addBtn.className = 'photo-add'; addBtn.setAttribute('for', 'photo-input'); addBtn.textContent = '+';
  photoGrid.appendChild(addBtn);
  photoGrid.querySelectorAll('.remove').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.preventDefault(); currentPhotos.splice(parseInt(btn.dataset.i), 1); renderPhotoGrid(); });
  });
}
renderPhotoGrid();

photoInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    const raw = await fileToDataURL(file);
    currentPhotos.push(await downscaleImage(raw));
  }
  renderPhotoGrid();
  photoInput.value = '';
});

document.getElementById('btn-save-note').addEventListener('click', async () => {
  const notes = document.getElementById('f-notes').value.trim();
  if (!notes && currentPhotos.length === 0) { toast('Add notes or a photo first'); return; }
  toast('Getting location…');
  let pos = null;
  try { pos = await getCurrentPosition(); } catch (e) {}

  const entry = {
    id: uuid(),
    type: 'note',
    createdAt: Date.now(),
    notes: notes || null,
    photos: currentPhotos,
    lat: pos ? pos.coords.latitude : null,
    lng: pos ? pos.coords.longitude : null,
    accuracy: pos ? pos.coords.accuracy : null,
    weatherSnapshot: lastWeather && (Date.now() - lastWeather.ts < 30 * 60 * 1000) ? lastWeather : null,
  };
  await dbPut('notes', entry);
  toast(pos ? 'Observation saved' : 'Saved (no GPS fix)');
  document.getElementById('f-notes').value = '';
  currentPhotos = [];
  renderPhotoGrid();
});

// ============================================================
// LOG
// ============================================================
let logFilter = 'all';
let logCache = [];

document.getElementById('filter-row').addEventListener('click', (e) => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  document.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('selected'));
  chip.classList.add('selected');
  logFilter = chip.dataset.filter;
  renderLog();
});

async function renderLog() {
  const [tracks, surveys, notes] = await Promise.all([dbGetAll('tracks'), dbGetAll('surveys'), dbGetAll('notes')]);
  const merged = [
    ...tracks.map((t) => ({ ...t, _sortTs: t.createdAt })),
    ...surveys.map((s) => ({ ...s, _sortTs: s.createdAt })),
    ...notes.map((n) => ({ ...n, _sortTs: n.createdAt })),
  ].sort((a, b) => b._sortTs - a._sortTs);
  logCache = merged;

  const filtered = logFilter === 'all' ? merged : merged.filter((e) => e.type === logFilter);
  const list = document.getElementById('log-list');
  const empty = document.getElementById('log-empty');
  list.innerHTML = '';
  empty.style.display = filtered.length ? 'none' : 'block';

  filtered.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'entry-row';
    let icon = '◆', title = '', sub = '';
    if (entry.type === 'track') {
      icon = '▲';
      title = `Track — ${(entry.distanceM / 1000).toFixed(2)} km`;
      sub = `${fmtDuration(entry.durationS)}${entry.dot ? '' : ''}<span class="dot">&middot;</span>${fmtTime(entry.createdAt)}`;
    } else if (entry.type === 'survey') {
      icon = `<span class="swatch-inline" style="background:${THERMAL_SCALE[entry.categoryIndex].color}"></span>`;
      title = entry.categoryLabel;
      sub = `${entry.lat ? 'GPS' : 'No GPS'}<span class="dot">&middot;</span>${fmtTime(entry.createdAt)}`;
    } else if (entry.type === 'note') {
      icon = entry.photos && entry.photos.length ? `<img src="${entry.photos[0]}">` : '✎';
      title = entry.notes ? (entry.notes.length > 42 ? entry.notes.slice(0, 42) + '…' : entry.notes) : 'Photo observation';
      sub = `${entry.photos ? entry.photos.length : 0} photo${(entry.photos && entry.photos.length === 1) ? '' : 's'}<span class="dot">&middot;</span>${fmtTime(entry.createdAt)}`;
    }
    row.innerHTML = `<div class="entry-icon">${icon}</div><div class="entry-main"><div class="entry-title">${entry.type === 'survey' ? '' : ''}${title}</div><div class="entry-sub">${sub}</div></div>`;
    row.addEventListener('click', () => showDetail(entry.id, entry.type));
    list.appendChild(row);
  });
}

// ============================================================
// DETAIL
// ============================================================
let currentDetail = null;
async function showDetail(id, type) {
  const entry = logCache.find((e) => e.id === id) || (await dbGetAll(type + 's')).find((e) => e.id === id);
  currentDetail = { id, type };
  const c = document.getElementById('detail-content');
  let html = '';

  if (type === 'track') {
    html += `<div class="detail-field"><div class="k">Distance</div><div class="v">${(entry.distanceM / 1000).toFixed(2)} km</div></div>`;
    html += `<div class="detail-field"><div class="k">Duration</div><div class="v">${fmtDuration(entry.durationS)}</div></div>`;
    html += `<div class="detail-field"><div class="k">Avg pace</div><div class="v">${entry.distanceM > 20 ? (entry.durationS / 60 / (entry.distanceM / 1000)).toFixed(2) + ' min/km' : '—'}</div></div>`;
    html += `<div class="detail-field"><div class="k">Points logged</div><div class="v">${entry.points.length}</div></div>`;
    html += `<div class="detail-field"><div class="k">Started</div><div class="v">${fmtTime(entry.startedAt)}</div></div>`;
    if (entry.weatherStart) html += `<div class="detail-field"><div class="k">Conditions at start</div><div class="v">${entry.weatherStart.temp.toFixed(1)}°C, ${Math.round(entry.weatherStart.humidity)}% humidity</div></div>`;
  } else if (type === 'survey') {
    html += `<div class="detail-field"><div class="k">Response</div><div class="v"><span class="swatch-inline" style="background:${THERMAL_SCALE[entry.categoryIndex].color}"></span>${entry.categoryLabel}</div></div>`;
    html += `<div class="detail-field"><div class="k">Time</div><div class="v">${fmtTime(entry.createdAt)}</div></div>`;
    html += `<div class="detail-field"><div class="k">Coordinates</div><div class="v">${entry.lat ? `${entry.lat.toFixed(6)}, ${entry.lng.toFixed(6)} (±${Math.round(entry.accuracy)}m)` : 'Not recorded'}</div></div>`;
    if (entry.weatherSnapshot) html += `<div class="detail-field"><div class="k">App-fetched conditions (approx.)</div><div class="v">${entry.weatherSnapshot.temp.toFixed(1)}°C, ${Math.round(entry.weatherSnapshot.humidity)}% humidity</div></div>`;
  } else if (type === 'note') {
    if (entry.photos && entry.photos.length) html += `<div class="detail-photos">${entry.photos.map((p) => `<img src="${p}">`).join('')}</div><div style="height:14px;"></div>`;
    if (entry.notes) html += `<div class="detail-field"><div class="k">Notes</div><div class="v">${escapeHtml(entry.notes)}</div></div>`;
    html += `<div class="detail-field"><div class="k">Time</div><div class="v">${fmtTime(entry.createdAt)}</div></div>`;
    html += `<div class="detail-field"><div class="k">Coordinates</div><div class="v">${entry.lat ? `${entry.lat.toFixed(6)}, ${entry.lng.toFixed(6)} (±${Math.round(entry.accuracy)}m)` : 'Not recorded'}</div></div>`;
    if (entry.weatherSnapshot) html += `<div class="detail-field"><div class="k">App-fetched conditions (approx.)</div><div class="v">${entry.weatherSnapshot.temp.toFixed(1)}°C, ${Math.round(entry.weatherSnapshot.humidity)}% humidity</div></div>`;
  }

  c.innerHTML = html;
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-detail').classList.add('active');
  document.getElementById('topbar-title').textContent = 'Entry Detail';
  document.querySelectorAll('.navbtn').forEach((b) => b.classList.remove('active'));
}
document.getElementById('btn-back-to-log').addEventListener('click', () => showView('log'));
document.getElementById('btn-delete-entry').addEventListener('click', async () => {
  if (!currentDetail) return;
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  await dbDelete(currentDetail.type + 's', currentDetail.id);
  toast('Deleted');
  showView('log');
});

// ============================================================
// EXPORT
// ============================================================
async function renderExportStats() {
  const [tracks, surveys, notes] = await Promise.all([dbGetAll('tracks'), dbGetAll('surveys'), dbGetAll('notes')]);
  document.getElementById('stat-tracks').textContent = tracks.length;
  document.getElementById('stat-surveys').textContent = surveys.length;
  document.getElementById('stat-notes').textContent = notes.length;
}

document.querySelectorAll('[data-export]').forEach((btn) => {
  btn.addEventListener('click', () => handleExport(btn.dataset.export));
});

async function handleExport(kind) {
  const slug = timestampSlug();
  if (kind === 'survey-geojson') {
    const surveys = await dbGetAll('surveys');
    const fc = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } }, features: surveys.map((s) => ({
      type: 'Feature',
      geometry: s.lat ? { type: 'Point', coordinates: [s.lng, s.lat] } : null,
      properties: {
        id: s.id, category_index: s.categoryIndex + 1, category_label: s.categoryLabel,
        accuracy_m: s.accuracy, timestamp: new Date(s.createdAt).toISOString(),
        temp_c: s.weatherSnapshot ? s.weatherSnapshot.temp : null,
        humidity_pct: s.weatherSnapshot ? s.weatherSnapshot.humidity : null,
      },
    })) };
    downloadBlob(`thermal-surveys-${slug}.geojson`, JSON.stringify(fc, null, 2), 'application/geo+json');
  } else if (kind === 'survey-csv') {
    const surveys = await dbGetAll('surveys');
    const headers = ['id', 'timestamp', 'lat', 'lng', 'accuracy_m', 'category_index', 'category_label', 'temp_c', 'humidity_pct'];
    const lines = [headers.join(',')];
    surveys.forEach((s) => lines.push([s.id, new Date(s.createdAt).toISOString(), s.lat, s.lng, s.accuracy, s.categoryIndex + 1, s.categoryLabel, s.weatherSnapshot ? s.weatherSnapshot.temp : '', s.weatherSnapshot ? s.weatherSnapshot.humidity : ''].map(csvEscape).join(',')));
    downloadBlob(`thermal-surveys-${slug}.csv`, lines.join('\n'), 'text/csv');
  } else if (kind === 'note-geojson') {
    const notes = await dbGetAll('notes');
    const fc = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } }, features: notes.map((n) => ({
      type: 'Feature',
      geometry: n.lat ? { type: 'Point', coordinates: [n.lng, n.lat] } : null,
      properties: {
        id: n.id, notes: n.notes, photo_count: n.photos ? n.photos.length : 0,
        accuracy_m: n.accuracy, timestamp: new Date(n.createdAt).toISOString(),
        temp_c: n.weatherSnapshot ? n.weatherSnapshot.temp : null,
        humidity_pct: n.weatherSnapshot ? n.weatherSnapshot.humidity : null,
      },
    })) };
    downloadBlob(`field-notes-${slug}.geojson`, JSON.stringify(fc, null, 2), 'application/geo+json');
  } else if (kind === 'note-csv') {
    const notes = await dbGetAll('notes');
    const headers = ['id', 'timestamp', 'lat', 'lng', 'accuracy_m', 'notes', 'photo_count', 'temp_c', 'humidity_pct'];
    const lines = [headers.join(',')];
    notes.forEach((n) => lines.push([n.id, new Date(n.createdAt).toISOString(), n.lat, n.lng, n.accuracy, n.notes, n.photos ? n.photos.length : 0, n.weatherSnapshot ? n.weatherSnapshot.temp : '', n.weatherSnapshot ? n.weatherSnapshot.humidity : ''].map(csvEscape).join(',')));
    downloadBlob(`field-notes-${slug}.csv`, lines.join('\n'), 'text/csv');
  } else if (kind === 'track-geojson') {
    const tracks = await dbGetAll('tracks');
    const fc = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } }, features: tracks.map((t) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: t.points.map((p) => [p.lng, p.lat]) },
      properties: {
        id: t.id, distance_m: Math.round(t.distanceM), duration_s: Math.round(t.durationS),
        started_at: new Date(t.startedAt).toISOString(), point_count: t.points.length,
        temp_c_at_start: t.weatherStart ? t.weatherStart.temp : null,
        humidity_pct_at_start: t.weatherStart ? t.weatherStart.humidity : null,
      },
    })) };
    downloadBlob(`gps-tracks-${slug}.geojson`, JSON.stringify(fc, null, 2), 'application/geo+json');
  } else if (kind === 'track-gpx') {
    const tracks = await dbGetAll('tracks');
    let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Thermal Field Survey" xmlns="http://www.topografix.com/GPX/1/1">\n`;
    tracks.forEach((t, i) => {
      gpx += `  <trk><name>Track ${i + 1} — ${new Date(t.startedAt).toISOString()}</name><trkseg>\n`;
      t.points.forEach((p) => { gpx += `    <trkpt lat="${p.lat}" lon="${p.lng}"><time>${new Date(p.ts).toISOString()}</time></trkpt>\n`; });
      gpx += `  </trkseg></trk>\n`;
    });
    gpx += `</gpx>\n`;
    downloadBlob(`gps-tracks-${slug}.gpx`, gpx, 'application/gpx+xml');
  } else if (kind === 'full-json') {
    const [tracks, surveys, notes] = await Promise.all([dbGetAll('tracks'), dbGetAll('surveys'), dbGetAll('notes')]);
    downloadBlob(`thermal-field-backup-${slug}.json`, JSON.stringify({ tracks, surveys, notes }, null, 2), 'application/json');
  }
  toast('Exported');
}

document.getElementById('btn-wipe-all').addEventListener('click', async () => {
  if (!confirm('Erase ALL data on this device? Export a backup first if you need one. This cannot be undone.')) return;
  await dbClearAll();
  toast('All data erased');
  renderExportStats();
});

// ---------- Online/offline ----------
function updateStatus() {
  const pill = document.getElementById('status-pill');
  if (navigator.onLine) { pill.textContent = 'Online'; pill.className = 'status-pill online'; }
  else { pill.textContent = 'Offline'; pill.className = 'status-pill offline'; }
}
window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);
updateStatus();

// ---------- Service worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./service-worker.js').catch(() => {}); });
}

// ---------- Init ----------
(async function init() {
  try {
    const cached = (await dbGetAll('meta')).find((m) => m.id === 'lastWeather');
    if (cached) { lastWeather = cached; renderWeather(cached, true); }
  } catch (e) {}
  refreshWeatherAtCurrentLocation();
})();
