// The conductor reads the song map at the heard time and hands every visual one
// object per frame: where we are in the beat/bar/section, what just hit, what
// is coming (build-ups before drops), and smoothed band levels.

// Index of the last element <= t, or -1.
export function bsearch(arr, t) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

const countIn = (arr, t0, t1) => (arr && arr.length ? bsearch(arr, t1) - bsearch(arr, t0) : 0);

export class Conductor {
  constructor() {
    this.map = null;
    this.prevT = -1;
    this.live = { low: 0, mid: 0, high: 0, peakLow: 0.2, peakMid: 0.2, peakHigh: 0.2 };
    this.f = this._blank();
  }

  _blank() {
    return {
      t: 0, playing: false, hasMap: false, bpm: 0, beatLen: 0.5, barLen: 2,
      beatIdx: -1, beatPhase: 0, barIdx: -1, barPhase: 0, beatInBar: 0,
      sectionIdx: -1, section: null, level: 0, energy: 0, sectionProgress: 0,
      beatHit: false, barHit: false, sectionHit: false, dropHit: false, kickHit: false, hatHit: false, onsetHit: false,
      kick: 0, beat: 0, hat: 0, onset: 0, low: 0, mid: 0, high: 0, build: 0, toDrop: Infinity, jumped: false,
      buildWeight: 0, tension: 0, dropStrength: 0, drop: null, reign: -1, reignDrop: null, nextDrop: null, toEnd: Infinity,
    };
  }

  setMap(map) {
    this.map = map;
    this.prevT = -1;
    this.f = this._blank();
    if (map) {
      this.f.hasMap = true;
      this.f.bpm = map.bpm;
      this.f.beatLen = map.bpm ? 60 / map.bpm : 0.5;
      this.f.barLen = this.f.beatLen * 4;
      // Which beat the first downbeat is, so beatInBar counts real beats (a swung
      // or drifting bar must not put the backbeat on 1 or 3).
      this.db0 = map.downbeats.length ? bsearch(map.beats, map.downbeats[0] + 1e-4) : 0;
    }
  }

  env(name, t) {
    const m = this.map;
    if (!m || !m.env[name] || !m.env[name].length) return 0;
    const arr = m.env[name];
    const x = (t - m.offset) * m.fps;
    const i = Math.floor(x);
    if (i < 0) return arr[0];
    if (i >= arr.length - 1) return arr[arr.length - 1];
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  }

  update(t, dt, spectrum, playing, sampleRate = 48000) {
    const f = this.f, m = this.map;
    f.t = t; f.playing = playing;
    f.beatHit = f.barHit = f.sectionHit = f.dropHit = f.kickHit = f.hatHit = f.onsetHit = false;
    const jumped = this.prevT < 0 || t < this.prevT - 0.001 || t - this.prevT > 0.25;
    f.jumped = jumped && this.prevT >= 0;
    const t0 = jumped ? t : this.prevT;

    // Live levels from the analyser with slow auto-gain.
    if (spectrum && playing) {
      const binHz = sampleRate / 2048;
      const band = (a, b) => {
        let s = 0, n = 0;
        for (let k = Math.max(1, Math.round(a / binHz)); k <= Math.round(b / binHz) && k < spectrum.length; k++) { s += spectrum[k]; n++; }
        return n ? s / n / 255 : 0;
      };
      const L = this.live;
      const lo = band(30, 150), mi = band(150, 2500), hi = band(2500, 12000);
      L.peakLow = Math.max(lo, L.peakLow * Math.exp(-dt * 0.15), 0.05);
      L.peakMid = Math.max(mi, L.peakMid * Math.exp(-dt * 0.15), 0.05);
      L.peakHigh = Math.max(hi, L.peakHigh * Math.exp(-dt * 0.15), 0.05);
      L.low = lo / L.peakLow; L.mid = mi / L.peakMid; L.high = hi / L.peakHigh;
    } else {
      this.live.low *= 0.9; this.live.mid *= 0.9; this.live.high *= 0.9;
    }

    if (!m) {
      f.low = this.live.low; f.mid = this.live.mid; f.high = this.live.high;
      f.energy += ((playing ? 0.5 : 0.1) - f.energy) * Math.min(1, dt * 2);
      f.kick *= Math.exp(-dt * 7);
      this.prevT = t;
      return f;
    }

    // Beat / bar position.
    const bi = bsearch(m.beats, t);
    f.beatIdx = bi;
    if (bi >= 0 && bi + 1 < m.beats.length) {
      f.beatLen = Math.max(1e-3, m.beats[bi + 1] - m.beats[bi]);   // (two beats on one frame must not make NaN)
      f.beatPhase = (t - m.beats[bi]) / f.beatLen;
    } else f.beatPhase = bi >= 0 ? Math.min(1, (t - m.beats[bi]) / f.beatLen) : 0;
    const di = bsearch(m.downbeats, t);
    f.barIdx = di;
    if (di >= 0 && di + 1 < m.downbeats.length) {
      f.barLen = Math.max(1e-3, m.downbeats[di + 1] - m.downbeats[di]);
      f.barPhase = (t - m.downbeats[di]) / f.barLen;
    } else f.barPhase = di >= 0 ? Math.min(1, (t - m.downbeats[di]) / f.barLen) : 0;
    f.beatInBar = bi >= 0 ? (((bi - (this.db0 || 0)) % 4) + 4) % 4 : 0;

    // Section.
    let si = -1;
    for (let i = 0; i < m.sections.length; i++) if (t >= m.sections[i].start) si = i;
    const sec = m.sections[Math.max(0, si)];
    if (si !== f.sectionIdx) {
      if (!jumped && f.sectionIdx !== -1) { f.sectionHit = true; f.dropHit = !!sec.drop && !(m.drops && m.drops.length); }   // the drop list (below) has every drop, sections included
      f.sectionIdx = si;
    }
    f.section = sec;
    f.level = sec.level;
    f.sectionProgress = (t - sec.start) / Math.max(0.01, sec.end - sec.start);
    f.energy += (sec.energy - f.energy) * Math.min(1, dt * 3);

    // Look ahead: a drop coming up is a build, from where its build began (the
    // bass pulled out, the risers climbing) to the hit. It's felt from its first
    // bar and tightens toward the end (u^1.35), and it's as big as its drop: a real
    // drop builds fully, the bass coming back after a one-bar fill barely at all.
    // tension: the build's last bar, when the room holds its breath.
    // reign: through a big drop's loud stretch, how far in (0..1), else -1.
    f.toDrop = Infinity; f.build = 0; f.buildWeight = 0; f.tension = 0; f.dropStrength = 0;
    f.reign = -1; f.reignDrop = null; f.nextDrop = null;
    f.toEnd = (m.duration || Infinity) - t;
    if (m.drops && m.drops.length) {
      const k = m.drops.findIndex((d) => d.t > t);
      const d = k >= 0 ? m.drops[k] : null;
      if (d && t >= d.buildStart) {
        const u = Math.min(1, (t - d.buildStart) / Math.max(0.5, d.t - d.buildStart));
        const w = d.size == null ? 1 : Math.max(0, Math.min(1, (d.size - 0.15) / 0.4));
        f.toDrop = d.t - t; f.build = Math.pow(u, 1.35) * w; f.buildWeight = w; f.dropStrength = d.strength; f.nextDrop = d;
        f.tension = w * Math.max(0, Math.min(1, 1 - f.toDrop / f.barLen));
      }
      // The latest big drop still in its loud stretch reigns (a smaller drop landing
      // inside it doesn't cut it short).
      for (let j = (k < 0 ? m.drops.length : k) - 1; j >= 0; j--) {
        const dd = m.drops[j];
        if (dd.big && t < dd.end) { f.reign = (t - dd.t) / Math.max(0.5, dd.end - dd.t); f.reignDrop = dd; break; }
      }
      const hit = jumped ? null : m.drops.find((dd) => dd.t > t0 && dd.t <= t);
      if (hit) {
        f.dropHit = true;
        f.dropStrength = hit.strength || 0.8;
      }
      f.drop = hit || null;
    } else for (let i = Math.max(0, si + 1); i < m.sections.length; i++) {
      const nx = m.sections[i];
      if (nx.start - t > f.barLen * 4.05) break;
      if (nx.drop || nx.energy - sec.energy > 0.3) {
        f.toDrop = nx.start - t;
        f.build = Math.max(0, Math.min(1, 1 - f.toDrop / (f.barLen * 4)));
        break;
      }
    }

    // A big drop's loud stretch is the song at its fullest, whatever the sections say.
    if (f.reign >= 0) { f.level = 3; f.energy += (Math.max(sec.energy, 0.9) - f.energy) * Math.min(1, dt * 3); }

    // Events crossed since last frame.
    if (!jumped) {
      f.beatHit = countIn(m.beats, t0, t) > 0;
      f.barHit = countIn(m.downbeats, t0, t) > 0;
      f.kickHit = countIn(m.kicks, t0, t) > 0;
      f.hatHit = countIn(m.hats, t0, t) > 0;
      f.onsetHit = countIn(m.onsets, t0, t) > 0;
    }
    const since = (arr) => { const i = bsearch(arr, t); return i >= 0 ? t - arr[i] : 99; };
    f.kick = Math.exp(-since(m.kicks) * 9) * (0.5 + 0.5 * this.env('low', t));
    f.beat = Math.exp(-since(m.beats) * 6);
    f.hat = Math.exp(-since(m.hats) * 16);
    f.onset = Math.exp(-since(m.onsets) * 12);

    // Band levels: the precomputed envelope is exact; the live analyser adds sparkle.
    const mix = (pre, live) => 0.65 * pre + 0.35 * Math.min(1.5, live);
    f.low = mix(this.env('low', t), this.live.low);
    f.mid = mix(this.env('mid', t), this.live.mid);
    f.high = mix(this.env('high', t), this.live.high);

    this.prevT = t;
    return f;
  }
}
