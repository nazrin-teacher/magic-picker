/* Magic Picker – child-facing screens (English UI), routing and the on-screen album. */
window.MP = window.MP || {};

(function () {
  const ui = MP.ui, h = ui.h, icon = ui.icon, st = MP.store;
  const state = { settings: null, teacher: false, classId: null, persisted: false, albumView: {} };
  let renderTok = 0;
  const screen = function () { return document.getElementById('screen'); };

  /* ---------- boot ---------- */
  async function boot() {
    try {
      await st.init();
      try { await st.applyRoster(MP.CLASS_ROSTER, MP.ROSTER_VERSION); } catch (e) { console.error('Class lists could not be loaded', e); }
      try { await st.ensureSymbols(); } catch (e) { console.error('Picture symbols could not be assigned', e); }
      state.settings = await st.getSettings();
    } catch (e) {
      console.error(e);
      screen().replaceChildren(h('div', { class: 'panel empty-state' },
        h('h2', null, 'Magic Picker cannot save here'),
        h('p', null, 'This browser blocked local storage (IndexedDB). Private / incognito windows and some strict privacy settings do this. Please open the app in a normal browser window.'),
        h('p', { style: { fontSize: '1rem', color: '#5b507c' } }, String(e && e.message || e))));
      return;
    }
    applySettings();
    st.requestPersistence().then(function (p) { state.persisted = p; });
    document.getElementById('soundBtn').addEventListener('click', toggleSound);
    document.getElementById('teacherBtn').addEventListener('click', function () { MP.teacher.open(); });
    document.getElementById('lockBtn').addEventListener('click', function () { setTeacher(false); ui.toast('Teacher tools locked.'); });
    document.querySelector('.brand').addEventListener('click', function () { go('#/'); });
    ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, function () { state.lastActivity = Date.now(); }, true); });
    state.lastActivity = Date.now();
    setInterval(autoLock, 30000);
    window.addEventListener('hashchange', route);
    let rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (/^#\/album\//.test(location.hash)) route(); }, 250);
    });
    if (window.matchMedia) {
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      if (mq.addEventListener) mq.addEventListener('change', applySettings);
    }
    route();
  }

  function applySettings() {
    const s = state.settings;
    MP.sound.setEnabled(s.sound);
    const sysReduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const reduce = s.motion === 'reduce' || (s.motion === 'system' && sysReduce);
    document.documentElement.classList.toggle('reduce-motion', reduce);
    const b = document.getElementById('soundBtn');
    b.replaceChildren(icon(s.sound ? 'soundOn' : 'soundOff'), s.sound ? 'Sound on' : 'Sound off');
    b.setAttribute('aria-pressed', s.sound ? 'true' : 'false');
  }

  async function toggleSound() {
    try {
      state.settings = await st.updateSettings({ sound: !state.settings.sound });
      applySettings();
      MP.sound.play('tap');
    } catch (e) { ui.toast('Could not save the sound setting.', 'error'); }
  }

  function setTeacher(on) {
    state.teacher = !!on;
    document.getElementById('lockBtn').hidden = !state.teacher;
    document.getElementById('teacherBtn').classList.toggle('is-teacher', state.teacher);
    route();
  }

  function autoLock() {
    if (state.teacher && state.settings.pin && Date.now() - state.lastActivity > 20 * 60 * 1000) {
      setTeacher(false);
      MP.teacher.close();
    }
  }

  async function refreshSettings() {
    state.settings = await st.getSettings();
    applySettings();
  }

  /* ---------- routing ---------- */
  function go(hash) {
    if (location.hash === hash) route(); else location.hash = hash;
  }

  async function route() {
    const tok = ++renderTok;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    document.body.classList.remove('print-mode');
    const pageSize = document.getElementById('print-page-size');
    if (pageSize && parts[0] !== 'print') pageSize.textContent = '';
    document.getElementById('print-root').replaceChildren();
    try {
      switch (parts[0]) {
        case 'class': await renderClass(tok, parts[1]); break;
        case 'student': await renderStudent(tok, parts[1]); break;
        case 'pick': await renderPick(tok, parts[1]); break;
        case 'choose': await renderChoose(tok, parts[1], parts[2]); break;
        case 'album': await renderAlbum(tok, parts[1]); break;
        case 'print': await MP.print.render(parts.slice(1)); break;
        default: await renderHome(tok);
      }
    } catch (e) {
      console.error(e);
      if (tok === renderTok) {
        mount(tok, h('div', { class: 'panel empty-state' },
          h('h2', null, 'Something went wrong'),
          h('p', null, 'Nothing was changed. Please go back and try again.'),
          h('button', { class: 'btn btn-gold', onclick: function () { go('#/'); } }, 'Back to classes')));
      }
    }
  }

  function mount(tok, node) {
    if (tok !== renderTok) return false;
    const s = screen();
    s.replaceChildren(node);
    window.scrollTo(0, 0);
    s.focus({ preventScroll: true });
    return true;
  }

  async function setClassChip(cls) {
    state.classId = cls ? cls.id : null;
    const chip = document.getElementById('classChip');
    chip.hidden = !cls;
    if (cls) {
      chip.textContent = cls.isDemo ? cls.name + ' · demo data' : cls.name;
      chip.className = 'class-chip' + (cls.isDemo ? ' demo-chip' : '');
    }
  }

  /* What the speech voice says: the given names only ("Hasan Tarık Ö." -> "Hasan Tarık"). */
  function spokenName(name) {
    const words = String(name).split(/\s+/).filter(function (w) { return w && !/\.$/.test(w); });
    return words.length ? words.join(' ') : String(name);
  }

  function backBtn(label, hash) {
    return h('button', { class: 'btn btn-pearl btn-small', onclick: function () { go(hash); } }, icon('back'), label);
  }

  /* ---------- home: classes ---------- */
  async function renderHome(tok) {
    setClassChip(null);
    const classes = await st.listClasses();
    const counts = {};
    for (const c of classes) counts[c.id] = (await st.listStudents(c.id)).length;
    mount(tok, h('div', null,
      h('div', { class: 'plaque' },
        h('div', { class: 'plaque-ribbon' }, h('h1', { class: 'plaque-title' }, 'Magic Picker')),
        h('p', { class: 'plaque-sub' }, 'Choose your class')),
      classes.length ? h('div', { class: 'class-grid' }, classes.map(function (c) {
        return h('button', { class: 'class-tile' + (c.isDemo ? ' demo' : ''), onclick: function () { MP.sound.play('tap'); go('#/class/' + c.id); } },
          h('span', { class: 'name' }, c.name),
          h('span', { class: 'meta' }, c.isDemo ? 'Demo data' : (counts[c.id] === 1 ? '1 student' : counts[c.id] + ' students')));
      })) : h('div', { class: 'panel empty-state' }, h('p', null, 'No classes yet. Open Teacher to add one.'))));
  }

  /* ---------- class ---------- */
  async function renderClass(tok, classId, keepMode) {
    const cls = await st.getClass(classId);
    if (!cls) { go('#/'); return; }
    setClassChip(cls);
    if (!keepMode) state.attendance = false;
    const marking = !!state.attendance;
    const students = await st.listStudents(classId);
    const away = new Set(await st.getAbsent(classId));
    const cost = state.settings.starsPerCard;

    const hereLine = h('p', { class: 'screen-sub here-line' });
    const updateHere = function () {
      const n = students.filter(function (s) { return !away.has(s.id); }).length;
      hereLine.textContent = away.size ? n + ' of ' + students.length + ' here today' : '';
      hereLine.hidden = !away.size;
    };
    updateHere();

    const attendBtn = students.length ? h('button', {
      class: 'btn btn-small ' + (marking ? 'btn-teal' : 'btn-pearl'), 'aria-pressed': marking ? 'true' : 'false',
      onclick: async function () {
        if (!marking && !(await MP.teacher.requireTeacher())) return;
        state.attendance = !marking;
        renderClass(++renderTok, classId, true);
      }
    }, marking ? 'Done' : 'Who’s here today?') : null;

    const head = h('div', { class: 'screen-head' },
      h('div', null, h('h1', { class: 'screen-title' }, cls.name),
        h('p', { class: 'screen-sub' }, marking ? 'Tap the children who are away today. Tap again when they are back.' : (students.length ? 'Tap your name, or let the magic pick!' : '')),
        hereLine),
      h('div', { class: 'class-actions' },
        backBtn('All classes', '#/'),
        attendBtn,
        students.length && !marking ? h('button', { class: 'btn btn-gold btn-xl', onclick: function () { go('#/pick/' + classId); } }, icon('star'), 'Pick a Student') : null));

    function tileBottom(s) {
      if (marking) return away.has(s.id) ? h('span', { class: 'away-chip' }, 'Away today') : h('span', { class: 'away-chip here' }, 'Here');
      if (away.has(s.id)) return h('span', { class: 'away-chip' }, 'Away today');
      return h('span', { class: 'star-badge' + (s.balance >= cost ? ' ready' : '') }, ui.starText(s.balance));
    }

    const body = students.length
      ? h('div', { class: 'student-grid' + (marking ? ' marking' : '') }, students.map(function (s) {
        const bottom = h('span', { class: 'tile-bottom' }, tileBottom(s));
        const tile = h('button', {
          class: 'student-tile' + (away.has(s.id) ? ' away' : ''), 'aria-pressed': marking ? String(!away.has(s.id)) : null,
          onclick: async function () {
            if (!marking) { MP.sound.play('tap'); go('#/student/' + s.id); return; }
            const nowAway = !away.has(s.id);
            try {
              await st.setAbsent(classId, s.id, nowAway);
              if (nowAway) away.add(s.id); else away.delete(s.id);
              MP.sound.play('tap');
              tile.classList.toggle('away', nowAway);
              tile.setAttribute('aria-pressed', String(!nowAway));
              bottom.replaceChildren(tileBottom(s));
              updateHere();
            } catch (e) { ui.toast('Could not save who is here today.', 'error'); }
          }
        },
          h('span', { class: 'tile-top' }, MP.symbolEl(s.symbol, 'sym-tile'), h('span', { class: 'name' }, s.name)),
          bottom);
        return tile;
      }))
      : h('div', { class: 'panel empty-state' },
        h('p', null, 'No students in ' + cls.name + ' yet.'),
        h('p', { style: { fontSize: '1.05rem' } }, 'Teacher: open Teacher tools to add names.'),
        h('button', { class: 'btn btn-teal', onclick: function () { MP.teacher.open(); } }, 'Teacher tools'));
    mount(tok, h('div', null, head, body));
  }

  /* ---------- awarding stars (teacher mode only) ---------- */
  const award = ui.once(async function (studentIds, amount, anchor) {
    try {
      const r = await st.awardStars(studentIds, amount, { requestId: st.uuid() });
      MP.sound.play('star');
      if (anchor) ui.floatStars(anchor, Math.min(amount, 5));
      const who = r.students.length === 1 ? r.students[0].name : r.students.length + ' students';
      ui.toast('+' + amount + (amount === 1 ? ' star for ' : ' stars for ') + who + '!', 'ok');
      return r;
    } catch (e) {
      MP.sound.play('error');
      ui.toast('Stars were not saved: ' + (e.message || e), 'error');
      throw e;
    }
  });

  function teacherStrip(studentId, after) {
    if (!state.teacher) return null;
    function give(n, btn) {
      award([studentId], n, btn).then(function () { if (after) after(n); }, function () {});
    }
    const btns = [1, 2, 3].map(function (n) {
      const b = h('button', { class: 'btn btn-teal btn-small star-btn', 'aria-label': 'Give ' + n + ' stars' }, '+' + n, icon('star'));
      b.onclick = function () { give(n, b); };
      return b;
    });
    const other = h('button', { class: 'btn btn-pearl btn-small' }, 'Other…');
    other.onclick = function () { askAmount().then(function (n) { if (n) give(n, other); }); };
    return h('div', { class: 'teacher-strip' }, h('p', { class: 'lbl' }, 'Teacher: give stars'), h('div', { class: 'row' }, btns, other));
  }

  function askAmount() {
    return new Promise(function (resolve) {
      let n = 5, done = false;
      const val = h('div', { style: { fontSize: '3rem', fontWeight: 700, minWidth: '90px', textAlign: 'center' }, 'aria-live': 'polite' }, String(n));
      const set = function (x) { n = Math.max(1, Math.min(100, x)); val.textContent = String(n); };
      const m = ui.modal(h('div', { class: 'center' },
        h('h2', null, 'How many stars?'),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          h('button', { class: 'btn btn-pearl', onclick: function () { set(n - 1); }, 'aria-label': 'One less' }, '−'),
          val,
          h('button', { class: 'btn btn-pearl', onclick: function () { set(n + 1); }, 'aria-label': 'One more' }, '+')),
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-pearl', onclick: function () { m.close(); } }, 'Cancel'),
          h('button', { class: 'btn btn-gold', onclick: function () { done = true; m.close(); resolve(n); } }, 'Give ', icon('star')))),
      { onClose: function () { if (!done) resolve(null); } });
    });
  }

  /* ---------- student ---------- */
  function meter(balance, cost, fresh) {
    if (cost > 15) {
      const pct = Math.min(100, Math.round((balance / cost) * 100));
      return h('div', null, h('div', { class: 'round-bar', style: { height: '26px' } }, h('div', { style: { width: pct + '%', background: 'linear-gradient(90deg,#f0c45c,#ffe7a6)' } })),
        h('div', { class: 'round-info' }, Math.min(balance, cost) + ' / ' + cost));
    }
    const filled = Math.min(balance, cost);
    const slots = [];
    for (let i = 0; i < cost; i++) {
      const on = i < filled;
      slots.push(h('span', { class: 'slot' + (on ? ' on' : '') + (on && fresh && i >= filled - fresh ? ' fresh' : ''), html: ui.ICONS.starPlain }));
    }
    return h('div', { class: 'meter', role: 'img', 'aria-label': filled + ' of ' + cost + ' stars' }, slots);
  }

  function countOwned(owned) {
    const out = { adventure: 0, wonder: 0, total: 0 };
    Object.keys(owned).forEach(function (id) { const c = MP.CARD_BY_ID[id]; if (c) { out[c.collection]++; out.total++; } });
    return out;
  }

  async function renderStudent(tok, sid, fresh) {
    const s = await st.getStudent(sid);
    if (!s) { go('#/'); return; }
    const cls = await st.getClass(s.classId);
    setClassChip(cls);
    const owned = await st.getOwned(sid);
    const counts = countOwned(owned);
    const cost = state.settings.starsPerCard;
    const can = Math.floor(s.balance / cost);
    const allDone = counts.total >= MP.CARDS.length;

    const hint = allDone
      ? h('p', { class: 'hint ready' }, 'Your Magic Collection is complete!')
      : can >= 1
        ? h('p', { class: 'hint ready' }, can === 1 ? 'You can choose a card!' : 'You can choose ' + can + ' cards!')
        : h('p', { class: 'hint' }, (cost - s.balance) + (cost - s.balance === 1 ? ' more star' : ' more stars') + ' for a card');

    const chooseBtn = h('button', {
      class: 'btn btn-gold btn-xl btn-block', 'aria-disabled': can < 1 || allDone ? 'true' : null,
      onclick: function () {
        if (can < 1 || allDone) { MP.sound.play('error'); ui.toast(allDone ? 'You already have every card!' : 'Keep going! You need ' + cost + ' stars for a card.'); return; }
        go('#/choose/' + sid);
      }
    }, 'Choose a Card');

    const recent = Object.values(owned).sort(function (a, b) { return b.earnedAt.localeCompare(a.earnedAt); }).slice(0, 3);
    const left = h('div', { class: 'panel' },
      h('div', { class: 'hero-row' }, MP.symbolEl(s.symbol, 'sym-hero'), h('h1', { class: 'hero-name' }, s.name)),
      h('div', { class: 'row hero-class' }, h('span', null, 'Class ' + (cls ? cls.name : '')),
        state.settings.sound && MP.sound.canSpeak() ? h('button', { class: 'btn btn-pearl btn-small', onclick: function () { MP.sound.speak(spokenName(s.name)); } }, icon('soundOn'), 'Hear my name') : null),
      h('div', { class: 'balance' },
        h('div', { class: 'big' }, icon('star'), String(s.balance)),
        h('div', { class: 'label' }, s.balance === 1 ? 'star to spend' : 'stars to spend', h('small', null, 'Total stars earned: ' + s.totalEarned))),
      allDone ? null : meter(can >= 1 ? cost : s.balance % cost, cost, fresh),
      hint,
      h('div', { class: 'stack' },
        chooseBtn,
        h('button', { class: 'btn btn-violet btn-xl btn-block', onclick: function () { go('#/album/' + sid); } }, 'My Collection')),
      teacherStrip(sid, function (n) { renderStudent(++renderTok, sid, n); }));

    const right = h('div', { class: 'panel' },
      h('h2', { style: { margin: '0 0 8px', color: 'var(--royal)', fontSize: '1.7rem' } }, 'My Magic Collection'),
      h('div', { class: 'progress-line' }, h('span', null, 'Adventure'), h('span', null, counts.adventure + ' / 20')),
      h('div', { class: 'progress-line' }, h('span', null, 'Wonder'), h('span', null, counts.wonder + ' / 20')),
      h('div', { class: 'progress-line' }, h('span', null, 'Total'), h('span', null, counts.total + ' / 40')),
      recent.length ? h('div', { class: 'card-grid', style: { marginTop: '16px', gridTemplateColumns: 'repeat(3, 1fr)' } },
        recent.map(function (o) { return ui.cardFrame(MP.CARD_BY_ID[o.cardId]); })) : null);

    mount(tok, h('div', null,
      h('div', { class: 'screen-head' }, backBtn('Back to ' + (cls ? cls.name : 'class'), '#/class/' + s.classId)),
      h('div', { class: 'student-layout' }, left, right)));
  }

  /* ---------- Pick a Student ---------- */
  async function renderPick(tok, classId) {
    const cls = await st.getClass(classId);
    if (!cls) { go('#/'); return; }
    setClassChip(cls);
    const round = await st.getRound(classId);
    const students = await st.listStudents(classId);
    let busy = false, picked = null;

    const backFace = h('div', { class: 'face back' }, h('img', { src: MP.CARD_BACK, alt: '' }));
    const shuffleName = h('div', { class: 'shuffle-name', 'aria-hidden': 'true' });
    backFace.appendChild(shuffleName);
    const symHolder = h('div', { class: 'pick-symbol' });
    const who = h('div', { class: 'who' });
    const tag = h('div', { class: 'tag' });
    const front = h('div', { class: 'face front' }, symHolder, who, tag);
    const flip = h('div', { class: 'flip' }, h('div', { class: 'glow' }), backFace, front);
    const live = h('div', { class: 'sr-only', 'aria-live': 'assertive', style: { position: 'absolute', left: '-9999px' } });
    const after = h('div', { class: 'stack', style: { marginTop: '16px', width: 'min(100%, 460px)' } });

    const info = h('div', { class: 'round-info' });
    const bar = h('div', null);
    const newRoundBtn = h('button', { class: 'btn btn-pearl btn-block' }, 'New Round');
    const pickBtn = h('button', { class: 'btn btn-gold btn-xl btn-block' }, icon('star'), 'Pick!');
    const toggleInput = h('input', { type: 'checkbox', checked: round.noRepeats ? true : null });
    const toggle = h('label', { class: 'toggle' }, toggleInput, h('span', { class: 'track' }), 'No repeats');

    function showRound(r) {
      const awayText = r.away ? ' · ' + r.away + ' away today' : '';
      if (r.noRepeats) {
        info.textContent = (r.roundComplete ? 'Everyone here has had a turn!' : 'Picked ' + r.pickedCount + ' of ' + r.total + (r.away ? ' here today' : ' this round')) + awayText;
        bar.replaceChildren(h('div', { class: 'round-bar' }, h('div', { style: { width: (r.total ? (r.pickedCount / r.total) * 100 : 0) + '%' } })));
      } else {
        info.textContent = 'Anyone here can be picked, even twice.' + awayText;
        bar.replaceChildren();
      }
      newRoundBtn.hidden = !r.noRepeats;
      newRoundBtn.className = 'btn btn-block ' + (r.roundComplete ? 'btn-teal' : 'btn-pearl');
    }
    showRound(round);

    toggleInput.addEventListener('change', async function () {
      try { await st.setNoRepeats(classId, toggleInput.checked); showRound(await st.getRound(classId)); }
      catch (e) { ui.toast('Could not save this setting.', 'error'); toggleInput.checked = !toggleInput.checked; }
    });
    newRoundBtn.addEventListener('click', async function () {
      if (busy) return;
      try {
        await st.newRound(classId);
        flip.classList.remove('flipped');
        after.replaceChildren();
        showRound(await st.getRound(classId));
        ui.toast('New round! Everyone here can be picked again.', 'ok');
      } catch (e) { ui.toast('Could not start a new round.', 'error'); }
    });

    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    const reduce = function () { return document.documentElement.classList.contains('reduce-motion'); };

    pickBtn.addEventListener('click', async function () {
      if (busy) return;
      busy = true; pickBtn.disabled = true;
      after.replaceChildren();
      let result = null, err = null;
      try { result = await st.pickStudent(classId); } catch (e) { err = e; }
      try {
        if (err) {
          flip.classList.add('flipped');
          symHolder.replaceChildren();
          who.textContent = err.code === 'ROUND_COMPLETE' ? 'Everyone has had a turn!' : (err.code === 'NO_STUDENTS' ? 'No students yet' : err.code === 'NO_ONE_HERE' ? 'Everyone is away today' : 'Try again');
          tag.textContent = err.code === 'ROUND_COMPLETE' ? 'Tap New Round to start again.' : '';
          MP.sound.play('error');
          showRound(await st.getRound(classId));
          return;
        }
        picked = result.student;
        if (!reduce()) {
          if (flip.classList.contains('flipped')) { flip.classList.remove('flipped'); await wait(450); }
          flip.classList.add('shaking');
          const names = result.others.length ? result.others : [picked.name];
          for (let i = 0; i < 14; i++) {
            shuffleName.textContent = names[Math.floor(Math.random() * names.length)];
            MP.sound.play('tick');
            await wait(55 + i * 6);
          }
          shuffleName.textContent = '';
          flip.classList.remove('shaking');
        }
        symHolder.replaceChildren(MP.symbolEl(picked.symbol, 'sym-pick'));
        who.textContent = picked.name;
        tag.textContent = 'It’s your turn!';
        flip.classList.add('flipped');
        live.textContent = picked.name + ' is picked';
        MP.sound.play('pick');
        const chosen = picked;
        setTimeout(function () { if (document.body.contains(flip)) MP.sound.speak(spokenName(chosen.name)); }, reduce() ? 150 : 650);
        showRound(result.noRepeats
          ? { noRepeats: true, pickedCount: result.pickedCount, total: result.total, away: result.away, roundComplete: result.roundComplete }
          : { noRepeats: false, away: result.away });
        after.replaceChildren(
          h('button', { class: 'btn btn-teal btn-block', onclick: function () { go('#/student/' + chosen.id); } }, 'Open ' + chosen.name + '’s page'),
          MP.sound.canSpeak() && state.settings.sound ? h('button', { class: 'btn btn-pearl btn-block', onclick: function () { MP.sound.speak(spokenName(chosen.name)); } }, icon('soundOn'), 'Say the name again') : null,
          teacherStrip(chosen.id));
      } finally {
        busy = false; pickBtn.disabled = false;
      }
    });

    const side = h('div', { class: 'panel stack' },
      h('h2', { style: { margin: 0, color: 'var(--royal)', fontSize: '2rem' } }, 'Pick a Student'),
      students.length ? null : h('p', null, 'There are no students in this class yet.'),
      pickBtn, toggle, h('div', null, info, bar), newRoundBtn);

    mount(tok, h('div', null,
      h('div', { class: 'screen-head' },
        h('div', null, h('h1', { class: 'screen-title' }, cls.name), h('p', { class: 'screen-sub' }, 'Picking only chooses who goes next. It does not give or use stars.')),
        backBtn('Back to ' + cls.name, '#/class/' + classId)),
      h('div', { class: 'picker-wrap' },
        h('div', { class: 'picker-stage' }, h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } }, flip, after), live),
        side)));
  }

  /* ---------- Choose a Card ---------- */
  const FAN = { adventure: ['adv-01', 'adv-14', 'adv-10'], wonder: ['won-02', 'won-07', 'won-03'] };

  async function renderChoose(tok, sid, colId) {
    const s = await st.getStudent(sid);
    if (!s) { go('#/'); return; }
    const cls = await st.getClass(s.classId);
    setClassChip(cls);
    const owned = await st.getOwned(sid);
    const counts = countOwned(owned);
    const cost = state.settings.starsPerCard;
    const balanceBadge = h('span', { class: 'star-badge', style: { fontSize: '1.5rem', padding: '8px 18px' } }, ui.starText(s.balance));
    if (colId && !MP.COLLECTIONS.some(function (c) { return c.id === colId; })) colId = null;

    const notEnough = function () {
      return h('div', { class: 'panel empty-state' },
        h('h2', { style: { color: 'var(--royal)' } }, 'Almost there!'),
        h('p', null, 'You need ' + (cost - s.balance) + ' more ' + (cost - s.balance === 1 ? 'star' : 'stars') + ' to choose a card.'),
        meter(s.balance, cost),
        h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '14px' } },
          h('button', { class: 'btn btn-violet', onclick: function () { go('#/album/' + sid); } }, 'My Collection'),
          h('button', { class: 'btn btn-pearl', onclick: function () { go('#/student/' + sid); } }, 'Back')));
    };

    if (!colId) {
      const body = s.balance < cost ? notEnough() : h('div', { class: 'collection-pick' }, MP.COLLECTIONS.map(function (col) {
        const done = counts[col.id] >= col.size;
        return h('button', { class: 'collection-tile', onclick: function () { MP.sound.play('tap'); go('#/choose/' + sid + '/' + col.id); } },
          h('div', { class: 'fan' }, FAN[col.id].map(function (id) { return ui.cardFrame(MP.CARD_BY_ID[id]); })),
          h('div', { class: 'cname' }, col.name),
          h('div', { class: 'cprog' }, counts[col.id] + ' / ' + col.size),
          done ? h('span', { class: 'complete-ribbon' }, 'Complete!') : null);
      }));
      mount(tok, h('div', null,
        h('div', { class: 'screen-head' },
          h('div', null, h('h1', { class: 'screen-title' }, 'Choose a Card'), h('p', { class: 'screen-sub' }, s.name + ', pick a collection')),
          h('div', { class: 'row' }, balanceBadge, backBtn('Back', '#/student/' + sid))),
        body));
      return;
    }

    const col = MP.COLLECTIONS.find(function (c) { return c.id === colId; });
    const cards = MP.cardsIn(colId);
    const complete = counts[colId] >= col.size;
    const head = h('div', { class: 'screen-head' },
      h('div', null, h('h1', { class: 'screen-title' }, col.name),
        h('p', { class: 'screen-sub' }, complete ? 'Collection complete!' : s.name + ', tap the card you want. Each card uses ' + cost + ' stars.')),
      h('div', { class: 'row' }, balanceBadge,
        !complete && s.balance >= cost ? h('button', { class: 'btn btn-violet', onclick: function () { surprise(s, col); } }, 'Surprise Me') : null,
        backBtn('Collections', '#/choose/' + sid)));

    if (complete) {
      const other = MP.COLLECTIONS.find(function (c) { return c.id !== colId && counts[c.id] < c.size; });
      mount(tok, h('div', null, head, h('div', { class: 'panel center' },
        h('h2', { style: { fontFamily: 'var(--display)', color: 'var(--royal)', fontSize: 'clamp(1.8rem,4vw,3rem)', margin: '0 0 6px' } }, 'All ' + col.size + ' ' + col.name + ' cards!'),
        h('p', { style: { fontSize: '1.3rem' } }, 'You collected the whole ' + col.name + ' collection. Amazing!'),
        h('div', { class: 'card-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', margin: '18px 0' } }, cards.map(function (c) { return ui.cardFrame(c); })),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          other && s.balance >= cost ? h('button', { class: 'btn btn-gold', onclick: function () { go('#/choose/' + sid + '/' + other.id); } }, 'Choose from ' + other.name) : null,
          h('button', { class: 'btn btn-violet', onclick: function () { go('#/album/' + sid); } }, 'My Collection')))));
      return;
    }
    if (s.balance < cost) { mount(tok, h('div', null, head, notEnough())); return; }

    const grid = h('div', { class: 'card-grid choose-grid' }, cards.map(function (c) {
      if (owned[c.id]) {
        return h('div', { class: 'mcard owned', 'aria-label': c.name + ' (already in your album)', role: 'img' },
          h('img', { src: c.src, alt: '' }), h('span', { class: 'owned-mark', html: ui.ICONS.check }));
      }
      return h('button', { class: 'mcard', 'aria-label': 'Choose ' + c.name, onclick: function () { MP.sound.play('tap'); confirmCard(s, c); } },
        h('img', { src: c.src, alt: '' }));
    }));
    mount(tok, h('div', null, head, grid));
  }

  function costLine(cost) {
    return h('div', { class: 'cost' }, 'This uses ', String(cost), ' ', icon('star'), ' stars');
  }

  function friendlyCardError(e) {
    switch (e && e.code) {
      case 'NOT_ENOUGH_STARS': return 'Not enough stars yet. Nothing was used.';
      case 'ALREADY_OWNED': return 'This card is already in your album. No stars were used.';
      case 'COLLECTION_COMPLETE': return 'You already have every card in this collection!';
      case 'DUPLICATE_REQUEST': return 'Already done!';
      default: return 'The card could not be saved, so no stars were used. (' + ((e && e.message) || e) + ')';
    }
  }

  function confirmCard(s, card) {
    const cost = state.settings.starsPerCard;
    const requestId = st.uuid(); // one id per dialog: repeated taps can never buy twice
    const yes = h('button', { class: 'btn btn-gold btn-xl' }, 'Yes, this one!');
    const no = h('button', { class: 'btn btn-pearl btn-xl' }, 'Back');
    const m = ui.modal(h('div', null,
      ui.cardFrame(card, 'big-card'),
      costLine(cost),
      h('div', { class: 'actions' }, no, yes)), { className: 'wide' });
    no.onclick = function () { m.close(); };
    let sent = false;
    yes.onclick = async function () {
      if (sent) return;
      sent = true; yes.disabled = true; no.disabled = true;
      try {
        const r = await st.buyCard(s.id, card.id, { requestId: requestId });
        m.close();
        celebrate(r);
      } catch (e) {
        m.close();
        if (e.code !== 'DUPLICATE_REQUEST') { MP.sound.play('error'); ui.toast(friendlyCardError(e), 'error'); }
        route();
      }
    };
  }

  function surprise(s, col) {
    const cost = state.settings.starsPerCard;
    const requestId = st.uuid();
    const img = h('img', { src: MP.CARD_BACK, alt: 'Face-down magic card', style: { borderRadius: '9% / 6.3%', width: '100%' } });
    const holder = h('div', { class: 'surprise-card' }, img);
    const yes = h('button', { class: 'btn btn-gold btn-xl' }, 'Yes, surprise me!');
    const no = h('button', { class: 'btn btn-pearl btn-xl' }, 'Back');
    const m = ui.modal(h('div', { class: 'center' },
      h('h2', null, 'Surprise Me!'),
      h('p', null, 'A magic ' + col.name + ' card you don’t have yet.'),
      holder, costLine(cost),
      h('div', { class: 'actions' }, no, yes)));
    no.onclick = function () { m.close(); };
    let sent = false;
    yes.onclick = async function () {
      if (sent) return;
      sent = true; yes.disabled = true; no.disabled = true;
      try {
        const r = await st.surpriseCard(s.id, col.id, { requestId: requestId });
        if (!document.documentElement.classList.contains('reduce-motion')) {
          holder.classList.add('flip', 'shaking');
          holder.style.aspectRatio = 'auto';
          MP.sound.play('tick');
          await new Promise(function (res) { setTimeout(res, 650); });
        }
        m.close();
        celebrate(r);
      } catch (e) {
        m.close();
        if (e.code !== 'DUPLICATE_REQUEST') { MP.sound.play('error'); ui.toast(friendlyCardError(e), 'error'); }
        route();
      }
    };
  }

  async function celebrate(r) {
    const s = r.student;
    let owned = {};
    try { owned = await st.getOwned(s.id); } catch (_) { /* card is saved; only the extra info is missing */ }
    const counts = countOwned(owned);
    const col = MP.COLLECTIONS.find(function (c) { return c.id === r.card.collection; });
    const colDone = counts[col.id] >= col.size;
    const allDone = counts.total >= MP.CARDS.length;
    const cost = state.settings.starsPerCard;
    const canMore = s.balance >= cost && !allDone;
    MP.sound.play(colDone ? 'complete' : 'card');

    const box = h('div', { class: 'celebrate' },
      h('h2', null, allDone ? 'Your Magic Collection is complete!' : colDone ? col.name + ' collection complete!' : 'It’s yours!'),
      ui.cardFrame(r.card, 'big-card'),
      h('p', { class: 'earned' }, 'Added to your Magic Collection · ' + col.name + ' ' + counts[col.id] + ' / ' + col.size),
      h('p', { class: 'cost', style: { marginTop: '4px' } }, 'Stars left: ', String(s.balance), ' ', icon('star')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-violet', onclick: function () { m.close(); state.freshCard = r.cardId; go('#/album/' + s.id); } }, 'See it in my album'),
        canMore ? h('button', { class: 'btn btn-gold', onclick: function () { m.close(); go('#/choose/' + s.id); } }, 'Choose another card') : null,
        h('button', { class: 'btn btn-pearl', onclick: function () { m.close(); go('#/student/' + s.id); } }, 'Done')));
    const m = ui.modal(box, { className: 'wide', onClose: function () { if (/^#\/choose\//.test(location.hash)) route(); } });
    ui.burst(m.el, 16);
  }

  /* ---------- album (on screen) ---------- */
  function albumPages() {
    const pages = [{ type: 'cover' }];
    MP.COLLECTIONS.forEach(function (col) {
      pages.push({ type: 'section', col: col.id });
      for (let p = 0; p < Math.ceil(col.size / 4); p++) pages.push({ type: 'slots', col: col.id, page: p });
    });
    pages.push({ type: 'back' });
    return pages;
  }

  /* Two-page spreads: cover alone, then pairs, back cover alone. */
  function albumViews(single) {
    const pages = albumPages();
    if (single) return pages.map(function (p) { return [p]; });
    const views = [[pages[0]]];
    for (let i = 1; i < pages.length - 1; i += 2) views.push(pages.slice(i, Math.min(i + 2, pages.length - 1)));
    views.push([pages[pages.length - 1]]);
    return views;
  }

  function slotsFor(colId, page) {
    return MP.cardsIn(colId).slice(page * 4, page * 4 + 4);
  }

  function buildPage(p, ctx) {
    const s = ctx.student, owned = ctx.owned, counts = ctx.counts;
    if (p.type === 'cover') {
      return h('div', { class: 'page cover-page' },
        h('div', { class: 'cover-title' }, 'My Magic Collection'),
        h('img', { class: 'cover-emblem', src: MP.CARD_BACK, alt: '' }),
        h('div', { class: 'cover-who' }, MP.symbolEl(s.symbol, 'sym-cover'), h('div', { class: 'cover-name' }, s.name), h('div', { class: 'cover-class' }, 'Class ' + ctx.className)),
        h('div', { class: 'cover-progress' },
          h('div', { class: 'line' }, h('span', null, 'Adventure'), h('span', null, counts.adventure + ' / 20')),
          h('div', { class: 'line' }, h('span', null, 'Wonder'), h('span', null, counts.wonder + ' / 20')),
          h('div', { class: 'line' }, h('span', null, 'Total'), h('span', null, counts.total + ' / 40'))));
    }
    if (p.type === 'section') {
      const col = MP.COLLECTIONS.find(function (c) { return c.id === p.col; });
      return h('div', { class: 'page section-page' },
        h('div', { class: 'big' }, col.name),
        h('div', { class: 'count' }, counts[p.col] + ' / ' + col.size),
        h('div', { class: 'dots', 'aria-hidden': 'true' }, MP.cardsIn(p.col).map(function (c) { return h('span', { class: owned[c.id] ? 'on' : '' }); })),
        counts[p.col] >= col.size ? h('span', { class: 'complete-ribbon' }, 'Complete!') : null);
    }
    if (p.type === 'back') {
      return h('div', { class: 'page back-page' }, h('img', { src: MP.CARD_BACK, alt: '' }),
        h('div', { style: { fontFamily: 'var(--display)', fontWeight: 900, color: 'var(--royal)', fontSize: '1.8em' } }, 'Magic Picker'));
    }
    const col = MP.COLLECTIONS.find(function (c) { return c.id === p.col; });
    const pagesInCol = Math.ceil(col.size / 4);
    return h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('span', { class: 't' }, col.name), h('span', { class: 'n' }, 'Page ' + (p.page + 1) + ' of ' + pagesInCol)),
      h('div', { class: 'slots' }, slotsFor(p.col, p.page).map(function (c) {
        const o = owned[c.id];
        return h('button', {
          class: 'slot' + (o ? '' : ' empty') + (o && ctx.fresh === c.id ? ' fresh' : ''),
          'aria-label': o ? c.name + ', collected' : 'Card ' + c.number + ', not collected yet',
          onclick: function () { showSlot(c, o); }
        }, h('span', { class: 'frame' }, h('img', { src: c.src, alt: '', draggable: 'false' })), h('span', { class: 'num' }, String(c.number)));
      })));
  }

  function showSlot(card, o) {
    MP.sound.play('tap');
    if (o) {
      const m = ui.modal(h('div', null,
        ui.cardFrame(card, 'big-card'),
        h('p', { class: 'earned' }, 'Collected on ' + ui.fmtDate(o.earnedAt)),
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-pearl', onclick: function () { m.close(); } }, 'Close'))), { className: 'wide' });
    } else {
      const m = ui.modal(h('div', { class: 'center' },
        h('img', { src: MP.CARD_BACK, alt: '', style: { width: 'min(60vw, 220px)', margin: '0 auto', borderRadius: '9% / 6.3%' } }),
        h('p', { style: { marginTop: '14px', fontSize: '1.4rem', fontWeight: 600 } }, 'Not collected yet'),
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-pearl', onclick: function () { m.close(); } }, 'Close'))));
    }
  }

  async function renderAlbum(tok, sid) {
    const s = await st.getStudent(sid);
    if (!s) { go('#/'); return; }
    const cls = await st.getClass(s.classId);
    setClassChip(cls);
    const owned = await st.getOwned(sid);
    const counts = countOwned(owned);
    const single = window.innerWidth < 900 || window.innerWidth < window.innerHeight * 1.15;
    const views = albumViews(single);
    const fresh = state.freshCard; state.freshCard = null;
    const ctx = { student: s, owned: owned, counts: counts, className: cls ? cls.name : '', fresh: fresh };

    let view = 0;
    const key = sid + (single ? ':1' : ':2');
    if (fresh) {
      const card = MP.CARD_BY_ID[fresh];
      view = views.findIndex(function (v) { return v.some(function (p) { return p.type === 'slots' && p.col === card.collection && p.page === Math.floor(card.index / 4); }); });
      if (view < 0) view = 0;
    } else if (state.albumView[key] != null) view = Math.min(state.albumView[key], views.length - 1);

    const book = h('div', { class: 'book' + (single ? ' single' : '') });
    const prev = h('button', { class: 'btn btn-pearl book-arrow', 'aria-label': 'Previous page' }, icon('back'));
    const next = h('button', { class: 'btn btn-pearl book-arrow', 'aria-label': 'Next page' }, icon('next'));
    const dots = h('div', { class: 'page-dots', 'aria-hidden': 'true' });

    function show(dir) {
      state.albumView[key] = view;
      const v = views[view];
      const nodes = v.map(function (p, i) {
        const el = buildPage(p, ctx);
        if (!single) {
          if (v.length === 1) el.classList.add('solo');
          else el.classList.add(i === 0 ? 'left' : 'right');
        }
        if (dir) el.classList.add('page-anim', dir < 0 ? 'back' : 'fwd');
        return el;
      });
      book.replaceChildren.apply(book, nodes);
      prev.disabled = view === 0;
      next.disabled = view === views.length - 1;
      dots.replaceChildren.apply(dots, views.map(function (_, i) { return h('span', { class: i === view ? 'on' : '' }); }));
    }
    function move(d) {
      const n = view + d;
      if (n < 0 || n >= views.length) return;
      view = n; MP.sound.play('tap'); show(d);
    }
    prev.onclick = function () { move(-1); };
    next.onclick = function () { move(1); };

    let sx = null;
    book.addEventListener('pointerdown', function (e) { sx = e.clientX; });
    book.addEventListener('pointerup', function (e) {
      if (sx == null) return;
      const dx = e.clientX - sx; sx = null;
      if (Math.abs(dx) > 70) move(dx < 0 ? 1 : -1);
    });
    function onKey(e) {
      if (!document.body.contains(book)) { document.removeEventListener('keydown', onKey); return; }
      if (document.querySelector('.modal-backdrop') || !document.getElementById('teacher').hidden) return;
      if (e.key === 'ArrowRight') move(1);
      if (e.key === 'ArrowLeft') move(-1);
    }
    document.addEventListener('keydown', onKey);

    show(0);
    const cost = state.settings.starsPerCard;
    mount(tok, h('div', null,
      h('div', { class: 'screen-head album-head' },
        h('div', null, h('h1', { class: 'screen-title' }, s.name + '’s Magic Collection'), h('p', { class: 'screen-sub' }, counts.total + ' of 40 cards')),
        h('div', { class: 'row' },
          s.balance >= cost && counts.total < 40 ? h('button', { class: 'btn btn-gold btn-small', onclick: function () { go('#/choose/' + sid); } }, 'Choose a Card') : null,
          backBtn('Back', '#/student/' + sid))),
      h('div', { class: 'book-area' }, h('div', { class: 'book-row' }, prev, book, next), h('div', { class: 'book-nav' }, dots))));
  }

  MP.app = { boot: boot, go: go, route: route, state: state, setTeacher: setTeacher, refreshSettings: refreshSettings, applySettings: applySettings, award: award, countOwned: countOwned, albumPages: albumPages, slotsFor: slotsFor };
  document.addEventListener('DOMContentLoaded', boot);
})();
