// The core: the plasma star. A black void with a blazing heart, inside a wire shell
// that rides the same turbulence; it boils with the bass and stabs spikes out on
// every kick, the net's reaching far past the plasma's, with nothing around it to
// hold them in. Always centred, always symmetric in its place.
import * as THREE from 'three';
import { SIMPLEX, RAMP } from './glsl.js';

const COMMON = /* glsl */ `
  uniform float uTime, uLow, uMid, uHigh, uKick, uFade, uEnd, uHeartAmt, uFeel;
  uniform vec3 uHeartTint;
  // The core's temperament (visuals.js, from the part's feelings): phases the CPU
  // accumulates (so a change of pace never jumps the surface), the heart's size and
  // breath, the spikes' shape and strength, the skin's crackle, how many nodes are
  // lit, and how far the self has dissolved.
  uniform float uBoilT, uSpikeT, uFlowT, uTwT, uBreath, uSpike, uSpikeGain, uRidge, uNodeCut, uHeartSize, uDissolve, uArc;
  uniform float uScream;     // a screamed stretch (0..1)
  uniform float uPower;      // how awake the singularity is (0 at rest .. 1 at full scream)
  uniform float uAware;      // a pulse now and then at rest: it noticed you
  uniform vec3 uRimCol, uBodyCol;   // its designed pair (visuals.js CORE_PAIRS)
  uniform vec3 uDual;        // its second colour: the feeling's duality (visuals.js DUALS)
  uniform float uShellTurn;   // which way round the wheel the shell sits (chosen so it never lands in green)
  // Turn a colour round the colour wheel (rotation about the grey axis): the shell
  // sits ~65 degrees on from the plasma, so neither swallows the other.
  vec3 hueShift(vec3 c, float a){ const vec3 k = vec3(0.57735); float ca = cos(a); return max(c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca), 0.0); }
`;
const RIGID = /* glsl */ `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// Solid (not added) lines: a net stays crisp where it crosses the bright plasma.
const lines = { transparent: true, depthWrite: false };
const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
// One point per distinct vertex of a (non-indexed) geometry, keeping its normal.
function mergedVerts(geo) {
  const pos = geo.attributes.position, seen = new Map(), P = [], N = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.set(key, 1);
    const l = Math.hypot(x, y, z) || 1;
    P.push(x, y, z); N.push(x / l, y / l, z / l);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  return g;
}

export function makeCore(pal) {
  const uniforms = {
    uTime: { value: 0 }, uLow: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 }, uKick: { value: 0 }, uFade: { value: 1 },
    uEnd: { value: 0 }, uHeartTint: { value: new THREE.Color() }, uHeartAmt: { value: 0 }, uFeel: { value: 0 },
    uBoilT: { value: 0 }, uSpikeT: { value: 0 }, uFlowT: { value: 0 }, uTwT: { value: 0 }, uBreath: { value: 0.9 },
    uSpike: { value: 4 }, uSpikeGain: { value: 1 }, uRidge: { value: 1 }, uNodeCut: { value: 0.55 }, uHeartSize: { value: 60 }, uDissolve: { value: 0 }, uArc: { value: 0 }, uShellTurn: { value: 1 }, uScream: { value: 0 }, uPower: { value: 0 }, uAware: { value: 0 }, uDual: { value: new THREE.Color() }, uRimCol: { value: new THREE.Color(0.6, 0.85, 1) }, uBodyCol: { value: new THREE.Color(0.2, 0.3, 1) },
    ...pal,
  };
  const group = new THREE.Group();
  const spinner = new THREE.Object3D();     // the World turns this; the plasma follows it
  const styles = {};
  const plasmaVert = /* glsl */ `${COMMON}
    varying vec3 vN; varying vec3 vView; varying float vD; varying vec3 vObj;
    ${SIMPLEX}
    void main(){
      vec3 n = normalize(normal);
      float low = min(uLow, 1.0), t = uBoilT;   // capped: it boils, but stays a ball, never a cloud of gas
      vec3 q = n * 1.7 + vec3(snoise(n * 1.3 + t * 0.21), snoise(n * 1.3 + 7.1 - t * 0.17), snoise(n * 1.3 + 3.7 + t * 0.13)) * 0.9;
      float n1 = snoise(q + vec3(0.0, t * 0.45, 0.0));
      float n2 = snoise(n * 4.2 - vec3(t * 0.7) + n1);
      float d = n1 * (0.12 + low * 0.2) + n2 * (0.03 + low * 0.04) + uKick * 0.13;
      // Character: sharp, exaggerated reactions that snap back. The kick stabs spikes
      // of plasma out of the surface like flares (sharp peaks of noise, so they read as
      // spikes, not swelling); the highs crackle jagged ridges across the skin.
      float ts = uSpikeT;
      float sp = snoise(n * 4.5 + vec3(ts * 1.7, -ts * 1.1, ts * 0.8));
      float spikes = pow(max(sp, 0.0), uSpike);   // a high exponent: few, sharp stabs; a low one: broad, rounded swells
      float ridge = pow(max(1.0 - abs(snoise(n * 3.1 - vec3(t * 0.9))), 0.0), 9.0);   // noise can overshoot 1: never pow() a negative (NaN on Windows)
      float stab = spikes * (0.6 * uKick + 0.12 * low) * uSpikeGain;
      // Screaming: the whole skin bristles, spikes out even between kicks, sharper and longer.
      float rage = pow(max(snoise(n * 6.0 + vec3(ts * 3.0, -ts * 2.2, ts * 1.6)), 0.0), 2.5);
      // One being on one scale: at rest it bristles faintly, as it wakes the bristling
      // grows, and at full power (a scream) it is the furious thing it always was.
      stab += 0.05 * rage + uPower * (0.35 * rage + 0.6 * spikes * (0.5 + uKick));
      d += uAware * 0.06 * (0.5 + n1);   // it noticed: the surface swells, unevenly, for a breath
      #ifdef NET
      stab *= 1.8;   // the net (and its lights) stabs out much further than the plasma, which stays a ball
      #endif
      float jag = stab + ridge * (0.22 * min(uHigh, 1.2) + 0.18 * uKick) * uRidge;
      #ifdef NET
      // The shell is a calm cage: only the slow boil and the kick's spikes move it. The
      // fine wobble and the crackle read as jitter on its few big cells.
      d = n1 * (0.07 + low * 0.1) + uKick * 0.1;
      jag = stab;
      #endif
      d += jag;
      vec3 p = position + normal * d;
      // Only the jagged reactions (spikes, crackle) glow: the slow boil, however hard
      // the bass pushes it, stays the dark body (or a heavy song floods the void).
      vD = jag; vObj = n * 2.0 + vec3(n1 * 0.4);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vN = normalize(normalMatrix * normal); vView = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`;
  const plasmaMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: plasmaVert, ...additive,
    fragmentShader: /* glsl */ `${COMMON}
      varying vec3 vN; varying vec3 vView; varying float vD; varying vec3 vObj;
      ${SIMPLEX}${RAMP}
      void main(){
        float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0, 1.0), 2.2);
        // Stoic inside: broad, slow currents at a steady pace whatever the music does
        // (the violence lives on the surface, in the spikes).
        float flowT = uFlowT;
        float v = 1.0 - abs(snoise(vObj * 0.9 + vec3(0.0, flowT, flowT * 0.6)));
        float fil = pow(clamp(v, 0.0, 1.0), 9.0) * (0.6 + 0.5 * min(uLow, 1.0));   // thin currents, not a slick
        // The singularity: black void inside, one small blazing heart at the very centre
        // (breathing slowly with the bass), thin vivid currents, a burning rim. No dim
        // fill: every colour in the core is either black or fully vivid, never grey.
        float facing = abs(dot(normalize(vN), normalize(vView)));        // 1 at the dead centre of the disc
        float heart = (pow(facing, uHeartSize) + 0.35 * pow(facing, uHeartSize * 0.23)) * (1.0 - 0.65 * uDissolve);   // a tight blazing point with a short falloff; the self dissolving dims it
        float breath = uBreath + 0.4 * min(uLow, 1.0);
        // Duality: the rim and the spikes wear the feeling's second colour (more of it as
        // it wakes), the currents and heart its first, so two colours always speak.
        // A star of two colours on black, a designed pair per feeling (visuals.js CORE_PAIRS):
        // the body colour fills the inner plasma and the boiling convection, the rim
        // colour burns at the edge and in the flares, the skin between blends the two,
        // the heart stays black. As it wakes (anger, a scream) the body sinks toward
        // black and the rim runs white-hot: a dark figure in a burning ring.
        float depth = facing;
        float L1 = smoothstep(0.62, 0.86, depth) * (1.0 - smoothstep(0.86, 0.96, depth));   // inner plasma
        float L2 = smoothstep(0.32, 0.55, depth) * (1.0 - smoothstep(0.62, 0.86, depth));   // convection
        float L3 = smoothstep(0.08, 0.25, depth) * (1.0 - smoothstep(0.32, 0.55, depth));   // photosphere
        float churn = 0.5 + 0.5 * snoise(vObj * 1.6 + vec3(flowT * 0.8, -flowT * 0.5, 0.0));
        float cells = pow(1.0 - abs(snoise(vObj * 4.5 + vec3(0.0, flowT * 1.6, flowT))), 3.0);
        float gran = pow(1.0 - abs(snoise(vObj * 9.0 - vec3(flowT * 2.0))), 4.0);
        float spots = smoothstep(0.55, 0.75, snoise(vObj * 1.3 + vec3(flowT * 0.3)));
        float lowB = min(uLow, 1.0), hot = uPower;
        vec3 body = uBodyCol * 1.5 * (1.0 - 0.65 * hot);
        vec3 rim = mix(uRimCol, vec3(1.0), 0.75 * hot) * 1.7;
        vec3 col = body * L1 * (0.05 + 0.14 * churn)
          + body * L2 * (0.2 + 0.7 * cells) * (0.55 + 0.6 * lowB + 0.3 * uFeel)
          + mix(body, rim, 0.55) * L3 * (0.5 + 0.6 * gran) * (1.0 - 0.7 * spots) * (0.8 + 0.4 * lowB)
          + rim * f * f * (0.7 + lowB * 0.8 + 0.5 * uAware + 0.6 * hot)        // the burning rim
          + rim * heart * 0.08 * breath * (1.0 + 1.5 * uAware) * (1.0 - hot)    // a faint ember at the heart when it notices (never when it burns)
          + rim * smoothstep(0.06, 0.32, vD) * 0.5 * (1.0 - 0.8 * hot * depth)   // flares; when it burns they blaze at the edge, the face stays a dark figure
          + body * fil * 0.35 * (1.0 - L1);
        gl_FragColor = vec4(col * (0.44 + 0.05 * uKick) * uFade * (1.0 - uEnd), 1.0);   // the kick shows as spikes, not a flash
      }`,
  });
  // The wire shell: a third of the wheel round from the plasma.
  const plasmaWire = new THREE.ShaderMaterial({
    uniforms, vertexShader: plasmaVert, wireframe: true, defines: { NET: '' }, ...lines,
    fragmentShader: /* glsl */ `${COMMON}${RAMP}
      void main(){ gl_FragColor = vec4(hueShift(mix(glow(0.85), glowOf(uAccent, 0.85), 0.3), -1.15 * uShellTurn) * 0.8, (0.13 + 0.06 * uArc + 0.12 * uKick) * (1.0 - 0.6 * uDissolve) * uFade * (1.0 - uEnd)); }`,
  });
  // Nodes: a point of light at every vertex of the wire shell, riding the same
  // plasma and twinkling with the hi-hats (each node on its own beat of the shimmer).
  const nodeVert = plasmaVert.replace('gl_Position = projectionMatrix * mv;',
    'gl_Position = projectionMatrix * mv; float tw = fract(sin(dot(position, vec3(12.9898, 78.233, 37.719))) * 43758.5453); vTw = tw; gl_PointSize = clamp((2.2 + 3.0 * uHigh * step(uNodeCut, fract(tw + uTwT * 0.9)) + 2.0 * uKick) * 16.0 / max(1.0, -mv.z), 1.2, 6.0);')
    .replace('varying vec3 vObj;', 'varying vec3 vObj; varying float vTw;');
  const nodeMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: nodeVert, defines: { NET: '' }, ...additive,
    fragmentShader: /* glsl */ `${COMMON}${RAMP}
      varying float vTw;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5 || vTw < 0.6 * uDissolve) discard;   // the self dissolving: the lights go out evenly, the shell stays symmetric
        float a = smoothstep(0.5, 0.15, d);
        vec3 c = mix(hueShift(glow(0.95), -1.15 * uShellTurn), glowOf(uAccent, 1.0), step(0.5, vTw));   // half the shell's hue, half the accent
        gl_FragColor = vec4(c * a * (0.15 + 0.15 * uArc + 0.7 * uHigh * step(uNodeCut - 0.05, fract(vTw * 7.0 + uTwT * 0.8)) + 0.35 * uKick) * uFade * (1.0 - uEnd), 1.0);
      }`,
  });
  {
    const g = new THREE.Group();
    const shellGeo = new THREE.IcosahedronGeometry(1.95, 3);   // a few large cells: it frames the plasma, never a ball of yarn
    // (84k triangles: finer, smoother spikes; measured at +0.3 ms a frame on an RX 6600 XT)
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1.55, 64), plasmaMat), shell = new THREE.Mesh(shellGeo, plasmaWire);
    const nodes = new THREE.Points(mergedVerts(shellGeo), nodeMat);
    // A dark heart inside the plasma: the room behind no longer shows through it, and
    // the net's far half tucks behind it, so the core reads solid and deep.
    const backMat = new THREE.ShaderMaterial({ uniforms, vertexShader: RIGID,
      fragmentShader: /* glsl */ `void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }` });   // pure black void
    const back = new THREE.Mesh(new THREE.IcosahedronGeometry(1.12, 8), backMat);
    back.renderOrder = -1;
    // (The wire shell and its lights are gone: the plasma is the whole show.)
    void shell; void nodes;
    g.add(back, body);
    styles.plasma = {
      group: g,
      update() { body.rotation.copy(spinner.rotation); },
    };
  }

  // Spit: during a long scream the plasma flings blobs of itself out. Each flies off
  // the surface, slows, shrinks and burns out within about a second.
  // Torn, not round: a coarse shape with its corners pulled about at random, so every
  // gob is a jagged shard, stretched long along its flight.
  const SPITS = 48, spitMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1), ...additive });
  const shard = new THREE.IcosahedronGeometry(1, 0), sp = shard.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setXYZ(i, sp.getX(i) * (0.4 + Math.random()), sp.getY(i) * (0.4 + Math.random()), sp.getZ(i) * (0.4 + Math.random()));
  const spits = new THREE.InstancedMesh(shard, spitMat, SPITS);
  spits.frustumCulled = false;
  const blobs = Array.from({ length: SPITS }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), s: 0, spin: new THREE.Quaternion() }));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), hidden = new THREE.Matrix4().makeScale(0, 0, 0), up = new THREE.Vector3(0, 1, 0), vn = new THREE.Vector3();
  let next = 0, owed = 0, lastKick = 0, awareIn = 4, awareT = 99;
  group.add(spits);
  // Fire: each gob burns as it flies, a burst of real volumetric fire and smoke rendered in
  // Blender (assets/textures/fire.png, 16 frames from a fresh flare to thin smoke), always
  // facing the eye, white-hot in the rim colour at first, cooling to the body colour.
  const fireLife = new THREE.InstancedBufferAttribute(new Float32Array(SPITS), 1);
  const fireGeo = new THREE.PlaneGeometry(1, 1); fireGeo.setAttribute('aLife', fireLife);
  const fireMat = new THREE.ShaderMaterial({
    uniforms: { uFire: { value: null }, uRimCol: uniforms.uRimCol, uBodyCol: uniforms.uBodyCol, uFade: uniforms.uFade },
    vertexShader: /* glsl */ `
      attribute float aLife; varying float vL; varying vec2 vUv;
      void main(){
        vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(instanceMatrix[0].xyz);
        c.xy += position.xy * s;
        vL = aLife; vUv = uv;
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uFire; uniform vec3 uRimCol, uBodyCol; uniform float uFade;
      varying float vL; varying vec2 vUv;
      void main(){
        float fr = clamp(1.0 - vL, 0.0, 1.0) * 15.0, fi = floor(fr);
        vec2 a = vec2(mod(fi, 4.0), floor(fi / 4.0)), b = vec2(mod(min(fi + 1.0, 15.0), 4.0), floor(min(fi + 1.0, 15.0) / 4.0));
        float fa = texture2D(uFire, vec2((a.x + vUv.x) * 0.25, 1.0 - (a.y + 1.0 - vUv.y) * 0.25)).r;
        float fb = texture2D(uFire, vec2((b.x + vUv.x) * 0.25, 1.0 - (b.y + 1.0 - vUv.y) * 0.25)).r;
        float f = pow(mix(fa, fb, fr - fi), 1.6);   // (contrast: tongues of flame, not a haze)
        vec3 hot = mix(uRimCol, vec3(1.0), 0.5);
        vec3 col = mix(uBodyCol, hot, smoothstep(0.25, 0.9, f) * vL) * f * (0.6 + 1.6 * vL);
        gl_FragColor = vec4(col * uFade, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const fire = new THREE.InstancedMesh(fireGeo, fireMat, SPITS);
  fire.frustumCulled = false; fire.visible = false;
  for (let i = 0; i < SPITS; i++) fire.setMatrixAt(i, hidden);   // (no stray smoke at the heart before the first gob)
  new THREE.TextureLoader().load('assets/textures/fire.png', (t) => {
    t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
    fireMat.uniforms.uFire.value = t; fire.visible = true;
  });
  group.add(fire);

  const style = styles.plasma;
  group.add(style.group);
  return {
    group, uniforms, shell: spinner,
    notice() { awareT = 0; awareIn = 5 + Math.random() * 6; },   // it noticed something (the voice coming in)
    update(dt = 0, scream = 0, kick = 0) {
      style.update();
      uniforms.uScream.value = scream;
      // Awareness: at rest, every 5 to 11 seconds, it notices (a breath of light and swell).
      awareIn -= dt;
      if (awareIn <= 0) { awareIn = 5 + Math.random() * 6; awareT = 0; }
      awareT += dt;
      uniforms.uAware.value = Math.exp(-awareT * 1.6) * (1 - Math.min(1, uniforms.uPower.value * 1.5)) * Math.min(1, awareT * 6);
      // Only a real scream spits: a stray gob now and then, and a hacking burst of
      // spray (one direction, a messy cone) on each hard kick.
      owed += scream > 0.6 ? dt * 1.5 * scream : 0;
      const burst = scream > 0.6 && kick > 0.55 && lastKick <= 0.55 ? 4 + Math.floor(Math.random() * 6) : 0;
      lastKick = kick;
      const aim = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1.4 - 0.4, Math.random() * 2 - 1).normalize();
      for (let k = 0; k < burst + Math.floor(owed); k++) {
        const b = blobs[next++ % SPITS];
        const d = (k < burst ? aim.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.7)) : new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1.4 - 0.4, Math.random() * 2 - 1)).normalize();
        b.p.copy(d).multiplyScalar(1.6 + Math.random() * 0.3);
        b.v.copy(d).multiplyScalar(5 + Math.random() * 9);   // uneven: some gobs barely leave, some fly
        b.s = 0.04 + Math.random() * Math.random() * 0.22;  // mostly small droplets, the odd big gob
        b.spin.setFromAxisAngle(new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(), Math.random() * 6.28);
        b.life = b.life0 = 0.6 + Math.random() * 0.6;
      }
      owed -= Math.floor(owed);
      spitMat.color.copy(uniforms.uRimCol.value).multiplyScalar(1.6);   // the shards are the rim's own fire
      blobs.forEach((b, i) => {
        if (b.life <= 0) { spits.setMatrixAt(i, hidden); fire.setMatrixAt(i, hidden); fireLife.array[i] = 0; return; }
        b.life -= dt * 1.1; b.v.multiplyScalar(Math.exp(-dt * 3)); b.v.y -= dt * 4; b.p.addScaledVector(b.v, dt);
        // Stretched along its flight (a streak while fast, a drop as it slows), its torn shape turned.
        const s = b.s * Math.min(1, b.life * 2), speed = b.v.length();
        q.setFromUnitVectors(up, vn.copy(b.v).normalize()).multiply(b.spin);
        spits.setMatrixAt(i, m4.compose(b.p, q, sc.set(s, s * (1 + speed * 0.45), s)));
        // its fire: billows out as it burns (in the core's own space, so it scales with the core)
        const age = 1 - Math.max(0, b.life) / (b.life0 || 1), fs = (0.22 + b.s * 2.2) * (0.6 + 1.3 * age);
        fire.setMatrixAt(i, m4.compose(b.p, q.identity(), sc.set(fs, fs, fs)));
        fireLife.array[i] = 1 - age;
      });
      spits.instanceMatrix.needsUpdate = true;
      fire.instanceMatrix.needsUpdate = true; fireLife.needsUpdate = true;
    },
  };
}
