import { AudioEngine } from './audio.js';
import { Conductor, bsearch } from './conductor.js';
import { World } from './visuals.js';
import { parseLyrics, timeLyrics, lineAt, markHooks } from './lyrics.js';
import { Voice, Kokoro } from './voice.js';
import { readSong, lineEmotion, wordFeel, scoreLine, PALETTES, songLook } from './emotion.js';
import { UI } from './ui.js';
import { planWeather } from './weather.js';
import { renderClip } from './render.js';
import { initXVideo } from './xvideo.js';
import { makeSettings } from './settings.js';
import { createDealer } from './queue.js';
import { pickMurmur, MURMUR_VOICE, MURMUR_SPEED } from './murmur.js';
import { makeStalls } from './stalls.js';
// What the start screen says it is doing while it loads (index.html counts the seconds beside it).
const bootStep = (s) => { const g = document.getElementById('gate'); if (g) g.dataset.step = s; };
bootStep('building the room');

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
window.addEventListener('error', (e) => { if (e.filename && !e.filename.startsWith(location.origin)) return; report('Error: ' + e.message, e.error); });   // (only the Loft's own errors: a phone browser's built-ins aren't ours to show)
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
// Seamless song changes: how long the old song fades under the new one, and how long the new one rises.
let fadeOut = 0.5, fadeIn = 0.12, handedFor = -1;
let loadingTrack = false;   // a song is loading (or being greeted): play/pause and seeks wait for it
let map = null;
let lines = [], lineIdx = -1, wordIdx = -1;
// -> cache/lyric-colors.json, {song: [[seconds, colour], ...]}): the room leans into it for the line.
let lyricColors = {};
fetch('/cache/lyric-colors.json').then((r) => (r.ok ? r.json() : {})).then((j) => { lyricColors = j || {}; }).catch(() => {});
let screamRuns = [];   // screamed stretches of the song: [[start, end]] (planVideo)
let voiceLines = [], voiceIdx = 0;
let speaking = false;
const voiceOn = true;   // the voice is always on (its toggle is gone)
let lyricsOn = prefs.get('lyrics', true);   // T: words on screen, or just the room

// Each frame is drawn for the moment it reaches the eye (~20 ms after it's drawn): light that lands
// on or a hair before the sound reads as together; late reads as lag.
const syncOffset = 0.02;
// A clip is being rendered (render.js): the show runs on the song's clock, silent,
// and everything that waits for the music to be playing counts it as playing.
let rendering = false;
let resting = false;   // another space (the Atlas) covers the Loft: no frames drawn
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
// The remembered song maps, and the mapping code's own fingerprint (any change to analysis.js re-maps every song).
const mapperVersion = fetch('js/analysis.js').then((r) => r.text()).then((t) => { let h = 0; for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }).catch(() => '');
const mapStore = (() => {
  const db = new Promise((res, rej) => { const q = indexedDB.open('loft-maps', 1); q.onupgradeneeded = () => q.result.createObjectStore('maps'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const run = (mode, fn) => db.then((d) => new Promise((res, rej) => { const tx = d.transaction('maps', mode), r = fn(tx.objectStore('maps')); tx.oncomplete = () => res(r.result); tx.onerror = tx.onabort = () => rej(tx.error); }));
  return { get: (k) => run('readonly', (s) => s.get(k)), put: (k, val) => run('readwrite', (s) => s.put(val, k)) };
})();
// Whoever is waiting for a song's analysis now gets its progress (a song the
// preloader started is still shown 'Listening to the song' as it finishes).
const progressFor = new Map();
function analysisOf(track, buffer, progress = () => {}) {
  progressFor.set(track.key, progress);
  let p = analysisCache.get(track.key);
  if (!p) {
    p = (async () => {
      // A song is mapped once and remembered (IndexedDB): only for this exact file and this exact mapping
      // code, so a remembered map can never be stale. Listening again from scratch took ~2 s per song.
      const v = track.v && `${track.v}|${await mapperVersion}`;
      const kept = v && await mapStore.get(track.url).catch(() => null);
      if (kept && kept.v === v) return kept.map;
      const m = await analyzeBuffer(buffer, (x) => (progressFor.get(track.key) || (() => {}))(x));
      if (v) mapStore.put(track.url, { v, map: m }).catch(() => {});   // (a map that can't be stored just maps again next time)
      return m;
    })();
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
// A number glued to the front ("7Borrowed Spark") is a stray track number, not the title.
// Suno's style tag after the title (" — 2011 stadium pop-rock") isn't part of it.
// A "(1)" copy is the song's cover (Suno's second version).
const prettyName = (name) => {
  const cover = /\s*\(1\)\s*$/.test(name);
  const t = name.replace(/\s*\(\d+\)\s*$/, '').replace(/\s+[—–-]\s+(?:19|20)\d\d.*$/, '')
    .replace(/_$/, '?').replace(/^\d+(?=[A-Z][a-z])/, '').trim();
  return cover && !/\bcover\)?$/i.test(t) ? t + ' cover' : t;
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
ui.onQueue = (i) => {
  const at = queue.indexOf(i);
  if (at >= 0) { queue.splice(at, 1); ui.toast(`Took ${tracks[i].name} out of the queue`); }
  else { queue.push(i); ui.toast(queue.length === 1 ? `${tracks[i].name} plays next` : `${tracks[i].name} queued (#${queue.length})`); }
  ui.setQueue(queue);
  paintUpNext();
};
}

const skippingNow = () => current >= 0 && heardThisLoad >= 1 && heardThisLoad < (audio.duration || 1e9) / 2;
// Next (the key, N, the media key, a song ending): after a Back it walks forward through what played; else the queue, else
// the deal, and a skip always lands on a favorite (js/queue.js).
function playNext(why = 'user') {
  const fwd = inPast();
  return playTrack(nextIndex(1, { skip: why === 'user' && !fwd && skippingNow() }), why, fwd ? 'fwd' : 'new');
}
// Back (the key, P, the media key): the song that really played before this one. Past the first three seconds, or with
// nothing before it this sitting, it starts the song over, as every player does.
function playBack() {
  if (audio.rawTime() > 3 || !(dealState.pos > 0)) return seek(0);
  return playTrack(nextIndex(-1), 'user', 'back');
}
// why: 'user' (picked, next, previous) or 'ended' (the song finished). how: 'back' or 'fwd' when it is a step through what
// already played, else 'new'.
async function playTrack(i, why = 'user', how = 'new') {
  if (!tracks.length) return;
  i = ((i % tracks.length) + tracks.length) % tracks.length;
  const qi = queue.indexOf(i);
  if (qi >= 0) { queue.splice(qi, 1); ui.setQueue(queue); }
  const track = tracks[i];
  const token = ++loadToken;
  loadingTrack = true;
  // (going back to hear the last song again says nothing about this one: only Next or picking another song is a skip)
  const skipped = why === 'user' && how !== 'back' && i !== current && skippingNow();
  dealPlayed(i, how, skipped ? current : -1);
  reportListening(false, skipped);
  current = i;
  heardThisLoad = 0; countedThisLoad = false;
  ui.setTracks(tracks, current, playTrack);
  if (ui.el.drawer.classList.contains('open')) paintUpNext();
  ui.setEmpty(false);
  audio.stop(fadeOut); fadeOut = 0.5;
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
    jevFeel(track, lines);
    planVideo();
    mood = readSong(map, lines, partSpans());
    lastHeroT = -99;
    voiceLines = rawVoice;
    conductor.setMap(map);
    if (!parts.length) planColour(map);      // songs without written parts: colour by the analysis' sections
    applyMood();                       // the new song's feeling chooses its first form
    world.setTrack(track.name, map);
    world.bassHold = bassHold(buffer);
    audio.setBuffer(buffer);
    lineIdx = -1; wordIdx = -1; voiceIdx = 0;

    track.title = title; track.artist = artist;
    showNowPlaying(track);
    ui.setMap(map, lines, buffer.duration);
    ui.setStats({ bpm: map.bpm });
    ui.loading(null);

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
    // Wake the audio first and look again: a skip during the wake must not start this song under the next one's load.
    if (audio.ctx.state !== 'running') { try { await audio.ctx.resume(); } catch { /* play() reports it */ } if (stale()) return; }
    await audio.play(0, fadeIn); fadeIn = 0.12;
    ui.setPlaying(true);
    mediaNow();
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
// Resting the mouse on a song in the drawer starts loading it quietly (fetch, decode, the song
// map), so the click plays it at once. Only the latest one is kept, and one loads at a time.
let hoverKey = null, hoverBusy = false, hoverWant = -1;
async function hoverPrefetch(i) {
  hoverWant = i;
  if (hoverBusy) return;
  hoverBusy = true;
  while (hoverWant >= 0) {
    const t = tracks[hoverWant];
    hoverWant = -1;
    if (!t || t === tracks[current]) continue;
    const next = tracks[((nextIndex(1) % tracks.length) + tracks.length) % tracks.length];
    if (hoverKey && hoverKey !== t.key && hoverKey !== tracks[current]?.key && hoverKey !== next?.key) bufferCache.delete(hoverKey);
    hoverKey = t.key;
    try { await analysisOf(t, await loadBuffer(t)); } catch { /* it loads normally on the click */ }
  }
  hoverBusy = false;
}
ui.onHover = (i) => hoverPrefetch(i);
// Mapping the whole shelf: while the Loft is open, songs it has never mapped are mapped quietly, one
// every half minute or so, in the background worker (never while a song is loading; the card is never touched,
// so it runs with the window hidden too), so even a first play starts at once. Each map is remembered (mapStore).
async function mapShelf() {
  for (const t of tracks) {
    if (t.file || !t.v) continue;
    const v = `${t.v}|${await mapperVersion}`;
    const kept = await mapStore.get(t.url).catch(() => null);
    if (kept && kept.v === v) continue;
    while (loadingTrack || hoverBusy) await new Promise((r) => setTimeout(r, 5000));
    if (t === tracks[current] || analysisCache.has(t.key)) continue;
    try {
      const keep = bufferCache.has(t.key);
      await analysisOf(t, await loadBuffer(t));
      if (!keep && t !== tracks[current]) bufferCache.delete(t.key);   // (the map stays; the decoded audio doesn't)
      analysisCache.delete(t.key);
    } catch { /* that one maps when it's played */ }
    await new Promise((r) => setTimeout(r, 25000));
  }
}
setTimeout(() => mapShelf().catch(() => {}), 20000);
// The page tells the server it's here (and goodbye as it closes), so closing the Loft's window
// closes the Loft when the desktop icon started it (launch.pyw); otherwise the server ignores this.
const playingNow = () => {
  try {
    const t = tracks[current]; if (!t) return {};
    const next = tracks[((nextIndex(1) % tracks.length) + tracks.length) % tracks.length];
    return { song: t.name, t: +audio.rawTime().toFixed(1), dur: +(audio.duration || 0).toFixed(1), playing: !!audio.playing,
      visible: document.visibilityState === 'visible',
      render: new URLSearchParams(location.search).has('xrender'),
      feeling: (mood && mood.song && typeof mood.song.primary === 'string') ? mood.song.primary : null, next: next && next !== t ? next.name : null };
  } catch { return {}; }
};
let helloLate = 0, helloFrames = 0;
const alive = () => {
  const body = { ...playingNow(), late: helloLate, frames: helloFrames };
  helloLate = 0; helloFrames = 0;
  return fetch('/api/alive', { method: 'POST', body: JSON.stringify(body), keepalive: true }).catch(() => {});
};
alive(); setInterval(alive, 2000);   // (2 s, and at once when the window is shown or hidden: a render backs off within moments)
document.addEventListener('visibilitychange', alive);
addEventListener('pagehide', () => navigator.sendBeacon('/api/bye', '{}'));
// Only one Loft window plays: a newer one opening tells the others, which stop and close themselves
// (two fast clicks on the icon must never mean two songs at once).
try {
  const me = Math.random().toString(36).slice(2), bc = new BroadcastChannel('the-loft');
  bc.onmessage = (e) => {
    if (e.data?.hello && e.data.hello !== me) { if (audio.playing) togglePlay(); setTimeout(() => window.close(), 300); }
  };
  bc.postMessage({ hello: me });
} catch { /* an old browser: one window as before */ }
// Windows' own media controls (the keyboard's media keys, the volume pop-up): play, pause, next and
// previous work on the Loft while you're somewhere else, like YouTube or a game.
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession, act = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* not offered here */ } };
  act('play', () => { if (!audio.playing) togglePlay(); });
  act('pause', () => { if (audio.playing) togglePlay(); });
  act('nexttrack', () => playNext());
  act('previoustrack', () => playBack());
}
// The song's artwork in Windows' media pop-up: the room itself, a square grabbed once, 20 s into each song
// (right after the frame is drawn, while the picture is still there to read).
let artFor = -1, artUrl = '', mediaKey = '';
function grabArt() {
  const src = world.renderer.domElement, side = Math.min(src.width, src.height);
  if (!side) return;   // (mid-resize: try again next frame)
  artFor = current;
  if (!('mediaSession' in navigator)) return;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  try { c.getContext('2d').drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, 256, 256); }
  catch (err) { console.warn('[loft] no artwork this song:', err); return; }   // (never let a picture stop the show)
  const forTrack = current;
  c.toBlob((b) => {
    if (!b || forTrack !== current) return;
    if (artUrl) URL.revokeObjectURL(artUrl);
    artUrl = URL.createObjectURL(b); mediaKey = ''; mediaNow();
  }, 'image/png');
}
const mediaNow = () => {
  const t = tracks[current];
  if (!t || !('mediaSession' in navigator)) return;
  const art = artFor === current ? artUrl : '', meta = { title: prettyName(t.title || t.name), artist: t.artist || 'The Visualizer', album: mood?.song?.primary || 'The Visualizer' };
  const key = JSON.stringify(meta) + art;
  if (key !== mediaKey) {   // (only when something changed: a new picture every 3 s would make the pop-up flicker)
    mediaKey = key;
    try { navigator.mediaSession.metadata = new MediaMetadata({ ...meta, artwork: art ? [{ src: art, sizes: '256x256', type: 'image/png' }] : [] }); } catch { /* fine without */ }
  }
  navigator.mediaSession.playbackState = audio.playing ? 'playing' : 'paused';
};
setInterval(mediaNow, 3000);
let prefetchTimer = 0;
function schedulePrefetch(token) {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(async () => {
    if (token !== loadToken || tracks.length < 2) return;
    await jevDJ(token);
    if (token !== loadToken) return;
    const next = tracks[((nextIndex(1) % tracks.length) + tracks.length) % tracks.length];
    if (!next || next === tracks[current]) return;
    try {
      const buf = await loadBuffer(next);
      if (token !== loadToken) return;
      await analysisOf(next, buf);
      next.ready = true;   // (a song end can hand over to it seamlessly)
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
const shuffle = true;
// Your queue (right-click a song in the drawer): it plays next, in order, before shuffle picks again.
const queue = [];
// "Holy Anyway" and "Holy Anyway cover" are the same song: never back to back.
const baseName = (n) => prettyName(n).replace(/\s+·\s+.*$/, '').replace(/\s*\(?\bcover\)?$/i, '').trim().toLowerCase();   // (two takes of one song, 'Recursive · Deep Loop' and 'Recursive · Unfolding', are one song)
// (the favorites' line is kept between sittings in this window's own storage, so a new sitting carries on down the line)
const dealer = createDealer({ tracks: () => tracks, current: () => current, queue, baseName, shuffle,
  load: () => prefs.get('dealLine', null), save: (o) => prefs.set('dealLine', o) });
const { S: dealState, buildOrder, dealFresh, nextIndex, tier, played: dealPlayed, inPast, nextWhy } = dealer;
// Songs renamed by their take (cache/renames.json: old file name -> new): chills marks and the
// weekly log follow them, once.
fetch('/cache/renames.json').then((r) => (r.ok ? r.json() : null)).then((map) => {
  if (!map || prefs.get('renamesApplied', 0) === Object.keys(map).length) return;
  const move = (o) => { for (const [a, b] of Object.entries(map)) if (o && a in o) { o[b] = o[a]; delete o[a]; } return o; };
  prefs.set('chills', move(prefs.get('chills', {}))); chillsSeen.name = null;
  for (const k of ['felt', 'feltLast']) { const l = prefs.get(k, null); if (l && l.songs) { move(l.songs); prefs.set(k, l); } }
  prefs.set('renamesApplied', Object.keys(map).length);
}).catch(() => {});
// How wobbly a song's bass really is: in its loud stretches, how much of the time the bass sits
// above half its own recent peak. Wobble bass sustains and pulses (0.57-0.70: Small Piece of
// Data, RNG Made Me, Changing Its Name); a kick that hits and dies doesn't (0.45: Signals in the
// Static, a whispered song). Measured once per song, on a 2x-decimated, 20 ms grid.
function bassHold(buf) {
  if (!buf) return 0.6;
  const x = buf.getChannelData(0), w = Math.floor(buf.sampleRate * 0.02), lo = [];
  let a = 0, c = 0;
  for (let s = 0; s + w < x.length; s += w) { let e = 0; for (let i = s; i < s + w; i += 2) { a += (x[i] - a) * 0.024; c += (a - c) * 0.024; e += c * c; } lo.push(Math.sqrt(e / (w / 2))); }
  const cut = [...lo].sort((p, q) => p - q)[Math.floor(lo.length * 0.6)];
  let held = 0, n = 0;
  for (let i = 25; i < lo.length; i++) { let pk = 0; for (let j = i - 25; j <= i; j++) pk = Math.max(pk, lo[j]); if (pk < cut) continue; n++; if (lo[i] > 0.5 * pk) held++; }
  return n ? held / n : 0.6;
}
const WEEK = () => Math.floor(Date.now() / 6048e5);
function felt(name, n) {
  const log = prefs.get('felt', { week: WEEK(), songs: {} });
  if (log.week !== WEEK()) { prefs.set('feltLast', log); log.week = WEEK(); log.songs = {}; }
  log.songs[name] = (log.songs[name] || 0) + n;
  prefs.set('felt', log);
}
const chillsOf = (name) => prefs.get('chills', {})[name] || [];
let chillsSeen = { name: null, list: [] };   // (the seek map asks every frame: read storage only when the song or the marks change)
function currentChills() {
  const name = tracks[current] ? tracks[current].name : null;
  if (name !== chillsSeen.name) chillsSeen = { name, list: name ? chillsOf(name) : [] };
  return chillsSeen.list;
}
ui.chills = currentChills;
function markChills() {
  const t = tracks[current]; if (!t || !audio.playing) return;
  const all = prefs.get('chills', {}), at = Math.max(0, audio.rawTime() - 0.4);   // (the chill came a moment before the key)
  all[t.name] = [...(all[t.name] || []).filter((x) => Math.abs(x - at) > 4), +at.toFixed(2)].sort((a, b) => a - b);
  prefs.set('chills', all); felt(t.name, 3); chillsSeen.name = null; ui.setTracks(tracks, current, playTrack);
  world.chill(); ui.toast('Chills marked: this moment will glow every time.', 'info', 3000);
}
// Songs marked "not for me" never come up on their own (you can still pick them).
// Songs once marked "not for me" (cache/plays.json) still stay out of shuffle.
function toggleShuffle() {   // (always on: the button deals a fresh order)
  buildOrder(); dealState.orderAt = Math.max(0, dealState.order.indexOf(current)); dealState.dealt = null;
  ui.toast('A favorite, then one you barely know, back and forth. A skip always lands on a favorite.', 'info', 4200);
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
// A whole song for X, in a hidden browser the server starts (server.py render_song): ?xrender=<song name>.
const XRENDER = new URLSearchParams(location.search).get('xrender');
function reportListening(final = false, skip = false) {
  if (audio.streaming || XRENDER) return;
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
// "Not for me" (Oasis): saved in the history, kept out of shuffle from now on, and the next song starts.
function dislikeCurrent() {
  const t = tracks[current]; if (!t || t.file) return;
  t.disliked = true; dealState.dealt = null;
  fetch('/api/played', { method: 'POST', body: JSON.stringify({ name: t.name, seconds: 0, dislike: true }) })
    .then((r) => { if (!r.ok) console.warn('[loft] dislike not saved:', r.status); }, (err) => console.warn('[loft] dislike not saved:', err));
  playNext();
}
ui.pretty = prettyName;
ui.allChills = () => prefs.get('chills', {});
ui.onChill = async (i) => {   // play it from its first chill, a few seconds early so it builds in
  const c = chillsOf(tracks[i].name)[0];
  await playTrack(i);
  if (c !== undefined && current === i) seek(Math.max(0, c - 3));
};
ui.upNext = () => {   // (queue first, else the dealt song: the same one the player will start)
  if (tracks.length < 2) return '';
  const i = nextIndex(1), n = tracks.length, t = tracks[((i % n) + n) % n];
  return t ? prettyName(t.name) : '';
};
ui.onUndislike = (i) => {
  const t = tracks[i]; if (!t) return;
  t.disliked = false;
  fetch('/api/played', { method: 'POST', body: JSON.stringify({ name: t.name, seconds: 0, dislike: false }) })
    .then((r) => { if (!r.ok) console.warn('[loft] undo not saved:', r.status); }, (err) => console.warn('[loft] undo not saved:', err));
  ui.setTracks(tracks, current, playTrack);
  ui.toast(`${t.name} is back in the shuffle.`, 'info', 2600);
};

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
        jevFeel(track, lines);
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
const upNextBtn = document.getElementById('up-next');
// What plays next and, in a few plain words, why (so the back and forth can be seen working): painted when the song list
// opens, when a song starts and when the queue changes. It used to be painted only on opening, so a song queued with the list
// open still showed the old "up next".
const NEXT_WHY = { queue: 'from your queue', back: 'back where you were', fav: 'a favorite', new: 'one you barely know' };
function paintUpNext() {
  const i = tracks.length > 1 ? nextIndex(1) : -1, t = tracks[((i % tracks.length) + tracks.length) % tracks.length];
  upNextBtn.innerHTML = i >= 0 && t ? '<b>UP NEXT</b> <span></span> <i></i>' : '';
  if (!(i >= 0 && t)) return;
  upNextBtn.querySelector('span').textContent = prettyName(t.name);
  upNextBtn.querySelector('i').textContent = NEXT_WHY[nextWhy()] + (queue.length > 1 ? `, ${queue.length} lined up` : '');
  upNextBtn.title = 'Play it now';
  upNextBtn.onclick = () => { playNext(); ui.toggleDrawer(false); };
}
ui.onDrawerOpen = () => {
  document.getElementById('song-count').textContent = tracks.length;
  paintUpNext();
  return showLyrics();
};
const showLyrics = () => lyricsStatus().then(showLyricsProgress, (err) => console.warn('[loft] lyrics status unavailable:', err));

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
  return houseHue(g > r * 1.25 && g > b * 1.1 ? PALETTES[e].accent : hex);
};
// The house rule for a word's colour: orange, gold and yellow fold into red, green and teal into cyan.
function houseHue(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.08) return hex;
  const h = 60 * (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
  if (h <= 15 || h >= 190) return hex;
  // keep its strength (max) and floor (min); only the hue moves: red (max, min, min) or cyan (min, max, max)
  const [R, G, B] = h < 75 ? [mx, mn, mn] : [mn, mx, mx];
  return '#' + [R, G, B].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
const ORBIT = 'http://127.0.0.1:8050';
const plainLine = (t) => t.replace(/<[^>]*>|\[[^\]]*\]/g, '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
function jevFeel(track, ls) {
  if (!ls.length || location.port === '8061') return;
  fetch(`${ORBIT}/feelings?song=${encodeURIComponent(track.name)}`).then((r) => r.json()).then(({ lines: jl }) => {
    if (!jl || !jl.length || ls !== lines) return;
    const by = new Map(jl.map(([t, f, c]) => [plainLine(t), [f, c]]));
    for (const l of ls) {
      const hit = by.get(plainLine(l.text));
      if (hit && hit[0] !== 'none' && hit[1] >= 0.3) { l.top = hit[0]; l.charge = Math.max(l.charge, 0.45); l.jev = hit[0]; }
    }
  }).catch(() => {});
}
async function jevDJ(token) {
  if (queue.length || tracks.length < 3 || location.port === '8061' || dealFresh() >= 0) return;
  const played = dealState.playedLog.slice(-9).map((i) => tracks[i] && tracks[i].name).filter(Boolean);
  const q = new URLSearchParams({ now: tracks[current].name, played: played.join('|'), mood: sectionMood().primary });
  try {
    const r = await Promise.race([fetch(`${ORBIT}/jev/dj?${q}`).then((x) => x.json()), sleep(5000).then(() => ({}))]);
    if (token !== loadToken || !r.pick || queue.length) return;
    const i = tracks.findIndex((t) => t.name === r.pick);
    if (i >= 0 && i !== current && tier().includes(i)) { dealState.dealt = i;
      console.info('[loft] the helper picked the next song:', r.pick); }
  } catch {}
}
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
  const sm = sectionMood();
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

// ── murmurs ──────────────────────────────────────────────────────────
// then the house says so out loud: never over the singing, never near a song's start or end, at most
// one every four minutes, the first after a song has been going a while.
let lastMurmur = 0, murmurStart = Date.now();
async function murmur() {
  if (!voiceOn || !kokoro.ok || speaking || !audio.playing || !audio.duration || rendering || location.port === '8061') return;
  const t = audio.rawTime(), n = Date.now();
  if (n - Math.max(lastMurmur, murmurStart) < (lastMurmur ? 240000 : 90000) || t < 20 || audio.duration - t < 30) return;
  if (lines.some((l) => l.how !== 'adlib' && l.end > t - 1 && l.t < t + 9)) return;   // (singing now or soon: wait)
  let d;
  try { d = await (await fetch(`${ORBIT}/doing`, { cache: 'no-store' })).json(); } catch { return; }
  if (!d.cat || d.age > 25 || Math.random() < 0.4) return;
  lastMurmur = n;
  let text = pickMurmur(d.cat);
  try {
    const opts = [text, pickMurmur(d.cat), pickMurmur(d.cat)].filter((v, i, a) => a.indexOf(v) === i);
    const q = new URLSearchParams({ song: tracks[current].name, mood: sectionMood().primary, lines: JSON.stringify(opts) });
    const r = await Promise.race([fetch(`${ORBIT}/jev/murmur?${q}`).then((x) => x.json()), sleep(3000).then(() => ({}))]);
    if (r.pick && opts.includes(r.pick)) text = r.pick;
  } catch {}
  say(text, { prepared: kokoro.prepare(text, MURMUR_VOICE, MURMUR_SPEED), maxWait: 5, before: (lines.find((l) => l.t > t) || { t: Infinity }).t });
}
setInterval(murmur, 20000);

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
  if (audio.playing) { audio.pause(); stopSpeech(); world.goodbye(true); }
  else { world.goodbye(false); await audio.play(); }
  ui.setPlaying(audio.playing);
  alive();
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
audio.onEnded = () => {
  if (tracks[current]) felt(tracks[current].name, 1);
  ui.setPlaying(false);
  if (sleepMode === 'song') { setSleep(null); world.goodbye(true); ui.toast('Sleep: the Visualizer rests. Click play to wake it.', 'info', 6000); return; }
  if (tracks.length) playNext('ended');
};

// ── sleep timer (Esc menu): off, at the end of this song, or after 30 / 60 minutes.
// A timed sleep fades the music out over about 20 s, then pauses; the volume is back for next time.
let sleepMode = null, sleepT = 0, fadeT = 0;
function setSleep(v) {
  sleepMode = v; clearTimeout(sleepT);
  if (fadeT) { clearTimeout(fadeT); fadeT = 0; audio.setVolume(+ui.el.vol.value); }   // (changed your mind mid-fade: the music comes back)
  if (typeof v === 'number') sleepT = setTimeout(fallAsleep, v * 60000);
  for (const b of document.querySelectorAll('#sleep-seg button')) b.classList.toggle('on', String(b.dataset.sleep) === String(v ?? 'off'));
}
function fallAsleep() {
  if (!audio.playing) { setSleep(null); return; }
  const g = audio.master.gain, now = audio.ctx.currentTime;
  g.cancelScheduledValues(now); g.setTargetAtTime(0, now, 5);
  fadeT = setTimeout(() => {
    fadeT = 0;
    if (audio.playing) { audio.pause(); stopSpeech(); world.goodbye(true); ui.setPlaying(false); }
    audio.setVolume(+ui.el.vol.value);
    setSleep(null);
    ui.toast('Sleep: the Visualizer rests. Click play to wake it.', 'info', 6000);
  }, 20000);
}
function mountSleep() {
  const main = document.querySelector('#menu .menu-main'), before = main && main.querySelector('[data-go="settings"]');
  if (before) {
    const box = document.createElement('div');
    box.className = 'menu-group';
    box.innerHTML = '<div class="set-label">SLEEP</div><div class="seg" id="sleep-seg"><button data-sleep="off" class="on">Off</button><button data-sleep="song">Song end</button><button data-sleep="30">30 min</button><button data-sleep="60">60 min</button></div>';
    main.insertBefore(box, before);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      e.stopPropagation();
      const v = b.dataset.sleep;
      setSleep(v === 'off' ? null : v === 'song' ? 'song' : +v);
      if (v !== 'off') ui.toast(v === 'song' ? 'Sleep: after this song.' : `Sleep: in ${v} minutes, with a slow fade.`, 'info', 2600);
    });
  }
}
ui.onSeek = seek;
ui.el.play.onclick = togglePlay;
ui.el.prev.onclick = () => playBack();
ui.el.next.onclick = () => playNext();
document.getElementById('shuffle-btn').onclick = () => toggleShuffle();
ui.setShuffle(shuffle);
const volPct = document.getElementById('vol-pct');
ui.el.vol.oninput = () => { const v = +ui.el.vol.value; audio.setVolume(v); prefs.set('volume', v); volPct.textContent = Math.round(v * 100); };
volPct.textContent = Math.round(+ui.el.vol.value * 100);
// Scroll anywhere on the player bar: volume, 5% a notch.
let wheelAcc = 0;   // (a trackpad sends many small nudges: a notch is every 50 px of scroll)
ui.el.hud.addEventListener('wheel', (e) => {
  e.preventDefault();
  wheelAcc += e.deltaMode ? e.deltaY * 40 : e.deltaY;
  if (Math.abs(wheelAcc) < 50) return;
  e = { deltaY: wheelAcc }; wheelAcc = 0;
  ui.el.vol.value = Math.max(0, Math.min(1, +ui.el.vol.value + (e.deltaY < 0 ? 0.05 : -0.05)));
  ui.el.vol.oninput();
}, { passive: false });
ui.el.listBtn.onclick = () => ui.toggleDrawer();
ui.el.fsBtn.onclick = () => toggleFullscreen();
if (!XRENDER) initXVideo({ getSong: () => tracks[current]?.name ?? null });
// Full screen comes in two kinds: the page's own, and the window's (how the desktop icon opens the Loft, and what F11
// does). Both count, so the way out shows in either.
const fsWindow = matchMedia('(display-mode: fullscreen)');
const inFullscreen = () => !!document.fullscreenElement || fsWindow.matches;
const syncFullscreen = () => {
  const on = inFullscreen(), was = document.body.classList.contains('fs');
  document.body.classList.toggle('fs', on);
  //  I can just make the music player pop up") the player goes the moment full screen begins; the mouse brings it back
  if (on && !was) ui.hideNow();
  ui.el.fsBtn.title = on ? 'Back to the normal window' : 'Full screen'; ui.el.fsBtn.setAttribute('aria-label', ui.el.fsBtn.title);
};
document.addEventListener('fullscreenchange', syncFullscreen);
fsWindow.addEventListener('change', syncFullscreen);
window.addEventListener('resize', syncFullscreen);
syncFullscreen();
function setLyricsShown(on, quiet = false) {
  lyricsOn = on;
  prefs.set('lyrics', on);
  document.body.classList.toggle('no-lyrics', !on);
  document.getElementById('lyrics-btn').classList.toggle('on', on);
  if (!quiet) ui.toast(on ? 'Lyrics on' : 'Lyrics off: just the room and the music');
}
document.getElementById('lyrics-btn').onclick = () => setLyricsShown(!lyricsOn);
function toggleFullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen();
  // The window's own full screen is the server's to flip (a page may not leave it): it answers ok when it did, in the
  // Loft's own window. Anywhere else (a browser tab, a phone) the page's own full screen is used, as before.
  fetch('/api/window', { method: 'POST', body: '{}' }).then((r) => r.json()).then((j) => { if (!j.ok) pageFullscreen(); }).catch(pageFullscreen);
}
function pageFullscreen() {
  if (fsWindow.matches) return ui.toast('This window is in its own full screen: press F11 to leave it.', 'info', 6000);
  else {
    const el = document.documentElement, go = el.requestFullscreen || el.webkitRequestFullscreen;
    if (go) Promise.resolve(go.call(el)).catch((err) => report('Fullscreen refused: ' + err.message, err));
    else ui.toast('On iPhone: Share, then Add to Home Screen, for the Visualizer with no browser bars.', 'info', 6000);   // (iPhones have no page fullscreen)
  }
}

window.addEventListener('keydown', (e) => {
  if ((e.target.tagName === 'INPUT' && e.target.type !== 'range') || e.target.tagName === 'SELECT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;   // the browser's own shortcuts (Ctrl+F, Ctrl+X...) are never the loft's
  const k = e.key.toLowerCase();
  if (e.repeat && !['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) return;   // holding N must not start dozens of loads
  if (!entered && k !== 'f') { enter(); return; }
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'arrowright') seek(audio.rawTime() + (e.shiftKey ? 15 : 5));
  else if (k === 'arrowleft') seek(audio.rawTime() - (e.shiftKey ? 15 : 5));
  else if (k === 'arrowup' || k === 'arrowdown') {   // volume, 5% a press; the bar wakes to show it
    e.preventDefault();
    const v = Math.max(0, Math.min(1, +ui.el.vol.value + (k === 'arrowup' ? 0.05 : -0.05)));
    ui.el.vol.value = v; ui.el.vol.oninput();
  }
  else if (k === 'n') playNext();
  else if (k === 'p') playBack();
  else if (k === 's') toggleShuffle();
  else if (k === 'f') toggleFullscreen();
  else if (k === 'h') document.body.classList.toggle('bare');
  else if (k === 't') setLyricsShown(!lyricsOn);
  else if (k === 'l') { e.preventDefault(); ui.toggleDrawer(); }
  else if (k === 'escape') { if (ui.el.drawer.classList.contains('open')) ui.toggleDrawer(false); else settings.toggle(); }
  else if (k === '?' || k === '/') { e.preventDefault(); ui.toggleDrawer(true); ui.el.drawer.classList.add('show-keys'); const ks = document.getElementById('keys'); ks.scrollIntoView({ block: 'nearest' }); ks.classList.remove('flash'); void ks.offsetWidth; ks.classList.add('flash'); }
  else if (/^[0-9]$/.test(k) && audio.duration) seek(audio.duration * (+k / 10));   // 0 = the start, 5 = halfway
  else if (k === 'k') {   // the next chill (from the last, back round to the first)
    const cs = ui.chills(), now = audio.rawTime(), to = cs.find((c) => c > now + 1.5) ?? cs[0];
    if (to === undefined) ui.toast('No chills marked in this song yet. Press X when one hits.', 'info', 2600);
    else seek(Math.max(0, to - 3));   // a few seconds early, so it builds into it
  }
  else if (k === 'c') world._cut();
  else if (k === 'x') markChills();
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
  // Everything else that holds a position in the old list moves up too (the queue and the play log pointed at the wrong songs after a drop).
  for (let q = 0; q < queue.length; q++) queue[q] += added.length;
  dealer.shift(added.length);   // (what played, the way back, and the order, rebuilt for the longer list)
  hoverWant = -1; artFor = -1; ui.setQueue(queue);
  enter(false);
  playTrack(0, 'drop');   // new songs dropped in aren't a judgement on the one playing
});

// ── gate ──────────────────────────────────────────────────────────────
// The first song: the one asked for in the address (?play=Name, as the
// observatory sends), else the head of the shuffle (or the first not disliked).
function firstPick() {
  const want = new URLSearchParams(location.search).get('play');
  const asked = want ? tracks.findIndex((t) => t.name === want) : -1;
  if (asked >= 0) return asked;
  if (shuffle && tracks.length >= 3) return nextIndex(1);
  return Math.max(0, tracks.findIndex((t) => !t.disliked));
}
// Where you left off: the song, the moment in it and your queue, kept every few seconds (this
// browser only), so opening the Loft again carries on there (within 12 hours; after that a fresh start).
const SPOT = 'loft.spot';
setInterval(() => {
  const t = tracks[current];
  if (!t || t.file || !audio.playing || rendering) return;
  try { localStorage.setItem(SPOT, JSON.stringify({ name: t.name, t: audio.rawTime(), queue: queue.map((i) => tracks[i]?.name).filter(Boolean), at: Date.now() })); } catch { /* not remembered */ }
}, 4000);
function savedSpot() {
  if (new URLSearchParams(location.search).get('play')) return null;
  try {
    const s = JSON.parse(localStorage.getItem(SPOT) || 'null');
    return s && Date.now() - s.at < 12 * 3600e3 && tracks.some((t) => t.name === s.name) ? s : null;
  } catch { return null; }
}
async function resumeSpot(s) {
  for (const n of s.queue || []) { const i = tracks.findIndex((t) => t.name === n); if (i >= 0 && !queue.includes(i)) queue.push(i); }
  ui.setQueue(queue);
  const i = tracks.findIndex((t) => t.name === s.name);
  await playTrack(i, 'resume');
  for (let k = 0; k < 200 && (loadingTrack || !audio.duration); k++) await new Promise((r) => setTimeout(r, 50));
  if (current === i && s.t > 5 && s.t < audio.duration - 15) seek(s.t);   // (near the end: the song starts over instead)
}
async function enter(autoplay = true) {
  if (entered) return;
  entered = true;
  ui.hideGate();
  try { await audio.ctx.resume(); } catch (err) { report('Audio could not start: ' + err.message, err); }
  const last = prefs.get('feltLast', null), fl = prefs.get('felt', null);
  const prev = fl && fl.week !== WEEK() ? fl : last && last.week === WEEK() - 1 && !last.told ? last : null;
  if (prev && Object.keys(prev.songs).length) {
    const [best] = Object.entries(prev.songs).sort((a, b) => b[1] - a[1])[0];
    prefs.set('feltLast', { ...prev, told: true }); if (fl && fl.week !== WEEK()) prefs.set('felt', { week: WEEK(), songs: {} });
    const nice = best.replace(/\s*[—(].*$/, '');
    setTimeout(() => { ui.toast(`Your most-felt song last week: ${nice}`, 'info', 8000); if (voiceOn) say(`Your most-felt song last week was ${nice}.`, { maxWait: 4 }); }, 2500);
  }
  if (autoplay) {
    if (tracks.length) {
      if (shuffle) buildOrder();
      const spot = savedSpot();
      if (spot) resumeSpot(spot);
      else playTrack(firstPick());
    }
    else ui.setEmpty(true);
  }
}
document.getElementById('gate').addEventListener('click', () => enter());
document.getElementById('gl').addEventListener('dblclick', () => toggleFullscreen());   // double-click the room: fullscreen, like any player

// The frame-rate log: every minute of listening sends its frame rate (and its worst
// frames) to cache/perf.jsonl, so Settings can show whether frames fall over hours of
// play, which is what a hot, dusty card does. (Not while the PC test runs.)
const perfDts = [];
let perfSecs = 0;
const perfStalls = makeStalls();   // (the freezes of the minute: the frame rate below cannot show one, js/stalls.js)
// The frame probe: what each frame costs, the card's share (a timer query around the frame's
// drawing, read back a few frames later) and the browser's (the scene worked out and handed
// to the card). Each minute's typical frame and its slowest tenth go into the log too, so a
// slipping frame rate says whether the card or the browser is short of time.
const probe = (() => {
  const gl = world.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const waiting = [], gpu = [], cpu = [];
  let q = null, t0 = 0;
  const stat = (a) => { if (!a.length) return [null, null]; const s = [...a].sort((x, y) => x - y); return [+s[s.length >> 1].toFixed(2), +s[Math.floor(s.length * 0.9)].toFixed(2)]; };
  return {
    begin() { t0 = performance.now(); if (ext && waiting.length < 6) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); } },
    end() {
      cpu.push(performance.now() - t0);
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); waiting.push(q); q = null; }
      while (waiting.length && gl.getQueryParameter(waiting[0], gl.QUERY_RESULT_AVAILABLE)) {
        const w = waiting.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(w, gl.QUERY_RESULT) / 1e6);   // (a disjoint reading is no reading)
        gl.deleteQuery(w);
      }
    },
    take() { const [g, g90] = stat(gpu), [c, c90] = stat(cpu); gpu.length = 0; cpu.length = 0; return { gpu: g, gpu90: g90, cpu: c, cpu90: c90 }; },
  };
})();
function perfLog(dt, gap = dt) {
  if (!audio.playing || uncapped || document.hidden || !tracks[current]) { perfDts.length = 0; perfSecs = 0; perfStalls.drop(); probe.take(); return; }
  // (gap is the frame time before it is cut to 0.1 s. Not counted: the first frame after a pause or a hidden window, whose gap
  //  is the pause itself, and a song's first seconds, as for the frame-drop alert: loading a song is allowed a hitch.)
  perfStalls.see(gap, perfDts.length > 0 && audio.rawTime() > 4);
  perfDts.push(dt); perfSecs += dt;
  if (perfSecs < 60) return;
  const s = [...perfDts].sort((a, b) => b - a), low = 1 / s[Math.floor(s.length * 0.01)];
  const c = world.renderer.domElement;
  heat.fps = perfDts.length / perfSecs; heat.low = low;
  if (!audio.streaming) fetch('/api/perf', { method: 'POST', body: JSON.stringify({ song: tracks[current].name, fps: +(perfDts.length / perfSecs).toFixed(1), low: +low.toFixed(1), secs: Math.round(perfSecs), quality: settings.quality, cap: fpsCap, w: c.width, h: c.height, ...probe.take(), ...perfStalls.take() }) }).catch(() => {});
  perfDts.length = 0; perfSecs = 0; perfStalls.drop();
  // The heat watch: a card getting hot slips frames. Past the first five minutes of a
  // sitting, three minutes in a row under the limit (or with bad stutters) steps the
  // quality down one notch, and again if it keeps slipping. No override.
  const now = Date.now();
  if (now - heat.last > 30 * 60 * 1000) heat.start = now;   // a new sitting
  heat.last = now;
  const slip = (n) => n < targetFps * 0.9;
  const bad = now - heat.start > 5 * 60 * 1000 && (slip(heat.fps) || heat.low < targetFps * 0.6);
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
let dropT = 0, okT = 0, dropOn = false;
const fpsAlert = document.getElementById('fps-alert');
let alertN = null, alertOn = null;   // what the alert last showed
const beatEls = ['lyric', 'brand', 'play'].map((id) => document.getElementById(id)).filter(Boolean);
let lastRaw = performance.now(), refreshMs = 1000 / 60, refreshKnown = false, nextDue = 0, paceT = 0, targetFps = 60;
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
// minimized it already draws nothing (document.hidden). The preview (silent) stays at full unless ?eco, so loft.check is unchanged.
const ECO_FPS = 30, ECO_SCALE = 0.5;
let eco = false, fullRatio = world.pixelRatio;
// Esc menu → Settings: quality (how sharp the room is drawn) and the frame limit.
if (audio.streaming) import('./stream.js').then((m) => m.startStream(document.getElementById('gl'), audio));
const settings = makeSettings({
  prefs,
  exit: () => { if (audio.playing) { audio.pause(); stopSpeech(); } reportListening(true); },
  applyScale: (k) => { fullRatio = Math.min(2, Math.max(window.devicePixelRatio, 1) * k); world.pixelRatio = eco ? fullRatio * ECO_SCALE : fullRatio; world.resize(); },
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
  // The test's scene: Funeral's scream at 3:00. Afterwards the song you were on comes back where you left it.
  async benchScene() {
    const was = current, at = audio.rawTime(), playing = audio.playing;
    const i = tracks.findIndex((t) => /welcome to the funeral/i.test(t.name) && !/cover/i.test(t.name));
    if (i < 0) return () => {};
    if (i !== current) { await playTrack(i); for (let k = 0; k < 100 && (loadingTrack || !audio.duration); k++) await new Promise((r) => setTimeout(r, 100)); }
    seek(180);
    if (!audio.playing) togglePlay();
    return async () => {
      if (was === i) { seek(at); if (!playing && audio.playing) togglePlay(); return; }
      if (was >= 0) { await playTrack(was); for (let k = 0; k < 100 && (loadingTrack || !audio.duration); k++) await new Promise((r) => setTimeout(r, 100)); seek(at); if (!playing && audio.playing) togglePlay(); }
    };
  },
  rendered: () => ({ w: world.renderer.domElement.width, h: world.renderer.domElement.height }),
});
mountSleep();

function setEco(on) {
  if (on === eco || rendering) return;
  eco = on; world.pixelRatio = eco ? fullRatio * ECO_SCALE : fullRatio; world.resize();
}
if (!audio.silent || new URLSearchParams(location.search).has('eco')) {
  window.addEventListener('blur', () => setEco(true));
  window.addEventListener('focus', () => setEco(false));
  if (!document.hasFocus()) setEco(true);
}

function pace(raw) {
  if (raw > 0 && raw < 100) { rawDeltas.push(raw); if (rawDeltas.length > 120) rawDeltas.shift(); }
  if ((paceT += raw) < 2000 || rawDeltas.length < 60) return;
  paceT = 0;
  const s = [...rawDeltas].sort((a, b) => a - b);
  refreshMs = s[s.length >> 1];
  refreshKnown = true;
}
function frame(now, manual = false) {
  if (!manual) requestAnimationFrame(frame);
  if (rendering) return;   // the renderer drives the show frame by frame
  if (resting && !manual) { last = now; return; }   // another space is open over the Loft: the music plays on, the card rests
  const raw = now - lastRaw;
  lastRaw = now;
  if (!manual) pace(raw);   // (loft.run steps by timer, not by the screen)
  // The frame limit (Esc → Settings): a frame only when its time has come, on any monitor.
  // Once the screen's refresh is known, a frame lands on exactly every Nth refresh: evenly spaced, never a
  // 2-3-3-4 stagger (60 on a 165 Hz screen is 2.75 refreshes a frame; it stuttered in every song). N is the
  // whole number nearest the cap, never more than a quarter over it (165 Hz: 55 fps; 144: 72; 120: 60).
  const cap = eco ? Math.min(fpsCap, ECO_FPS) : fpsCap;
  if (!uncapped && refreshKnown && !manual) {
    let n = Math.max(1, Math.round(1000 / cap / refreshMs));
    if (1000 / refreshMs / n > cap * 1.25) n++;
    targetFps = 1000 / refreshMs / n;
    // ...scheduled by the clock, not by counting refreshes: when the browser skips a refresh (it does in
    // lows of 33 while the card drew in 9 ms). Now the next refresh draws it: still on the every-Nth grid
    // when on time, a fresh grid when it fell behind. (Simulated at 165 Hz with 10% skips: 49.5 -> 54.9 fps.)
    const iv = n * refreshMs;
    if (now < nextDue - refreshMs * 0.5) return;
    nextDue = now - nextDue > iv ? now + iv : nextDue + iv;
  } else {
    const iv = 1000 / cap;
    if (!uncapped && now < lastDraw + iv - 1) return;
    lastDraw = Math.max(lastDraw + iv, now - iv);
  }
  const gap = (now - last) / 1000, dt = Math.min(0.1, gap);
  last = now;
  const heard = audio.heardTime(dt);
  // The end of a song hands over: if the next one is loaded, it starts under the last 2.5 s while this
  // one fades away (no dead air). Not when the sleep timer waits for this song's end, nor during a render.
  if (audio.playing && !rendering && !loadingTrack && handedFor !== loadToken && sleepMode !== 'song' && audio.duration > 30 && audio.duration - audio.rawTime() < 2.5 && tracks.length > 1) {
    const ni = nextIndex(1), nt = tracks[((ni % tracks.length) + tracks.length) % tracks.length];
    if (nt && nt.ready && nt !== tracks[current]) {
      handedFor = loadToken;
      if (tracks[current]) felt(tracks[current].name, 1);
      fadeOut = Math.max(0.5, audio.duration - audio.rawTime()); fadeIn = 1.2;
      playTrack(ni, 'ended');
    }
  }
  const t = Math.max(0, heard + syncOffset);
  const spectrum = audio.playing ? audio.readSpectrum() : null;
  gpuTimer.begin(); probe.begin();
  const f = step(t, dt, spectrum);
  probe.end(); gpuTimer.end();

  fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.05;
  perfLog(dt, gap);
  helloFrames++; if (gap * 1000 > 1500 / Math.max(1, targetFps)) helloLate++;
  if ((statT += dt) > 0.5) { statT = 0; ui.setStats({ fps: fpsAvg }); }
  // The frame-drop alert (the corner's counter is hidden while the show runs): frames more than 10 short of
  // the target for over a second show the number in red; it fades once they're back for two seconds.
  // (Never in a song's first seconds: loading a song is allowed a hitch.)
  if (!manual) {
    const short = audio.playing && audio.rawTime() > 4 && fpsAvg < targetFps - 10;
    dropT = short ? dropT + dt : 0; okT = short ? 0 : okT + dt;
    if (dropT > 1 && !dropOn) dropOn = true;
    if (okT > 2 && dropOn) dropOn = false;
    // (written only when it changes: a DOM write every frame restyles for nothing)
    if (dropOn) { const n = Math.round(fpsAvg); if (n !== alertN) { alertN = n; fpsAlert.textContent = `${n} FPS`; } }
    if (dropOn !== alertOn) { alertOn = dropOn; fpsAlert.classList.toggle('on', dropOn); }
  }
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
  // A marked chills moment, reached: the room gives it a little extra.
  if (!rendering && audio.playing && tracks[current]) for (const c of currentChills()) if (t >= c && t < c + 0.25 && !world.chillDone.has(c)) { world.chillDone.add(c); world.chill(); }
  const f = conductor.update(t, dt, spectrum, live(), audio.ctx.sampleRate);
  if (map && audio.buffer) { syncWords(t); if (!rendering) announceNext(t); }
  world.featureGoal = map && live() && isInstrumental(t) ? 1 : 0;
  const nd = conductor.f.nextDrop, dropBuild = nd && nd.big && t >= nd.buildStart;
  world.screamGoal = map && audio.buffer && !loadingTrack && !dropBuild && inScream(t) ? 1 : 0;   // (a pause doesn't end a scream)
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
  if (!rendering && artFor !== current && t > 20 && audio.playing) grabArt();
  return f;
}

// In a screamed stretch (a plain loop: no closure made every frame).
function inScream(t) {
  for (const r of screamRuns) if (t >= r[0] - 0.05 && t < r[1] + 0.4) return true;
  return false;
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
      const cue = (lyricColors[tracks[current]?.name] || []).find((c) => Math.abs(c[0] - line.t) < 1.5);
      if (cue && live() && !seeked) world.wordColor(cue[1], Math.max(2.5, (line.end ?? line.t + 3) - line.t + 1));
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
  // The speed guard: the numbers that make the Loft feel fast, measured the same way every time
  // (Funeral's scream for drawing, a remembered song for starting). Compared against perf-baseline.json
  // before shipping: anything more than a quarter worse is a regression to fix first.
  async check() {
    const i = tracks.findIndex((t) => /welcome to the funeral/i.test(t.name) && !/cover/i.test(t.name));
    if (i < 0) return null;
    const gl = world.renderer.getContext(), px = new Uint8Array(4), c = world.renderer.domElement;
    // (a fresh start from the remembered map: not already playing, not held in memory)
    if (current === i) { await playTrack(i + 1, 'check'); for (let k = 0; k < 200 && loadingTrack; k++) await new Promise((r) => setTimeout(r, 25)); }
    bufferCache.delete(tracks[i].key); analysisCache.delete(tracks[i].key);
    const t0 = performance.now(); await playTrack(i, 'check');
    for (let k = 0; k < 200 && (loadingTrack || !audio.playing); k++) await new Promise((r) => setTimeout(r, 25));
    const start = performance.now() - t0;
    audio.volume = 0; seek(180); await this.run(2);
    const times = [];
    const of = world.frame; world.frame = function (...a) { const t = performance.now(); const r = of.apply(this, a); times.push(performance.now() - t); return r; };
    await this.run(6); world.frame = of;
    world.renderSize(1920, 1080, 1.5);
    const draw = []; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let k = 0; k < 5; k++) world.post.render();   // (warm-up)
    for (let k = 0; k < 25; k++) { const t = performance.now(); world.post.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); draw.push(performance.now() - t); }
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1], p99 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.99)];
    const mp = (c.width * c.height) / 1e6, size = `${c.width}x${c.height}`;
    world.resize();
    return { songStartMs: Math.round(start), drawMsPerMegapixel: +(med(draw) / mp).toFixed(2), sceneCpuP99Ms: +p99(times).toFixed(2), pixels: size };
  },
  // The other spaces (js/spaces.js): rest the Loft under them, warm and play songs they point at.
  rest(on) { resting = !!on; },
  // A song just brought home from the Lab: added to the end of the shelf (nothing else moves) and played.
  async arrive(name) {
    const fresh = (await (await fetch('/api/tracks')).json()).tracks || [];
    for (const t of fresh) if (!tracks.some((x) => x.url === t.url)) tracks.push({ ...t, key: t.url });
    ui.setTracks(tracks, current, playTrack); ui.setQueue(queue);
    const i = tracks.findIndex((t) => t.name === name);
    if (i >= 0) { playTrack(i); ui.toast(`${name} is on the shelf`); }
    setTimeout(() => mapShelf().catch(() => {}), 60000);
  },
  warm(name) { const i = tracks.findIndex((t) => t.name === name); if (i >= 0) hoverPrefetch(i); },
  async run(seconds) { const end = performance.now() + seconds * 1000; while (performance.now() < end) { frame(performance.now(), true); await new Promise((r) => setTimeout(r, 14)); } },
  get mood() { return mood; }, dislike: dislikeCurrent, sleep: (v) => setSleep(v ?? null), play(name, { announced = false } = {}) { const i = tracks.findIndex((t) => t.name === name); if (i >= 0) { if (announced) announcedNext = tracks[i].key; playTrack(i); } return i; }, reshuffle() { buildOrder(); return dealState.order.map((i) => tracks[i].name); }, get caches() { return { buffers: [...bufferCache.keys()], analyses: [...analysisCache.keys()] }; }, get map() { return map; }, get song() { return tracks[current]?.name ?? null; }, get lines() { return lines; }, get screams() { return screamRuns; }, get tracks() { return tracks.map((t) => t.name); } };
(async () => {
  bootStep('loading the lettering');
  if (document.fonts) {
    try { await Promise.all([document.fonts.load('800 100px Unbounded'), document.fonts.load('600 40px "Space Grotesk"')]); }
    catch (err) { console.warn('[loft] display fonts did not load; using system fonts.', err); }
  }
  bootStep('waking the voice');
  await kokoro.init();
  bootStep('reading the shelf');
  if (!kokoro.ok) ui.toast('Kokoro voice unavailable (' + kokoro.error + '). Using the browser voice.', 'warn', 9000);
  setupVoicePicker();
  await loadTrackList();
  // Walked in before the shelf was read: start now that it is.
  if (entered && current < 0 && tracks.length) {
    ui.setEmpty(false);
    if (shuffle) buildOrder();
    const spot = savedSpot();   // (as enter() does: carry on where you left off)
    if (spot) resumeSpot(spot); else playTrack(firstPick());
  }
  document.getElementById('gate-count').textContent = tracks.length
    ? `${tracks.length} song${tracks.length === 1 ? '' : 's'} on the shelf`
    : 'the shelf is empty: drop songs in music/ or onto this window';
  document.getElementById('gate').classList.remove('loading'); document.getElementById('gate-hint').textContent = 'begin';   // (only now does a tap start the room)
  requestAnimationFrame(frame);
  // Opened by the desktop icon (its own app window, allowed to play sound at once): no gate, the music
  // carries on where you left off, or the shuffle starts. In a normal tab the gate still waits for a click.
  if (/[?&]auto\b/.test(location.search)) {
    try { await audio.ctx.resume(); } catch { /* the gate stays */ }
    if (audio.ctx.state === 'running') enter();
  }
  if (/[?&]demo\b/.test(location.search)) makeDemo().catch((err) => demoSay('The demo failed: ' + err.message));
  if (XRENDER) renderForX(XRENDER).catch((err) => fetch('/api/render/fail', { method: 'POST', body: JSON.stringify({ error: err.message }) }));
})();

// ── A whole song for X, in the hidden render browser (server.py render_song) ──
// Loads the song, stops it at once (nothing is heard: the window is hidden and silent), and renders every
// frame offline as a lossless master; the server packs the X file as the frames arrive, then measures it.
async function renderForX(name) {
  const i = tracks.findIndex((t) => t.name === name);
  if (i < 0) throw new Error(`no song called "${name}" on the shelf`);
  audio.master.gain.value = 0;
  playTrack(i);
  for (let k = 0; k < 600 && !(audio.duration > 0 && map); k++) await new Promise((ok) => setTimeout(ok, 100));
  if (!(audio.duration > 0)) throw new Error(`"${name}" did not load`);
  if (audio.playing) audio.pause();
  const p = new URLSearchParams(location.search);
  return renderSong({ from: 0, fps: +p.get('fps') || 60, width: +p.get('w') || 1920, height: +p.get('h') || 1080, supersample: +p.get('ss') || 2, master: true, lean: p.has('lean'), onProgress: () => {} });
}

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
