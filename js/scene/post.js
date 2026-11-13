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
    // Easy on the eyes: where a pixel's brightest channel starts to bend (uKnee) and the ceiling it bends toward (uCeil).
    //  said that, and the core has its own light now: CORE_LIGHT in js/scene/cores.js. Never lower these to dim the core.)
    uKnee: { value: 0.6 }, uCeil: { value: 0.84 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uCA, uGrain, uVig, uVigK, uFlash, uGlitch, uScan;
    uniform vec3 uFlashCol, uShadow, uHighlight;
    uniform float uSplit, uSat, uContrast, uLift, uVibrance, uSharpen, uKnee, uCeil;
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
      // No mud, the last word: a warm tone that is dark (rust, brown, dark orange) or fully saturated (true
      // orange, amber) is pulled to red or pink by lowering its green to its blue. Light, glowing warm tones
      // (peach, salmon, coral) are pretty and pass untouched, and so do pure reds, pinks, greys and cool tones.
      // (The room's reds lean a few degrees toward orange; when a line glows hot, tone mapping washes it
      // toward white and that lean shows as peach, which is welcome. Dark, it would show as rust.)
      {
        float hi = max(col.r, max(col.g, col.b)), lo = min(col.r, min(col.g, col.b)), span = hi - lo;
        if (col.r >= col.g && col.g > col.b && span > 0.02) {
          float lean = smoothstep(0.06, 0.18, (col.g - col.b) / span);   // 0 for a true red, 1 from about 11 degrees up
          float muddy = max(1.0 - smoothstep(0.5, 0.75, hi), smoothstep(0.6, 0.75, span / hi));   // dark, or too saturated to be peach
          col.g = mix(col.g, col.b, lean * muddy * smoothstep(0.06, 0.2, span / hi));
        }
        // ...and a dark yellow-green (olive) falls to a neutral dark: bright greens are pretty, dark olive is mud.
        else if (col.g >= col.b && col.r > col.b && col.g > 0.0 && span > 0.02) {
          float olive = (1.0 - smoothstep(0.3, 0.55, hi)) * smoothstep(0.25, 0.5, span / hi) * smoothstep(0.55, 0.8, min(col.r, col.g) / max(col.r, col.g));
          col.b = mix(col.b, hi, olive);
        }
      }
      // saturation and awesomeness"). The last word on brightness: a pixel's brightest channel bends toward a ceiling
      // instead of running on to full white, and the whole pixel is scaled by that same amount, so its hue and its
      // saturation stay exactly what they were. Under the knee nothing changes, so verses and the dark keep their look.
      {
        float hi = max(col.r, max(col.g, col.b));
        if (hi > uKnee) {
          float room = max(uCeil - uKnee, 1e-3);
          col *= (uKnee + room * (1.0 - exp(-(hi - uKnee) / room))) / hi;
        }
      }
      col += (hash(gl_FragCoord.xy + fract(uTime) * 97.0) - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

// A broken value (NaN, or an Inf from light past what a half-float holds) in one pixel is a black
// hole: the bloom's blur halves the picture five times and smears it into black blocks with
// output passes through clean(): a broken value becomes black, a huge one stays a bright white.
const CLEAN = `
  vec4 clean( vec4 c ) {
    return min( max( c, vec4( 0.0 ) ), vec4( 6.0e4 ) );   // (max first: on D3D max(NaN, 0) is 0; isnan() there misfires)
  }
`;

// The output pass (tone mapping, then sRGB) with the bloom's glow added first, the way the
// bloom's own additive blend added it (its colour times its alpha): the same picture.
class GlowOutputPass extends OutputPass {
  constructor(bloom) {
    super();
    this.bloom = bloom;
    this.uniforms.tGlow = { value: null };
    this.material.fragmentShader = this.material.fragmentShader
      .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse, tGlow;')
      .replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = clean( texture2D( tDiffuse, vUv ) ); vec4 glow = clean( texture2D( tGlow, vUv ) ); gl_FragColor.rgb += glow.rgb * glow.a;')
      .replace('void main() {', CLEAN + 'void main() {');
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tGlow.value = this.bloom.renderTargetsHorizontal[0].texture;   // (where the bloom leaves its finished glow)
    super.render(renderer, writeBuffer, readBuffer);
  }
}

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
  // The glow is added in the output pass, never blended back into the multisampled scene buffer:
  // that wrote every sample of the frame and forced a second resolve, 1.3 ms a frame at ULTRA.
  const hp = bloom.materialHighPassFilter;   // (the glow's way in: sanitised, so nothing broken spreads)
  hp.fragmentShader = hp.fragmentShader.replace('void main() {', CLEAN + 'void main() {').replace('texture2D( tDiffuse, vUv )', 'clean( texture2D( tDiffuse, vUv ) )');
  hp.needsUpdate = true;
  const quad = bloom._fsQuad || bloom.fsQuad, drawQuad = quad.render.bind(quad);   // (three r171+ named it _fsQuad)
  quad.render = (r) => { if (quad.material !== bloom.blendMaterial) drawQuad(r); };
  composer.addPass(bloom);
  composer.addPass(new GlowOutputPass(bloom));
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  // Bloom mips take the mood's halo colour (more so the wider they spread), so
  // light bleeds in hue, like film, never as a milky white veil.
  // The glow's widest blurs trimmed (stock 1, .8, .6, .4, .2): the tight glow keeps the fiery edge
  // burning pink to white, but the wide haze no longer spreads a milky film over the core's dark face
  bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.8, 0.45, 0.15, 0.04];
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
