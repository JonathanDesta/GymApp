# Day — letting Claude plan your day into the timeline

Your variable, non-calendar work (website business, content creation, AI research,
and anything new) doesn't live on a calendar — but the app reads calendars. The
bridge: have your **Claude Cowork morning briefing** drop the day's work blocks,
with estimated durations, onto a dedicated **"flexible" calendar**. The app reads
that calendar and slots those blocks into your open time automatically — moving
them around your fixed commitments. Tutoring and classes stay on your normal
calendars as fixed appointments.

## One-time setup
1. In **Google Calendar**, create a new calendar, e.g. **"Day — Work Blocks"**.
   Settings → "Integrate calendar" → copy its **Calendar ID**
   (looks like `...@group.calendar.google.com`).
2. In **Day → Settings → Calendars → Flexible work-block calendar IDs**, paste it.
3. Make sure Day's Google connection is on (so it can read that calendar).

That's it. Anything on that calendar is treated as a movable work block; anything
on your primary/school calendars stays a fixed commitment.

## Add this to your Claude Cowork morning-briefing instructions
> After you finish my morning briefing, look at everything I need to make progress
> on today across my priorities — **website business, content creation, AI research
> project, tutoring**, plus anything new that came up. For each thing that is *not*
> already a fixed calendar appointment, estimate how long I should spend on it today
> (in minutes), and create a Google Calendar event for it on my **"Day — Work
> Blocks"** calendar, with the estimated duration as the event length and a clear
> title (e.g. "AI research — train baseline model"). Put a rough start time on each;
> the Day app will re-slot them into my open time, so the start is only a hint. If
> something needs zero time today, skip it. List what you scheduled and the
> durations at the end of the briefing.

Now each morning Claude estimates the time, writes the blocks, and they appear on
Day's **Today** timeline (tagged **"plan"**), fitted around your fixed events,
workout, and routines — with conflict and "leave by" math applied.

## Why this design (vs. embedding Claude in the app)
- **No API key, no cost, no backend.** The app stays a static PWA; Claude already
  runs in your Cowork briefing, which is the right place for the estimating.
- **One source of truth.** Everything flows through Google Calendar, which the app
  already reads and syncs — robust and offline-friendly.
- **You stay in control.** You can see, edit, or delete any block in Google Calendar;
  the app just reflects it.

## Manual fallback (no Claude)
On the **Today** tab, "One-off tasks & plans" lets you type a task; the app
auto-estimates a duration from the name (editable) and slots it into open time.
Use this for one-offs you don't want to round-trip through Claude.
