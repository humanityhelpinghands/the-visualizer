// Everything in the room around the core: sky, floor, strings, spectrum wall, halo.
// All of it is lit from the mood's colour world (uRamp + uAccent, see glsl.js).
import * as THREE from 'three';
import { VALUE_NOISE, RAMP } from './glsl.js';

// Shared, live-updated colour uniforms. uColA/B/C are kept as simple aliases
// (deep tone, bright tone, accent) for anything that wants just three.
const palette = () => ({
  uRamp: { value: [0, 1, 2, 3, 4].map(() => new THREE.Color()) },
  uAccent: { value: new THREE.Color() },
  uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() }, uColC: { value: new THREE.Color() },
});

// ── Sky: a big sphere that rides with the camera. A graded gradient, a
// domain-warped nebula in the mood's tones, and weather that carries feeling:
// rain (sadness), rising embers (anger, desire), aurora (hope, joy, calm,
// mystery) and low warm haze (nostalgia, loneliness, love).
// Blender's renders (tools/blender/fx.py, nebula.py): greyscale maps of light and matter,
// coloured live by the shaders. Atlases skip mipmaps (their frames would bleed together).
function fxTexture(name, onLoad, { atlas = false, mirror = false } = {}) {
  new THREE.TextureLoader().load('assets/textures/' + name, (t) => {
    t.colorSpace = THREE.NoColorSpace;
    if (atlas) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
    if (mirror) { t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; }
    onLoad(t);
  });
}

export function makeSky(pal) {
  const uniforms = {
    uTime: { value: 0 }, uEnergy: { value: 0 }, uLow: { value: 0 }, uMid: { value: 0 }, uFlash: { value: 0 }, uKick: { value: 0 }, uBolt: { value: 0 }, uBoltDir: { value: new THREE.Vector2(1, 0) },
    uFx: { value: new THREE.Vector4() },  // rain, embers, aurora, haze
    uStarCut: { value: 0.987 }, uHat: { value: 0 }, uShootT: { value: -99 }, uShootA: { value: new THREE.Vector3(1, 0.3, 0) }, uShootB: { value: new THREE.Vector3(0, 0.5, 1) }, uArc: { value: 0 }, uEmberT: { value: 0 },           // how full the night is (the feelings: loneliness empties it)
    uNeb: { value: null }, uNebOn: { value: 0 }, uNoise: { value: null },
    uNeb2: { value: null }, uNebMix: { value: 0 },   // another nebula fading in (nebula() below)
    uNebBase: { value: null },   // the locked nebula, always (the floor's dust: the variants' bands and pillars laid flat read as streaks)
    uBoltTex: { value: null }, uBoltI: { value: 0 }, uGal: { value: null }, uGalOn: { value: 0 },   // Blender's lightning strikes and spiral galaxy   // the nebula's gas, rendered in Blender's Cycles (tools/blender/nebula.py)
    ...pal,
  };
  // The nebula and its variants (nebula.py's NEB_STYLE): the locked one every song opens on,
  // then a river of gas round the horizon, then towering pillars of it.
  const nebs = [];
  ['nebula.png', 'nebula-band.png', 'nebula-pillars.png'].forEach((file, i) => new THREE.TextureLoader().load('assets/textures/' + file, (t) => {
    t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.wrapS = THREE.RepeatWrapping;
    nebs[i] = t;
    if (i === 0) { uniforms.uNeb.value = t; uniforms.uNebBase.value = t; uniforms.uNebOn.value = 1; }
  }));
  fxTexture('bolt.png', (t) => { uniforms.uBoltTex.value = t; }, { atlas: true });
  fxTexture('galaxy.png', (t) => { uniforms.uGal.value = t; uniforms.uGalOn.value = 1; });
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uEnergy, uLow, uMid, uFlash, uKick, uBolt;
      uniform vec2 uBoltDir;
      uniform vec4 uFx;
      uniform float uStarCut, uArc, uEmberT, uNebOn, uBoltI, uGalOn, uNebMix;
      uniform sampler2D uNeb, uNeb2, uBoltTex, uGal, uNoise;
      varying vec3 vDir;
      ${RAMP}
      ${VALUE_NOISE}
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      // Points of light on the night (stars, dust, rain) lean pink: a small red point on the blue reads orange.
      vec3 pinkPoint(vec3 c){ c.b = max(c.b, 0.45 * c.r); c.g = min(c.g, c.b); return c; }
      uniform float uHat, uShootT;
      uniform vec3 uShootA, uShootB;
      void main(){
        vec3 d = normalize(vDir);
        float up = d.y * 0.5 + 0.5;
        float az = atan(d.z, d.x);
        // Graded gradient: zenith in the deepest tone, horizon a step lighter.
        vec3 col = mix(uRamp[1] * 0.3, uRamp[0] * 0.6, smoothstep(0.5, 1.0, up));
        // Deep below the horizon the floor hides the sky: no noise is paid for there.
        if (d.y < -0.42) { gl_FragColor = vec4(col * 0.15, 1.0); return; }
        // ...nor where the glass floor (4.2 below the core, opaque out to 70 units) covers it.
        if (d.y < 0.0 && cameraPosition.y > -4.2) { vec2 hit = cameraPosition.xz + d.xz * ((cameraPosition.y + 4.2) / -d.y); if (dot(hit, hit) < 3600.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; } }
        // Nebula: a body in the mid tones, filaments in the bright tones and the accent.
        vec2 nn = texture2D(uNoise, vec2(az / 6.28318 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.14159 + 0.5)).rg;   // (baked: see bake())
        float n1 = nn.x, n2 = nn.y;
        col += glow(0.3 + 0.45 * n2) * 0.06 * smoothstep(0.38, 0.95, n2) * (0.6 + 0.4 * uEnergy);
        float fil = pow(smoothstep(0.6, 1.0, n2), 3.0) * (0.4 + 0.6 * uEnergy + 0.4 * uLow + 0.9 * uMid) * (1.0 + 0.6 * uArc);   // the melody lights the nebula; a part climbing lights it more
        col += mix(glow(0.85), glowOf(uAccent, 0.9), smoothstep(0.7, 0.9, n1)) * 0.28 * fil;
        // The rendered nebula: real volumetric gas from Cycles (billows, wisps, dark lanes),
        // turning with the far universe, coloured live in the song's own tones: its body in
        // the deep tones, its brightest folds in the accent. The melody and the energy light it.
        if (uNebOn > 0.5) {
          float ra = uTime * 0.004, cr = cos(ra), sr = sin(ra);
          vec3 rd = vec3(cr * d.x - sr * d.z, d.y, sr * d.x + cr * d.z);
          vec2 nuv = vec2(atan(rd.z, rd.x) / 6.28318 + 0.5, asin(clamp(rd.y, -1.0, 1.0)) / 3.14159 + 0.5);
          float neb = texture2D(uNeb, nuv).r;
          if (uNebMix > 0.0) neb = mix(neb, texture2D(uNeb2, nuv).r, uNebMix);   // (a new sky fading in)
          float gas = smoothstep(0.26, 0.7, neb);
          vec3 gc = mix(glow(0.32), glowOf(uAccent, 0.85), gas * gas);
          col += gc * gas * 0.5 * (0.6 + 0.35 * uEnergy + 0.5 * uMid + 0.3 * uArc);
        }
        float horizon = pow(max(0.0, 1.0 - abs(d.y)), 10.0);
        col += glow(0.6) * horizon * (0.08 + 0.14 * uLow);

        // Aurora: slow curtains above the horizon.
        if (uFx.z > 0.01 && d.y > 0.08 && d.y < 0.75) {
          float band = smoothstep(0.08, 0.3, d.y) * smoothstep(0.75, 0.35, d.y);
          float curtain = fbm(vec3(az * 3.0, d.y * 2.0 - uTime * 0.05, uTime * 0.03));
          float rays = pow(0.5 + 0.5 * sin(az * 40.0 + curtain * 9.0 + uTime * 0.2), 12.0);   // thin threads of light, not a soft curtain of haze
          vec3 ac = mix(glow(0.75), glowOf(uAccent, 0.85), smoothstep(0.3, 0.8, curtain));
          col += ac * band * rays * curtain * 0.5 * uFx.z * (0.6 + 0.6 * uEnergy);
        }
        // Haze: low glowing fog, like light through a dirty window.
        if (uFx.w > 0.01 && d.y < 0.45) {   // (above that the fog has faded to nothing)
          float fog = exp(-max(0.0, d.y + 0.05) * 9.0) * (0.6 + 0.4 * fbm(vec3(az * 2.0, uTime * 0.04, 1.0)));
          col += glow(0.7) * fog * 0.1 * uFx.w * (1.0 + 0.5 * uLow);
        }
        // Rain: thin falling streaks, cold and endless.
        if (uFx.x > 0.01) {
          vec2 g = vec2(az * 180.0, d.y * 7.0 + uTime * 1.6);
          vec2 id = floor(g);
          float r = h21(vec2(id.x, 0.0));
          float y = fract(g.y + r * 13.0);
          float streak = step(0.82, r) * smoothstep(0.0, 0.15, y) * smoothstep(0.55, 0.15, y) * smoothstep(0.45, 0.0, abs(fract(g.x) - 0.5));
          col += pinkPoint(glow(0.9)) * streak * 0.16 * uFx.x * smoothstep(-0.2, 0.3, d.y);
        }
        // (Embers, sparks painted on the sky low behind the core, were taken out: flat specks, no feeling.)
        // Depth: the far universe, turning slowly behind everything. A faint band of a
        // galaxy across the sky (its dust lane dark through the middle), a dust of
        // countless far stars, and now and then a near star with a soft glint.
        float ta = uTime * 0.004, ct = cos(ta), st = sin(ta);
        vec3 sd = vec3(ct * d.x - st * d.z, d.y, st * d.x + ct * d.z);
        // A spiral galaxy (rendered in Cycles), far up in the sky, seen tilted, turning with
        // the far universe and very slowly on its own axis; it glows with the song's energy.
        if (uGalOn > 0.5) {
          vec3 gD = normalize(vec3(-0.5, 0.62, 0.62));
          float gf = dot(sd, gD);
          if (gf > 0.9) {
            vec3 t1 = normalize(cross(gD, vec3(0.0, 1.0, 0.0))), t2 = cross(t1, gD);
            vec2 gp = vec2(dot(sd, t1), dot(sd, t2) / 0.55) / 0.2;          // tilted: an ellipse, about 23 degrees across
            float ga = uTime * 0.01, gc = cos(ga), gs = sin(ga);
            gp = vec2(gc * gp.x - gs * gp.y, gs * gp.x + gc * gp.y);
            vec2 guv = gp * 0.5 + 0.5;
            if (all(greaterThan(guv, vec2(0.0))) && all(lessThan(guv, vec2(1.0)))) {
              float g = texture2D(uGal, guv).r;
              col += mix(glow(0.45), glowOf(uAccent, 0.9), g * g) * g * 0.3 * (0.7 + 0.4 * uEnergy + 0.3 * uMid);
            }
          }
        }
        vec3 bandN = normalize(vec3(0.35, 1.0, 0.25));
        float bandD = dot(sd, bandN);
        float gb = exp(-bandD * bandD * 28.0), lb = exp(-bandD * bandD * 260.0);   // (the noise only where the band shows)
        float galaxy = gb > 0.003 ? gb * (0.55 + 0.45 * fbm(sd * 4.0)) : 0.0;
        float lane = lb > 0.003 ? 1.0 - 0.75 * lb * smoothstep(0.35, 0.7, fbm(sd * 7.0 + 3.0)) : 1.0;
        col += glow(0.55) * galaxy * lane * 0.035;
        vec3 fg = sd * 420.0, fid = floor(fg);
        float fr = hash13(fid);
        col += pinkPoint(glow(0.9)) * smoothstep(0.985 - 0.02 * galaxy, 0.99, fr) * smoothstep(0.5, 0.0, length(fract(fg) - 0.5)) * 0.35 * (0.4 + galaxy);
        vec3 ng = sd * 38.0, nid = floor(ng);
        float nr = hash13(nid);
        vec3 nf = fract(ng) - 0.5;
        float near = step(0.992, nr) * (exp(-dot(nf, nf) * 90.0) + 0.25 * exp(-abs(nf.x) * 60.0 - abs(nf.y) * 6.0) + 0.25 * exp(-abs(nf.y) * 60.0 - abs(nf.x) * 6.0));
        col += pinkPoint(glow(1.0)) * near * 0.5 * (0.8 + 0.2 * sin(uTime * 0.7 + nr * 50.0));
        // Stars wear the highlight tone.
        vec3 g = sd * 170.0;
        vec3 id = floor(g);
        float r = hash13(id);
        float star = smoothstep(uStarCut, uStarCut + 0.002, r) * smoothstep(0.42, 0.0, length(fract(g) - 0.5));
        star *= 0.55 + 0.45 * sin(uTime * (2.0 + r * 5.0) + r * 80.0);
        col += pinkPoint(glow(1.0)) * star * (0.75 + uFlash * 3.0 + uHat * step(0.5, fract(r * 37.0)) * 1.6) * (1.0 - 0.6 * uFx.x);
        // A shooting star (rare: see visuals.js): a bright head with a fading tail, across the sky in under a second.
        float sa = uTime - uShootT;
        if (sa > 0.0 && sa < 1.1) {
          float p = sa / 0.9;
          vec3 head = normalize(mix(uShootA, uShootB, min(p, 1.0))), tail = normalize(mix(uShootA, uShootB, max(p - 0.22, 0.0)));
          vec3 ab = head - tail; float tt = clamp(dot(d - tail, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
          float dist = length(d - (tail + ab * tt));
          col += pinkPoint(glow(1.0)) * 4.5 * tt * exp(-dist * dist * 1.5e5) * (1.0 - smoothstep(0.85, 1.1, sa));
        }
        // Lightning: a stretch of the far horizon flickers cold white-blue, from one side.
        if (uBolt > 0.01) {
          float side = dot(normalize(d.xz + 1e-4), uBoltDir);
          col += vec3(0.42, 0.58, 1.0) * uBolt * smoothstep(0.2, 1.0, side) * smoothstep(0.5, 0.02, d.y) * smoothstep(-0.12, 0.02, d.y) * 0.5;
          // the strike itself (one of four branching bolts grown in Blender), from the sky to the horizon
          float bAz = atan(uBoltDir.y, uBoltDir.x), dz = az - bAz;
          dz = dz - 6.28318 * floor((dz + 3.14159) / 6.28318);
          vec2 bu = vec2(dz / 0.11 * 0.5 + 0.5, (d.y + 0.02) / 0.42);   // a tall narrow strike, about 12 degrees wide
          if (bu.x > 0.0 && bu.x < 1.0 && bu.y > 0.0 && bu.y < 1.0) {
            float cx = mod(uBoltI, 2.0), cy = floor(uBoltI / 2.0);
            vec2 auv = vec2((cx + bu.x) * 0.5, 1.0 - (cy + 1.0 - bu.y) * 0.5);
            float b = texture2D(uBoltTex, auv).r * smoothstep(0.0, 0.08, bu.x) * smoothstep(1.0, 0.92, bu.x);
            col += vec3(0.75, 0.86, 1.0) * b * b * uBolt * 1.2;   // (squared: a sharp channel, its halo kept soft)
          }
        }
        col *= 1.0 - smoothstep(-0.05, -0.4, d.y) * 0.85;   // ground darkens the lower sky
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 32), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  // The nebula's two noise fields are soft and drift slowly, yet cost 80 hashes a pixel
  // over the whole screen (the sky was half the scene's draw). They're baked each frame
  // into a small map of the whole sky (1024x512, a ninth of the pixels) and looked up.
  const rt = new THREE.WebGLRenderTarget(1024, 512, { type: THREE.HalfFloatType, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
  rt.texture.wrapS = THREE.RepeatWrapping;
  uniforms.uNoise.value = rt.texture;
  const bakeU = { uTime: uniforms.uTime };
  const bakeScene = new THREE.Scene(), bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  bakeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: bakeU, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      ${VALUE_NOISE}
      void main(){
        float lon = (vUv.x - 0.5) * 6.28318, lat = (vUv.y - 0.5) * 3.14159;
        vec3 d = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
        float n1 = fbm(d * 2.1 + vec3(0.0, uTime * 0.015, 0.0));
        float n2 = fbm(d * 3.7 + n1 * 1.9 + vec3(uTime * 0.02, 0.0, 0.0));
        gl_FragColor = vec4(n1, n2, 0.0, 1.0);
      }`,
  })));
  let bakedT = -1;
  function bake(renderer) {
    if (Math.abs(uniforms.uTime.value - bakedT) < 1 / 30) return;   // (it drifts slowly: 30 bakes a second is plenty)
    bakedT = uniforms.uTime.value;
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(rt); renderer.render(bakeScene, bakeCam); renderer.setRenderTarget(was);
  }
  // A new sky: the nebula `i` fades in over six seconds (the room answers slowly), or at
  // once (snap: a new song opens on the locked one). One not loaded yet is skipped.
  let fade = null;
  const settle = () => { if (fade) { uniforms.uNeb.value = fade.to; uniforms.uNebMix.value = 0; fade = null; } };
  function nebula(i, snap = false) {
    const to = nebs[i];
    if (!to) return;
    settle();
    if (to === uniforms.uNeb.value) return;
    if (snap) { uniforms.uNeb.value = to; return; }
    uniforms.uNeb2.value = to; fade = { to, p: 0 };
  }
  function nebulaStep(dt) {
    if (!fade) return;
    fade.p = Math.min(1, fade.p + dt / 6);
    uniforms.uNebMix.value = fade.p * fade.p * (3 - 2 * fade.p);
    if (fade.p >= 1) settle();
  }
  return { mesh, uniforms, bake, nebula, nebulaStep };
}

// ── Floor: neon grid. Every kick drops a shockwave ring that rolls outward.
export const RIPPLES = 16;
export const RIPPLE_LIFE = 8;   // seconds a ring rolls on (well past the bars, where it has faded to nothing)
// One ring like a real one: it keeps travelling, lower and wider as it spreads over a bigger
// circle, and fades away slowly. Height and slope come out of the same pass (the slope gives
// the glass its smooth shading), so a ring costs one loop, not three.
const WAVES_GLSL = /* glsl */ `
  // tanh that can't overflow: Windows' graphics layer builds tanh from exp(2x), which turns into
  // Inf/Inf = NaN past x ~ 44, and a NaN vertex drops its triangles out as black blocks.
  float stanh(float x){ float e = exp(2.0 * clamp(x, -9.0, 9.0)); return (e - 1.0) / (e + 1.0); }
  vec2 waves(float d){
    float h = 0.0, s = 0.0, edge = smoothstep(0.0, 4.0, d);
    for (int i = 0; i < ${RIPPLES}; i++){
      float age = uTime - uRipT[i];
      if (age < 0.0 || age > ${RIPPLE_LIFE}.0) continue;
      // Inside the ring of bars a wave rolls out tall and strong (rising toward the core);
      // past the bars it runs out of room: lower, wider, fading into the dark.
      float front = age * 14.0, x = d - front, past = max(d - 25.0, 0.0), k = 0.18 / (1.0 + past * 0.04);
      float g = uRipA[i] * 1.5 * exp(-age * 0.12) * exp(-past * 0.07) * exp(-x * x * k) * smoothstep(${RIPPLE_LIFE}.0, ${RIPPLE_LIFE}.0 - 2.0, age);
      h += g; s -= g * 2.0 * k * x;
    }
    return vec2(h, s) * edge;
  }
  // How high the surface really stands at world point w0 (the floor and the strings riding it share
  // this, so the grid never parts from the liquid): a soft ceiling of 3, flattened right by the
  // camera, settled at the ring of bars, and kept below a low camera's eye line, softly and only
  // near the camera (it was a hard cut across the whole floor that moved with the camera's sway:
  // crests sliced flat into blocks, the flat tops trembling, the strings tearing off them).
  float rideH(float h, float d, vec3 w0){
    h = 3.0 * stanh(h / 3.0);
    vec3 toCam = w0 - cameraPosition;
    h *= smoothstep(3.0, 13.0, length(toCam));
    float lim = max(abs(toCam.y) - 1.2, 0.0) * 0.5, near = 1.0 - smoothstep(8.0, 18.0, length(toCam.xz));
    if (h > 0.0 && near > 0.0) h = mix(h, lim * stanh(h / max(lim, 0.05)), near);
    return h * (1.0 - 0.85 * exp(-(d - 25.0) * (d - 25.0) * 0.12));
  }`;
export function makeFloor(pal) {
  const uniforms = {
    uTime: { value: 0 }, uRipT: { value: new Array(RIPPLES).fill(-100) }, uRipA: { value: new Array(RIPPLES).fill(0) },
    uLow: { value: 0 }, uEnergy: { value: 0 }, uHeart: { value: 0.8 }, uVoid: { value: 0 }, uWob: { value: 0 }, uBend: { value: 0 },
    // The black mirror (2026-11-05, beside the grid, never over it): 0 is the grid as it was; 1 is the still black liquid,
    // the fine grid gone, a whisper of the coarse one, and each ripple's rings caught as light on the surface (visuals.js eases it).
    uMirror: { value: 0 },
    // The backbeat's bands of light (makeStrings rings them; they sweep through this grid).
    uPluck: { value: new Array(8).fill(0) }, uPluckT: { value: new Array(8).fill(-100) }, uPluckCol: { value: new THREE.Color() }, uPluckK: { value: 0 },
    // The core's light on the floor (visuals.js): its colour and strength, and the wall's.
    uCoreCol: { value: new THREE.Color() }, uCoreLight: { value: 0 }, uWallCol: { value: new THREE.Color() }, uGridFlash: { value: 0 },
    uDrops: { value: Array.from({ length: 40 }, () => new THREE.Vector4(0, 0, -99, 0)) },
    // (the shader hears only the drops still ringing, packed first: visuals.js fills these from uDrops)
    uDropLive: { value: Array.from({ length: 40 }, () => new THREE.Vector4(0, 0, -99, 0)) }, uDropN: { value: 0 },
    uNeb: { value: null }, uNebOn: { value: 0 }, uNeb2: { value: null }, uNebMix: { value: 0 }, uNebBase: { value: null },   // the sky's nebula (visuals.js shares it): the glass mirrors it
    uCaus: { value: null }, uRip: { value: null }, uFxOn: { value: 0 },   // Blender's caustics and the raindrop's simulated ripple   // raindrops landing on the void: x, z, when, how hard
    ...pal,
  };
  // The void's floor reaches far past the wall and fades into black: it reads as endless.
  const geo = new THREE.PlaneGeometry(300, 300, 300, 300);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,   // (never writes depth: the core at its biggest dips past the floor and must stay whole)
      // (the underside: the other timeline's ceiling)
    vertexShader: /* glsl */ `
      uniform float uTime, uRipT[${RIPPLES}], uRipA[${RIPPLES}], uLow, uWob, uBend;
      varying vec3 vWorld; varying float vH; varying vec3 vN;
      ${WAVES_GLSL}
      void main(){
        vec3 p = position;
        float d = length(p.xz);
        vec2 hs = waves(d);
        // The womp's pump round the core (a speaker cone) and the whammy's dive and climb.
        float pump = uWob * 1.1 * exp(-(d - 10.0) * (d - 10.0) * 0.025), bendH = uBend * 1.6 * exp(-d * d * 0.005) * smoothstep(2.0, 7.0, d);
        float h = hs.x + pump + bendH;
        // The surface's slope, from the wave itself (smooth, unlike a triangle's facet).
        float th = stanh(h / 3.0), slope = (hs.y - pump * 0.05 * (d - 10.0) - bendH * 0.01 * d) * (1.0 - th * th);
        vec2 dr = p.xz / max(d, 1e-3);
        vN = normalize(vec3(-dr.x * slope, 1.0, -dr.y * slope));
        // A wave never rises into the core's light (a soft ceiling: a tall swell between
        // the camera and the core hid its lower half), and it lies down as it nears the
        // camera instead of washing through the lens.
        h = rideH(h, d, (modelMatrix * vec4(position, 1.0)).xyz);   // (up to 3 units: tall, never into the core or the lens)
        p.y += h;
        vH = h;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    // The grid is the void's own: drawn for every point of the floor (so it never ends
    // and costs nothing more however far it reaches), and liquid: a passing wave pushes
    // its lines outward and lights them, the crossings glow like nodes, and the
    // backbeat's bands of light sweep out through it.
    fragmentShader: /* glsl */ `
      uniform float uEnergy, uLow, uHeart, uVoid, uTime, uPluck[8], uPluckT[8], uPluckK;
      uniform vec3 uPluckCol, uCoreCol, uWallCol;
      uniform float uCoreLight, uGridFlash, uFxOn, uNebOn, uNebMix, uMirror;
      uniform vec4 uDropLive[40];
      uniform int uDropN;
      uniform sampler2D uCaus, uRip, uNeb, uNeb2, uNebBase;
      // The nebula at uv, with a new one fading in over it (the sky's nebula()).
      float nebAt(vec2 uv){ float n = texture2D(uNeb, uv).r; return uNebMix > 0.0 ? mix(n, texture2D(uNeb2, uv).r, uNebMix) : n; }
      // one frame of the ripple flipbook (4x4, frame 0 top-left), at local uv
      float ripAt(float i, vec2 uv){ float cx = mod(i, 4.0), cy = floor(i / 4.0); return texture2D(uRip, vec2((cx + uv.x) * 0.25, 1.0 - (cy + 1.0 - uv.y) * 0.25)).r; }
      varying vec3 vWorld; varying float vH; varying vec3 vN;
      ${RAMP}
      ${VALUE_NOISE}
      vec2 lines(vec2 p, float s){
        vec2 q = p / s;
        vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), 1e-4);
        return 1.0 - min(g, 1.0);
      }
      void main(){
        float d = length(vWorld.xz);
        if (d > 150.0) discard;   // (fully faded out there: no work for pixels nobody sees)
        vec2 dir = vWorld.xz / max(d, 1e-3);
        vec2 q = vWorld.xz - dir * vH * 1.4;   // the wave carries the grid with it
        vec2 c = lines(q, 10.0), f = uMirror < 0.99 ? lines(q, 2.0) : vec2(0.0);   // (the mirror has no fine grid: none drawn)
        // Lines packed too tight to read as lines (far off, or seen edge-on) fade away
        // instead of merging into a solid sheet of colour.
        vec2 wf = fwidth(q);
        float fineK = (1.0 - smoothstep(0.12, 0.45, max(wf.x, wf.y) / 2.0)) * (1.0 - uMirror), coarseK = 1.0 - smoothstep(0.12, 0.45, max(wf.x, wf.y) / 10.0);
        float fine = max(f.x, f.y) * fineK, coarse = max(c.x, c.y) * coarseK * (1.0 - 0.7 * uMirror), node = f.x * f.y * fineK + mix(1.5, 1.2, uMirror) * c.x * c.y * coarseK;
        float band = 0.0;
        for (int k = 0; k < 8; k++) {
          float age = uTime - uPluckT[k];
          if (age < 0.0 || age > 5.0) continue;
          float front = age * 22.0;
          band += uPluck[k] * exp(-age * 0.7) * exp(-(d - front) * (d - front) * 0.04);
        }
        vec3 col = uRamp[0] * 0.1;   // mostly black: the grid and the core's aura are its accents
        vec3 lineCol = mix(glow(0.5), glow(0.8), coarse);
        vec3 lit = mix(glowOf(uAccent, 0.95), glowOf(uPluckCol, 0.95), uPluckK * clamp(band * 2.0, 0.0, 1.0));
        lineCol = mix(lineCol, lit, clamp(abs(vH) * 0.9 + band, 0.0, 1.0));
        float l = dot(lineCol, vec3(0.2126, 0.7152, 0.0722));
        lineCol = max(mix(vec3(l), lineCol, 1.4), 0.0);
        // The floor is a still black liquid over deep space. Nothing under it moves on its
        // own: far stars and faint dust hang at different depths (the eye's ray goes on
        // through the surface, so deeper ones shift less as the camera moves), and a
        // passing ripple from the core bends them with its slope.
        vec3 v = normalize(vWorld - cameraPosition);
        vec2 bend = dir * vH * 0.6;
        vec2 thru = v.xz / max(-v.y, 0.12);
        vec2 sp = vWorld.xz + bend;
        float stars = 0.0;
        for (int k = 0; k < 3; k++) {
          if (d > 120.0) break;   // (past here the stars are under 3% and the floor is fading out)
          float depth = 4.0 + 10.0 * float(k), sc = 1.6 - 0.45 * float(k);
          vec2 g = (sp + thru * depth) * sc;
          vec2 id = floor(g);
          float r = hash13(vec3(id, float(k) * 7.1));
          if (r < 0.965) continue;   // (most cells hold no star: no jitter paid for them)
          vec2 f = fract(g) - 0.5 - (vec2(hash13(vec3(id, 3.3)), hash13(vec3(id, 5.7))) - 0.5) * 0.7;
          stars += smoothstep(0.09, 0.0, length(f)) * (1.0 - 0.3 * float(k));
        }
        float dust = 0.0;
        if (uNebOn > 0.5) dust = smoothstep(0.3, 0.8, texture2D(uNebBase, (sp + thru * 18.0) * 0.0035 + 0.2).r);
        float under = exp(-d * 0.03);
        col += (glow(0.9) * stars * 0.5 + mix(glow(0.3), glowOf(uAccent, 0.8), dust) * dust * 0.07) * under;
        // (a wave's height lights its lines, capped: at a drop the whole disc inside the bars stands tall, and uncapped
        // every line burned white and the core was lost in it, 2026-11-05)
        float glowAmt = (fine * 0.2 + coarse * 0.5 + node * 0.9) * (0.17 + 0.12 * uEnergy + min(abs(vH), 1.4) + band * 0.9);
        // A big drop's moment: the whole infinite grid flashes alight, then fades.
        // (under the core the lines dim to half: at a drop they stood tallest there and the glow puffed the core into a ball, 2:03)
        col += lineCol * glowAmt * 2.0 * exp(-d * 0.018 * (1.0 - 0.7 * uGridFlash)) * (1.0 + 4.0 * uGridFlash) * mix(0.45, 1.0, smoothstep(3.0, 12.0, d));
        col += glow(0.7) * exp(-d * 0.3) * 0.02 * (0.3 + 0.7 * uLow + 0.4 * uHeart) * (1.0 - 0.6 * uVoid);   // a faint pool of light under the core, beating with its heart; dread dims it
        // Light that touches the floor. The core's glow pools beneath it; the floor is wet
        // black glass, so the core shines back from it, the reflection rippling with the
        // waves (the surface's true slope, from how it bends between pixels); and the
        // wall's light falls on the ground at its foot.
        vec3 coreC = glowOf(uCoreCol, 0.9);
        // (The core's pool and reflection on the floor were tried and taken out: even dim,
        // the glow effect spread them into a haze. The void stays black around the core.)
        col += glowOf(uCoreCol, 0.45) * uCoreLight * 0.07 * exp(-d * 0.16);   // deep and saturated, never washed out
        // The glass mirrors the sky: the horizon's glow, the nebula's gas and the ring of
        // bars, bent by the waves (the surface's true slope), strongest at a glancing look.
        vec3 n = normalize(vN);
        vec3 r = reflect(v, n);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
        // A wave tints the void where its surface slopes (its rings), never by height: at a drop the whole disc inside the
        // bars stands tall and tinting by height flooded it into one pink plate (2026-11-05). In the mirror the rings are the light;
        // on the grid the lines carry them, and any tint there filled the drop at 2:03 with magenta rings (2026-11-05).
        float sl = 1.0 - n.y, crest = smoothstep(0.01, 0.12, sl) * (1.0 - smoothstep(0.12, 0.4, sl));
        col += glowOf(uAccent, mix(0.8, 0.95, uMirror)) * crest * mix(0.0, 0.22 + 0.25 * uEnergy, uMirror) * exp(-d * mix(0.028, 0.03, uMirror)) * smoothstep(4.0, 12.0, d);
        vec3 refl = glow(0.6) * pow(max(0.0, 1.0 - abs(r.y)), 10.0) * 0.12 + uRamp[1] * 0.12 * smoothstep(0.0, 0.6, r.y);
        if (uNebOn > 0.5 && fres > 0.09) {   // (the gas is under 3% of the picture at a steeper look: not worth its four lookups)
          float ra = uTime * 0.004, cr = cos(ra), sr = sin(ra);
          vec3 rd = vec3(cr * r.x - sr * r.z, r.y, sr * r.x + cr * r.z);
          float gas = smoothstep(0.26, 0.7, nebAt(vec2(atan(rd.z, rd.x) / 6.28318 + 0.5, asin(clamp(rd.y, -1.0, 1.0)) / 3.14159 + 0.5)));
          refl += mix(glow(0.32), glowOf(uAccent, 0.85), gas * gas) * gas * 0.35;
        }
        refl += glowOf(uWallCol, 0.8) * smoothstep(0.0, 0.04, r.y) * smoothstep(0.22, 0.06, r.y) * smoothstep(30.0, 6.0, d) * (0.08 + 0.25 * uEnergy);   // the bars' light, upside down in the glass
        col += refl * fres * smoothstep(110.0, 40.0, d);
        col += glowOf(uWallCol, 0.8) * exp(-(d - 25.0) * (d - 25.0) * 0.15) * (0.015 + 0.06 * uEnergy);
        // From beneath the ceiling is glass: the singularity shows through it, the lines carry the light.
        float a = smoothstep(150.0, 70.0, d);
        // Rain on the void: each drop lands as a point of light and a thin ring that
        // spreads through the grid and fades. Drops land 27 to 57 units out and touch 2.4
        // around them, so no pixel elsewhere pays for rain, and the rest pay only for the
        // drops still ringing (a dry floor pays nothing).
        if (uDropN > 0 && d > 24.0 && d < 60.0) for (int k = 0; k < 40; k++) {
          if (k >= uDropN) break;
          vec4 dr = uDropLive[k];
          float age = uTime - dr.z;
          if (age < 0.0 || age > 1.3) continue;
          float dd = length(vWorld.xz - dr.xy);
          if (dd > 2.4) continue;
          // The drop's rings, from a real wave simulation (16 frames over its 1.3 s).
          float ring = 0.0;
          if (uFxOn > 0.5) {
            vec2 ruv = (vWorld.xz - dr.xy) / 4.8 + 0.5;
            float fr = clamp(age / 1.3, 0.0, 1.0) * 15.0, fi = floor(fr);
            ring = mix(ripAt(fi, ruv), ripAt(min(fi + 1.0, 15.0), ruv), fr - fi) * 1.4 * (1.0 - smoothstep(0.75, 1.0, age / 1.3));
          }
          float hit = exp(-dd * 14.0) * exp(-age * 18.0);
          col += glowOf(uAccent, 0.95) * (ring * 0.9 + hit * 2.0) * dr.w;   // in the room's own colour
        }
        gl_FragColor = vec4(col, a);
      }`,
  });
  // The floor never writes depth, so its own squares must be drawn far to near: drawn in the plane's fixed order, a far
  // strip painted over a near wave's crest from two of the camera's four sides (long black slits cut out of a wave, most
  // of all under the core, where the waves stand tallest: "a rip"). The inner block, where a wave has any height, is put
  // in order around the camera's own square (rows toward it, and the squares of each row toward it) whenever the camera
  // crosses into a new square; the far floor keeps its fixed order and is drawn before it.
  const SEG = 300, IN = 64, LO = SEG / 2 - IN, HI = SEG / 2 + IN, W = SEG + 1;
  const index = new Uint32Array(SEG * SEG * 6);
  let n = 0;
  const quad = (ix, iy) => {
    const a = ix + W * iy, b = ix + W * (iy + 1), c = ix + 1 + W * (iy + 1), d = ix + 1 + W * iy;
    index[n++] = a; index[n++] = b; index[n++] = d; index[n++] = b; index[n++] = c; index[n++] = d;
  };
  for (let iy = 0; iy < SEG; iy++) for (let ix = 0; ix < SEG; ix++) if (ix < LO || ix >= HI || iy < LO || iy >= HI) quad(ix, iy);
  const innerAt = n, towards = (k, c) => (k < c - LO ? LO + k : HI - 1 - (k - (c - LO)));   // (the k-th of a line of squares, farthest first, ending on the camera's own)
  const order = (cc, cr) => {
    n = innerAt;
    for (let k = 0; k < 2 * IN; k++) { const iy = towards(k, cr); for (let j = 0; j < 2 * IN; j++) quad(towards(j, cc), iy); }
  };
  order(SEG / 2, SEG / 2);
  const indexAttr = new THREE.BufferAttribute(index, 1);
  indexAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setIndex(indexAttr);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -4.2;
  mesh.renderOrder = -1;   // drawn first: everything else lies over it
  let square = -1;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const at = (v) => Math.min(HI - 1, Math.max(LO, Math.floor(v + SEG / 2)));
    const cc = at(camera.position.x - mesh.position.x), cr = at(camera.position.z - mesh.position.z);
    if (cc * SEG + cr === square) return;
    square = cc * SEG + cr;
    order(cc, cr);
    indexAttr.clearUpdateRanges(); indexAttr.addUpdateRange(innerAt, index.length - innerAt);
    indexAttr.needsUpdate = true;
  };
  let fxLeft = 2; const fxReady = () => { if (--fxLeft === 0) uniforms.uFxOn.value = 1; };
  fxTexture('caustics.png', (t) => { uniforms.uCaus.value = t; fxReady(); }, { mirror: true });
  fxTexture('ripple.png', (t) => { uniforms.uRip.value = t; fxReady(); }, { atlas: true });
  return {
    mesh, uniforms,
    // A new ring takes the slot whose ring has faded most (never one still rolling:
    // cutting one off made the floor and the strings riding it jump), and rings a
    // hair apart merge into one.
    ripple(time, amp) {
      const T = uniforms.uRipT.value, A = uniforms.uRipA.value;
      let best = 0, bestLeft = Infinity;
      for (let k = 0; k < RIPPLES; k++) {
        const age = time - T[k];
        if (age >= 0 && age < 0.05) { A[k] = Math.min(4, A[k] + amp * 0.5); return; }
        const left = age > RIPPLE_LIFE ? 0 : A[k] * Math.exp(-0.12 * age - Math.max(0, age * 14 - 25) * 0.07);
        if (left < bestLeft) { bestLeft = left; best = k; }
      }
      T[best] = time; A[best] = amp;
    },
    clear() { uniforms.uRipT.value.fill(-100); uniforms.uRipA.value.fill(0); },   // (a clip render's clean start)
  };
}

// ── Strings: the grid as lines of light stretched over the floor. They ride the
// floor's shockwave rings, all together, so the grid moves like one still sheet the
// core disturbs; a pluck (the backbeat) sweeps a band of light out across it.
export function makeStrings(pal, floorUniforms) {
  const N = 70, SPAN = 140, SEG = 160, pos = [], info = [];   // the whole floor: no wave ever rolls out past the grid
  for (let axis = 0; axis < 2; axis++) for (let i = 0; i < N; i++) {
    const c = -SPAN / 2 + (i + 0.5) * (SPAN / N);
    for (let k = 0; k < SEG; k++) for (const kk of [k, k + 1]) {
      const u = kk / SEG, a = -SPAN / 2 + u * SPAN;
      pos.push(axis ? c : a, 0, axis ? a : c);
      info.push(u, i + axis * N, (i % 5 === 2) ? 1 : 0);   // along-string position, string id, a brighter "coarse" string
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('info', new THREE.Float32BufferAttribute(info, 3));
  const PL = 8;   // light bands sweeping at once
  const uniforms = { uTime: { value: 0 }, uPluck: floorUniforms.uPluck, uPluckT: floorUniforms.uPluckT, uEnergy: { value: 0 }, uLow: { value: 0 },   // (its bands light the floor's grid)
    uPluckCol: floorUniforms.uPluckCol, uPluckK: floorUniforms.uPluckK,   // the backbeat's light carries the part's second feeling
    uRipT: floorUniforms.uRipT, uRipA: floorUniforms.uRipA, uWob: floorUniforms.uWob, uBend: floorUniforms.uBend, ...pal };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime, uPluck[${PL}], uPluckT[${PL}], uLow, uRipT[${RIPPLES}], uRipA[${RIPPLES}], uWob, uBend;
      attribute vec3 info;
      varying float vD, vH, vCoarse, vU, vB;
      ${WAVES_GLSL}
      void main(){
        vec3 p = position;
        float d = length(p.xz), h = waves(d).x;
        // The grid moves as one: it rides the floor's waves and nothing else
        // (never a string wobbling on its own: neighbours
        // out of step read as twitching). A pluck is light, not motion: a band of
        // brightness sweeping out from the centre across the strings.
        float glowBand = 0.0;
        for (int k = 0; k < ${PL}; k++) {
          float age = uTime - uPluckT[k];
          if (age < 0.0 || age > 5.0) continue;
          float front = age * 22.0;
          glowBand += uPluck[k] * exp(-age * 0.7) * exp(-(d - front) * (d - front) * 0.04);
        }
        h += uWob * 1.1 * exp(-(d - 10.0) * (d - 10.0) * 0.025);   // (the floor's womp pump)
        h += uBend * 1.6 * exp(-d * d * 0.005) * smoothstep(2.0, 7.0, d);   // (and its whammy)
        h = rideH(h, d, (modelMatrix * vec4(position, 1.0)).xyz);   // (exactly the floor's surface: the strings ride its waves)
        p.y += h;   // (the liquid is still: only the core's waves move it)
        vD = d; vH = h + glowBand * 0.5; vCoarse = info.z; vU = info.x; vB = glowBand;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uEnergy, uPluckK;
      uniform vec3 uPluckCol;
      varying float vD, vH, vCoarse, vU, vB;
      ${RAMP}
      void main(){
        float fade = exp(-vD * 0.028) * smoothstep(70.0, 45.0, vD);   // (fades just as the floor does)
        vec3 col = mix(glow(0.5), glow(0.8), vCoarse);
        vec3 lit = mix(glowOf(uAccent, 0.95), glowOf(uPluckCol, 0.95), uPluckK * clamp(vB * 2.0, 0.0, 1.0));   // the floor's ripples in the accent, the backbeat's band in the second feeling
        col = mix(col, lit, clamp(abs(vH) * 0.9, 0.0, 1.0));   // a plucked or rippling string lights up
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = max(mix(vec3(l), col, 1.4), 0.0);                                    // saturated: defined lines of colour
        gl_FragColor = vec4(col * (0.17 + 0.14 * vCoarse + 0.12 * uEnergy + abs(vH) * 1.2) * fade, 1.0);
      }`,
  });
  const mesh = new THREE.LineSegments(geo, mat);
  mesh.frustumCulled = false;
  const T = uniforms.uPluckT.value, A = uniforms.uPluck.value;
  return {
    mesh, uniforms,
    // A new pluck takes the slot whose ringing has all but died (never one still
    // swinging: cutting it off was the twitch), and plucks a hair apart merge.
    pluck(time, amp) {
      amp = Math.min(2.5, amp);
      let best = 0, bestLeft = Infinity, recent = -1;
      for (let k = 0; k < PL; k++) {
        const age = time - T[k], left = age > 6 ? 0 : A[k] * Math.exp(-0.7 * age);
        if (left < bestLeft) { bestLeft = left; best = k; }
        if (age >= 0 && age < 0.06) recent = k;
      }
      if (recent >= 0) { A[recent] = Math.min(2.5, A[recent] + amp * 0.5); return; }
      T[best] = time; A[best] = amp;
    },
    clear() { T.fill(-100); A.fill(0); },   // (a clip render's clean start)
  };
}

// ── Spectrum wall: 128 bars around the room, mirrored left/right. Bass bars
// wear the deep tones, highs the bright ones; peaks flash toward the accent.
export function makeRing(sampleRate = 48000) {
  // A wall of light around the room, outside every camera orbit, so it frames the core instead of blocking it.
  const BARS = 128, HALF = BARS / 2, R = 25;
  const geo = new THREE.BoxGeometry(0.72, 1, 0.72);   // slabs of light with a gap between, not sticks or one wall
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geo, mat, BARS);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.position.y = -4.2;
  const color = new THREE.Color(), tone = new THREE.Color(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const heights = new Float32Array(HALF), peaks = new Float32Array(HALF);
  // Log-spaced bins 35 Hz – 14 kHz for a 2048-point FFT.
  const binHz = sampleRate / 2048, bins = [];
  for (let i = 0; i <= HALF; i++) bins.push(Math.max(1, Math.round((35 * Math.pow(14000 / 35, i / HALF)) / binHz)));
  for (let i = 0; i < BARS; i++) mesh.setColorAt(i, color.setRGB(0, 0, 0));
  const rampAt = (ramp, t, out) => {
    const x = Math.min(0.999, Math.max(0, t)) * 4, i = Math.floor(x);
    out.copy(ramp[i]).lerp(ramp[i + 1], x - i);
    const l = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b;   // glow in the tone's hue (see glow() in glsl.js)
    return out.multiplyScalar(Math.min(Math.pow((0.22 + 0.78 * t) / Math.max(l, 1e-3), 0.65), 4));
  };
  const t1 = new THREE.Color(), t2 = new THREE.Color(), lit = new THREE.Color(), WHITE = new THREE.Color(1, 1, 1);
  // The light show's rainbow: cyan, blue, violet, magenta, pink, red and back again,
  // never through gold or green (the house never wears them).
  const rainbow = (u, out) => { const f = ((u % 1) + 1) % 1, tri = f < 0.5 ? f * 2 : 2 - f * 2; return out.setHSL(0.52 + 0.48 * tri, 1, 0.55, THREE.SRGBColorSpace); };
  const angDist = (a, b) => { let d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };
  return {
    mesh,
    // ramps: three colour ramps across the wall, bass to highs (mirrored, so it's symmetric).
    // show: the light show, a separate layer from the heights: the song's moment picks
    // the programme (a chase in a build, black before the drop, a white hit and a
    // shockwave on it, kick ripples, backbeat checkers, wub strobes, a scream's red,
    // the peak's rainbow, the ending draining away).
    update(spectrum, dt, ramps, accent, energy, dim = 1, show = null) {
      let glowK = 1;
      const mixIn = (c, w) => { if (w > 0.001) color.lerp(lit.copy(c).multiplyScalar(glowK), Math.min(1, w)); };
      for (let i = 0; i < HALF; i++) {
        let v = 0;
        const b0 = bins[i], b1 = Math.max(b0 + 1, bins[i + 1]);
        for (let b = b0; b < b1 && b < spectrum.length; b++) v = Math.max(v, spectrum[b]);
        v = Math.pow(v / 255, 2.2) * (1 + i / HALF);       // lift the highs a little
        // Each bar's own slow auto-gain: the highs in these songs are quiet, and without it
        // the top quarter of the ring lay flat and dead. A band moves against its own recent peak.
        peaks[i] = Math.max(v, peaks[i] * Math.exp(-dt * 0.25));
        v = Math.max(v, 0.85 * v / Math.max(peaks[i], 0.12) * Math.min(1, peaks[i] / 0.02));   // (true silence stays still)
        v = Math.max(0, v - 0.035) / 0.965;               // faint noise never moves a bar
        // On the beat: a bar leaps up at once when the music really pushes it (a tiny flicker
        // above where it already stands is ignored, so it never shivers, at no delay), and
        // falls slowly. (Smoothing before the leap made the bars land a tenth of a second late.)
        heights[i] = v > heights[i] + 0.02 ? heights[i] + (v - heights[i]) * Math.min(1, dt * 20) : Math.max(Math.min(v, heights[i]), heights[i] - dt * 2.4);
      }
      for (let i = 0; i < BARS; i++) {
        const k = i < HALF ? i : BARS - 1 - i, h = heights[k];
        const a = (i / BARS) * Math.PI * 2;
        p.set(Math.cos(a) * R, 0, Math.sin(a) * R);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -a);
        // They grow into the song: low and quiet while the room breathes, full height in the end game.
        const pres = show ? show.presence : 1;
        // A scream: the wall maxes out. Every bar stands at full height, the spectrum
        // shivering on top, and every kick slams them all up past the top together.
        const rage = show ? show.scream : 0, rk = rage > 0.01 ? Math.exp(-Math.max(0, show.t - show.kickT) * 7) : 0;
        const hh = h + (0.88 + 0.12 * Math.min(1, h * 2) + 0.18 * rk - h) * rage;
        s.set(1, 0.15 + hh * 6.5 * (0.35 + 0.65 * Math.max(pres, rage)), 1);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        const u = k / HALF, t = 0.35 + 0.55 * u, seg = u < 0.5 ? 0 : 1, w = u < 0.5 ? u * 2 : (u - 0.5) * 2;
        rampAt(ramps[seg], t, t1); rampAt(ramps[seg + 1], t, t2);
        tone.copy(t1).lerp(t2, w * w * (3 - 2 * w));
        color.copy(tone).lerp(accent, Math.min(1, Math.max(0, h * 2 - 1.1))).multiplyScalar((0.12 + h * 0.6 + energy * 0.1) * dim * (0.3 + 0.7 * pres));
        if (show) {
          const S = show, T = S.t, d = angDist(a, S.cam);
          glowK = (0.35 + h * 0.65) * dim;   // a short bar still shows its light
          // Build: a rainbow chase round the ring, faster as the build tightens.
          if (S.build > 0.05) mixIn(rainbow(i / BARS * 2 - T * (0.15 + 1.6 * S.build), t1), S.build * 0.95);
          // The peak (the song's joy): the whole rainbow, full and slowly turning.
          if (S.peak > 0.01) mixIn(rainbow(i / BARS * 3 + T * 0.25, t1), S.peak);
          // A small moment (a new section, the voice coming in): one band of light runs all
          // the way round the ring from the camera's side.
          const ca = T - S.chaseT;
          if (ca >= 0 && ca < 2.5) { const cb = Math.exp(-Math.pow((d - ca * 2.6) * 2.0, 2)) * Math.exp(-ca * 0.6); if (cb > 0.01) { mixIn(S.chaseDual ? S.dual : accent, cb * 1.2); color.multiplyScalar(1 + 0.8 * cb); } }
          // Backbeat: every other bar flicks to the song's second colour.
          const sn = Math.exp(-(T - S.snareT) * 5);
          if (sn > 0.01 && (i & 1)) mixIn(S.dual, sn * 0.4);   // (soft: a hard checker read as jitter)
          // Kick: a pulse ripples round the ring from the bars nearest the camera.
          // Kick: every bar flashes at the same instant (a ripple travelling round the ring
          // reached the far bars late and made the whole ring feel off the beat).
          const ka = T - S.kickT, kb = ka >= 0 ? Math.exp(-ka * 9) : 0;
          if (kb > 0.01) color.multiplyScalar(1 + 0.7 * kb);
          // Wubs: the whole ring strobes between two colours, one per wub.
          // (a brightness pulse, never a colour flip: visuals.js lets at most 3 a second through, the flash-comfort line)
          const wb = S.heavy * Math.exp(-(T - S.wubT) * 10);
          if (wb > 0.01) color.multiplyScalar(1 + 0.6 * wb);
          // A scream: the core is the main character, so the wall only answers it, in the
          // core's own two colours (its rim and its body). One calm pattern holds for eight
          // bars of music before easing into the next; the beat is a soft brightness pulse.
          //   0 tide    rim and body in two broad halves, turning slowly round the ring
          //   1 crown   every fourth bar in the rim's colour on the body's, stepping once a bar
          //   2 breath  the whole ring in the rim's colour, breathing with the kick
          if (S.scream > 0.05 && S.rim) {
            glowK = Math.max(glowK, 0.85) * dim;
            const ph = Math.exp(-Math.max(0, T - (S.kickT ?? -99)) * 5), bars = S.barN || 0, pat = Math.floor(bars / 8) % 3;
            const rim = Math.min(S.rim.r, S.rim.g, S.rim.b) > 0.6 ? t2.setRGB(1, 0.03, 0.1) : t2.copy(S.rim), body = t1.copy(S.body);   // (a white-hot rim would bleach the wall: the scream's red stands in)
            let w;
            if (pat === 0) w = 0.5 + 0.5 * Math.cos(a * 2 - T * 0.25);
            else if (pat === 1) w = ((i + bars) & 3) === 0 ? 1 : 0;
            else w = 1;
            mixIn(body.lerp(rim, w), S.scream * 0.9);
            color.multiplyScalar(1 + 0.35 * ph * S.scream);
          }
          // The drop: every bar flashes white, then a shockwave of colour rolls round the ring.
          const da = T - S.dropT;
          if (da >= 0 && da < 3) {
            mixIn(WHITE, Math.exp(-da * 7) * 1.2);
            const sw = Math.exp(-Math.pow((d - da * 3.2) * 2.5, 2)) * Math.exp(-da * 0.8);
            mixIn(rainbow(da * 0.5 + d * 0.1, t1), sw * 1.3);
          }
          // The music dropping out: the ring sinks low until it returns.
          if (S.hush > 0.01) color.multiplyScalar(1 - 0.7 * S.hush);
          // The breath before the drop: every bar goes black at once.
          color.multiplyScalar(1 - 0.95 * S.hold);
          // The ending: the light drains away round the ring like a clock running down.
          // Waking: the light runs round the ring from the camera's side as a song begins.
          if (S.waking < 1) color.multiplyScalar(Math.max(0, Math.min(1, (S.waking * 1.2 - d / Math.PI) * 6 + 1)));
          if (S.ending > 0) color.multiplyScalar(Math.max(0, Math.min(1, (d / Math.PI - S.ending) * 6 + 1)));
        }
        // away from the bar's own grey, so white and grey (the drop's flash) stay as they are.
        const lum = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
        color.setRGB(Math.max(0, lum + (color.r - lum) * 1.5), Math.max(0, lum + (color.g - lum) * 1.5), Math.max(0, lum + (color.b - lum) * 1.5));
        // Never brighter than full in any channel: an over-bright red tone-maps to orange.
        const mx = Math.max(color.r, color.g, color.b);
        if (mx > 1) color.multiplyScalar(1 / mx);
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    },
  };
}

// The core lives in cores.js.

// ── Halo: rings of light in the mood's colour that burst out of the core on
// drops, held notes and the end, always facing the camera. Nothing stays on the
// core's edge between them: its spiky, living silhouette is never traced by a
// smooth circle.
export const WAVES = 6;
export function makeHalo(pal) {
  const SIZE = 30;                                   // plane is SIZE world units across
  const uniforms = {
    uTime: { value: 0 }, uR: { value: 2.1 },
    uWaveT: { value: new Array(WAVES).fill(-100) }, uWaveA: { value: new Array(WAVES).fill(0) },
    // Each ring keeps the feeling it was born with: its speed, how long it lives, its colour.
    uWaveS: { value: new Array(WAVES).fill(1) }, uWaveL: { value: new Array(WAVES).fill(1.6) },
    uWaveC: { value: Array.from({ length: WAVES }, () => new THREE.Color()) }, uWaveK: { value: new Array(WAVES).fill(0) }, ...pal,
  };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uR, uWaveT[${WAVES}], uWaveA[${WAVES}], uWaveS[${WAVES}], uWaveL[${WAVES}], uWaveK[${WAVES}];
      uniform vec3 uWaveC[${WAVES}];
      varying vec2 vP;
      ${RAMP}
      void main(){
        float d = length(vP);
        float r = uR;
        vec3 hue = mix(glow(0.62), glowOf(uAccent, 0.8), 0.35);    // the mood's own colour, never white
        vec3 col = vec3(0.0);
        for (int i = 0; i < ${WAVES}; i++) {
          float age = uTime - uWaveT[i], life = uWaveL[i];
          if (age < 0.0 || age > life) continue;
          float wr = r + age * 9.0 * (0.6 + 0.4 * uWaveA[i]) * uWaveS[i];   // grief travels slow and far, rage fast and tight
          // Born clear of the spikes and already moving, so no ring ever rests on the core.
          float fade = (1.0 - age / life) * (1.0 - age / life) * uWaveA[i] * smoothstep(0.0, 0.08, age);
          float q3 = (d - wr) / ((0.05 + age * 0.12) / uWaveS[i]);   // squared by hand: pow() of a negative is undefined in GLSL
          col += mix(hue, glowOf(uWaveC[i], 0.62), uWaveK[i]) * exp(-q3 * q3) * fade * 0.9;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  mesh.renderOrder = 2;
  let next = 0;
  return {
    mesh, uniforms,
    // ring: { speed, life, color } of the feeling it releases (or none: the halo's own).
    pulse(time, amp, ring = null) {
      uniforms.uWaveT.value[next] = time;
      uniforms.uWaveA.value[next] = amp;
      uniforms.uWaveS.value[next] = ring ? ring.speed : 1;
      uniforms.uWaveL.value[next] = ring ? ring.life : 1.6;
      uniforms.uWaveK.value[next] = ring ? 1 : 0;   // the feeling's own vivid colour (a straight mix with the halo's went grey)
      if (ring) uniforms.uWaveC.value[next].copy(ring.color);
      next = (next + 1) % WAVES;
    },
    clear() { uniforms.uWaveT.value.fill(-100); next = 0; },   // (a clip render's clean start)
    update(time, camera, radius) {
      uniforms.uTime.value = time;
      uniforms.uR.value = radius;
      // Between bursts there is nothing to draw: skip the screen-sized plane entirely.
      const T = uniforms.uWaveT.value;
      let live = false;
      for (let i = 0; i < WAVES; i++) if (time - T[i] >= -0.5 && time - T[i] <= uniforms.uWaveL.value[i]) live = true;
      mesh.visible = live;
      mesh.lookAt(camera.position);
    },
  };
}

export { palette };

// Rain you see: each drop falls as a thin blue streak and lands where the floor's
// ripple begins, throwing a few tiny droplets up that fall back.
export function makeRain(floorY = -4.2, N = 40) {
  const SPL = 5, BLUE = new THREE.Color(0.16, 0.52, 1.0);
  const streaks = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  const sp = new Float32Array(N * 6); streaks.geometry.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const dots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: BLUE, size: 0.07, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  const dp = new Float32Array(N * SPL * 3); dots.geometry.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const kick = Array.from({ length: N * SPL }, () => [Math.random() - 0.5, 0.6 + Math.random() * 0.9, Math.random() - 0.5]);
  streaks.frustumCulled = dots.frustumCulled = false;
  const group = new THREE.Group(); group.add(streaks, dots);
  const FALL = 0.4, SPEED = 30, LEN = 1.1;
  return {
    group, FALL,
    update(T, drops, col) {
      if (col) { streaks.material.color.copy(col); dots.material.color.copy(col); }
      drops.forEach((d, i) => {
        const tl = d.z - T;   // time to landing
        // the streak, falling (hidden once it has landed)
        const y0 = tl > 0 && tl < FALL ? floorY + tl * SPEED : -999;
        sp.set([d.x, y0, d.y, d.x, y0 + LEN, d.y], i * 6);
        // the splash: tiny droplets thrown up and falling back for a quarter second
        const a = -tl;
        for (let k = 0; k < SPL; k++) {
          const v = kick[i * SPL + k], j = (i * SPL + k) * 3;
          if (a > 0 && a < 0.3 && d.w > 0.7) { dp[j] = d.x + v[0] * a * 2.2; dp[j + 1] = floorY + v[1] * a * 4 - 9 * a * a; dp[j + 2] = d.y + v[2] * a * 2.2; }
          else dp[j + 1] = -999;
        }
      });
      streaks.geometry.attributes.position.needsUpdate = true;
      dots.geometry.attributes.position.needsUpdate = true;
    },
  };
}
