// Talk to Oasis in the Loft. The room's moves go through the Loft's own handle
// (window.loft) and its own keys, so the Loft's code never needs to know Oasis exists.
import { talk } from './talk.js';

const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
const $ = (id) => document.getElementById(id);

function ready() {
  const L = window.loft;
  if (!L || !L.audio) { setTimeout(ready, 300); return; }
  talk({
    name: 'loft',
    play(s) { L.play(s.name, { announced: true }); },   // (Oasis already said its name: the announcer doesn't say it again)
    playing() {
      if (!L.audio.playing) return null;
      const name = $('np-title').textContent;
      return { name, short: name.replace(/\s+[—–-]\s+\d{4}\b.*$/, '').replace(/\s*\(\d+\)$/, ''), primary: L.mood && L.mood.song && L.mood.song.primary };
    },
    pause() { if (L.audio.playing) key(' '); },
    resume() { if (!L.audio.playing) key(' '); },
    next() { key('n'); },
    prev() { key('p'); },
    shuffle() { key('s'); },
    dislike() { L.dislike(); },
    timer(min) { L.sleep(min); },   // (X marks a chill now; never press it for this)
    lyrics(on) { if (on === document.body.classList.contains('no-lyrics')) key('t'); },
    volume(dv) {
      const el = $('vol');
      el.value = Math.max(0, Math.min(1, +el.value + dv));
      el.dispatchEvent(new Event('input'));
    },
    duck(on) { if (L.audio.setDuck) L.audio.setDuck(on); },
    drop() {
      const t = L.audio.rawTime(), d = ((L.map && L.map.drops) || []).find((x) => x.t > t + 2);
      if (!d) return 'No drop left in this one.';
      L.seek(Math.max(t, d.t - 6));   // (never backwards)
      return 'Hold on. Six seconds.';
    },
  });
}
ready();
