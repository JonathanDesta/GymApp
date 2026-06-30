'use strict';
// ─── Travel-time engine ───────────────────────────────────────────────────────
// Default path is FREE and needs no key:
//   • Geocode addresses with OpenStreetMap Nominatim (cached permanently).
//   • Driving time from the public OSRM demo server (cached per origin→dest).
//   • Walking/transit estimated from road distance when no key is set.
// Optional: paste a Google Maps JS API key in Settings to use live, traffic-aware
// Distance Matrix instead (loaded lazily through the Maps JS SDK).
//
// The timeline reads travel times *synchronously from cache*; anything missing is
// fetched in the background by prefetchTravel(), which re-renders when it lands.

const GEOCODE_TTL = 1000 * 60 * 60 * 24 * 180; // 180 days
const ROUTE_TTL = 1000 * 60 * 60 * 24 * 14;    // 14 days (no traffic in free mode)
let travelInFlight = new Set();
let gmapsPromise = null;

function normAddr(a) { return (a || "").trim().toLowerCase().replace(/\s+/g, " "); }

// ── Geocoding ──
function geocodeCached(addr) {
  const k = normAddr(addr);
  const p = DATA.places[k];
  if (p && p.lat != null && (Date.now() - (p.ts || 0) < GEOCODE_TTL)) return p;
  return null;
}
async function geocode(addr) {
  if (!addr) return null;
  const cached = geocodeCached(addr);
  if (cached) return cached;
  try {
    const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(addr);
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) throw new Error("geocode " + r.status);
    const j = await r.json();
    if (!j.length) return null;
    const place = { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), label: j[0].display_name, ts: Date.now() };
    DATA.places[normAddr(addr)] = place;
    saveLocal();
    return place;
  } catch (e) { return null; }
}

// ── Distance / fallback ──
function haversineKm(a, b) {
  const R = 6371, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function estimateSec(o, d, mode) {
  const km = haversineKm(o, d) * 1.3; // rough road detour factor
  const kmh = mode === "walking" ? 4.8 : mode === "transit" ? 22 : 38;
  return Math.round((km / kmh) * 3600);
}

// ── Route key + sync cache read ──
function routeKey(o, d, mode) { return `${o.lat.toFixed(4)},${o.lon.toFixed(4)}|${d.lat.toFixed(4)},${d.lon.toFixed(4)}|${mode}`; }
function routeCached(o, d, mode) {
  const c = DATA.routeCache[routeKey(o, d, mode)];
  if (c && (Date.now() - (c.ts || 0) < ROUTE_TTL)) return c.sec;
  return null;
}

// Synchronous best-effort travel time (seconds) between two addresses, from cache.
// Returns { sec, exact } or null if both endpoints aren't geocoded yet.
function travelSecCached(originAddr, destAddr, mode) {
  mode = mode || (DATA.settings.travelMode || "driving");
  const o = geocodeCached(originAddr), d = geocodeCached(destAddr);
  if (!o || !d) return null;
  const r = routeCached(o, d, mode);
  if (r != null) return { sec: r, exact: true };
  return { sec: estimateSec(o, d, mode), exact: false };
}

// ── Live fetch (background) ──
async function osrmDuration(o, d) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${o.lon},${o.lat};${d.lon},${d.lat}?overview=false`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("osrm " + r.status);
    const j = await r.json();
    if (j.routes && j.routes[0]) return Math.round(j.routes[0].duration);
  } catch (e) {}
  return null;
}
function loadGoogleMaps(key) {
  if (gmapsPromise) return gmapsPromise;
  gmapsPromise = new Promise((resolve, reject) => {
    if (window.google && google.maps && google.maps.DistanceMatrixService) return resolve();
    const s = document.createElement("script");
    s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key);
    s.async = true; s.onload = () => resolve(); s.onerror = () => reject(new Error("maps load"));
    document.head.appendChild(s);
  });
  return gmapsPromise;
}
async function googleDuration(o, d, mode) {
  try {
    await loadGoogleMaps(DATA.settings.mapsApiKey);
    const svc = new google.maps.DistanceMatrixService();
    const travelMode = mode === "walking" ? "WALKING" : mode === "transit" ? "TRANSIT" : "DRIVING";
    return await new Promise((resolve) => {
      svc.getDistanceMatrix({
        origins: [{ lat: o.lat, lng: o.lon }], destinations: [{ lat: d.lat, lng: d.lon }],
        travelMode, drivingOptions: travelMode === "DRIVING" ? { departureTime: new Date() } : undefined,
      }, (res, status) => {
        if (status !== "OK") return resolve(null);
        const el = res.rows[0].elements[0];
        if (el.status !== "OK") return resolve(null);
        resolve(Math.round((el.duration_in_traffic || el.duration).value));
      });
    });
  } catch (e) { return null; }
}

// Fetch any travel pairs not yet cached, then re-render once. `pairs` = [{origin,dest}].
async function prefetchTravel(pairs, mode) {
  mode = mode || (DATA.settings.travelMode || "driving");
  let changed = false;
  for (const { origin, dest } of pairs) {
    if (!origin || !dest) continue;
    const o = await geocode(origin), d = await geocode(dest);
    if (!o || !d) continue;
    const key = routeKey(o, d, mode);
    if (DATA.routeCache[key] && (Date.now() - DATA.routeCache[key].ts < ROUTE_TTL)) continue;
    if (travelInFlight.has(key)) continue;
    travelInFlight.add(key);
    let sec = null;
    if ((DATA.settings.mapsApiKey || "").trim()) sec = await googleDuration(o, d, mode);
    if (sec == null && mode === "driving") sec = await osrmDuration(o, d);
    if (sec == null) sec = estimateSec(o, d, mode);
    DATA.routeCache[key] = { sec, ts: Date.now() };
    travelInFlight.delete(key);
    changed = true;
    // be polite to the free endpoints
    await new Promise(r => setTimeout(r, 1100));
  }
  if (changed) { saveLocal(); if (typeof render === "function") render(); }
}
