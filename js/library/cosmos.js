// The universe in layers, from Earth to the edge of what can be seen. Each layer
// keeps its own unit and origin; the room scales and shifts every layer so the
// view is always about one unit across, which keeps 20 decades of scale inside
// float range. A layer is built the first time the view comes near it.
import * as THREE from 'three';

export const AU = 1.495978707e11, LY = 9.4607e15, KLY = 1e3 * LY, MLY = 1e6 * LY, GLY = 1e9 * LY;
export const R0 = 26e3 * LY;   // the Sun to the galactic centre
const DEG = Math.PI / 180;
export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Shared by every material: the canvas' pixel ratio and the clock.
export const U = { px: { value: 1 }, time: { value: 0 } };

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const gauss = (r) => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };

// ── Coordinates ───────────────────────────────────────────────────────
// The room's axes are galactic, so the disc lies flat: x toward the galactic
// centre, y toward the north galactic pole, z away from l = 90°.
const EQ2GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
];
function eqToRoom(x, y, z, d, out) {
  const g = EQ2GAL.map((r) => r[0] * x + r[1] * y + r[2] * z);
  return out.set(g[0] * d, g[2] * d, -g[1] * d);
}
export function equatorial(raH, decD, d, out = new THREE.Vector3()) {
  const a = raH * 15 * DEG, b = decD * DEG;
  return eqToRoom(Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b), d, out);
}
export function galactic(lD, bD, d, out = new THREE.Vector3()) {
  const l = lD * DEG, b = bD * DEG;
  return out.set(Math.cos(b) * Math.cos(l) * d, Math.sin(b) * d, -Math.cos(b) * Math.sin(l) * d);
}
const OBL = 23.4393 * DEG;
export function ecliptic(lonD, latD, d, out = new THREE.Vector3()) {
  const l = lonD * DEG, b = latD * DEG;
  const x = Math.cos(b) * Math.cos(l), y = Math.cos(b) * Math.sin(l), z = Math.sin(b);
  return eqToRoom(x, y * Math.cos(OBL) - z * Math.sin(OBL), y * Math.sin(OBL) + z * Math.cos(OBL), d, out);
}
export const EARTH_AXIS = equatorial(0, 90, 1);

// The planets where they are today (mean longitudes, circular orbits).
const DAYS = (Date.now() - Date.UTC(2000, 0, 1, 12)) / 864e5;
const PLANETS = [   // name, distance (AU), mean longitude at J2000 (°), period (days), colour, px
  ['Mercury', 0.387, 252.25, 87.969, '#c9bfb5', 3.5], ['Venus', 0.723, 181.98, 224.701, '#ffd9a0', 4.5],
  ['Earth', 1, 100.46, 365.256, '#6fb6ff', 4.5], ['Mars', 1.524, 355.45, 686.98, '#ff6b4a', 4],
  ['Jupiter', 5.203, 34.4, 4332.59, '#ffc48a', 6], ['Saturn', 9.537, 49.94, 10759.22, '#f3dca0', 5.5],
  ['Uranus', 19.19, 313.23, 30688.5, '#8fd8ff', 4.5], ['Neptune', 30.07, 304.88, 60182, '#6c86ff', 4.5],
];
const lonNow = (l0, period) => (((l0 + (360 / period) * DAYS) % 360) + 360) % 360;
export const EARTH_POS = ecliptic(lonNow(100.46, 365.256), 0, AU);
export const GC = new THREE.Vector3(R0, 0, 0);

// Bright and near stars: name, RA (h), Dec (°), distance (ly), colour, luminosity.
export const NAMED = [
  ['Alpha Centauri', 14.66, -60.83, 4.37, '#fff1d6', 1.4], ["Barnard's Star", 17.963, 4.69, 5.96, '#ff8a5c', 0.25],
  ['Wolf 359', 10.94, 7.01, 7.9, '#ff7a4a', 0.2], ['Sirius', 6.752, -16.72, 8.6, '#cfe0ff', 3],
  ['Epsilon Eridani', 3.549, -9.46, 10.5, '#ffc98a', 0.5], ['Procyon', 7.655, 5.22, 11.46, '#f2f0ff', 1.8],
  ['Tau Ceti', 1.734, -15.94, 11.9, '#ffe2b8', 0.5], ['Altair', 19.846, 8.87, 16.7, '#e6ecff', 1.8],
  ['Vega', 18.616, 38.78, 25, '#cad7ff', 2.4], ['Fomalhaut', 22.961, -29.62, 25.1, '#d6e0ff', 2],
  ['Pollux', 7.755, 28.03, 33.8, '#ffcf96', 2], ['Arcturus', 14.261, 19.18, 36.7, '#ffbf7a', 3],
  ['Capella', 5.278, 46, 42.9, '#fff0c8', 3], ['Aldebaran', 4.599, 16.51, 65.3, '#ffad6b', 3],
  ['Regulus', 10.14, 11.97, 79.3, '#c8d6ff', 2.5], ['Spica', 13.42, -11.16, 250, '#a9bfff', 5],
  ['Canopus', 6.4, -52.7, 310, '#f5f2ff', 6], ['Polaris', 2.53, 89.26, 433, '#fff2d0', 5],
  ['Betelgeuse', 5.919, 7.41, 548, '#ff8a4a', 8], ['Antares', 16.49, -26.43, 550, '#ff6a3d', 8],
  ['Rigel', 5.242, -8.2, 860, '#a9c4ff', 9], ['Deneb', 20.69, 45.28, 2600, '#e0e8ff', 12],
];

// The ladder: where each scale sits (log10 of the view's radius in metres).
export const LEVELS = [
  { name: 'Earth', z: 7.15, caption: '12,742 km across. Everyone who has ever lived, lived here.' },
  { name: 'The Moon', z: 8.95, caption: '384,400 km out. Light makes the trip in 1.3 seconds.' },
  { name: 'Inner planets', z: 11.35, caption: 'The light on your face left the Sun eight minutes ago.' },
  { name: 'Solar System', z: 12.9, caption: "Voyager 1 has been flying since 1977. It's barely left." },
  { name: 'Oort Cloud', z: 15.45, caption: 'Perhaps trillions of icy bodies, still held by the Sun.' },
  { name: 'Your stars', z: 17.45, caption: 'Your songs, placed by what they feel. The ones you play most are nearest.' },
  { name: 'Neighbourhood', z: 18.9, caption: 'Almost every star you can see at night lives inside this view.' },
  { name: 'Milky Way', z: 20.75, caption: 'A hundred thousand light-years. Hundreds of billions of stars. You are here.' },
  { name: 'Local Group', z: 22.5, caption: "Andromeda's light left before our species existed." },
  { name: 'Cosmic web', z: 25.0, caption: 'Galaxies strung along threads of dark matter, around the voids.' },
  { name: 'Observable universe', z: 26.7, caption: "93 billion light-years. Centred on you: light from farther hasn't reached you yet." },
];
export const ZMIN = 6.95, ZMAX = 27.0;

// ── Points ────────────────────────────────────────────────────────────
// Every star, planet and galaxy is a soft point. atten 1: brightness falls with
// the square of its distance from the eye (bright: how bright at one unit), 0: fixed.
const PT_VERT = `
attribute float size; attribute float lum; attribute vec3 color;
uniform float uOpacity, uPx, uBright, uAtten, uMin, uMax, uTime, uTwinkle;
varying vec3 vColor; varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(-mv.z, 1e-5);
  float b = lum * mix(1.0, uBright / (d * d), uAtten);
  b *= 1.0 + uTwinkle * sin(uTime * 3.1 + dot(position, vec3(91.7, 53.1, 17.3)));
  float s = size * sqrt(max(b, 0.0));
  vAlpha = clamp(b, 0.0, 1.0) * uOpacity * clamp(s / uMin, 0.0, 1.0);
  gl_PointSize = clamp(s, uMin, uMax) * uPx;
  vColor = color;
  gl_Position = projectionMatrix * mv;
}`;
const PT_FRAG = `
varying vec3 vColor; varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p);
  if (r2 > 1.0 || vAlpha < 0.002) discard;
  float a = exp(-r2 * 5.0) * 0.75 + exp(-r2 * 22.0) * 0.6;
  gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
}`;

export class Cloud {
  constructor(cap) { this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3); this.size = new Float32Array(cap); this.lum = new Float32Array(cap); this.n = 0; this.cap = cap; }
  push(x, y, z, c, size, lum) {
    if (this.n >= this.cap) return;
    const i = this.n++, j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.col[j] = c.r; this.col[j + 1] = c.g; this.col[j + 2] = c.b;
    this.size[i] = size; this.lum[i] = lum;
  }
  pushV(v, c, size, lum) { this.push(v.x, v.y, v.z, c, size, lum); }
}
export function points(cloud, { bright = 1, atten = 0, min = 0.6, max = 8, twinkle = 0 } = {}) {
  const g = new THREE.BufferGeometry(), n = cloud.n;
  g.setAttribute('position', new THREE.BufferAttribute(cloud.pos.subarray(0, n * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(cloud.col.subarray(0, n * 3), 3));
  g.setAttribute('size', new THREE.BufferAttribute(cloud.size.subarray(0, n), 1));
  g.setAttribute('lum', new THREE.BufferAttribute(cloud.lum.subarray(0, n), 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uPx: U.px, uTime: U.time, uBright: { value: bright }, uAtten: { value: atten }, uMin: { value: min }, uMax: { value: max }, uTwinkle: { value: twinkle } },
    vertexShader: PT_VERT, fragmentShader: PT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}
const C = (hex) => new THREE.Color(hex);
const _c = new THREE.Color();
const mix = (a, b, t) => _c.copy(a).lerp(b, t);

function lineMat() { return new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }); }
function loop(pts, hex) {
  const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat());
  l.material.color.set(hex);
  l.frustumCulled = false;
  return l;
}

// ── Surfaces ──────────────────────────────────────────────────────────
const NOISE = `
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;
const SURF_VERT = `
varying vec3 vObj; varying vec3 vN; varying vec3 vV;
void main() {
  vObj = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
// Earth, house style: deep oceans, dusk-violet land, amber cities on the night side.
const EARTH_FRAG = NOISE + `
uniform vec3 uSun; uniform float uOpacity, uTime;
varying vec3 vObj; varying vec3 vN; varying vec3 vV;
void main() {
  vec3 n = normalize(vObj), N = normalize(vN), V = normalize(vV);
  float h = fbm(n * 2.4 + 3.0);
  float land = smoothstep(0.5, 0.53, h);
  float ice = smoothstep(0.86, 0.93, abs(n.y) + (h - 0.5) * 0.25);
  vec3 ocean = mix(vec3(0.004, 0.014, 0.05), vec3(0.012, 0.05, 0.15), smoothstep(0.3, 0.5, h));
  vec3 ground = mix(vec3(0.05, 0.035, 0.08), vec3(0.17, 0.11, 0.21), smoothstep(0.53, 0.72, h));
  vec3 base = mix(mix(ocean, ground, land), vec3(0.72, 0.78, 0.95), ice);
  float clouds = smoothstep(0.56, 0.78, fbm(n * 5.0 + vec3(uTime * 0.004, 0.0, 0.0)));
  float ndl = dot(N, uSun), day = max(ndl, 0.0), lit = smoothstep(-0.12, 0.25, ndl);
  vec3 col = base * (0.015 + 1.35 * day) + vec3(0.85, 0.88, 1.0) * clouds * 0.5 * day;
  float city = land * (1.0 - ice) * (1.0 - clouds * 0.7) * smoothstep(0.6, 0.72, fbm(n * 38.0)) * (1.0 - lit);
  col += vec3(1.0, 0.6, 0.2) * city * 1.4;
  vec3 H = normalize(uSun + V);
  col += vec3(1.0, 0.85, 0.7) * pow(max(dot(N, H), 0.0), 60.0) * (1.0 - land) * day * 0.6;
  col += vec3(0.25, 0.6, 1.0) * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.0) * (0.1 + 0.9 * lit) * 0.8;
  gl_FragColor = vec4(col, uOpacity);
}`;
const ATMO_FRAG = `
uniform vec3 uSun; uniform float uOpacity;
varying vec3 vObj; varying vec3 vN; varying vec3 vV;
void main() {
  vec3 N = normalize(vN), V = normalize(vV);
  float f = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 2.5);   // (two unit vectors can dot to 1.0000001: pow() of that tiny negative is NaN on D3D)
  float lit = smoothstep(-0.35, 0.4, dot(N, uSun));
  gl_FragColor = vec4(vec3(0.22, 0.55, 1.0) * f * (0.1 + lit) * 1.5 * uOpacity, 1.0);
}`;
const MOON_FRAG = NOISE + `
uniform vec3 uSun; uniform float uOpacity;
varying vec3 vObj; varying vec3 vN; varying vec3 vV;
void main() {
  vec3 n = normalize(vObj), N = normalize(vN);
  float m = fbm(n * 3.0 + 7.0), c = fbm(n * 16.0);
  vec3 base = mix(vec3(0.2, 0.19, 0.23), vec3(0.56, 0.55, 0.6), smoothstep(0.38, 0.62, m)) * (0.8 + 0.4 * c);
  gl_FragColor = vec4(base * (0.008 + 1.2 * max(dot(N, uSun), 0.0)), uOpacity);
}`;
// The edge: the oldest light, a shell 46.5 billion light-years out.
const CMB_FRAG = NOISE + `
uniform float uOpacity;
varying vec3 vObj; varying vec3 vN; varying vec3 vV;
void main() {
  vec3 n = normalize(vObj), N = normalize(vN), V = normalize(vV);
  float f = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 2.0), k = 0.08 + 0.92 * f;
  float t = smoothstep(0.3, 0.75, fbm(n * 7.0 + 2.0));
  vec3 c = mix(vec3(0.08, 0.05, 0.35), vec3(0.55, 0.18, 0.95), smoothstep(0.0, 0.5, t));
  c = mix(c, vec3(1.0, 0.35, 0.6), smoothstep(0.5, 0.8, t));
  // The hottest spots are gold only where they burn bright; dim, they glow ember
  // rose, since a dim gold beside violet reads as olive.
  vec3 gold = mix(vec3(1.0, 0.3, 0.4), vec3(1.0, 0.72, 0.35), smoothstep(0.35, 0.85, k));
  c = mix(c, gold, smoothstep(0.85, 1.0, t));
  gl_FragColor = vec4(c * k * uOpacity, 1.0);
}`;
function surface(geo, frag, uniforms, opts = {}) {
  return new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: { uOpacity: { value: 0 }, ...uniforms }, vertexShader: SURF_VERT, fragmentShader: frag, transparent: true, ...opts }));
}

// ── Layers ────────────────────────────────────────────────────────────
export class Layer {
  // z: [fade in from, fully in, fade out from, gone] in log10 metres.
  constructor(name, { unit, origin = new THREE.Vector3(), z, build }) {
    Object.assign(this, { name, unit, origin, z, build, built: false, op: 0, mats: [], labels: [], tick: null });
    this.group = new THREE.Group();
    this.group.visible = false;
  }
  fade(z) { const [a, b, c, d] = this.z; return smooth(a, b, z) * (1 - smooth(c, d, z)); }
  add(obj, base = 1) { obj.material.userData.base = base; this.mats.push(obj.material); this.group.add(obj); return obj; }
  label(text, pos, opts = {}) { this.labels.push({ text, pos, ...opts }); }
  update(z, focus, R, t) {
    this.op = this.fade(z);
    this.group.visible = this.op > 0.003;
    if (!this.group.visible) return;
    if (!this.built) { this.built = true; this.build(this); }
    if (this.name !== 'sky') {
      this.group.position.set((this.origin.x - focus.x) / R, (this.origin.y - focus.y) / R, (this.origin.z - focus.z) / R);
      this.group.scale.setScalar(this.unit / R);
    }
    for (const m of this.mats) {
      const o = this.op * m.userData.base;
      if (m.uniforms) m.uniforms.uOpacity.value = o; else m.opacity = o;
    }
    if (this.tick) this.tick(t, z);
  }
}
// An orbit drawn as a ring fades as the view comes inside it: seen from within, a
// ring is a stray line across the sky (the camera sits 2.6 view radii out).
const orbitFade = (radiusM, z) => 1 - smooth(1.3, 2.1, radiusM / 10 ** z);
// A galaxy's points keep their size in pixels as it recedes, so its light would pile
// into ever fewer pixels; dimming them with its shrinking size keeps it a galaxy
// rather than a white blot.
const recede = (radiusM, z, floor = 0.004) => Math.max(floor, Math.min(1, radiusM / 10 ** z / 0.45));
const fadeOpacity = (m, k) => { if (m.uniforms) m.uniforms.uOpacity.value *= k; else m.opacity *= k; };

export function buildLayers() {
  return {
    sky: new Layer('sky', { unit: 1, z: [-9, -8, 15.0, 15.9], build: buildSky }),
    earth: new Layer('earth', { unit: 1e6, origin: EARTH_POS, z: [0, 1, 9.9, 10.7], build: buildEarth }),
    solar: new Layer('solar', { unit: AU, z: [9.5, 10.4, 14.4, 15.3], build: buildSolar }),
    oort: new Layer('oort', { unit: AU, z: [13.8, 14.7, 16.2, 17.0], build: buildOort }),
    stars: new Layer('stars', { unit: LY, z: [15.1, 15.9, 19.2, 19.9], build: buildStars }),
    galaxy: new Layer('galaxy', { unit: KLY, origin: GC, z: [19.3, 20.2, 23.3, 24.0], build: buildGalaxy }),
    local: new Layer('local', { unit: MLY, origin: GC, z: [21.9, 22.5, 24.4, 25.2], build: buildLocal }),
    web: new Layer('web', { unit: GLY, z: [23.5, 24.4, 98, 99], build: buildWeb }),
    edge: new Layer('edge', { unit: GLY, z: [25.5, 26.4, 98, 99], build: buildEdge }),
  };
}

function starColour(l) { return l < 0.03 ? '#ff8a55' : l < 0.15 ? '#ffc98a' : l < 0.6 ? '#fff1d6' : '#cfdcff'; }

// The night sky seen from home: stars at infinity and the Milky Way's band.
function buildSky(layer) {
  const r = rng(3), c = new Cloud(40000), v = new THREE.Vector3(), D = 900;
  const band = [C('#cdb8ff'), C('#ffd9b0'), C('#9fc4ff')];
  for (let i = 0; i < 26000; i++) {
    const l = r() < 0.6 ? gauss(r) * 55 : r() * 360, b = gauss(r) * (3 + 3 * r());
    galactic(l, b, D, v);
    c.pushV(v, mix(band[i % 3], band[(i + 1) % 3], r()), 3, 0.05 + 0.08 * r() * Math.exp(-Math.abs(((l + 540) % 360) - 180) / 90));
  }
  for (let i = 0; i < 12000; i++) {
    const u = 2 * r() - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), lum = Math.pow(10, -1.6 * r());
    c.push(s * Math.cos(a) * D, u * D, s * Math.sin(a) * D, C(starColour(lum * 0.6)), 2.2, lum);
  }
  for (const [, ra, dec, , hex, lum] of NAMED) c.pushV(equatorial(ra, dec, D, v), C(hex), 3.2, Math.min(1, 0.4 + lum / 6));
  layer.add(points(c, { atten: 0, min: 0.6, max: 4 }), 0.9);
}

function buildEarth(layer) {
  const sun = EARTH_POS.clone().negate().normalize();
  const earth = layer.add(surface(new THREE.SphereGeometry(6.371, 128, 96), EARTH_FRAG, { uSun: { value: sun }, uTime: U.time }));
  layer.add(surface(new THREE.SphereGeometry(6.371 * 1.035, 96, 64), ATMO_FRAG, { uSun: { value: sun } }, { side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), EARTH_AXIS), spin = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  // The Moon where it is today (mean longitude), and its orbit.
  const moonPos = ecliptic(lonNow(218.316, 27.321661), 0, 384.4);
  const moon = layer.add(surface(new THREE.SphereGeometry(1.737, 64, 48), MOON_FRAG, { uSun: { value: sun } }));
  moon.position.copy(moonPos);
  const ring = [];
  for (let i = 0; i < 256; i++) ring.push(ecliptic((i / 256) * 360, 0, 384.4));
  const orbit = layer.add(loop(ring, '#8aa0ff'), 0.16);
  // Once they shrink to specks, a point of light keeps each one in sight.
  const dots = new Cloud(2);
  dots.push(0, 0, 0, C('#6fb6ff'), 8, 1);
  dots.pushV(moonPos, C('#d6d2e4'), 5.5, 0.8);
  const marks = layer.add(points(dots, { atten: 0, min: 1, max: 10 }));
  layer.tick = (t, z) => {
    earth.quaternion.copy(align).multiply(spin.setFromAxisAngle(Y, t * 0.02));
    fadeOpacity(orbit.material, orbitFade(384.4e6, z));
    fadeOpacity(marks.material, smooth(7.7, 8.3, z));
  };
  layer.label('Earth', EARTH_AXIS.clone().multiplyScalar(8.4), { zr: [6, 9.6] });
  layer.label('The Moon', moonPos.clone().add(new THREE.Vector3(0, 2.4, 0)), { zr: [8.2, 10.4] });
}

function buildSolar(layer) {
  const v = new THREE.Vector3();
  const sun = new Cloud(2);
  sun.push(0, 0, 0, C('#fff1d0'), 28, 1);
  sun.push(0, 0, 0, C('#ff9a52'), 90, 0.22);
  layer.add(points(sun, { atten: 0, min: 1, max: 120 }));
  const pl = new Cloud(PLANETS.length), orbits = [];
  for (const [name, a, l0, period, hex, px] of PLANETS) {
    ecliptic(lonNow(l0, period), 0, a, v);
    pl.pushV(v, C(hex), px, 1);
    const inner = a < 2;
    layer.label(name, v.clone(), { zr: inner ? [10, 12.5] : [11.7, 14.4] });
    const ring = [];
    for (let i = 0; i < 256; i++) ring.push(ecliptic((i / 256) * 360, 0, a));
    orbits.push([layer.add(loop(ring, hex), 0.13).material, a * AU]);
  }
  layer.tick = (t, z) => { for (const [m, r] of orbits) fadeOpacity(m, orbitFade(r, z)); };
  layer.add(points(pl, { atten: 0, min: 1, max: 10 }));
  // The Kuiper belt and Voyager 1 (about 170 AU out, toward Ophiuchus).
  const r = rng(5), kb = new Cloud(7001), blue = C('#9fb6ff');
  for (let i = 0; i < 7000; i++) kb.pushV(ecliptic(r() * 360, gauss(r) * 4, 30 + 20 * Math.pow(r(), 0.7), v), blue, 1.6, 0.18 + 0.2 * r());
  equatorial(17.2, 12.0, 170, v);
  kb.pushV(v, C('#ffffff'), 3, 1);
  layer.label('Voyager 1', v.clone(), { zr: [12.3, 14.6] });
  layer.add(points(kb, { atten: 0, min: 0.6, max: 4 }));
  layer.label('The Sun', new THREE.Vector3(0, 0, 0), { zr: [10.5, 15], cls: 'you' });
}

function buildOort(layer) {
  const r = rng(9), c = new Cloud(22000), col = C('#a9c4ff');
  for (let i = 0; i < 22000; i++) {
    const d = Math.pow(10, 3.3 + 1.7 * r()), u = 2 * r() - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    c.push(s * Math.cos(a) * d, u * d, s * Math.sin(a) * d, col, 1.8, 0.1 + 0.15 * r());
  }
  layer.add(points(c, { atten: 0, min: 0.6, max: 3 }));
}

function buildStars(layer) {
  const r = rng(7), c = new Cloud(48000), v = new THREE.Vector3();
  const lumOf = () => (r() < 0.012 ? 3 + 7 * r() : Math.pow(10, -3 * r()));
  for (let i = 0; i < 3600; i++) {   // the real density around the Sun: a few thousand stars within 60 ly
    const d = 60 * Math.cbrt(r()), u = 2 * r() - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), lum = lumOf();
    if (d < 4) continue;
    c.push(s * Math.cos(a) * d, u * d, s * Math.sin(a) * d, C(lum > 2.5 ? '#9fb8ff' : starColour(lum)), 2.4, lum);
  }
  for (let i = 0; i < 42000; i++) {   // the disc beyond, thinning above and below it
    const d = 60 + 2500 * Math.sqrt(r()), a = r() * Math.PI * 2, lum = lumOf();
    c.push(Math.cos(a) * d, gauss(r) * 350, Math.sin(a) * d, C(lum > 2.5 ? '#9fb8ff' : starColour(lum)), 2.4, lum);
  }
  for (const [name, ra, dec, dist, hex, lum] of NAMED) {
    equatorial(ra, dec, dist, v);
    c.pushV(v, C(hex), 3, lum);
    layer.label(name, v.clone(), { zr: dist < 20 ? [15.7, 17.9] : dist < 100 ? [16.4, 18.7] : [17.4, 19.7], cls: 'star' });
  }
  c.push(0, 0, 0, C('#fff1c4'), 3, 1.5);
  layer.label('The Sun', new THREE.Vector3(0, 0, 0), { zr: [15.4, 19.4], cls: 'you' });
  const pts = layer.add(points(c, { atten: 1, bright: 6, min: 0.6, max: 6, twinkle: 0.08 }));
  layer.tick = (t, z) => fadeOpacity(pts.material, recede(1500 * LY, z));
}

// A barred spiral like ours, in thousands of light-years. The Sun sits 26 kly
// out at azimuth π, between the Sagittarius and Perseus arms, on the Orion Spur.
function spiral(c, r, n, { scale = 1, arms = 4, place = (x, y, z) => [x, y, z], tint = 1 } = {}) {
  const B = 0.2126, PHI = Math.PI - Math.log(21 / 4) / B, BAR = 27 * DEG;
  const amber = C('#ffcf8a'), amber2 = C('#ff9f5a'), blue = C('#9fc4ff'), blue2 = C('#d6e4ff'), hii = C('#ff5fa8'), old = C('#fff0dc'), disc = C('#ffe6c8');
  const put = (x, y, z, col, size, lum) => { const [X, Y, Z] = place(x * scale, y * scale, z * scale); c.push(X, Y, Z, col, size, lum * tint); };
  for (let i = 0; i < n; i++) {
    const k = r();
    if (k < 0.16) {   // bulge
      const x = gauss(r) * 3.2, z = gauss(r) * 2.2;
      put(x * Math.cos(BAR) - z * Math.sin(BAR), gauss(r) * 1.6, x * Math.sin(BAR) + z * Math.cos(BAR), mix(amber, amber2, r()), 2, 0.25 + 0.3 * r());
    } else if (k < 0.24) {   // bar
      const t = (r() * 2 - 1) * 14, w = gauss(r) * 1.4;
      put(Math.cos(BAR) * t - Math.sin(BAR) * w, gauss(r) * 0.8, Math.sin(BAR) * t + Math.cos(BAR) * w, mix(amber, old, r()), 2, 0.3);
    } else if (k < 0.84) {   // arms: two major, two minor
      const q = r(), arm = arms === 2 ? (q < 0.5 ? 0 : 2) : q < 0.32 ? 0 : q < 0.5 ? 1 : q < 0.82 ? 2 : 3;
      const t = Math.pow(r(), 0.85), th = PHI + (arm * Math.PI) / 2 + t * 12.3, rad = 4 * Math.exp(B * t * 12.3), w = 0.6 + 0.07 * rad;
      const x = rad * Math.cos(th) + gauss(r) * w, z = rad * Math.sin(th) + gauss(r) * w, y = gauss(r) * 0.3 * (0.5 + Math.exp(-rad / 20));
      const h = r();
      if (h < 0.035) put(x, y, z, hii, 3.2, 1.4);
      else if (h < 0.45) put(x, y, z, mix(blue, blue2, r()), 2.2, 0.4 + 0.3 * r());
      else put(x, y, z, old, 2, 0.22);
    } else if (k < 0.87 && arms === 4) {   // the Orion Spur, where the Sun lives
      const th = Math.PI + (r() - 0.5) * 0.9, rad = 26 - (th - Math.PI) * 5 + gauss(r) * 0.5;
      put(rad * Math.cos(th) + gauss(r) * 0.5, gauss(r) * 0.25, rad * Math.sin(th) + gauss(r) * 0.5, mix(blue, blue2, r()), 2.2, 0.4);
    } else {   // the old disc
      const rad = -10.5 * Math.log(1 - r() * 0.98), th = r() * Math.PI * 2;
      put(rad * Math.cos(th), gauss(r) * 0.35, rad * Math.sin(th), disc, 2, 0.18);
    }
  }
}

function buildGalaxy(layer) {
  const r = rng(11), c = new Cloud(240002);
  spiral(c, r, 240000);
  c.push(0, 0, 0, C('#ffcf8a'), 60, 0.2);
  const stars = layer.add(points(c, { atten: 0.25, bright: 6, min: 0.6, max: 60 }), 0.32);
  layer.tick = (t, z) => fadeOpacity(stars.material, recede(50 * KLY, z));
  layer.label('You are here', new THREE.Vector3(-26, 0, 0), { zr: [19.6, 23.4], cls: 'you' });
  layer.label('Sagittarius A*', new THREE.Vector3(0, 0, 0), { zr: [19.8, 21.6] });
}

function buildLocal(layer) {
  const r = rng(13), c = new Cloud(70000), Y = new THREE.Vector3(0, 1, 0);
  const galaxy = (center, incl, radiusMly, n, arms = 4) => {
    const s = center.clone().normalize(), perp = new THREE.Vector3().crossVectors(s, Y).normalize();
    const normal = s.clone().multiplyScalar(Math.cos(incl * DEG)).addScaledVector(perp, Math.sin(incl * DEG)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(Y, normal), v = new THREE.Vector3();
    spiral(c, r, n, { scale: radiusMly / 50, arms, place: (x, y, z) => { v.set(x, y, z).applyQuaternion(q).add(center); return [v.x, v.y, v.z]; } });
  };
  const blob = (center, size, n, hex) => { const col = C(hex); for (let i = 0; i < n; i++) c.push(center.x + gauss(r) * size, center.y + gauss(r) * size * 0.6, center.z + gauss(r) * size, col, 2, 0.35 + 0.3 * r()); };
  const m31 = galactic(121.17, -21.57, 2.537), m33 = galactic(133.61, -31.33, 2.73);
  const lmc = galactic(280.47, -32.89, 0.163), smc = galactic(302.8, -44.3, 0.204);
  galaxy(m31, 77, 0.07, 36000);
  galaxy(m33, 55, 0.03, 10000, 2);
  blob(lmc, 0.005, 5000, '#cfe0ff');
  blob(smc, 0.0025, 3000, '#d6e4ff');
  const v = new THREE.Vector3();
  for (let i = 0; i < 50; i++) {   // dwarf satellites around both big spirals
    const host = i < 30 ? new THREE.Vector3() : m31, d = 0.05 + 0.6 * r(), u = 2 * r() - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    v.set(s * Math.cos(a) * d, u * d, s * Math.sin(a) * d).add(host);
    blob(v, 0.003 + 0.004 * r(), 120, i % 2 ? '#ffd9b0' : '#cdb8ff');
  }
  const pts = layer.add(points(c, { atten: 0.25, bright: 6, min: 0.6, max: 8 }), 0.7);
  layer.tick = (t, z) => fadeOpacity(pts.material, recede(0.07 * MLY, z, 0.02));
  layer.label('Milky Way', new THREE.Vector3(0, 0.06, 0), { zr: [22.1, 24.3], cls: 'you' });
  layer.label('Andromeda', m31.clone(), { zr: [22.1, 24.3] });
  layer.label('Triangulum', m33.clone(), { zr: [22.1, 23.6] });
  layer.label('Large Magellanic Cloud', lmc.clone(), { zr: [21.9, 22.4] });
  layer.label('Small Magellanic Cloud', smc.clone(), { zr: [21.9, 22.4] });
}

// The cosmic web: clusters joined to their nearest neighbours by filaments.
function web(c, r, { nodes, radius, k, scatter, perGly, nodePts, colours, nodeCol, lum }) {
  const N = [];
  for (let i = 0; i < nodes; i++) {
    const d = radius * Math.cbrt(r()), u = 2 * r() - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    N.push([s * Math.cos(a) * d, u * d, s * Math.sin(a) * d]);
  }
  const seen = new Set(), best = new Array(k);
  for (let i = 0; i < nodes; i++) {
    best.fill(null);
    const [x, y, z] = N[i];
    for (let j = 0; j < nodes; j++) {
      if (j === i) continue;
      const dx = N[j][0] - x, dy = N[j][1] - y, dz = N[j][2] - z, dd = dx * dx + dy * dy + dz * dz;
      for (let m = 0; m < k; m++) if (!best[m] || dd < best[m][1]) { best.splice(m, 0, [j, dd]); best.length = k; break; }
    }
    for (const b of best) {
      if (!b) continue;
      const key = Math.min(i, b[0]) * nodes + Math.max(i, b[0]);
      if (seen.has(key)) continue;
      seen.add(key);
      const [X, Y, Z] = N[b[0]], len = Math.sqrt(b[1]), count = Math.min(500, Math.ceil(len * perGly));
      for (let q = 0; q < count; q++) {
        const t = r(), col = mix(colours[0], colours[1], r());
        c.push(x + (X - x) * t + gauss(r) * scatter, y + (Y - y) * t + gauss(r) * scatter, z + (Z - z) * t + gauss(r) * scatter, col, 2, lum * (0.6 + 0.8 * r()));
      }
    }
    for (let q = 0; q < nodePts; q++) c.push(x + gauss(r) * scatter * 1.6, y + gauss(r) * scatter * 1.6, z + gauss(r) * scatter * 1.6, nodeCol, 2.2, lum * 2.2);
  }
}
function buildWeb(layer) {
  const r = rng(17), violet = [C('#7b5cff'), C('#c06bff')], indigo = [C('#4f46ff'), C('#9a5cff')];
  const near = new Cloud(200000);
  web(near, r, { nodes: 1300, radius: 1.3, k: 3, scatter: 0.012, perGly: 200, nodePts: 20, colours: violet, nodeCol: C('#ffc2e6'), lum: 0.35 });
  const nearPts = layer.add(points(near, { atten: 0.25, bright: 6, min: 0.6, max: 5 }), 0.8);
  layer.tick = (t, z) => fadeOpacity(nearPts.material, recede(1.3 * GLY, z, 0.03));
  const far = new Cloud(240000);
  web(far, r, { nodes: 2600, radius: 46.5, k: 3, scatter: 0.35, perGly: 3.5, nodePts: 12, colours: indigo, nodeCol: C('#ff9fd0'), lum: 0.3 });
  const haze = C('#5a3cc8');
  for (let i = 0; i < 60000; i++) {
    const d = 46.5 * Math.cbrt(r()), u = 2 * r() - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    far.push(s * Math.cos(a) * d, u * d, s * Math.sin(a) * d, haze, 2, 0.08);
  }
  layer.add(points(far, { atten: 0.25, bright: 6, min: 0.6, max: 5 }), 0.8);
  layer.label('Virgo Cluster', galactic(283.8, 74.5, 0.054), { zr: [23.7, 25.2] });
  layer.label('Laniakea', galactic(307, 9, 0.25), { zr: [24.0, 25.6] });
  layer.label('You', new THREE.Vector3(0, 0, 0), { zr: [24.6, 27.5], cls: 'you' });
}

function buildEdge(layer) {
  // Both faces: from inside, the oldest light is all around you, so the view passes
  // through it on the way out instead of it appearing at once.
  layer.add(surface(new THREE.SphereGeometry(46.5, 128, 64), CMB_FRAG, {}, { blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  layer.label('The oldest light: 13.8 billion years old', new THREE.Vector3(0, 46.5 * 1.04, 0), { zr: [25.9, 28] });
}
