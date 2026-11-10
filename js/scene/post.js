// Post stack: render → bloom (tinted halation) → tone map → grade + lens.
// The grade runs after tone mapping, in display space, the way a colourist
// works: split-toned shadows and highlights, saturation and contrast that move
// with the music, a vignette that sinks into the mood's shadow, film grain.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uCA: { value: 0.002 }, uGrain: { value: 0.035 },
    uVig: { value: 0.9 }, uVigK: { value: 1 }, uFlash: { value: 0 }, uGlitch: { value: 0 }, uScan: { value: 0 }, uVibrance: { value: 0.5 },
    uFlashCol: { value: new THREE.Vector3(1, 1, 1) },
    // Grade (display-space colours, 0..1).
    uShadow: { value: new THREE.Vector3(0.1, 0.1, 0.12) }, uHighlight: { value: new THREE.Vector3(1, 1, 1) },
    uSplit: { value: 0.6 }, uSat: { value: 1 }, uContrast: { value: 1 }, uLift: { value: 0.02 }, uSharpen: { value: 0.6 },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uCA, uGrain, uVig, uVigK, uFlash, uGlitch, uScan;
    uniform vec3 uFlashCol, uShadow, uHighlight;
    uniform float uSplit, uSat, uContrast, uLift, uVibrance, uSharpen;
    uniform vec2 uTexel;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    // A tint's hue at unit strength, half-applied: shadows lean toward the mood, never dyed by it.
    vec3 tint(vec3 t){ return mix(vec3(1.0), t / max(1e-3, (t.r + t.g + t.b) / 3.0), 0.5); }
    void main(){
      vec2 uv = vUv;
      if (uGlitch > 0.002) {
        float row = floor(uv.y * 28.0);
        float h = hash(vec2(row, floor(uTime * 24.0)));
        uv.x += (h - 0.5) * 0.12 * uGlitch * step(0.55, h);
      }
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      uv = 0.5 + c * (1.0 + 0.045 * r2);
      vec2 off = c * uCA * (0.5 + 3.0 * r2);
      vec3 col;
      // Colour fringing splits red from green-and-blue together, so a fringe is only ever
      // red or cyan (splitting all three left green and orange edges on bright things).
      col.r = texture2D(tDiffuse, uv + off).r;
      col.gb = texture2D(tDiffuse, uv - off * 0.5).gb;
      // Pop: an unsharp mask. Each pixel is pushed away from its neighbours' average,
      // so lines and edges come out crisp and defined instead of soft.
      vec3 nb = texture2D(tDiffuse, uv + vec2(uTexel.x, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(uTexel.x, 0.0)).rgb
              + texture2D(tDiffuse, uv + vec2(0.0, uTexel.y)).rgb + texture2D(tDiffuse, uv - vec2(0.0, uTexel.y)).rgb;
      col = max(col + (col - nb * 0.25) * uSharpen, 0.0);
      // A NaN from any shader (and the bloom that smears it into blocks) shows as nothing, never as a glitching black box.
      if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);

      // No haze: a bright but pale pixel (whitish yellow, mint, cream: what bloom turns
      // into fog) is pulled back toward its own hue and down a little. Saturated colour
      // (the reds and purples) passes untouched, so it stays the pop on the dark.
      {
        float mx = max(max(col.r, col.g), col.b), mn = min(min(col.r, col.g), col.b);
        float paleness = mx > 1e-3 ? mn / mx : 0.0;
        float k = smoothstep(0.7, 1.0, mx) * smoothstep(0.7, 0.95, paleness);   // only truly washed-out glare, not bright detail
        vec3 hue = mx > 1e-3 ? (col - mn) / max(mx - mn, 1e-3) : vec3(0.0);
        col = mix(col, mix(col, hue * mx, 0.5) * 0.9, k * 0.35);
      }
      // Grade: split-tone, saturation, contrast (S-curve), lifted blacks.
      float l = luma(col);
      col = mix(col, col * tint(uShadow), (1.0 - smoothstep(0.0, 0.42, l)) * uSplit);
      col = mix(col, col * tint(uHighlight), smoothstep(0.3, 0.95, l) * uSplit * 0.55);
      col = mix(vec3(luma(col)), col, uSat);
      // Vibrance: lift the colours that are still shy, leave the bold ones alone.
      float chroma = max(max(col.r, col.g), col.b) - min(min(col.r, col.g), col.b);
      col = mix(vec3(luma(col)), col, 1.0 + uVibrance * (1.0 - clamp(chroma, 0.0, 1.0)));
      col = clamp(col, 0.0, 1.0);
      col = mix(col, col * col * (3.0 - 2.0 * col), clamp(uContrast - 1.0, 0.0, 1.0));
      col += uShadow * uLift;

      col += uFlashCol * uFlash;
      col *= 1.0 - uScan * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159));
      float vig = smoothstep(0.95, 0.25, length(c) * 1.1 * uVigK);   // fear and loneliness close the dark in; hope opens the frame
      col *= mix(1.0, vig, uVig);                           // edges fall to true black
      col += (hash(gl_FragCoord.xy + fract(uTime) * 97.0) - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export function makePost(renderer, scene, camera) {
  // The scene renders into a 4x multisampled target: every wire and string is an
  // anti-aliased line instead of a jaggy, shimmering one (the "720p" look).
  // (Drawn supersampled, 2 samples already give clean lines at half the memory
  // traffic of 4: a cooler GPU for the same picture. ?msaa=N overrides.)
  const size = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
  const forced = /[?&]msaa=(\d)/.exec(location.search);
  const samples = forced ? +forced[1] : pr >= 1.5 ? 2 : 4;
  // Nothing reads depth after the scene is drawn, so it is never resolved.
  const target = new THREE.WebGLRenderTarget(Math.max(1, size.x * pr), Math.max(1, size.y * pr), { type: THREE.HalfFloatType, samples, resolveDepthBuffer: false });
  const composer = new EffectComposer(renderer, target);
  // The scene and the bloom draw into renderTarget2; renderTarget1 only ever takes
  // the tone-mapped copy (a full-screen quad): multisampling it was pure overhead.
  composer.renderTarget1.samples = 0;
  composer.addPass(new RenderPass(scene, camera));
  // Tight and coloured: glow hugs bright things instead of fogging the frame (a high
  // threshold and a short radius keep the darks dark, which is half of what makes colour pop).
  const bloom = new UnrealBloomPass(size, 0.8, 0.2, 0.62);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  // Bloom mips take the mood's halo colour (more so the wider they spread), so
  // light bleeds in hue, like film, never as a milky white veil.
  const tints = bloom.compositeMaterial.uniforms.bloomTintColors.value;
  return {
    composer, bloom, lens: grade.uniforms,
    // halo: display-space colour as a Vector3 (x, y, z = r, g, b).
    setHalo(halo, amount) {
      const m = Math.max(halo.x, halo.y, halo.z, 1e-3);
      for (let i = 0; i < tints.length; i++) {
        const k = Math.min(1, amount * (0.6 + 0.4 * (i / (tints.length - 1))));
        tints[i].set(1 + (halo.x / m - 1) * k, 1 + (halo.y / m - 1) * k, 1 + (halo.z / m - 1) * k);
      }
    },
    setSize(w, h) { composer.setSize(w, h); const pr = renderer.getPixelRatio(); grade.uniforms.uTexel.value.set(1 / (w * pr), 1 / (h * pr)); },
    render() { composer.render(); },
  };
}
