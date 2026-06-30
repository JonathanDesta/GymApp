'use strict';
// ─── Workout duration mirror ──────────────────────────────────────────────────
// Mirrors the sister Oly-Tracker app's block/week/cutting settings purely to
// compute *today's session length* so the master timeline can reserve the right
// block. No exercise logging here — that lives in the separate workout app.
//
// Durations are the `totalMin` values from the Oly-Tracker program. The displayed
// session length there is totalMin, trimmed to 85% when cutting (for blocks with
// real training sections). Mostly fixed per weekday; the peaking block differs.

const WORKOUT_BLOCKS = [
  { id: 0, name: "Week 0: Testing", weeks: 1 },
  { id: 1, name: "Block 1: Volume Accumulation", weeks: 4 },
  { id: 2, name: "Block 2: Intensification", weeks: 4 },
  { id: 3, name: "Block 3: Peaking / Realization", weeks: 3 },
  { id: 4, name: "Week 12: Deload", weeks: 1 },
];

// minutes by block id, then weekday key. 0 = rest / no session that weekday.
const WK = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WORKOUT_TOTALMIN = {
  0: { mon: 90, tue: 90, wed: 0, thu: 75, fri: 120, sat: 0, sun: 0 },
  1: { mon: 110, tue: 110, wed: 80, thu: 135, fri: 105, sat: 130, sun: 90 },
  2: { mon: 110, tue: 110, wed: 80, thu: 135, fri: 105, sat: 130, sun: 90 },
  3: { mon: 90, tue: 90, wed: 60, thu: 90, fri: 90, sat: 90, sun: 90 },
  // Deload has no fixed program in the sister app; ~50% of Block 1 per its brief.
  4: { mon: 55, tue: 55, wed: 40, thu: 68, fri: 53, sat: 65, sun: 45 },
};

function workoutBlockName(id) { const b = WORKOUT_BLOCKS.find(b => b.id === id); return b ? b.name : "—"; }

// Today's (or a given date's) workout duration in minutes, 0 if it's a rest day.
function workoutDurationMin(dateISO) {
  const w = DATA.workout || {};
  const dow = DOW[new Date((dateISO || todayISO()) + "T00:00:00").getDay()]; // Mon/Tue/...
  // Respect the user's chosen training days (e.g. Sunday off).
  if (Array.isArray(w.days) && w.days.indexOf(dow) < 0) return 0;
  const table = WORKOUT_TOTALMIN[w.blockId] || WORKOUT_TOTALMIN[1];
  let mins = table[dow.toLowerCase()] || 0;
  if (!mins) return 0;
  // Cutting trims to 85% for blocks with real training sections (1/2/3).
  if (w.cutting && [1, 2, 3].indexOf(w.blockId) >= 0) mins = Math.round(mins * 0.85);
  return mins;
}

// Departure time (minutes from midnight) for a date, with per-day override.
function workoutDepartMin(dateISO) {
  const p = DATA.dayPlans[dateISO];
  if (p && p.workoutDepart) return hmToMin(p.workoutDepart);
  return hmToMin((DATA.workout && DATA.workout.departTime) || "15:00");
}
function workoutSkippedFor(dateISO) { const p = DATA.dayPlans[dateISO]; return !!(p && p.workoutSkip); }

// ─── Workout settings view ────────────────────────────────────────────────────
function workoutView() {
  const w = DATA.workout;
  const block = WORKOUT_BLOCKS.find(b => b.id === w.blockId) || WORKOUT_BLOCKS[1];
  const todayMin = workoutDurationMin(todayISO());
  const depart = workoutDepartMin(todayISO());
  let h = `<div class="daysub">Mirrors your Oly-Tracker block so the timeline reserves the right gym block. Logging stays in the workout app.</div>`;

  h += `<div class="kpis">
    <div class="kpi"><div class="v">${todayMin ? todayMin + "m" : "rest"}</div><div class="l">Today's session</div></div>
    <div class="kpi"><div class="v">${todayMin ? fmtClock(depart) : "—"}</div><div class="l">Leave by</div></div>
    <div class="kpi"><div class="v">${w.cutting ? "Cut" : "Bulk"}</div><div class="l">Phase</div></div></div>`;

  h += `<div class="card"><div class="cardhd"><b>Training block</b></div>
    <div class="frow"><label>Block</label>
      <select id="wkBlock" class="sel">${WORKOUT_BLOCKS.map(b => `<option value="${b.id}" ${b.id === w.blockId ? "selected" : ""}>${b.name}</option>`).join("")}</select></div>
    <div class="frow"><label>Week in block</label>
      <select id="wkWeek" class="sel">${Array.from({ length: block.weeks }, (_, i) => `<option value="${i}" ${i === w.weekInBlock ? "selected" : ""}>Week ${i + 1}</option>`).join("")}</select></div>
    <div class="frow"><label>Phase</label>
      <div class="seg"><button class="segbtn ${!w.cutting ? "on" : ""}" data-cut="0">Lean bulk</button><button class="segbtn ${w.cutting ? "on" : ""}" data-cut="1">Cutting</button></div></div>
  </div>`;

  h += `<div class="card"><div class="cardhd"><b>Schedule</b></div>
    <div class="frow"><label>Default "leave the house" time</label>
      <input id="wkDepart" type="time" class="sel" value="${(w.departTime || "15:00")}"></div>
    <div class="frow"><label>Training days</label>
      <div class="daypick" id="wkDays">${DOW.map(d => `<button class="daybtn ${(w.days || []).indexOf(d) >= 0 ? "on" : ""}" data-d="${d}">${d}</button>`).join("")}</div></div>
    <div class="hint">Set the gym address in Settings so travel time to/from the gym is added around this block.</div>
  </div>`;

  // 7-day duration preview
  h += `<div class="card"><div class="cardhd"><b>This week at a glance</b></div><div class="mprog">`;
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const mins = workoutDurationMin(iso);
    const lbl = DOW[d.getDay()] + (i === 0 ? " (today)" : "");
    h += `<div class="mprogrow"><span class="mpi">${mins ? "🏋" : "·"}</span> ${lbl}<span class="muted" style="margin-left:auto">${mins ? mins + " min" : "rest"}</span></div>`;
  }
  h += `</div></div>`;
  return h;
}
function bindWorkout() {
  const w = DATA.workout;
  const bl = $("#wkBlock"); if (bl) bl.onchange = () => { w.blockId = parseInt(bl.value, 10); w.weekInBlock = 0; persist("Block set"); render(); };
  const wk = $("#wkWeek"); if (wk) wk.onchange = () => { w.weekInBlock = parseInt(wk.value, 10); persist("Week set"); };
  $$("#wkDays .daybtn").forEach(b => b.onclick = () => {
    const d = b.dataset.d; w.days = w.days || [];
    const i = w.days.indexOf(d); if (i >= 0) w.days.splice(i, 1); else w.days.push(d);
    persist("Days updated"); render();
  });
  $$(".segbtn[data-cut]").forEach(b => b.onclick = () => { w.cutting = b.dataset.cut === "1"; persist("Phase set"); render(); });
  const dp = $("#wkDepart"); if (dp) dp.onchange = () => { w.departTime = dp.value || "15:00"; persist("Departure set"); render(); };
}
