/* Scenario tests for the data layer. Open tests.html (served) to run them. */
(async function () {
  const st = MP.store;
  const out = document.getElementById('out');
  const results = [];

  function log(ok, name, detail) {
    results.push(ok);
    const li = document.createElement('li');
    li.className = ok ? 'pass' : 'fail';
    li.textContent = (ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' — ' + detail : '');
    out.appendChild(li);
  }
  async function test(name, fn) {
    try { const d = await fn(); log(true, name, d); }
    catch (e) { log(false, name, (e && (e.code || e.message)) || String(e)); console.error(name, e); }
  }
  function expect(cond, msg) { if (!cond) throw new Error(msg || 'expectation failed'); }
  async function expectFail(promise, code) {
    try { await promise; } catch (e) { if (code && e.code !== code) throw new Error('expected ' + code + ', got ' + (e.code || e.message)); return e; }
    throw new Error('expected failure ' + (code || ''));
  }

  await new Promise(function (resolve) {
    const r = indexedDB.deleteDatabase('magic-picker-test');
    r.onsuccess = r.onerror = r.onblocked = function () { resolve(); };
  });
  st.useDatabase('magic-picker-test');
  await st.init();
  const classes = await st.listClasses();
  const byName = {}; classes.forEach(function (c) { byName[c.name] = c; });

  await test('Seven default classes exist (J5A … J6E)', async function () {
    expect(['J5A', 'J5B', 'J6A', 'J6B', 'J6C', 'J6D', 'J6E'].every(function (n) { return byName[n]; }), 'missing class');
    expect(classes.length === 7, 'count ' + classes.length);
    return classes.map(function (c) { return c.name; }).join(', ');
  });

  let ali5A, ali5B;
  await test('J5A data does not leak into other classes', async function () {
    ali5A = (await st.addStudents(byName.J5A.id, ['Test Ali']))[0];
    ali5B = (await st.addStudents(byName.J5B.id, ['Test Ali']))[0];
    await st.awardStars([ali5A.id], 6);
    await st.buyCard(ali5A.id, 'adv-01');
    const b = await st.listStudents(byName.J5B.id);
    expect(b.length === 1 && b[0].id === ali5B.id, 'J5B list wrong');
    expect(b[0].balance === 0 && b[0].totalEarned === 0, 'J5B student got stars');
    expect(Object.keys(await st.getOwned(ali5B.id)).length === 0, 'J5B student got a card');
    for (const c of classes) if (c.name !== 'J5A') {
      const list = await st.listStudents(c.id);
      expect(!list.some(function (s) { return s.id === ali5A.id; }), 'J5A student visible in ' + c.name);
      const hist = await st.listTxs({ classId: c.id });
      expect(!hist.some(function (x) { return x.studentId === ali5A.id; }), 'J5A history visible in ' + c.name);
    }
    return 'J5A balance 1, J5B untouched';
  });

  await test('Two students with the same name stay separate', async function () {
    const twins = await st.addStudents(byName.J6A.id, ['Mia', 'Mia']);
    expect(twins[0].id !== twins[1].id, 'same id');
    await st.awardStars([twins[0].id], 5);
    await st.buyCard(twins[0].id, 'won-02');
    const a = await st.getStudent(twins[0].id), b = await st.getStudent(twins[1].id);
    expect(a.balance === 0 && a.totalEarned === 5, 'first twin wrong');
    expect(b.balance === 0 && b.totalEarned === 0, 'second twin changed');
    expect(Object.keys(await st.getOwned(twins[1].id)).length === 0, 'second twin got card');
    return 'ids ' + a.id.slice(0, 8) + ' / ' + b.id.slice(0, 8);
  });

  let s12;
  await test('12 stars, two cards → balance 2, total earned 12', async function () {
    s12 = (await st.addStudents(byName.J6B.id, ['Twelve']))[0];
    await st.awardStars([s12.id], 12);
    let s = await st.getStudent(s12.id);
    expect(s.totalEarned === 12 && s.balance === 12, 'after award');
    await st.buyCard(s12.id, 'adv-03');
    s = await st.getStudent(s12.id);
    expect(s.totalEarned === 12 && s.balance === 7, 'after first card: ' + s.balance);
    await st.buyCard(s12.id, 'won-04');
    s = await st.getStudent(s12.id);
    expect(s.totalEarned === 12 && s.balance === 2, 'after second card: ' + s.balance);
    return 'total 12, balance 12 → 7 → 2';
  });

  await test('Not enough stars → no card, nothing changes', async function () {
    const before = await st.listTxs({ studentId: s12.id });
    await expectFail(st.buyCard(s12.id, 'adv-10'), 'NOT_ENOUGH_STARS');
    await expectFail(st.surpriseCard(s12.id, 'wonder'), 'NOT_ENOUGH_STARS');
    const s = await st.getStudent(s12.id);
    const after = await st.listTxs({ studentId: s12.id });
    expect(s.balance === 2, 'balance changed');
    expect(after.length === before.length, 'history changed');
    expect(!(await st.getOwned(s12.id))['adv-10'], 'card stored');
    return 'balance stays 2';
  });

  await test('Double tap (same request) spends stars only once', async function () {
    const s = (await st.addStudents(byName.J6C.id, ['Double']))[0];
    await st.awardStars([s.id], 10);
    const rid = st.uuid();
    const r = await Promise.allSettled([st.buyCard(s.id, 'adv-05', { requestId: rid }), st.buyCard(s.id, 'adv-05', { requestId: rid })]);
    const ok = r.filter(function (x) { return x.status === 'fulfilled'; }).length;
    const after = await st.getStudent(s.id);
    expect(ok === 1, ok + ' succeeded');
    expect(after.balance === 5, 'balance ' + after.balance);
    return 'one success, balance 10 → 5';
  });

  await test('Two quick taps on different cards with stars for one card → only one card', async function () {
    const s = (await st.addStudents(byName.J6C.id, ['Quick']))[0];
    await st.awardStars([s.id], 5);
    const r = await Promise.allSettled([
      st.buyCard(s.id, 'adv-06', { requestId: st.uuid() }),
      st.buyCard(s.id, 'adv-07', { requestId: st.uuid() })
    ]);
    const ok = r.filter(function (x) { return x.status === 'fulfilled'; }).length;
    const after = await st.getStudent(s.id);
    expect(ok === 1 && after.balance === 0, ok + ' ok, balance ' + after.balance);
    expect(Object.keys(await st.getOwned(s.id)).length === 1, 'card count');
    return 'balance never below 0';
  });

  await test('The same card cannot be won twice', async function () {
    const s = (await st.addStudents(byName.J6D.id, ['Same Card']))[0];
    await st.awardStars([s.id], 10);
    await st.buyCard(s.id, 'won-09');
    await expectFail(st.buyCard(s.id, 'won-09'), 'ALREADY_OWNED');
    const after = await st.getStudent(s.id);
    expect(after.balance === 5, 'balance ' + after.balance);
    return 'second attempt rejected, stars kept';
  });

  await test('Surprise Me only gives cards not owned yet; complete collection is reported', async function () {
    const s = (await st.addStudents(byName.J6D.id, ['Surprise']))[0];
    await st.awardStars([s.id], 100);
    await st.awardStars([s.id], 5);
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      const r = await st.surpriseCard(s.id, 'adventure');
      expect(!seen.has(r.cardId), 'repeat ' + r.cardId);
      expect(r.card.collection === 'adventure', 'wrong collection');
      seen.add(r.cardId);
    }
    await expectFail(st.surpriseCard(s.id, 'adventure'), 'COLLECTION_COMPLETE');
    const after = await st.getStudent(s.id);
    expect(after.balance === 5, 'balance ' + after.balance);
    return '20 different cards, then "complete"; stars kept';
  });

  await test('Data survives closing and reopening the database (reload)', async function () {
    await st.close();
    const s = await st.getStudent(s12.id);
    const owned = await st.getOwned(s12.id);
    expect(s.balance === 2 && s.totalEarned === 12, 'stars lost');
    expect(owned['adv-03'] && owned['won-04'], 'album lost');
    return 'balance 2, 2 cards';
  });

  await test('Undo restores card and stars together; undo of stars lowers both values', async function () {
    const c = byName.J6E;
    const s = (await st.addStudents(c.id, ['Undo']))[0];
    await st.awardStars([s.id], 3);
    await st.awardStars([s.id], 4);
    await st.buyCard(s.id, 'adv-11');
    let peek = await st.peekUndo(c.id);
    expect(peek[0].tx.type === 'card', 'peek should be card');
    await st.undoLast(c.id);
    let x = await st.getStudent(s.id);
    expect(x.balance === 7 && x.totalEarned === 7, 'after card undo ' + x.balance);
    expect(!(await st.getOwned(s.id))['adv-11'], 'card still in album');
    await st.undoLast(c.id);
    x = await st.getStudent(s.id);
    expect(x.balance === 3 && x.totalEarned === 3, 'after star undo ' + x.balance);
    await st.buyCard(s.id, 'adv-11').then(function () { throw new Error('should fail'); }, function (e) { expect(e.code === 'NOT_ENOUGH_STARS'); });
    return 'card removed, 5 stars back; then +4 removed';
  });

  await test('Undo goes back step by step in the right order; balance never below 0', async function () {
    const c = byName.J6E;
    const a = (await st.addStudents(c.id, ['Spender']))[0];
    await st.awardStars([a.id], 5);
    await st.buyCard(a.id, 'won-01');
    const hist = await st.listTxs({ studentId: a.id });
    expect(hist.some(function (h) { return h.type === 'card'; }), 'card tx');
    await st.undoLast(c.id); // undoes card
    await st.undoLast(c.id); // undoes stars
    const x = await st.getStudent(a.id);
    expect(x.balance === 0 && x.totalEarned === 0 && x.balance >= 0, 'balance ' + x.balance);
    return 'card then stars undone in order, balance 0';
  });

  await test('Bulk stars to selected students, undone as one action', async function () {
    const c = byName.J5B;
    const list = await st.addStudents(c.id, ['Bulk A', 'Bulk B', 'Bulk C']);
    await st.awardStars(list.slice(0, 2).map(function (s) { return s.id; }), 2);
    const a = await st.getStudent(list[0].id), b = await st.getStudent(list[1].id), cc = await st.getStudent(list[2].id);
    expect(a.balance === 2 && b.balance === 2 && cc.balance === 0, 'bulk award');
    const peek = await st.peekUndo(c.id);
    expect(peek.length === 2, 'batch size ' + peek.length);
    await st.undoLast(c.id);
    expect((await st.getStudent(list[0].id)).balance === 0 && (await st.getStudent(list[1].id)).balance === 0, 'bulk undo');
    return '2 students +2, undone together';
  });

  await test('Changing stars-per-card affects only new purchases', async function () {
    const c = byName.J5A;
    const s = (await st.addStudents(c.id, ['Threshold']))[0];
    await st.awardStars([s.id], 8);
    await st.buyCard(s.id, 'adv-12');            // costs 5
    await st.updateSettings({ starsPerCard: 3 });
    await st.buyCard(s.id, 'adv-13');            // costs 3
    let x = await st.getStudent(s.id);
    expect(x.balance === 0 && x.totalEarned === 8, 'balance ' + x.balance);
    const hist = await st.listTxs({ studentId: s.id });
    const costs = hist.filter(function (h) { return h.type === 'card'; }).map(function (h) { return h.cost; }).sort();
    expect(costs.join(',') === '3,5', 'costs ' + costs);
    await st.undoLast(c.id);                      // returns 3
    x = await st.getStudent(s.id);
    expect(x.balance === 3, 'after undo ' + x.balance);
    await st.updateSettings({ starsPerCard: 5 });
    return 'old card kept cost 5, new card cost 3';
  });

  await test('Pick a Student with "No repeats" never repeats within a round', async function () {
    const c = await st.createClass('PickTest');
    const list = await st.addStudents(c.id, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
    await st.setNoRepeats(c.id, true);
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      const r = await st.pickStudent(c.id);
      expect(!seen.has(r.student.id), 'repeat in round');
      seen.add(r.student.id);
    }
    await expectFail(st.pickStudent(c.id), 'ROUND_COMPLETE');
    const s = await st.getStudent(list[0].id);
    expect(s.balance === 0 && s.totalEarned === 0, 'picking changed stars');
    await st.newRound(c.id);
    const again = await st.pickStudent(c.id);
    expect(!!again.student, 'new round');
    await st.setStudentArchived(list[1].id, true);
    const round = await st.getRound(c.id);
    expect(round.total === 5, 'archived still counted');
    return '6 unique picks, round complete, new round works, archived excluded';
  });

  await test('Moving a student takes stars and cards along', async function () {
    const s = (await st.addStudents(byName.J5A.id, ['Mover']))[0];
    await st.awardStars([s.id], 5);
    await st.buyCard(s.id, 'won-12');
    await st.moveStudent(s.id, byName.J5B.id);
    const inB = await st.listStudents(byName.J5B.id);
    const inA = await st.listStudents(byName.J5A.id);
    expect(inB.some(function (x) { return x.id === s.id; }) && !inA.some(function (x) { return x.id === s.id; }), 'not moved');
    expect((await st.getOwned(s.id))['won-12'], 'card lost');
    return 'J5A → J5B with card';
  });

  let backup;
  await test('Backup → reset → restore gives identical data', async function () {
    backup = await st.exportBackup();
    const v = st.validateBackup(JSON.parse(JSON.stringify(backup)));
    expect(v.ok, v.errors.join('; '));
    await st.resetAll();
    expect((await st.getStudent(s12.id)) === undefined, 'reset did not clear');
    await st.restoreBackup(JSON.parse(JSON.stringify(backup)));
    const again = await st.exportBackup();
    const strip = function (b) { const d = JSON.parse(JSON.stringify(b.data)); for (const k in d) if (Array.isArray(d[k])) d[k].sort(function (a, b) { return String(a.id || a.classId).localeCompare(String(b.id || b.classId)); }); return JSON.stringify(d); };
    expect(strip(again) === strip(backup), 'data differs after restore');
    return v.summary.students + ' students, ' + v.summary.cards + ' cards restored';
  });

  await test('A broken backup is rejected and current data stays unchanged', async function () {
    const before = JSON.stringify((await st.exportBackup()).data.students.length);
    const bad1 = JSON.parse(JSON.stringify(backup)); bad1.data.owned[0].cardId = 'xyz-99';
    const bad2 = JSON.parse(JSON.stringify(backup)); bad2.data.students[0].balance = -3;
    const bad3 = { app: 'something-else', data: {} };
    const bad4 = JSON.parse(JSON.stringify(backup)); bad4.data.students.push(JSON.parse(JSON.stringify(bad4.data.students[0])));
    for (const b of [bad1, bad2, bad3, bad4]) {
      expect(!st.validateBackup(b).ok, 'validation passed for a bad file');
      await expectFail(st.restoreBackup(b), 'INVALID_BACKUP');
    }
    const s = await st.getStudent(s12.id);
    expect(s && s.balance === 2, 'data changed');
    expect(JSON.stringify((await st.exportBackup()).data.students.length) === before, 'student count changed');
    return '4 kinds of broken files rejected';
  });

  await test('Reset of one student clears only that student', async function () {
    const s = await st.getStudent(s12.id);
    await st.resetStudent(s.id);
    const x = await st.getStudent(s.id);
    expect(x.balance === 0 && x.totalEarned === 0, 'not reset');
    expect(Object.keys(await st.getOwned(s.id)).length === 0, 'cards remain');
    const other = await st.getStudent(ali5A.id);
    expect(other.totalEarned === 6, 'other student touched');
    return 'ok';
  });

  await test('Demo data is labelled and fully removable', async function () {
    const demo = await st.loadDemo();
    expect(demo.isDemo && demo.name === 'DEMO', 'demo class');
    const list = await st.listStudents(demo.id);
    expect(list.length === 6 && list.every(function (s) { return s.isDemo && s.name.indexOf('Demo') === 0; }), 'demo students');
    await st.removeDemo();
    expect(!(await st.listClasses({ includeArchived: true })).some(function (c) { return c.isDemo; }), 'demo left');
    return '6 demo students created and removed';
  });

  const failed = results.filter(function (r) { return !r; }).length;
  const sum = document.getElementById('summary');
  sum.textContent = failed ? (failed + ' of ' + results.length + ' tests FAILED') : ('All ' + results.length + ' tests passed');
  sum.className = failed ? 'fail' : 'pass';
  window.TEST_RESULT = { total: results.length, failed: failed };
  await st.close();
})();
