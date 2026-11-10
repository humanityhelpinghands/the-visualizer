// The World: owns the renderer and every visible thing, and turns the
// conductor's per-frame features into motion, light, and cuts.
import * as THREE from 'three';
import { makeSky, makeFloor, makeStrings, makeRing, makeHalo, makeRain, palette } from './scene/world.js';
import { makeCore } from './scene/cores.js';
import { makePost } from './scene/post.js';
import { Director } from './scene/director.js';
import { PALETTES, AXES, VALENCE, STARS, TEMPER, BREATH, CAMERA, RINGS } from './emotion.js';

// Display-space colour for the grade (no linearisation).
const srgb = (hex, v = new THREE.Vector3()) => {
  const n = parseInt(hex.slice(1), 16);
  return v.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

// The other side's colour worlds: each feeling and its opposite.
const OPPOSITE = { anger: 'calm', calm: 'anger', sadness: 'joy', joy: 'sadness', fear: 'hope', hope: 'fear',
  loneliness: 'love', love: 'loneliness', desire: 'mystery', mystery: 'desire', nostalgia: 'defiance', defiance: 'nostalgia',
  powerpoint: 'neon', neon: 'kawaii', kawaii: 'powerpoint' };
// A third light: each feeling lent a neighbour's colours (near in spirit, new to the eye).
const NEIGHBOUR = { anger: 'desire', desire: 'love', love: 'nostalgia', nostalgia: 'hope', hope: 'joy', joy: 'neon',
  sadness: 'loneliness', loneliness: 'mystery', mystery: 'calm', calm: 'sadness', fear: 'anger', defiance: 'powerpoint',
  powerpoint: 'kawaii', neon: 'powerpoint', kawaii: 'neon' };
const THEMES = [null, OPPOSITE, NEIGHBOUR];

// The core's designed colour pairs, [rim, body], on its black heart: clean, cool,
// never orange or gold, never clashing. Every feeling (and look) wears one.
const CORE_PAIRS = {
  anger: ['#ffffff', '#ff1030'], defiance: ['#ffffff', '#2050ff'], fear: ['#ff1840', '#3a0010'],
  sadness: ['#9fd8ff', '#1838ff'], loneliness: ['#c8b8ff', '#2a1a9a'], calm: ['#ffffff', '#5ec8ff'],
  mystery: ['#38e8ff', '#6a20ff'], love: ['#ff7ab8', '#c0103a'], desire: ['#ff3ca8', '#5a10d0'],
  joy: ['#ffffff', '#ff3a9a'], hope: ['#a8e4ff', '#ff4fa0'], nostalgia: ['#ffc8e0', '#7a3ad8'],
  powerpoint: ['#ff5a8a', '#6a10c0'], kawaii: ['#ffffff', '#ff8ad0'], neon: ['#ff2a6d', '#2440ff'],
};

// Never orange or gold in the grade, the bloom or the flash either (they come straight
// from the palettes, not through the colour key): any warm tint folds into red.
function noOrange(v) {
  _c.setRGB(v.x, v.y, v.z, THREE.SRGBColorSpace).getHSL(_h, THREE.SRGBColorSpace);
  if (_h.s > 0.08 && _h.h > 0.012 && _h.h < 0.2) { _c.setHSL(0.012 * (1 - (_h.h - 0.012) / 0.188), _h.s, _h.l, THREE.SRGBColorSpace); _c.getRGB(_c, THREE.SRGBColorSpace); v.set(_c.r, _c.g, _c.b); }
  return v;
}

const CUT_BARS = [8, 4, 4, 2];   // a cut every N bars by loudness, for songs without written parts
// The camera follows the song's parts: verses close and intimate, the pre-chorus
// pushing in, choruses wide and travelling, the bridge seen from outside, the ends
// vast. ('low' stays out: it looks across the strings and floor and magnifies
// every ripple.)
const PART_VIEWS = {
  intro: ['vast', 'orbit', 'top'], verse: ['close', 'orbit', 'dolly', 'top'], prechorus: ['dolly', 'crane', 'top'],
  chorus: ['orbit', 'fly', 'crane', 'top'], bridge: ['top', 'crane', 'vast'], outro: ['vast', 'orbit', 'top'],
};
// (top, the aerial, is the most cinematic: every part and level may use it.)
const LEVEL_VIEWS = [['orbit', 'dolly', 'vast', 'top'], ['close', 'orbit', 'dolly', 'top'], ['orbit', 'crane', 'dolly', 'top'], ['orbit', 'fly', 'crane', 'top']];
// ...and each part keeps its own pace: verses and bridges hold a shot for 8 bars,
// the pre-chorus and chorus for 4 (the last chorus 2), the outro holds one.
const PART_CUT = { intro: 8, verse: 8, prechorus: 4, chorus: 4, bridge: 8, outro: 16 };
// How fast the shots move in each part: verses slower, each chorus a touch faster
// than the last, the outro slowest.
const PART_PACE = { verse: 0.75, prechorus: 1, chorus: 1, bridge: 0.8, outro: 0.5, intro: 0.8 };
// Each part's arc: where it starts and where it climbs to by its end (a chorus
// arrives near the top and still climbs; the outro settles back down).
const ARC = { intro: [0, 0.15], verse: [0.1, 0.4], prechorus: [0.3, 1], chorus: [0.75, 1], bridge: [0.2, 0.7], outro: [0.5, 0] };

// A layer's colours: the feeling's ramp turned to the layer's own hue. Lights and
// darks stay the feeling's (so the mood holds); the colour becomes the layer's.
const _c2 = new THREE.Color(), _c3 = new THREE.Color();
const _c = new THREE.Color(), _dual = new THREE.Color(), _h = { h: 0, s: 0, l: 0 }, _a = { h: 0, s: 0, l: 0 };
// fire: a gold or yellow anchor shades like flame, its darker tones turning toward
// ember red-orange, because a dark yellow is olive, the grey slime the core must
// never be.
function turnRamp(ramp, anchor, out, fire = false) {
  _c.set(anchor).getHSL(_a, THREE.SRGBColorSpace);
  ramp[3].getHSL(_h, THREE.SRGBColorSpace);
  const d = _a.h - _h.h;
  const yellow = fire ? Math.max(0, 1 - Math.abs(_a.h - 0.14) / 0.09) : 0;
  // A tone the turn would land in green (the ramp's other hues carried along) is
  // drawn back to the anchor's own hue, smoothly, unless the anchor itself is green.
  const greenAnchor = _a.h > 0.2 && _a.h < 0.45;
  ramp.forEach((c, i) => {
    c.getHSL(_h, THREE.SRGBColorSpace);
    const ember = -0.1 * yellow * Math.max(0, 1 - _h.l / 0.6);
    let hue = (_h.h + d + ember + 2) % 1;
    if (!greenAnchor) {
      const g = smooth(0.17, 0.22, hue) * smooth(0.52, 0.45, hue);
      let dh = _a.h - hue; dh -= Math.round(dh);
      if ((hue - 0.3) * (hue + dh - 0.3) < 0) dh -= Math.sign(dh);   // never pulled across the green's middle: round the other way
      hue = (hue + dh * g + 2) % 1;
    }
    // The core (fire) wears only vivid colour: saturated, its brightest tone never
    // near-white (pale tones bloom into a white-washed gas ball; the glow lifts a deep
    // colour to its brightness and it stays colour).
    const sat = Math.min(1, _h.s * 0.6 + _a.s * 0.4);
    out[i].setHSL(hue, fire ? Math.max(0.85, sat) : sat, fire ? Math.min(0.6, _h.l) : _h.l, THREE.SRGBColorSpace);
  });
  return out;
}
// Mix two colours the way paint never can: round the colour wheel (the short way),
// so a blue and an orange meet in a vivid violet-red, never in grey.
const _m = { h: 0, s: 0, l: 0 }, _anchor = new THREE.Color();
function mixVivid(col, toward, k) {
  if (k <= 0) return col;
  col.getHSL(_h, THREE.SRGBColorSpace); _c.set(toward).getHSL(_m, THREE.SRGBColorSpace);
  let dh = _m.h - _h.h; dh -= Math.round(dh);
  if (_h.s < 0.08) { _h.h = _m.h; dh = 0; }   // a grey has no hue of its own to start from
  // ...and never through green: when the short way crosses it (orange to cyan runs
  // through yellow-green), go the long way, through red and violet.
  const green = (x) => { x = ((x % 1) + 1) % 1; return x > 0.22 && x < 0.43; };
  if (dh && !green(_h.h) && !green(_m.h)) {
    let crosses = false;
    for (let i = 1; i < 8 && !crosses; i++) crosses = green(_h.h + (dh * i) / 8);
    if (crosses) dh += dh > 0 ? -1 : 1;
  }
  return col.setHSL((((_h.h + dh * k) % 1) + 1) % 1, _h.s + (_m.s - _h.s) * k, _h.l + (_m.l - _h.l) * k, THREE.SRGBColorSpace);
}
const ramp5 = () => [0, 1, 2, 3, 4].map(() => new THREE.Color());
// Turn one colour by `deg` degrees of hue and scale its saturation (display space).
// The key never turns a colour toward green (the lime and olive the house never
// wears): warm colours (red, orange, gold) always turn toward red and magenta, cool
// ones (teal, cyan, blue) toward blue and violet; violets and pinks either way. The
// rule fades in and out over a few degrees, so a colour gliding across never jumps.
// swing: the wall's own swing, which follows the same rule (a teal wall swinging
// back and forth would dip into green on every other bar); turn: a plain turn on
// top (its sweep of the whole circle after a drop).
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function keyDir(h, s, sign) {
  const vivid = smooth(0.08, 0.16, s);
  const warm = (h < 0.5 ? smooth(0.34, 0.28, h) : smooth(0.9, 0.98, h)) * vivid;
  const cool = smooth(0.28, 0.34, h) * smooth(0.66, 0.58, h) * vivid;
  return sign * (1 - warm - cool) - warm + cool;
}
// The drop's turn of the whole circle skips the green: it runs on a wheel with the
// green cut out (gold carries straight on into cyan), so the wall's sweep never
// passes through a colour the house never wears.
const G0 = 0.012, GW = 0.458;   // (orange, gold and green all cut out: the wheel runs red, pink, violet, blue, cyan and back to red)
const toWheel = (h) => (h < G0 ? h : h < G0 + GW ? G0 : h - GW);
const fromWheel = (u) => (u < G0 ? u : u + GW);
function keyed(src, dst, deg, sat, swing = 0, turn = 0) {
  src.getHSL(_h, THREE.SRGBColorSpace);
  const d = keyDir(_h.h, _h.s, Math.sign(deg)) * Math.abs(deg / 360) + keyDir(_h.h, _h.s, Math.sign(swing)) * Math.abs(swing / 360);
  let h = (((_h.h + d) % 1) + 1) % 1;
  if (turn) { const L = 1 - GW; h = fromWheel((((toWheel(h) + (turn / 360) * L) % L) + L) % L); }
  // ...and never into brown: a dark orange reads as mud. Dark tones in the orange
  // band slide to deep red (embers, blood); bright ones keep their glowing amber.
  if (h > 0.03 && h < 0.13 && _h.l < 0.42) h = 0.01 + (h - 0.03) * (_h.l / 0.42) * 0.4;   // darkest: pure deep red
  // ...and never orange or gold (a style choice): every
  // orange, amber and gold folds into red.
  if (h > 0.012 && h < 0.2) h = 0.012 * (1 - (h - 0.012) / 0.188);
  // ...and never green or teal: they fold into cyan (fear's mint is cyan here).
  else if (h >= 0.2 && h < 0.5) h = 0.5 + 0.02 * (h - 0.2) / 0.3;
  return dst.setHSL(((h % 1) + 1) % 1, Math.min(1, _h.s * sat), _h.l, THREE.SRGBColorSpace);
}

// The world's own numbers (and objects of only numbers), copied: what a clip
// render restarts from (World.restart).
const plainNumbers = (o) => !!o && Object.getPrototypeOf(o) === Object.prototype && Object.values(o).every((v) => typeof v === 'number');
function numbersOf(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (plainNumbers(v)) out[k] = { ...v };
  }
  return out;
}

export class World {
  constructor(canvas, { sampleRate = 48000 } = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) throw new Error('This browser has no WebGL2. The loft needs it.');
    // Supersampled: drawn at 1.5x the screen (and scaled down) so every line is fine
    // and steady, a "4K" look on a 1080p screen. ?q=low draws at the screen's own size.
    const ss = /[?&]q=low/.test(location.search) ? 1 : 1.5;
    this.pixelRatio = Math.min(2, Math.max(window.devicePixelRatio, 1) * ss);
    renderer.setPixelRatio(this.pixelRatio);
    // Neutral keeps hue and saturation through the highlights (ACES bleaches them toward white).
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;
    this.sampleRate = sampleRate;
    // 64 log-spaced spectrum bands: where the lead sits (the wall follows it in a solo).
    this.specLevels = new Float32Array(64);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);

    this.pal = palette();                 // the feeling's own colours (the lyrics, the drawer and the wall's peaks wear them)
    // Every other layer has its own hue in the feeling's harmony (emotion.js layers).
    this.palSky = palette(); this.palFloor = palette(); this.palCore = palette();
    this.wallRamps = [ramp5(), ramp5(), ramp5()];
    // The mood's colours as they glide (unkeyed); the colour key turns them every frame.
    this.base = { ramp: ramp5(), accent: new THREE.Color(), sky: ramp5(), floor: ramp5(), core: ramp5(), wall: [ramp5(), ramp5(), ramp5()] };
    // The colour key: how far the song has carried the colours from the mood's home
    // (its section and its harmony, see main.js), plus the wall's own motion.
    this.key = { shift: 0, sat: 1, goalShift: 0, goalSat: 1, sweepT: -99 };
    // Where the colour world is heading (the pal uniforms glide toward it).
    this.tgt = {
      ramp: [0, 1, 2, 3, 4].map(() => new THREE.Color()), accent: new THREE.Color(),
      shadow: new THREE.Vector3(), highlight: new THREE.Vector3(), halo: new THREE.Vector3(), flash: new THREE.Vector3(),
      fx: new THREE.Vector4(), sat: 1, split: 0.6, light: 1, starCut: 0.987, vigK: 1,
      sky: ramp5(), floor: ramp5(), core: ramp5(), wall: [ramp5(), ramp5(), ramp5()],
    };
    this.cur = {
      shadow: new THREE.Vector3(), highlight: new THREE.Vector3(1, 1, 1), halo: new THREE.Vector3(1, 1, 1),
      flash: new THREE.Vector3(1, 1, 1), fx: new THREE.Vector4(), sat: 1, split: 0.6, light: 1, starCut: 0.987, vigK: 1,
    };
    this.moodKey = '';
    this.sky = makeSky(this.palSky);
    this.floor = makeFloor(this.palFloor);
    this.rain = makeRain(this.floor.mesh.position.y);
    this.strings = makeStrings(this.palFloor, this.floor.uniforms);
    this.strings.mesh.position.y = this.floor.mesh.position.y + 0.35;   // strung just above the ground
    this.ring = makeRing(sampleRate);
    this.core = makeCore(this.palCore);
    this.halo = makeHalo(this.palCore);
    // (The halo's smoke rings bursting out of the core are gone: they never fit. The
    // halo still keeps its timing for whatever listens, but nothing draws it.)
    this.scene.add(this.sky.mesh, this.floor.mesh, this.ring.mesh, this.core.group, this.rain.group);   // (the strings ring the backbeat's light through the floor's own grid; their old net is retired)

    this.post = makePost(renderer, this.scene, this.camera);
    this.director = new Director(this.camera);

    this.fxBoost = new THREE.Vector4();   // weather called by a sung word
    this.part = null;           // the song's part (verse, chorus...) when the lyrics say (main.js setPart)
    this.sustain = 0; this.sustainGoal = 0;   // a held note (main.js): the room holds it with the singer
    this.feature = 0; this.featureGoal = 0;   // a solo / instrumental stretch: the band carries the show
    this.flare = 0; this.afterglow = 0;       // a drop's flare on the core, and the glow it leaves
    this.scream = 0; this.screamGoal = 0;     // a screamed stretch (main.js): rewarded like a big drop
    // A sung word's feeling in the core's heart (feelHeart), and the line's feeling
    // as a swell that rises within a beat and lingers two bars (lineFeel).
    this.heartAmt = 0; this.heartUntil = -1; this.feelE = null; this.feelGoal = 0; this.feelAmt = 0;
    this.heartAmtGoal = 0; this.heartGoal = new THREE.Color(); this.heartCol = new THREE.Color(); this.heartMix = new THREE.Color();
    this.stabGoal = 0;
    // The core's temperament, eased toward the part's (TEMPER), its phases, and the
    // self dissolving on a line that sings it (dissolveGoal, main.js).
    this.facets = [['calm', 1]]; this.axes = {};
    this.temper = { ...TEMPER.calm }; this.phase = { boil: 0, spike: 0, flow: 0, tw: 0 };
    this.dissolve = 0; this.dissolveGoal = 0; this.partPos = 0; this.partDepth = 0;
    this.arc = 0; this.depth = 0; this.resolve = 0;   // the part's climb, a chorus's return, the outro coming to rest
    this.stab = 0; this.screamLineT = -99; this.songT = 0;
    this.reigning = false;      // a big drop's loud stretch is under way
    this.moodBase = 'calm';
    this.swell = 0;      // a hook line: the colour rises
    this.barsSinceCut = 0;
    this.R = Math.random;   // the dice for camera choices (dice(): a render's take rolls its own)
    this.flash = 0; this.glitch = 0; this.spread = 0;
    this.explodeUntil = -1;
    this.kickless = false;
    this.time = 0;
    this.voice = 0;   // loudness of the announcer, 0..1 (main.js feeds it)
    this.lyricOn = false;   // a lyric line is on screen (main.js feeds it)
    this.wallDim = 1;
    this._db = new THREE.Vector2();
    this._silence = new Uint8Array(1024);
    this.setMood('mystery', 'mystery', null, 0, true);
    this.resize();
    this._born = numbersOf(this);   // (restart() goes back to these)
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.post.composer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Draw at a fixed size, whatever the window (a clip render, render.js), drawn
  // `ss` times larger and scaled down; resize() goes back to the window.
  renderSize(w, h, ss = 1.5) {
    this.renderer.setPixelRatio(ss);
    this.post.composer.setPixelRatio(ss);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // A clip render's takes (render.js): the camera's choices roll the take's own dice
  // (Math.random live); the render starts on the song's clock with every number of
  // the world as it was built (a number born later is dropped: each falls back to
  // its own default), the shell unturned and no rings, ripples or plucks still
  // running; after its first step it cuts to a fresh shot, chosen as if none came
  // before and settled at once. So the same take of a clip is the same film, whatever
  // the room was doing. (Colours ease toward the song's in the run-up.)
  dice(R) { this.R = this.director.R = R; }
  restart(t) {
    for (const [k, v] of Object.entries(this)) if (!(k in this._born) && (typeof v === 'number' || typeof v === 'boolean' || plainNumbers(v))) delete this[k];
    for (const [k, v] of Object.entries(this._born)) {
      if (typeof v !== 'object') this[k] = v;
      else { for (const key of Object.keys(this[k])) delete this[k][key]; Object.assign(this[k], v); }
    }
    this.time = t; this.part = null;
    this.core.shell.rotation.set(0, 0, 0);
    this.halo.clear(); this.floor.clear(); this.strings.clear();
  }
  freshShot() { this.director.shot = null; this._cut(); this.director.settle(); }

  setTrack(name, map) {
    this.part = null;
    this.endRing = false; this.wasQuiet = false; this.reigning = false;
    this.scream = 0; this.screamGoal = 0; this.screamLineT = -99;
    // The feelings start fresh with each song (heartUntil is in song time).
    this.heartAmt = 0; this.heartAmtGoal = 0; this.heartUntil = -1; this.partPos = 0; this.partDepth = 0; this.arc = 0; this.feelE = null; this.feelGoal = 0; this.feelAmt = 0;
    this.dissolveGoal = 0; this.dissolve = 0; this.resolve = 0; this.depth = 0;
    this.kickless = !map || map.kicks.length < map.beats.length * 0.25;
    this.barsSinceCut = 0;
    this.theme = 0; this.turnAt = -99;
    // Every song its own look: a twist of hue on its feelings' colours, read from its
    // name (the same song always looks the same; two hope songs never look alike).
    let hh = 2166136261; for (const ch of String(name || '')) hh = Math.imul(hh ^ ch.charCodeAt(0), 16777619);
    this.songShift = (((hh >>> 0) % 1000) / 999 * 2 - 1) * 38;
    // A song with few big moments (drops, peaks) lets its smaller ones move it on too.
    const secs = (map && map.sections) || [], bigs = ((map && map.drops) || []).filter((d) => d.big).length;
    this.starved = bigs + secs.filter((x) => x.level >= 3 && x.energy >= 0.9 && x.bars >= 8 && !x.drop).length < 2;
    this.wasLyric = false; this.lyricOffT = -99; this.hushK = 0;
    this.wakeT = this.time; this.woke = false;   // the room wakes for every song   // every song starts in its own colours
  }

  // The colour world: `base` emotion sets the tones, `accent` emotion lends its
  // glint (a song's second feeling), `bleed` washes in a sung line's own feeling.
  // F (optional): the part's whole snapshot (emotion.js readSong): up to four
  // feelings with weights, and the six axes. Each element wears one of them.
  setMood(base, accent = base, bleed = null, bleedAmt = 0, snap = false, F = null) {
    // The other side: every feeling wears its opposite's colour world (each one a
    // designed palette of its own, so the mirror is never muddy and never green).
    this.moodArgs = [base, accent, bleed, bleedAmt, false, F];
    const map = THEMES[this.theme || 0];
    if (map) {
      const o = (e) => (e && map[e]) || e;
      base = o(base); accent = o(accent); bleed = o(bleed);
      if (F && F.v) F = { ...F, v: F.v.map(([e, w]) => [o(e), w]) };
    }
    const facets = F && F.v && F.v.length ? F.v : [[base, 1]], ax = (F && F.ax) || {};
    this.facets = facets; this.axes = ax;
    const key = [base, accent, bleed, bleedAmt.toFixed(2), facets.map(([e, w]) => e + w.toFixed(2)).join(','), AXES.map((a) => (ax[a] || 0).toFixed(1)).join(',')].join('|');
    if (key === this.moodKey && !snap) return;
    this.moodKey = key;
    this.moodBase = PALETTES[base] ? base : 'calm';
    const P = PALETTES[base] || PALETTES.calm, A = PALETTES[accent] || P, B = bleed && PALETTES[bleed];
    const t = this.tgt, v = new THREE.Vector3();
    // A line's own feeling glints in the room (accent, halo, the brightest tones);
    // it never repaints the shadows, so the section's mood stays itself.
    const reach = [0, 0, 0.15, 0.45, 0.6];
    P.ramp.forEach((hex, i) => { t.ramp[i].set(hex); if (B) mixVivid(t.ramp[i], B.ramp[i], bleedAmt * reach[i]); });
    mixVivid(t.accent.set(P.accent), A.accent, A === P ? 0 : 0.35);   // the second feeling tints the glint, never takes it
    if (B) mixVivid(t.accent, B.accent, Math.min(1, bleedAmt * 2.2));
    srgb(P.shadow, t.shadow); srgb(P.highlight, t.highlight); srgb(P.halo, t.halo);
    srgb(P.accent, t.flash).lerp(new THREE.Vector3(1, 1, 1), 0.5);
    t.split = P.split;
    // The whole snapshot. Weather: every feeling's own, weighted, so grief's rain
    // falls through hope's faint aurora (never more than one feeling's worth), plus
    // awe's aurora and release's embers. Light and saturation: the weighted mean.
    const fx = [0, 0, 0, 0];
    let light = 0, sat = 0, starCut = 0;
    for (const [e, w] of facets) {
      const Q = PALETTES[e] || P;
      Q.fx.forEach((x, i) => { fx[i] += w * x; });
      light += w * Q.light; sat += w * Q.sat; starCut += w * (STARS[e] || 0.987);
    }
    fx[1] += 0.4 * (ax.release || 0);
    t.fx.fromArray(fx); t.light = light; t.sat = sat;
    t.starCut = starCut - 0.008 * (ax.vast || 0);   // awe fills the sky with stars (crisp points, not a curtain of haze)
    const wOf = (e) => (facets.find(([x]) => x === e) || [e, 0])[1];
    t.vigK = 1 + 0.25 * (wOf('fear') + wOf('loneliness')) - 0.1 * (wOf('hope') + wOf('joy'));
    // Bittersweet: the highlights lean toward the heaviest feeling that leans against
    // the main one (warm hope over cool grief), else toward the second feeling.
    const w0 = facets[0][1], sgn = VALENCE[facets[0][0]] || 0;
    const counter = facets.slice(1).find(([e]) => sgn && (VALENCE[e] || 0) === -sgn) || facets[1];
    if (counter) t.highlight.lerp(srgb(PALETTES[counter[0]].highlight, v), 0.65 * Math.min(1, (2 * counter[1]) / w0));
    if (B) {
      t.highlight.lerp(srgb(B.highlight, v), bleedAmt * 0.6);
      t.halo.lerp(srgb(B.halo, v), Math.min(1, bleedAmt * 1.6));
    }
    noOrange(t.shadow); noOrange(t.highlight); noOrange(t.halo); noOrange(t.flash);
    // Each element wears a facet: the sky leans to the second feeling, and each band
    // of the wall (bass, mids, highs) can take the first, second and third feelings'
    // own colours, never more than 90 degrees from the main feeling's (all within
    // the house's night). The floor and core keep the main feeling.
    const Ly = P.layers, cast = (w) => Math.max(0, Math.min(1, (w - 0.1) / 0.3)) * 0.7;
    const sky = _anchor.set(Ly.sky);
    if (facets[1]) mixVivid(sky, PALETTES[facets[1][0]].layers.sky, cast(facets[1][1]));
    turnRamp(t.ramp, sky, t.sky); turnRamp(t.ramp, Ly.floor, t.floor); turnRamp(t.ramp, Ly.core, t.core, true);
    Ly.wall.forEach((hex, i) => {
      const a = _anchor.set(hex), f = facets[i];
      if (f && f[0] !== base) {
        a.getHSL(_h, THREE.SRGBColorSpace); _c.set(PALETTES[f[0]].layers.wall[i]).getHSL(_m, THREE.SRGBColorSpace);
        let dh = _m.h - _h.h; dh -= Math.round(dh);
        mixVivid(a, PALETTES[f[0]].layers.wall[i], cast(f[1]) * Math.min(1, 0.25 / Math.max(1e-3, Math.abs(dh))));
      }
      turnRamp(t.ramp, a, t.wall[i]);
    });
    if (snap) { this._glide(1); this._paint(0); }
  }

  // A new feeling reaches the heart first and spreads outward: kc for the core
  // and the glint, km for the floor, strings, wall and the grade's
  // tints, ks for the sky, its weather and the light (one k for all: a snap).
  _glide(kc, km = kc, ks = kc) {
    const t = this.tgt, u = this.cur, b = this.base;
    // Round the colour wheel (the short way), never through grey.
    b.ramp.forEach((col, i) => mixVivid(col, t.ramp[i], kc));
    mixVivid(b.accent, t.accent, kc);
    b.core.forEach((col, i) => mixVivid(col, t.core[i], kc));
    b.floor.forEach((col, i) => mixVivid(col, t.floor[i], km));
    b.wall.forEach((r, j) => r.forEach((col, i) => mixVivid(col, t.wall[j][i], km)));
    b.sky.forEach((col, i) => mixVivid(col, t.sky[i], ks));
    u.shadow.lerp(t.shadow, km); u.highlight.lerp(t.highlight, km); u.halo.lerp(t.halo, km); u.flash.lerp(t.flash, kc);
    u.fx.lerp(t.fx, ks); u.sat += (t.sat - u.sat) * km; u.split += (t.split - u.split) * km; u.light += (t.light - u.light) * ks;
    u.starCut += (t.starCut - u.starCut) * ks; u.vigK += (t.vigK - u.vigK) * ks;
  }

  // Where the song has carried the colours: `shift` degrees of hue around the
  // mood's harmony (section + harmony, from main.js) and a saturation lift.
  colorKey(shift, sat = 1) { this.key.goalShift = shift; this.key.goalSat = sat; }

  // Write the keyed colours into every layer. `wallSwing`, `wallTurn`: the wall's own
  // extra motion (see keyed).
  _paint(wallSwing, wallTurn = 0) {
    const b = this.base, K = this.key, d = K.shift + (this.songShift || 0), s = K.sat;
    // The music's voice (the core, the wall) moves fully; the room around it (sky,
    // floor) moves less, so the feeling's designed harmony always frames the motion.
    const out = (pal, ramp, w, sw = 0, turn = 0) => {
      ramp.forEach((c, i) => keyed(c, pal.uRamp.value[i], d * w, s, sw, turn));
      keyed(b.accent, pal.uAccent.value, d * w, s, sw, turn);
      pal.uColA.value.copy(pal.uRamp.value[1]); pal.uColB.value.copy(pal.uRamp.value[3]); pal.uColC.value.copy(pal.uAccent.value);
    };
    out(this.pal, b.ramp, 1); out(this.palSky, b.sky, 0.4); out(this.palFloor, b.floor, 0.6); out(this.palCore, b.core, 1, wallSwing, wallTurn + (this.coreTurn || 0) + 35 * Math.sin(this.time * 0.13));   // the core moves through colour with the music too
    this.wallRamps.forEach((r, j) => r.forEach((col, i) => keyed(b.wall[j][i], col, d, s, wallSwing, wallTurn)));
  }

  // The song's structure, as written in its lyrics, sets how the camera moves.
  // Called every frame; a new part cuts on the downbeat where it begins.
  setPart(part) {
    if (part === this.part) return;
    const first = this.part === null;
    this.part = part;
    if (first || this.reigning || this.screamGoal) return;   // a big drop or a scream outranks the part it lands in
    this._cut();
  }

  // A hook line: the colour rises.
  hookMoment() { this.swell = 1; }

  // A feeling word: the heart takes its colour (the strongest word wins, never a
  // sum), holds it while the word is sung (until: song time), then lets it go.
  feelHeart(hex, amt, until) {
    if (amt < Math.max(this.heartAmt, this.heartAmtGoal) * 0.8) return;
    // Always vivid (a pale accent would read as the blue-grey slime the heart must never be).
    _c.set(hex).getHSL(_h, THREE.SRGBColorSpace);
    if (_h.h >= 0.45 && _h.h < 0.52) _h.h = 0.52;   // (calm's teal, this vivid, would read green: cyan)
    _c.setHSL(_h.h, Math.max(0.85, _h.s), Math.max(0.45, Math.min(0.6, _h.l)), THREE.SRGBColorSpace);
    this.heartGoal.copy(_c);
    if (this.heartAmt < 0.05) this.heartCol.copy(_c);   // (lit: it turns there round the colour wheel, in frame)
    this.heartAmtGoal = Math.max(this.heartAmtGoal, Math.min(1, amt));   // it rises over a few frames, never in one
    this.heartUntil = Math.max(this.heartUntil, until);
  }
  // A line's feeling swells (charge adds up, to 0.55); a weaker other feeling only
  // feeds the current one, so the colour never flips back and forth.
  lineFeel(e, charge) {
    if (!e) return;
    if (e === this.feelE) this.feelGoal = Math.min(0.55, this.feelGoal + charge);
    else if (charge > this.feelAmt) { this.feelE = e; this.feelGoal = Math.min(0.55, charge); }
    else this.feelGoal = Math.min(0.55, this.feelGoal + charge * 0.5);
  }

  // The core's temperament: the part's feelings blended (the leading one counts
  // most: squared weights), a scream adding rage, a drop's loud stretch letting
  // every feeling speak at once; eased over about a bar so nothing pops. The
  // phases advance at the blended paces, so a change of pace never jumps the
  // surface. Dread sharpens the spikes, release lets them reach further.
  _temper(f, dt, cu) {
    let fs = this.facets;
    if (this.scream > 0.5) fs = [['anger', 0.6], ...fs.map(([e, w]) => [e, w * 0.4])];
    const rel = Math.max(f.reign >= 0 ? 1 : 0, 0.6 * this.afterglow);
    const n = fs.length;
    const ws = fs.map(([, w]) => { const x = w + (1 / n - w) * 0.45 * rel; return x * x; });
    const sw = ws.reduce((a, b) => a + b, 0) || 1;
    const goal = {};
    for (const k in TEMPER.calm) goal[k] = fs.reduce((s, [e], i) => s + ws[i] * (TEMPER[e] || TEMPER.calm)[k], 0) / sw;
    const ax = this.axes, voidA = ax.void || 0, release = ax.release || 0;
    goal.spike = Math.min(9, goal.spike + 3 * voidA);
    goal.gain = Math.min(1.6, goal.gain * (1 + 0.25 * release) * (1 + 0.3 * this.depth) * (1 - 0.5 * this.resolve));
    goal.ridge *= 1 + 0.3 * this.depth;
    goal.spin *= 1 - 0.6 * this.resolve;
    const k = Math.min(1, dt / Math.max(0.5, f.barLen || 2));
    const T = this.temper;
    if (f.jumped) Object.assign(T, goal); else for (const key in goal) T[key] += (goal[key] - T[key]) * k;
    const P = this.phase, still = 1 - 0.6 * this.sustain;
    P.boil += dt * T.boil * still; P.spike += dt * T.spikeRate; P.flow += dt * T.flow * (1 - 0.4 * voidA); P.tw += dt;
    cu.uBoilT.value = P.boil; cu.uSpikeT.value = P.spike; cu.uFlowT.value = P.flow; cu.uTwT.value = P.tw;
    cu.uSpike.value = T.spike; cu.uSpikeGain.value = T.gain; cu.uRidge.value = T.ridge; cu.uNodeCut.value = T.nodes;
    cu.uHeartSize.value = Math.max(42, T.heart);
    // The heartbeat: each feeling's shape, blended, on the bar.
    const bars = (f.barIdx || 0) + (f.barPhase || 0);
    const p = { phi: f.barPhase || 0, phi2: (((bars % 2) + 2) % 2) / 2, phi4: (((bars % 4) + 4) % 4) / 4, tm: this.time, partPos: this.partPos };
    // (each feeling's say in the heartbeat eases like the temperament, so a part
    // change never jumps the heart's level)
    const bw = this.breathW || (this.breathW = {});
    for (const e in bw) bw[e] *= 1 - k;
    fs.forEach(([e], i) => { bw[e] = (bw[e] || 0) + (ws[i] / sw) * k; });
    if (f.jumped) { for (const e in bw) delete bw[e]; fs.forEach(([e], i) => { bw[e] = ws[i] / sw; }); }
    let breath = 0, bsum = 0;
    for (const e in bw) { if (bw[e] < 1e-4) { delete bw[e]; continue; } breath += bw[e] * (BREATH[e] || BREATH.calm)(p); bsum += bw[e]; }
    cu.uBreath.value = bsum ? breath / bsum : 0.8;
    this.floor.uniforms.uHeart.value = cu.uBreath.value;   // the heartbeat glows on the ground
    this.floor.uniforms.uVoid.value += ((ax.void || 0) - this.floor.uniforms.uVoid.value) * k;
    // The backbeat's light carries the part's second feeling (a vivid version of its colour).
    const f2 = this.facets[1];
    const su2 = this.strings.uniforms;
    if (f2) {
      _c.set(PALETTES[f2[0]].ramp[3]).getHSL(_h, THREE.SRGBColorSpace);
      if (_h.h > 0.18 && _h.h < 0.45) _c.set(PALETTES[f2[0]].accent).getHSL(_h, THREE.SRGBColorSpace);   // never green: fear's mint becomes its red
      if (_h.h >= 0.45 && _h.h < 0.52) _h.h = 0.52;   // (and calm's teal its cyan)
      _c.setHSL(_h.h, Math.max(0.8, _h.s), Math.max(0.45, Math.min(0.6, _h.l)), THREE.SRGBColorSpace);
      if (su2.uPluckK.value < 0.01) su2.uPluckCol.value.copy(_c); else mixVivid(su2.uPluckCol.value, _c, k);
    }
    su2.uPluckK.value += ((f2 ? Math.max(0, Math.min(1, (f2[1] - 0.1) / 0.3)) * 0.7 : 0) - su2.uPluckK.value) * k;
    // The self dissolving: a line that sings it dims the heart and thins the lights;
    // a release (a drop, a scream) lights it back up fast.
    this.dissolve += (Math.min(0.75, this.dissolveGoal) - this.dissolve) * Math.min(1, dt * (this.dissolveGoal > this.dissolve ? 0.8 : 3));
    cu.uDissolve.value = this.dissolve;
    // The shell sits about 66 degrees round the wheel from the plasma: whichever way
    // keeps it out of green for this colour (eased, so a change of side sweeps rather
    // than jumps). The side is also judged by the hue twice as far round (where the
    // outer lattice used to sit): without that margin a violet song's shell turns
    // to 187 degrees, which the glow and the grade carry into teal.
    this.palCore.uRamp.value[3].getHSL(_h, THREE.SRGBColorSpace);
    const greenness = (x) => { x = ((x % 1) + 1) % 1; return smooth(0.17, 0.22, x) * smooth(0.48, 0.43, x); };
    const cost = (s) => greenness(_h.h - s * 0.183) + greenness(_h.h - s * 0.35);
    const turnGoal = cost(-1) < cost(1) - 0.05 ? -1 : 1;
    cu.uShellTurn.value += (turnGoal - cu.uShellTurn.value) * Math.min(1, dt * 1.2);
    // The part's arc (eased over a bar, and held lower when the music thins), a
    // chorus's depth (each return deeper), and the outro's rest (only once the
    // music lets go: never under a reign or a build).
    const A = ARC[this.part] || [0.2, 0.5], loud = 0.5 + 0.5 * Math.min(1, (f.energy || 0) / 0.6);
    const arcGoal = (A[0] + (A[1] - A[0]) * Math.pow(this.partPos, 1.4)) * loud;
    const kb = Math.min(1, dt / Math.max(0.5, f.barLen || 2));
    this.arc += (arcGoal - this.arc) * kb;
    this.depth += ((this.part === 'chorus' ? this.partDepth : 0) - this.depth) * kb;
    const rest = this.part === 'outro' && f.reign < 0 && f.build < 0.1 ? this.partPos * this.partPos * (3 - 2 * this.partPos) * (1 - 0.5 * (f.energy || 0)) : 0;
    this.resolve += (rest - this.resolve) * kb;
    cu.uArc.value = this.arc;
    this.sky.uniforms.uArc.value = this.arc;
  }

  // A ring carrying a feeling (its speed, life and a vivid, never-green colour).
  _ring(e) {
    const R = RINGS[e] || RINGS.calm, P = PALETTES[e] || PALETTES.calm;
    if (!this._ringCol) this._ringCol = {};
    const c = this._ringCol[e] || (this._ringCol[e] = new THREE.Color());
    c.set(P.ramp[3]).getHSL(_h, THREE.SRGBColorSpace);
    if (_h.h > 0.18 && _h.h < 0.45) c.set(P.accent).getHSL(_h, THREE.SRGBColorSpace);
    if (_h.h >= 0.45 && _h.h < 0.52) _h.h = 0.52;   // a teal this vivid reads as green: cyan
    c.setHSL(_h.h, Math.max(0.8, _h.s), Math.max(0.45, Math.min(0.6, _h.l)), THREE.SRGBColorSpace);
    return { speed: R.speed, life: R.life, color: c };
  }
  // The part's most charged feeling (a drop rings in it).
  _charged() {
    let best = this.facets[0][0];
    for (const [e] of this.facets) if ((RINGS[e] || RINGS.calm).charge > (RINGS[best] || RINGS.calm).charge) best = e;
    return best;
  }

  // A screamed line bursts a ring out of the core (at most one a second). Every
  // screamed word stabs the core's spikes out; the room itself (floor, strings, camera) keeps to the beat, its kicks and
  // backbeats hitting harder while the scream lasts (frame), so nothing lands
  // between beats and the grid never twitches.
  screamLine() {
    if (this.time - this.screamLineT < 1 || this.hold > 0) return;
    this.screamLineT = this.time;
    this.halo.pulse(this.time, 0.8, this._ring('anger'));
    this.dissolveGoal = 0;   // release: the self lights back up
  }
  screamWord() {
    if (this.hold > 0) return;   // the breath before a big drop stays still
    this.stabGoal = 1;   // the spikes stab out; the core's size stays on the music
  }

  // A sung weather word: 0 rain, 1 embers, 2 aurora, 3 haze. Fades over a few seconds.
  weather(kind, amount = 1) {
    if (this.scream > 0.5 && kind !== 1) return;   // a scream's sky only burns: no aurora or fog softening the rage
    const b = this.fxBoost, v = [b.x, b.y, b.z, b.w];
    v[kind] = Math.max(v[kind], amount);
    b.set(v[0], v[1], v[2], v[3]);
  }

  _updateSpectrum(spectrum, dt) {
    if (!this._bins) {
      const binHz = this.sampleRate / 2048;
      this._bins = [];
      for (let i = 0; i <= 64; i++) this._bins.push(Math.max(1, Math.round((40 * Math.pow(12000 / 40, i / 64)) / binHz)));
    }
    const L = this.specLevels;
    for (let i = 0; i < 64; i++) {
      let v = 0;
      if (spectrum) {
        const a = this._bins[i], b = Math.max(a + 1, this._bins[i + 1]);
        for (let k = a; k < b && k < spectrum.length; k++) v = Math.max(v, spectrum[k]);
        v = Math.pow(v / 255, 1.6);
      }
      L[i] = v > L[i] ? L[i] + (v - L[i]) * Math.min(1, dt * 30) : L[i] * Math.exp(-dt * 5);
    }
    // Where the spectrum's weight sits above the bass (0 low .. 1 high): the lead's register.
    let sw = 0, sv = 0;
    for (let i = 16; i < 64; i++) { sw += L[i] * i; sv += L[i]; }
    if (sv > 0.5) this.centroid = (sw / sv - 16) / 48;
  }

  // The song's colour themes: its own, then each feeling's opposite, then each one's
  // neighbour, and round again. A song's biggest moments move it on (at most every 25 s):
  // the same music, felt again in another light.
  _nextTheme(T, f) {
    if (!f.playing || T - (this.turnAt ?? -99) <= 25) return;
    this.turnAt = T;
    this.theme = ((this.theme || 0) + 1) % THEMES.length;
    const m = this.moodArgs; if (m) { this.moodKey = null; this.setMood(m[0], m[1], m[2], m[3], false, m[5]); }
  }

  // Cut (or glide, blend > 0) to a shot the song's part and its feelings like.
  _cut(blend = 0) {
    // Quiet intros and outros: the camera pulls far back and circles slowly.
    if (this.quiet) { this.director.cut('vast', Math.max(blend, 3)); this.barsSinceCut = 0; return; }
    const views = PART_VIEWS[this.part] || LEVEL_VIEWS[this.lv || 0];
    const pool = views.filter((v) => v !== this.director.shot);
    // The part's feelings weigh the choice: each likes its shots.
    const weight = (v) => 0.15 + this.facets.reduce((s, [e, w]) => s + (CAMERA[e] && CAMERA[e].views.includes(v) ? w : 0), 0);
    const total = pool.reduce((s, v) => s + weight(v), 0);
    let r = this.R() * total, pick = pool[pool.length - 1];
    for (const v of pool) { r -= weight(v); if (r <= 0) { pick = v; break; } }
    this.director.cut(pick, blend);
    this.barsSinceCut = 0;
  }

  frame(dt, f, spectrum) {
    this.time += dt;
    const T = this.time, lv = f.level, lvN = lv / 3;
    this.lv = lv;
    // A build that runs under a scream doesn't hold its breath: the screaming is the
    // climax already, so the colour isn't drained and the heavy guitars still hit.
    const bld = f.build * (1 - this.scream);
    // The breath before a big drop: through its last beat the camera freezes and the
    // light falls nearly to black, so the hit lands out of silence.
    const nd = f.nextDrop;
    this.hold = f.playing && nd && nd.big && f.toDrop < f.beatLen ? Math.min(1, 1 - f.toDrop / f.beatLen) : 0;
    // Quiet intros and outros: room to breathe and a sense of scale (the vast shot).
    const quiet = f.playing && lv === 0 && f.energy < 0.32 && f.reign < 0 && f.build < 0.1;
    if (quiet !== !!this.wasQuiet) { this.quiet = quiet; this.wasQuiet = quiet; this._cut(quiet ? 3 : 1.6); }
    this.quiet = quiet;
    // The ending: over the last seconds the plasma sinks into its black void, the room
    // darkens, and one last soft ring rolls out.
    const toEnd = f.toEnd ?? Infinity;
    const endGoal = f.playing ? Math.min(1, Math.max(0, (5 - toEnd) / 4.7)) : 0;
    this.ending = this.ending || 0;
    this.ending = endGoal >= this.ending ? endGoal : this.ending + (endGoal - this.ending) * Math.min(1, dt * 1.5);   // never snaps back to full light when the song stops
    if (f.playing && toEnd < 1.1 && toEnd > 0 && !this.endRing) { this.endRing = true; this.halo.pulse(T, 0.9, this._ring(this.moodBase)); this.floor.ripple(T, 1.0); }

    // ── Musical events ──────────────────────────────────────────────
    // Drops come in three sizes (analysis.js `size`): the bass coming back after a
    // fill is a push; a real drop flares the core and rings out; a big one (the
    // song's few biggest) reigns for its whole loud stretch.
    const d = f.dropHit ? f.drop : null, size = d && d.size != null ? d.size : 0.6;
    if (f.dropHit && !(d && d.big) && size < 0.35) {
      this.flash = Math.max(this.flash, 0.2); this.glitch = Math.max(this.glitch, 0.25);
      this.floor.ripple(T, 0.7 + 1.5 * size); this.strings.pluck(T, 0.7 + 1.5 * size);
      this.director.kick(0.35 + size);
      this._cut();
    } else if (f.dropHit) {
      const big = !!(d && d.big), ds = Math.max(0.6, f.dropStrength || 0.8) * (big ? 1.25 : 1);
      this.flash = 1; this.glitch = 1;
      if (this.show) this.show.dropT = T;
      this.explodeUntil = T + f.beatLen * (big ? 1.5 : 1.1);
      this.spread = 1;
      if (big) this.halo.pulse(T + 0.12, 1.4, this._ring(this._charged()));
      this._cut();
      // A big drop (at most one every 25 s) changes the song's colour theme: every
      // feeling takes its opposite's colours, and the next big drop brings the first back.
      // Same room, same music, a new way to feel it.
      if (big) this._nextTheme(T, f);
      this.director.kick(1.4);
      this.floor.ripple(T, 1.7);
      this.halo.pulse(T, 0.6, this._ring(this._charged()));   // only a drop sends a ring out, in the part's most charged feeling
      this.key.sweepT = T;                          // and the wall sweeps the whole spectrum once
      this.floor.ripple(T, 2.6 * ds); this.strings.pluck(T, 2.2 * ds); this.halo.pulse(T, 1.2 * ds * (1 + 0.5 * this.depth), this._ring(this._charged()));
      this.director.kick(1.2 * ds); this.flare = 1; this.afterglow = 1; this.dissolveGoal = 0;
    } else if (f.sectionHit) {
      this.flash = Math.max(this.flash, 0.3); this.glitch = Math.max(this.glitch, 0.6);
      this._cut();
    }
    // Waking: when a song begins, the room takes a breath. The core notices, the grid
    // lights up from the core outward, the bars light up round the ring.
    if (f.playing && !this.woke) { this.woke = true; this.wakeT = T; this.floor.ripple(T, 1.6); this.halo.pulse(T, 0.8, this._ring(this.moodBase)); }
    this.waking = this.woke ? Math.min(1, (T - this.wakeT) / 2.2) : 0;
    // Winding down: through a song's last seconds the camera drifts out wide, into the vast shot.
    if ((this.ending || 0) > 0.25 && this.director.shot !== 'vast' && !this.windCut) { this.windCut = true; this.director.cut('vast', 4); }
    if ((this.ending || 0) < 0.05) this.windCut = false;
    // A peak with no drop (a loud, full-level stretch of 8 bars or more: the song's joy)
    // earns a new theme too, the moment it begins.
    const sc = f.section;
    if (sc !== this._sec) {
      if (sc && !f.jumped && this._sec !== undefined && sc.level >= 3 && sc.energy >= 0.9 && sc.bars >= 8 && !sc.drop) {
        const was = this.theme; this._nextTheme(T, f);
        if (this.theme !== was) { this.flash = Math.max(this.flash, 0.7); this.floor.ripple(T, 1.8); this.halo.pulse(T, 1.0, this._ring(this._charged())); }
      }
      // Smaller moments (every song has them): a new section, or the music turning to
      // major or minor, sends a chase of light round the ring; in a song with few big
      // moments, a lift in level or a change of key also moves it to its next theme.
      else if (sc && !f.jumped && this._sec && f.playing) {
        const lift = sc.level > this._sec.level, turn = sc.mode && this._sec.mode && sc.mode !== this._sec.mode;
        if (this.show) { this.show.chaseT = T; this.show.chaseDual = !!turn; }
        if (this.starved && (lift || turn)) this._nextTheme(T, f);
        if (lift) this.floor.ripple(T, 0.9);
      }
      this._sec = sc;
    }
    // The voice coming in after a long rest: the room turns to it (a chase in the
    // second colour, a ripple, the core notices).
    if (this.lyricOn && !this.wasLyric && f.playing && T - this.lyricOffT > 6) {
      if (this.show) { this.show.chaseT = T; this.show.chaseDual = true; }
      this.floor.ripple(T, 0.7); this.core.notice();
    }
    if (!this.lyricOn && this.wasLyric) this.lyricOffT = T;
    this.wasLyric = this.lyricOn;
    // The music dropping out: the ring dims while it's near silent, and lights back as it returns.
    const hushGoal = f.playing && f.energy < 0.18 && !this.quiet ? 1 : 0;
    this.hushK += (hushGoal - this.hushK) * Math.min(1, dt * (hushGoal ? 1.5 : 4));
    // A scream: the song's rawest moment, rewarded like a big drop.
    this.songT = f.t;
    if (f.jumped) this.scream = this.screamGoal;   // a seek lands where it lands, no easing out of the old place
    this.scream += (this.screamGoal - this.scream) * Math.min(1, dt * (this.screamGoal > this.scream ? 5 : 1.2));
    // A big drop's loud stretch letting go: the room exhales, a ring rolls out.
    const reigning = f.reign >= 0;
    if (this.reigning && !reigning && !f.jumped) {
      this.halo.pulse(T, 0.5, this._ring(this.moodBase));
      this._cut(0.6);
    }
    this.reigning = reigning;
    if (f.barHit && !f.sectionHit) {
      this.barsSinceCut++;
      // Cuts land on the song's phrases (every 8, 4 or 2 bars counted from where the
      // section began), where the ear expects a change; quiet parts glide, loud ones cut.
      // The part and its feelings set the pace (snapped to a phrase length) and how
      // long a quiet part glides.
      let every = this.feature > 0.5 ? 2 : CUT_BARS[lv], glide = 2.4;
      if (this.part && this.feature <= 0.5) {
        const fsum = this.facets.reduce((s, [, w]) => s + w, 0) || 1;
        const mul = this.facets.reduce((s, [e, w]) => s + w * (CAMERA[e] || CAMERA.calm).cut, 0) / fsum;
        glide = this.facets.reduce((s, [e, w]) => s + w * (CAMERA[e] || CAMERA.calm).glide, 0) / fsum;
        const base = this.part === 'chorus' && this.partDepth >= 1 ? 2 : PART_CUT[this.part] || 8;
        every = [2, 4, 8, 16].reduce((a, b) => (Math.abs(b - base * mul) < Math.abs(a - base * mul) ? b : a));
      }
      const phraseBar = f.section ? f.barIdx - (f.section.bar0 || 0) : f.barIdx;
      if (this.barsSinceCut >= Math.min(2, every) && phraseBar > 0 && phraseBar % every === 0) {
        this._cut(lv <= 1 && this.feature < 0.5 ? glide : 0);
        if (lv >= 2) this.glitch = Math.max(this.glitch, 0.25 * lvN);
      }
    }
    // A build tightens: the floor ripples on every beat, harder and harder.
    if (f.build > 0.12 && f.beatHit && f.playing) this.floor.ripple(T, 0.25 + 1.3 * f.build);
    // A held note: when it lets go, the room exhales.
    if (this.sustain > 0.45 && this.sustainGoal === 0) { this.halo.pulse(T, 0.7, this._ring(this.feelE || this.moodBase)); this.sustain = 0.44; }   // the held note lets go in the sung feeling
    const kickHit = this.kickless ? f.beatHit : f.kickHit;
    if (kickHit && f.playing && this.show) { this.show.kickT = T; this.show.kickN = (this.show.kickN || 0) + 1; }
    if (f.beatHit && f.playing && this.show) { this.show.beatT = T; this.show.beatN = (this.show.beatN || 0) + 1; if (f.beatInBar === 0) this.show.barN = (this.show.barN || 0) + 1; }
    if (kickHit && f.playing) {
      const k = (0.55 + 0.45 * Math.min(1, f.low)) * (1 + 0.3 * this.scream);   // a scream hits harder, on the beat
      this.floor.ripple(T, (0.4 + 0.8 * lvN) * k);
      this.director.kick((0.12 + 0.4 * lvN) * k * (1 + 0.4 * this.depth));   // each chorus's return hits harder
    }
    // Each instrument has its own place in the room: the kick rolls the floor, the
    // snare and the claps pluck the strings, the bass breathes in the core, the
    // melody and the voice light the sky, and the wall shows the whole spectrum.
    if (f.beatHit && f.beatInBar % 2 === 1 && f.playing && this.show) this.show.snareT = T;
    if (f.beatHit && f.beatInBar % 2 === 1 && f.playing) this.strings.pluck(T, (0.35 + 0.8 * lvN) * Math.min(1.2, 0.4 + f.mid) * (1 + 0.3 * this.scream));   // the backbeat (2 and 4)

    // ── Continuous drive ────────────────────────────────────────────
    this.sustain += (this.sustainGoal - this.sustain) * Math.min(1, dt * (this.sustainGoal > this.sustain ? 1.2 : 4));
    this.feature += (this.featureGoal - this.feature) * Math.min(1, dt * 1.5);
    this.flare *= Math.exp(-dt * 2.2); this.afterglow *= Math.exp(-dt * 0.35);
    const sus = this.sustain;
    // Heavy bass (a dubstep or EDM drop's body): loud section, bass in charge. Every
    // wub (a sharp rise in the low end) hits the room: the strings and floor jump,
    // the camera jolts, and the beat strobes like a festival.
    const heavyGoal = f.playing && lv >= 2 && f.energy >= 0.6 && bld < 0.3 ? 1 : 0;
    this.heavy = (this.heavy || 0) + (heavyGoal - (this.heavy || 0)) * Math.min(1, dt * (heavyGoal ? 3 : 0.8));
    // A wub: the bass dips and comes back up by a clear margin (a wobble cycle).
    const hv = this.heavy;
    // (the lowest point since the last wub; forgotten after a quiet half-second)
    if (T - (this.wubT || 0) > 0.6) this.lowFloor = f.low;
    this.lowFloor = Math.min(f.low, this.lowFloor ?? f.low);
    const rise = f.low - this.lowFloor;
    // (The floor, the strings and the camera take a wub at most every 0.35 s, and never tear the picture: at up to
    // 11 a second they cut each other off and the grid twitched.)
    if (hv > 0.3 && rise > 0.1 && T - (this.wubT || 0) > 0.09) {
      this.wubT = T; this.lowFloor = f.low;
      if (this.show) { this.show.wubT = T; this.show.wubN++; }
      const w = hv * Math.min(1.5, rise * 3.5);
      if (T - (this.wubRoomT || 0) > 0.35) {
        this.wubRoomT = T;
        this.strings.pluck(T, 0.7 * w); this.floor.ripple(T, 0.4 * w); this.director.kick(0.15 * w);
      }
    }
    if (hv > 0.3 && f.beatHit) this.flash = Math.max(this.flash, 0.22 * hv);
    this._updateSpectrum(spectrum, dt);

    // The colour world glides toward the mood (quicker on a drop).
    // The colour key moves with the music: quick on a chord or section change, so
    // the colour lands with the downbeat rather than drifting after it.
    const K = this.key;
    K.shift += (K.goalShift - K.shift) * Math.min(1, dt * 3.2);
    K.sat += (K.goalSat - K.sat) * Math.min(1, dt * 2);
    // About one bar for the heart, two for the ground and the wall, four for the sky
    // (a drop or a seek: everything at once).
    if (this.flash > 0.5 || f.jumped) this._glide(f.jumped ? 1 : 1 - Math.exp(-dt * 6));
    else {
      const bar = Math.max(1, f.barLen || 2);
      this._glide(1 - Math.exp(-dt * 3 / bar), 1 - Math.exp(-dt * 1.5 / bar), 1 - Math.exp(-dt * 0.75 / bar));
    }
    // The wall's own colour motion: a slow swing that rides the bars (an 8-bar
    // cycle), and after a drop one full turn of the hue circle.
    const sweep = Math.min(1, Math.max(0, (T - K.sweepT) / 3.5));
    // In a solo the wall's colour follows the lead instrument: the brightness centre
    // of the spectrum (high notes turn it one way, low notes the other).
    this.pitchHue = (this.pitchHue || 0) + (((this.centroid ?? 0.5) - 0.45) * 220 - (this.pitchHue || 0)) * Math.min(1, dt * 4);
    const wallSwing = 22 * (1 - this.resolve) * Math.sin(((f.barIdx || 0) + (f.barPhase || 0)) * Math.PI / 4) + this.feature * this.pitchHue;
    // The core's own colour motion: it spins through the wheel in a build (faster as
    // it tightens) and at a peak, drifts slowly the rest of the time, and a drop's
    // sweep turns it once round with the wall.
    const sp = this.show ? this.show.peak : 0;
    this.coreTurn = ((this.coreTurn || 0) + dt * (220 * bld * bld + 70 * sp + 25 * (this.heavy || 0))) % 360;
    this._paint(wallSwing, sweep < 1 ? 360 * (1 - Math.pow(1 - sweep, 3)) : 0);
    this.swell *= Math.exp(-dt * 1.4);

    // Core.
    const cu = this.core.uniforms;
    // A scream: every word stabs the spikes out, and the skin crackles harder.
    // (each stab has a quick attack, never a one-frame step)
    this.stabGoal *= Math.exp(-dt * 6);
    this.stab += (this.stabGoal - this.stab) * Math.min(1, dt * 25);
    // The word in the heart fades once it's sung; the line's swell rises within a
    // beat and, once no note is held, ebbs over about two bars.
    if (f.jumped) this.heartUntil = -1;   // a seek: whatever word was holding the heart is gone
    if (f.t > this.heartUntil) this.heartAmtGoal *= Math.exp(-dt * 1.8);
    this.heartAmt += (this.heartAmtGoal - this.heartAmt) * Math.min(1, dt * 8);
    mixVivid(this.heartCol, this.heartGoal, Math.min(1, dt * 6));
    // The heart's colour is blended here, round the colour wheel from the core's own
    // accent to the word's (in the shader it was a straight mix: through white or grey).
    mixVivid(this.heartMix.copy(this.palCore.uAccent.value), this.heartCol, this.heartAmt);
    cu.uHeartTint.value.copy(this.heartMix);
    cu.uHeartAmt.value = Math.min(1, this.heartAmt * 4);
    if (f.jumped) { this.feelGoal = 0; this.feelAmt = 0; }
    if (this.sustain < 0.3) this.feelGoal *= Math.exp(-dt / Math.max(0.5, 2 * f.barLen));
    this.feelAmt += (this.feelGoal - this.feelAmt) * Math.min(1, this.feelGoal > this.feelAmt ? dt / Math.max(0.15, f.beatLen) : dt * 4);
    this.feelMatch = (this.feelMatch || 0) + ((this.feelE === this.moodBase ? 1 : 0) - (this.feelMatch || 0)) * Math.min(1, dt * 3);
    cu.uFeel.value = this.feelAmt * this.feelMatch;   // the part's own feeling, sung: the heart and currents burn brighter
    this._temper(f, dt, cu);
    cu.uTime.value = T; cu.uLow.value = Math.min(1.3, f.low * (1 + 0.6 * (this.heavy || 0))); cu.uKick.value = Math.min(1.2, Math.pow(Math.min(1, f.kick), this.temper.snap) + 0.5 * this.stab); cu.uMid.value = f.mid; cu.uHigh.value = f.high * (1 + 0.6 * this.scream);
    // The core holds the tension: it swells through a build and a held note and
    // flares when the drop hits.
    // Capped, so it never balloons into the lens (the camera keeps its distance too).
    const swell = Math.min(0.42, 0.16 * f.build + 0.2 * this.sustain + 0.32 * this.flare);
    // Its size is a feeling too: awe, calm, rage and defiance loom large, loneliness,
    // grief and fear shrink it; it grows as the part climbs and each chorus returns,
    // breathes with the bass, and sinks away at the song's end. Eased over seconds,
    // so it grows like a living thing, never pops.
    const SIZE = { anger: 1.15, defiance: 1.15, joy: 1.1, hope: 1.1, calm: 1.1, mystery: 1.05, love: 1.05, desire: 1.05, nostalgia: 0.95, fear: 0.85, sadness: 0.85, loneliness: 0.75 };
    const moodSize = this.facets.reduce((s, [e, w]) => s + (SIZE[e] || 1) * w, 0) / Math.max(1e-3, this.facets.reduce((s, [, w]) => s + w, 0));
    const sizeGoal = 1.45 * moodSize * (1 + 0.15 * (this.axes.vast || 0) - 0.12 * (this.axes.small || 0)) * (1 + 0.12 * this.arc + 0.1 * this.depth) * (1 - 0.35 * (this.ending || 0));
    this.size = (this.size || sizeGoal) + (sizeGoal - (this.size || sizeGoal)) * Math.min(1, dt * 0.6);
    const cs = this.size * (1 + 0.1 * f.kick + 0.04 * Math.min(1, f.low)) * (1 + swell);
    this.core.group.scale.setScalar(cs);
    // A held note stops time in the centre: the core all but stops turning and blooms.
    const still = 1 - 0.85 * this.sustain;
    this.core.shell.rotation.y += dt * (0.2 + f.energy) * still * this.temper.spin;
    this.core.shell.rotation.x += dt * 0.07 * still;
    // How awake the singularity is: a scream is full power; loud music and a drop's
    // flare wake it part way; at rest it is aware, not off. Eased: it wakes, never snaps.
    const powerGoal = Math.max(this.scream, 0.55 * f.energy * f.energy + 0.35 * this.flare);
    cu.uPower.value += (powerGoal - cu.uPower.value) * Math.min(1, dt * 2);
    // Its duality: every feeling's second colour, chosen to answer the first (rage's red
    // against an electric violet, grief's blue against a far gold, ...). Never green.
    const DUALS = { anger: '#6a3dff', defiance: '#2a7bff', desire: '#5b3dff', love: '#8f5cff', sadness: '#ff4fa0', loneliness: '#ff4f9a',
      fear: '#ff2050', joy: '#00d4ff', hope: '#ff5fa2', nostalgia: '#7fc8ff', calm: '#a06bff', mystery: '#ff3ca8',
      powerpoint: '#3b5bff', kawaii: '#7fd8ff', neon: '#ff2a6d' };
    _dual.set(DUALS[this.moodBase] || '#a06bff');
    cu.uDual.value.lerp(_dual, Math.min(1, dt * 1.5));
    const pair = CORE_PAIRS[this.moodBase] || CORE_PAIRS.mystery, ck = Math.min(1, dt * 1.2);
    const tw = this.songShift || 0, rimT = keyed(_c2.set(pair[0]), _c2, tw, 1), bodyT = keyed(_c3.set(pair[1]), _c3, tw, 1);   // the song's own twist, through the colour key (never orange, gold or green)
    mixVivid(cu.uRimCol.value, rimT, ck); mixVivid(cu.uBodyCol.value, bodyT, ck);
    this.core.update(dt, this.scream, f.kick || 0);

    this.sky.uniforms.uTime.value = T;
    this.sky.uniforms.uEnergy.value = f.energy;
    this.sky.uniforms.uLow.value = Math.min(1.2, Math.max(f.low, this.voice * 0.8));
    this.sky.uniforms.uMid.value = Math.min(1.3, f.mid * (0.7 + 0.6 * this.feature));   // the melody and the voice light the sky
    this.sky.uniforms.uFlash.value = this.flash;
    this.sky.uniforms.uKick.value = f.kick;
    // Weather breathes with the music: embers flare with intensity, the rest holds the mood.
    const fx = this.cur.fx, fb = this.fxBoost;
    this.sky.uniforms.uStarCut.value = this.cur.starCut;
    this.emberT = (this.emberT || 0) + dt * (1.2 + 0.8 * f.energy);
    this.sky.uniforms.uEmberT.value = this.emberT;
    this.post.lens.uVigK.value = this.cur.vigK;
    fb.multiplyScalar(Math.exp(-dt * 0.3));
    this.sky.uniforms.uFx.value.set(Math.max(fx.x, fb.x), Math.max(fx.y * (0.35 + 0.9 * f.energy) * (1 + 0.5 * this.depth), fb.y),
      Math.max(fx.z * (0.6 + 0.5 * f.energy), fb.z), Math.max(fx.w, fb.w * 0.8));
    this.floor.uniforms.uTime.value = T;
    this.floor.uniforms.uEnergy.value = f.energy;
    this.floor.uniforms.uLow.value = Math.min(1.2, f.low);
    // The core lights the room: its colour, and how bright it burns (its size, the bass,
    // the kick, a drop's flare) pool on the floor and shine back from it.
    const fu = this.floor.uniforms;
    fu.uCoreCol.value.copy(this.core.uniforms.uBodyCol.value);   // the core's light on the floor is its own body colour
    // Only at the peaks (a scream, a big drop's flare and the loud stretch it rules): the
    // rest of the time the void stays black. It rises with the intensity, never snaps.
    const peak = Math.max(this.scream, this.flare, this.reigning ? 0.7 : 0);
    const auraGoal = cs * Math.pow(Math.max(0, (peak - 0.45) / 0.55), 1.5) * (0.8 + 0.4 * f.kick) * (1 - (this.ending || 0));
    fu.uCoreLight.value += (auraGoal - fu.uCoreLight.value) * Math.min(1, dt * 2.5);
    fu.uWallCol.value.copy(this.wallRamps[1][3]);
    fu.uGridFlash.value = Math.max(this.flare * this.flare, this.woke && this.waking < 1 ? 0.8 * Math.sin(Math.PI * this.waking) : 0);   // (the wake lights the whole grid for a breath)
    // Rain that lands: as hard as the song's own rain, and a soft drizzle while nothing
    // plays, so the void is never dead. Drops fall around the camera's side of the room.
    // (the resting drizzle eases off as a song wakes the room and back in as it winds down)
    const restGoal = !f.playing || (this.ending || 0) > 0.3 ? 0.45 : 0;
    this.restRain = (this.restRain ?? restGoal) + (restGoal - (this.restRain ?? restGoal)) * Math.min(1, dt * 0.5);
    const rain = Math.max(this.sky.uniforms.uFx.value.x, this.restRain);
    this.dropOwed = (this.dropOwed || 0) + dt * rain * 30;
    const D = fu.uDrops.value;
    while (this.dropOwed >= 1) {
      this.dropOwed -= 1;
      // Outside the ring of bars only, all the way round: the weather is the world
      // beyond the room, never on the stage where the core lives.
      const sa = this.R() * Math.PI * 2, sr = 27 + this.R() * 30;
      D[this.dropI = ((this.dropI || 0) + 1) % D.length].set(Math.cos(sa) * sr, Math.sin(sa) * sr, T + this.rain.FALL, 0.5 + this.R() * 0.6);   // it lands once it has fallen
    }
    this.rain.update(T, D, this.palFloor.uAccent.value);
    // Lightning: in a storm (real rain) a drop or a scream cracks the sky, and now and
    // then it strikes on its own. A cold double flicker lights the whole grid.
    if (rain > 0.25 && f.playing && (f.dropHit || (this.scream > 0.6 && f.kickHit && this.R() < 0.15) || this.R() < dt / 14)) { this.boltT = T; this.sky.uniforms.uBoltI.value = Math.floor(this.R() * 4) % 4; const ba0 = this.R() * Math.PI * 2; this.sky.uniforms.uBoltDir.value.set(Math.cos(ba0), Math.sin(ba0)); }
    const ba = T - (this.boltT ?? -99);
    const bolt = ba < 0 ? 0 : Math.exp(-ba * 16) + (ba > 0.14 ? 0.75 * Math.exp(-(ba - 0.14) * 11) : 0);
    this.bolt = bolt;
    if (bolt > 0.01) fu.uGridFlash.value = Math.max(fu.uGridFlash.value, 0.25 * bolt);
    // The wall steps back a little while a lyric line is up, so the words never fight the bars.
    this.wallDim += ((this.lyricOn ? 0.6 : 1 + 0.3 * this.feature) - this.wallDim) * Math.min(1, dt * 4);
    const S = this.show || (this.show = { dual: new THREE.Color(), chaseT: -99, chaseDual: false, snareT: -99, kickT: -99, wubT: -99, wubN: 0, dropT: -99, peak: 0 });
    // The bars' presence: how far into the song's intensity we are (its level, its energy, a
    // build, a drop's reign, a scream). Calm parts keep them low and dim; the end game, full.
    const presGoal = !f.playing ? 0.5 : Math.min(1, Math.max(lv / 3 * 0.85, f.energy * 0.9, bld, this.reigning ? 1 : 0, this.scream, this.flare));
    this.barPres = (this.barPres ?? presGoal) + (presGoal - (this.barPres ?? presGoal)) * Math.min(1, dt * (presGoal > (this.barPres ?? 0) ? 2.5 : 0.6));
    S.presence = this.barPres;
    S.t = T; S.build = bld; S.hush = this.hushK || 0; S.waking = this.woke ? this.waking : 1; S.hold = this.hold || 0; S.scream = this.scream; S.heavy = this.heavy || 0; S.ending = this.ending || 0;
    S.rim = this.core.uniforms.uRimCol.value; S.body = this.core.uniforms.uBodyCol.value;
    S.cam = Math.atan2(this.camera.position.z, this.camera.position.x);
    S.dual.copy(this.core.uniforms.uDual.value).getHSL(_h, THREE.SRGBColorSpace);
    if (_h.h > 0.06 && _h.h < 0.2) S.dual.setHSL(0.93, 1, 0.6, THREE.SRGBColorSpace);   // never gold in the light show: a hot pink instead
    const sc2 = f.section, peakGoal = f.playing && sc2 && sc2.level >= 3 && sc2.energy >= 0.9 && sc2.bars >= 8 && !sc2.drop ? 1 : 0;
    S.peak += (peakGoal - S.peak) * Math.min(1, dt * 1.5);
    this.ring.update(spectrum || this._silence, dt, this.wallRamps, this.pal.uAccent.value, this.flash, this.wallDim, S);

    // Camera.
    // What the camera must keep its distance from: the core with its spikes.
    const coreR = Math.max(2.05 * cs * (1 + 0.45 * this.sustain), 1.55 * cs * 1.35);
    if (this.hold > 0) { this.director.shake *= 1 - this.hold; this.director.punch *= 1 - this.hold; }
    // The camera's pace: the part's times the feelings', eased over a bar.
    let paceGoal = 1;
    if (this.part) {
      const fsum = this.facets.reduce((s, [, w]) => s + w, 0) || 1;
      const feelPace = this.facets.reduce((s, [e, w]) => s + w * (CAMERA[e] || CAMERA.calm).pace, 0) / fsum;
      paceGoal = Math.max(0.4, Math.min(1.5, (PART_PACE[this.part] || 1) * (this.part === 'chorus' ? 1 + 0.3 * this.depth : 1) * feelPace));
    }
    this.camPace = (this.camPace ?? 1) + (paceGoal - (this.camPace ?? 1)) * Math.min(1, dt / Math.max(0.5, f.barLen || 2));
    this.director.update(dt * (1 - 0.95 * (this.hold || 0)), { build: f.build, level: lv, time: T, coreR, pace: this.camPace });
    this.halo.update(T, this.camera, 2.4 * cs);   // rings are born just past the spike tips
    this.sky.mesh.position.copy(this.camera.position);
    const sgu = this.strings.uniforms; sgu.uTime.value = T; sgu.uEnergy.value = f.energy; sgu.uLow.value += (Math.min(1.2, f.low) - sgu.uLow.value) * Math.min(1, dt * 2);   // smoothed: the sway never jitters

    // Post.
    const L = this.post.lens;
    this.post.bloom.strength = (0.5 + 0.25 * f.energy + 0.35 * f.kick * lvN + 0.35 * this.flash + 0.25 * f.build + 0.35 * this.sustain) * (1 - 0.5 * this.spread);
    L.uTime.value = T;
    // Colour fringing kept to a whisper: it softens every edge (it was what made frames look low-res).
    L.uCA.value = 0.0003 + 0.0018 * f.kick * (0.3 + lvN) + 0.0012 * (this.heavy || 0) * Math.min(1.2, f.low) + 0.005 * this.glitch + 0.0015 * f.build;
    L.uFlash.value = 0.22 * this.flash * this.flash * this.flash;
    L.uFlashCol.value.copy(this.cur.flash);
    this.sky.uniforms.uBolt.value = this.bolt || 0;
    if ((this.bolt || 0) > 0.01) this.sky.uniforms.uFlash.value = Math.max(this.sky.uniforms.uFlash.value, this.bolt);   // lightning stays in the far sky: it never flashes the stage

    // The picture only tears on a real hit (a drop); cuts, bars and wubs never do: a
    // small tear just reads as the floor twitching.
    L.uGlitch.value = Math.max(0, this.glitch - 0.5) * 2;
    // The grade: the mood's split-tone, with saturation and contrast riding the
    // energy. Builds drain the colour (held breath); drops flood it back.
    const u = this.cur, a = f.energy;
    L.uShadow.value.copy(u.shadow);
    L.uHighlight.value.copy(u.highlight);

    L.uSplit.value = u.split * 0.55;                       // the grade leans toward the mood; it doesn't repaint every layer
    L.uSat.value = u.sat * (1.12 + 0.3 * a + 0.25 * this.swell + 0.25 * this.sustain + 0.2 * this.afterglow) * (1 - 0.35 * bld) * (1 - 0.15 * this.resolve) + 0.3 * this.flash;
    L.uVibrance.value = 0.8 + 0.3 * a;                     // shy colours lifted hard: everything reads in colour
    L.uContrast.value = 1.32 + 0.2 * a + 0.15 * f.build;   // deep darks, bright lights: the frame pops
    L.uLift.value = 0;                                     // true blacks
    L.uGrain.value = 0.003 + 0.006 * u.fx.w;               // barely any grain: no dust over the picture
    this.post.setHalo(u.halo, 0.3 + 0.15 * a);
    // Exposure is part of the mood: quiet feelings are lit low; energy lifts them a little.
    // The breath before the drop: in its last beat the room dims, so the hit lands in light.
    const breath = this.hold > 0 ? 1 - 0.75 * this.hold : f.toDrop < f.beatLen ? 1 - 0.32 * (f.buildWeight ?? 1) * (1 - f.toDrop / f.beatLen) : 1;
    this.renderer.toneMappingExposure = 1.05 * u.light * (0.9 + 0.2 * a) * breath * (1 + 0.1 * this.feature + 0.1 * this.sustain) * (1 - Math.max(0.6 * this.ending, 0.2 * this.resolve)) * (1 + 0.05 * this.depth);
    this.post.bloom.strength *= 0.55 + 0.45 * u.light;
    this.flash *= Math.exp(-dt * 6.5);
    this.glitch *= Math.exp(-dt * 7);
    if (T >= this.explodeUntil) this.spread *= Math.exp(-dt * 1.6);
    this.core.uniforms.uEnd.value = this.ending;
    this.post.render();
  }
}
