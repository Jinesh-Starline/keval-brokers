/* Browser version of the Electron preload API (window.api), so app.js runs unchanged on a phone.
   Data lives in IndexedDB on the phone. Files go out through the share sheet and come in through the file picker. */
(() => {
  window.DEVICE_NAME = 'Mobile';

  /* A white page hides the reason. Show any start-up problem on the screen instead. */
  function showProblem(lines) {
    const v = document.getElementById('view');
    if (!v) return;
    v.textContent = '';
    const box = document.createElement('div');
    box.className = 'notice';
    lines.forEach((t) => { const p = document.createElement('div'); p.textContent = t; box.appendChild(p); });
    v.appendChild(box);
  }
  window.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t !== window && (t.src || t.href)) showProblem(['Could not load ' + (t.src || t.href), 'Check that this file is uploaded with exactly this name.']);
    else showProblem(['Error: ' + (e.message || 'unknown'), (e.filename || '') + ':' + (e.lineno || '')]);
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    showProblem(['Error: ' + ((e.reason && (e.reason.message || e.reason.name)) || String(e.reason))]);
  });
  setTimeout(() => {
    const v = document.getElementById('view');
    if (v && !v.children.length) {
      showProblem(['The app did not start.', 'logic.js loaded: ' + (window.Logic ? 'yes' : 'no'), 'app.js loaded: ' + (window.__app ? 'yes' : 'no'),
        'IndexedDB: ' + (window.indexedDB ? 'yes' : 'no'), 'Address: ' + location.href]);
    }
  }, 3000);

  const DB_NAME = 'keval-brokers';
  const STORE = 'kv';
  const KEEP_BACKUPS = 14;

  const dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  function idb(mode, fn) {
    return dbp.then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = t.onabort = () => reject(t.error);
    }));
  }

  const dayKey = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  let prunedDay = '';
  async function pruneBackups() {
    const keys = (await idb('readonly', (s) => s.getAllKeys())).filter((k) => String(k).startsWith('backup-')).sort();
    const old = keys.slice(0, Math.max(0, keys.length - KEEP_BACKUPS));
    if (old.length) await idb('readwrite', (s) => { old.forEach((k) => s.delete(k)); });
  }

  async function saveFile(content, name) {
    const ext = String(name).split('.').pop().toLowerCase();
    const type = ext === 'csv' ? 'text/csv' : ext === 'html' ? 'text/html' : 'text/plain';
    const file = new File([content], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return name;
      } catch (e) {
        if (e && e.name === 'AbortError') return null; // closed the share sheet
      }
    }
    const url = URL.createObjectURL(file); // no share sheet on this browser: plain download
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return name;
  }

  window.api = {
    load: async () => (await idb('readonly', (s) => s.get('db'))) || null,

    save: async (db) => {
      const day = dayKey();
      await idb('readwrite', (s) => { s.put(db, 'db'); return s.put(db, 'backup-' + day); });
      if (prunedDay !== day) { prunedDay = day; pruneBackups().catch(() => {}); }
      return true;
    },

    // Only WhatsApp click-to-chat links, same rule as the computer app.
    openWhatsApp: async (url) => {
      if (typeof url !== 'string' || !/^https:\/\/wa\.me\/\d{10,15}\?text=/.test(url)) return false;
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    },

    // No PDF engine in a browser: the bill is shared as an HTML page that can be opened and printed to PDF.
    savePdf: (html, name) => saveFile(html, String(name || 'bill').replace(/\.pdf$/i, '') + '.html'),

    saveFile: (content, name) => saveFile(content, name),

    openFile: () => new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.hidden = true;
      document.body.appendChild(input);
      let done = false;
      const finish = (v) => { if (done) return; done = true; input.remove(); resolve(v); };
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        if (!f) return finish(null);
        finish({ name: f.name, content: await f.text() });
      });
      input.addEventListener('cancel', () => finish(null));
      input.click();
    }),

    // There is no backup folder on a phone: share today's full backup file instead.
    openBackups: async () => {
      const db = await idb('readonly', (s) => s.get('db'));
      return saveFile(JSON.stringify(db || {}, null, 2), 'Keval-Brokers-Backup-' + dayKey() + '.json');
    },
  };

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
