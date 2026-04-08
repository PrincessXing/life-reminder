'use strict';

/* ── IndexedDB helpers ── */
const IDB = 'ftools', STORE = 'kv';

function openDB() {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(IDB, 1);
    req.onupgradeneeded = ev => {
      if (!ev.target.result.objectStoreNames.contains(STORE))
        ev.target.result.createObjectStore(STORE);
    };
    req.onsuccess = ev => ok(ev.target.result);
    req.onerror = fail;
  });
}
async function kget(key) {
  const db = await openDB();
  return new Promise((ok, fail) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    r.onsuccess = () => ok(r.result ?? null);
    r.onerror = fail;
  });
}
async function kset(key, val) {
  const db = await openDB();
  return new Promise((ok, fail) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = ok;
    tx.onerror = fail;
  });
}

/* ── Notification check ── */
let nextTimer = null;

async function checkAndNotify() {
  const reminders = (await kget('rem')) || [];
  const fired     = new Set((await kget('fired')) || []);
  const now = Date.now();
  let changed = false;

  for (const r of reminders) {
    if (r.done && r.rep === 'none') continue;
    const t = r.at - (r.adv || 0) * 60000;
    if (now >= t && !fired.has(r.id)) {
      fired.add(r.id);
      changed = true;
      const icon = r.cat === 'farm' ? '🌾' : '⏰';
      const notifTitle = icon + ' ' + r.title;
      const notifBody  = r.note || '时间到了！';
      try {
        await self.registration.showNotification(notifTitle, {
          body: notifBody,
          icon: './icon.png',
          tag : r.id,
          requireInteraction: true,
          data: { scope: self.registration.scope }
        });
      } catch(e) { console.warn('SW notify:', e); }
      // Bark 推送（即使 SW 通知权限不足也能触达）
      const barkKey = await kget('barkKey');
      if(barkKey) {
        const base = barkKey.startsWith('http') ? barkKey.replace(/\/$/, '') : 'https://api.day.app/' + barkKey;
        try {
          await fetch(base + '/' + encodeURIComponent(notifTitle) + '/' + encodeURIComponent(notifBody) + '?sound=bell&group=FTools');
        } catch(e) {}
      }

      // Advance repeating reminder
      if (r.rep && r.rep !== 'none') {
        fired.delete(r.id);
        let nx;
        if      (r.rep === 'daily')    nx = r.at + 86400000;
        else if (r.rep === 'weekly')   nx = r.at + 604800000;
        else if (r.rep === 'hourly')   nx = r.at + 3600000;
        else if (r.rep === '30min')    nx = r.at + 1800000;
        else if (r.rep === 'custom')   nx = r.at + (r.intv || 60) * 60000;
        else if (r.rep === 'weekdays') {
          let d = new Date(r.at);
          do { d = new Date(d.getTime() + 86400000); }
          while (d.getDay() === 0 || d.getDay() === 6);
          nx = d.getTime();
        }
        if (nx && nx > now) r.at = nx;
      }
    }
  }

  if (changed) {
    await kset('rem', reminders);
    await kset('fired', [...fired]);
  }

  scheduleNext(reminders, fired, now);
}

function scheduleNext(reminders, fired, now) {
  if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; }

  const upcoming = reminders
    .filter(r => !(r.done && r.rep === 'none') && !fired.has(r.id))
    .map(r => r.at - (r.adv || 0) * 60000)
    .filter(t => t > now)
    .sort((a, b) => a - b);

  if (!upcoming.length) return;

  // Only schedule within SW safe lifetime (≤ 55s); longer ones rely on page ping or periodicsync
  const delay = upcoming[0] - now;
  if (delay <= 55000) {
    nextTimer = setTimeout(() => checkAndNotify(), delay + 300);
  }
}

/* ── Message from page ── */
self.addEventListener('message', ev => {
  const { type, rem, fired } = ev.data || {};

  if (type === 'SYNC') {
    ev.waitUntil((async () => {
      await kset('rem', rem || []);
      if (fired) await kset('fired', fired);
      if (ev.data.barkKey !== undefined) await kset('barkKey', ev.data.barkKey || '');
      await checkAndNotify();
      ev.source?.postMessage({ type: 'SW_OK' });
    })());
  }

  if (type === 'CHECK') {
    ev.waitUntil(checkAndNotify());
  }
});

/* ── Periodic Background Sync (installed PWA) ── */
self.addEventListener('periodicsync', ev => {
  if (ev.tag === 'ft-check') ev.waitUntil(checkAndNotify());
});

/* ── Notification click → focus / open page ── */
self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  const scope = ev.notification.data?.scope || self.registration.scope;
  ev.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const win = list.find(w => w.url.startsWith(scope));
      if (win) return win.focus();
      return clients.openWindow(scope);
    })
  );
});

/* ── Lifecycle ── */
self.addEventListener('install',  ()  => self.skipWaiting());
self.addEventListener('activate', ev => ev.waitUntil(clients.claim()));
