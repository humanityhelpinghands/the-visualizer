// feels it. Everything about the job lives in the key itself: a thin line along its bottom fills as it goes, its note says the
// percent; a click while it runs asks once more before it stops; done, the note says so and a click shows the file. No band, no
// toast, no glow. The full sentence (minutes left, why it stopped) is the key's hover title.

const post = (step, body) => fetch('/api/render/' + step, { method: 'POST', body: body ? JSON.stringify(body) : '' })
  .then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));

export function plain(err) {
  const e = String(err || '');
  if (/already running/.test(e)) return 'A video is already being made.';
  if (/No space|disk/i.test(e)) return 'The disk is full: free about 12 GB, then click to try again.';
  if (/closed (mid-song|before)/.test(e)) return 'The hidden drawing window closed partway: click to start the song over.';
  if (/no Brave/.test(e)) return 'No Brave, Chrome or Edge on this PC to draw in.';
  if (/not on the shelf|not found/.test(e)) return 'That song is not in the music folder any more.';
  return 'The video stopped: ' + e.slice(0, 120) + '. Click to start it over.';
}

// What the key shows for a job state: its note, the fill (0 to 1, or null for none), the hover sentence, and what a click does.
export function keyView(s, minutesLeft = '') {
  const song = s.song || 'this song';
  if (s.state === 'starting') return { note: '(starting)', fill: 0.01, title: `Making the X video of ${song}: opening the hidden drawing window`, click: 'stop' };
  if (s.state === 'drawing' || s.state === 'encoding') {
    const of = s.frames || 1, done = s.done || 0, measuring = /measur/.test(s.step || '');
    const fill = s.state === 'drawing' ? 0.88 * done / of : measuring ? 0.9 + 0.1 * done / of : 0.89;
    const pct = Math.floor(100 * fill), kind = s.fast ? 'quick X video' : 'X video';
    const slow = s.polite && s.spare > 0;
    const why = !s.polite ? '' : slow ? ' While you watch it draws only when your room has time to spare, so the room stays smooth; it goes full speed when you pause or leave the window.'
      : ' It waits while your room is busy, so the room stays smooth, and goes on when there is time to spare, or when you pause or leave the window.';
    return { note: s.polite && s.state === 'drawing' ? `(${slow ? 'slow' : 'paused'}, ${pct}%)` : `(${pct}%)`, fill, click: 'stop',
      title: `Making the ${kind} of ${song}: ${pct}%${minutesLeft && !s.polite ? ', ' + minutesLeft : ''}. Click twice to stop.${why}` };
  }
  if (s.state === 'done') return { note: '(ready, open it)', fill: 1, click: 'reveal',
    title: `The X video of ${song} is ready${s.mb ? ': ' + s.mb + ' MB' : ''}${s.vmaf ? ', it looks ' + Number(s.vmaf).toFixed(1) + ' out of 100 the same as live' : ''}. Click to show the file.` };
  if (s.state === 'failed') return { note: '(stopped, try again)', fill: null, title: plain(s.error), click: 'start' };
  return { note: '(full)', fill: null, title: 'Make this whole song into a video for X, in the background, at full quality', click: 'start' };
}

export function initXVideo({ getSong }) {
  const key = document.getElementById('x-btn'), fastKey = document.getElementById('xfast-btn');
  let fast = false;
  let job = null, timer = 0, armed = 0, phaseT0 = 0, phaseDone0 = 0, phase = '', view = keyView({ state: 'idle' });

  function minutesLeft(s) {
    const now = Date.now() / 1000;
    const p = s.state === 'drawing' ? 'drawing' : (s.step || '');
    if (p !== phase) { phase = p; phaseT0 = now; phaseDone0 = s.done || 0; }
    const rate = s.state === 'drawing' && s.started ? (s.done || 0) / Math.max(1, now - s.started)
      : ((s.done || 0) - phaseDone0) / Math.max(1, now - phaseT0);
    if (!(rate > 0) || !s.frames) return '';
    let left = (s.frames - s.done) / rate;
    if (s.state === 'drawing') left *= 1.12;   // (then packing the last frames and measuring: about 12% more, measured on a 4:43 song)
    const m = Math.ceil(left / 60);
    return m <= 1 ? 'about a minute left' : `about ${m} minutes left`;
  }

  function draw(s) {
    view = keyView(s, s.state === 'drawing' || s.state === 'encoding' ? minutesLeft(s) : '');
    key.querySelector('small').textContent = armed ? '(click to stop)' : view.note;
    key.title = view.title;
    key.classList.toggle('on', view.click === 'stop');
    key.classList.toggle('filling', view.fill !== null);
    key.style.setProperty('--x-fill', view.fill === null ? '0' : Math.max(0.01, Math.min(1, view.fill)).toFixed(3));
    if (fastKey) fastKey.style.visibility = view.click === 'stop' ? 'hidden' : '';   // (one video at a time: its progress shows in the For X key; the key keeps its place so the row never shifts)
  }

  async function poll() {
    clearTimeout(timer);
    const s = await fetch('/api/render/status', { method: 'POST' }).then((r) => r.json()).catch(() => null);
    if (!s) { timer = setTimeout(poll, 3000); return; }
    const running = ['starting', 'drawing', 'encoding'].includes(s.state);
    if (s.state === 'stopped' || s.state === 'idle') { job = null; draw({ state: 'idle' }); return; }
    if (running || job) draw(s);   // (a finished or failed job shows in the page that watched it, or on a fresh load right after)
    if (running) { job = job || s.song; fast = !!s.fast; timer = setTimeout(poll, 2000); }
  }

  async function start(name) {
    if (!name) { draw({ state: 'failed', error: 'not found' }); return; }
    job = name; phase = '';
    draw({ state: 'starting', song: name, fast });
    const r = await post('song', { name, fast });
    if (!r.ok) {   // (another window's video is already running: show its progress, never a false "stopped")
      const s = await fetch('/api/render/status', { method: 'POST' }).then((x) => x.json()).catch(() => null);
      if (s && ['starting', 'drawing', 'encoding'].includes(s.state)) { job = s.song; fast = !!s.fast; poll(); return; }
      draw({ state: 'failed', error: r.error, song: name }); return;
    }
    poll();
  }

  key.onclick = async () => {
    if (view.click === 'stop') {   // (a second click within 3 s stops it; one stray click never throws a render away)
      if (!armed) { armed = setTimeout(() => { armed = 0; key.querySelector('small').textContent = view.note; }, 3000); key.querySelector('small').textContent = '(click to stop)'; return; }
      clearTimeout(armed); armed = 0;
      key.querySelector('small').textContent = '(stopping)';
      await post('cancel'); job = null; poll(); return;
    }
    if (view.click === 'reveal') { post('reveal'); job = null; draw({ state: 'idle' }); return; }
    const again = job && view.click === 'start' && view.note.startsWith('(stopped');
    if (!again) fast = false;   // (a stopped video starts over the way it was made; a new one from this key is the full one)
    start(again ? job : getSong());
  };
  if (fastKey) fastKey.onclick = () => { if (view.click === 'stop') return; fast = true; start(getSong()); };
  poll();   // (a video already being made when the window opens: show where it is)
}
