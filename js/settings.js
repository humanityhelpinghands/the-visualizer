// Esc menu and graphics: no knobs. The Loft picks the sharpest quality this PC holds
// with the card at most about two-thirds busy (the PC test), draws up to 90 frames a second (smoothness is part of the
// look, see below), and the heat watch steps quality down by
// itself if the card ever runs hot. Optimal is the default; there is nothing to set.
export const QUALITY = [
  { id: 'low', name: 'LOW', scale: 0.75, note: 'Drawn below screen size. Softest, coolest.' },
  { id: 'medium', name: 'MEDIUM', scale: 1, note: 'Screen size. Clean.' },
  { id: 'high', name: 'HIGH', scale: 1.25, note: 'A little supersampled. Fine lines stay steady.' },
  { id: 'ultra', name: 'ULTRA', scale: 1.5, note: 'The full "4K on 1080p" look.' },
];

// hooks: { prefs, applyScale(scale), setCap(fps), uncap(on), fps(), rendered(), gpu, benchScene() → restore() }
export function makeSettings(hooks) {
  const { prefs } = hooks;
  // (165 Hz: every 2nd refresh, 82.5 fps). At that pace a frame has 12 ms, which ULTRA's heaviest moments
  // (13 ms) overrun, so the sharpness tops out at HIGH (1.25x, still sharper than the screen): the card
  // stays about two-thirds busy, and the heat watch still steps down if it ever runs hot.
  const cap = 90;
  let best = prefs.get('bestQuality', 'high');   // what the PC test found (HIGH until it says otherwise)
  if (!QUALITY.some((q) => q.id === best)) best = 'high';
  if (best === 'ultra') best = 'high';
  let quality = best;                              // every visit starts at the best; the heat watch may step it down
  const apply = () => { hooks.applyScale(QUALITY.find((q) => q.id === quality).scale); hooks.setCap(cap); };
  apply();

  const box = document.createElement('div');
  box.id = 'menu';
  box.innerHTML = `
    <div class="menu-card">
      <div class="menu-main">
        <div class="menu-title">THE VISUALIZER</div>
        <button class="menu-btn main" data-go="resume">Resume</button>
        <button class="menu-btn" data-go="songs">Songs</button>
        <div class="menu-pair"><button class="menu-btn" data-go="fullscreen">Full screen</button><button class="menu-btn" data-go="keys">Keys</button></div>
        <button class="menu-btn" data-go="settings">Settings</button>
        <button class="menu-btn ghost" data-go="exit">Exit</button>
      </div>
      <div class="menu-settings">
        <div class="menu-title">GRAPHICS</div>
        <div class="set-label">QUALITY</div>
        <div class="set-auto" id="q-now"></div>
        <div class="set-note" id="q-note"></div>
        <div class="set-live" id="set-live"></div>
        <button class="menu-btn small" id="set-test">Test my PC</button>
        <div class="set-test" id="set-result"></div>
        <div class="set-label">OVER HOURS OF LISTENING</div>
        <div class="set-test" id="set-hist"></div>
        <button class="menu-btn ghost" data-go="back">Back</button>
      </div>
    </div>`;
  document.body.appendChild(box);
  const $ = (s) => box.querySelector(s);

  const paint = () => {
    const q = QUALITY.find((x) => x.id === quality);
    $('#q-now').textContent = `${q.name} · UP TO ${cap} FPS`;
    $('#q-note').textContent = quality === best
      ? `Picked for you. ${q.note} The sharpest this PC holds smoothly with the card well short of flat out. If the card ever runs hot, the Visualizer steps down by itself.`
      : `Stepped down from ${QUALITY.find((x) => x.id === best).name} while something else uses the graphics card. It steps back up by itself once frames run smooth again.`;
  };
  let liveT = 0;
  const live = () => {
    const r = hooks.rendered();
    $('#set-live').textContent = `${Math.round(hooks.fps())} FPS now · drawing ${r.w}×${r.h}`;
  };

  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) { if (e.target === box) close(); return; }
    if (b.dataset.go === 'resume') close();
    else if (b.dataset.go === 'exit') {   // the same as the window's X: the music fades, the window and the server close
      hooks.exit?.();
      fetch('/api/quit', { method: 'POST', body: '{}' }).catch(() => {}).finally(() => setTimeout(() => window.close(), 600));
    }
    else if (['songs', 'keys', 'fullscreen'].includes(b.dataset.go)) {   // the same as the keys L, ? and F
      close();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: { songs: 'l', keys: '?', fullscreen: 'f' }[b.dataset.go] }));
    }
    else if (b.dataset.go === 'settings') { box.classList.add('deep'); paint(); history(); }
    else if (b.dataset.go === 'back') box.classList.remove('deep');
    else if (b.id === 'set-test') test();
  });

  // The test: each quality drawn for a few seconds while the graphics card's own
  // time per frame is measured. Its load is that time against the frame limit's
  // budget (11.1 ms at 90). The pick is the sharpest (never ULTRA) that keeps the card
  // under ~70% loaded, so it idles between frames and stays cool instead of running flat out.
  // shares the card and makes every number here look worse. Every Loft checks in with
  // its server every 10 s (cache/presence.json, shared by every server in this folder).
  const me = Math.random().toString(36).slice(2);
  let others = 0;
  const hello = () => fetch('/api/here', { method: 'POST', body: JSON.stringify({ id: me }) }).then((r) => r.json()).then((j) => { others = j.others || 0; }, () => {});
  hello(); setInterval(hello, 10000);
  const countOthers = async () => { await hello(); return others; };
  let testing = false;
  async function test() {
    if (testing) return;
    testing = true;
    const btn = $('#set-test'), out = $('#set-result'), gpu = hooks.gpu, budget = 1000 / cap, res = [];
    btn.textContent = 'Testing…'; btn.disabled = true;
    const crowd = await countOthers();
    out.textContent = 'Loading the scream in Welcome to the Funeral (3:00), the heaviest stretch…';
    const back = await hooks.benchScene();   // the test runs on the busiest moment there is
    try {
      for (const q of QUALITY) {
        out.textContent = `Trying ${q.name}…`;
        hooks.applyScale(q.scale);
        await wait(600);   // settle
        gpu.start();
        const t0 = performance.now();
        await new Promise((done) => { const f = (now) => { if (now - t0 < 1200) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
        const m = gpu.stop();
        // The card's own time: the same frame drawn over and over with nothing else going
        // on (three rounds, the steadiest kept), so the browser's hiccups don't count.
        let ms = Infinity;
        for (let k = 0; k < 3; k++) { ms = Math.min(ms, hooks.drawTime(30)); await wait(80); }
        res.push({ q, ms, cpu: m.cpu, load: ms / budget });
      }
    } catch (err) {   // a failed measurement must not leave the button stuck on TESTING… (testing stayed true for good)
      out.textContent = 'The test could not finish: ' + err.message;
      btn.textContent = 'Test again'; btn.disabled = false; testing = false;
      return;
    } finally { hooks.uncap(false); back(); }
    if (res.some((r) => !isFinite(r.ms))) {
      out.innerHTML = "<p>This browser won't report the graphics card's timing, so the test can't measure it. HIGH is a safe pick for this PC.</p>";
      best = 'high';
    } else {
      // at 90 fps the card may be up to ~70% busy (HIGH on an RX 6600 XT: about two-thirds); ULTRA's
      // heaviest moments overrun a 90 fps frame, so it is never the pick
      const fit = [...res].reverse().find((r) => r.q.id !== 'ultra' && r.load <= 0.72), pick = fit || res[0];
      const cpu = res.reduce((a, r) => a + r.cpu, 0) / res.length;
      out.innerHTML = res.map((r) => `<div class="${r === pick ? 'best' : ''}"><span>${r.q.name}</span><b>card ${Math.round(r.load * 100)}% busy</b></div>`).join('')
        + `<p>${fit ? `Picked <b>${pick.q.name}</b>: the sharpest that keeps the card well short of flat out at up to ${cap} fps, so it stays cool.` : `Even LOW keeps the card busy at ${cap} fps, so LOW it is.`} The rest of each frame (${cpu.toFixed(1)} ms) is the browser working out the scene, the same at every quality.</p>`
        + (crowd ? `<p><b>Another Visualizer is open on this PC</b> (${crowd} more), sharing the card, so these numbers read high. Close it and test again for the true picture.</p>` : '');
      best = fit ? fit.q.id : 'low';
    }
    quality = best; prefs.set('bestQuality', best); apply(); paint();
    btn.textContent = 'Test again'; btn.disabled = false;
    testing = false;
  }

  // The frame-rate log by hour into a sitting (a gap of half an hour starts a new one):
  // if the later hours run slower than the first, the card is getting hot.
  async function history() {
    const el = $('#set-hist');
    let rows = [];
    try { rows = (await (await fetch('/api/perf')).json()).rows || []; } catch { /* no log yet */ }
    if (rows.length < 3) { el.innerHTML = '<p>Logging the frame rate of every minute you listen. Check back after a few songs.</p>'; return; }
    const hours = [];
    let start = 0, prev = 0;
    for (const r of rows) {
      if (r.at - prev > 1800) start = r.at;
      prev = r.at;
      const h = Math.min(4, Math.floor((r.at - start) / 3600));
      (hours[h] ||= { fps: 0, low: 0, n: 0 }); hours[h].fps += r.fps; hours[h].low += r.low; hours[h].n++;
    }
    const lines = hours.map((h, i) => h && `<div><span>${i === 4 ? 'HOUR 5+' : 'HOUR ' + (i + 1)}</span><b>${(h.fps / h.n).toFixed(0)} fps · worst ${(h.low / h.n).toFixed(0)} · ${h.n} min</b></div>`).filter(Boolean).join('');
    const first = hours[0], lastH = hours.filter(Boolean).pop();
    const drop = first && lastH !== first ? 1 - (lastH.low / lastH.n) / (first.low / first.n) : 0;
    el.innerHTML = lines + `<p>${rows.length} minutes logged. ${hours.filter(Boolean).length < 2 ? 'Listen past an hour in one sitting to see if it holds.' : drop > 0.12 ? `The worst frames get ${Math.round(drop * 100)}% slower in the later hours: the card may be running hot. The Visualizer steps down by itself when that happens (dusting the PC would help too).` : 'Steady over the hours: the card is keeping cool.'}</p>`;
  }

  function open() { box.classList.add('on'); box.classList.remove('deep'); paint(); live(); clearInterval(liveT); liveT = setInterval(live, 500); }
  function close() { if (testing) return; box.classList.remove('on', 'deep'); clearInterval(liveT); }
  // The heat watch (main.js) calls this: one step down, as far as LOW. No override:
  // a hot card is never worth it.
  function cool() {
    const i = QUALITY.findIndex((q) => q.id === quality);
    if (i <= 0) return null;
    quality = QUALITY[i - 1].id; apply(); paint();
    return QUALITY[i - 1].name;
  }
  function warm() {
    const i = QUALITY.findIndex((q) => q.id === quality), top = QUALITY.findIndex((q) => q.id === best);
    if (i >= top) return null;
    quality = QUALITY[i + 1].id; apply(); paint();
    return QUALITY[i + 1].name;
  }
  return { open, close, cool, warm, get quality() { return quality; }, toggle() { box.classList.contains('on') ? close() : open(); }, get isOpen() { return box.classList.contains('on'); }, test };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
