/*
 * Magic Picker – cloud saving (Firebase Firestore).
 *
 * The app still works from the browser database (IndexedDB) exactly as before. When a teacher signs in,
 * the whole data set (the same content as "Download backup") is kept in Firestore as well:
 *   - after every change on this device it is uploaded (a second or two later),
 *   - when the app opens, comes back to the front, or every 30 seconds, newer cloud data is downloaded.
 * A device whose browser data was wiped counts as new: it takes the cloud data as it is.
 * If two devices changed things at the same time, both sets are merged (no stars or cards are lost).
 *
 * Firestore layout:  spaces/{space}               { rev, chunks, updatedAt, by }
 *                    spaces/{space}/chunks/{i}    { rev, data }   (the backup JSON, split into pieces)
 * Without js/cloud-config.js values, nothing here runs and the app is local-only as before.
 */
window.MP = window.MP || {};

(function () {
  const CHUNK = 300000;            // characters per Firestore document (well under the 1 MiB limit)
  const PULL_EVERY = 30000;
  const PUSH_DELAY = 1200;
  const cfg = window.MP_CLOUD_CONFIG || {};
  const ui = function () { return MP.ui; };
  const st = function () { return MP.store; };

  const S = { configured: false, backend: null, user: null, status: 'off', lastSync: null, error: '' };
  let chain = Promise.resolve();   // every sync step runs one after another
  let pushTimer = null, pullTimer = null, started = false;

  function configured() {
    if (window.MP_CLOUD_BACKEND) return true; // test backend
    const f = cfg.firebase || {};
    return !!(f.apiKey && f.projectId && cfg.space);
  }

  /* ---------- status chip ---------- */
  const LABELS = {
    off: '', signedOut: 'Cloud: sign in', syncing: 'Saving…', ok: 'Saved to cloud',
    offline: 'Offline – will save later', error: 'Cloud problem'
  };
  function setStatus(s, err) {
    S.status = s; S.error = err || '';
    const b = document.getElementById('cloudBtn');
    if (!b) return;
    b.hidden = !S.configured;
    b.textContent = LABELS[s] || '';
    b.dataset.state = s;
    b.title = s === 'ok' && S.lastSync ? 'Last saved: ' + S.lastSync.toLocaleTimeString('en-GB') : (S.error || '');
  }

  /* ---------- helpers ---------- */
  function sortById(list) { return list.slice().sort(function (a, b) { return String(a.id || a.classId).localeCompare(String(b.id || b.classId)); }); }

  /* A stable fingerprint of the data (not the export time), to know whether anything changed since the last sync. */
  function canonical(data) {
    const d = { settings: Object.assign({}, data.settings) };
    ['classes', 'students', 'owned', 'txs', 'rounds'].forEach(function (k) { d[k] = sortById(data[k] || []); });
    return JSON.stringify(d, function (key, val) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        return Object.keys(val).sort().reduce(function (o, k) { o[k] = val[k]; return o; }, {});
      }
      return val;
    });
  }
  function fingerprint(data) {
    const s = canonical(data);
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    }
    return s.length + '-' + h1.toString(16) + h2.toString(16);
  }

  /*
   * Merge two versions when both devices changed something. Nothing that was added on either side is lost:
   * star and card entries are combined by their IDs, an "undo" on either side wins, and each student's
   * stars are recounted from the combined history. Settings and names follow this device.
   */
  function merge(local, remote) {
    const L = local.data, R = remote.data;
    function union(a, b, pick) {
      const m = new Map();
      b.forEach(function (x) { m.set(x.id, x); });
      a.forEach(function (x) { m.set(x.id, m.has(x.id) && pick ? pick(x, m.get(x.id)) : x); });
      return Array.from(m.values());
    }
    const txs = union(L.txs, R.txs, function (l, r) { return (l.undone || r.undone) ? Object.assign({}, l, { undone: true }) : l; });
    const txById = new Map(txs.map(function (x) { return [x.id, x]; }));
    // a card stays only if its card entry was not undone; never the same card twice for one student
    const seen = new Set();
    const owned = union(L.owned, R.owned)
      .filter(function (o) { const tx = txById.get(o.txId); return !(tx && tx.undone); })
      .sort(function (a, b) { return String(a.earnedAt).localeCompare(String(b.earnedAt)); })
      .filter(function (o) {
        const k = o.studentId + '|' + o.cardId;
        if (seen.has(k)) { const tx = txById.get(o.txId); if (tx) tx.undone = true; return false; }
        seen.add(k); return true;
      });
    const classes = union(L.classes, R.classes);
    const classIds = new Set(classes.map(function (c) { return c.id; }));
    const students = union(L.students, R.students).filter(function (s) { return classIds.has(s.classId); });
    const sameHistory = function (sid) {
      const a = L.txs.filter(function (x) { return x.studentId === sid; }).map(function (x) { return x.id + (x.undone ? '!' : ''); }).sort().join();
      const b = R.txs.filter(function (x) { return x.studentId === sid; }).map(function (x) { return x.id + (x.undone ? '!' : ''); }).sort().join();
      return a === b;
    };
    students.forEach(function (s) {
      if (sameHistory(s.id)) return;
      let earned = 0, spent = 0;
      txs.forEach(function (x) {
        if (x.studentId !== s.id || x.undone) return;
        if (x.type === 'stars') earned += x.amount;
        if (x.type === 'card') spent += x.cost;
      });
      s.totalEarned = earned;
      s.balance = Math.max(0, earned - spent);
    });
    const rounds = union(L.rounds.map(function (r) { return Object.assign({ id: r.classId }, r); }), R.rounds.map(function (r) { return Object.assign({ id: r.classId }, r); }))
      .map(function (r) { const c = Object.assign({}, r); delete c.id; return c; });
    // keep the sequence numbers unique so the history order stays clear
    let seq = 0;
    txs.sort(function (a, b) { return (a.seq || 0) - (b.seq || 0) || String(a.createdAt).localeCompare(String(b.createdAt)); })
      .forEach(function (x) { seq += 1; x.seq = seq; });
    return {
      app: 'magic-picker', format: 1, exportedAt: new Date().toISOString(), note: local.note,
      data: { settings: L.settings, classes: classes, students: students, owned: owned, txs: txs, rounds: rounds }
    };
  }

  /* ---------- sync steps ---------- */
  function queue(fn) {
    const p = chain.then(fn, fn);
    chain = p.catch(function () {});
    return p;
  }

  async function localState() {
    const snap = await st().exportBackup();
    return { snap: snap, fp: fingerprint(snap.data), saved: await st().getCloudState() };
  }

  async function adoptRemote(remote, meta, reason) {
    await st().applyCloudSnapshot(remote, { rev: meta.rev, fp: fingerprint(remote.data), at: new Date().toISOString() });
    if (MP.app) {
      await MP.app.refreshSettings();
      const teacherOpen = !document.getElementById('teacher').hidden;
      if (teacherOpen && MP.teacher) MP.teacher.render(); else MP.app.route();
    }
    if (reason) ui().toast(reason, 'ok');
  }

  /* Upload this device's data (merging first if another device saved in the meantime). */
  function push() {
    return queue(async function () {
      if (!S.user) return;
      for (let attempt = 0; attempt < 4; attempt++) {
        const L = await localState();
        if (!L.saved) return syncFirst();
        if (L.saved.fp === L.fp) { done(); return; }
        setStatus('syncing');
        const meta = await S.backend.getMeta();
        let toSend = L.snap, mergedFromRemote = false;
        if (meta.rev !== L.saved.rev) {
          const remote = await S.backend.getSnapshot(meta);
          toSend = merge(L.snap, remote);
          mergedFromRemote = true;
        }
        try {
          const rev = await S.backend.commit(meta.rev, toSend);
          // if nothing changed locally while uploading, store the new sync state (and the merged data)
          const now = await st().exportBackup();
          if (fingerprint(now.data) !== L.fp) {
            // A new change arrived while uploading: go again. After a merge, rev -1 forces another merge,
            // so the other device's additions (now in the cloud) are kept.
            await st().setCloudState({ rev: mergedFromRemote ? -1 : rev, fp: L.fp, at: new Date().toISOString() });
            continue;
          }
          if (mergedFromRemote) await adoptRemote(toSend, { rev: rev }, 'Changes from another device were added.');
          else await st().setCloudState({ rev: rev, fp: L.fp, at: new Date().toISOString() });
          done();
          return;
        } catch (e) {
          if (e && e.code === 'CONFLICT') continue;
          throw e;
        }
      }
    }).catch(fail);
  }

  /* Download newer cloud data. If this device also has unsaved changes, push() merges them. */
  function pull() {
    return queue(async function () {
      if (!S.user) return;
      const L = await localState();
      if (!L.saved) return syncFirst();
      const meta = await S.backend.getMeta();
      if (meta.rev === L.saved.rev) { if (L.saved.fp !== L.fp) push(); else done(); return; }
      if (L.saved.fp !== L.fp) { push(); return; }
      setStatus('syncing');
      const remote = await S.backend.getSnapshot(meta);
      // only replace if nothing changed here while downloading
      const again = await st().exportBackup();
      if (fingerprint(again.data) !== L.fp) { push(); return; }
      await adoptRemote(remote, meta, 'Updated from the cloud.');
      done();
    }).catch(fail);
  }

  /* First sync on this device (new device, or its browser data was wiped). */
  async function syncFirst() {
    setStatus('syncing');
    const meta = await S.backend.getMeta();
    if (meta.rev > 0) {
      const remote = await S.backend.getSnapshot(meta);
      await adoptRemote(remote, meta, 'Your saved classes were loaded from the cloud.');
    } else {
      const L = await localState();
      const rev = await S.backend.commit(0, L.snap);
      await st().setCloudState({ rev: rev, fp: L.fp, at: new Date().toISOString() });
    }
    done();
  }

  function done() { S.lastSync = new Date(); setStatus('ok'); }
  function fail(e) {
    console.error('Cloud sync', e);
    const offline = !navigator.onLine || (e && /unavailable|network|offline|failed to fetch/i.test(String(e.code || '') + ' ' + String(e.message || '')));
    if (offline) { setStatus('offline'); return; }
    if (e && /permission/i.test(String(e.code || '') + String(e.message || ''))) { setStatus('error', 'This Google account is not allowed to save here. Sign out and use the teacher account.'); return; }
    setStatus('error', String((e && (e.message || e.code)) || e));
  }

  function schedulePush() {
    if (!S.user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DELAY);
  }

  function startLoops() {
    if (started) return;
    started = true;
    st().onChange(schedulePush);
    pullTimer = setInterval(function () { if (document.visibilityState === 'visible') pull(); }, PULL_EVERY);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') pull(); });
    window.addEventListener('focus', function () { pull(); });
    window.addEventListener('online', function () { push(); });
    // try to upload before the page is closed
    window.addEventListener('pagehide', function () { if (pushTimer) { clearTimeout(pushTimer); push(); } });
  }

  /* ---------- Firebase backend ---------- */
  async function firebaseBackend() {
    const CDN = 'https://www.gstatic.com/firebasejs/13.2.0/';
    const mods = await Promise.all([import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js'), import(CDN + 'firebase-firestore.js')]);
    const fb = Object.assign({}, mods[0], mods[1], mods[2]);
    const app = fb.initializeApp(cfg.firebase);
    const auth = fb.getAuth(app);
    const db = fb.getFirestore(app);
    const space = String(cfg.space);
    const metaRef = function () { return fb.doc(db, 'spaces', space); };
    const chunkRef = function (i) { return fb.doc(db, 'spaces', space, 'chunks', String(i)); };
    const device = (navigator.userAgent.match(/(Android|iPhone|iPad|Windows|Mac OS X|Linux|CrOS)/) || ['device'])[0];

    return {
      onAuth: function (cb) { fb.onAuthStateChanged(auth, cb); },
      signIn: async function () {
        const provider = new fb.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        try { return await fb.signInWithPopup(auth, provider); }
        catch (e) {
          // Some board browsers block pop-ups: sign in on the same page instead.
          if (e && /popup-blocked|operation-not-supported|cancelled-popup/.test(e.code || '')) return fb.signInWithRedirect(auth, provider);
          throw e;
        }
      },
      signOut: function () { return fb.signOut(auth); },
      getMeta: async function () {
        const d = await fb.getDoc(metaRef());
        return d.exists() ? { rev: d.data().rev || 0, chunks: d.data().chunks || 0 } : { rev: 0, chunks: 0 };
      },
      getSnapshot: async function (meta) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const m = attempt ? await this.getMeta() : meta;
          const parts = await Promise.all(Array.from({ length: m.chunks }, function (_, i) { return fb.getDoc(chunkRef(i)); }));
          if (parts.every(function (p) { return p.exists() && p.data().rev === m.rev; })) {
            return JSON.parse(parts.map(function (p) { return p.data().data; }).join(''));
          }
        }
        throw new Error('The cloud data was changing; please try again.');
      },
      commit: function (expectedRev, snapshot) {
        const text = JSON.stringify(snapshot);
        const pieces = [];
        for (let i = 0; i < text.length; i += CHUNK) pieces.push(text.slice(i, i + CHUNK));
        return fb.runTransaction(db, async function (tx) {
          const cur = await tx.get(metaRef());
          const rev = cur.exists() ? (cur.data().rev || 0) : 0;
          if (rev !== expectedRev) throw Object.assign(new Error('Changed on another device'), { code: 'CONFLICT' });
          const next = rev + 1;
          pieces.forEach(function (p, i) { tx.set(chunkRef(i), { rev: next, data: p }); });
          const oldCount = cur.exists() ? (cur.data().chunks || 0) : 0;
          for (let i = pieces.length; i < oldCount; i++) tx.delete(chunkRef(i));
          tx.set(metaRef(), { rev: next, chunks: pieces.length, updatedAt: fb.serverTimestamp(), by: device });
          return next;
        });
      }
    };
  }

  /* ---------- sign-in dialog ---------- */
  function openDialog() {
    const h = ui().h;
    if (!S.backend) { ui().toast('Cloud saving is still loading. Try again in a moment.'); return; }
    if (!S.user) {
      const msg = h('p', { class: 'cloud-msg', 'aria-live': 'polite' });
      const go = h('button', { class: 'btn btn-gold' }, 'Sign in with Google');
      const m = ui().modal(h('div', null,
        h('h2', null, 'Save to the cloud'),
        h('p', null, 'Sign in once on each device with the teacher Google account' + (cfg.email ? ' (' + cfg.email + ')' : '') + '. Stars, cards and classes are then saved online and are the same on every device.'),
        msg,
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-pearl', onclick: function () { m.close(); } }, 'Cancel'), go)));
      go.onclick = async function () {
        go.disabled = true; msg.textContent = 'Opening Google sign-in…';
        try { await S.backend.signIn(); m.close(); }
        catch (e) {
          const c = String((e && e.code) || '');
          msg.textContent = /network/.test(c) ? 'No internet connection.'
            : /popup-closed|cancelled/.test(c) ? 'Sign-in was closed. Try again.'
            : /unauthorized-domain/.test(c) ? 'This web address is not allowed in Firebase yet.'
            : 'Could not sign in (' + c + ').';
          go.disabled = false;
        }
      };
      return;
    }
    const m = ui().modal(h('div', null,
      h('h2', null, 'Cloud saving'),
      h('p', null, 'Signed in as ', h('b', null, S.user.email || 'teacher'), '.'),
      h('p', null, S.status === 'ok' && S.lastSync ? 'Everything is saved (' + S.lastSync.toLocaleTimeString('en-GB') + ').' : (LABELS[S.status] || '') + (S.error ? ' – ' + S.error : '')),
      h('p', { style: { fontSize: '.95rem' } }, 'On a shared board, sign out at the end of the day if other people use it.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-pearl', onclick: async function () { m.close(); await S.backend.signOut(); } }, 'Sign out'),
        h('button', { class: 'btn btn-teal', onclick: function () { m.close(); push(); pull(); } }, 'Save now'),
        h('button', { class: 'btn btn-gold', onclick: function () { m.close(); } }, 'OK'))));
  }

  /* ---------- start (called by app.js after the local data is ready) ---------- */
  async function start() {
    S.configured = configured();
    const btn = document.getElementById('cloudBtn');
    if (!S.configured) { if (btn) btn.hidden = true; return; }
    if (btn) btn.addEventListener('click', openDialog);
    setStatus('signedOut');
    try {
      S.backend = window.MP_CLOUD_BACKEND || await firebaseBackend();
    } catch (e) {
      console.error('Cloud saving could not load', e);
      setStatus('offline', 'Cloud saving could not load (no internet?). Data is still saved on this device.');
      return;
    }
    startLoops();
    S.backend.onAuth(function (user) {
      S.user = user || null;
      if (!S.user) { setStatus('signedOut'); return; }
      pull();
    });
  }

  MP.cloud = { start: start, push: push, pull: pull, state: S, _merge: merge, _fingerprint: fingerprint };
})();
