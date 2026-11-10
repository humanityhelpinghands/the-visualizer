// Fallback voice: the browser's speech synth (used only when Kokoro is unavailable). Each spoken word fires
// onWord(index), from real boundary events when the voice provides them,
// otherwise from a timing estimate, so text can land with the words.

const PREFER = [/natural/i, /google uk english male/i, /google us english/i, /microsoft (guy|davis|tony|ryan)/i, /microsoft (aria|jenny|sonia)/i, /^en[-_]gb/i, /^en/i];

export class Voice {
  constructor(onError) {
    this.ok = 'speechSynthesis' in window;
    this.voice = null;
    this.onError = onError || (() => {});
    this.token = 0;
    this.timers = [];
    if (this.ok) {
      this._pick();
      speechSynthesis.addEventListener('voiceschanged', () => this._pick());
    }
  }

  _pick() {
    const all = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang) || /english/i.test(v.name));
    for (const re of PREFER) {
      const hit = all.find((v) => re.test(v.name) || re.test(v.lang));
      if (hit) { this.voice = hit; return; }
    }
    this.voice = all[0] || null;
  }

  get name() { return this.voice ? this.voice.name : 'default voice'; }

  cancel() {
    this.token++;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.ok) speechSynthesis.cancel();
  }

  // Resolves when speech ends (or fails). Never hangs: a watchdog ends it.
  speak(text, { onStart, onWord, rate = 0.96, pitch = 0.92 } = {}) {
    if (!this.ok) { this.onError('This browser has no speech voice.'); return Promise.resolve(false); }
    this.cancel();
    const token = this.token;
    const words = text.split(/\s+/).filter(Boolean);
    const starts = [];
    let pos = 0;
    for (const w of words) { const i = text.indexOf(w, pos); starts.push(i); pos = i + w.length; }

    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) u.voice = this.voice;
      u.rate = rate; u.pitch = pitch;
      let boundary = false, said = -1, done = false;
      const fire = (k) => { if (token === this.token && k > said) { said = k; onWord && onWord(k, words[k]); } };
      const finish = (ok) => {
        if (done) return;
        done = true;
        this.timers.forEach(clearTimeout);
        resolve(ok);
      };
      u.onboundary = (e) => {
        if (e.name && e.name !== 'word') return;
        boundary = true;
        let k = 0;
        while (k + 1 < starts.length && starts[k + 1] <= e.charIndex) k++;
        fire(k);
      };
      u.onstart = () => {
        onStart && onStart();
        fire(0);
        // Fallback clock for voices that never send boundaries (Google's network voices).
        let at = 0;
        words.forEach((w, k) => {
          if (k === 0) { at += (0.16 + 0.062 * w.length) / rate; return; }
          this.timers.push(setTimeout(() => { if (!boundary) fire(k); }, at * 1000));
          at += (0.16 + 0.062 * w.length + (/[.,!?]$/.test(words[k - 1]) ? 0.25 : 0)) / rate;
        });
      };
      u.onend = () => finish(true);
      u.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') this.onError('Voice failed: ' + e.error);
        finish(false);
      };
      // Watchdog: some engines silently drop utterances.
      this.timers.push(setTimeout(() => { if (said < 0) { this.onError('Voice did not start; skipping the spoken intro.'); finish(false); } }, 2500));
      this.timers.push(setTimeout(() => finish(true), 1500 + text.length * 120));
      speechSynthesis.speak(u);
    });
  }
}

// The loft's real voice: Kokoro-82M on the local server. Each clip arrives with
// per-word start times from the model itself, so words can be scheduled on the
// audio clock instead of guessed.
export class Kokoro {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = 'unknown';
    this.error = '';
    this.voices = [];
    this.voice = 'af_heart';
    this.cache = new Map();
  }

  async init() {
    try {
      const r = await fetch('/api/voice');
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} (restart START THE LOFT.bat to pick up the new server)`);
      const j = await r.json();
      this.state = j.state;
      this.error = j.error || '';
      this.voices = j.voices || [];
      if (j.default) this.voice = j.default;
    } catch (err) {
      this.state = 'error';
      this.error = err.message;
    }
    return this;
  }

  get ok() { return this.state === 'ready' || this.state === 'loading'; }

  // Starts generating now; the promise resolves to { buffer, words }.
  prepare(text, voice = this.voice) {
    const key = voice + '|' + text;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = (async () => {
      const r = await fetch('/api/say?' + new URLSearchParams({ text, voice, speed: '0.95' }));
      let j;
      try { j = await r.json(); } catch (err) { throw new Error(`${r.status} ${r.statusText}`); }
      if (!r.ok || j.error) throw new Error(j.error || `${r.status} ${r.statusText}`);
      const bytes = Uint8Array.from(atob(j.audio), (c) => c.charCodeAt(0));
      const buffer = await this.ctx.decodeAudioData(bytes.buffer);
      return { buffer, words: j.words, gen: j.genSeconds };
    })();
    p.catch(() => this.cache.delete(key));   // let a later call retry
    this.cache.set(key, p);
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value);
    return p;
  }
}
