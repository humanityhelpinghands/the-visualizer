// Emotion: what the song feels like, from its harmony (major/minor), its energy,
// and what the words say. Every emotion owns a colour world built like a film
// grade (shadow → highlight ramp, an accent, split-tone tints, halation), a
// typeface and a way of moving.

// ── Colour worlds ─────────────────────────────────────────────────────
// ramp: five tones from the deepest shadow to the brightest highlight.
// accent: the glint that cuts across it. shadow/highlight: split-tone tints for
// the final grade. halo: the colour light bleeds into around bright things.
// fx: weather in the sky, [rain, embers, aurora, haze].
// light: exposure. Grief is lit low, euphoria high, like a cinematographer would.
// layers: the harmony. The sky, the floor, the core and the wall
// (bass, mids, highs) each turn the feeling's ramp to their own hue, so a red song
// is red at heart without the whole room going one colour.
export const PALETTES = {
  love: {
    label: 'love', light: 0.9, fx: [0, 0.15, 0.25, 0.7], ramp: ['#14040b', '#4a0e26', '#b8335c', '#f08a7e', '#ffe2cc'], accent: '#ffb347',
    shadow: '#2a0716', highlight: '#ffd6b3', halo: '#ff7a6b', sat: 1.0, split: 0.7, type: 'serif', motion: 'float',
    layers: { sky: '#6a2c9c', floor: '#ffb347', core: '#ffd27a', wall: ['#ff5e7e', '#c45cff', '#ffb347'] },
  },
  desire: {
    label: 'desire', light: 0.82, fx: [0, 0.6, 0, 0.35], ramp: ['#0d0006', '#5c0020', '#c4002f', '#ff2e63', '#ffc2d4'], accent: '#ff1fb4',
    shadow: '#1f0012', highlight: '#ff9fbf', halo: '#ff1744', sat: 1.1, split: 0.8, type: 'serif', motion: 'heat',
    layers: { sky: '#3d1a9c', floor: '#00b3c6', core: '#ffcf70', wall: ['#ff2e63', '#a12bff', '#00c2d1'] },
  },
  anger: {
    label: 'anger', light: 1.1, fx: [0, 1, 0, 0.15], ramp: ['#0b0303', '#3f0b07', '#b5170b', '#ff4f14', '#ffd47a'], accent: '#ff9100',
    shadow: '#160404', highlight: '#ffcf85', halo: '#ff3d00', sat: 1.25, split: 0.75, type: 'condensed', motion: 'snap',
    layers: { sky: '#4a1a6c', floor: '#ffd000', core: '#fff1a8', wall: ['#ff2a00', '#ff9100', '#ffe14d'] },
  },
  sadness: {
    label: 'sadness', light: 0.6, fx: [1, 0, 0, 0.25], ramp: ['#03060f', '#0f1f40', '#2e4b7d', '#7193bd', '#d3e0ef'], accent: '#9ec5ff',
    shadow: '#06102a', highlight: '#dce8f5', halo: '#5c8ccf', sat: 0.72, split: 0.65, type: 'light', motion: 'drift',
    layers: { sky: '#3b2f8a', floor: '#3fb3b5', core: '#d6ccff', wall: ['#3d6bff', '#4fd1c5', '#b49cff'] },
  },
  loneliness: {
    label: 'loneliness', light: 0.68, fx: [0.45, 0, 0, 0.8], ramp: ['#020309', '#0b1033', '#272b6e', '#5d4c8f', '#ffcf8c'], accent: '#ffa645',
    shadow: '#070a1f', highlight: '#ffd29a', halo: '#ff9d3b', sat: 0.85, split: 0.8, type: 'light', motion: 'drift',
    layers: { sky: '#0d2a6c', floor: '#8a5cff', core: '#ffa645', wall: ['#3a3fd6', '#8a5cff', '#ffa645'] },
  },
  fear: {
    label: 'fear', light: 0.72, fx: [0.35, 0, 0.1, 0.3], ramp: ['#020605', '#082a1f', '#1e6d50', '#78ffb0', '#e8fff2'], accent: '#ff2050',
    shadow: '#03140e', highlight: '#c8ffe0', halo: '#3dffa2', sat: 0.9, split: 0.7, type: 'mono', motion: 'jitter',
    layers: { sky: '#16305a', floor: '#33ffd1', core: '#ff2050', wall: ['#2dff8e', '#2dd4ff', '#ff2050'] },
  },
  joy: {
    label: 'joy', light: 1.1, fx: [0, 0.25, 0.65, 0.1], ramp: ['#0b0614', '#3d1180', '#ff3d8f', '#ffb700', '#fff5c4'], accent: '#00e1ff',
    shadow: '#1a0b33', highlight: '#fff1b0', halo: '#ffb000', sat: 1.2, split: 0.5, type: 'wide', motion: 'bounce',
    layers: { sky: '#5a1fd1', floor: '#00e1ff', core: '#ffd000', wall: ['#ff3d8f', '#ffb700', '#00e1ff'] },
  },
  hope: {
    label: 'hope', light: 1.0, fx: [0, 0, 1, 0.3], ramp: ['#070a20', '#2c2b6e', '#b45d7e', '#ffa060', '#ffecb8'], accent: '#7fd8ff',
    shadow: '#10123a', highlight: '#ffe6b0', halo: '#ff9a52', sat: 1.0, split: 0.6, type: 'wide', motion: 'rise',
    layers: { sky: '#2c3fae', floor: '#7fd8ff', core: '#fff0b0', wall: ['#b45dff', '#ffa060', '#7fd8ff'] },
  },
  nostalgia: {
    // (a faded rose-and-gold photograph, not sepia: sepia's browns read as mud)
    label: 'nostalgia', light: 0.85, fx: [0, 0.1, 0, 1], ramp: ['#0c0610', '#3a1838', '#8a4a78', '#e48fb0', '#ffe3ef'], accent: '#ffc27a',
    shadow: '#1e0c1c', highlight: '#ffe0ea', halo: '#ff8fb8', sat: 0.8, split: 0.85, type: 'serif', motion: 'float',
    layers: { sky: '#3a1a6a', floor: '#e48fb0', core: '#ffd1a0', wall: ['#b05a9a', '#ffc27a', '#7a6ad8'] },
  },
  defiance: {
    label: 'defiance', light: 1.05, fx: [0, 0.55, 0.3, 0], ramp: ['#05030c', '#2b0a52', '#6b20d4', '#ffcc00', '#fff8de'], accent: '#ff2a2a',
    shadow: '#12062b', highlight: '#ffeaa0', halo: '#b04dff', sat: 1.15, split: 0.6, type: 'condensed', motion: 'snap',
    layers: { sky: '#1a0a6a', floor: '#ff2a2a', core: '#ffcc00', wall: ['#6b20d4', '#ff2a2a', '#ffcc00'] },
  },
  calm: {
    label: 'calm', light: 0.75, fx: [0, 0, 0.55, 0.35], ramp: ['#020a0c', '#06313b', '#1f7b7b', '#80d7c7', '#e6fffa'], accent: '#ffd6a5',
    shadow: '#04191d', highlight: '#dffaf2', halo: '#5ce1c8', sat: 0.8, split: 0.55, type: 'light', motion: 'breathe',
    layers: { sky: '#163a8a', floor: '#7fe0ff', core: '#ffd6a5', wall: ['#1fb5a5', '#4f8cff', '#ffd6a5'] },
  },
  mystery: {
    label: 'mystery', light: 0.85, fx: [0, 0, 0.85, 0.2], ramp: ['#05020c', '#1d0b3b', '#5c2bb6', '#2bd9ff', '#f3e6ff'], accent: '#ff6bd6',
    shadow: '#0f0626', highlight: '#e3d4ff', halo: '#7b5cff', sat: 1.05, split: 0.7, type: 'mono', motion: 'shimmer',
    layers: { sky: '#3a0f7e', floor: '#2bd9ff', core: '#ff6bd6', wall: ['#5c2bb6', '#2bd9ff', '#ff6bd6'] },
  },
};
// Deep highlights, never white. The brightest tone of the happy and calm worlds was
// nearly white (pale cream, pale mint), and bright pale colours are exactly what
// blooms into haze and makes the frame look soft. Every world's top tone is pulled
// toward its own colour, more the paler it is, so highlights stay vivid hues on dark,
// like the purple/red worlds that read crisp.
{
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const out = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  for (const P of Object.values(PALETTES)) {
    const top = hex(P.ramp[4]), mid = hex(P.ramp[3]);
    const pale = Math.min(...top) / 255;                         // how close to white the top tone is
    const k = Math.max(0, Math.min(0.6, (pale - 0.55) * 1.6));
    P.ramp[4] = out(top.map((v, i) => v + (mid[i] - v) * k));
    const hl = hex(P.highlight), hp = Math.min(...hl) / 255;
    P.highlight = out(hl.map((v, i) => v + (mid[i] - v) * Math.max(0, Math.min(0.5, (hp - 0.55) * 1.4))));
  }
}
// The house style: dark and moody. Every world sinks into the same deep violet-black
// (its two darkest tones and its shadow tint lean that way), is lit lower, and keeps
// its own colour in the mid-tones and its accent as the pop against the dark. Bright
// moods stay themselves, just at night.
{
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const out = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (h, g, k, dim = 1) => out(hex(h).map((v, i) => (v + (hex(g)[i] - v) * k) * dim));
  for (const P of Object.values(PALETTES)) {
    P.ramp[0] = mix(P.ramp[0], '#07020d', 0.45, 0.85);
    P.ramp[1] = mix(P.ramp[1], '#24072f', 0.3, 0.85);
    P.shadow = mix(P.shadow, '#1a0526', 0.45);
    P.light = 0.62 + 0.26 * Math.max(0, Math.min(1, (P.light - 0.6) / 0.5));   // 0.6..1.1 -> 0.62..0.88
    P.fx = [P.fx[0], P.fx[1], P.fx[2] * 0.35, P.fx[3] * 0.6];                  // the sky's aurora and haze stay low: a night sky, not a light show
  }
}
export const EMOTIONS = Object.keys(PALETTES);

// Signature looks: colour worlds that aren't feelings but are a joy to see, worn over
// a song's choruses and bridges (main.js applyMood) while its own feeling drives the
// core, the camera and the words. Added after EMOTIONS, so they're never read as one.
export const LOOKS = {
  // OG PowerPoint: the deep purple to hot red gradient.
  powerpoint: {
    label: 'powerpoint', light: 1.0, fx: [0, 0.3, 0.3, 0.2], ramp: ['#0a0414', '#3b0f6e', '#8a1fb8', '#e8264f', '#ffc2d0'], accent: '#ff3b6b',
    shadow: '#1a0630', highlight: '#ffd0dc', halo: '#b02cff', sat: 1.1, split: 0.6, type: 'wide', motion: 'float',
    layers: { sky: '#4a1290', floor: '#e8264f', core: '#ff6b9a', wall: ['#8a1fb8', '#e8264f', '#ff8fb8'] },
  },
  // Kawaii: pink, soft white and lavender on the dark.
  kawaii: {
    label: 'kawaii', light: 1.0, fx: [0, 0, 0.6, 0.3], ramp: ['#120814', '#4a1e4e', '#d466b0', '#ffa8d8', '#fff0fa'], accent: '#b9a3ff',
    shadow: '#24102a', highlight: '#ffe6f6', halo: '#ff9ad5', sat: 0.95, split: 0.6, type: 'wide', motion: 'bounce',
    layers: { sky: '#5a2a8a', floor: '#ffa8d8', core: '#ffd6f0', wall: ['#ff8fd0', '#b9a3ff', '#8fd8ff'] },
  },
  // Neon night: red, blue and purple on black.
  neon: {
    label: 'neon', light: 1.05, fx: [0, 0.5, 0.2, 0.1], ramp: ['#020208', '#16063a', '#2440ff', '#ff1f4f', '#d8a0ff'], accent: '#a020ff',
    shadow: '#06041a', highlight: '#e0c8ff', halo: '#ff1f4f', sat: 1.2, split: 0.65, type: 'condensed', motion: 'snap',
    layers: { sky: '#120a5a', floor: '#2440ff', core: '#ff1f4f', wall: ['#2440ff', '#a020ff', '#ff1f4f'] },
  },
};
Object.assign(PALETTES, LOOKS);
// Which look a song wears (most songs get one; a few stay purely their feelings).
export function songLook(name) {
  let h = 0;
  for (const c of name || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const keys = Object.keys(LOOKS);
  return h % 4 === 3 ? null : keys[h % keys.length];
}
// Which way each feeling leans (+ bright, - dark, 0 neither): a part's highlights
// take the heaviest feeling that leans against its main one (bittersweet).
export const VALENCE = { love: 1, desire: 1, anger: -1, sadness: -1, loneliness: -1, fear: -1, joy: 1, hope: 1, nostalgia: 0, defiance: 1, calm: 1, mystery: 0 };
// Each feeling's temperament in the core (blended by the part's mix):
// heart: how tight the blazing point is (loneliness a pinpoint, grief wide and soft);
// spike: the spikes' sharpness (anger stabs, calm swells); gain: how far they reach;
// snap: how hard the kick hits (anger snaps, grief barely moves); spikeRate, boil,
// flow: how fast the spikes travel, the plasma boils and the currents run;
// ridge: the crackle of the skin; nodes: how few of the shell's lights twinkle;
// spin: how fast the shell turns.
export const TEMPER = {
  love: { heart: 44, spike: 3.5, gain: 0.75, snap: 0.85, spikeRate: 0.8, boil: 0.8, flow: 0.2, ridge: 0.6, nodes: 0.5, spin: 0.85 },
  desire: { heart: 46, spike: 3, gain: 0.9, snap: 0.75, spikeRate: 1.0, boil: 1.3, flow: 0.32, ridge: 1.1, nodes: 0.5, spin: 1.2 },
  anger: { heart: 55, spike: 7.5, gain: 1.3, snap: 1.6, spikeRate: 1.4, boil: 1.4, flow: 0.38, ridge: 1.3, nodes: 0.55, spin: 1.3 },
  sadness: { heart: 72, spike: 2.6, gain: 0.5, snap: 0.6, spikeRate: 0.5, boil: 0.6, flow: 0.14, ridge: 0.5, nodes: 0.7, spin: 0.6 },
  loneliness: { heart: 110, spike: 5, gain: 0.55, snap: 0.55, spikeRate: 0.35, boil: 0.4, flow: 0.08, ridge: 0.4, nodes: 0.85, spin: 0.4 },
  fear: { heart: 85, spike: 6.5, gain: 0.9, snap: 1.4, spikeRate: 1.6, boil: 1.2, flow: 0.3, ridge: 1.5, nodes: 0.5, spin: 1.15 },
  joy: { heart: 50, spike: 4, gain: 1.0, snap: 1.0, spikeRate: 1.2, boil: 1.1, flow: 0.28, ridge: 1.0, nodes: 0.35, spin: 1.15 },
  hope: { heart: 55, spike: 4, gain: 0.85, snap: 1.0, spikeRate: 0.9, boil: 0.9, flow: 0.2, ridge: 0.8, nodes: 0.5, spin: 0.95 },
  nostalgia: { heart: 60, spike: 3, gain: 0.6, snap: 0.7, spikeRate: 0.6, boil: 0.6, flow: 0.15, ridge: 0.5, nodes: 0.65, spin: 0.7 },
  defiance: { heart: 46, spike: 6, gain: 1.1, snap: 1.3, spikeRate: 0.3, boil: 0.9, flow: 0.18, ridge: 0.9, nodes: 0.4, spin: 1.0 },
  calm: { heart: 60, spike: 2.4, gain: 0.45, snap: 0.6, spikeRate: 0.4, boil: 0.5, flow: 0.12, ridge: 0.35, nodes: 0.6, spin: 0.55 },
  mystery: { heart: 70, spike: 5, gain: 0.8, snap: 0.9, spikeRate: 0.9, boil: 1.0, flow: 0.25, ridge: 1.2, nodes: 0.45, spin: 1.0 },
};
// The rings a feeling sends out of the core: how fast they travel and how long
// they live (grief slow and far, rage fast and tight), and how charged the feeling
// is (a drop rings in the part's most charged one).
export const RINGS = {
  love: { speed: 1.0, life: 1.6, charge: 5 }, desire: { speed: 1.0, life: 1.6, charge: 8 },
  anger: { speed: 1.5, life: 1.1, charge: 12 }, sadness: { speed: 0.6, life: 2.6, charge: 2 },
  loneliness: { speed: 0.8, life: 3.0, charge: 1 }, fear: { speed: 1.2, life: 1.3, charge: 10 },
  joy: { speed: 1.2, life: 1.5, charge: 7 }, hope: { speed: 0.9, life: 2.0, charge: 6 },
  nostalgia: { speed: 0.75, life: 2.2, charge: 3 }, defiance: { speed: 1.3, life: 1.4, charge: 11 },
  calm: { speed: 0.7, life: 2.4, charge: 0 }, mystery: { speed: 0.9, life: 2.0, charge: 4 },
};

// Each feeling's camera: the shots it likes, how much
// longer or shorter it holds a shot (cut: x the part's pace), how many seconds
// a quiet part takes to glide between shots, and how fast the shots move (pace).
export const CAMERA = {
  love: { views: ['close', 'orbit', 'dolly'], cut: 1.5, glide: 3, pace: 0.8 },
  desire: { views: ['close', 'orbit', 'fly'], cut: 1, glide: 2, pace: 1 },
  anger: { views: ['close', 'fly', 'crane'], cut: 0.5, glide: 0, pace: 1.4 },
  sadness: { views: ['crane', 'vast', 'top'], cut: 2, glide: 4, pace: 0.6 },
  loneliness: { views: ['vast', 'orbit', 'top'], cut: 2, glide: 4, pace: 0.5 },
  fear: { views: ['dolly', 'close'], cut: 1, glide: 1.6, pace: 0.7 },
  joy: { views: ['fly', 'orbit', 'crane'], cut: 0.75, glide: 1.2, pace: 1.2 },
  hope: { views: ['crane', 'orbit'], cut: 1, glide: 2.4, pace: 0.9 },
  nostalgia: { views: ['dolly', 'orbit', 'vast'], cut: 1.5, glide: 3, pace: 0.7 },
  defiance: { views: ['orbit', 'crane'], cut: 0.75, glide: 0.8, pace: 1 },
  calm: { views: ['orbit', 'vast', 'top'], cut: 2, glide: 4, pace: 0.6 },
  mystery: { views: ['fly', 'top', 'orbit'], cut: 1, glide: 2.4, pace: 0.9 },
};

// Each feeling's heartbeat, once a bar (phi 0..1 across the bar, phi2 across two,
// phi4 across four; tm: a free clock). Every shape is 0 at the downbeat and rises
// over at least a twentieth of a bar, so the heart never blinks.
const pulse = (x, a, k) => (x <= 0 ? 0 : x < a ? (x / a) * (x / a) * (3 - 2 * (x / a)) : Math.exp(-k * (x - a)));
const wave = (x) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
export const BREATH = {
  love: (p) => 0.62 + 0.4 * (pulse(p.phi, 0.06, 6) + 0.6 * pulse(p.phi - 0.18, 0.06, 6)),   // lub-dub
  desire: (p) => 0.65 + 0.45 * (pulse(p.phi, 0.05, 7) + 0.7 * pulse(p.phi - 0.14, 0.05, 7)),
  anger: (p) => 0.55 + 0.55 * pulse(p.phi, 0.06, 4),                                         // a throb
  sadness: (p) => 0.72 + 0.22 * pulse(p.phi, 0.2, 2.5),                                      // a sigh
  loneliness: (p) => 0.6 + 0.12 * wave(p.phi4),                                              // an ebb
  fear: (p) => 0.7 + 0.1 * wave(2 * p.phi),                                                  // shallow
  joy: (p) => 0.75 + 0.3 * Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * p.phi), 3),
  hope: (p) => 0.7 + 0.3 * Math.sin(Math.PI * p.partPos),                                   // a dawn rising and setting across the part (level at its edges)
  nostalgia: (p) => 0.75 + 0.18 * wave(p.phi2),
  defiance: () => 1.0,                                                                       // never dims
  calm: (p) => 0.8 + 0.2 * wave(p.phi2),
  mystery: (p) => 0.78 + 0.14 * Math.sin(0.61 * p.tm) * Math.sin(0.37 * p.tm),
};

// How full the night sky is: loneliness empties it, mystery and hope fill it.
export const STARS = { love: 0.986, desire: 0.987, anger: 0.989, sadness: 0.990, loneliness: 0.994, fear: 0.991, joy: 0.984, hope: 0.982, nostalgia: 0.988, defiance: 0.986, calm: 0.985, mystery: 0.980 };

// ── The words ─────────────────────────────────────────────────────────
// word → [emotion, weight]. Weights below 1 mark words that only lean.
const LEX = Object.create(null);   // no prototype: a lyric saying 'constructor' must not find a function here
const add = (emotion, weight, words) => { for (const w of words.split(/\s+/)) if (w) (LEX[w] = LEX[w] || []).push([emotion, weight]); };
add('love', 1, 'love loved lover lovers loving heart hearts kiss kissed kisses darling sweetheart tender embrace adore adored beloved cherish devotion romance valentine dear honey');
add('love', 0.5, 'baby sweet together forever yours warm soft gentle hug rose roses hold holding held arms');
add('desire', 1, 'want wanting crave craving desire lust skin lips taste hunger hungry fever temptation tempt seduce sin sinful breathless naked');
add('desire', 0.6, 'touch body heat hot burn burning bed sheets closer wild need needed midnight dance');
add('anger', 1, 'hate hated rage angry anger fury furious fight fighting war blood kill scream screaming smash destroy enemy liar betray betrayed revenge venom poison shout fist damn hell');
add('anger', 0.5, 'fire burn burned mad break bleed teeth devil');
add('sadness', 1, 'cry crying cried tears sad sorrow grief grieve mourn funeral buried bury die died dying dead death goodbye hurt hurts pain ache aching empty hollow regret sorry weep wound scar ashes');
add('sadness', 0.6, 'lost lose losing loss broken rain grey gray blue miss missing fade fading ghost cold');
add('loneliness', 1, 'alone lonely loneliness nobody silence silent distant distance apart isolated nowhere solitude unanswered');
add('loneliness', 0.5, 'empty quiet far away stranger strangers night streetlight room walls window waiting wait echo shadow shadows phone');
add('fear', 1, 'fear afraid scared terror panic anxious anxiety nervous tremble haunted haunt nightmare monster danger trapped cage drown drowning void abyss');
add('fear', 0.5, 'shaking shake run running hide hiding chains falling dark darkness creeping static');
add('joy', 1, 'happy happiness joy joyful smile smiling laugh laughing dancing party celebrate sunshine wonderful');
add('joy', 0.5, 'sun shine shining bright glow glowing gold golden fun alive sing singing summer play beautiful sparkle spark yeah');
add('hope', 1, 'hope hoping rise rising sunrise dawn tomorrow someday believe faith pray prayer heal healing survive survivor daylight');
add('hope', 0.5, 'dream dreams morning light heaven wings fly flying sky star stars new begin beginning start breathe home save saved still here');
add('nostalgia', 1, 'remember remembered memory memories yesterday childhood photograph photographs letters vintage hometown');
add('nostalgia', 0.5, 'old past young younger photo picture pictures letter years summers faded mother father mom dad kitchen house record radio once used');
add('defiance', 1, 'stand standing strong stronger power unbroken unstoppable proud crown warrior roar refuse rebel enough');
add('defiance', 0.5, 'never king queen own brave louder loud free fight rise mark');
add('calm', 1, 'calm peace peaceful ocean sea river lullaby breeze serene');
add('calm', 0.5, 'quiet slow slowly breathe waves wave water float floating drift drifting soft easy rest sleep sleeping clouds cloud still moon');
add('mystery', 1, 'strange mystery secret secrets magic spell cosmic universe galaxy orbit infinite eternity frequency');
add('mystery', 0.5, 'dreaming moon stars space signal static wonder unknown spirit mirror glass neon electric pulse dream');


// ── The songbook's own language ───────────────────────────────────────
// These songs are about scale and the self: awe at how vast it all is, how small
// we are, the ego dissolving, letting go, holding on anyway, the void. Six axes
// carry that, and each also leans into the twelve feelings (mix) so colour follows.
// A weight in brackets marks a common word that only leans.
export const AXES = ['vast', 'small', 'dissolve', 'release', 'resolve', 'void'];
const AXLEX = Object.create(null);
const axis = (name, weight, words, mix) => {
  for (const raw of words.split(/\s+/)) {
    const m = /^([a-z']+)(?:\((\.?\d+)\))?$/.exec(raw);
    if (!m) continue;
    const w = m[2] ? parseFloat(m[2]) : weight;
    (AXLEX[m[1]] = AXLEX[m[1]] || []).push([name, w]);
    for (const [e, k] of Object.entries(mix)) (LEX[m[1]] = LEX[m[1]] || []).push([e, w * k]);
  }
};
axis('vast', 1, 'vast beautiful universe cosmos infinite sky(.5) stars(.5) galaxy grand design miracle horizon holy sacred atoms', { mystery: 0.45, hope: 0.3, calm: 0.25 });
axis('small', 1, 'small speck dust tiny random rng data nodes code temporary borrowed extras mammal nobody(.6)', { loneliness: 0.5, mystery: 0.3, sadness: 0.2 });
axis('dissolve', 1, 'ego pride self(.4) name(.4) version mask script pretend fake copy copies understudy performance mirror ghost projection frame(.4) rendered', { sadness: 0.4, mystery: 0.4, loneliness: 0.2 });
axis('release', 1, 'ashes burn scream shatter surrender exhale finally free(.4) fall(.3)', { defiance: 0.45, hope: 0.3, anger: 0.25 });
axis('resolve', 1, 'anyway alive okay alright fine(.3) enough chose human stubborn stay(.4) showed', { defiance: 0.5, hope: 0.35, calm: 0.15 });
axis('void', 1, 'void nothing end ending entropy cold disappear deleted erased gone forgotten mute heavy(.4) last(.3) die silence', { fear: 0.4, sadness: 0.3, mystery: 0.3 });
// Everyday words the songs lean on, weighted to only lean.
axis('vast', 0.4, 'world life', { mystery: 0.45, hope: 0.3, calm: 0.25 });
axis('resolve', 0.4, 'real keep trying', { defiance: 0.5, hope: 0.35, calm: 0.15 });
axis('dissolve', 0.4, 'face reason', { sadness: 0.4, mystery: 0.4, loneliness: 0.2 });
axis('void', 0.3, 'pass', { fear: 0.4, sadness: 0.3, mystery: 0.3 });
add('hope', 1, 'wish');
add('hope', 0.3, 'maybe coming');
add('loneliness', 0.5, 'leave left door inside everybody');
add('nostalgia', 0.45, 'learned clock time planned day');

const clean = (w) => w.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[^a-z']/g, '').replace(/'s$/, '');   // curly apostrophes too (most lyric files have them)
const zero = () => Object.fromEntries(EMOTIONS.map((e) => [e, 0]));
const zeroAx = () => Object.fromEntries(AXES.map((a) => [a, 0]));
const lookup = (table, w) => table[w] || (w.length > 3 ? table[w.replace(/s$/, '')] || table[w.replace(/(ing|ed|es)$/, '')] || table[w.replace(/(ing|ed)$/, 'e')] : null);

// Phrases are read first (on bare lowercase words, since auto-transcribed lyrics
// have no capitals or punctuation). `take`: which of the phrase's words it uses up,
// so they aren't counted again; 'still' alone for the still-phrases.
const PHRASES = [
  { re: /\blet (me |it )?go\b/g, ax: { release: 1.2 }, v: { defiance: 0.5, hope: 0.35 } },
  { re: /\bego (die|dies|dying|death)\b/g, ax: { dissolve: 1.5 }, v: { sadness: 0.5, mystery: 0.5 } },
  { re: /\bheat death\b/g, ax: { void: 1.5 }, v: { fear: 0.5, mystery: 0.6 } },
  { re: /\bspeck of dust\b/g, ax: { small: 1.5 }, v: { loneliness: 0.7, mystery: 0.4 } },
  { re: /\b(goes|go|sit|sits|stand|stands|stay|stays) still\b/g, take: 'still', v: { calm: 0.6 } },
  { re: /\b(i|we|you|it|i'm|we're|you're|it's)( am| are| is)? still [a-z]/g, take: 'still', ax: { resolve: 1 }, v: { defiance: 0.5, hope: 0.35 } },
  { re: /\b(no one|nobody)\b/g, ax: { small: 0.6 }, v: { loneliness: 1 } },
];
const NEGATORS = new Set(['not', 'no', 'never', "don't", 'dont', "didn't", 'didnt', "won't", 'wont', "can't", 'cant', "ain't", 'aint', "isn't", "wasn't"]);
const DARK = new Set(['sadness', 'loneliness', 'fear', 'anger']);
const PIVOTS = new Set(['but', 'yet', 'still', 'anyway']);

// A line's feeling: { v: 12 feelings, ax: 6 axes, total }. words (optional, the
// line's timed words): a held word counts more, and holding any word reaches for
// the vast. A negated dark word turns toward resolve ("I don't break"); after a
// pivot ("but", "still", "anyway") the words weigh more than before it.
export function scoreLine(text, words = null) {
  const v = zero(), ax = zeroAx();
  const toks = text.split(/\s+/).map(clean).filter(Boolean);
  if (!toks.length) return { v, ax, total: 0 };
  const used = new Array(toks.length).fill(false);
  const at = []; let joined = '';
  toks.forEach((t, i) => { at.push(joined.length + (i ? 1 : 0)); joined += (i ? ' ' : '') + t; });
  const tokAt = (pos) => { let k = 0; while (k + 1 < at.length && at[k + 1] <= pos) k++; return k; };
  for (const P of PHRASES) {
    P.re.lastIndex = 0;
    let m;
    while ((m = P.re.exec(joined))) {
      const i0 = tokAt(m.index), i1 = tokAt(m.index + m[0].length - 1);
      for (let k = i0; k <= i1; k++) if (!P.take || toks[k] === P.take) used[k] = true;
      for (const [e, w] of Object.entries(P.v || {})) v[e] += w;
      for (const [a, w] of Object.entries(P.ax || {})) ax[a] += w;
    }
  }
  let pivot = -1;
  toks.forEach((t, i) => { if (PIVOTS.has(t) && i > 0 && i < toks.length - 1) pivot = i; });
  const held = (i) => {
    if (!words || !words[i] || words[i].end == null) return 0;
    const len = words[i].end - words[i].t, last = i === words.length - 1;
    return len >= (last ? 1.1 : 1.5) ? Math.min(2, len) : 0;
  };
  let vastHold = 0;
  toks.forEach((t, i) => {
    const h = held(i);
    vastHold += 0.2 * h;
    if (used[i]) return;
    const hits = lookup(LEX, t), axh = lookup(AXLEX, t);
    if (!hits && !axh) return;
    let k = (pivot < 0 ? 1 : i > pivot ? 1.5 : 0.6) * (1 + h);
    const negated = (i > 0 && NEGATORS.has(toks[i - 1])) || (i > 1 && NEGATORS.has(toks[i - 2]));
    if (negated) {
      k *= 0.5;
      const dark = (hits || []).some(([e]) => DARK.has(e)) || (axh || []).some(([a]) => a === 'void');
      if (dark) ax.resolve += 0.3;
    }
    for (const [e, w] of hits || []) v[e] += w * k;
    for (const [a, w] of axh || []) ax[a] += w * k;
  });
  ax.vast += Math.min(0.6, vastHold);
  const total = EMOTIONS.reduce((s, e) => s + v[e], 0);
  return { v, ax, total };
}

// A word's own feeling: { e, w, ax } (the strongest feeling and its weight, and
// its axes), or null. Callers choose how strong a word must be to count.
export function wordFeel(word) {
  const w = clean(word), hits = lookup(LEX, w);
  if (!hits) return null;
  const sum = {};
  for (const [e, k] of hits) sum[e] = (sum[e] || 0) + k;
  let e = null;
  for (const k in sum) if (!e || sum[k] > sum[e]) e = k;
  const ax = {};
  for (const [a, k] of lookup(AXLEX, w) || []) ax[a] = (ax[a] || 0) + k;
  return { e, w: sum[e], ax };
}

export function wordEmotion(word) {
  const f = wordFeel(word);
  return f && f.w >= 0.6 ? f.e : null;
}

export function scoreText(text) { return scoreLine(text).v; }

const top = (v) => EMOTIONS.map((e) => [e, v[e]]).sort((a, b) => b[1] - a[1]);
const total = (v) => EMOTIONS.reduce((s, e) => s + v[e], 0);

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sat = (x) => 1 - Math.exp(-x / 1.2);   // an axis' evidence, 0..1

// What the music alone suggests: how charged it is (arousal 0..1, its energy) and
// how bright (valence -1..1, from its key lean and how many of its chords are
// minor), read between four corners. Sums to 1.
function musicFeel(arousal, valence) {
  const a = clamp(arousal, 0, 1), p = clamp((valence + 1) / 2, 0, 1), v = zero();
  const corner = (k, mix) => { for (const [e, w] of Object.entries(mix)) v[e] += k * w; };
  corner(a * (1 - p), { defiance: 0.4, anger: 0.3, desire: 0.2, fear: 0.1 });
  corner(a * p, { joy: 0.35, hope: 0.35, defiance: 0.2, love: 0.1 });
  corner((1 - a) * (1 - p), { sadness: 0.4, loneliness: 0.35, mystery: 0.25 });
  corner((1 - a) * p, { calm: 0.4, nostalgia: 0.25, love: 0.2, hope: 0.15 });
  return v;
}

// How much a line counts: hooks a little more, ad-libs and backing vocals less.
const lineWeight = (l) => (l.how === 'adlib' ? 0.3 : l.how === 'backing' ? 0.5 : 1) * (l.hook ? 1.25 : 1);
// What a part's own label says (the raw label: a Build-Up is dread rising, a Drop
// is release, an outro comes to rest under a vast sky).
const STRUCTURE = [[/build/i, { void: 0.3 }], [/drop/i, { release: 0.5 }], [/outro|coda/i, { resolve: 0.3, vast: 0.3 }]];

// A feeling snapshot: up to four feelings at 8% or more, summing to 1, the six axes
// (0..1), and how much the words said (conf). primary/secondary are its first two.
function snapshot(mix, ax, conf) {
  const sum = total(mix) || 1;
  let v = top(mix).slice(0, 4).map(([e, w]) => [e, w / sum]).filter(([, w]) => w >= 0.08);
  if (!v.length) v = [[top(mix)[0][0], 1]];
  const vs = v.reduce((s2, [, w]) => s2 + w, 0);
  v = v.map(([e, w]) => [e, w / vs]);
  return {
    primary: v[0][0], secondary: (v[1] || v[0])[0], strength: v[0][1] - (v[1] ? v[1][1] : 0),
    v, top: v.map(([e]) => e), ax: Object.fromEntries(AXES.map((a) => [a, sat(ax[a] || 0)])), conf,
  };
}

// The whole song's mood and each part's snapshot (see snapshot). spans: the song's
// written parts [{ start, end, label, group }] (choruses share a group, so every
// chorus is the same emotional place); otherwise the analysis' sections.
export function readSong(map, lines, spans = null) {
  const over = (a, b, key) => {
    let w = 0, v = 0;
    for (const s of map.sections) { const o = Math.max(0, Math.min(b, s.end) - Math.max(a, s.start)); w += o; v += o * (s[key] || 0); }
    return w ? v / w : 0;
  };
  const minorShare = (a, b) => {
    const C = (map.chords || []).filter((c) => c.t >= a && c.t < b && c.score >= 0.25);
    return C.length ? C.filter((c) => c.minor).length / C.length : map.mode === 'minor' ? 0.7 : 0.3;
  };
  const valence = (lean, a, b) => clamp(clamp(lean * 4, -1, 1) * 0.6 + (0.5 - minorShare(a, b)) * 0.8, -1, 1);
  const scored = lines.map((l) => ({ l, s: scoreLine(l.text, l.words), w: lineWeight(l) }));

  const words = zero(), wax = zeroAx();
  for (const { s, w } of scored) { for (const e of EMOTIONS) words[e] += s.v[e] * w; for (const a of AXES) wax[a] += s.ax[a] * w; }
  const wTotal = total(words);
  const lyricShare = Math.min(0.8, wTotal / 14);   // a few emotional words only nudge
  const avgEnergy = map.sections.reduce((s, x) => s + x.energy * (x.end - x.start), 0) / Math.max(1, map.duration);
  const prior = musicFeel(avgEnergy, valence(map.lean || 0, 0, map.duration));
  const song = zero();
  for (const e of EMOTIONS) song[e] = (wTotal ? (words[e] / wTotal) * lyricShare : 0) + prior[e] * (1 - lyricShare);
  const songF = snapshot(song, Object.fromEntries(AXES.map((a) => [a, wax[a] / Math.max(1, lines.length / 8)])), Math.min(1, wTotal / 14));
  const songMood = { ...songF, vector: song };

  const spanList = spans && spans.length
    ? spans.map((sp) => ({ ...sp, energy: over(sp.start, sp.end, 'energy'), lean: over(sp.start, sp.end, 'lean') }))
    : map.sections;
  const raw = spanList.map((sp) => {
    const v = zero(), ax = zeroAx();
    let lex = 0, n = 0;
    for (const { l, s, w } of scored) {
      if (l.t < sp.start || l.t >= sp.end) continue;
      for (const e of EMOTIONS) v[e] += s.v[e] * w;
      for (const a of AXES) ax[a] += s.ax[a] * w;
      lex += s.total * w; n++;
    }
    for (const a of AXES) ax[a] /= Math.max(1, n / 4);   // evidence per few lines, so a long part doesn't max every axis
    for (const [re, add2] of STRUCTURE) if (re.test(sp.label || '')) for (const [a, k] of Object.entries(add2)) ax[a] += k;
    return { v, ax, lex };
  });
  // Every chorus is the same place: its words are read together.
  const groups = {};
  spanList.forEach((sp, i) => { if (sp.group) (groups[sp.group] = groups[sp.group] || []).push(i); });
  for (const members of Object.values(groups)) {
    const v = zero(), ax = zeroAx();
    let lex = 0;
    for (const i of members) { for (const e of EMOTIONS) v[e] += raw[i].v[e]; for (const a of AXES) ax[a] += raw[i].ax[a]; lex += raw[i].lex; }
    const n = members.length;
    for (const a of AXES) ax[a] /= n;
    for (const i of members) raw[i] = { v, ax, lex: lex / n, energy: Math.max(...members.map((j) => spanList[j].energy)) };
  }
  // The words count as far as they say something (conf); the rest is the music of
  // the part and the part before it, never the song's average.
  let prev = null;
  const sections = spanList.map((sp, i) => {
    const R = raw[i], conf = Math.min(1, R.lex / 2.5), lt = total(R.v);
    const music = musicFeel(R.energy ?? sp.energy, valence(sp.lean || 0, sp.start, sp.end));
    const mix = zero();
    for (const e of EMOTIONS) mix[e] = (lt ? R.v[e] / lt : 0) * conf + (1 - conf) * (0.6 * music[e] + 0.4 * (prev ? prev.vec[e] : song[e]));
    const F = snapshot(mix, R.ax, conf);
    F.vec = mix;
    prev = F;
    return F;
  });
  return { song: songMood, sections, key: map.key, minor: map.mode === 'minor' };
}

// A line's own feeling, if it has a clear one (used to bleed colour for a line).
export function lineEmotion(text) {
  const r = top(scoreText(text));
  return r[0][1] >= 1 ? r[0][0] : null;
}
