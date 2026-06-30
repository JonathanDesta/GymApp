# Day — Life Manager · Setup

A single-file PWA (no backend, no app-store, no cost). It tracks your morning &
nighttime routines, mirrors your Oly-Tracker workout length, pulls today's
calendar events, adds travel time, and lays out one master timeline that detects
conflicts and back-solves your "leave by / wake by" times.

Everything is stored on your device (localStorage) and optionally synced to a
single private file on your Google Drive.

---

## 1. Install on your iPhone

1. Host the folder as a static site (GitHub Pages — see DEPLOY below).
2. Open the site in **Safari**.
3. Share → **Add to Home Screen**. It launches full-screen like a native app.

---

## 2. Google (personal calendar + Drive sync) — optional but recommended

Both the calendar read and the Drive sync use **one** Google sign-in.

1. Go to <https://console.cloud.google.com/> → create/select a project.
2. **APIs & Services → Enable APIs**: enable **Google Calendar API** and **Google Drive API**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: add your site origin exactly, e.g.
     `https://<your-username>.github.io` (no path, no trailing slash).
   - Create, then copy the **Client ID** (`…apps.googleusercontent.com`).
4. **OAuth consent screen**: set it to **External**, add yourself as a **Test user**
   (your own Gmail). You don't need Google verification for personal use.
5. In the app → **Settings**:
   - Paste the Client ID into **Google Client ID**.
   - Tick **Use Google Calendar**.
   - (Optional) list extra calendar IDs, comma-separated. `primary` = your main calendar.
   - Tap the **sync chip** (top-right) and approve the Google consent screen.

Scopes requested: `calendar.readonly` (read events) + `drive.file` (only the one
sync file this app creates — it can't see anything else in your Drive).

---

## 3. Outlook / M365 school calendar — optional

Microsoft doesn't use the Google sign-in. Use a published ICS feed:

1. Outlook (web) → **Calendar** → **Settings → Shared calendars** (or **Share → Publish**).
2. Pick the school calendar, **Publish**, permission **"Can view all details"**.
3. Copy the **ICS** link (ends in `.ics`).
4. App → **Settings → Outlook .ics feed URL**: paste it.

**If the feed won't load** (browser CORS block — common with Microsoft): add a
CORS proxy prefix in **Settings → CORS proxy**, e.g. a self-hosted proxy or a
public one like `https://corsproxy.io/?` . Note a public proxy sees the calendar
URL, so prefer your own if the schedule is sensitive. As a fallback you can always
add one-off classes as tasks on the Today tab.

Recurring weekly classes (FREQ=WEEKLY/DAILY, BYDAY, UNTIL/INTERVAL) are expanded
for the day you're viewing.

---

## 4. Travel time

- **Free mode (default, no key, no cost):** addresses are geocoded with
  OpenStreetMap **Nominatim**; driving time comes from the public **OSRM** server.
  Set **Home address** and **Gym address** in Settings. Walking/transit without a
  key are estimated from road distance.
- **Optional Google Maps key:** paste a Maps **JavaScript API** key in Settings for
  live, traffic-aware times and proper transit. This *can* bill beyond Google's
  monthly free credit — leave it blank to stay 100% free.

Results are cached, so the free endpoints are hit rarely (a few times a day).

---

## 5. Workout length

The **Workout** tab mirrors your Oly-Tracker settings (block, week, cutting) so the
timeline reserves the right-size gym block. Keep these in sync with the workout app
when you change blocks. Set your default **"leave the house" time** and **training
days**. Logging your sets still happens in the separate Oly-Tracker app.

---

## 6. Daily use

- **Today** = your master timeline. It shows Leave-by / Wake-by, flags conflicts,
  and auto-moves the workout when something collides with it.
- **Today's adjustments** = one-off changes (different wake time, gym time, skip
  workout) for *today only* — they don't change your defaults.
- **One-off tasks** = anything extra (dentist, errand). Give it a length and,
  optionally, a fixed time and a location (travel is added automatically).
- **Morning / Night** = the timed step runners (countdown, pace, alarm, wake-lock).
- Edit routine steps in-app via **Edit steps**; defaults re-seed when the version
  constant is bumped.

---

## DEPLOY (GitHub Pages)

```
# from the LifeManager folder
git init && git add -A && git commit -m "Day — life manager v1"
gh repo create <your-username>/day --public --source=. --push
# then: GitHub → repo → Settings → Pages → Branch: main /(root) → Save
```

On every update, bump `CACHE_VERSION` in `sw.js` so the installed PWA refreshes
without a reinstall.
