# Thermal Field Survey

An installable, mostly-offline web app for outdoor thermal comfort field
research: GPS pathway tracking, live temperature/humidity, geotagged photo
observations, and a 7-point UTCI-aligned thermal comfort survey.

All data (tracks, surveys, notes, photos) is stored on-device in IndexedDB —
nothing is sent to a server except the live weather lookup itself.

## What it does

- **Track** — GPS pathway recording (start/pause/stop), like a fitness
  tracker: distance, duration, pace, and a plotted path, saved as a
  LineString. Works fully offline once GPS has a fix.
- **Conditions** — pulls current temperature and humidity for your GPS
  location from [Open-Meteo](https://open-meteo.com) (free, no API key).
  Requires a live connection; the last successful reading is cached and
  shown (marked "offline") when you have no signal.
- **Survey** — one-tap 7-point thermal comfort scale, color-coded hot→cool.
  Each response is stamped with the exact time and GPS coordinates of
  submission, so you can line it up against separately collected climate
  data afterward. If a recent (<30 min) app-fetched temp/humidity reading
  exists, it's attached too as a convenience cross-reference — clearly
  labeled as approximate, distinct from your primary climate dataset.
- **Notes** — geotagged field observations: free-text notes with optional
  photos, camera-direct capture, timestamped and located automatically.
- **Log** — everything in one searchable, filterable timeline.
- **Export** — GeoJSON/CSV for surveys and notes, GeoJSON/GPX for tracks,
  plus a full JSON backup including photos.

## The 7-point thermal scale

Your original list had "comfortable" twice, which read as a typo — this
fills the gap between "moderate" and "comfortable" so the scale is ordered
and each point is distinct:

1. Extreme heat stress / discomfort
2. Very strong heat stress / discomfort
3. Strong heat stress / discomfort
4. Moderate heat stress / discomfort
5. Slight heat stress / discomfort
6. Comfortable / no thermal stress
7. Cool / no stress

To change the wording or add/remove categories, edit the `THERMAL_SCALE`
array near the top of `app.js` — colors are pulled from the `--t1`…`--t7`
CSS variables in `styles.css` if you want to adjust the color mapping too.

## Getting it onto your iPhone

Needs to be served from a real URL — Safari won't offer "Add to Home
Screen" for a local file.

### GitHub Pages (free, ~5 minutes)
1. Create a new **public** GitHub repo.
2. Upload every file in this folder to the repo root, keeping the `icons/`
   folder structure.
3. **Settings → Pages → Source → Deploy from branch → main → /(root)**.
4. After ~1 minute, open the given URL in **Safari** on your iPhone.
5. **Share → Add to Home Screen → Add.**
6. Launch from the home screen — runs full-screen; GPS tracking, surveys,
   and notes all work with no signal. Only the live weather pull needs a
   connection.

### Netlify Drop (no account, ~1 minute)
Drag the whole folder onto https://app.netlify.com/drop, then open the
resulting URL in Safari and follow steps 5–6 above.

## Permissions

The first time you use Track, Survey, or Notes, iOS will prompt for
location access — choose **Allow While Using App**. If you deny it, GPS
readings will show "No fix" and entries will save without coordinates.
Camera access is prompted the first time you tap the photo **+** tile.

## On the weather data

Open-Meteo's `current` endpoint returns near-real-time model/observation
blended values, not a dedicated on-site sensor reading — treat the app's
temp/humidity as a reasonable ambient reference rather than a precision
instrument reading, especially in microclimates (shade, water, dense
building shadow) that a coarse grid model won't resolve. That's the reason
survey/note entries carry their own precise GPS + timestamp: so you can
join them against higher-resolution climate data collected separately.

## Customizing

- **Colors/fonts**: `:root` block at the top of `styles.css`.
- **Extra survey/note fields**: add inputs in `index.html`, read `.value`
  into the relevant `entry` object in `app.js`.
- **GPS tracking sensitivity**: `enableHighAccuracy`/`maximumAge` options
  are set in the `watchPosition` calls in `app.js` — lower `maximumAge`
  gives fresher but battery-hungrier fixes.

## Limitations

- Single-device only — no sync between phones.
- Battery: continuous high-accuracy GPS tracking is the most
  power-hungry mode on the phone. Expect noticeably faster drain during
  active track recording, similar to a fitness app.
- iOS Safari can occasionally clear site data if the device is critically
  low on storage and the app hasn't been opened in a long time. Export
  backups regularly, especially at the end of each field session.
