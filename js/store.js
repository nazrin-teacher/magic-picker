/*
 * Magic Picker data layer (IndexedDB, local to this browser profile on this device).
 *
 * All messages are in English, like the rest of the app.
 *
 * Every write runs inside ONE IndexedDB transaction and the returned promise resolves only
 * after that transaction has committed. If anything fails the whole transaction is aborted,
 * so e.g. a card purchase either deducts the stars AND stores the card, or changes nothing.
 *
 * Stores
 *   meta      { key: 'settings', starsPerCard, sound, motion, pin, createdAt }
 *   classes   { id, name, archived, isDemo, createdAt }
 *   students  { id, classId, name, archived, isDemo, totalEarned, balance, createdAt }
 *   owned     { id, studentId, classId, cardId, earnedAt, txId, mode }   unique [studentId, cardId]
 *   txs       { id, type, studentId, classId, amount?, cardId?, cost?, ownedId?, batchId?, mode?,
 *               createdAt, undone, undoneAt?, note? }
 *   rounds    { classId, picked: [studentId], noRepeats, lastPickedId }
 *   requests  { id, createdAt }   idempotency keys: the same request can never be applied twice
 */
window.MP = window.MP || {};

(function () {
  const DB_VERSION = 1;
  const DEFAULT_CLASSES = ['J5A', 'J5B', 'J6A', 'J6B', 'J6C', 'J6D', 'J6E'];
  const ALL_STORES = ['meta', 'classes', 'students', 'owned', 'txs', 'rounds', 'requests'];
  const BACKUP_STORES = ['classes', 'students', 'owned', 'txs', 'rounds'];
  const TX_TYPES = ['stars', 'card', 'move', 'reset'];

  let dbName = 'magic-picker';
  let dbPromise = null;

  /* ---------- small helpers ---------- */
  function StoreError(code, message) {
    const e = new Error(message || code);
    e.code = code;
    return e;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /* Unbiased random integer in [0, n) */
  function randInt(n) {
    if (n <= 0) throw StoreError('EMPTY');
    const max = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= max);
    return buf[0] % n;
  }

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function now() { return new Date().toISOString(); }
  function cleanName(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 60); }
  function isInt(n) { return typeof n === 'number' && Number.isInteger(n); }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(StoreError('NO_INDEXEDDB', 'IndexedDB is not available in this browser.')); return; }
      const r = indexedDB.open(dbName, DB_VERSION);
      r.onupgradeneeded = function () {
        const db = r.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('classes')) db.createObjectStore('classes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('students')) {
          const s = db.createObjectStore('students', { keyPath: 'id' });
          s.createIndex('classId', 'classId');
        }
        if (!db.objectStoreNames.contains('owned')) {
          const o = db.createObjectStore('owned', { keyPath: 'id' });
          o.createIndex('studentId', 'studentId');
          o.createIndex('studentCard', ['studentId', 'cardId'], { unique: true });
        }
        if (!db.objectStoreNames.contains('txs')) {
          const t = db.createObjectStore('txs', { keyPath: 'id' });
          t.createIndex('classId', 'classId');
          t.createIndex('studentId', 'studentId');
        }
        if (!db.objectStoreNames.contains('rounds')) db.createObjectStore('rounds', { keyPath: 'classId' });
        if (!db.objectStoreNames.contains('requests')) db.createObjectStore('requests', { keyPath: 'id' });
      };
      r.onsuccess = function () {
        const db = r.result;
        db.onversionchange = function () { db.close(); dbPromise = null; };
        resolve(db);
      };
      r.onerror = function () { dbPromise = null; reject(r.error || StoreError('OPEN_FAILED')); };
      r.onblocked = function () { /* another tab holds an old version; open will continue when it closes */ };
    });
    return dbPromise;
  }

  /*
   * Run `body(t)` inside one transaction. Only IndexedDB requests may be awaited inside body,
   * otherwise the transaction would auto-commit early. Resolves after commit, rejects after abort.
   */
  async function run(names, mode, body) {
    const db = await openDB();
    return new Promise(function (resolve, reject) {
      let t;
      try { t = db.transaction(names, mode); } catch (e) { reject(e); return; }
      let result, failure = null;
      t.oncomplete = function () { if (failure) reject(failure); else resolve(result); };
      t.onabort = function () { reject(failure || t.error || StoreError('ABORTED', 'The change was not saved.')); };
      Promise.resolve()
        .then(function () { return body(t); })
        .then(function (r) { result = r; }, function (e) {
          failure = e;
          try { t.abort(); } catch (_) { /* already aborting */ }
        });
    });
  }

  function S(t, name) { return t.objectStore(name); }

  async function claimRequest(t, requestId) {
    if (!requestId) return;
    const existing = await req(S(t, 'requests').get(requestId));
    if (existing) throw StoreError('DUPLICATE_REQUEST', 'This action was already done.');
    await req(S(t, 'requests').add({ id: requestId, createdAt: now() }));
  }

  /* Monotonic operation counter: orders history reliably even within the same millisecond. */
  async function nextSeq(t) {
    const r = (await req(S(t, 'meta').get('seq'))) || { key: 'seq', value: 0 };
    r.value += 1;
    await req(S(t, 'meta').put(r));
    return r.value;
  }

  function newestFirst(a, b) {
    return ((b.seq || 0) - (a.seq || 0)) || b.createdAt.localeCompare(a.createdAt);
  }

  async function getSettingsIn(t) {
    const s = await req(S(t, 'meta').get('settings'));
    if (!s) throw StoreError('NOT_INITIALISED');
    return s;
  }

  async function getStudentIn(t, id) {
    const s = await req(S(t, 'students').get(id));
    if (!s) throw StoreError('NO_STUDENT', 'Student not found.');
    return s;
  }

  /* ---------- setup ---------- */
  async function init() {
    return run(['meta', 'classes'], 'readwrite', async function (t) {
      const s = await req(S(t, 'meta').get('settings'));
      if (s) return { firstRun: false };
      await req(S(t, 'meta').add({ key: 'settings', starsPerCard: 5, sound: true, motion: 'system', pin: null, createdAt: now() }));
      for (let i = 0; i < DEFAULT_CLASSES.length; i++) {
        await req(S(t, 'classes').add({ id: uuid(), name: DEFAULT_CLASSES[i], archived: false, isDemo: false, order: i, createdAt: now() }));
      }
      return { firstRun: true };
    });
  }

  function getSettings() {
    return run(['meta'], 'readonly', function (t) { return getSettingsIn(t); });
  }

  function updateSettings(patch) {
    return run(['meta'], 'readwrite', async function (t) {
      const s = await getSettingsIn(t);
      if ('starsPerCard' in patch) {
        const n = Number(patch.starsPerCard);
        if (!isInt(n) || n < 1 || n > 100) throw StoreError('BAD_VALUE', 'Stars per card must be a whole number from 1 to 100.');
        s.starsPerCard = n;
      }
      if ('sound' in patch) s.sound = !!patch.sound;
      if ('motion' in patch) s.motion = ['system', 'reduce', 'full'].indexOf(patch.motion) >= 0 ? patch.motion : 'system';
      if ('pin' in patch) s.pin = patch.pin;
      await req(S(t, 'meta').put(s));
      return s;
    });
  }

  /* ---------- classes ---------- */
  function sortClasses(list) {
    return list.sort(function (a, b) {
      return (a.order != null ? a.order : 999) - (b.order != null ? b.order : 999) || a.name.localeCompare(b.name);
    });
  }

  function listClasses(opts) {
    const includeArchived = opts && opts.includeArchived;
    return run(['classes'], 'readonly', async function (t) {
      const all = await req(S(t, 'classes').getAll());
      return sortClasses(all.filter(function (c) { return includeArchived || !c.archived; }));
    });
  }

  function getClass(id) {
    return run(['classes'], 'readonly', function (t) { return req(S(t, 'classes').get(id)); });
  }

  async function assertUniqueClassName(t, name, exceptId) {
    const all = await req(S(t, 'classes').getAll());
    const clash = all.find(function (c) { return c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase(); });
    if (clash) throw StoreError('DUPLICATE_CLASS', 'A class with this name already exists.');
    return all;
  }

  function createClass(name, opts) {
    name = cleanName(name);
    return run(['classes'], 'readwrite', async function (t) {
      if (!name) throw StoreError('BAD_VALUE', 'Class name is empty.');
      const all = await assertUniqueClassName(t, name);
      const c = { id: uuid(), name: name, archived: false, isDemo: !!(opts && opts.isDemo), order: all.length, createdAt: now() };
      await req(S(t, 'classes').add(c));
      return c;
    });
  }

  function renameClass(id, name) {
    name = cleanName(name);
    return run(['classes'], 'readwrite', async function (t) {
      if (!name) throw StoreError('BAD_VALUE', 'Class name is empty.');
      const c = await req(S(t, 'classes').get(id));
      if (!c) throw StoreError('NO_CLASS');
      await assertUniqueClassName(t, name, id);
      c.name = name;
      await req(S(t, 'classes').put(c));
      return c;
    });
  }

  function setClassArchived(id, archived) {
    return run(['classes'], 'readwrite', async function (t) {
      const c = await req(S(t, 'classes').get(id));
      if (!c) throw StoreError('NO_CLASS');
      c.archived = !!archived;
      await req(S(t, 'classes').put(c));
      return c;
    });
  }

  async function deleteStudentDataIn(t, studentId) {
    const owned = await req(S(t, 'owned').index('studentId').getAllKeys(studentId));
    for (const k of owned) await req(S(t, 'owned').delete(k));
    const txs = await req(S(t, 'txs').index('studentId').getAllKeys(studentId));
    for (const k of txs) await req(S(t, 'txs').delete(k));
  }

  function deleteClass(id) {
    return run(['classes', 'students', 'owned', 'txs', 'rounds'], 'readwrite', async function (t) {
      const c = await req(S(t, 'classes').get(id));
      if (!c) throw StoreError('NO_CLASS');
      const students = await req(S(t, 'students').index('classId').getAll(id));
      for (const s of students) {
        await deleteStudentDataIn(t, s.id);
        await req(S(t, 'students').delete(s.id));
      }
      const leftover = await req(S(t, 'txs').index('classId').getAllKeys(id));
      for (const k of leftover) await req(S(t, 'txs').delete(k));
      await req(S(t, 'rounds').delete(id));
      await req(S(t, 'classes').delete(id));
      return { removedStudents: students.length };
    });
  }

  /* ---------- students ---------- */
  /* Turkish alphabetical order for the children's names (C before Ç, I before İ ...). */
  function sortStudents(list) {
    return list.sort(function (a, b) { return a.name.localeCompare(b.name, 'tr') || a.createdAt.localeCompare(b.createdAt); });
  }

  function listStudents(classId, opts) {
    const includeArchived = opts && opts.includeArchived;
    return run(['students', 'owned'], 'readonly', async function (t) {
      const all = await req(S(t, 'students').index('classId').getAll(classId));
      const list = all.filter(function (s) { return includeArchived || !s.archived; });
      for (const s of list) s.cardCount = await req(S(t, 'owned').index('studentId').count(s.id));
      return sortStudents(list);
    });
  }

  function getStudent(id) {
    return run(['students'], 'readonly', function (t) { return req(S(t, 'students').get(id)); });
  }

  function addStudents(classId, names, opts) {
    const clean = (names || []).map(cleanName).filter(Boolean);
    return run(['classes', 'students'], 'readwrite', async function (t) {
      const c = await req(S(t, 'classes').get(classId));
      if (!c) throw StoreError('NO_CLASS', 'Class not found.');
      if (!clean.length) throw StoreError('BAD_VALUE', 'No names to add.');
      const created = [];
      for (let i = 0; i < clean.length; i++) {
        const s = {
          id: uuid(), classId: classId, name: clean[i], archived: false, isDemo: !!(opts && opts.isDemo),
          totalEarned: 0, balance: 0, createdAt: new Date(Date.now() + i).toISOString()
        };
        await req(S(t, 'students').add(s));
        created.push(s);
      }
      return created;
    });
  }

  function renameStudent(id, name) {
    name = cleanName(name);
    return run(['students'], 'readwrite', async function (t) {
      if (!name) throw StoreError('BAD_VALUE', 'Name is empty.');
      const s = await getStudentIn(t, id);
      s.name = name;
      await req(S(t, 'students').put(s));
      return s;
    });
  }

  function setStudentArchived(id, archived) {
    return run(['students'], 'readwrite', async function (t) {
      const s = await getStudentIn(t, id);
      s.archived = !!archived;
      await req(S(t, 'students').put(s));
      return s;
    });
  }

  /* Moving a student takes their stars, cards and history with them. */
  function moveStudent(id, newClassId) {
    return run(['meta', 'classes', 'students', 'owned', 'txs'], 'readwrite', async function (t) {
      const s = await getStudentIn(t, id);
      const target = await req(S(t, 'classes').get(newClassId));
      if (!target) throw StoreError('NO_CLASS', 'Class not found.');
      if (s.classId === newClassId) return s;
      const fromId = s.classId;
      s.classId = newClassId;
      await req(S(t, 'students').put(s));
      const owned = await req(S(t, 'owned').index('studentId').getAll(id));
      for (const o of owned) { o.classId = newClassId; await req(S(t, 'owned').put(o)); }
      const txs = await req(S(t, 'txs').index('studentId').getAll(id));
      for (const x of txs) { x.classId = newClassId; await req(S(t, 'txs').put(x)); }
      await req(S(t, 'txs').add({ id: uuid(), type: 'move', studentId: id, classId: newClassId, fromClassId: fromId, seq: await nextSeq(t), createdAt: now(), undone: false }));
      return s;
    });
  }

  /* Explicit teacher action: removes the student's cards and star history, sets stars to 0. */
  function resetStudent(id) {
    return run(['meta', 'students', 'owned', 'txs'], 'readwrite', async function (t) {
      const s = await getStudentIn(t, id);
      await deleteStudentDataIn(t, id);
      s.balance = 0; s.totalEarned = 0;
      await req(S(t, 'students').put(s));
      await req(S(t, 'txs').add({ id: uuid(), type: 'reset', studentId: id, classId: s.classId, seq: await nextSeq(t), createdAt: now(), undone: false }));
      return s;
    });
  }

  function deleteStudent(id) {
    return run(['students', 'owned', 'txs'], 'readwrite', async function (t) {
      await getStudentIn(t, id);
      await deleteStudentDataIn(t, id);
      await req(S(t, 'students').delete(id));
      return true;
    });
  }

  /* ---------- stars ---------- */
  function awardStars(studentIds, amount, opts) {
    const n = Number(amount);
    const ids = Array.from(new Set(studentIds || []));
    return run(['meta', 'students', 'txs', 'requests'], 'readwrite', async function (t) {
      if (!isInt(n) || n < 1 || n > 100) throw StoreError('BAD_VALUE', 'Stars must be a whole number from 1 to 100.');
      if (!ids.length) throw StoreError('BAD_VALUE', 'No students selected.');
      await claimRequest(t, opts && opts.requestId);
      const batchId = uuid();
      const createdAt = now();
      const updated = [];
      for (const id of ids) {
        const s = await getStudentIn(t, id);
        if (s.archived) throw StoreError('ARCHIVED', s.name + ' is archived.');
        s.balance += n; s.totalEarned += n;
        await req(S(t, 'students').put(s));
        await req(S(t, 'txs').add({ id: uuid(), type: 'stars', studentId: id, classId: s.classId, amount: n, batchId: batchId, seq: await nextSeq(t), createdAt: createdAt, undone: false }));
        updated.push(s);
      }
      return { batchId: batchId, students: updated };
    });
  }

  /* ---------- cards ---------- */
  async function commitCardIn(t, s, cardId, cost, mode) {
    const createdAt = now();
    const txId = uuid(), ownedId = uuid();
    s.balance -= cost;
    if (s.balance < 0) throw StoreError('NOT_ENOUGH_STARS');
    await req(S(t, 'students').put(s));
    // The unique [studentId, cardId] index makes a duplicate card impossible even if a check were skipped.
    await req(S(t, 'owned').add({ id: ownedId, studentId: s.id, classId: s.classId, cardId: cardId, earnedAt: createdAt, txId: txId, mode: mode }));
    await req(S(t, 'txs').add({ id: txId, type: 'card', studentId: s.id, classId: s.classId, cardId: cardId, cost: cost, ownedId: ownedId, mode: mode, seq: await nextSeq(t), createdAt: createdAt, undone: false }));
    return { cardId: cardId, card: MP.CARD_BY_ID[cardId], student: s, earnedAt: createdAt, cost: cost };
  }

  async function prepareCardIn(t, studentId, requestId) {
    const settings = await getSettingsIn(t);
    const s = await getStudentIn(t, studentId);
    if (s.archived) throw StoreError('ARCHIVED', 'This student is archived.');
    await claimRequest(t, requestId);
    const cost = settings.starsPerCard;
    if (s.balance < cost) throw StoreError('NOT_ENOUGH_STARS', 'Not enough stars yet.');
    return { s: s, cost: cost };
  }

  function buyCard(studentId, cardId, opts) {
    return run(['meta', 'students', 'owned', 'txs', 'requests'], 'readwrite', async function (t) {
      if (!MP.CARD_BY_ID[cardId]) throw StoreError('NO_CARD', 'Unknown card.');
      const p = await prepareCardIn(t, studentId, opts && opts.requestId);
      const has = await req(S(t, 'owned').index('studentCard').get([studentId, cardId]));
      if (has) throw StoreError('ALREADY_OWNED', 'This card is already in the album.');
      return commitCardIn(t, p.s, cardId, p.cost, 'choose');
    });
  }

  /* Random card among the ones the student does not own yet; every card has the same chance. */
  function surpriseCard(studentId, collectionId, opts) {
    return run(['meta', 'students', 'owned', 'txs', 'requests'], 'readwrite', async function (t) {
      const p = await prepareCardIn(t, studentId, opts && opts.requestId);
      const owned = await req(S(t, 'owned').index('studentId').getAll(studentId));
      const have = new Set(owned.map(function (o) { return o.cardId; }));
      const pool = MP.cardsIn(collectionId).filter(function (c) { return !have.has(c.id); });
      if (!pool.length) throw StoreError('COLLECTION_COMPLETE', 'All cards in this collection are already collected.');
      const card = pool[randInt(pool.length)];
      return commitCardIn(t, p.s, card.id, p.cost, 'surprise');
    });
  }

  function getOwned(studentId) {
    return run(['owned'], 'readonly', async function (t) {
      const list = await req(S(t, 'owned').index('studentId').getAll(studentId));
      const map = {};
      list.forEach(function (o) { map[o.cardId] = o; });
      return map;
    });
  }

  /* ---------- undo ---------- */
  async function findUndoIn(t, classId) {
    const txs = await req(S(t, 'txs').index('classId').getAll(classId));
    const candidates = txs.filter(function (x) { return (x.type === 'stars' || x.type === 'card') && !x.undone; });
    if (!candidates.length) return null;
    candidates.sort(newestFirst);
    const last = candidates[0];
    const group = last.type === 'stars' && last.batchId
      ? candidates.filter(function (x) { return x.batchId === last.batchId; })
      : [last];
    return group;
  }

  async function describeGroup(t, group) {
    const parts = [];
    for (const x of group) {
      const s = await req(S(t, 'students').get(x.studentId));
      parts.push({ tx: x, studentName: s ? s.name : '?' });
    }
    return parts;
  }

  function peekUndo(classId) {
    return run(['txs', 'students'], 'readonly', async function (t) {
      const group = await findUndoIn(t, classId);
      if (!group) return null;
      return describeGroup(t, group);
    });
  }

  function undoLast(classId, opts) {
    return run(['students', 'owned', 'txs', 'requests'], 'readwrite', async function (t) {
      await claimRequest(t, opts && opts.requestId);
      const group = await findUndoIn(t, classId);
      if (!group) throw StoreError('NOTHING_TO_UNDO', 'There is nothing to undo.');
      if (opts && opts.expectTxId && group[0].id !== opts.expectTxId) {
        throw StoreError('CHANGED', 'Something changed since the confirmation. Please try again.');
      }
      const at = now();
      for (const x of group) {
        const s = await getStudentIn(t, x.studentId);
        if (x.type === 'stars') {
          if (s.balance < x.amount) {
            throw StoreError('CANNOT_UNDO', s.name + ' has already spent these stars. Undo the card first.');
          }
          s.balance -= x.amount; s.totalEarned -= x.amount;
        } else {
          await req(S(t, 'owned').delete(x.ownedId));
          s.balance += x.cost;
        }
        await req(S(t, 'students').put(s));
        x.undone = true; x.undoneAt = at;
        await req(S(t, 'txs').put(x));
      }
      return describeGroup(t, group);
    });
  }

  function listTxs(filter) {
    return run(['txs', 'students'], 'readonly', async function (t) {
      let list;
      if (filter && filter.studentId) list = await req(S(t, 'txs').index('studentId').getAll(filter.studentId));
      else if (filter && filter.classId) list = await req(S(t, 'txs').index('classId').getAll(filter.classId));
      else list = await req(S(t, 'txs').getAll());
      list.sort(newestFirst);
      if (filter && filter.limit) list = list.slice(0, filter.limit);
      const names = {};
      for (const x of list) {
        if (!(x.studentId in names)) {
          const s = await req(S(t, 'students').get(x.studentId));
          names[x.studentId] = s ? s.name : '(deleted)';
        }
        x.studentName = names[x.studentId];
      }
      return list;
    });
  }

  /* ---------- Pick a Student ---------- */
  function getRound(classId) {
    return run(['rounds', 'students'], 'readonly', async function (t) {
      const r = (await req(S(t, 'rounds').get(classId))) || { classId: classId, picked: [], noRepeats: true };
      const active = (await req(S(t, 'students').index('classId').getAll(classId))).filter(function (s) { return !s.archived; });
      const ids = new Set(active.map(function (s) { return s.id; }));
      const picked = r.picked.filter(function (id) { return ids.has(id); });
      return { noRepeats: r.noRepeats !== false, pickedCount: picked.length, total: active.length, roundComplete: active.length > 0 && picked.length >= active.length };
    });
  }

  function setNoRepeats(classId, on) {
    return run(['rounds'], 'readwrite', async function (t) {
      const r = (await req(S(t, 'rounds').get(classId))) || { classId: classId, picked: [] };
      r.noRepeats = !!on;
      await req(S(t, 'rounds').put(r));
      return r;
    });
  }

  function newRound(classId) {
    return run(['rounds'], 'readwrite', async function (t) {
      const r = (await req(S(t, 'rounds').get(classId))) || { classId: classId, noRepeats: true };
      r.picked = []; r.lastPickedId = null; r.startedAt = now();
      await req(S(t, 'rounds').put(r));
      return r;
    });
  }

  /* Picking never changes stars or cards. */
  function pickStudent(classId) {
    return run(['rounds', 'students'], 'readwrite', async function (t) {
      const r = (await req(S(t, 'rounds').get(classId))) || { classId: classId, picked: [], noRepeats: true };
      const active = (await req(S(t, 'students').index('classId').getAll(classId))).filter(function (s) { return !s.archived; });
      if (!active.length) throw StoreError('NO_STUDENTS', 'There are no students in this class yet.');
      const ids = new Set(active.map(function (s) { return s.id; }));
      r.picked = (r.picked || []).filter(function (id) { return ids.has(id); });
      const noRepeats = r.noRepeats !== false;
      let pool = active;
      if (noRepeats) {
        const done = new Set(r.picked);
        pool = active.filter(function (s) { return !done.has(s.id); });
        if (!pool.length) throw StoreError('ROUND_COMPLETE', 'Everyone has had a turn.');
      }
      const chosen = pool[randInt(pool.length)];
      if (noRepeats) r.picked.push(chosen.id);
      r.lastPickedId = chosen.id;
      await req(S(t, 'rounds').put(r));
      return {
        student: chosen, noRepeats: noRepeats, pickedCount: noRepeats ? r.picked.length : 0, total: active.length,
        roundComplete: noRepeats && r.picked.length >= active.length,
        others: active.map(function (s) { return s.name; })
      };
    });
  }

  /* ---------- backup & restore ---------- */
  function exportBackup() {
    return run(['meta'].concat(BACKUP_STORES), 'readonly', async function (t) {
      const data = { settings: await getSettingsIn(t) };
      for (const name of BACKUP_STORES) data[name] = await req(S(t, name).getAll());
      return { app: 'magic-picker', format: 1, exportedAt: now(), note: 'Magic Picker backup. Local data only.', data: data };
    });
  }

  function validateBackup(obj) {
    const errors = [];
    const err = function (m) { if (errors.length < 12) errors.push(m); };
    const isStr = function (v) { return typeof v === 'string' && v.length > 0; };
    if (!obj || typeof obj !== 'object') return { ok: false, errors: ['This file is not a Magic Picker backup.'] };
    if (obj.app !== 'magic-picker') err('This file is not a Magic Picker backup.');
    if (obj.format !== 1) err('Unknown backup format version.');
    const d = obj.data;
    if (!d || typeof d !== 'object') { err('The backup has no data section.'); return { ok: false, errors: errors }; }
    const st = d.settings;
    if (!st || st.key !== 'settings' || !isInt(st.starsPerCard) || st.starsPerCard < 1 || st.starsPerCard > 100) err('Settings are missing or invalid.');
    for (const name of BACKUP_STORES) if (!Array.isArray(d[name])) err('Missing list: ' + name + '.');
    if (errors.length) return { ok: false, errors: errors };

    const classIds = new Set(), studentIds = new Set(), ownedIds = new Set(), txIds = new Set(), pairs = new Set();
    d.classes.forEach(function (c, i) {
      if (!c || !isStr(c.id) || !isStr(c.name)) err('Class #' + (i + 1) + ' is invalid.');
      else if (classIds.has(c.id)) err('Duplicate class ID.');
      else classIds.add(c.id);
    });
    const students = {};
    d.students.forEach(function (s, i) {
      if (!s || !isStr(s.id) || !isStr(s.name) || !isStr(s.classId)) { err('Student #' + (i + 1) + ' is invalid.'); return; }
      if (studentIds.has(s.id)) err('Duplicate student ID.');
      studentIds.add(s.id); students[s.id] = s;
      if (!classIds.has(s.classId)) err('Student "' + s.name + '" belongs to a missing class.');
      if (!isInt(s.balance) || s.balance < 0) err('Student "' + s.name + '" has an invalid star balance.');
      if (!isInt(s.totalEarned) || s.totalEarned < 0) err('Student "' + s.name + '" has an invalid star total.');
      if (isInt(s.balance) && isInt(s.totalEarned) && s.balance > s.totalEarned) err('Student "' + s.name + '" has more stars to spend than stars earned.');
      if (!isStr(s.createdAt)) err('Student "' + s.name + '" has no creation date.');
    });
    d.owned.forEach(function (o, i) {
      if (!o || !isStr(o.id) || !isStr(o.studentId) || !isStr(o.cardId) || !isStr(o.earnedAt)) { err('Card record #' + (i + 1) + ' is invalid.'); return; }
      if (ownedIds.has(o.id)) err('Duplicate card record ID.');
      ownedIds.add(o.id);
      if (!studentIds.has(o.studentId)) err('A card belongs to a missing student.');
      if (!MP.CARD_BY_ID[o.cardId]) err('Unknown card ID: ' + String(o.cardId).slice(0, 20) + '.');
      const k = o.studentId + '|' + o.cardId;
      if (pairs.has(k)) err('The same card appears twice for one student.');
      pairs.add(k);
    });
    d.txs.forEach(function (x, i) {
      if (!x || !isStr(x.id) || TX_TYPES.indexOf(x.type) < 0 || !isStr(x.studentId) || !isStr(x.createdAt)) { err('History entry #' + (i + 1) + ' is invalid.'); return; }
      if (txIds.has(x.id)) err('Duplicate history ID.');
      txIds.add(x.id);
      if (!studentIds.has(x.studentId)) err('A history entry belongs to a missing student.');
      if (x.type === 'stars' && (!isInt(x.amount) || x.amount < 1)) err('A star entry has an invalid amount.');
      if (x.type === 'card' && (!MP.CARD_BY_ID[x.cardId] || !isInt(x.cost) || x.cost < 1)) err('A card entry is invalid.');
      if (x.type === 'card' && !x.undone && !ownedIds.has(x.ownedId)) err('A card entry points to a missing card.');
    });
    d.rounds.forEach(function (r) {
      if (!r || !isStr(r.classId) || !Array.isArray(r.picked)) err('Picker round data is invalid.');
    });
    return {
      ok: errors.length === 0, errors: errors,
      summary: { classes: d.classes.length, students: d.students.length, cards: d.owned.length, history: d.txs.length, exportedAt: obj.exportedAt }
    };
  }

  /* Replaces ALL data in one transaction. If anything fails, the current data stays untouched. */
  function restoreBackup(obj) {
    const v = validateBackup(obj);
    if (!v.ok) return Promise.reject(Object.assign(StoreError('INVALID_BACKUP', 'The backup file is not valid.'), { details: v.errors }));
    return run(ALL_STORES, 'readwrite', async function (t) {
      for (const name of ALL_STORES) await req(S(t, name).clear());
      await req(S(t, 'meta').add(Object.assign({}, obj.data.settings, { key: 'settings' })));
      for (const name of BACKUP_STORES) {
        for (const row of obj.data[name]) await req(S(t, name).add(row));
      }
      const maxSeq = obj.data.txs.reduce(function (m, x) { return Math.max(m, isInt(x.seq) ? x.seq : 0); }, 0);
      await req(S(t, 'meta').put({ key: 'seq', value: maxSeq }));
      return v.summary;
    });
  }

  function resetAll() {
    return run(ALL_STORES, 'readwrite', async function (t) {
      for (const name of ALL_STORES) await req(S(t, name).clear());
    }).then(init);
  }

  /* ---------- built-in class lists (js/roster.js) ---------- */
  /*
   * Applied once per device and roster version. Names only go into classes that have no students
   * yet, so nothing a teacher has added, edited, archived or deleted is ever overwritten.
   */
  function applyRoster(roster, version) {
    if (!roster) return Promise.resolve({ added: 0 });
    return run(['meta', 'classes', 'students'], 'readwrite', async function (t) {
      const mark = await req(S(t, 'meta').get('roster'));
      if (mark && mark.version >= version) return { added: 0, skipped: true };
      const classes = await req(S(t, 'classes').getAll());
      let added = 0;
      for (const name of Object.keys(roster)) {
        let c = classes.find(function (x) { return x.name.toLowerCase() === name.toLowerCase(); });
        if (!c) {
          c = { id: uuid(), name: name, archived: false, isDemo: false, order: classes.length, createdAt: now() };
          await req(S(t, 'classes').add(c));
          classes.push(c);
        }
        if (await req(S(t, 'students').index('classId').count(c.id))) continue;
        for (const studentName of roster[name]) {
          const clean = cleanName(studentName);
          if (!clean) continue;
          await req(S(t, 'students').add({
            id: uuid(), classId: c.id, name: clean, archived: false, isDemo: false,
            totalEarned: 0, balance: 0, createdAt: new Date(Date.now() + added).toISOString()
          }));
          added++;
        }
      }
      await req(S(t, 'meta').put({ key: 'roster', version: version, appliedAt: now(), added: added }));
      return { added: added };
    });
  }

  /* ---------- demo data (clearly labelled, removable) ---------- */
  async function loadDemo() {
    const existing = (await listClasses({ includeArchived: true })).find(function (c) { return c.isDemo; });
    if (existing) throw StoreError('DEMO_EXISTS', 'Demo data is already loaded.');
    const c = await createClass('DEMO', { isDemo: true });
    const names = ['Demo Student 1', 'Demo Student 2', 'Demo Student 3', 'Demo Student 4', 'Demo Twin', 'Demo Twin'];
    const created = await addStudents(c.id, names, { isDemo: true });
    await awardStars([created[0].id], 12);
    await awardStars([created[1].id], 4);
    await awardStars([created[2].id, created[3].id], 7);
    await buyCard(created[0].id, 'adv-02');
    await buyCard(created[2].id, 'won-07');
    return c;
  }

  async function removeDemo() {
    const demos = (await listClasses({ includeArchived: true })).filter(function (c) { return c.isDemo; });
    for (const c of demos) await deleteClass(c.id);
    return demos.length;
  }

  /* ---------- misc ---------- */
  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const already = await navigator.storage.persisted();
        if (already) return true;
        return await navigator.storage.persist();
      }
    } catch (_) { /* not supported */ }
    return false;
  }

  function useDatabase(name) {
    if (dbPromise) dbPromise.then(function (db) { db.close(); }).catch(function () {});
    dbPromise = null;
    dbName = name;
  }

  /* Closes the connection; the next call opens it again (used by tests to simulate a reload). */
  async function close() {
    if (dbPromise) { const db = await dbPromise; db.close(); dbPromise = null; }
  }

  MP.store = {
    init, getSettings, updateSettings,
    listClasses, getClass, createClass, renameClass, setClassArchived, deleteClass,
    listStudents, getStudent, addStudents, renameStudent, setStudentArchived, moveStudent, resetStudent, deleteStudent,
    awardStars, buyCard, surpriseCard, getOwned,
    peekUndo, undoLast, listTxs,
    getRound, setNoRepeats, newRound, pickStudent,
    exportBackup, validateBackup, restoreBackup, resetAll,
    applyRoster, loadDemo, removeDemo, requestPersistence, useDatabase, close,
    uuid, randInt
  };
})();
