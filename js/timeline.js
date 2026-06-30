'use strict';
// ─── Master timeline solver ───────────────────────────────────────────────────
// Composes the whole day from fixed anchors (calendar events + their travel, plus
// fixed tasks) and flexible blocks (morning routine, workout, flexible tasks,
// nighttime routine). Detects conflicts, relocates the workout when it clashes,
// and back-solves "leave by" / "wake by" for the next hard commitment.
//
// All times are minutes-from-midnight on the target local date. Returns a sorted
// list of segments plus conflict messages and the travel pairs still to prefetch.

function intervalsOverlap(a, b) { return a.start < b.end && b.start < a.end; }

// Travel minutes between two addresses, using cache; records misses for prefetch.
function travelMin(originAddr, destAddr, pending) {
  if (!originAddr || !destAddr) return { min: 0, exact: true, none: true };
  const r = travelSecCached(originAddr, destAddr, DATA.settings.travelMode);
  if (r && r.exact) return { min: Math.max(1, Math.round(r.sec / 60)), exact: true };
  // geocoded but no real route yet → show the rough estimate, fetch the real one
  if (r && !r.exact) { if (pending) pending.push({ origin: originAddr, dest: destAddr }); return { min: Math.max(1, Math.round(r.sec / 60)), exact: false, approx: true }; }
  // not even geocoded yet → fall back to the buffer and queue a lookup
  if (pending) pending.push({ origin: originAddr, dest: destAddr });
  return { min: DATA.settings.defaultTravelMin || 15, exact: false, fallback: true };
}

// Find the earliest free gap of >= need minutes within [from,until], not colliding
// with `occupied` (sorted [{start,end}]), preferring a start at/after `pref`.
function findGap(occupied, from, until, need, pref) {
  const sorted = occupied.slice().sort((a, b) => a.start - b.start);
  // candidate windows = spaces between occupied intervals
  let windows = [];
  let cursor = from;
  for (const iv of sorted) {
    if (iv.start > cursor) windows.push({ start: cursor, end: Math.min(iv.start, until) });
    cursor = Math.max(cursor, iv.end);
    if (cursor >= until) break;
  }
  if (cursor < until) windows.push({ start: cursor, end: until });
  windows = windows.filter(w => w.end - w.start >= need);
  if (!windows.length) return null;
  // prefer a window containing `pref`
  if (pref != null) {
    for (const w of windows) if (pref >= w.start && pref + need <= w.end) return pref;
    for (const w of windows) if (w.start >= pref) return w.start; // next window after pref
  }
  return windows[0].start;
}

function computeTimeline(dateISO) {
  dateISO = dateISO || todayISO();
  const plan = dayPlan(dateISO);
  const S = DATA.settings;
  const home = S.homeAddress;
  const wakeMin = hmToMin(plan.wakeTime || S.wakeTime) ?? 420;
  let bedMin = hmToMin(plan.bedTime || S.bedTime) ?? 1380;
  if (bedMin <= wakeMin) bedMin += 1440; // bedtime after midnight
  const pending = [];
  const conflicts = [];
  const segments = [];
  const occupied = []; // fixed/placed intervals to avoid

  const dow = DOW[new Date(dateISO + "T00:00:00").getDay()];
  const mDur = Math.round(routineBudgetSec(DATA.routineConfig, dow) / 60);
  const nDur = Math.round(routineBudgetSec(DATA.nightConfig, dow) / 60);

  function add(seg) { segments.push(seg); if (seg.blocks !== false) occupied.push({ start: seg.start, end: seg.end }); }

  // ── 1. Morning routine — anchored at wake ──
  if (mDur > 0) add({ start: wakeMin, end: wakeMin + mDur, type: "routine", label: "Morning routine", sub: `${mDur} min · ${todayRoutineCount(DATA.routineConfig, dow)} steps`, status: "ok", go: "Morning" });
  let morningEnd = wakeMin + mDur;

  // ── 2. Calendar events + fixed tasks → outings with travel ──
  const events = cachedEventsFor(dateISO).filter(e => !e.allDay).map(e => ({ ...e, kind: "event" }));
  const allDayEvents = cachedEventsFor(dateISO).filter(e => e.allDay);
  const fixedTasks = (plan.tasks || []).filter(t => t.fixedStart != null && hmToMin(t.fixedStart) != null)
    .map(t => ({ id: t.id, kind: "task", title: t.name, location: t.location || "", startMin: hmToMin(t.fixedStart), endMin: hmToMin(t.fixedStart) + (t.durMin || 30) }));
  const anchored = events.concat(fixedTasks).sort((a, b) => a.startMin - b.startMin);

  // group consecutive out-of-home commitments into outings (stay out between them)
  const GROUP_GAP = 90;
  let outings = [];
  anchored.forEach(ev => {
    const located = !!(ev.location && ev.location.trim());
    const last = outings[outings.length - 1];
    if (located && last && last.located && ev.startMin - last.end <= GROUP_GAP) {
      last.items.push(ev); last.end = Math.max(last.end, ev.endMin);
    } else {
      outings.push({ located, items: [ev], start: ev.startMin, end: ev.endMin });
    }
  });

  // place each outing with travel
  outings.forEach(grp => {
    // detect overlaps between consecutive commitments inside the day
    grp.items.forEach((ev, i) => {
      const loc = ev.location || "";
      // travel before the first item of a located outing (from home)
      if (i === 0 && grp.located && home) {
        const tv = travelMin(home, loc, pending);
        const depart = ev.startMin - tv.min;
        add({ start: depart, end: ev.startMin, type: "travel", label: "Travel → " + (ev.title || "out"), sub: tv.min + " min" + (tv.exact ? "" : tv.fallback ? " (est.)" : " (approx)"), status: "ok", location: loc });
      } else if (i > 0) {
        const prev = grp.items[i - 1];
        const gapTravel = travelMin(prev.location || home, loc, pending);
        if (gapTravel.min > 0 && ev.startMin - prev.endMin >= gapTravel.min) {
          add({ start: ev.startMin - gapTravel.min, end: ev.startMin, type: "travel", label: "Travel → " + (ev.title || "next"), sub: gapTravel.min + " min", status: "ok", location: loc });
        }
      }
      // the commitment itself
      const status = ev.startMin < morningEnd ? "conflict" : "ok";
      if (status === "conflict") conflicts.push(`"${ev.title}" at ${fmtClock(ev.startMin)} starts before your morning routine finishes (${fmtClock(morningEnd)}).`);
      add({ start: ev.startMin, end: Math.max(ev.endMin, ev.startMin + 5), type: ev.kind, label: ev.title, sub: ev.allDay ? "all day" : fmtClock(ev.startMin) + "–" + fmtClock(ev.endMin), status, location: loc, source: ev.source });
    });
    // travel home after a located outing
    if (grp.located && home) {
      const lastItem = grp.items[grp.items.length - 1];
      const tv = travelMin(lastItem.location || home, home, pending);
      add({ start: lastItem.endMin, end: lastItem.endMin + tv.min, type: "travel", label: "Travel home", sub: tv.min + " min", status: "ok", location: home });
    }
  });

  // overlaps among fixed commitments
  for (let i = 0; i < anchored.length; i++)
    for (let j = i + 1; j < anchored.length; j++)
      if (intervalsOverlap({ start: anchored[i].startMin, end: anchored[i].endMin }, { start: anchored[j].startMin, end: anchored[j].endMin }))
        conflicts.push(`"${anchored[i].title}" and "${anchored[j].title}" overlap.`);

  // ── 3. Workout block (flexible, prefers its depart time) ──
  const workMin = workoutSkippedFor(dateISO) ? 0 : workoutDurationMin(dateISO);
  if (workMin > 0) {
    const gym = S.gymAddress;
    const tTo = travelMin(home, gym, pending);
    const tBack = travelMin(gym, home, pending);
    const need = tTo.min + workMin + tBack.min;
    const pref = workoutDepartMin(dateISO);
    const place = findGap(occupied, Math.min(morningEnd, pref), bedMin - nDur, need, pref);
    if (place == null) {
      conflicts.push(`Workout (${need} min incl. travel) doesn't fit before bed — adjust the gym time or shorten the day.`);
    } else {
      const moved = Math.abs(place - pref) > 5;
      if (gym && tTo.min > 0) add({ start: place, end: place + tTo.min, type: "travel", label: "Travel → gym", sub: tTo.min + " min", status: "ok", location: gym });
      add({ start: place + tTo.min, end: place + tTo.min + workMin, type: "workout", label: "Workout", sub: `${workMin} min · ${workoutBlockName(DATA.workout.blockId)}` + (moved ? ` · moved from ${fmtClock(pref)}` : ""), status: moved ? "moved" : "ok", go: "Workout" });
      if (gym && tBack.min > 0) add({ start: place + tTo.min + workMin, end: place + need, type: "travel", label: "Travel home", sub: tBack.min + " min", status: "ok", location: home });
      if (moved) conflicts.push(`Workout moved to ${fmtClock(place)} (your ${fmtClock(pref)} slot was taken).`);
    }
  }

  // ── 4. Flexible tasks (no fixed time) → fill gaps ──
  (plan.tasks || []).filter(t => t.fixedStart == null).forEach(t => {
    const need = (t.durMin || 30);
    const place = findGap(occupied, morningEnd, bedMin - nDur, need, null);
    if (place == null) { conflicts.push(`Task "${t.name}" (${need} min) doesn't fit today.`); return; }
    add({ start: place, end: place + need, type: "task", label: t.name, sub: `${need} min`, status: "ok", taskId: t.id });
  });

  // ── 5. Nighttime routine — ends at bedtime ──
  if (nDur > 0) {
    const nightStart = bedMin - nDur;
    const lastBusy = occupied.filter(o => o.end <= bedMin + 1).reduce((m, o) => Math.max(m, o.end), morningEnd);
    const status = nightStart < lastBusy - 1 ? "conflict" : "ok";
    if (status === "conflict") conflicts.push(`Your day runs to ${fmtClock(lastBusy)} but the night routine needs to start by ${fmtClock(nightStart)} for a ${fmtClock(bedMin)} bedtime.`);
    add({ start: nightStart, end: bedMin, type: "routine", label: "Nighttime routine", sub: `${nDur} min · ends ${fmtClock(bedMin)}`, status, go: "Night" });
  }

  // ── 6. Fill the gaps with free time ──
  const sorted = segments.slice().sort((a, b) => a.start - b.start);
  let cursor = wakeMin;
  const free = [];
  sorted.forEach(s => { if (s.start > cursor + 4) free.push({ start: cursor, end: s.start, type: "free", label: "Free", sub: (s.start - cursor) + " min open", status: "free" }); cursor = Math.max(cursor, s.end); });
  if (bedMin > cursor + 4) free.push({ start: cursor, end: bedMin, type: "free", label: "Free", sub: (bedMin - cursor) + " min open", status: "free" });
  const all = sorted.concat(free).sort((a, b) => a.start - b.start);

  // ── 7. Back-solve next departure + wake-by for the first hard commitment ──
  const nowMin = (dateISO === todayISO()) ? (new Date().getHours() * 60 + new Date().getMinutes()) : -1;
  const departures = all.filter(s => s.type === "travel" && s.label.indexOf("home") < 0);
  let leaveBy = null;
  for (const d of departures) { if (nowMin < 0 || d.start >= nowMin) { leaveBy = { min: d.start, label: d.label.replace("Travel → ", "") }; break; } }
  let wakeBy = null;
  const firstLocated = outings.find(g => g.located);
  if (firstLocated && home) {
    const ev = firstLocated.items[0];
    const tv = travelMin(home, ev.location, pending);
    wakeBy = ev.startMin - tv.min - mDur;
  }

  const busyMin = all.filter(s => s.type !== "free").reduce((m, s) => m + (s.end - s.start), 0);
  return {
    date: dateISO, wakeMin, bedMin, mDur, nDur, workMin,
    segments: all, conflicts, allDayEvents,
    leaveBy, wakeBy, busyMin, pending,
  };
}

function todayRoutineCount(cfg, dow) { return routineSteps(cfg, dow).length; }
