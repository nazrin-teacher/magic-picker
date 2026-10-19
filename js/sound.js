/* Tiny synthesized sounds (Web Audio). No files, never blocks anything, silently does nothing on failure. */
window.MP = window.MP || {};

(function () {
  let ctx = null;
  let enabled = true;

  function ac() {
    if (!enabled) return null;
    try {
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (_) { return null; }
  }

  function tone(freq, start, dur, type, vol) {
    const c = ac(); if (!c) return;
    try {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      const t = c.currentTime + (start || 0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + dur + 0.05);
    } catch (_) { /* ignore */ }
  }

  const sounds = {
    tap: function () { tone(660, 0, 0.08, 'triangle', 0.08); },
    star: function () { [784, 988, 1175].forEach(function (f, i) { tone(f, i * 0.07, 0.35, 'triangle', 0.14); }); },
    pick: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.09, 0.4, 'sine', 0.16); }); },
    tick: function () { tone(1200, 0, 0.03, 'square', 0.03); },
    card: function () {
      [659, 784, 988, 1319, 1568].forEach(function (f, i) { tone(f, i * 0.08, 0.5, 'triangle', 0.13); });
      [2093, 2637].forEach(function (f, i) { tone(f, 0.45 + i * 0.1, 0.6, 'sine', 0.06); });
    },
    complete: function () { [523, 659, 784, 1047, 784, 1047, 1319].forEach(function (f, i) { tone(f, i * 0.12, 0.5, 'triangle', 0.14); }); },
    error: function () { tone(220, 0, 0.18, 'sine', 0.1); }
  };

  /* Reads a child's name aloud with a Turkish voice when the device has one. Never blocks anything. */
  function canSpeak() { return !!(window.speechSynthesis && window.SpeechSynthesisUtterance); }
  function speak(text) {
    if (!enabled || !text || !canSpeak()) return false;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'tr-TR';
      const voice = speechSynthesis.getVoices().find(function (v) { return /^tr/i.test(v.lang); });
      if (voice) u.voice = voice;
      u.rate = 0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      return true;
    } catch (_) { return false; }
  }
  if (canSpeak()) { try { speechSynthesis.getVoices(); } catch (_) { /* voices load lazily */ } }

  MP.sound = {
    speak: speak,
    canSpeak: canSpeak,
    play: function (name) { if (enabled && sounds[name]) { try { sounds[name](); } catch (_) { /* ignore */ } } },
    setEnabled: function (on) { enabled = !!on; },
    isEnabled: function () { return enabled; }
  };
})();
