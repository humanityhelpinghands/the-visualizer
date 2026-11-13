//  - the 3D world draws at 1/8 of the screen (visuals.js reads ?bg; ?bgscale=16 for 1/16)
//  - the page runs at 30 fps at most (every requestAnimationFrame callback of one frame shares one gate)
//  - the tiny picture is stretched bilinearly and blurred once by a CSS filter on the canvas itself (no backdrop-filter, which re-reads
//    what is behind it every frame); ?bgnoblur turns the blur off to measure its cost
//  - nothing draws while the window is hidden or covered (the browser stops frames; we also skip on document.hidden)
(function () {
  const q = new URLSearchParams(location.search);
  const BG = q.has('bg'), BEACON = q.has('fpsbeacon') || BG;
  const SCALE = +(q.get('bgscale') || 32);   // (perf pass 2026-10-21: 1/32 at 12 fps = cheapest under budget, tests/test_bg_perf_budget.py)
  const raw = window.requestAnimationFrame.bind(window);
  let gate = -1, frames = 0, t0 = performance.now(), blur = null, bctx = null;
  function copyBlur() {
    const gl = document.getElementById('gl');
    if (!gl || !gl.width) return;
    if (!blur) {
      blur = document.createElement('canvas'); blur.id = 'bgblur';
      document.body.prepend(blur); bctx = blur.getContext('2d', { alpha: false });
    }
    if (blur.width !== gl.width || blur.height !== gl.height) { blur.width = gl.width; blur.height = gl.height; }
    bctx.filter = 'blur(' + Math.max(1, Math.round(16 / SCALE)) + 'px) saturate(1.35)';
    bctx.drawImage(gl, 0, 0);
  }
  // Frame gate: FPS cap (?bgfps, default DEFAULT_FPS), 5 fps while no music plays, 0 while hidden/covered or a fullscreen game has focus.
  const CAP = +(q.get('bgfps') || 12), IDLE_FPS = 5;
  let paused = false, next = 0, lastDraw = -1;
  const stats = window.__bgStats = { frames: 0, renderMs: 0, maxMs: 0 };
  window.requestAnimationFrame = function (cb) {
    return raw(function tick(t) {
      if (BG) {
        if (document.hidden || paused) return raw(tick);
        const a = window.loft && window.loft.audio, fps = a && a.playing ? CAP : IDLE_FPS;
        if (t !== gate && t < next) return raw(tick);   // one gate per frame: every callback of a passing frame runs
        if (t !== gate) { gate = t; const P = 1000 / fps; next = t - next > P ? t + P - 8 : next + P; }   // (steady grid; the old max(.., t+P/2) let 20 fps through a 12 cap)
      }
      if (cb.name !== 'frame') return cb(t);
      if (BG && t === lastDraw) return raw(tick);   // (the cap leaked: two draw loops queued in one frame both drew; one draw per gate)
      lastDraw = t;
      const s0 = performance.now(); cb(t); const ms = performance.now() - s0;   // main.js's draw loop: its CPU time per frame
      stats.frames++; stats.renderMs += ms; if (ms > stats.maxMs) stats.maxMs = ms;
      frames++; if (window.__bgFrame) window.__bgFrame();
      if (BG && q.has('bgcopy')) copyBlur();   // (?bgcopy: 2D-copy path; headless screenshots need it, a WebGL buffer is not kept)
    });
  };
  if (BG) setInterval(function () {
    if (document.hidden) return;
    fetch('http://127.0.0.1:8050/v2/fg', { cache: 'no-store' }).then(r => r.json()).then(j => { paused = !!j.fullscreen_other; }).catch(function () { paused = false; });
  }, 2000);
  if (BEACON) setInterval(function () {
    const now = performance.now(), fps = frames * 1000 / (now - t0); frames = 0; t0 = now;
    if (!document.hidden) fetch('http://127.0.0.1:8050/v2/fps?n=' + fps.toFixed(1) + '&scale=' + (BG ? SCALE : 1), { mode: 'no-cors' }).catch(function () {});
  }, 5000);
  if (!BG) return;
  document.documentElement.classList.add('bgmode');
  const css = document.createElement('style');
  css.textContent = 'html.bgmode body > *:not(#gl):not(#bgblur):not(#vigil):not(#bgctl):not(#bgfps):not(script):not(style){visibility:hidden!important}' +
    'html.bgmode #gl{visibility:visible!important;position:fixed;inset:0;width:100vw!important;height:100vh!important;opacity:.85;filter:blur(' + (q.has('bgnoblur') ? 0 : +(q.get('bgblur') || 13)) + 'px) saturate(1.35);z-index:0}' +
    'html.bgmode #bgblur{position:fixed;inset:0;width:100vw;height:100vh;visibility:visible;opacity:.85;image-rendering:auto;z-index:0}' +
    'html.bgmode,html.bgmode body{background:#05000a!important;cursor:default}' +
    (q.has('bgcopy') ? 'html.bgmode #gl{visibility:hidden!important}' : '') +
    '#bgctl{position:fixed;left:50%;bottom:calc(21vh + 16px);transform:translateX(-50%);z-index:3;display:flex;gap:8px;align-items:center;padding:8px 12px;border-radius:12px;background:rgba(3,0,8,.6);border:1px solid rgba(214,61,255,.55);box-shadow:0 0 10px rgba(255,61,242,.3);font:600 14px Segoe UI,sans-serif;color:#e9d7ff;visibility:visible!important}' +
    '#bgctl button{background:none;border:1px solid rgba(180,92,255,.6);color:#ff3df2;border-radius:8px;width:42px;height:34px;font-size:16px;cursor:pointer}#bgctl button:hover{background:rgba(180,92,255,.2)}' +
    '#bgctl span{max-width:28vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 6px}' +
    '#bgfps{position:fixed;top:calc(8px + 24vh + 5px);left:calc(8px + 26vw + 5px);z-index:3;pointer-events:none;font:600 12px Consolas,monospace;color:rgba(214,61,255,.7);text-shadow:0 0 6px rgba(255,61,242,.5);visibility:visible!important}' +
    'html.bgmode #vigil{position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2;pointer-events:none;background:transparent}' +
    'html.bgmode body::after{content:"";position:fixed;inset:0;z-index:1;pointer-events:none;background:radial-gradient(ellipse at center,rgba(140,0,190,.10),rgba(30,0,25,.35))}';
  document.head.appendChild(css);
  function mount() {
    if (document.getElementById('vigil') || q.has('novigil')) return;   // (?novigil: the background alone)
    fetch('http://127.0.0.1:8050/ping', { mode: 'no-cors' }).then(function () {
      const f = document.createElement('iframe'); f.id = 'vigil'; f.src = 'http://127.0.0.1:8050/v2?overlay' + (q.get('layout') ? '&layout=' + q.get('layout') : '') + (q.get('gap') ? '&gap=' + q.get('gap') : ''); f.setAttribute('allowtransparency', 'true');
      document.body.appendChild(f);
    }).catch(function () { setTimeout(mount, 5000); });
  }
  // Music controls: clickable (not click-through), in the open center above the bottom strip. They press the Loft's own keys.
  function controls() {
    if (document.getElementById('bgctl')) return;
    const c = document.createElement('div'); c.id = 'bgctl';
    const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    [['\u23EE', 'p', 'Previous (P)'], ['\u23EF', ' ', 'Play / pause (Space)'], ['\u23ED', 'n', 'Next (N)']].forEach(([s, k, t]) => {
      const b = document.createElement('button'); b.textContent = s; b.title = t; b.onclick = () => key(k); c.appendChild(b); });
    const name = document.createElement('span'); name.textContent = '-'; c.appendChild(name);
    document.body.appendChild(c);
    setInterval(() => { const t = document.getElementById('card-title'); const v = t && t.textContent.trim(); if (v && v !== name.textContent) name.textContent = v; }, 2000);
  }
  // Live FPS: counted from main.js's own draw loop (frames rendered), shown every 500 ms; tiny, click-through, in the open center's top-left corner
  let fpsFrames = 0, fpsT = performance.now(); const fpsCount = () => { fpsFrames++; };
  window.__bgFrame = fpsCount;
  function fpsTag() {
    if (document.getElementById('bgfps')) return;
    const e = document.createElement('div'); e.id = 'bgfps'; e.textContent = '-- FPS'; document.body.appendChild(e);
    setInterval(() => { const now = performance.now(); e.textContent = Math.round(fpsFrames * 1000 / (now - fpsT)) + ' FPS'; fpsFrames = 0; fpsT = now; }, 500);
  }
  const start = () => { mount(); controls(); fpsTag(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
