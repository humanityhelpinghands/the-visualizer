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
      title: $('np-title'), sub: $('np-sub'), time: $('time'), tNow: $('t-now'), vol: $('vol'), search: $('track-search'),
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
    $('keys-toggle').onclick = () => this.el.drawer.classList.toggle('show-keys');
    // The dock's height, for a narrow window's drawer to stop on its top edge (css: #drawer). Fires only when the dock resizes.
    if (window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', this.el.hud.offsetHeight + 'px')).observe(this.el.hud);
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
    this.el.gate.classList.remove('gone', 'loading');
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
    // (each value written only when it changes: the words already sung hold 100% for the whole line)
    const setP = (w, v) => { if (w._p !== v) { w._p = v; w.style.setProperty('--p', v); } };
    if (s) {
      setP(s, (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%');
      const hold = Math.max(0, Math.min(1, p)).toFixed(3);
      if (s._hold !== hold) { s._hold = hold; s.style.setProperty('--hold', hold); }
    }
    const W = this.wordEls;
    for (let i = 0; i < k && i < W.length; i++) setP(W[i], '100%');
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
  nowPlaying(title, sub) { this.el.title.textContent = title; this.el.sub.textContent = sub; document.title = title + ' · The Visualizer'; }
  setPlaying(on) { this.el.play.classList.toggle('playing', on); document.body.classList.toggle('is-playing', on); if (on && this._wake) this._wake(false); }   // (a song starting on its own counts as a fresh start of the idle clock)
  setShuffle(on) { document.getElementById('shuffle-btn').classList.toggle('on', on); }
  setStats({ bpm, fps }) {
    if (bpm !== undefined) this.el.bpm.textContent = bpm ? `${bpm.toFixed(1)} BPM` : 'BPM';
    if (fps !== undefined) this.el.fps.textContent = `${Math.round(fps)} FPS`;
  }

  // ── track drawer ───────────────────────────────────────────────────
  // Most-heard first (the favourites sit at the top, no scrolling for them), and a
  // search box that narrows the list as you type.
  setTracks(tracks, current, onPick) {
    this.el.list.innerHTML = '';
    this._pick = onPick;
    const rank = [...tracks.keys()].sort((a, b) => (tracks[a].disliked - tracks[b].disliked) || ((tracks[b].plays || 0) - (tracks[a].plays || 0)) || tracks[a].name.localeCompare(tracks[b].name));
    const allChills = this.allChills ? this.allChills() : {};   // (read once for the whole list)
    rank.forEach((i, r) => {
      const t = tracks[i];
      const li = document.createElement('li');
      li.className = (i === current ? 'cur' : '') + (t.disliked ? ' disliked' : '');
      li.dataset.i = i;
      li.dataset.q = (t.name + ' ' + (this.pretty ? this.pretty(t.name) : '')).toLowerCase();
      const ch = allChills[t.name] || [];
      const chill = ch.length ? `<button class="tag chill" title="Play it from your first chill">✦ ${ch.length}</button>` : '';
      const heard = t.plays ? `<span class="plays" title="Times you've heard it">${t.plays}×</span>` : '';
      const fresh = t.isNew && !t.disliked && (t.plays || 0) < 2 ? '<span class="tag new" title="New: plays first until heard twice">NEW</span>' : '';
      const undo = t.disliked ? '<button class="tag undo" title="Let it come up in shuffle again">NOT FOR ME ↺</button>' : '';
      // (the + at the end of a row lines the song up after this one: a thing to click, where it used to be a right-click only)
      li.innerHTML = `<span class="n">${String(r + 1).padStart(2, '0')}</span><span class="t">${esc(this.pretty ? this.pretty(t.name) : t.name)}</span>${undo}${fresh}${chill}${heard}<button class="q">+</button>`;
      li.querySelector('.q').onclick = (e) => { e.stopPropagation(); if (this.onQueue) this.onQueue(i); };
      if (chill) li.querySelector('.chill').onclick = (e) => { e.stopPropagation(); this.onChill && this.onChill(i); this.toggleDrawer(false); };
      if (undo) li.querySelector('.undo').onclick = (e) => { e.stopPropagation(); this.onUndislike && this.onUndislike(i); };
      li.onclick = () => { onPick(i); this.toggleDrawer(false); };   // (a pick is the whole errand: the list closes itself and the room is back)
      // (a short rest, not a pass: sweeping the mouse down the list loads nothing)
      li.onmouseenter = () => { clearTimeout(this._hoverT); this._hoverT = setTimeout(() => this.onHover && this.onHover(i), 150); };
      li.onmouseleave = () => clearTimeout(this._hoverT);
      li.oncontextmenu = (e) => { e.preventDefault(); if (this.onQueue) this.onQueue(i); };
      this.el.list.appendChild(li);
    });
    this.filterTracks();
    this.setQueue(this._queue || []);
  }
  // Queued songs wear their place in line on their + key (a second click, or a right-click, takes one out).
  setQueue(q) {
    this._queue = q;
    for (const li of this.el.list.children) {
      const at = q.indexOf(+li.dataset.i), key = li.querySelector('.q');
      li.classList.toggle('queued', at >= 0);
      li.dataset.qn = at >= 0 ? at + 1 : '';
      if (key) { key.textContent = at >= 0 ? at + 1 : '+'; key.title = at >= 0 ? `Number ${at + 1} in your queue. Click to take it out.` : 'Play it after this song'; }
    }
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
    document.body.classList.toggle('drawer-open', open);
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
    const w = cv.clientWidth, h = cv.clientHeight, chills = (this.chills && this.chills()) || [];
    const key = `${chills.length}|${Math.round((t / (this.duration || 1)) * w * dpr)}|${w}|${h}|${dpr}|${this.seekVersion || 0}`;   // a redraw per device pixel the playhead moves
    if (key === this._seekKey) return;
    this._seekKey = key;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = this.seekCtx, D = this.duration || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    //  black; the mood's own colour stays with the lyric words and the room)
    const BLUE = '#6b8cff', RED = '#ff4d6a';
    const mid = h / 2;
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(0, mid - 2, w, 4);
    if (this.map) {
      for (const s of this.map.sections) {
        const x0 = (s.start / D) * w, x1 = (s.end / D) * w, hh = 3 + s.energy * (h * 0.55);
        g.fillStyle = `rgba(255,255,255,${0.06 + s.energy * 0.16})`;
        g.fillRect(x0 + 1, mid - hh / 2, Math.max(1, x1 - x0 - 2), hh);
      }
      g.fillStyle = 'rgba(255,255,255,0.22)';
      for (const d of this.map.downbeats) g.fillRect((d / D) * w, mid - 1, 1, 2);
    }
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (const l of this.lines) g.fillRect((l.t / D) * w, h - 3, Math.max(1, ((l.end - l.t) / D) * w - 1), 2);
    const px = (t / D) * w;
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = BLUE;
    g.globalAlpha = 0.72;
    g.fillRect(0, 0, px, h);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = BLUE; g.fillRect(0, mid - 1, px, 2);   // (and one crisp blue line through the middle, so how far it has come reads at a glance)
    // the drops ahead keep their red, and your chills (X) are small sharp white points along the top, the moments to come
    if (this.map) { g.fillStyle = RED; for (const s of this.map.sections) if (s.drop) g.fillRect((s.start / D) * w, 2, 2, h - 4); }
    g.fillStyle = '#fff';
    for (const c of chills) { g.beginPath(); g.arc((c / D) * w, 3.5, 2.5, 0, Math.PI * 2); g.fill(); }
    g.fillRect(px - 1, 0, 2, h);
    this.el.tNow.textContent = fmt(t);
    // the last 20 s: what comes next, under the title
    const ending = this.duration > 40 && this.duration - t < 20 && this.upNext ? this.upNext() : '';
    const nowEl = this.el.title.parentElement;
    if (ending) { const nx = $('np-next'), txt = 'NEXT · ' + ending; if (nx.textContent !== txt) nx.textContent = txt; }
    nowEl.classList.toggle('ending', !!ending); this.el.time.textContent = '-' + fmt(this.duration - t);
  }
  _wireSeek() {
    const cv = this.el.seek;
    let drag = false;
    const at = (e) => { const r = cv.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (this.duration || 0); };
    cv.addEventListener('pointerdown', (e) => { drag = true; cv.setPointerCapture(e.pointerId); this.onSeek && this.onSeek(at(e)); });
    cv.addEventListener('pointermove', (e) => { if (drag) this.onSeek && this.onSeek(at(e)); });
    cv.addEventListener('pointerup', () => { drag = false; });
    // Hover: the time under the pointer, and the section it falls in when the map knows.
    const tip = $('seek-tip');
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect(), t = at(e);
      tip.style.left = Math.max(20, Math.min(r.width - 20, e.clientX - r.left)) + 'px';
      tip.textContent = fmt(t) + ((this.chills && this.chills() || []).some((c) => Math.abs(c - t) < this.duration / 80) ? '  · chills' : '');
    });
  }

  // ── idle hide ──────────────────────────────────────────────────────
  _wireIdle() {
    // The player bar, the top bar and the cursor fade out after a few still seconds while music plays,
    // and come back the moment the mouse moves or a key is pressed.
    const fs = () => document.body.classList.contains('fs');
    const hide = () => { if (document.body.classList.contains('is-playing') && !this.el.drawer.classList.contains('open')) document.body.classList.add('idle'); };
    const wake = (show = true) => {
      if (show) document.body.classList.remove('idle');
      clearTimeout(this._idleTimer);
      this._idleTimer = setTimeout(() => {
        // (in a window a mouse resting on the controls keeps them; in full screen a still mouse always lets them go,
        //  wherever it rests: the key that starts full screen sits in the player, so the mouse is resting on it)
        if (this._over && !fs()) return wake(false);
        hide();
      }, fs() ? 2500 : 3500);
    };
    this._wake = wake;
    // Full screen just began: the player fades at once. The small slip of the hand that ends the click is not "moving the
    // mouse", so moves are not counted for a moment.
    this._quietUntil = 0;
    this.hideNow = () => { clearTimeout(this._idleTimer); this._quietUntil = performance.now() + 600; hide(); };
    this._over = 0;
    for (const el of [this.el.hud, document.getElementById('brand')]) {
      el.addEventListener('pointerenter', () => { this._over++; });
      el.addEventListener('pointerleave', () => { this._over = Math.max(0, this._over - 1); });
    }
    ['pointermove', 'pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => { if (ev !== 'pointermove' || performance.now() >= this._quietUntil) wake(); }, { passive: true }));
    wake();
  }
}
