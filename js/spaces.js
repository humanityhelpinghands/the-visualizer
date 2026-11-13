// The other space, opened inside the Loft so the music never stops: the Atlas (your world as
// a star map) fades in over the room, which rests underneath. Resting the mouse on the door loads that space quietly, so the click opens it at once; once
// loaded it's kept (asleep) for the next visit. The Atlas plays songs in the Loft: hovering a
// song's star warms it, clicking it plays it.
const SPACES = {
  atlas: { src: '/spaces/atlas/atlas.html', full: true },
};

const css = document.createElement('style');
css.textContent = `
#doors { display: inline-flex; gap: 6px; margin-left: 14px; pointer-events: auto; }
#doors button { font: 600 10px var(--text); letter-spacing: 0.22em; color: var(--dim); background: rgba(255,255,255,0.05); border: 0; border-radius: 999px; padding: 5px 10px; cursor: pointer; box-shadow: inset 0 0 0 1px var(--line); transition: color .2s, background .2s; }
#doors button:hover, #doors button.on { color: var(--ink); background: rgba(255,255,255,0.1); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent); }
.space { position: fixed; border: 0; opacity: 0; pointer-events: none; transition: opacity .7s ease, transform .7s ease, filter .7s ease; background: transparent; }
.space.full { inset: 0; width: 100%; height: 100%; z-index: 40; transform: scale(1.04); filter: blur(6px); background: #000; }
.space.open { opacity: 1; pointer-events: auto; transform: none; filter: none; }
#gl { transition: filter .7s ease; }
body.away #gl { filter: brightness(0.15) blur(4px); }
.space-back { position: fixed; top: 18px; right: 20px; z-index: 41; font: 600 10px var(--text); letter-spacing: .22em; color: var(--ink); background: rgba(12,8,28,.6); border: 0; border-radius: 999px; padding: 7px 13px; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); backdrop-filter: blur(8px); opacity: 0; pointer-events: none; transition: opacity .5s .3s; }
body.away .space-back { opacity: 1; pointer-events: auto; }`;
document.head.appendChild(css);

const frames = {};
let openNow = null;
const back = document.createElement('button');
back.className = 'space-back'; back.textContent = '← THE VISUALIZER';
document.body.appendChild(back);

// A space loads once (on the first rest of the mouse on its door, or the first open) and is kept.
function frame(name) {
  if (frames[name]) return frames[name];
  const f = document.createElement('iframe');
  f.className = 'space ' + (SPACES[name].full ? 'full' : 'card');
  f.src = SPACES[name].src;
  f.setAttribute('allow', 'geolocation');
  document.body.appendChild(f);
  f.addEventListener('load', () => f.contentWindow.postMessage({ space: openNow === name ? 'wake' : 'sleep' }, '*'));
  return (frames[name] = f);
}

function open(name, keep = false) {
  if (openNow === name) return keep ? undefined : close();
  if (openNow) close(true);
  const f = frame(name), full = SPACES[name].full;
  openNow = name;
  f.contentWindow?.postMessage({ space: 'wake' }, '*');
  requestAnimationFrame(() => f.classList.add('open'));
  document.querySelector(`#doors [data-space="${name}"]`)?.classList.add('on');
  if (full) {
    document.body.classList.add('away');
    setTimeout(() => { if (openNow === name) window.loft?.rest(true); }, 700);   // (the room fades out first, then rests)
    f.focus();
  }
}
function close(quick = false) {
  if (!openNow) return;
  const name = openNow, f = frames[name];
  openNow = null;
  window.loft?.rest(false);
  document.body.classList.remove('away');
  f.classList.remove('open');
  document.querySelector(`#doors [data-space="${name}"]`)?.classList.remove('on');
  setTimeout(() => { if (openNow !== name) f.contentWindow?.postMessage({ space: 'sleep' }, '*'); }, quick ? 0 : 700);
}

for (const b of document.querySelectorAll('#doors button[data-space]')) {
  let t = 0;
  b.addEventListener('mouseenter', () => { t = setTimeout(() => frame(b.dataset.space), 150); });   // the hover load
  b.addEventListener('mouseleave', () => clearTimeout(t));
  b.addEventListener('click', () => open(b.dataset.space));
}
back.addEventListener('click', () => close());
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'a') open('atlas');
  else if (k === 'escape' && openNow) { e.stopImmediatePropagation(); close(); }
}, true);

// Messages from inside a space: the Atlas pointing at songs, or asking to go back.
const pick = (name) => {
  const all = window.loft?.tracks || [], n = String(name ?? '').trim().toLowerCase();
  if (!n) return undefined;   // (an empty name must not play the first song)
  return all.find((t) => t.toLowerCase() === n) || all.find((t) => t.toLowerCase().startsWith(n) && !/cover/i.test(t)) || all.find((t) => t.toLowerCase().startsWith(n));
};
addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
  const { loft: ask, name } = e.data;
  if (ask === 'warm') { const t = pick(name); if (t) window.loft?.warm(t); }
  else if (ask === 'play') { const t = pick(name); if (t) { window.loft?.play(t); close(); } }
  else if (ask === 'back') close();
  else if (ask === 'arrived') { close(); window.loft?.arrive(name); }
});

// For Oasis (hold M): "take me to the Atlas", "back to the Loft".
window.loftSpaces = { open, close, current: () => openNow };
