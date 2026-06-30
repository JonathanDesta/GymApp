'use strict';
// ─── Day — Life Manager: state, persistence & Google Drive sync ───────────────
// Single source of truth. Device-first (localStorage), with optional Google Drive
// sync of one JSON file (drive.file scope — only ever sees files this app creates).

// Google OAuth. The same token client requests Drive (for sync) and Calendar
// (read-only) scopes. Paste your client id in Settings; this default is the one
// from the sister app and only works once its origin is whitelisted in the
// Google Cloud console (see SETUP.md).
const DEFAULT_CLIENT_ID = "";
const GOOGLE_SCOPES =
  "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.readonly";
const DRIVE_FILENAME = "day_lifemanager.json";
const CACHE_KEY = "day_cache_v1";

let accessToken = null; // in-memory only — never persisted
let tokenClient = null; // GIS token client
let fileId = null;      // cached Drive file id for in-place PATCH

// ─── Data model ───────────────────────────────────────────────────────────────
let DATA = defaultData();
function defaultData() {
  return {
    version: 1,
    updated: null,
    // Routines (morning + nighttime) — same timed runner engine.
    routineConfig: { steps: [] },
    nightConfig: { steps: [] },
    routineLog: [],
    nightLog: [],
    // Workout duration mirror (no exercise logging — the sister app does that).
    workout: {
      blockId: 1, weekInBlock: 0, cutting: false,
      departTime: "15:00",          // default "leave the house for the gym" time
      days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], // weekdays you train (Sun = rest by default)
    },
    settings: {
      googleClientId: DEFAULT_CLIENT_ID,
      googleCalEnabled: false,
      googleCalendarIds: ["primary"],
      outlookIcsUrl: "",
      corsProxy: "",                // optional, for Outlook ICS if it blocks CORS
      homeAddress: "",
      gymAddress: "",
      wakeTime: "07:00",
      bedTime: "23:00",
      travelMode: "driving",        // driving | walking | transit (transit needs Google key)
      mapsApiKey: "",               // optional Google key for live/traffic travel time
      defaultTravelMin: 15,         // fallback buffer when no route can be computed
      workoutAppUrl: "https://jonathandesta.github.io/oly-tracker/", // embedded in the Workout tab
    },
    olyState: null, // synced snapshot of the embedded workout app: { data:<oly_state>, ts }
    places: {},     // normalizedAddress -> { lat, lon, label, ts }
    routeCache: {}, // "olat,olon|dlat,dlon|mode" -> { sec, ts }
    dayPlans: {},   // 'YYYY-MM-DD' -> { wakeTime?, bedTime?, workoutDepart?, workoutSkip?, tasks:[], removedEventIds:[] }
    calCache: {},   // 'YYYY-MM-DD' -> { google:[], outlook:[], ts }
  };
}

// Seed/repair missing keys so older Drive files gain new fields without data loss.
function normalizeData() {
  if (!DATA || typeof DATA !== "object") DATA = defaultData();
  const d = defaultData();
  for (const k of Object.keys(d)) {
    if (DATA[k] === undefined) DATA[k] = d[k];
  }
  // deep-fill settings & workout so newly added options appear
  DATA.settings = Object.assign({}, d.settings, DATA.settings || {});
  DATA.workout = Object.assign({}, d.workout, DATA.workout || {});

  // Routine configs: (re)seed when missing or when the seed version bumps.
  const rc = DATA.routineConfig;
  if (!rc || !Array.isArray(rc.steps) || !rc.steps.length || rc.v !== ROUTINE_VERSION) {
    DATA.routineConfig = {
      v: ROUTINE_VERSION,
      steps: ROUTINE_SEED.map(s => Object.assign({}, s)),
      transitionSec: (rc && typeof rc.transitionSec === "number") ? rc.transitionSec : 45,
    };
  }
  if (typeof DATA.routineConfig.transitionSec !== "number") DATA.routineConfig.transitionSec = 45;

  const nc = DATA.nightConfig;
  if (!nc || !Array.isArray(nc.steps) || !nc.steps.length || nc.v !== NIGHT_VERSION) {
    DATA.nightConfig = {
      v: NIGHT_VERSION,
      steps: NIGHT_SEED.map(s => Object.assign({}, s)),
      transitionSec: (nc && typeof nc.transitionSec === "number") ? nc.transitionSec : 45,
    };
  }
  if (typeof DATA.nightConfig.transitionSec !== "number") DATA.nightConfig.transitionSec = 45;

  if (!Array.isArray(DATA.routineLog)) DATA.routineLog = [];
  if (!Array.isArray(DATA.nightLog)) DATA.nightLog = [];
  if (!DATA.places || typeof DATA.places !== "object") DATA.places = {};
  if (!DATA.routeCache || typeof DATA.routeCache !== "object") DATA.routeCache = {};
  if (!DATA.dayPlans || typeof DATA.dayPlans !== "object") DATA.dayPlans = {};
  if (!DATA.calCache || typeof DATA.calCache !== "object") DATA.calCache = {};
}

// Per-day plan accessor (ad-hoc tasks, one-off overrides).
function dayPlan(dateISO) {
  if (!DATA.dayPlans[dateISO]) {
    DATA.dayPlans[dateISO] = { tasks: [], removedEventIds: [] };
  }
  const p = DATA.dayPlans[dateISO];
  if (!Array.isArray(p.tasks)) p.tasks = [];
  if (!Array.isArray(p.removedEventIds)) p.removedEventIds = [];
  return p;
}

// ─── Persistence ──────────────────────────────────────────────────────────────
function saveLocal() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(DATA)); } catch (e) {}
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) DATA = JSON.parse(raw);
  } catch (e) {}
}

// Persist everywhere: device first (instant, never lost), then Drive if connected.
function persist(okMsg) {
  DATA.updated = new Date().toISOString();
  saveLocal();
  setSync("syncing…");
  saveDrive()
    .then(() => { setSync("synced ✓", "ok"); if (okMsg) toast(okMsg + " · synced"); })
    .catch(() => { setSync("saved on device", "warn"); if (okMsg) toast(okMsg + " · sync retry next save"); });
}

// ─── Google Identity Services ─────────────────────────────────────────────────
function clientId() { return (DATA.settings.googleClientId || DEFAULT_CLIENT_ID || "").trim(); }
function gisAvailable() { return !!(window.google && google.accounts && google.accounts.oauth2); }
function initTokenClient() {
  if (tokenClient || !gisAvailable() || !clientId()) return tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId(),
    scope: GOOGLE_SCOPES,
    callback: (resp) => {
      if (resp && resp.access_token) { accessToken = resp.access_token; onConnected(); }
      else setSync("connect Google", "warn");
    },
    error_callback: () => { setSync("connect Google", "warn"); toast("Sign-in cancelled"); },
  });
  return tokenClient;
}
function connectGoogle() {
  if (!clientId()) { toast("Add your Google Client ID in Settings"); return; }
  if (!initTokenClient()) { toast("Google library still loading — try again"); return; }
  setSync("connecting…");
  tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
}
async function onConnected() {
  setSync("syncing…");
  try {
    await findFile();
    const remote = await loadDrive();
    if (remote) reconcile(remote);
    else await saveDrive();
    setSync("synced ✓", "ok");
    if (typeof render === "function") render();
    if (DATA.settings.googleCalEnabled && typeof refreshCalendars === "function") refreshCalendars();
  } catch (e) {
    setSync("offline · using device", "warn");
  }
}
function reconcile(remote) {
  const localU = DATA.updated ? Date.parse(DATA.updated) : 0;
  const remoteU = remote.updated ? Date.parse(remote.updated) : 0;
  if (remoteU >= localU) {
    DATA = remote; normalizeData(); saveLocal();
    // a newer remote may carry newer workout-app data → push it into shared storage
    if (typeof seedOlyDown === "function") seedOlyDown();
  } else saveDrive().catch(() => {});
}

// ─── Drive file CRUD ──────────────────────────────────────────────────────────
async function findFile() {
  if (!accessToken) throw new Error("no token");
  const q = "name='" + DRIVE_FILENAME + "' and trashed=false";
  const url = "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(q) +
    "&spaces=drive&fields=files(id,modifiedTime)";
  const r = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  if (r.status === 401) { accessToken = null; throw new Error("token expired"); }
  if (!r.ok) throw new Error("find " + r.status);
  const j = await r.json();
  fileId = (j.files && j.files.length) ? j.files[0].id : null;
  return fileId;
}
async function loadDrive() {
  if (!accessToken) throw new Error("no token");
  if (fileId === null) await findFile();
  if (!fileId) return null;
  const r = await fetch("https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media",
    { headers: { Authorization: "Bearer " + accessToken } });
  if (r.status === 401) { accessToken = null; throw new Error("token expired"); }
  if (!r.ok) throw new Error("load " + r.status);
  return await r.json();
}
async function saveDrive() {
  saveLocal();
  if (!accessToken) throw new Error("no token");
  const body = JSON.stringify(DATA);
  if (!fileId) {
    const boundary = "day_" + Date.now();
    const multipart =
      "--" + boundary + "\r\n" +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify({ name: DRIVE_FILENAME }) + "\r\n" +
      "--" + boundary + "\r\n" +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      body + "\r\n" +
      "--" + boundary + "--";
    const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "multipart/related; boundary=" + boundary },
      body: multipart,
    });
    if (r.status === 401) { accessToken = null; throw new Error("token expired"); }
    if (!r.ok) throw new Error("create " + r.status);
    const j = await r.json();
    fileId = j.id;
  } else {
    const r = await fetch("https://www.googleapis.com/upload/drive/v3/files/" + fileId + "?uploadType=media", {
      method: "PATCH",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json; charset=UTF-8" },
      body: body,
    });
    if (r.status === 401) { accessToken = null; throw new Error("token expired"); }
    if (!r.ok) throw new Error("save " + r.status);
  }
}

// ─── Tiny shared helpers ──────────────────────────────────────────────────────
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function todayDOW() { return DOW[new Date().getDay()]; }
function setSync(t, cls) { const e = $("#sync"); if (e) { e.textContent = t; e.className = "sync" + (cls ? " " + cls : ""); } }
function toast(t) { const e = $("#toast"); if (!e) return; e.textContent = t; e.classList.add("show"); setTimeout(() => e.classList.remove("show"), 2400); }
function fmtSec(s) { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); }
function fmtSigned(s) { const neg = s < 0, a = Math.abs(Math.round(s)); return (neg ? "-" : "") + Math.floor(a / 60) + ":" + String(a % 60).padStart(2, "0"); }
function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function escapeAttr(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
// "HH:MM" <-> minutes since midnight
function hmToMin(hm) { if (!hm || !/^\d{1,2}:\d{2}$/.test(hm)) return null; const [h, m] = hm.split(":").map(Number); return h * 60 + m; }
function minToHM(min) {
  min = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(min / 60), m = min % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
// 12-hour clock label, e.g. 195 -> "3:15 AM", 915 -> "3:15 PM"
function fmtClock(min) {
  min = Math.round(min);
  let day = "";
  if (min >= 1440) { day = " (+1)"; min -= 1440; }
  if (min < 0) { day = " (−1)"; min += 1440; }
  let h = Math.floor(min / 60), m = min % 60;
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return h + ":" + String(m).padStart(2, "0") + " " + ap + day;
}
