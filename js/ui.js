// DOM side: HUD, karaoke line, captions, title card, seek map, drawer, toasts.
const $ = (id) => document.getElementById(id);
export const fmt = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class UI {
  constructor() {
    this.el = {
      gate: $('gate'), loading: $('loading'), loadLabel: $('load-label'), loadBar: $('load-bar'),
      lyric: $('lyric'), caption: $('caption'), card: $('title-card'), cardTitle: $('card-title'), cardSub: $('card-sub'),
      hud: $('hud'), seek: $('seek'), play: $('play'), prev: $('prev'), next: $('next'),
      title: $('np-title'), sub: $('np-sub'), time: $('time'), vol: $('vol'), search: $('track-search'),
      listBtn: $('list-btn'), fsBtn: $('fs-btn'), drawer: $('drawer'), list: $('track-list'), toasts: $('toasts'),
      bpm: $('stat-bpm'), fps: $('stat-fps'), dropHint: $('drop-hint'), empty: $('empty'),
    };
    this.seekCtx = this.el.seek.getContext('2d');
    this.map = null; this.lines = []; this.duration = 0;
    this.lineEl = null; this.wordEls = []; this.capEls = [];
    this._idleTimer = 0;
    this._wireIdle();
    this._wireSeek();
    this._wireSearch();
  }
  // The drawer's search: type to narrow, Enter plays the top match, Esc clears then closes.
  _wireSearch() {
    const s = this.el.search;
    s.addEventListener('input', () => this.filterTracks());
    s.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const i = this.firstMatch(); if (i >= 0 && this._pick) { this._pick(i); this.toggleDrawer(false); } }
      else if (e.key === 'Escape') { if (s.value) { s.value = ''; this.filterTracks(); } else this.toggleDrawer(false); }
    });
    // A click anywhere outside the open drawer closes it.
    document.addEventListener('pointerdown', (e) => {
      const d = this.el.drawer;
      if (d.classList.contains('open') && !d.contains(e.target) && !this.el.listBtn.contains(e.target)) this.toggleDrawer(false);
    });
  }

  // ── overlays ───────────────────────────────────────────────────────
  hideGate() { this.el.gate.classList.add('gone'); }
  loading(label, p = null) {
    const L = this.el.loading;
    if (label == null) { L.classList.remove('on'); return; }
    L.classList.add('on');
    this.el.loadLabel.textContent = label;
    this.el.loadBar.style.transform = `scaleX(${p == null ? 0.08 : Math.max(0.02, Math.min(1, p))})`;
    L.classList.toggle('indeterminate', p == null);
  }
  toast(msg, kind = 'info', ms = 4200) {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    this.el.toasts.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 500); }, ms);
  }
  fatal(msg) {
    document.body.classList.add('fatal');
    this.el.gate.classList.remove('gone');
    this.el.gate.querySelector('.hint').textContent = msg;
  }
  setEmpty(on) { this.el.empty.classList.toggle('on', on); }
  setDropHint(on) { this.el.dropHint.classList.toggle('on', on); }

  // The title and the announcer share the top of the frame, so they take turns: while
  // she speaks the title waits, and if she starts while it is up, it bows out.
  titleCard(title, sub, type = 'wide') {
    if (this.el.caption.classList.contains('on')) { this._pendingCard = [title, sub, type]; return; }
    this._pendingCard = null;
    this._cardArgs = [title, sub, type]; this._cardAt = performance.now();
    const c = this.el.card;
    c.className = 'type-' + type;
    // Letters animate one by one, but words stay whole when the title wraps.
    let i = 0;
    this.el.cardTitle.innerHTML = title.split(' ').map((word) =>
      `<span class="word">${[...word].map((ch) => `<span style="--i:${i++}">${esc(ch)}</span>`).join('')}</span>`,
    ).join(' ');
    this.el.cardSub.textContent = sub || '';
    c.classList.remove('on'); void c.offsetWidth; c.classList.add('on');
    clearTimeout(this._cardT);
    this._cardT = setTimeout(() => c.classList.remove('on'), 4600);
  }

  // ── karaoke line ───────────────────────────────────────────────────
  // look: { type, motion, hook, first, how, fit, next, colors[] } — the mood's
  // typeface and way of moving, whether this line is a hook or opens a
  // section, its direction (spoken, soft, ad-lib...), a size fit for long
  // lines, the next line to peek at, and a colour for each emotional word.
  lyricLine(line, look = {}) {
    this.lyricClear();
    const L = this.el.lyric;
    L.className = `type-${look.type || 'wide'} motion-${look.motion || 'float'} live`;
    const el = document.createElement('div');
    el.className = 'line' + (look.hook ? ' hook' : '') + (look.first ? ' first' : '') + (look.how ? ' how-' + look.how : '');
    el.style.setProperty('--dur', Math.max(0.5, line.end - line.t).toFixed(2) + 's');
    el.style.setProperty('--fit', (look.fit || 1).toFixed(3));
    let backing = false;
    line.words.forEach((w, i) => {
      const s = document.createElement('span');
      s.className = 'w';
      s.textContent = w.w;
      // (words in parentheses) are backing vocals
      if (w.w.startsWith('(')) backing = true;
      if (backing) s.classList.add('bv');
      if (w.w.endsWith(')')) backing = false;
      s.style.setProperty('--i', i);
      const strong = look.colors && look.colors[i], lean = look.lean && look.lean[i];
      const col = strong || (lean && lean[0]);
      if (col) { s.classList.add('emo'); s.style.setProperty('--wc', col); s.style.setProperty('--wcw', strong ? 1 : (0.25 + 0.75 * lean[1]).toFixed(2)); }
      if (w.end - w.t >= 0.5) s.classList.add('held');   // a sustained note stretches as it's held
      el.appendChild(s);
      el.appendChild(document.createTextNode(' '));
    });
    if (look.next) {
      const peek = document.createElement('div');
      peek.className = 'peek';
      peek.textContent = look.next;
      el.appendChild(peek);
    }
    L.appendChild(el);
    this.lineEl = el;
    this.wordEls = [...el.querySelectorAll('.w')];
    this.nowK = -1;
    void el.offsetWidth;            // commit the entering state, then arrive (no frame wait: works in any tab)
    el.classList.add('in');
  }
  lyricWord(k) {
    const prev = this.wordEls[this.nowK];
    this.wordEls.forEach((s, i) => { s.classList.toggle('on', i <= k); s.classList.toggle('now', i === k); });
    // A word that was held, or that carries a feeling, leaves an echo as it passes.
    if (prev && k > this.nowK && (prev.classList.contains('held') || prev.classList.contains('emo'))) this.echo(prev);
    this.nowK = k;
  }
  lyricProgress(k, p) {
    const s = this.wordEls[k];
    if (s) {
      s.style.setProperty('--p', (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%');
      s.style.setProperty('--hold', Math.max(0, Math.min(1, p)).toFixed(3));
    }
    this.wordEls.forEach((w, i) => { if (i < k) w.style.setProperty('--p', '100%'); });
  }
  echo(span) {
    const L = this.el.lyric, a = span.getBoundingClientRect(), b = L.getBoundingClientRect();
    if (!a.width) return;
    const ghost = document.createElement('span');
    ghost.className = 'echo';
    ghost.textContent = span.textContent;
    const cs = getComputedStyle(span);
    Object.assign(ghost.style, {
      left: `${a.left - b.left}px`, top: `${a.top - b.top}px`, font: cs.font, letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
    });
    if (span.classList.contains('emo')) ghost.style.setProperty('--wc', span.style.getPropertyValue('--wc'));
    L.appendChild(ghost);
    ghost.style.animation = getComputedStyle(ghost).animation;   // keeps its own motion: a mood change mustn't replay a faded ghost
    setTimeout(() => ghost.remove(), 2200);
  }
  // The mood's colours for the type: --c0..--c4 (shadow → highlight), --accent.
  // Written only when a colour visibly changes (each channel in steps of 4/255):
  // every write restyles the whole page.
  setMoodColors(ramp, accent) {
    const o = { r: 0, g: 0, b: 0 };
    const q = (c) => { c.getRGB(o, 'srgb'); return `rgb(${[o.r, o.g, o.b].map((x) => Math.round(Math.max(0, Math.min(1, x)) * 63.75) * 4).join(',')})`; };
    const vals = [...ramp.map(q), q(accent)], key = vals.join('|');
    if (key === this._moodKey) return;
    this._moodKey = key;
    const root = document.documentElement.style;
    vals.slice(0, -1).forEach((v, i) => root.setProperty('--c' + i, v));
    this.accent = vals[vals.length - 1];
    root.setProperty('--accent', this.accent);
  }
  lyricClear() {
    this.el.lyric.classList.remove('live');
    const old = this.lineEl;
    if (old) {
      old.classList.remove('in'); old.classList.add('out');
      setTimeout(() => old.remove(), 1500);   // the slowest fade (drift) takes 1.3 s: never cut it off mid-fade
    }
    this.lineEl = null; this.wordEls = [];
  }

  // ── spoken captions ────────────────────────────────────────────────
  caption(words) {
    const c = this.el.caption;
    c.innerHTML = '';
    this.capEls = words.map((w) => { const s = document.createElement('span'); s.textContent = w; c.appendChild(s); c.appendChild(document.createTextNode(' ')); return s; });
    c.classList.add('on');
    if (this.el.card.classList.contains('on')) {
      clearTimeout(this._cardT); this.el.card.classList.remove('on');
      if (performance.now() - this._cardAt < 2500) this._pendingCard = this._cardArgs;   // cut off before it was read: it comes back after her
    }
  }
  captionWord(k) { this.capEls.forEach((s, i) => { s.classList.toggle('on', i <= k); s.classList.toggle('now', i === k); }); }
  dropPendingCard() { this._pendingCard = null; clearTimeout(this._pendT); }   // a new song: the last one's title never shows late
  captionClear() {
    this.el.caption.classList.remove('on');
    const p = this._pendingCard;
    if (p) { this._pendingCard = null; clearTimeout(this._pendT); this._pendT = setTimeout(() => this.titleCard(...p), 450); }
  }

  // ── now playing / transport ────────────────────────────────────────
  nowPlaying(title, sub) { this.el.title.textContent = title; this.el.sub.textContent = sub; document.title = title + ' · The Loft'; }
  setPlaying(on) { this.el.play.classList.toggle('playing', on); document.body.classList.toggle('is-playing', on); }
  setShuffle(on) { document.getElementById('shuffle-btn').classList.toggle('on', on); }
  setStats({ bpm, fps }) {
    if (bpm !== undefined) this.el.bpm.textContent = bpm ? `${bpm.toFixed(1)} BPM` : '— BPM';
    if (fps !== undefined) this.el.fps.textContent = `${Math.round(fps)} FPS`;
  }

  // ── track drawer ───────────────────────────────────────────────────
  // Most-heard first (the favourites sit at the top, no scrolling for them), and a
  // search box that narrows the list as you type.
  setTracks(tracks, current, onPick) {
    this.el.list.innerHTML = '';
    this._pick = onPick;
    const rank = [...tracks.keys()].sort((a, b) => (tracks[a].disliked - tracks[b].disliked) || ((tracks[b].plays || 0) - (tracks[a].plays || 0)) || tracks[a].name.localeCompare(tracks[b].name));
    rank.forEach((i, r) => {
      const t = tracks[i];
      const li = document.createElement('li');
      li.className = (i === current ? 'cur' : '') + (t.disliked ? ' disliked' : '');
      li.dataset.i = i;
      li.dataset.q = t.name.toLowerCase();
      const heard = t.plays ? `<span class="plays" title="Times you've heard it">${t.plays}×</span>` : '';
      li.innerHTML = `<span class="n">${String(r + 1).padStart(2, '0')}</span><span class="t">${esc(t.name)}</span>${heard}`;
      li.onclick = () => onPick(i);
      this.el.list.appendChild(li);
    });
    this.filterTracks();
  }
  filterTracks() {
    const q = (this.el.search?.value || '').trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const li of this.el.list.children) { const on = words.every((w) => li.dataset.q.includes(w)); li.hidden = !on; shown += on; }
    this.el.list.classList.toggle('none', shown === 0);
  }
  firstMatch() { const li = [...this.el.list.children].find((l) => !l.hidden); return li ? +li.dataset.i : -1; }
  toggleDrawer(force) {
    const open = this.el.drawer.classList.toggle('open', force);
    if (open) {
      if (this.onDrawerOpen) this.onDrawerOpen();
      const s = this.el.search;
      if (s) { s.value = ''; this.filterTracks(); setTimeout(() => s.focus({ preventScroll: true }), 30); }
      this.el.list.querySelector('li.cur')?.scrollIntoView({ block: 'nearest' });
    } else this.el.search?.blur();
  }
  setLyricsProgress(text) { document.getElementById('lyrics-state').textContent = text; }

  // ── seek map ───────────────────────────────────────────────────────
  setMap(map, lines, duration) { this.map = map; this.lines = lines || []; this.duration = duration; this.seekVersion = (this.seekVersion || 0) + 1; }
  drawSeek(t) {
    // Nothing to draw while the controls are faded out, or when nothing has moved
    // (a redraw each time the playhead reaches the next device pixel).
    const body = document.body.classList;
    if (body.contains('idle') || body.contains('bare')) return;
    const cv = this.el.seek, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    const key = `${Math.round((t / (this.duration || 1)) * w * dpr)}|${w}|${h}|${dpr}|${this.accent}|${this.seekVersion || 0}`;   // a redraw per device pixel the playhead moves
    if (key === this._seekKey) return;
    this._seekKey = key;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = this.seekCtx, D = this.duration || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const accent = this.accent || 'rgb(120, 200, 255)';
    const mid = h / 2;
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(0, mid - 2, w, 4);
    if (this.map) {
      for (const s of this.map.sections) {
        const x0 = (s.start / D) * w, x1 = (s.end / D) * w, hh = 3 + s.energy * (h * 0.55);
        g.fillStyle = `rgba(255,255,255,${0.06 + s.energy * 0.16})`;
        g.fillRect(x0 + 1, mid - hh / 2, Math.max(1, x1 - x0 - 2), hh);
        if (s.drop) { g.fillStyle = accent; g.fillRect(x0, 2, 2, h - 4); }
      }
      g.fillStyle = 'rgba(255,255,255,0.22)';
      for (const d of this.map.downbeats) g.fillRect((d / D) * w, mid - 1, 1, 2);
    }
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (const l of this.lines) g.fillRect((l.t / D) * w, h - 3, Math.max(1, ((l.end - l.t) / D) * w - 1), 2);
    const px = (t / D) * w;
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = accent;
    g.globalAlpha = 0.55;
    g.fillRect(0, 0, px, h);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#fff';
    g.shadowColor = accent; g.shadowBlur = 10;
    g.fillRect(px - 1, 0, 2, h);
    g.shadowBlur = 0;
    this.el.time.textContent = `${fmt(t)} / ${fmt(this.duration)}`;
  }
  _wireSeek() {
    const cv = this.el.seek;
    let drag = false;
    const at = (e) => { const r = cv.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (this.duration || 0); };
    cv.addEventListener('pointerdown', (e) => { drag = true; cv.setPointerCapture(e.pointerId); this.onSeek && this.onSeek(at(e)); });
    cv.addEventListener('pointermove', (e) => { if (drag) this.onSeek && this.onSeek(at(e)); });
    cv.addEventListener('pointerup', () => { drag = false; });
  }

  // ── idle hide ──────────────────────────────────────────────────────
  _wireIdle() {
    const wake = () => {
      document.body.classList.remove('idle');
      clearTimeout(this._idleTimer);
      this._idleTimer = setTimeout(() => {
        if (document.body.classList.contains('is-playing') && !this.el.drawer.classList.contains('open')) document.body.classList.add('idle');
      }, 2800);
    };
    ['pointermove', 'pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
    wake();
  }
}
