# JDG Clockwork

A Chrome extension for the [Just Digital Gurus team portal](https://team.justdigitalgurus.com).

The portal records your attendance accurately but tells you nothing while the day
is still happening. You find out you clocked out four minutes short of eight
hours the next morning, as a red ⚡ Early Exit. Clockwork puts the numbers you
actually need in front of you *during* the day, and turns your history into
something you can read.

---

Almost everything renders **inside the portal's own pages**, in the Rubick
template's existing card style, so you get the numbers without opening anything.

## What it does

### 1. A readout in the portal's top bar — every page

Sits next to the Alerts bell, on every portal page:

> ● **LEAVE AT** 5:05 PM │ **REMAINING** 1h 49m │ **WORKED** 6:11

The dot carries the state (working / on break / late / done). Before your shift
it counts down; once you are past it, it counts up and turns red at the grace
cutoff. Click it to open Insights.

### 2. One-click pause — the reason picks itself

A button in the top bar that reads the clock and labels itself with what it is
about to do, so you never open the dropdown:

| When | Button | Logged as |
|---|---|---|
| before 12:30 | ⏸ Small break | `SMALL BREAK` |
| 12:30 – 15:30 | ⏸ Lunch break | `BREAK TIME` |
| 15:30 – 17:00 | ⏸ Small break | `SMALL BREAK` |
| from 17:00 | ⏻ Clock out | clock-out |
| approved half day, from 12:00 | ⏻ Leaving for home | clock-out |

The half day is read from `/leave` — an **approved** leave of 0.5 days covering
today. A pending one does not count.

Pauses happen on the single click. **Clocking out always asks first**, because it
ends the day and cannot be taken back by clicking again — and if you are short of
a full day, that confirmation carries the early-exit numbers and the time you
would actually clear it. Hovering the button tells you which rule fired
("chosen because it is after 3:30 PM").

While you are paused the button becomes **▶ Resume**.

All four boundaries are editable in the popup.

> **Resume is not yet wired up.** The portal renders no resume control while you
> are working, so its markup could not be read in advance, and pausing a real
> attendance record just to look at it was not something to do uninvited. The
> button looks for the portal's own control once you are paused — a form posting
> to an `/attendance/…` route that is not pause or clock-out, or a button reading
> Resume / Start / Clock in. If it cannot find one it says so plainly rather than
> guessing at an endpoint. Pause once and tell me what the portal shows, and it
> is a two-line change.

### 3. A "Today" panel on the dashboard

A full-width card above the stat boxes, showing the one number the portal never
gives you — the time you must clock out to clear a full day — plus a progress
bar, your clock-in, minutes late, break total, and what you would lose by
leaving now.

It accounts for breaks. Pause for 38 minutes and the target moves 38 minutes
later, immediately. The target is anchored to the start of your current work
segment, so it is a fixed wall-clock time — it does not creep as the minutes
pass.

**Lunch is counted before you take it.** Lunch is a fixture of the day, so a
leaving time worked out at 10 a.m. that ignores it is simply wrong — it would
have you leaving an hour short. Clockwork adds the lunch still ahead of you and
says so: *"2h 36m of work to go, plus the 55m lunch still ahead."* Once a break
lands in the lunch window it stops being a prediction and starts being a fact,
and nothing is double-counted.

Small breaks are **never** assumed. They are unpredictable — sometimes taken,
sometimes skipped to leave earlier — so they only count once actually taken.
The lunch window and length are editable in the popup.

### 4. The dashboard calendar, marked up

Days you were on time go green, days flagged Late go red, and Early Exits get a
⚡. Hover any day for its actual times (`8:26 AM in · 5:36 PM out · 7:41 worked ·
26 min late`). Works when you page back through months too.

### 5. The attendance page, made useful

- A **month summary strip** above the table — days present, typical arrival,
  days flagged Late, early exits, hours logged, and net vs 8h/day — computed
  from the **whole month**, not just the ten rows on screen.
- A **"vs 8h" column** appended to the portal's own table, with late rows tinted
  red and early exits amber. Re-applied automatically when you paginate or sort.
- A **"Show all N days"** toggle that replaces the paginated view with the full
  month in one table.
- A warning line if any of that month's rows are internally inconsistent (see
  below).

### 6. Month outlook — the days that came up short

JDG does not allow or pay overtime; extra hours are occasionally recognised with
a half day, at management's discretion. So a running "banked" balance would be
reporting credit that does not exist. The card leads with the end that actually
carries a consequence:

> **2** days came in under 8:00 this month, **30m** short in total.
> Typical day **8:15** · Typical arrival **8:19 AM** · Extra time given **2h 31m** *(unpaid, not banked)*

Extra time is still shown, as a plain figure rather than a balance — it is worth
knowing how much unpaid time you are giving, even though you cannot draw on it.

It also carries the next leave day worth taking (see below).

### 7. Break budget on the Today card

Your usual leaving time is the median clock-out from your own history — 5:37 PM.
From that, how much break today can still absorb:

> Break budget — you usually leave at **5:37 PM** · **32m left**
> 38m of 1h 10m used

Go over and it turns red and tells you the time you would actually clear a full
day instead.

### 8. Best leave days — on the holiday page

Every working day between days you are already off, for the rest of the year,
ranked by days-off-per-day-spent:

| Days off | Take | Run | Covers |
|---|---|---|---|
| 4 | Mon, Oct 19 | Sat Oct 17 → Tue Oct 20 | Dusshera |
| 4 | Thu, Sep 3 | Thu Sep 3 → Sun Sep 6 | Janmashtami |
| 5 | Wed Aug 26 + Thu Aug 27 | Wed Aug 26 → Sun Aug 30 | Rakshabandhan |

Weekends are detected from your own attendance rather than assumed, so this
stays correct if your working week ever changes.

### 9. "Worth raising" — regularization candidates

On the attendance page, the days with a defensible case, ranked:

- **strong case** — the portal's own `Late By` contradicts your clock-in
- **worth checking** — a clock-in with no matching clock-out, or a day marked
  Absent
- **minor** — a full-day Early Exit, with the exact shortfall

Each row links straight to that day, where the portal's **Regularization** tab
lives.

### 10. Optional floating HUD

The original panel, now **off by default** since the portal itself carries the
same numbers. Turn it on in the popup if you want a readout that follows you
regardless of scroll position.

### 11. Early-exit guard

Clicking "Yes, Clock Out" while you are under eight hours no longer just works.
Clockwork intercepts the form submit and shows you what you are about to do:

> You have logged **5:49** of the 8:00 required.
> Short by **2h 11m** · Clear 8h at **5:05 PM**
> [ Stay until 5:05 PM ] [ Clock out anyway ]

"Clock out anyway" always works — it is a speed bump, not a lock.

### 12. Punctuality alarms and a live badge

The toolbar badge counts down to your shift start, then counts up in red once
you are past it, then switches to minutes remaining until you clear eight hours,
then turns green. Notifications fire at configurable lead times before the
shift, three minutes before the grace window closes, when eight hours is
cleared, and when a break runs long.

Rest days are read from the portal itself, so no notifications fire on a Paid
holiday, on leave, or on a weekend.

### 13. Attendance insights

An overlay (button on the HUD, or the toolbar popup) that pulls 3, 6 or 12
months of your record and renders what the portal's paginated table cannot show:

- **Arrival timeline** — every clock-in against your shift start, with a 5-day
  moving average so you can see the habit drifting rather than a single bad day
- **Hours banked vs owed** — diverging bars of minutes above/below 8h per day
- **Weekday profile** — median lateness per day of the week
- **Arrival histogram** — how late, how often, in 5-minute bands
- **Month-by-month table** — including net balance vs 8h/day
- **CSV export** of the whole range

Plus a plain-language read on the single change that would move the most days.

### 14. It flags rows the portal contradicts itself on

This one was not planned; the data asked for it. Some rows have a `Late By`
value that does not match `clock-in − shift start`. For example:

| Date | Clocked in | Charged late | Implied start |
|---|---|---|---|
| 11-03-2026 | 8:05 AM | 3h 50m | 4:15 AM |
| 20-03-2026 | 8:00 AM | 2h 50m | 5:10 AM |
| 04-05-2026 | 8:45 AM | 2h 47m | 5:58 AM |

Averaging those in would badly misstate your record (they drag mean lateness
from ~10 minutes to ~36). Clockwork holds them out of every statistic and lists
them separately, because they are still sitting in the portal against your name.

Half-days and part-worked leave days are likewise held out of the punctuality
and early-exit figures — a four-hour half day is not an early exit.

---

## Install

**On a colleague's machine** — one line in PowerShell, no admin rights, no
clicking through `chrome://extensions`:

```powershell
iwr -useb https://github.com/OWNER/jdg-clockwork/releases/latest/download/install-jdg-clockwork.ps1 | iex
```

Restart Chrome and it is there. It auto-updates whenever a new release is
published. (`tools/release.ps1` prints the exact line with the real owner filled
in.)

The installer writes a Chrome policy under `HKCU` pointing at this repo's latest
release. Two things worth saying out loud:

- A policy-installed extension **cannot be disabled or removed** from
  `chrome://extensions`. To take it off, save the installer and run it with
  `-Uninstall`.
- It sets the same policy for Edge if Edge is installed.

**For yourself, from source:**

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder (`jdg-clockwork`)

The extension only ever runs on `team.justdigitalgurus.com`.

## Publishing a release

```powershell
gh auth login
.\tools\release.ps1
```

Packs a signed `.crx` with your local Chrome, derives the extension ID from the
signing key, writes `updates.xml` and the installer with that ID baked in,
pushes, and publishes a GitHub release with all three attached.

`key.pem` is created on the first run and gitignored. **Back it up.** The
extension ID is derived from it — lose it and the ID changes, which means every
colleague has to be reinstalled rather than updated. To ship an update, bump
`version` in `manifest.json` and run the script again.

---

## How it works

The portal is a server-rendered Laravel app with no JSON API, so Clockwork reads
the same HTML you do:

- `GET /attendance?month=M&year=Y` returns **the whole month** in one response.
  The portal's own JavaScript paginates rows that are already in the document.
- `GET /attendance/{id}` returns that day's work segments (start / stop / pause
  message). Total hours is the sum of segments; breaks are the gaps.
- `GET /holiday?year=Y` renders `.hol-item` blocks; ranges use an en dash
  (`04 Sep 2026 – 06 Sep 2026`). That feeds the leave planner and the forecast's
  remaining-workday count.
- `GET /leave?month=M&year=Y` lists applications with a date range, a day count
  (`0.5` for a half day) and an approval status. That drives the half-day rule.
- `POST /attendance/clock-pause` takes `pause_massage` — one of `BREAK TIME`,
  `SMALL BREAK`, `LEAVING FOR HOME`, `other`. `POST /attendance/clockout` takes
  no message. One-click pause fills in the portal's own form and submits it, so
  the CSRF token and field names always match whatever the portal is doing.

These two POSTs are the only writes Clockwork ever performs, and both happen
only on a button you pressed.

Nothing is hardcoded about your working week: the weekend is inferred from which
weekdays you demonstrably do not work, judged by proportion rather than "never"
(one stray Saturday clock-in should not make Saturday a working day).

Reading is entirely passive. Writing happens **only from a button you clicked** —
the one-click pause, or the clock-out it offers after 5 p.m. Nothing is ever
scheduled, retried, or triggered by a timer: Clockwork will not clock you in, and
will not clock you out because the clock reached some hour. Automating attendance
events would be falsifying a record. What it automates is the *dropdown*, not the
decision.

### Why it appears instantly

The portal is server-rendered HTML with no JSON API, and a naive version of this
extension asks for about ten pages on every load — the month, today's segments,
four months of history, two years of holidays, leave — before anything appears.
That is the wait. Two things remove it:

- **Paint before the network.** Today's segments are stable: a clock-in at 08:27
  is still 08:27 a page load later. The last known payload is kept in
  `chrome.storage`, recomputed against the current clock, and rendered
  immediately; the refresh behind it only confirms or corrects. Verified by
  recomputing the cached payload and the live one side by side — same state,
  same clock-out target, to the minute.
- **One shared, persistent cache.** Every panel goes through `J.month()` /
  `J.holidays()` / `J.leave()`, which memoise per page, share a single in-flight
  request between simultaneous callers, and persist to `chrome.storage`. A
  finished month never changes, so it is kept for a week; holidays for twelve
  hours; leave for thirty minutes; the current month for a minute.

A warm page load usually needs no network at all. Refresh in the popup (or on
the HUD) clears the cache and re-reads everything, so a stale entry is never a
dead end.

### Why fetches live in the content script

The Laravel session cookie is `SameSite=Lax`. A request originating from the
extension's own origin is cross-site and would arrive logged out. So all
fetching happens in the content script, at the page's origin, where the session
is always attached. The content script mirrors today's state into
`chrome.storage`; the service worker and popup read that mirror rather than
fetching for themselves.

### Self-calibration

The shift window is not hardcoded. On first sync Clockwork derives it from your
own rows:

- **Shift start** = the most common value of `clock-in − Late By`
- **Grace window** = one minute past the largest "Running Late" arrival, capped
  by the smallest hard "Late" arrival — deliberately the conservative bound, so
  it never tells you there is time left when the portal has already decided
  otherwise

Everything is overridable in the popup's settings.

### Theme and fonts

Extension surfaces (top-bar chip aside) default to **light**, with dark and
"match system" available in the popup, plus a ☾/☀ toggle in the Insights header.
Panels injected into the portal always follow the portal's own light styling, so
they never look like a foreign object on the page.

Type is set in exactly two places:

- `src/content/styles.js` → the `FONTS` block (`--font-ui`, `--font-display`,
  `--font-num`)
- `src/popup/popup.css` → the same three variables at the top

Numerals use a monospace face throughout so clock times and durations line up in
columns and do not jitter as they tick. Swap those variables and every surface
changes at once. To use a font that is not installed locally, drop the `.woff2`
into the extension folder, add it to `web_accessible_resources`, and declare an
`@font-face` in the same two places — remote font URLs are blocked by the
extension's content security policy.

---

## Tests

A test harness runs the real sources against a real fixture (March–August 2026,
pulled from the portal).

```bash
python -m http.server 8777
```

- `http://127.0.0.1:8777/test/` — 120 integration checks over parsing, time
  maths, live-day computation, statistical robustness, calendar/holiday maths,
  leave-bridge ranking, the month forecast, regularization ranking, the break
  budget, the one-click pause rules, leave/half-day parsing, lunch-aware
  clock-out targets, the shared cache and chart output — plus the HUD booting against the fixture and a
  button to open the Insights overlay
- `http://127.0.0.1:8777/test/popup.html` — the real popup rendered in each of
  its seven states
- `http://127.0.0.1:8777/test/portal.html` — a stand-in for the portal itself
  (same `.top-bar`, `.report-box`, `.att-table-card`, `.hol-item`, FullCalendar
  markup) with the real content scripts injected into it. Switch between
  `#dashboard`, `#attendance` and `#holiday` (add `&halfday` to simulate an
  approved half day) to check the chip, one-click pause, Today panel,
  month outlook, break budget, calendar marks, attendance strip, leave planner,
  regularization card and clock-out guard without touching live attendance data

The `test/` folder is inert at runtime; Chrome only loads what `manifest.json`
declares.

---

## Layout

```
manifest.json
icons/                     generated by tools/make-icons.ps1
src/
  lib/portal.js            parsing, time maths, stats, calibration  (shared everywhere)
  background.js            badge, alarms, notifications
  content/
    styles.js              themes, fonts, CSS for shadow roots and injected panels
    charts.js              hand-rolled SVG charts (no libraries — extension CSP)
    pump.js                single owner of "what is true right now"; others subscribe
    insights.js            the analytics overlay
    portal-ui.js           top-bar chip, dashboard panel, calendar, attendance page, guard
    extras.js              month outlook, leave planner, regularization helper
    hud.js                 the optional floating panel
  popup/                   toolbar popup and settings
test/                      fixture + harnesses
tools/make-icons.ps1       regenerates the PNG icons
```

`pump.js` fetches; `portal-ui.js` and `hud.js` only render. That is why the chip,
the dashboard panel and the HUD can never show different numbers.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Readout in the top bar | on | every portal page |
| One-click pause button | on | reason chosen from the clock |
| Lunch break from / until | 12:30 / 15:30 | outside this a pause is a small break |
| Clock out from | 17:00 | button switches to clock-out; always confirms |
| Half day — leave from | 12:00 | only on an approved 0.5-day leave |
| Lunch usually starts / back by | 13:20 / 14:45 | window used to spot lunch in your segments |
| Lunch length | 55 min | added to the leaving time until lunch is taken |
| Today panel on the dashboard | on | |
| Mark late days on the calendar | on | |
| Month summary + vs-8h column | on | attendance page |
| Floating HUD panel | **off** | the portal now carries the same numbers |
| Theme | light | light / dark / match system |
| Shift starts | detected | falls back to 08:00 |
| Full day | 8 hours | the Early Exit threshold |
| Grace before "Late" | detected | falls back to 15 min |
| Warn on breaks over | 45 min | one nudge per break |
| Morning nudges | 30, 15, 5 | minutes before shift start |
| Block clock-outs under a full day | on | always overridable |
| Pre-shift notifications | on | suppressed on rest days |
| Tell me when a full day is cleared | on | |
