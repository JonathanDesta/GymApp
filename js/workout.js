'use strict';
// ─── Workout tab: the embedded Oly-Tracker app ────────────────────────────────
// The Workout tab embeds the real Oly-Tracker PWA in an iframe so opening it is
// like opening the workout app. Because both are served from the same origin
// (jonathandesta.github.io), they SHARE localStorage — so this app reads the live
// `oly_state` (block / week / cutting) directly to size the gym block on the
// master timeline. No duplicate settings: change your block in the workout app and
// the timeline follows automatically.

const DEFAULT_WORKOUT_URL = "https://jonathandesta.github.io/oly-tracker/";
function workoutAppUrl() { return (DATA.settings.workoutAppUrl || DEFAULT_WORKOUT_URL).trim(); }

const WORKOUT_BLOCKS = [
  { id: 0, name: "Week 0: Testing", weeks: 1 },
  { id: 1, name: "Block 1: Volume Accumulation", weeks: 4 },
  { id: 2, name: "Block 2: Intensification", weeks: 4 },
  { id: 3, name: "Block 3: Peaking / Realization", weeks: 3 },
  { id: 4, name: "Week 12: Deload", weeks: 1 },
];
// minutes by block id, then weekday key (these are the Oly-Tracker `totalMin`s).
const WORKOUT_TOTALMIN = {
  0: { mon: 90, tue: 90, wed: 0, thu: 75, fri: 120, sat: 0, sun: 0 },
  1: { mon: 110, tue: 110, wed: 80, thu: 135, fri: 105, sat: 130, sun: 90 },
  2: { mon: 110, tue: 110, wed: 80, thu: 135, fri: 105, sat: 130, sun: 90 },
  3: { mon: 90, tue: 90, wed: 60, thu: 90, fri: 90, sat: 90, sun: 90 },
  4: { mon: 55, tue: 55, wed: 40, thu: 68, fri: 53, sat: 65, sun: 45 },
};
function workoutBlockName(id) { const b = WORKOUT_BLOCKS.find(b => b.id === id); return b ? b.name : "—"; }

// ─── Shared sync bridge for the embedded workout app ──────────────────────────
// The workout app saves to localStorage["oly_state"] (no cloud sync of its own).
// Because it shares this app's origin & storage, we ride Day's Drive sync:
//   • capture: when the embedded app writes oly_state, fold it into DATA.olyState
//     and push through Day's Drive file (debounced).
//   • seed: on another device, when Day pulls a newer copy, write it back into
//     localStorage BEFORE the iframe loads so the embedded app shows synced data.
function readLocalOly() { try { return JSON.parse(localStorage.getItem("oly_state")) || null; } catch (e) { return null; } }
let _lastOlyJSON = null, _olyPushTimer = null;
function captureOlyState() {
  const local = readLocalOly();
  if (!local) return;
  const j = JSON.stringify(local);
  const cur = (DATA.olyState && DATA.olyState.data) ? JSON.stringify(DATA.olyState.data) : null;
  if (j === cur || j === _lastOlyJSON) return; // nothing new / already handled
  _lastOlyJSON = j;
  DATA.olyState = { data: local, ts: Date.now() };
  saveLocal();
  // debounce the Drive push (the workout app may save several times in a row)
  clearTimeout(_olyPushTimer);
  setSync("syncing…");
  _olyPushTimer = setTimeout(() => {
    DATA.updated = new Date().toISOString(); saveLocal();
    saveDrive().then(() => setSync("synced ✓", "ok")).catch(() => setSync("saved on device", "warn"));
  }, 3500);
}
// Returns true if it changed localStorage (caller should reload the iframe).
function seedOlyDown() {
  if (!DATA.olyState || !DATA.olyState.data) return false;
  const remoteJ = JSON.stringify(DATA.olyState.data);
  const local = readLocalOly();
  if (local && JSON.stringify(local) === remoteJ) return false; // already in sync
  try { localStorage.setItem("oly_state", remoteJ); } catch (e) {}
  _lastOlyJSON = remoteJ; // don't re-capture what we just seeded
  return true;
}

// Live block/week/cutting — prefer the embedded app's shared storage, then the
// synced snapshot, then our own DATA.workout fallback (different-origin dev).
function workoutBlockState() {
  const oly = readLocalOly() || (DATA.olyState && DATA.olyState.data) || null;
  if (oly && oly.program) return { blockId: oly.program.blockId | 0, weekInBlock: oly.program.weekInBlock || 0, cutting: !!oly.cutting, src: "live" };
  const w = DATA.workout || {};
  return { blockId: w.blockId | 0, weekInBlock: w.weekInBlock || 0, cutting: !!w.cutting, src: "local" };
}

// Today's (or a given date's) workout duration in minutes, 0 if a rest day.
function workoutDurationMin(dateISO) {
  const w = DATA.workout || {};
  const dow = DOW[new Date((dateISO || todayISO()) + "T00:00:00").getDay()];
  if (Array.isArray(w.days) && w.days.indexOf(dow) < 0) return 0; // your chosen training days
  const st = workoutBlockState();
  const table = WORKOUT_TOTALMIN[st.blockId] || WORKOUT_TOTALMIN[1];
  let mins = table[dow.toLowerCase()] || 0;
  if (!mins) return 0;
  if (st.cutting && [1, 2, 3].indexOf(st.blockId) >= 0) mins = Math.round(mins * 0.85);
  return mins;
}
function workoutDepartMin(dateISO) {
  const p = DATA.dayPlans[dateISO];
  if (p && p.workoutDepart) return hmToMin(p.workoutDepart);
  return hmToMin((DATA.workout && DATA.workout.departTime) || "15:00");
}
function workoutSkippedFor(dateISO) { const p = DATA.dayPlans[dateISO]; return !!(p && p.workoutSkip); }

// ─── Workout view: summary strip + collapsible timing + embedded app ──────────
function workoutView() {
  seedOlyDown(); // ensure shared storage holds the synced copy before the iframe loads
  const w = DATA.workout;
  const st = workoutBlockState();
  const todayMin = workoutDurationMin(todayISO());
  const depart = workoutDepartMin(todayISO());
  const skipped = workoutSkippedFor(todayISO());

  let h = `<div class="wk-summary">
      <div class="wk-pill"><b>${todayMin ? todayMin + " min" : "rest"}</b><span>today</span></div>
      <div class="wk-pill"><b>${todayMin ? fmtClock(depart) : "—"}</b><span>leave by</span></div>
      <div class="wk-pill"><b>${workoutBlockName(st.blockId).split(":")[0]}</b><span>${st.cutting ? "cutting" : "bulk"}</span></div>
      <a class="wk-open" href="${escapeAttr(workoutAppUrl())}" target="_blank" rel="noopener">↗ full</a>
    </div>`;

  h += `<details class="wk-cfg"><summary>Timeline settings (when you train)</summary>
    <div class="frow"><label>Default gym departure</label><input id="wkDepart" type="time" class="sel" value="${(w.departTime || "15:00")}"></div>
    <div class="frow"><label>Skip the gym today</label><input type="checkbox" id="wkSkip" ${skipped ? "checked" : ""}></div>
    <div class="frow"><label>Training days</label>
      <div class="daypick" id="wkDays">${DOW.map(d => `<button class="daybtn ${(w.days || []).indexOf(d) >= 0 ? "on" : ""}" data-d="${d}">${d}</button>`).join("")}</div></div>
    <div class="hint">Block, week, phase and all logging live in the embedded app below — change them there and the timeline follows. Its data is backed up and synced through Day's Google Drive ${DATA.olyState ? "✓ last saved " + new Date(DATA.olyState.ts).toLocaleString() : "(connect Google to enable)"}.</div>
  </details>`;

  h += `<iframe class="workframe" id="workframe" src="${escapeAttr(workoutAppUrl())}"
      allow="autoplay; screen-wake-lock; clipboard-write; fullscreen"
      referrerpolicy="no-referrer-when-downgrade"></iframe>`;
  return h;
}
function bindWorkout() {
  const w = DATA.workout;
  const dp = $("#wkDepart"); if (dp) dp.onchange = () => { w.departTime = dp.value || "15:00"; persist("Departure set"); };
  const sk = $("#wkSkip"); if (sk) sk.onchange = () => { dayPlan(todayISO()).workoutSkip = sk.checked; persist(sk.checked ? "Gym skipped today" : "Gym back on"); };
  $$("#wkDays .daybtn").forEach(b => b.onclick = () => {
    const d = b.dataset.d; w.days = w.days || [];
    const i = w.days.indexOf(d); if (i >= 0) w.days.splice(i, 1); else w.days.push(d);
    persist("Days updated"); render();
  });
}

// Capture the embedded app's saves and fold them into Day's synced state.
// A same-origin iframe writing localStorage fires 'storage' in this parent frame.
window.addEventListener("storage", (e) => { if (e.key === "oly_state") captureOlyState(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") captureOlyState(); });
// Safety net: while the embedded app is in use, the cross-frame storage event can
// be unreliable on iOS — poll cheaply (captureOlyState no-ops when unchanged).
setInterval(() => { if (CUR === "Workout" && document.visibilityState === "visible") captureOlyState(); }, 5000);
