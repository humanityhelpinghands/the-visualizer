// The songs as stars near the Sun. Direction: what the words feel (the twelve
// feelings around a wheel, lifted by awe and release, pulled down by the void).
// Distance: how much you've heard it, so the songs you live with are nearest.
// A song and its covers orbit each other as one system.
import * as THREE from 'three';
import { scoreLine, EMOTIONS, AXES } from '../emotion.js';
import { LY, U, rng } from './cosmos.js';

// Each feeling's star colour, vivid and never green.
export const HUE = {
  love: '#ff5e8a', desire: '#ff2457', anger: '#ff4a1c', defiance: '#b04dff', joy: '#ffc21a', hope: '#ff9a6a',
  nostalgia: '#f3c98a', loneliness: '#ffa645', sadness: '#5c8ccf', fear: '#3d6bff', mystery: '#8a6bff', calm: '#4fd2ff',
};
const WHEEL = ['love', 'desire', 'anger', 'defiance', 'joy', 'hope', 'nostalgia', 'loneliness', 'sadness', 'fear', 'mystery', 'calm'];
const base = (n) => n.replace(/\s*\((\d+|cover)\)\s*$/i, '').replace(/\s+cover$/i, '').trim().toLowerCase();
export const shortName = (n) => n.replace(/\s+[—–-]\s+\d{4}\b.*$/, '').replace(/\s*\(\d+\)$/, '').trim();

function feel(lrc) {
  const v = Object.fromEntries(EMOTIONS.map((e) => [e, 0])), ax = Object.fromEntries(AXES.map((a) => [a, 0]));
  let lines = 0;
  for (const raw of lrc.split(/\r?\n/)) {
    const m = /^\[\d+:\d+(?:\.\d+)?\](.*)$/.exec(raw);
    if (!m) continue;
    const text = m[1].replace(/<[^>]*>/g, '').trim();
    if (!text) continue;
    const s = scoreLine(text);
    for (const e of EMOTIONS) v[e] += s.v[e];
    for (const a of AXES) ax[a] += s.ax[a];
    lines++;
  }
  return { v, ax, lines };
}

// The words of each song are kept in this browser between visits, by their
// versioned address (the server stamps auto-lyrics with the file's time), so a
// visit asks the server for the song list and only the words that changed. They
// are always re-read for feeling, so a change to emotion.js takes effect at once.
const WORDS = 'observatory.words.v1';
function storedWords() { try { return JSON.parse(localStorage.getItem(WORDS) || '{}'); } catch { return {}; } }

export async function loadSongs() {
  const { tracks } = await (await fetch('/api/tracks')).json();
  const kept = storedWords(), keep = {};
  const songs = await Promise.all(tracks.map(async (t) => {
    let f = null;
    if (t.lyrics) {
      try {
        let text = kept[t.lyrics];
        if (text == null) { const res = await fetch(t.lyrics); if (res.ok) text = await res.text(); }
        if (text != null) { f = feel(text); if (t.lyrics.includes('?v=')) keep[t.lyrics] = text; }
      } catch { /* no words: the music alone */ }
    }
    return { name: t.name, short: shortName(t.name), url: t.url, listened: t.listened || 0, plays: t.plays || 0, disliked: !!t.disliked, f };
  }));
  try { localStorage.setItem(WORDS, JSON.stringify(keep)); } catch { /* private window or full: fetch them again next time */ }
  // Systems: a song and its covers.
  const systems = new Map();
  for (const s of songs) { const k = base(s.name); if (!systems.has(k)) systems.set(k, []); systems.get(k).push(s); }
  const list = [...systems.values()].map((members) => {
    const v = Object.fromEntries(EMOTIONS.map((e) => [e, 0])), ax = Object.fromEntries(AXES.map((a) => [a, 0]));
    let lines = 0;
    for (const s of members) if (s.f) { for (const e of EMOTIONS) v[e] += s.f.v[e]; for (const a of AXES) ax[a] += s.f.ax[a]; lines += s.f.lines; }
    return { members, v, ax, lines, listened: members.reduce((a, s) => a + s.listened, 0) };
  });
  list.sort((a, b) => b.listened - a.listened || a.members[0].name.localeCompare(b.members[0].name));
  const G = list.length;
  list.forEach((sys, i) => {
    const r = rng(hash(sys.members[0].name));
    const total = EMOTIONS.reduce((a, e) => a + sys.v[e], 0);
    const top = EMOTIONS.map((e) => [e, sys.v[e]]).sort((a, b) => b[1] - a[1]).slice(0, 4).filter(([, w]) => total && w / total >= 0.08);
    const sum = top.reduce((a, [, w]) => a + w, 0) || 1;
    sys.top = top.length ? top.map(([e, w]) => [e, w / sum]) : [['mystery', 1]];
    sys.primary = sys.top[0][0];
    let cx = 0, cy = 0;
    for (const [e, w] of sys.top) { const a = (WHEEL.indexOf(e) / WHEEL.length) * Math.PI * 2; cx += Math.cos(a) * w; cy += Math.sin(a) * w; }
    const az = Math.atan2(cy, cx) + (r() - 0.5) * 0.3;
    const up = sys.ax.vast + sys.ax.release + sys.ax.resolve, down = sys.ax.void + sys.ax.small + sys.ax.dissolve;
    const lat = ((up - down) / (up + down + 1)) * 0.95 + (r() - 0.5) * 0.25;
    const d = 7 + 33 * Math.pow(i / Math.max(1, G - 1), 0.85) + (r() - 0.5) * 3;
    sys.local = new THREE.Vector3(Math.cos(lat) * Math.cos(az) * d, Math.sin(lat) * d, Math.cos(lat) * Math.sin(az) * d);
    sys.axes = Object.fromEntries(AXES.map((a) => [a, 1 - Math.exp(-sys.ax[a] / Math.max(1, sys.lines / 6))]));
  });
  // No two systems closer than 3.5 ly.
  for (let it = 0; it < 40; it++) {
    for (let i = 0; i < G; i++) for (let j = i + 1; j < G; j++) {
      const a = list[i].local, b = list[j].local, d = a.distanceTo(b);
      if (d < 3.5 && d > 0) { const push = new THREE.Vector3().subVectors(a, b).multiplyScalar((3.5 - d) / d / 2); a.add(push); b.sub(push); }
    }
  }
  const out = [];
  for (const sys of list) sys.members.forEach((s, k) => {
    Object.assign(s, { sys, k, n: sys.members.length, top: sys.top, primary: sys.primary, axes: sys.axes, local: sys.local.clone(), color: new THREE.Color(s.disliked ? '#6b6478' : HUE[sys.primary]) });
    s.pos = s.local.clone().multiplyScalar(LY);   // metres from the Sun (the system's centre)
    out.push(s);
  });
  return out;
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

// ── The stars themselves: a white-hot heart, a coloured glow and eight spikes ──
const VERT = `
attribute vec3 color; attribute float size; attribute float boost;
uniform float uOpacity, uPx, uTime, uScale;
varying vec3 vColor; varying float vAlpha; varying float vRot;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(-mv.z, 1e-4);
  gl_PointSize = size * clamp(2.6 / d, 0.55, 1.8) * boost * uScale * uPx;
  vAlpha = uOpacity * min(1.0, 0.55 + 0.45 * boost);
  vColor = color;
  vRot = position.x * 3.7 + uTime * 0.05;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec3 vColor; varying float vAlpha; varying float vRot;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p);
  if (r > 1.0) discard;
  float c = cos(vRot), s = sin(vRot); vec2 q = mat2(c, -s, s, c) * p;
  float core = exp(-r * r * 60.0), glow = exp(-r * r * 7.0) * 0.5, fall = 1.0 - smoothstep(0.2, 1.0, r);
  float spikes = (exp(-abs(q.x) * 55.0) + exp(-abs(q.y) * 55.0)) * fall * 0.7;
  vec2 d2 = vec2(q.x + q.y, q.x - q.y) * 0.7071;
  float diag = (exp(-abs(d2.x) * 70.0) + exp(-abs(d2.y) * 70.0)) * (1.0 - smoothstep(0.0, 0.55, r)) * 0.3;
  vec3 col = mix(vColor, vec3(1.0), clamp(core * 1.2, 0.0, 1.0));
  gl_FragColor = vec4(col * (core * 1.5 + glow + spikes + diag) * vAlpha, 1.0);
}`;

export function buildSongs(layer, songs) {
  const n = songs.length, g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), boost = new Float32Array(n).fill(1);
  const maxHeard = Math.max(1, ...songs.map((s) => s.listened));
  songs.forEach((s, i) => { col.set([s.color.r, s.color.g, s.color.b], i * 3); size[i] = s.disliked ? 14 : 24 + 14 * Math.sqrt(s.listened / maxHeard); });
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.setAttribute('boost', new THREE.BufferAttribute(boost, 1));
  const mat = new THREE.ShaderMaterial({ uniforms: { uOpacity: { value: 0 }, uPx: U.px, uTime: U.time, uScale: { value: 1 } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  layer.add(pts);

  // Constellations: each feeling's songs joined by their shortest tree.
  const seg = [], segCol = [], byFeel = {};
  const systems = [...new Set(songs.map((s) => s.sys))];
  for (const sys of systems) (byFeel[sys.primary] = byFeel[sys.primary] || []).push(sys);
  for (const [e, group] of Object.entries(byFeel)) {
    const c = new THREE.Color(HUE[e]), inTree = [group[0]], rest = group.slice(1);
    while (rest.length) {
      let best = null;
      for (const a of inTree) for (const b of rest) { const d = a.local.distanceTo(b.local); if (!best || d < best[2]) best = [a, b, d]; }
      seg.push(best[0].local.x, best[0].local.y, best[0].local.z, best[1].local.x, best[1].local.y, best[1].local.z);
      segCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
      inTree.push(best[1]); rest.splice(rest.indexOf(best[1]), 1);
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  lg.setAttribute('color', new THREE.Float32BufferAttribute(segCol, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  lines.frustumCulled = false;
  layer.add(lines, 0.28);

  const world = new THREE.Vector3();
  return {
    lines, stars: pts,
    // Per frame: covers circle their system, and the chosen, hovered and playing stars swell.
    update(t, { sel, hover, playing, bass }) {
      songs.forEach((s, i) => {
        const p = s.local;
        if (s.n > 1) {
          const a = t * 0.12 + (s.k / s.n) * Math.PI * 2;
          pos[i * 3] = s.sys.local.x + Math.cos(a) * 0.45; pos[i * 3 + 1] = s.sys.local.y; pos[i * 3 + 2] = s.sys.local.z + Math.sin(a) * 0.45;
        } else { pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; }
        boost[i] = (s === playing ? 1.3 + bass * 0.9 : 1) * (s === sel ? 1.45 : s === hover ? 1.2 : 1);
      });
      g.attributes.position.needsUpdate = true;
      g.attributes.boost.needsUpdate = true;
    },
    // Where song i is in the room right now (display units).
    world(i) { return world.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(layer.group.matrixWorld); },
  };
}
