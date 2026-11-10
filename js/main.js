import { AudioEngine } from './audio.js';
import { Conductor, bsearch } from './conductor.js';
import { World } from './visuals.js';
import { parseLyrics, timeLyrics, lineAt, markHooks } from './lyrics.js';
import { Voice, Kokoro } from './voice.js';
import { readSong, lineEmotion, wordFeel, scoreLine, PALETTES, songLook } from './emotion.js';
import { UI } from './ui.js';
import { planWeather } from './weather.js';
import { renderClip } from './render.js';
import { makeSettings } from './settings.js';

// ── small persisted prefs (per browser; the loft works without them) ──
const prefs = {
  get(k, d) {
    try { const v = localStorage.getItem('loft.' + k); return v === null ? d : JSON.parse(v); }
    catch (err) { console.warn('[loft] prefs unreadable:', err); return d; }
  },
  set(k, v) {
    try { localStorage.setItem('loft.' + k, JSON.stringify(v)); }
    catch (err) { console.warn('[loft] prefs not saved:', err); }
  },
};

const ui = new UI();
const report = (msg, err) => { console.error('[loft]', msg, err || ''); ui.toast(msg, 'error', 6000); };
window.addEventListener('error', (e) => report('Error: ' + e.message, e.error));
window.addEventListener('unhandledrejection', (e) => report('Error: ' + (e.reason && e.reason.message || e.reason), e.reason));

const audio = new AudioEngine();
const conductor = new Conductor();
const voice = new Voice((m) => ui.toast(m, 'warn'));
const kokoro = new Kokoro(audio.ctx);
let world;
try {
  world = new World(document.getElementById('gl'), { sampleRate: audio.ctx.sampleRate });
} catch (err) {
  ui.fatal(err.message);
  throw err;
}

// ── state ─────────────────────────────────────────────────────────────
let tracks = [];
let current = -1;
let loadToken = 0;
let loadingTrack = false;   // a song is loading (or being greeted): play/pause and seeks wait for it
let map = null;
let lines = [], lineIdx = -1, wordIdx = -1;
let screamRuns = [];   // screamed stretches of the song: [[start, end]] (planVideo)
let voiceLines = [], voiceIdx = 0;
let speaking = false;
const voiceOn = true;   // the voice is always on (its toggle is gone)
let lyricsOn = prefs.get('lyrics', true);   // T: words on screen, or just the room

const syncOffset = 0;
// A clip is being rendered (render.js): the show runs on the song's clock, silent,
// and everything that waits for the music to be playing counts it as playing.
let rendering = false;
const live = () => audio.playing || rendering;
let entered = false;
const analysisCache = new Map();

audio.setVolume(prefs.get('volume', 0.9));
ui.el.vol.value = prefs.get('volume', 0.9);
setLyricsShown(lyricsOn, true);
ui.setStats({ bpm: 0 });

// ── analysis worker ───────────────────────────────────────────────────
const worker = new Worker(new URL('./analysis.worker.js', import.meta.url), { type: 'module' });
const jobs = new Map();
let jobId = 0;
worker.onmessage = (e) => {
  const job = jobs.get(e.data.id);
  if (!job) return;
  if (e.data.type === 'progress') job.progress(e.data.p);
  else if (e.data.type === 'done') { jobs.delete(e.data.id); job.resolve(e.data.result); }
  else { jobs.delete(e.data.id); job.reject(new Error(e.data.message)); }
};
worker.onerror = (e) => {
  report('Song analysis crashed: ' + e.message, e);
  for (const j of jobs.values()) j.reject(new Error('analysis worker crashed'));
  jobs.clear();
};
// The worker gets copies of the channels (a fast native copy) and mixes them down
// itself. Analyses are cached as promises, so a song being analysed for the
// preloader is never analysed twice when you skip to it.
// The copy is made a few seconds of audio at a time, yielding between slices, so
// it never holds up a frame (a whole song in one go took 60-200 ms). In a hidden
// tab there are no frames to hold up, and timers are throttled to one a second or
// slower there, so it copies straight through.
async function analyzeBuffer(buffer, progress) {
  const channels = [], n = buffer.length, slice = buffer.sampleRate * 8;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = new Float32Array(n);
    for (let o = 0; o < n; o += slice) {
      buffer.copyFromChannel(d.subarray(o, Math.min(n, o + slice)), c, o);
      if (!document.hidden) await new Promise((r) => setTimeout(r, 0));
    }
    channels.push(d);
  }
  return new Promise((resolve, reject) => {
    const id = ++jobId;
    jobs.set(id, { resolve, reject, progress });
    worker.postMessage({ id, channels, sampleRate: buffer.sampleRate }, channels.map((d) => d.buffer));
  });
}
// Whoever is waiting for a song's analysis now gets its progress (a song the
// preloader started is still shown 'Listening to the song' as it finishes).
const progressFor = new Map();
function analysisOf(track, buffer, progress = () => {}) {
  progressFor.set(track.key, progress);
  let p = analysisCache.get(track.key);
  if (!p) {
    p = analyzeBuffer(buffer, (x) => (progressFor.get(track.key) || (() => {}))(x));
    analysisCache.set(track.key, p);
    p.catch(() => analysisCache.delete(track.key));
    p.finally(() => progressFor.delete(track.key)).catch(() => {});
  }
  return p;
}

// ── tracks ────────────────────────────────────────────────────────────
const splitName = (name) => {
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(name);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: name };
};
// Windows can't keep "?" in filenames and copies get "(1)": show the real title.
// A number glued to the front ("7Some Title") is a stray track number, not the title.
// Suno's style tag after the title (" — 2011 stadium pop-rock") isn't part of it.
// A "(1)" copy is the song's cover (Suno's second version).
const prettyName = (name) => {
  const cover = /\s*\(1\)\s*$/.test(name);
  const t = name.replace(/\s*\(\d+\)\s*$/, '').replace(/\s+[—–-]\s+(?:19|20)\d\d.*$/, '')
    .replace(/_$/, '?').replace(/^\d+(?=[A-Z][a-z])/, '').trim();
  return cover && !/cover\)?$/i.test(t) ? t + ' cover' : t;
};
const readText = async (src) => {
  if (src instanceof File) return await src.text();
  const r = await fetch(src);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${decodeURIComponent(src)}`);
  return await r.text();
};
let announced = 0;
const spokenName = (title, artist) => {
  const cover = /\(?\bcover\)?$/i.test(title);
  const core = title.replace(/\s*\(?\bcover\)?\s*$/i, '').trim();
  return `${core}${cover ? ', the cover' : ''}${artist ? ', by ' + artist : ''}`;
};
function announcement(title, artist) {
  const name = spokenName(title, artist);
  if (announced++ === 0) return `The loft is open. Now playing: ${name}.`;
  const lead = ['Now playing:', 'This is', 'Here comes'][Math.floor(Math.random() * 3)];
  return `${lead} ${name}.`;
}
// Said in the outro of the song before, radio style.
function upNext(title, artist) {
  const lead = ['Up next:', 'Coming up:', 'Next up,'][Math.floor(Math.random() * 3)];
  return `${lead} ${spokenName(title, artist)}.`;
}

async function loadTrackList() {
  try {
    const r = await fetch('/api/tracks');
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const data = await r.json();
    tracks = data.tracks.map((t) => ({ ...t, key: t.url }));
  } catch (err) {
    report('Could not read the music folder (is START THE LOFT.bat running?): ' + err.message, err);
    tracks = [];
  }
  ui.setTracks(tracks, current, playTrack);
}

// why: 'user' (picked, next, previous) or 'ended' (the song finished).
async function playTrack(i, why = 'user') {
  if (!tracks.length) return;
  i = ((i % tracks.length) + tracks.length) % tracks.length;
  const track = tracks[i];
  const token = ++loadToken;
  loadingTrack = true;
  // Leaving a song you'd actually started, before hearing half of it, is a skip.
  const skipped = why === 'user' && current >= 0 && i !== current && heardThisLoad >= 1 && heardThisLoad < (audio.duration || 1e9) / 2;
  reportListening(false, skipped);
  current = i;
  heardThisLoad = 0; countedThisLoad = false;
  ui.setTracks(tracks, current, playTrack);
  ui.setEmpty(false);
  audio.stop();
  conductor.prevT = -1;    // a new song starts fresh: not a seek (no snaps to the old song's intro)
  world.heartUntil = -1;   // the heart fades out while the next song loads
  ui.dropPendingCard();
  stopSpeech();
  ui.lyricClear();
  ui.setPlaying(false);
  const stale = () => token !== loadToken;

  try {
    ui.loading('Fetching ' + track.name, 0.02);
    // Text files are tiny: read them first so the voice can start rendering early.
    const lyricText = track.lyrics ? readText(track.lyrics) : null;
    const voiceText = track.voice ? readText(track.voice) : null;
    if (lyricText) lyricText.catch(() => {});   // failures are reported where awaited
    if (voiceText) voiceText.catch(() => {});
    for (const k of [...bufferCache.keys()]) if (k !== track.key) bufferCache.delete(k);
    const preloaded = bufferCache.has(track.key);
    const bufferP = loadBuffer(track);
    bufferP.catch(() => {});

    let parsed = null, rawVoice = [];
    if (lyricText) {
      try { parsed = parseLyrics(await lyricText, track.lyricsName || track.lyrics); }
      catch (err) { report('Lyrics for "' + track.name + '" could not be read: ' + err.message, err); }
    }
    if (voiceText) {
      try { rawVoice = parseLyrics(await voiceText, 'voice.lrc').lines.filter((l) => l.text); }
      catch (err) { report('Voice lines for "' + track.name + '" could not be read: ' + err.message, err); }
    }
    const nm = splitName(prettyName(track.name));
    const title = (parsed && parsed.meta.ti && prettyName(parsed.meta.ti)) || nm.title;
    const artist = (parsed && parsed.meta.ar) || nm.artist;
    // Kokoro renders on the CPU while the song decodes and gets analysed.
    const introText = track.introText || announcement(title, artist);   // the preloader may have written it already
    delete track.introText;
    const intro = voiceOn && kokoro.ok ? kokoro.prepare(introText) : null;
    if (voiceOn && kokoro.ok) rawVoice.forEach((l) => { l.clip = kokoro.prepare(l.text); });

    if (!preloaded) ui.loading('Decoding', 0.1);
    const buffer = await bufferP;
    if (stale()) return;

    let m = null;
    try {
      ui.loading('Listening to the song', 0.15);
      m = await analysisOf(track, buffer, (p) => { if (!stale()) ui.loading('Listening to the song', 0.15 + p * 0.8); });
    } catch (err) { if (stale()) return; throw err; }
    if (stale()) return;

    map = m;
    lines = parsed ? feel(markHooks(timeLyrics(parsed, buffer.duration, m.onsets))) : [];
    planVideo();
    mood = readSong(map, lines, partSpans());
    lastHeroT = -99;
    voiceLines = rawVoice;
    conductor.setMap(map);
    if (!parts.length) planColour(map);      // songs without written parts: colour by the analysis' sections
    applyMood();                       // the new song's feeling chooses its first form
    world.setTrack(track.name, map);
    audio.setBuffer(buffer);
    lineIdx = -1; wordIdx = -1; voiceIdx = 0;

    track.title = title; track.artist = artist;
    showNowPlaying(track);
    ui.setMap(map, lines, buffer.duration);
    ui.setStats({ bpm: map.bpm });
    ui.loading(null);
    // (No title card: the announcer says the name and the player bar shows it.)

    // The announcer never talks over the singing (see "the announcer" below).
    const firstSung = Math.min(lines.length ? lines[0].t : Infinity, voiceLines.length ? voiceLines[0].t : Infinity);
    const already = announcedNext === track.key;     // said in the last song's outro
    announcedNext = null; outroSaid = false;
    let greeted = false;
    if (voiceOn && intro && !already && firstOfSession && firstSung < 6) {
      // Walking in: the greeting first, then the music (Kokoro gets 4 s to wake up).
      ui.loading('The loft is waking up', 1);
      const clip = await withTimeout(intro, 4000);
      ui.loading(null);
      if (stale()) return;
      if (clip) {
        startSpeech(clip);
        greeted = true;
        await sleep(Math.max(0, clip.buffer.duration - 0.4) * 1000);
        if (stale()) return;
      }
    }
    firstOfSession = false;
    loadingTrack = false;
    await audio.play(0);
    ui.setPlaying(true);
    if (voiceOn && !already && !greeted) say(introText, { prepared: intro, maxWait: 6, before: firstSung });
    watchLyrics(track, token);
    schedulePrefetch(token);
  } catch (err) {
    if (stale()) return;
    loadingTrack = false;
    ui.loading(null);
    report(`"${track.name}" could not play: ${err.message}`, err);
  }
}

// ── preload + shuffle ─────────────────────────────────────────────────
// While a song plays, the next one is fetched, decoded, analysed and its
// announcement rendered, so skipping (or a song ending) starts instantly.
const bufferCache = new Map();   // track key -> Promise<AudioBuffer>; current + next only
function loadBuffer(track) {
  if (bufferCache.has(track.key)) return bufferCache.get(track.key);
  const p = (async () => {
    const bytes = track.file ? await track.file.arrayBuffer() : await fetch(track.url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.arrayBuffer();
    });
    return await audio.decode(bytes);
  })();
  p.catch(() => bufferCache.delete(track.key));
  bufferCache.set(track.key, p);
  return p;
}
let prefetchTimer = 0;
function schedulePrefetch(token) {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(async () => {
    if (token !== loadToken || tracks.length < 2) return;
    const next = tracks[((nextIndex(1) % tracks.length) + tracks.length) % tracks.length];
    if (!next || next === tracks[current]) return;
    try {
      const buf = await loadBuffer(next);
      if (token !== loadToken) return;
      await analysisOf(next, buf);
      if (voiceOn && kokoro.ok && !next.introText) {
        const nm = splitName(prettyName(next.name));
        next.introText = announcement(nm.title, nm.artist);
        next.outroText = upNext(nm.title, nm.artist);
        kokoro.prepare(next.introText).catch(() => {});   // reported if it fails when actually spoken
        kokoro.prepare(next.outroText).catch(() => {});
      }
    } catch (err) {
      console.warn('[loft] preloading the next song failed; it will load normally:', err);
    }
  }, 1500);   // give the current song a moment to settle first
}

// Shuffle (on by default): every visit builds a fresh order that starts with
// the songs you've heard least. Recently heard songs sink further back, ties
// are shuffled, and a song never plays right after its own cover.
let shuffle = prefs.get('smartShuffle', true), order = [];
// "Holy Anyway" and "Holy Anyway cover" are the same song: never back to back.
const baseName = (n) => prettyName(n).replace(/\s*\(?\bcover\)?$/i, '').trim().toLowerCase();
// A cover is the same song in another voice, so half of what you've heard of
// its other version (kin) counts toward it too.
const heardOf = (t) => (t.plays || 0) + (t.listened || 0) / 300;
function heardScore(t, kin = 0) {
  const hoursAgo = t.last ? (Date.now() / 1000 - t.last) / 3600 : Infinity;
  const recent = hoursAgo < 8 ? 2 * (1 - hoursAgo / 8) : 0;
  return heardOf(t) + 0.5 * kin + 0.8 * (t.skips || 0) + recent + Math.random() * 0.9;
}
function buildOrder() {
  const idx = tracks.map((_, i) => i).filter((i) => i !== current);
  const family = new Map();
  for (const t of tracks) family.set(baseName(t.name), (family.get(baseName(t.name)) || 0) + heardOf(t));
  // Songs marked "not for me" go to the very end.
  const score = new Map(idx.map((i) => {
    const t = tracks[i];
    return [i, heardScore(t, family.get(baseName(t.name)) - heardOf(t)) + (t.disliked ? 1e6 : 0)];
  }));
  idx.sort((a, b) => score.get(a) - score.get(b));
  if (current >= 0) idx.unshift(current);
  for (let i = 1; i < idx.length; i++) {
    const prev = baseName(tracks[idx[i - 1]].name);
    if (baseName(tracks[idx[i]].name) !== prev) continue;
    for (let j = i + 1; j < idx.length; j++) {
      if (baseName(tracks[idx[j]].name) !== prev && !tracks[idx[j]].disliked) { [idx[i], idx[j]] = [idx[j], idx[i]]; break; }
    }
  }
  order = idx;
}
// Songs marked "not for me" never come up on their own (you can still pick them).
function nextIndex(dir) {
  const n = tracks.length, ok = (i) => !tracks[((i % n) + n) % n].disliked;
  const anyOk = tracks.some((t) => !t.disliked);
  if (!shuffle || n < 3) {
    let i = current + dir;
    for (let k = 0; k < n && anyOk && !ok(i); k++) i += dir;
    return i;
  }
  if (order.length !== n || !order.includes(current)) buildOrder();
  let p = order.indexOf(current);
  for (let k = 0; k < n; k++) {
    p = (p + dir + n) % n;
    if (!anyOk || ok(order[p])) return order[p];
  }
  return order[p];
}

// Songs once marked "not for me" (cache/plays.json) still stay out of shuffle.
function toggleShuffle() {
  shuffle = !shuffle;
  prefs.set('smartShuffle', shuffle);
  ui.setShuffle(shuffle);
  if (shuffle) buildOrder();
  ui.toast(shuffle ? 'Shuffle on: least-heard songs first' : 'Shuffle off: album order');
  for (const t of tracks) delete t.introText;
  schedulePrefetch(loadToken);
}

// ── listening history ─────────────────────────────────────────────────
// Time actually heard goes to the server (cache/plays.json) every 20 s, on
// track change and when the page closes. A song counts as a play once you've
// heard 30 s or a third of it; leaving one before its halfway point is a skip.
// Skips push a song back in the shuffle, and songs you keep skipping get
// flagged in the drawer as maybe-remove (nothing is ever deleted).
let heardThisLoad = 0, unreported = 0, countedThisLoad = false;
function reportListening(final = false, skip = false) {
  const t = tracks[current];
  if (!t || t.file || (unreported < 1 && !skip)) { unreported = 0; return; }
  const play = !countedThisLoad && heardThisLoad >= Math.min(30, (audio.duration || 90) / 3);
  if (play) countedThisLoad = true;
  const body = JSON.stringify({ name: t.name, seconds: Math.round(unreported * 10) / 10, play, skip });
  t.listened = (t.listened || 0) + unreported;
  if (play) t.plays = (t.plays || 0) + 1;
  if (skip) t.skips = (t.skips || 0) + 1;
  t.last = Date.now() / 1000;
  unreported = 0;
  if (final && navigator.sendBeacon) { navigator.sendBeacon('/api/played', body); return; }
  fetch('/api/played', { method: 'POST', body }).then((r) => {
    if (!r.ok) console.warn('[loft] listening history not saved:', r.status, r.statusText);
  }, (err) => console.warn('[loft] listening history not saved:', err));
  if (play || skip) ui.setTracks(tracks, current, playTrack);
}
window.addEventListener('pagehide', () => reportListening(true));

// ── auto-lyrics ───────────────────────────────────────────────────────
// The server transcribes songs in the background (Whisper, cached once). A song
// without lyrics asks to go first; when its lyrics land, they slide in live.
let lyricWatch = 0;
async function lyricsStatus(want) {
  const r = await fetch('/api/lyrics' + (want ? '?want=' + encodeURIComponent(want) : ''));
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return await r.json();
}
function showLyricsProgress(j) {
  if (j.state === 'error') { ui.setLyricsProgress('Auto-lyrics off: ' + (j.error || 'unavailable')); return; }
  const left = j.total - j.done;
  ui.setLyricsProgress(left > 0
    ? `Lyrics: ${j.done} of ${j.total} songs${j.working ? ` · listening to "${j.working}"` : ''}`
    : `Lyrics: all ${j.total} songs ready`);
}
function watchLyrics(track, token) {
  clearInterval(lyricWatch);
  const next = tracks[((nextIndex(1) % tracks.length) + tracks.length) % tracks.length];
  if (next && !next.lyrics && !next.file && next !== track) lyricsStatus(next.name).catch(() => {});
  if (track.lyrics || track.file) return;
  const poll = async () => {
    if (token !== loadToken) { clearInterval(lyricWatch); return; }
    let j;
    try { j = await lyricsStatus(track.name); }
    catch (err) { console.warn('[loft] lyrics status unavailable:', err); return; }
    if (token !== loadToken) return;   // a poll for the last song came back late: the new song's watch is not its to stop
    showLyricsProgress(j);
    const st = j.song && j.song.status;
    if (j.state === 'error' || st === 'error') { clearInterval(lyricWatch); return; }
    if (st === 'done') {
      clearInterval(lyricWatch);
      track.lyrics = j.song.url;
      track.lyricsAuto = true;
      ui.setTracks(tracks, current, playTrack);
      try {
        const parsed = parseLyrics(await readText(track.lyrics), track.lyrics);
        if (token !== loadToken || !map) return;
        lines = feel(markHooks(timeLyrics(parsed, audio.duration, map.onsets)));
        planVideo();
        mood = readSong(map, lines, partSpans());
        showNowPlaying(track);
        lineIdx = -2;
        ui.setMap(map, lines, audio.duration);
        ui.toast(`Lyrics are in: ${lines.length} lines, heard by the loft`);
      } catch (err) { report('Auto-lyrics could not be read: ' + err.message, err); }
    }
  };
  poll();
  lyricWatch = setInterval(poll, 4000);
}
ui.onDrawerOpen = () => lyricsStatus().then(showLyricsProgress, (err) => console.warn('[loft] lyrics status unavailable:', err));

// ── feeling ───────────────────────────────────────────────────────────
// The song's mood (harmony + energy + words) colours the room section by
// section; a sung line with its own clear feeling bleeds into it.
let mood = null;
// The song's words direct its video: its parts, its colour script, its screams
// and the weather its words call for.
function planVideo() {
  planParts();
  if (parts.length) planColourByParts(); else if (map) planColour(map);
  // Screamed stretches (lines written in capitals), the short gaps between their
  // lines bridged: the song's rawest moments, rewarded like a big drop (World.scream).
  // A run ends where the screaming does (not where the line's display ends), and
  // when a scream opens its part it starts on that part's downbeat, so the part
  // change and the scream are one moment.
  screamRuns = [];
  for (const l of lines) {
    if (!l.scream) continue;
    const last = l.words && l.words.length ? l.words[l.words.length - 1].t + 0.8 : l.end;
    const e = l.sungEnd != null ? Math.min(l.sungEnd, l.end) : Math.min(l.end, last);
    const part = parts.find((p) => p.t <= l.t && l.t - p.t < 2.6 && lines.find((x) => x.t >= p.t && x.how !== 'adlib') === l);
    const r = screamRuns[screamRuns.length - 1];
    if (r && l.t - r[1] < 2.5) r[1] = Math.max(r[1], e); else screamRuns.push([part ? part.t : l.t, e]);
  }
  planWeather(lines);
}
// The song's parts, from the [Verse]/[Chorus]/[Bridge] marks in its lyrics:
// [{ t, part }], each starting on the downbeat at (or just before) its first
// sung line. The camera follows them (World.setPart).
let parts = [];
const PART_OF = (label) => {
  const s = (label || '').toLowerCase();
  if (/pre[- ]?chorus|build/.test(s)) return 'prechorus';
  if (/chorus|hook|refrain/.test(s)) return 'chorus';
  if (/bridge|break|interlude|solo|drop/.test(s)) return 'bridge';
  if (/outro|coda|end/.test(s)) return 'outro';
  if (/intro/.test(s)) return 'intro';
  return 'verse';
};
function planParts() {
  parts = [];
  if (!map || !lines.some((l) => l.section)) return;
  const db = map.downbeats, onBeat = (t) => { const i = bsearch(db, t + 0.05); return i >= 0 && t - db[i] < 2.5 ? db[i] : t; };
  parts.push({ t: 0, part: 'intro' });
  // Each run of lines under one [sec:] mark. A lone stray line the aligner put
  // under another mark (A, a second of B, A) is no part of its own.
  const runs = [];
  for (const l of lines) {
    if (l.how === 'adlib' || l.secIdx == null) continue;
    const r = runs[runs.length - 1];
    if (r && r.secIdx === l.secIdx) r.n++;
    else runs.push({ secIdx: l.secIdx, part: PART_OF(l.section), label: l.section, t: l.t, n: 1 });
  }
  runs.forEach((r, i) => {
    const prev = runs[i - 1], next = runs[i + 1];
    if (r.n === 1 && prev && next && prev.part === next.part && r.part !== prev.part && next.t - r.t < 4) return;
    if (r.part !== parts[parts.length - 1].part) parts.push({ t: onBeat(r.t), part: r.part, label: r.label });
  });
  // Choruses: the same place, deeper each time (depth 0 the first, 1 the last or
  // the one the lyrics call final).
  const choruses = parts.filter((p) => p.part === 'chorus');
  choruses.forEach((p, n) => { p.depth = /final|last/i.test(p.label || '') ? 1 : choruses.length > 1 ? n / (choruses.length - 1) : 1; });
  const last = lines[lines.length - 1];
  if (last && map.duration - last.end > 8 && parts[parts.length - 1].part !== 'outro') parts.push({ t: onBeat(last.end + 2), part: 'outro' });
}
// The parts as spans, for reading each one's feeling (emotion.js readSong).
function partSpans() {
  return parts.map((p, i) => ({ start: p.t, end: i + 1 < parts.length ? parts[i + 1].t : map.duration, part: p.part, label: p.label || p.part, group: p.part === 'chorus' ? 'chorus' : null }));
}
function partIndexAt(t) {
  let lo = 0, hi = parts.length - 1, ans = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (parts[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
function partAt(t) {
  let lo = 0, hi = parts.length - 1, ans = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (parts[mid].t <= t) { ans = parts[mid].part; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
// A feeling's colour for a sung word: its bright tone, or its accent where that
// tone is green (fear's mint), which the house never wears.
const wordHex = (e) => {
  const hex = PALETTES[e].ramp[3], [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return g > r * 1.25 && g > b * 1.1 ? PALETTES[e].accent : hex;
};
function feel(ls) {
  for (const l of ls) {
    l.emotion = lineEmotion(l.text);
    // Each word's own feeling (weighted), and how charged the whole line is.
    l.wordFeel = l.words.map((w) => wordFeel(w.w));
    l.colors = l.wordFeel.map((wf) => (wf && wf.w >= 0.6 ? wordHex(wf.e) : null));
    // (words that only lean toward a feeling are tinted faintly on screen, by how much)
    l.lean = l.wordFeel.map((wf) => (wf && wf.w >= 0.3 && wf.w < 0.6 ? [wordHex(wf.e), wf.w] : null));
    const s = scoreLine(l.text, l.words);
    l.charge = Math.min(1, s.total / 2.5);
    l.dissolve = s.ax.dissolve >= 0.4 ? 1 - Math.exp(-s.ax.dissolve / 1.2) : 0;   // a line that sings the self away
    let best = null;
    for (const e in s.v) if (s.v[e] > 0 && (!best || s.v[e] > s.v[best])) best = e;
    l.top = best;
  }
  return ls;
}
function showNowPlaying(track) {
  const m = mood && mood.song;
  ui.nowPlaying(track.title || track.name, [
    track.artist, map ? `${map.bpm.toFixed(0)} BPM` : '', map && map.key ? map.key : '',
    m ? (m.top || [m.primary]).slice(0, 3).join(' · ') : '',
    lines.length ? `${lines.length} lines` : 'no lyrics yet',
  ].filter(Boolean).join(' · '));
}
function sectionMood() {
  if (!mood || !mood.sections.length) return { primary: 'calm', secondary: 'calm' };
  const i = parts.length ? partIndexAt(conductor.f.t) : conductor.f.sectionIdx;   // the written parts when the song has them
  return mood.sections[Math.max(0, Math.min(mood.sections.length - 1, i))];
}
// ── colour that follows the song ──────────────────────────────────────
// A colour script, as a film colourist would draw one, plus the harmony:
// - every section gets its own key in the feeling's harmony: quiet sections lean
//   cool, loud ones warm and vivid, a drop furthest; two neighbouring sections
//   never share a key, and the last one comes home;
// - each bar's chord moves the hue around the circle of fifths: the home chord
//   is home colour, chords further from home carry it further, and when the
//   music resolves the colour comes home with it.
let colourScript = [];
// By the song's written parts: verses cool, the pre-chorus lifting, choruses warm
// and vivid (a chorus after the bridge most of all), the bridge in contrast, the
// outro home.
const PART_KEY = { intro: [-20, 0.92], verse: [-10, 1], prechorus: [8, 1.06], chorus: [24, 1.16], bridge: [-36, 1.02], outro: [0, 0.9] };
function planColourByParts() {
  let bridged = false, verses = 0;
  colourScript = parts.map((p) => {
    let [shift, sat] = PART_KEY[p.part] || [0, 1];
    if (p.part === 'bridge') bridged = true;
    if (p.part === 'chorus' && bridged) { shift += 12; sat += 0.09; }    // the last chorus, after the bridge, goes furthest
    if (p.part === 'verse') shift += verses++ % 2 ? 8 : -8;              // each verse in its own light
    return { shift, sat };
  });
}
function planColour(m) {
  const S = m.sections || [];
  colourScript = S.map((s, i) => {
    const base = [-24, -8, 14, 28][s.level] ?? 0;
    const sway = i % 2 ? 12 : -12;                   // neighbours never share a key
    const shift = i === S.length - 1 && S.length > 2 ? 0 : s.drop ? 46 : base + sway;
    return { shift, sat: [0.92, 1, 1.1, 1.2][s.level] * (s.drop ? 1.1 : 1) };
  });
}
const FIFTHS = (pc) => (pc * 7) % 12;               // position on the circle of fifths
function chordShift(t) {
  const C = map && map.chords;
  if (!C || !C.length || map.tonic == null) return 0;
  let lo = 0, hi = C.length - 1, i = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (C[mid].t <= t + 0.05) { i = mid; lo = mid + 1; } else hi = mid - 1; }
  if (i < 0 || C[i].score < 0.25) return 0;
  // A minor chord sits beside its relative major (Am beside C): measure from there.
  const root = C[i].minor ? (C[i].root + 3) % 12 : C[i].root;
  const home = map.mode === 'minor' ? (map.tonic + 3) % 12 : map.tonic;
  let d = FIFTHS(root) - FIFTHS(home);
  d = ((d + 18) % 12) - 6;                          // -6..5 steps from home
  return Math.max(-66, Math.min(66, d * 22)) + (C[i].minor ? -10 : 6);
}
// A big drop carries the colour furthest from home (and richest) for its whole
// loud stretch, landing over its first two beats.
function dropColour(shift) {
  const f = conductor.f;
  if (f.reign < 0 || !f.reignDrop) return [0, 0];
  const k = Math.min(1, (f.t - f.reignDrop.t) / Math.max(0.2, f.beatLen * 2));
  return [(shift >= 0 ? 30 : -30) * k, 0.14 * k];
}
// A scream's rage stays red: the part, drop and chord keys would turn it magenta or
// lime, so while it lasts they barely move it, and the colour doesn't over-saturate.
function screamKey(shift, sat) {
  const s = world.scream;
  world.colorKey(shift * (1 - 0.85 * s), sat + (1.08 - sat) * s);
}
function applyColour(t) {
  const f = conductor.f;
  if (parts.length) {
    const sec = colourScript[partIndexAt(t)] || { shift: 0, sat: 1 };
    const [dShift, dSat] = dropColour(sec.shift);
    screamKey(Math.max(-80, Math.min(80, sec.shift + dShift + chordShift(t) * (1 - 0.7 * world.resolve))), sec.sat + dSat);   // the outro: the hue stops wandering, comes home
    return;
  }
  const i = Math.max(0, Math.min(colourScript.length - 1, f.sectionIdx));
  const sec = colourScript[i] || { shift: 0, sat: 1 };
  // A long section still moves: every 8-bar phrase leans the other way.
  const s = map.sections[i], barsIn = s ? Math.max(0, f.barIdx - (s.bar0 || 0)) : 0;
  const phrase = s && s.bars > 12 ? (Math.floor(barsIn / 8) % 2 ? 14 : -14) : 0;
  // never so far that the feeling stops being itself
  const [dShift, dSat] = dropColour(sec.shift + phrase);
  screamKey(Math.max(-80, Math.min(80, sec.shift + phrase + dShift + chordShift(t))), sec.sat + dSat);
}

let moodOverride = null;   // DevTools: loft.moodOverride = 'anger' pins a feeling
function applyMood() {
  if (moodOverride) { world.setMood(moodOverride, moodOverride); return; }
  if (!mood) { world.setMood('mystery'); return; }   // the room at rest: violet, cyan and pink (never the peach-and-orange it wore)
  const sm = sectionMood(), line = lineIdx >= 0 ? lines[lineIdx] : null;
  // A scream is rage, whatever the words grieve: the room burns red, the embers rise,
  // the core's heart blazes orange.
  if (world.scream > 0.5 && !loadingTrack) { world.setMood('anger'); return; }
  // The sung feeling glints over the part's own (in the brightest tones and the
  // accent, never the shadows): a swell that rises with the line and lingers.
  const e = world.feelE, amt = Math.round(world.feelAmt * 20) / 20;
  const bleed = e && e !== sm.primary && amt > 0 ? e : null;
  // The song's signature look (emotion.js LOOKS) washes over its choruses and bridges,
  // its own feeling still the accent underneath.
  const look = (world.part === 'chorus' || world.part === 'bridge') && songLook(tracks[current] && tracks[current].name);
  if (look) { world.setMood(look, sm.primary, bleed, bleed ? amt : 0, false, sm); return; }
  world.setMood(sm.primary, sm.secondary, bleed, bleed ? amt : 0, false, sm);
}
// How a line is set: the mood's typeface and motion; long lines a little
// smaller so they sit in two balanced rows; directions from your lyrics
// ((Spoken), (Soft), ad-libs, backing lines) change its voice; and the next
// line waits faintly underneath so you can sing along.
const HOW_FIT = { adlib: 0.6, backing: 0.74, spoken: 0.8, whisper: 0.84, soft: 0.92, loud: 1.1 };
function lineLook(line, li) {
  const P = PALETTES[sectionMood().primary];
  const n = line.text.length;
  const fit = (n > 28 ? Math.max(0.62, Math.sqrt(28 / n)) : 1) * (HOW_FIT[line.how] || 1);
  const nx = lines[li + 1];
  const next = nx && nx.how !== 'adlib' && nx.t - line.end < 4 ? nx.text : null;
  return { type: P.type, motion: P.motion, hook: line.hook, first: line.first, how: line.how, fit, next, colors: line.colors, lean: line.lean };
}

// ── speech ────────────────────────────────────────────────────────────
// Kokoro clips play on the audio graph and their words fire on the audio
// clock, so each caption word lights on its syllable. The browser voice is
// only a fallback.
let speech = null, sayToken = 0;

// Speaks `text`. Resolves true if it started. `before`: song time of the first
// sung word; the line is skipped if it wouldn't finish before then.
async function say(text, { prepared = null, maxWait = 6, force = false, before = Infinity } = {}) {
  const token = ++sayToken;
  if (kokoro.ok) {
    try {
      const late = new Promise((_, no) => setTimeout(() => no(new Error('late')), maxWait * 1000));
      late.catch(() => {});
      const clip = await Promise.race([prepared || kokoro.prepare(text), late]);
      if (token !== sayToken || (!force && !audio.playing)) return false;
      if (audio.rawTime() + clip.buffer.duration + 0.3 > before) { console.info('[loft] announcement skipped (it would talk over the singing):', text); return false; }
      startSpeech(clip);
      return true;
    } catch (err) {
      if (token !== sayToken) return false;
      if (err.message === 'late') { console.info('[loft] voice clip not ready in time, skipped:', text); return false; }
      report('Kokoro voice failed, switching to the browser voice: ' + err.message, err);
      kokoro.state = 'error';
      kokoro.error = err.message;
      setupVoicePicker();
    }
  }
  if (before - audio.rawTime() < 4) return false;
  browserSay(text, token);
  return true;
}

// ── the announcer ─────────────────────────────────────────────────────
// It says what's playing without ever talking over the singing: at the top of
// a song when the line fits before the first sung word; otherwise in the outro
// of the song before ("Up next: ..."), radio style, once the last line is sung;
// and the first song after you walk in waits for its greeting.
let announcedNext = null, outroSaid = false, firstOfSession = true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p.catch(() => null), sleep(ms).then(() => null)]);
function announceNext(t) {
  if (outroSaid || !voiceOn || !kokoro.ok || speaking || !audio.playing || !audio.duration || tracks.length < 2) return;
  const left = audio.duration - t;
  if (left > 25 || left < 4.5) return;
  // (the last line the lead sings: an ad-lib after it mustn't let the announcer talk over the hook)
  const lastSung = lines.reduce((m, l) => (l.how === 'adlib' ? m : Math.max(m, l.end)), 0);
  if (t < lastSung + 0.6) return;
  const next = tracks[((nextIndex(1) % tracks.length) + tracks.length) % tracks.length];
  if (!next || next === tracks[current]) return;
  outroSaid = true;
  const nm = splitName(prettyName(next.name));
  const text = next.outroText || upNext(nm.title, nm.artist);
  announcedNext = next.key;
  outroSpeech = true;
  say(text, { maxWait: Math.max(1, left - 4.5), before: audio.duration - 0.5 }).then((ok) => {
    if (!ok && announcedNext === next.key) { announcedNext = null; outroSpeech = false; }   // not said: the song will announce itself
  });
}

function startSpeech(clip) {
  audio.stopVoice();
  speaking = true;
  audio.setDuck(true);
  ui.caption(clip.words.map((w) => w.w));
  speech = { start: audio.playVoice(clip.buffer), words: clip.words, idx: -1, end: clip.buffer.duration };
}

function browserSay(text, token) {
  const words = text.split(/\s+/).filter(Boolean);
  speaking = true;
  audio.setDuck(true);
  ui.caption(words);
  voice.speak(text, { onWord: (k, w) => onSpokenWord(k, w) }).then(() => { if (token === sayToken) endSpeech(); });
}

function onSpokenWord(k, w) {
  ui.captionWord(k);
}

function updateSpeech() {
  if (!speech) return;
  const vt = audio.ctxHeard() - speech.start, W = speech.words;
  while (speech.idx + 1 < W.length && W[speech.idx + 1].t <= vt) { speech.idx++; onSpokenWord(speech.idx, W[speech.idx].w); }
  if (vt > speech.end + 0.05) endSpeech();
}

function endSpeech() {
  outroSpeech = false;
  speech = null;
  speaking = false;
  audio.setDuck(false);
  ui.captionClear();
  // Back to the lyric that's playing.
  const line = lineIdx >= 0 ? lines[lineIdx] : null;
  if (line && audio.playing) showLineHero(line);
}

// Listening time is counted on the audio clock once a second, not per frame: a
// minimised or covered window draws no frames, but the music it plays still counts.
let heardMark = 0;
setInterval(() => {
  const now = audio.ctx.currentTime, d = Math.min(5, Math.max(0, now - heardMark));
  heardMark = now;
  if (audio.playing && current >= 0 && !loadingTrack) { heardThisLoad += d; unreported += d; if (unreported > 20) reportListening(); }
}, 1000);

let outroSpeech = false;   // 'Up next' is being said (cut short, it hasn't been said)
function stopSpeech() {
  if (outroSpeech) { outroSpeech = false; announcedNext = null; outroSaid = false; }
  sayToken++;
  voice.cancel();
  audio.stopVoice();
  if (speaking || speech) endSpeech();
}

function setupVoicePicker() {
  const sel = document.getElementById('voice-select'), state = document.getElementById('voice-state');
  sel.innerHTML = '';
  if (kokoro.ok) {
    for (const v of kokoro.voices) sel.appendChild(new Option(v.label, v.id));
    const saved = prefs.get('kokoroVoice', kokoro.voice);
    if (kokoro.voices.some((v) => v.id === saved)) kokoro.voice = saved;
    sel.value = kokoro.voice;
    sel.disabled = false;
    state.textContent = 'KOKORO · LOCAL CPU';
    state.title = '';
  } else {
    sel.appendChild(new Option('Browser voice (Kokoro unavailable)', ''));
    sel.disabled = true;
    state.textContent = 'FALLBACK';
    state.title = kokoro.error;
  }
}
document.getElementById('voice-select').onchange = (e) => {
  kokoro.voice = e.target.value;
  prefs.set('kokoroVoice', kokoro.voice);
  say('This is the loft. Welcome in.', { force: true, maxWait: 10 });
};
document.getElementById('voice-test').onclick = () => say('This is the loft. Welcome in.', { force: true, maxWait: 10 });

// ── transport ─────────────────────────────────────────────────────────
async function togglePlay() {
  if (loadingTrack) return;   // the old song must not start under the new one's loading (or under the greeting)
  if (!audio.buffer) { if (tracks.length) playTrack(Math.max(0, current)); return; }
  if (audio.playing) { audio.pause(); stopSpeech(); }
  else await audio.play();
  ui.setPlaying(audio.playing);
}
function seek(t) {
  if (!audio.buffer || loadingTrack) return;
  audio.seek(t);
  stopSpeech();
  voiceIdx = voiceLines.findIndex((l) => l.t >= t - 0.05);
  if (voiceIdx < 0) voiceIdx = voiceLines.length;
  lineIdx = -2; // force a lyric refresh
  lastHeroT = -99;
}
audio.onEnded = () => { ui.setPlaying(false); if (tracks.length) playTrack(nextIndex(1), 'ended'); };
ui.onSeek = seek;
ui.el.play.onclick = togglePlay;
ui.el.prev.onclick = () => (audio.rawTime() > 3 ? seek(0) : playTrack(nextIndex(-1)));
ui.el.next.onclick = () => playTrack(nextIndex(1));
document.getElementById('shuffle-btn').onclick = () => toggleShuffle();
ui.setShuffle(shuffle);
ui.el.vol.oninput = () => { const v = +ui.el.vol.value; audio.setVolume(v); prefs.set('volume', v); };
ui.el.listBtn.onclick = () => ui.toggleDrawer();
ui.el.fsBtn.onclick = () => toggleFullscreen();
function setLyricsShown(on, quiet = false) {
  lyricsOn = on;
  prefs.set('lyrics', on);
  document.body.classList.toggle('no-lyrics', !on);
  document.getElementById('lyrics-btn').classList.toggle('on', on);
  if (!quiet) ui.toast(on ? 'Lyrics on' : 'Lyrics off: just the room and the music');
}
document.getElementById('lyrics-btn').onclick = () => setLyricsShown(!lyricsOn);
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch((err) => report('Fullscreen refused: ' + err.message, err));
}

window.addEventListener('keydown', (e) => {
  if ((e.target.tagName === 'INPUT' && e.target.type !== 'range') || e.target.tagName === 'SELECT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;   // the browser's own shortcuts (Ctrl+F, Ctrl+X...) are never the loft's
  const k = e.key.toLowerCase();
  if (e.repeat && !['arrowleft', 'arrowright'].includes(k)) return;   // holding N must not start dozens of loads
  if (!entered && k !== 'f') { enter(); return; }
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'arrowright') seek(audio.rawTime() + (e.shiftKey ? 15 : 5));
  else if (k === 'arrowleft') seek(audio.rawTime() - (e.shiftKey ? 15 : 5));
  else if (k === 'n') playTrack(nextIndex(1));
  else if (k === 'p') playTrack(nextIndex(-1));
  else if (k === 's') toggleShuffle();
  else if (k === 'f') toggleFullscreen();
  else if (k === 'h') document.body.classList.toggle('bare');
  else if (k === 't') setLyricsShown(!lyricsOn);
  else if (k === 'l') { e.preventDefault(); ui.toggleDrawer(); }
  else if (k === 'escape') { if (ui.el.drawer.classList.contains('open')) ui.toggleDrawer(false); else settings.toggle(); }
  else if (k === 'c') world._cut();
});

// ── drag & drop: songs + matching .lrc/.srt/.voice.lrc ────────────────
const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac|opus|webm)$/i;
window.addEventListener('dragover', (e) => { e.preventDefault(); ui.setDropHint(true); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) ui.setDropHint(false); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  ui.setDropHint(false);
  const files = [...e.dataTransfer.files];
  const byStem = new Map();
  const stem = (n) => n.replace(/\.voice\.(lrc|txt)$/i, '').replace(/\.[^.]+$/, '');
  for (const f of files) {
    const s = stem(f.name).toLowerCase();
    if (!byStem.has(s)) byStem.set(s, {});
    const g = byStem.get(s);
    if (AUDIO_RE.test(f.name)) g.audio = f;
    else if (/\.voice\.(lrc|txt)$/i.test(f.name)) g.voice = f;
    else if (/\.(lrc|srt)$/i.test(f.name)) g.lyrics = f;
  }
  const added = [];
  for (const g of byStem.values()) {
    if (!g.audio) continue;
    added.push({ name: stem(g.audio.name), file: g.audio, lyrics: g.lyrics || null, lyricsName: g.lyrics && g.lyrics.name, voice: g.voice || null, key: 'drop:' + g.audio.name + ':' + g.audio.size });
  }
  if (!added.length) { ui.toast('No songs in that drop. Audio files: mp3, wav, m4a, flac, ogg.', 'warn'); return; }
  tracks = [...added, ...tracks];
  if (current >= 0) current += added.length;   // the song playing is still the song playing (its listening time stays its own)
  enter(false);
  playTrack(0, 'drop');   // new songs dropped in aren't a judgement on the one playing
});

// ── gate ──────────────────────────────────────────────────────────────
// The first song: the one asked for in the address (?play=Name, as the
// observatory sends), else the head of the shuffle (or the first not disliked).
function firstPick() {
  const want = new URLSearchParams(location.search).get('play');
  const asked = want ? tracks.findIndex((t) => t.name === want) : -1;
  return asked >= 0 ? asked : Math.max(0, shuffle ? order[0] : tracks.findIndex((t) => !t.disliked));
}
async function enter(autoplay = true) {
  if (entered) return;
  entered = true;
  ui.hideGate();
  try { await audio.ctx.resume(); } catch (err) { report('Audio could not start: ' + err.message, err); }
  if (autoplay) {
    if (tracks.length) {
      if (shuffle) buildOrder();
      playTrack(firstPick());
    }
    else ui.setEmpty(true);
  }
}
document.getElementById('gate').addEventListener('click', () => enter());

// The frame-rate log: every minute of listening sends its frame rate (and its worst
// frames) to cache/perf.jsonl, so Settings can show whether frames fall over hours of
// play, which is what a hot, dusty card does. (Not while the PC test runs.)
const perfDts = [];
let perfSecs = 0;
function perfLog(dt) {
  if (!audio.playing || uncapped || document.hidden || !tracks[current]) { perfDts.length = 0; perfSecs = 0; return; }
  perfDts.push(dt); perfSecs += dt;
  if (perfSecs < 60) return;
  const s = [...perfDts].sort((a, b) => b - a), low = 1 / s[Math.floor(s.length * 0.01)];
  const c = world.renderer.domElement;
  heat.fps = perfDts.length / perfSecs; heat.low = low;
  fetch('/api/perf', { method: 'POST', body: JSON.stringify({ song: tracks[current].name, fps: +(perfDts.length / perfSecs).toFixed(1), low: +low.toFixed(1), secs: Math.round(perfSecs), quality: settings.quality, cap: fpsCap, w: c.width, h: c.height }) }).catch(() => {});
  perfDts.length = 0; perfSecs = 0;
  // The heat watch: a card getting hot slips frames. Past the first five minutes of a
  // sitting, three minutes in a row under the limit (or with bad stutters) steps the
  // quality down one notch, and again if it keeps slipping. No override.
  const now = Date.now();
  if (now - heat.last > 30 * 60 * 1000) heat.start = now;   // a new sitting
  heat.last = now;
  const slip = (n) => n < fpsCap * 0.9;
  const bad = now - heat.start > 5 * 60 * 1000 && (slip(heat.fps) || heat.low < fpsCap * 0.6);
  heat.bad = bad ? heat.bad + 1 : 0; heat.good = bad ? 0 : heat.good + 1;
  if (heat.bad >= 3) { heat.bad = 0; heat.good = 0; const to = settings.cool(); if (to) ui.toast(`Frames were slipping (something else using the graphics card, a game or Blender?): stepped down to ${to}.`, 'info', 8000); }
  // ...and once the card is free again (five smooth minutes), back up a notch toward the best.
  if (heat.good >= 5) { heat.good = 0; const to = settings.warm(); if (to) ui.toast(`Smooth again: back up to ${to}.`, 'info', 5000); }
}
const heat = { start: Date.now(), last: 0, bad: 0, good: 0, fps: 60, low: 60 };

// ── master loop ───────────────────────────────────────────────────────
// Frame pacing: draw on every Nth screen refresh (~60-100 fps on any monitor),
// evenly spaced, so the GPU idles between frames instead of running flat out
// at 144/165 Hz. That keeps the card cool; the show looks the same.
let last = performance.now(), fpsAvg = 60, fpsCap = 60, uncapped = false, statT = 0, accentT = 0;
let lastBeatS = '', lastKickS = '';
const beatEls = ['lyric', 'brand', 'play'].map((id) => document.getElementById(id)).filter(Boolean);
let lastRaw = performance.now(), refreshMs = 1000 / 60, skip = 1, tick = 0, paceT = 0;
let lastDraw = 0;
const rawDeltas = [];
// How long each frame takes to draw, for the PC test.
const gpuTimer = (() => {
  // A frame's cost in two parts: the browser working out the scene (the same at every
  // quality) and the card drawing it (reading back one pixel makes the card finish
  // first, and that wait is its share). Only while the test runs.
  const gl = world.renderer.getContext(), px = new Uint8Array(4), cpu = [], gpu = [];
  let on = false, t0 = 0;
  const p75 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length * 0.75)] : null; };
  return {
    start() { cpu.length = 0; gpu.length = 0; on = true; },
    stop() { on = false; return { cpu: p75(cpu), gpu: p75(gpu) }; },
    begin() { if (on) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); t0 = performance.now(); } },
    end() { if (on) { const t1 = performance.now(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); cpu.push(t1 - t0); gpu.push(performance.now() - t1); } },
  };
})();
// Esc menu → Settings: quality (how sharp the room is drawn) and the frame limit.
const settings = makeSettings({
  prefs,
  applyScale: (k) => { world.pixelRatio = Math.min(2, Math.max(window.devicePixelRatio, 1) * k); world.resize(); },
  setCap: (fps) => { fpsCap = fps; },
  uncap: (on) => { uncapped = on; },
  fps: () => fpsAvg,
  gpu: gpuTimer,
  drawTime(n) {   // the typical time to draw the current frame, n times back to back
    const gl = world.renderer.getContext(), px = new Uint8Array(4), a = [];
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let i = 0; i < n; i++) { const t = performance.now(); world.post.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); a.push(performance.now() - t); }
    a.sort((x, y) => x - y);
    return a[n >> 1];
  },
  // The test's scene: the loudest stretch of the song that's on (or the first song).
  // Afterwards it comes back where you left it.
  async benchScene() {
    const was = current, at = audio.rawTime(), playing = audio.playing;
    const i = current >= 0 ? current : 0;
    if (!tracks.length) return () => {};
    if (i !== current) { await playTrack(i); for (let k = 0; k < 100 && (loadingTrack || !audio.duration); k++) await new Promise((r) => setTimeout(r, 100)); }
    const loud = map && map.sections.length ? map.sections.reduce((a, b) => (b.energy > a.energy ? b : a)) : null;
    seek(loud ? loud.start + 2 : (audio.duration || 0) * 0.6);
    if (!audio.playing) togglePlay();
    return async () => {
      if (was === i) { seek(at); if (!playing && audio.playing) togglePlay(); return; }
      if (was >= 0) { await playTrack(was); for (let k = 0; k < 100 && (loadingTrack || !audio.duration); k++) await new Promise((r) => setTimeout(r, 100)); seek(at); if (!playing && audio.playing) togglePlay(); }
    };
  },
  rendered: () => ({ w: world.renderer.domElement.width, h: world.renderer.domElement.height }),
});

function pace(raw) {
  if (raw > 0 && raw < 100) { rawDeltas.push(raw); if (rawDeltas.length > 120) rawDeltas.shift(); }
  if ((paceT += raw) < 2000 || rawDeltas.length < 60) return;
  paceT = 0;
  const s = [...rawDeltas].sort((a, b) => a - b);
  refreshMs = s[s.length >> 1];
}
function frame(now, manual = false) {
  if (!manual) requestAnimationFrame(frame);
  if (rendering) return;   // the renderer drives the show frame by frame
  const raw = now - lastRaw;
  lastRaw = now;
  pace(raw);
  // The frame limit (Esc → Settings): a frame only when its time has come, on any monitor.
  const iv = 1000 / fpsCap;
  if (!uncapped && now < lastDraw + iv - 1) return;
  lastDraw = Math.max(lastDraw + iv, now - iv);   // (kept on a steady grid, so 60 averages 60 on a 144 Hz screen)
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const heard = audio.heardTime(dt);
  const t = Math.max(0, heard + syncOffset);
  const spectrum = audio.playing ? audio.readSpectrum() : null;
  gpuTimer.begin();
  const f = step(t, dt, spectrum);
  gpuTimer.end();

  fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.05;
  perfLog(dt);
  if ((statT += dt) > 0.5) { statT = 0; ui.setStats({ fps: fpsAvg }); }
  if ((accentT += dt) > 0.1) { accentT = 0; ui.setMoodColors(world.pal.uRamp.value, world.pal.uAccent.value); }
  // The beat and the kick, only on the elements that use them (the lyric, the logo,
  // the play button) and only when they change: written on the page root they
  // restyled the whole page (the drawer's ~1000 nodes too) on every frame.
  const on = audio.playing, beatS = (on ? f.beat : 0).toFixed(2), kickS = (on ? f.kick : 0).toFixed(2);
  if (beatS !== lastBeatS || kickS !== lastKickS) {
    lastBeatS = beatS; lastKickS = kickS;
    for (const el of beatEls) { el.style.setProperty('--beat', beatS); el.style.setProperty('--kick', kickS); }
  }
  ui.drawSeek(audio.buffer ? heard : 0);
}

// One frame of the show at song time t: the words, the parts, the feeling, the
// colour, then the room. (The loop above, or the clip renderer, calls it.)
function step(t, dt, spectrum) {
  const f = conductor.update(t, dt, spectrum, live(), audio.ctx.sampleRate);
  if (map && audio.buffer) { syncWords(t); if (!rendering) announceNext(t); }
  world.featureGoal = map && live() && isInstrumental(t) ? 1 : 0;
  const nd = conductor.f.nextDrop, dropBuild = nd && nd.big && t >= nd.buildStart;
  world.screamGoal = map && audio.buffer && !loadingTrack && !dropBuild && screamRuns.some(([a, b]) => t >= a - 0.05 && t < b + 0.4) ? 1 : 0;   // (a pause doesn't end a scream)
  if (parts.length) {
    world.setPart(partAt(t));
    const i = partIndexAt(t), t0 = parts[i].t, t1 = i + 1 < parts.length ? parts[i + 1].t : map.duration;
    world.partPos = Math.max(0, Math.min(1, (t - t0) / Math.max(1, t1 - t0)));
    world.partDepth = parts[i].depth || 0;
  } else { world.partPos = 0; world.partDepth = 0; }
  applyMood();
  if (map) applyColour(t);
  if (!rendering) updateSpeech();
  world.voice = rendering ? 0 : audio.voiceLevel();
  world.lyricOn = !rendering && lyricsOn && lineIdx >= 0;   // (a render draws its words into the frame: the wall stays full)
  world.frame(dt, f, spectrum);
  return f;
}

// A hook line (one the song keeps coming back to) lifts the colour; a word
// carrying its own feeling lights the core's heart in it (see syncWords).
let lastHeroT = -99;
function showLineHero(line) {
  if (!line.hook || line.end - line.t < 0.9 || line.t - lastHeroT < 4) return;
  lastHeroT = line.t;
  world.hookMoment();
}

// A solo or instrumental stretch: nobody singing for a while either side, and
// the band going.
function isInstrumental(t) {
  if (!lines.length || lineAt(lines, t) >= 0 || conductor.f.energy < 0.45) return false;
  const i = lines.findIndex((l) => l.t > t);
  const before = i > 0 ? lines[i - 1].end : (i === 0 ? 0 : lines[lines.length - 1].end);
  const after = i >= 0 ? lines[i].t : audio.duration;
  return t - before > 3 && after - t > 2.5;
}

function syncWords(t) {
  // Timed voice lines.
  while (voiceIdx < voiceLines.length && voiceLines[voiceIdx].t <= t) {
    const l = voiceLines[voiceIdx++];
    if (t - l.t < 1.5 && voiceOn && audio.playing) say(l.text, { prepared: l.clip || null, maxWait: 1.5 });
  }
  // Lyrics.
  if (!lines.length) return;
  const li = lineAt(lines, t);
  if (li !== lineIdx) {
    const seeked = lineIdx === -2;   // a forced refresh after a seek: not a line the song played into
    lineIdx = li; wordIdx = -1;
    world.dissolveGoal = li >= 0 ? lines[li].dissolve || 0 : 0;
    if (li >= 0) {
      const line = lines[li];
      ui.lyricLine(line, lineLook(line, li));
      if (!speaking) showLineHero(line);
      if (line.charge >= 0.4 && live()) world.lineFeel(line.top, 0.12);   // a charged line primes its feeling
      if (line.scream && live() && !seeked && !conductor.f.jumped) world.screamLine();
    } else {
      ui.lyricClear();
    }
  }
  if (li < 0) { world.sustainGoal = 0; return; }
  const line = lines[li];
  let k = -1;
  for (let i = 0; i < line.words.length; i++) if (line.words[i].t <= t) k = i;
  if (k !== wordIdx && k >= 0) {
    wordIdx = k;
    ui.lyricWord(k);
    if (live()) {
      if (line.scream) world.screamWord();
      // A feeling word lights the core's heart in that feeling (held words longest),
      // and swells the line's feeling. In a scream only rage, defiance and fear burn there.
      const wf = line.wordFeel && line.wordFeel[k], w = line.words[k];
      if (wf && wf.w >= 0.5) {
        const held = Math.max(0, Math.min(line.end, w.end ?? w.t) - w.t);
        const rage = wf.e === 'anger' || wf.e === 'defiance' || wf.e === 'fear';
        const amt = Math.min(1, wf.w * (1 + Math.min(2, held))) * (world.scream > 0.5 && !rage ? 0.2 : 1);
        world.feelHeart(PALETTES[wf.e].accent, amt, w.end ?? w.t + 0.3);
        world.lineFeel(wf.e, 0.16 + 0.12 * Math.min(1, held / 1.5));
      }
      for (const w of line.weather || []) if (w.k === k) world.weather(w.kind, 1);   // rain, fire, light, fog fill the sky
    }
  }
  if (k >= 0) {
    const w = line.words[k];
    ui.lyricProgress(k, (t - w.t) / Math.max(0.05, Math.min(w.end, w.t + 1.2) - w.t));
    // A held note: the singer stays on a word; the room holds it with them.
    const len = Math.min(w.end, line.end) - w.t, last = k === line.words.length - 1;
    world.sustainGoal = live() && len >= (last ? 1.1 : 1.5) && t < w.end ? Math.min(1, 0.35 + (t - w.t) / Math.min(len, 3)) : 0;
  } else world.sustainGoal = 0;
}

window.addEventListener('resize', () => { if (!rendering) world.resize(); });

// A clip of the loaded song to renders/ as an MP4 (render.js), e.g. the last
// section of a song: await loft.renderClip({ from: 260 }). loft.contactSheet(opts)
// runs the same frames without encoding and keeps only the sheet of its moments.
async function renderSong(opts = {}) {
  if (rendering) throw new Error('A clip is already rendering.');
  const track = tracks[current];
  const wasPlaying = audio.playing, at = audio.rawTime();
  return renderClip({ lyrics: lyricsOn, ...opts }, {
    world, audio, track,
    begin(R) { if (audio.playing) audio.pause(); stopSpeech(); rendering = true; world.dice(R); },
    // Put the song's state at t, as a seek does (the next frame reads as a jump).
    prepare(t) { lineIdx = -2; lastHeroT = -99; world.heartUntil = -1; conductor.prevT = t > 1 ? 0 : -1; world.restart(t); },
    fresh() { world.freshShot(); },
    step,
    // What a contact sheet shows besides the camera's cuts: each line once it's in,
    // each part's first moment, a big drop's breath, hit and flare.
    moments(a, b) {
      const m = [];
      lines.forEach((l, i) => { if (l.t >= a && l.t < b && l.how !== 'adlib') m.push({ t: l.t + Math.min(0.9, (l.end - l.t) / 2), kind: 'line', label: `line ${i + 1}` }); });
      for (const p of parts) if (p.t > a && p.t < b) m.push({ t: p.t + 0.4, kind: 'part', label: p.label || p.part });
      for (const d of (map && map.drops) || []) {
        if (d.t <= a || d.t >= b) continue;
        if (d.big) m.push({ t: d.t - 0.1, kind: 'drop', label: 'breath' }, { t: d.t + 0.1, kind: 'drop', label: 'big drop' }, { t: d.t + 0.6, kind: 'drop', label: 'flare' });
        else if (d.size >= 0.3) m.push({ t: d.t + 0.1, kind: 'drop', label: 'drop' });
      }
      return m;
    },
    lyric(t) {
      const line = lineIdx >= 0 ? lines[lineIdx] : null, o = { r: 0, g: 0, b: 0 };
      const rgb = (c) => { c.getRGB(o, 'srgb'); return [o.r, o.g, o.b]; };
      const R = world.pal.uRamp.value, w = line && wordIdx >= 0 ? line.words[wordIdx] : null;
      return { line, k: wordIdx, p: w ? (t - w.t) / Math.max(0.05, Math.min(w.end, w.t + 1.2) - w.t) : 0,
        look: { type: PALETTES[sectionMood().primary].type, c3: rgb(R[3]), c4: rgb(R[4]) } };
    },
    done() { rendering = false; lineIdx = -2; world.dice(Math.random); audio.pausedAt = at; if (wasPlaying) audio.play(at); },
  });
}
// Handle for poking at the loft from DevTools.
window.loft = { audio, conductor, world, seek, kokoro, say, renderClip: renderSong,
  contactSheet: (opts = {}) => renderSong({ ...opts, encode: false }),
  set moodOverride(v) { moodOverride = v; }, get moodOverride() { return moodOverride; },
  // Drive the render loop by hand for a while (inspection in throttled/hidden views).
  async run(seconds) { const end = performance.now() + seconds * 1000; while (performance.now() < end) { frame(performance.now(), true); await new Promise((r) => setTimeout(r, 14)); } },
  get mood() { return mood; }, play(name) { const i = tracks.findIndex((t) => t.name === name); if (i >= 0) playTrack(i); return i; }, reshuffle() { buildOrder(); return order.map((i) => tracks[i].name); }, get caches() { return { buffers: [...bufferCache.keys()], analyses: [...analysisCache.keys()] }; }, get map() { return map; }, get lines() { return lines; }, get screams() { return screamRuns; }, get tracks() { return tracks.map((t) => t.name); } };
(async () => {
  if (document.fonts) {
    try { await Promise.all([document.fonts.load('800 100px Unbounded'), document.fonts.load('600 40px "Space Grotesk"')]); }
    catch (err) { console.warn('[loft] display fonts did not load; using system fonts.', err); }
  }
  await kokoro.init();
  if (!kokoro.ok) ui.toast('Kokoro voice unavailable (' + kokoro.error + '). Using the browser voice.', 'warn', 9000);
  setupVoicePicker();
  await loadTrackList();
  // Walked in before the shelf was read: start now that it is.
  if (entered && current < 0 && tracks.length) {
    ui.setEmpty(false);
    if (shuffle) buildOrder();
    playTrack(firstPick());
  }
  document.getElementById('gate-count').textContent = tracks.length
    ? `${tracks.length} song${tracks.length === 1 ? '' : 's'} on the shelf`
    : 'the shelf is empty: drop songs in music/ or onto this window';
  requestAnimationFrame(frame);
  if (/[?&]demo\b/.test(location.search)) makeDemo().catch((err) => demoSay('The demo failed: ' + err.message));
})();

// ── Daily demo (MAKE A DEMO.bat opens /?demo): picks a song not shown lately, finds
// its biggest drop and renders 30 s of it at 1080p to renders/, lyrics drawn big
// for phones, then shows the file and a caption to paste. ?demo=<song> picks one.
let demoBox = null;
function demoSay(text) {
  if (!demoBox) {
    demoBox = document.createElement('div');
    demoBox.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:99;padding:14px 20px;border-radius:12px;background:rgba(8,6,16,.82);color:#ece6ff;font:600 15px "Space Grotesk",sans-serif;white-space:pre-line;text-align:center;max-width:80vw;backdrop-filter:blur(6px)';
    document.body.appendChild(demoBox);
  }
  demoBox.textContent = text;
}
async function makeDemo() {
  const wanted = new URLSearchParams(location.search).get('demo');
  let done = [];
  try { done = JSON.parse(localStorage.getItem('loft.demosDone') || '[]'); } catch { done = []; }
  let pool = tracks.filter((t) => !t.file && !done.includes(t.name));
  if (!pool.length) { done = []; pool = tracks.filter((t) => !t.file); }
  const track = (wanted && tracks.find((t) => t.name.toLowerCase() === wanted.toLowerCase())) || pool[Math.floor(Math.random() * pool.length)];
  if (!track) throw new Error('no songs on the shelf');
  demoSay(`Making today's demo: ${track.name}\nloading...`);
  playTrack(tracks.indexOf(track));
  for (let k = 0; k < 120 && !(audio.duration > 0 && map && map.drops); k++) await new Promise((r) => setTimeout(r, 250));
  audio.pause();
  // The biggest moment: the strongest drop (a big one if it has one), from a beat or
  // eight before it, so the clip opens on the build and lands the hit early.
  const drops = (map.drops || []).slice().sort((a, b) => (b.big - a.big) || ((b.size || 0) - (a.size || 0)));
  const hit = drops.length ? drops[0].t : audio.duration * 0.35;
  const from = Math.max(0, hit - 8), to = Math.min(audio.duration, from + 30);
  // Live quality, not draft: 60 fps like the room, at its own scale, frames
  // passed on near-lossless (X compresses it again; it needs a clean source).
  const r = await renderSong({ from, to, width: 1920, height: 1080, fps: 60, supersample: world.pixelRatio, quality: 0.98, textScale: 1.3,   /* drawn at the live room's own scale: its glow is sized in pixels, so a sharper render had a tighter, paler glow than live */ name: `Demo ${new Date().toISOString().slice(0, 10)} ${track.title || track.name}`,
    onProgress: (m) => demoSay(`Making today's demo: ${track.name}\n${m}`) });
  done.push(track.name);
  try { localStorage.setItem('loft.demosDone', JSON.stringify(done)); } catch { /* not remembered: it may repeat a song */ }
  demoSay(`Done: ${r.path}\n\nCaption:\nOpus 5.5 built me a 3D room that turns my own songs into a living singularity. I can't stop watching it. "${track.title || track.name}"`);
}
