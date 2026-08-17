/* JDG Clockwork — service worker: toolbar badge, punctuality alarms, notifications.
 *
 * The worker never fetches the portal itself. The Laravel session cookie is
 * SameSite=Lax, so a request from the extension origin would arrive logged out.
 * The content script (same-origin) mirrors today's state into chrome.storage and
 * this worker reads that mirror.
 */
importScripts('lib/portal.js');

var J = self.JDG;
var ALARM = 'jdg-clockwork-tick';

/* ------------------------------------------------------------ scaffolding -- */

chrome.runtime.onInstalled.addListener(function () {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  tick();
});
chrome.runtime.onStartup.addListener(function () {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  tick();
});
chrome.alarms.onAlarm.addListener(function (a) { if (a.name === ALARM) tick(); });

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  if (!msg) return;
  if (msg.type === 'NOTIFY') {
    notifyOnce(msg.key, msg.title, msg.message);
    reply && reply({ ok: true });
  }
  if (msg.type === 'TICK') { tick(); reply && reply({ ok: true }); }
});

/* ---------------------------------------------------------- notifications -- */

function todayKey() {
  var d = new Date();
  return d.getFullYear() + '-' + J.pad2(d.getMonth() + 1) + '-' + J.pad2(d.getDate());
}

function notifyOnce(key, title, message) {
  var day = todayKey();
  chrome.storage.local.get({ notified: {} }, function (o) {
    var n = o.notified || {};
    if (n.day !== day) n = { day: day, keys: {} };
    if (n.keys[key]) return;
    n.keys[key] = true;
    chrome.storage.local.set({ notified: n }, function () {
      chrome.notifications.create('jdgc-' + key + '-' + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: title,
        message: message,
        priority: 2
      });
    });
  });
}

/* ------------------------------------------------------------------ badge -- */

function setBadge(text, color, title) {
  chrome.action.setBadgeText({ text: text || '' });
  if (color) chrome.action.setBadgeBackgroundColor({ color: color });
  chrome.action.setTitle({ title: 'JDG Clockwork' + (title ? ' — ' + title : '') });
}

var RED = '#ef4444', AMBER = '#f59e0b', GREEN = '#16a34a', BLUE = '#0ea5e9', GREY = '#64748b';

function compact(mins) {
  mins = Math.max(0, Math.round(mins));
  if (mins < 60) return String(mins);
  var h = Math.floor(mins / 60);
  return h + 'h';
}

/* ------------------------------------------------------------------- tick -- */

function tick() {
  Promise.all([J.getSettings(), J.cacheGet('today', null)]).then(function (r) {
    var cfg = r[0], t = r[1];
    var now = J.nowMinutes();
    var stale = !t || (Date.now() - t.ts) > 12 * 60 * 1000 || t.date !== J.todayDMY();

    if (stale) {
      // No fresh mirror. Still worth a morning nudge on a plain weekday.
      setBadge('', GREY, 'no recent portal data — open the portal to sync');
      maybeMorning(cfg, now, null);
      return;
    }

    if (t.isHoliday && t.clockIn == null) {
      setBadge('', GREY, (t.status || 'rest day'));
      return;
    }

    if (t.state === 'not-clocked-in') {
      maybeMorning(cfg, now, t);
      var delta = cfg.shiftStart - now;
      if (delta > 0 && delta <= 60) setBadge(compact(delta), BLUE, 'clock in within ' + Math.round(delta) + ' min');
      else if (delta <= 0) {
        var over = Math.round(-delta);
        setBadge('+' + compact(over), over >= cfg.graceMinutes ? RED : AMBER,
          over >= cfg.graceMinutes ? 'late by ' + over + ' min' : 'inside grace, ' + (cfg.graceMinutes - over) + ' min left');
      } else setBadge('', GREY, 'not clocked in');
      return;
    }

    if (t.state === 'working' || t.state === 'break') {
      // Recompute remaining from the mirror so the badge stays live between syncs.
      var elapsedSinceSync = (Date.now() - t.ts) / 60000;
      var worked = t.worked + (t.state === 'working' ? elapsedSinceSync : 0);
      var remaining = Math.max(0, t.requiredMinutes - worked);

      if (remaining <= 0) {
        setBadge('OK', GREEN, '8h cleared — free to clock out');
        if (cfg.notifyTargetReached) {
          notifyOnce('target-reached', 'Eight hours cleared',
            'You have logged a full day. Clocking out now will not raise an Early Exit.');
        }
      } else if (t.state === 'break') {
        setBadge('brk', AMBER, 'on break — ' + Math.round(remaining) + ' min still owed');
      } else {
        setBadge(compact(remaining), remaining <= 30 ? GREEN : AMBER,
          'leave at ' + J.fmtClock(t.targetOut) + ' to clear 8h');
      }
      return;
    }

    if (t.state === 'done') {
      var short = t.requiredMinutes - t.worked;
      setBadge(short > 0 ? '!' : '✓', short > 0 ? RED : GREEN,
        short > 0 ? 'clocked out ' + Math.round(short) + ' min short' : 'full day logged');
      return;
    }

    setBadge('', GREY, null);
  });
}

/* Pre-shift nudges. Only fire when we know you are not already clocked in. */
function maybeMorning(cfg, now, t) {
  if (!cfg.morningAlarms) return;
  if (t && t.clockIn != null) return;          // already in
  if (t && t.isHoliday) return;                // portal says rest day
  if (!t) {                                    // no data: fall back to Mon–Fri
    var dow = new Date().getDay();
    if (dow === 0 || dow === 6) return;
  }

  var leads = cfg.leadTimes || [];
  for (var i = 0; i < leads.length; i++) {
    var at = cfg.shiftStart - leads[i];
    if (now >= at && now < at + 1) {
      notifyOnce('lead-' + leads[i], leads[i] + ' minutes to shift start',
        'Shift starts at ' + J.fmtClock(cfg.shiftStart) + '. You are not clocked in yet.');
    }
  }

  // Last call before the arrival stops being "running late" and becomes "Late".
  var cutoff = cfg.shiftStart + cfg.graceMinutes;
  if (now >= cutoff - 3 && now < cutoff - 2) {
    notifyOnce('grace-3', 'Three minutes of grace left',
      'Clock in before ' + J.fmtClock(cutoff) + ' to avoid the red Late mark.');
  }
  if (now >= cutoff && now < cutoff + 1) {
    notifyOnce('late-mark', 'Grace window closed',
      'Today will be recorded as Late. Clock in now to stop it growing.');
  }
}

tick();
