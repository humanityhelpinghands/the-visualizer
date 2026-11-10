// Render a clip of the song that's loaded to an MP4 in renders/, frame by frame:
// 1080p60 (by default), every frame on time and perfectly smooth whatever the PC
// is doing, with the song's own audio muxed in by the server. Nothing plays while
// it renders; the room is driven by the song's clock, not the speakers'.
//
// DevTools: await loft.renderClip({ from: 260 })   (to: the song's end by default)
//           await loft.contactSheet({ from: 260 })  (the same frames' moments as one image: renders/sheets/)
//           take: 2 for another camera (the same take is always the same film)

// ── The analyser, offline ───────────────────────────────────────────────
// The visuals read the live AnalyserNode (audio.js: fftSize 2048, smoothing
// 0.55, -100..-30 dB). This computes the same bytes from the decoded song, the
// way the Web Audio spec defines them: the last 2048 samples (mono), a Blackman
// window, an FFT, smoothing over time on the magnitudes, then decibels to bytes.
function makeFFT(N) {
  const bits = Math.log2(N), rev = new Uint32Array(N), cos = new Float64Array(N / 2), sin = new Float64Array(N / 2);
  for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = -Math.sin((2 * Math.PI * i) / N); }
  return (re, im) => {
    for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let s = 0; s < N; s += size) {
        for (let k = 0; k < half; k++) {
          const a = s + k, b = a + half, c = cos[k * step], d = sin[k * step];
          const tr = re[b] * c - im[b] * d, ti = re[b] * d + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  };
}
export function offlineSpectrum(buffer, { fftSize = 2048, smoothing = 0.55, minDb = -100, maxDb = -30 } = {}) {
  const N = fftSize, sr = buffer.sampleRate, chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  const fft = makeFFT(N), re = new Float64Array(N), im = new Float64Array(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N);
  const smooth = new Float64Array(N / 2), out = new Uint8Array(N / 2);
  return (t) => {
    const end = Math.round(t * sr);
    for (let i = 0; i < N; i++) {
      const k = end - N + i;
      let v = 0;
      if (k >= 0 && k < buffer.length) { for (const ch of chans) v += ch[k]; v /= chans.length; }
      re[i] = v * win[i]; im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) {
      const mag = Math.hypot(re[k], im[k]) / N;
      smooth[k] = smoothing * smooth[k] + (1 - smoothing) * mag;
      const db = smooth[k] > 0 ? 20 * Math.log10(smooth[k]) : -1000;
      out[k] = Math.max(0, Math.min(255, Math.floor((255 / (maxDb - minDb)) * (db - minDb))));
    }
    return out;
  };
}

// ── The words, drawn into the frame ─────────────────────────────────────
// The lyric line as the page sets it (css/loft.css #lyric), at the clip's size: the
// mood's typeface, what's been sung burning in the mood's bright tones, the word
// being sung filling as it's sung, feeling words in their own colour, a soft dark
// pool behind so they read over the brightest light.
const TYPE = {   // at 1920 wide: size (px), line height, letter spacing (em), case, font
  wide: [48, 1.2, -0.01, '', '600 {s}px "Unbounded", sans-serif'],
  serif: [74, 1.08, 0.005, '', 'italic 600 {s}px "Cormorant Garamond", Georgia, serif'],
  condensed: [80, 1.0, 0.025, 'upper', '400 {s}px "Anton", Impact, sans-serif'],
  light: [52, 1.25, 0.16, 'lower', '300 {s}px "Space Grotesk", sans-serif'],
  mono: [40, 1.3, 0.05, 'upper', '700 {s}px "Space Mono", monospace'],
};
const HOW_FIT = { adlib: 0.6, backing: 0.74, spoken: 0.8, whisper: 0.84, soft: 0.92, loud: 1.1 };
const css = (c) => `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
const mixc = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
const hex3 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

function drawLine(g, W, H, line, k, p, look, alpha, rise) {
  const [base, lh, ls, kase, font] = TYPE[look.type] || TYPE.wide;
  const n = line.text.length, fit = (n > 28 ? Math.max(0.62, Math.sqrt(28 / n)) : 1) * (HOW_FIT[line.how] || 1);
  const size = base * fit * (W / 1920) * (look.scale || 1);
  g.font = font.replace('{s}', size.toFixed(1));
  g.letterSpacing = `${(ls * size).toFixed(2)}px`;
  const words = line.words.map((w) => (kase === 'upper' ? w.w.toUpperCase() : kase === 'lower' ? w.w.toLowerCase() : w.w));
  // (a word space at least 0.3 em: the word being sung grows a little and must never touch its neighbours)
  const space = Math.max(g.measureText(' ').width, size * 0.3), widths = words.map((w) => g.measureText(w).width);
  // Balanced rows (text-wrap: balance) within the line's width.
  const maxW = Math.min(0.92 * W, 1300 * (W / 1920)), total = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
  const rowsN = Math.max(1, Math.ceil(total / maxW)), target = total / rowsN, rows = [[]];
  let acc = 0;
  words.forEach((w, i) => {
    const add = (rows[rows.length - 1].length ? space : 0) + widths[i];
    if (rows[rows.length - 1].length && acc + add > target * 1.08 && rows.length < rowsN) { rows.push([]); acc = 0; }
    rows[rows.length - 1].push(i); acc += (rows[rows.length - 1].length > 1 ? space : 0) + widths[i];
  });
  const lineH = size * lh, bottom = H * 0.81 + rise;
  // The pool of dark behind the words.
  const cy = bottom - (rows.length * lineH) / 2, rx = Math.min(W * 0.6, 750 * (W / 1920));
  const pool = g.createRadialGradient(W / 2, cy, 0, W / 2, cy, rx);
  pool.addColorStop(0, `rgba(0, 0, 0, ${0.5 * alpha})`); pool.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.save(); g.setTransform(1, 0, 0, 0.42, 0, cy * 0.58); g.fillStyle = pool; g.fillRect(0, cy - rx, W, rx * 2); g.restore();
  const c3 = look.c3, c4 = look.c4, unsung = mixc(c3, [1, 1, 1], 0.45);   // words still to come: a light tint of the mood
  g.textBaseline = 'alphabetic';
  rows.forEach((row, r) => {
    const rw = row.reduce((a, i, j) => a + widths[i] + (j ? space : 0), 0);
    let x = (W - rw) / 2;
    const y = bottom - (rows.length - 1 - r) * lineH - lineH * 0.22;
    for (const i of row) {
      const col = line.colors && line.colors[i] ? hex3(line.colors[i]) : null;
      const lit = col ? mixc(col, [1, 1, 1], 0.25) : mixc(c3, c4, 0.6);
      const now = i === k, sung = i < k;
      const a = alpha * (sung || now ? 1 : 0.6);
      const sc = now ? 1.05 : 1, wx = x + widths[i] / 2;
      g.save();
      g.translate(wx, y); g.scale(sc, sc); g.translate(-wx, -y);
      // unsung (or the unsung part of the word being sung)
      g.globalAlpha = a * 0.55; g.shadowBlur = 0; g.fillStyle = css(col ? mixc(col, [1, 1, 1], 0.2) : unsung);
      if (!sung) g.fillText(words[i], x, y);
      if (sung || now) {
        g.globalAlpha = a;
        g.shadowColor = css(col || c3); g.shadowBlur = (now ? 22 : 12) * (W / 1920);
        g.fillStyle = css(lit);
        if (now) { g.beginPath(); g.rect(x - 4, y - size * 1.5, (widths[i] + 8) * Math.max(0, Math.min(1, p)), size * 2.2); g.clip(); }
        g.fillText(words[i], x, y);
      }
      g.restore();
      x += widths[i] + space;
    }
  });
}

// ── Sending the frames ──────────────────────────────────────────────────
// Each finished frame is handed (as an ImageBitmap) to one of a few workers that
// compress it to a JPEG and post it with its number; the server puts them back in
// order. The page keeps drawing while they work.
const SENDER = `
let canvas, g;
onmessage = async (e) => {
  const { bitmap, i, url, quality } = e.data;
  try {
    if (!canvas) { canvas = new OffscreenCanvas(bitmap.width, bitmap.height); g = canvas.getContext('2d'); }
    g.drawImage(bitmap, 0, 0); bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    let r, tries = 0;
    for (;;) {   // a connection the server couldn't take yet is tried again; a refusal is final
      try { r = await fetch(url + '?i=' + i, { method: 'POST', body: blob }); break; }
      catch (err) { if (++tries >= 4) throw err; await new Promise((ok) => setTimeout(ok, 200 * tries)); }
    }
    postMessage({ i, error: r.ok ? null : (await r.text()) || String(r.status) });
  } catch (err) { postMessage({ i, error: String(err) }); }
};`;
function makeSenders(n, quality) {
  const url = URL.createObjectURL(new Blob([SENDER], { type: 'text/javascript' }));
  const workers = Array.from({ length: n }, () => new Worker(url));
  const waiting = new Map();   // frame -> { ok, no }
  let failed = null, next = 0;
  for (const w of workers) w.onmessage = (e) => {
    const p = waiting.get(e.data.i);
    waiting.delete(e.data.i);
    if (e.data.error) { failed = failed || new Error(`frame ${e.data.i}: ${e.data.error}`); if (p) p.no(failed); } else if (p) p.ok();
  };
  return {
    async send(bitmap, i, maxInFlight = 2 * n) {
      if (failed) throw failed;
      while (waiting.size >= maxInFlight) await Promise.race([...waiting.values()].map((p) => p.promise));
      const p = {}; p.promise = new Promise((ok, no) => { p.ok = ok; p.no = no; }); p.promise.catch(() => {});
      waiting.set(i, p);
      workers[next++ % n].postMessage({ bitmap, i, url: location.origin + '/api/render/frame', quality }, [bitmap]);
    },
    async drain() { while (waiting.size) await Promise.race([...waiting.values()].map((p) => p.promise)); if (failed) throw failed; },
    close() { workers.forEach((w) => w.terminate()); URL.revokeObjectURL(url); },
  };
}

// ── Takes ───────────────────────────────────────────────────────────────
// The camera's choices in a render roll dice seeded by the take (1 unless asked),
// and the room starts the render clean (main.js prepare/fresh): the same take of
// the same stretch is the same film, so a contact sheet shows what the MP4 will be
// and a fix re-renders what was good. Another take is another camera.
function takeDice(take) {
  let a = (Math.imul(take, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;
  return () => {   // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── The contact sheet ───────────────────────────────────────────────────
// A clip's moments as one image, to review before the render (loft.contactSheet)
// and after it (every render saves one): the first and last frames, a big drop's
// breath, hit and flare, each part's first moment, the camera's cuts (a glide
// caught halfway), the lyric lines once they're in. Each still is phone-sized (480
// wide for a landscape clip): words that read here read in a feed.
const KINDS = { edge: [0, '#ffd27a'], drop: [1, '#ff6b8b'], part: [2, '#b892ff'], cut: [3, '#6cc9ff'], line: [4, '#d9dbe3'] };   // rank, label colour
const clock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const stamp = (t) => `${Math.floor(t / 60)}-${String(Math.floor(t % 60)).padStart(2, '0')}`;   // as the server names files

// At most `max` stills: every edge, drop, part and cut first, then lines spread evenly.
function pickStills(stills, max) {
  const keep = stills.filter((s) => s.kind !== 'line').sort((a, b) => KINDS[a.kind][0] - KINDS[b.kind][0] || a.t - b.t).slice(0, max);
  const lines = stills.filter((s) => s.kind === 'line'), room = max - keep.length;
  const chosen = lines.length <= room ? lines : Array.from({ length: Math.max(0, room) }, (_, i) => lines[Math.floor(((i + 0.5) * lines.length) / room)]);
  return [...keep, ...chosen].sort((a, b) => a.t - b.t);
}

async function saveSheet(stills, title, file, tw, th) {
  const cols = tw > th ? 4 : 6, rows = Math.ceil(stills.length / cols), pad = 8, lab = 26, head = 44;
  const c = document.createElement('canvas');
  c.width = pad + cols * (tw + pad); c.height = head + rows * (th + lab + pad);
  const g = c.getContext('2d');
  g.fillStyle = '#0a0a0d'; g.fillRect(0, 0, c.width, c.height);
  g.textBaseline = 'middle';
  g.font = '600 18px "Space Grotesk", sans-serif'; g.fillStyle = '#e9eaf0';
  g.fillText(title, pad + 4, head / 2);
  g.font = '600 14px "Space Grotesk", sans-serif';
  stills.forEach((s, i) => {
    const x = pad + (i % cols) * (tw + pad), y = head + Math.floor(i / cols) * (th + lab + pad);
    g.drawImage(s.bitmap, x, y, tw, th);
    g.fillStyle = KINDS[s.kind][1];
    g.fillText(`${clock(s.t)}  ${s.label}`, x + 2, y + th + lab / 2);
  });
  const png = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  const res = await fetch('/api/render/sheet?file=' + encodeURIComponent(file), { method: 'POST', body: png });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || `contact sheet not saved (${res.status})`);
  return out.path;
}

// ── The render loop ─────────────────────────────────────────────────────
// ctx (from main.js): world, audio, begin(dice) hands the render the room,
// step(t, dt, spectrum) runs one frame of the show at song time t, prepare(t) puts
// the song's state there (like a seek), fresh() cuts to the take's first shot,
// moments() says what a sheet should show besides the cuts, lyric() what the words
// are doing, done() hands the show back. encode: false (loft.contactSheet) runs the
// same frames and keeps only the sheet.
export async function renderClip(opts, ctx) {
  const { world, audio, track } = ctx;
  if (!audio.buffer || !track) throw new Error('Load a song first.');
  if (track.file) throw new Error('Only songs from the music folder can be rendered (a dropped file has no path on disk).');
  const fps = opts.fps || 60, W = opts.width || 1920, H = opts.height || 1080;
  const from = Math.max(0, opts.from ?? 0), to = Math.min(audio.duration, opts.to ?? audio.duration);
  const frames = Math.round((to - from) * fps), dt = 1 / fps;
  if (frames < 1) throw new Error('Nothing to render: `to` must come after `from`.');
  const lyrics = opts.lyrics !== false, textScale = opts.textScale || 1;   // (bigger words read better on a phone)
  const encode = opts.encode !== false, take = Math.max(1, Math.round(opts.take || 1));
  const title = opts.name || track.title || track.name, name = title + (take > 1 ? ` take ${take}` : '');
  const say = opts.onProgress || ((m) => console.info('[loft] render:', m));
  if (encode) {
    const res = await fetch('/api/render/start', { method: 'POST', body: JSON.stringify({ track: track.url, name, from, to, fps, width: W, height: H }) });
    const job = await res.json();
    if (!res.ok) throw new Error(job.error || `render could not start (${res.status})`);
  }
  const spectrum = offlineSpectrum(audio.buffer, { fftSize: audio.analyser.fftSize, smoothing: audio.analyser.smoothingTimeConstant, minDb: audio.analyser.minDecibels, maxDb: audio.analyser.maxDecibels });
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  const canvas = world.renderer.domElement;
  world.renderSize(W, H, opts.supersample || 1.5);
  ctx.begin(takeDice(take));
  let cur = null, prev = null;   // the line on screen and the one leaving: { line, look, at }
  const senders = encode ? makeSenders(opts.workers || 4, opts.quality || 0.95) : null;
  // The stills the sheet wants, by frame: the song's moments now, the camera's cuts
  // as they come. Different kinds of moment within a quarter second of each other are
  // one still (the higher-ranked one's); a drop's breath, hit and flare stay a strip.
  const want = new Map(), stills = [], near = Math.round(0.25 * fps);
  const tw = W >= H ? 480 : 270, th = Math.round((tw * H) / W);
  const ask = (t, kind, label) => {
    const i = Math.min(frames - 1, Math.max(0, Math.round((t - from) * fps)));
    if (want.has(i) && KINDS[want.get(i).kind][0] <= KINDS[kind][0]) return;
    for (const [j, o] of want) if (j !== i && o.kind !== kind && Math.abs(j - i) < near) { if (KINDS[o.kind][0] <= KINDS[kind][0]) return; want.delete(j); }
    want.set(i, { kind, label });
  };
  ask(from, 'edge', 'first frame'); ask(to, 'edge', 'last frame');
  for (const m of ctx.moments(from, to)) ask(m.t, m.kind, m.label);
  try {
    // A run-up, unseen, from the world's clean start (main.js prepare), so the
    // colours, the core and the camera arrive at the first frame already in the song;
    // long enough that what the clean start can't reset (the gliding colours) has
    // arrived however the room was before. Its first step lands the take's first shot.
    const pre = Math.min(opts.preroll ?? 12, from);
    ctx.prepare(from - pre);
    ctx.step(from - pre, dt, spectrum(from - pre));
    ctx.fresh();
    for (let t = from - pre + dt; t < from - dt / 2; t += dt) ctx.step(t, dt, spectrum(t));
    const started = performance.now();
    let shot = world.director.shot;
    for (let i = 0; i < frames; i++) {
      const t = from + i * dt;
      ctx.step(t, dt, spectrum(t));
      const d = world.director;
      if (d.shot !== shot) { shot = d.shot; ask(t + (d.blendDur > 0 ? d.blendDur / 2 : 0.1), 'cut', `${d.blendDur > 0 ? 'glide' : 'cut'} to ${shot}`); }
      // A line arrives over 0.4 s, rising into place; the one before leaves over 0.6 s, rising away.
      const L = lyrics ? ctx.lyric(t) : null;
      if (L) {
        L.look.scale = textScale;
        if (L.line !== (cur && cur.line)) { if (cur) prev = { ...cur, at: t }; cur = L.line ? { line: L.line, look: L.look, at: t } : null; }
        if (cur) cur.look = L.look;
      }
      if (i % fps === 0) say(`${i} / ${frames} frames (${((performance.now() - started) / 1000).toFixed(0)} s)`);
      const still = want.get(i);
      if (!encode && !still) continue;   // (a sheet alone draws only the frames it keeps)
      g.drawImage(canvas, 0, 0, W, H);
      if (L) {
        if (prev && t - prev.at < 0.6) { const u = (t - prev.at) / 0.6; drawLine(g, W, H, prev.line, prev.line.words.length, 1, prev.look, (1 - u) * (1 - u), -26 * u * (H / 1080)); }
        if (cur) { const u = Math.min(1, (t - cur.at) / 0.4); drawLine(g, W, H, cur.line, L.k, L.p, L.look, u, 24 * (1 - u) * (1 - u) * (H / 1080)); }
      }
      if (still) stills.push({ t, ...still, bitmap: await createImageBitmap(out, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' }) });
      if (encode) await senders.send(await createImageBitmap(out), i);
    }
    let done = { take };
    if (encode) {
      await senders.drain();
      const fin = await fetch('/api/render/finish', { method: 'POST' });
      done = { ...(await fin.json()), take };
      if (!fin.ok) throw new Error(done.error || `render could not finish (${fin.status})`);
    }
    // The sheet. A render whose sheet can't be saved still delivers its clip.
    const kept = pickStills(stills, opts.stills || 24);
    const head = `${title} · ${clock(from)} to ${clock(to)} · ${W}×${H} ${fps} fps · take ${take}${encode ? '' : ' · preview'}`;
    try { done.sheet = await saveSheet(kept, head, `${name} (${stamp(from)} to ${stamp(to)})${encode ? '' : ' preview'}`, tw, th); }
    catch (err) { if (!encode) throw err; say(`contact sheet not saved: ${err.message}`); }
    done.stills = kept.map((s) => `${clock(s.t)} ${s.label}`);
    say(encode ? `done: ${done.path} (${done.frames} frames, ${done.mb} MB), sheet ${done.sheet}` : `sheet: ${done.sheet}`);
    return done;
  } catch (err) {
    if (encode) fetch('/api/render/cancel', { method: 'POST' }).catch(() => {});
    throw err;
  } finally {
    for (const s of stills) s.bitmap.close();
    if (senders) senders.close();
    ctx.done();
    world.resize();
  }
}
