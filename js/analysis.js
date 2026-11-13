// Offline song analysis. Pure math, no DOM: runs in a Worker and in Node tests.
// Input: mono samples. Output: the song's map — beats, downbeats, kicks, onsets,
// sections (with drops), and per-frame band envelopes for lookahead visuals.

const N = 1024;     // FFT window
const HOP = 256;    // ~11.6 ms at 22.05 kHz
// Where inside a frame a transient sits when log-flux peaks, and how much later
// the kick-band power flux peaks on top of that. Both calibrated against
// synthetic hits at known times (tools/test_analysis.mjs).
const ONSET_POS = 0.58;
const KICK_LAG = 0.012;

function makeFFT(n) {
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cs = new Float32Array(n / 2), sn = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cs[i] = Math.cos((2 * Math.PI * i) / n);
    sn[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  // The input must be real and already sit in bit-reversed order: callers load
  // re[rev[i]] (and zero im), which saves the swap pass. Butterflies within a stage are
  // independent, so small stages run twiddle-major (same arithmetic, less loop
  // overhead); the result is bit-identical to the textbook loop order.
  // Twiddle 0 is exactly (1, -0), so its butterflies are a plain add and
  // subtract: identical values, up to the sign of a zero, which no magnitude
  // downstream can see. The first stage sees a real input (im is all zero).
  const fft = (re, im) => {
    for (let a = 0; a < n; a += 2) { const t = re[a + 1]; re[a + 1] = re[a] - t; re[a] += t; }
    for (let size = 4; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let a = 0; a < n; a += size) {
        const b = a + half, tr = re[b], ti = im[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
      if (half < 16) {
        for (let j = 1, k = step; j < half; j++, k += step) {
          const c = cs[k], s = sn[k];
          for (let a = j; a < n; a += size) {
            const b = a + half;
            const tr = re[b] * c - im[b] * s;
            const ti = re[b] * s + im[b] * c;
            re[b] = re[a] - tr; im[b] = im[a] - ti;
            re[a] += tr; im[a] += ti;
          }
        }
      } else if (size === n) {
        // Last stage: only bins below n/2 are ever read, so the upper half is skipped.
        for (let j = 1, k = step; j < half; j++, k += step) {
          const b = j + half;
          re[j] += re[b] * cs[k] - im[b] * sn[k];
          im[j] += re[b] * sn[k] + im[b] * cs[k];
        }
      } else {
        for (let i = 0; i < n; i += size) {
          for (let j = 1, k = step; j < half; j++, k += step) {
            const a = i + j, b = a + half;
            const tr = re[b] * cs[k] - im[b] * sn[k];
            const ti = re[b] * sn[k] + im[b] * cs[k];
            re[b] = re[a] - tr; im[b] = im[a] - ti;
            re[a] += tr; im[a] += ti;
          }
        }
      }
    }
  };
  fft.rev = rev;
  return fft;
}

function hypot2(x, y) {
  // The larger term scales to exactly 1, so only the smaller one is divided.
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax > ay) { const b = ay / ax; return Math.sqrt(1 + b * b) * ax; }
  if (ay === 0) return 0;
  const a = ax / ay;
  return Math.sqrt(a * a + 1) * ay;
}

function percentile(arr, p) {
  const s = Float32Array.from(arr).sort();
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

function meanStd(arr) {
  let m = 0;
  for (const v of arr) m += v;
  m /= arr.length || 1;
  let s = 0;
  for (const v of arr) s += (v - m) * (v - m);
  return [m, Math.sqrt(s / (arr.length || 1))];
}

// Subtract a moving average and half-wave rectify: keeps the spikes, drops the hum.
function adaptive(x, win) {
  const n = x.length, pre = new Float64Array(n + 1), out = new Float32Array(n);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - win), b = Math.min(n, i + win + 1);
    out[i] = Math.max(0, x[i] - (pre[b] - pre[a]) / (b - a));
  }
  return out;
}

function normalizeTo(x, p = 0.98) {
  const top = percentile(x, p) || 1;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.min(1.5, x[i] / top);
  return out;
}

// Divide by a rolling max (sparse table would be faster; songs are short enough).
function localNormalize(x, win, floor) {
  const n = x.length, out = new Float32Array(n), blk = Math.max(1, win >> 3);
  const bm = new Float32Array(Math.ceil(n / blk));
  for (let i = 0; i < n; i++) bm[(i / blk) | 0] = Math.max(bm[(i / blk) | 0], x[i]);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, ((i - win) / blk) | 0), b = Math.min(bm.length - 1, ((i + win) / blk) | 0);
    let m = floor;
    for (let j = a; j <= b; j++) if (bm[j] > m) m = bm[j];
    out[i] = Math.min(1, x[i] / m);
  }
  return out;
}

function pickPeaks(x, fps, { minGap = 0.1, k = 1.2, win = 0.6, floor = 0.15 } = {}) {
  const w = Math.round(win * fps), g = Math.round(minGap * fps), peaks = [];
  const n = x.length, pre = new Float64Array(n + 1), pre2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { pre[i + 1] = pre[i] + x[i]; pre2[i + 1] = pre2[i] + x[i] * x[i]; }
  let last = -1e9;
  for (let i = 2; i < n - 2; i++) {
    const v = x[i];
    if (v < floor || v < x[i - 1] || v < x[i + 1] || v < x[i - 2] || v < x[i + 2]) continue;
    const a = Math.max(0, i - w), b = Math.min(n, i + w + 1), c = b - a;
    const m = (pre[b] - pre[a]) / c, sd = Math.sqrt(Math.max(0, (pre2[b] - pre2[a]) / c - m * m));
    if (v < m + k * sd) continue;
    if (i - last < g) {
      if (peaks.length && v > x[last]) { peaks[peaks.length - 1] = i; last = i; }
      continue;
    }
    peaks.push(i); last = i;
  }
  return peaks;
}

// ── Harmony ──────────────────────────────────────────────────────────
// Krumhansl-Kessler key profiles: how strongly each scale degree belongs to a
// major or minor key, from listening experiments.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function pearson(a, b) {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
  ma /= 12; mb /= 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// Best key for a 12-bin chroma: { tonic, mode, score, lean } where lean > 0
// lean = how much brighter (major) than darker (minor) the music sounds.
function keyOf(chroma) {
  let best = { tonic: 0, mode: 'major', score: -2 }, bestMaj = -2, bestMin = -2;
  const prof = new Array(12);
  for (let t = 0; t < 12; t++) {
    for (const [mode, P] of [['major', MAJOR], ['minor', MINOR]]) {
      for (let i = 0; i < 12; i++) prof[i] = P[(i - t + 12) % 12];
      const c = pearson(chroma, prof);
      if (mode === 'major') bestMaj = Math.max(bestMaj, c); else bestMin = Math.max(bestMin, c);
      if (c > best.score) best = { tonic: t, mode, score: c };
    }
  }
  return { ...best, key: NOTES[best.tonic] + (best.mode === 'minor' ? 'm' : ''), lean: bestMaj - bestMin };
}

// Chroma from a finer FFT (4096 points, ~5 Hz bins at 22 kHz) every ~186 ms.
function chromaFrames(x, rate) {
  const NF = 4096, hop = 4096, fft = makeFFT(NF), rev = fft.rev;
  const win = new Float32Array(NF);
  for (let i = 0; i < NF; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NF);
  const binHz = rate / NF, k0 = Math.ceil(80 / binHz), k1 = Math.min(NF / 2 - 1, Math.floor(4000 / binHz));
  const pc = new Int8Array(NF / 2);
  for (let k = k0; k <= k1; k++) pc[k] = ((Math.round(69 + 12 * Math.log2((k * binHz) / 440)) % 12) + 12) % 12;
  const frames = Math.max(0, Math.floor((x.length - NF) / hop) + 1);
  const out = new Float32Array(frames * 12), re = new Float32Array(NF), im = new Float32Array(NF);
  for (let f = 0; f < frames; f++) {
    const o = f * hop;
    for (let i = 0; i < NF; i++) re[rev[i]] = x[o + i] * win[i];
    im.fill(0);
    fft(re, im);
    let sum = 0;
    for (let k = k0; k <= k1; k++) {
      const v = Math.log1p(200 * hypot2(re[k], im[k]) / NF);
      out[f * 12 + pc[k]] += v;
      sum += v;
    }
    if (sum > 0) for (let i = 0; i < 12; i++) out[f * 12 + i] /= sum;
  }
  return { out, frames, hopSec: hop / rate };
}

export function analyze(mono, sampleRate, onProgress = () => {}, opts = {}) {
  // 1. Decimate to ~22 kHz. Beats and sections live well below that.
  let x = mono, rate = sampleRate;
  while (rate > 32000) {
    const h = new Float32Array(x.length >> 1);
    for (let i = 0; i < h.length; i++) h[i] = 0.5 * (x[2 * i] + x[2 * i + 1]);
    x = h; rate /= 2;
  }
  const duration = mono.length / sampleRate;
  const fps = rate / HOP;
  const nF = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
  const toTime = (f) => (f * HOP + ONSET_POS * N) / rate;
  const toTimeK = (f) => toTime(f) - KICK_LAG;
  const toFrame = (t) => Math.max(0, Math.min(nF - 1, Math.round((t * rate - ONSET_POS * N) / HOP)));

  if (nF < 64) {
    return { duration, bpm: 0, fps, offset: ONSET_POS * N / rate, beats: new Float32Array(0), downbeats: new Float32Array(0),
      kicks: new Float32Array(0), onsets: new Float32Array(0), hats: new Float32Array(0), drops: [], chords: [],
      key: 'C', mode: 'major', keyConfidence: 0, lean: 0, tonic: 0,
      sections: [{ start: 0, end: duration, energy: 0.5, level: 1, drop: false }],
      env: { low: new Float32Array(0), mid: new Float32Array(0), high: new Float32Array(0), rms: new Float32Array(0), onset: new Float32Array(0) } };
  }

  // 2. Spectral pass.
  const fft = makeFFT(N), rev = fft.rev;
  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const re = new Float32Array(N), im = new Float32Array(N);
  const prev = new Float32Array(N / 2), prevP = new Float32Array(N / 2);
  const binHz = rate / N;
  const kLow0 = Math.max(1, Math.round(30 / binHz)), kLow1 = Math.round(150 / binHz);
  const kKick0 = Math.max(1, Math.round(40 / binHz)), kKick1 = Math.round(125 / binHz);
  const kMid1 = Math.round(2500 / binHz), kHigh1 = Math.min(N / 2, Math.round(11000 / binHz));
  const flux = new Float32Array(nF), highFlux = new Float32Array(nF);
  const kickFlux = new Float32Array(nF);
  const rms = new Float32Array(nF), low = new Float32Array(nF), mid = new Float32Array(nF), high = new Float32Array(nF);
  const scale = 4 / N;

  for (let f = 0; f < nF; f++) {
    const o = f * HOP;
    let e = 0;
    for (let i = 0; i < N; i++) {
      const s = x[o + i];
      e += s * s;
      re[rev[i]] = s * hann[i];
    }
    im.fill(0);
    rms[f] = Math.sqrt(e / N);
    fft(re, im);
    let fl = 0, hf = 0, kf = 0, lo = 0, mi = 0, hi = 0;
    for (let k = 1; k < N / 2; k++) {
      const mag = hypot2(re[k], im[k]) * scale;
      const lm = Math.log1p(100 * mag);
      const d = lm - prev[k];
      if (d > 0) {
        fl += d;
        if (k > kMid1 && k <= kHigh1) hf += d;
      }
      prev[k] = lm;
      const p = mag * mag;
      // Linear power flux in the kick band: loud low hits win, offbeat bass hums lose.
      if (k >= kKick0 && k <= kKick1 && p > prevP[k]) kf += p - prevP[k];
      prevP[k] = p;
      if (k >= kLow0 && k <= kLow1) lo += p;
      else if (k <= kMid1) mi += p;
      else if (k <= kHigh1) hi += p;
    }
    flux[f] = fl; highFlux[f] = hf; kickFlux[f] = kf;
    low[f] = Math.sqrt(lo); mid[f] = Math.sqrt(mi); high[f] = Math.sqrt(hi);
    if ((f & 1023) === 0) onProgress(0.7 * (f / nF));
  }

  // 3. Onset envelope, normalised by its spread.
  const onset = adaptive(flux, Math.round(0.25 * fps));
  const kickOn = normalizeTo(adaptive(kickFlux, Math.round(0.25 * fps)), 0.99);
  // Same kick, judged against its neighbours (±4 s), so a quiet verse's kicks
  // count as much as the drop's. Beat tracking leans on this.
  const kickLocal = localNormalize(kickOn, Math.round(4 * fps), 0.12);
  {
    const top = percentile(onset, 0.99) || 1;
    for (let i = 0; i < nF; i++) onset[i] = onset[i] / top + 2 * kickLocal[i];
    const [, sd] = meanStd(onset);
    for (let i = 0; i < nF; i++) onset[i] /= sd || 1;
  }
  const highOn = adaptive(highFlux, Math.round(0.25 * fps));
  onProgress(0.75);

  // 4. Tempo: autocorrelation with a soft prior around 120 BPM.
  const minL = Math.floor((60 / 200) * fps), maxL = Math.ceil((60 / 60) * fps);
  const acf = new Float32Array(2 * maxL + 3);
  {
    const [om] = meanStd(onset);
    const oc = onset.map((v) => v - om);
    for (let L = Math.max(1, Math.floor(minL / 2) - 1); L < acf.length && L < nF; L++) {
      let s = 0;
      for (let i = 0; i + L < nF; i++) s += oc[i] * oc[i + L];
      acf[L] = s / (nF - L);
    }
  }
  // Score each period by itself plus its double (a real beat repeats at 2P too),
  // so a pattern on beats 2 and 4 cannot drag us down an octave.
  let bestL = minL, bestV = -Infinity;
  for (let L = minL; L <= maxL; L++) {
    const bpm = (60 * fps) / L;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.7, 2));
    const v = (acf[L] + 0.5 * Math.max(acf[2 * L - 1] || 0, acf[2 * L] || 0, acf[2 * L + 1] || 0)) * w;
    if (v > bestV) { bestV = v; bestL = L; }
  }
  // Octave check: slow winner whose half-period is nearly as strong → go double time.
  const half = Math.round(bestL / 2);
  if ((60 * fps) / bestL < 90 && half >= minL) {
    const hv = Math.max(acf[half - 1], acf[half], acf[half + 1]);
    if (hv > 0.5 * acf[bestL]) bestL = acf[half - 1] > acf[half] && acf[half - 1] > acf[half + 1] ? half - 1 : acf[half + 1] > acf[half] ? half + 1 : half;
  }
  const a = acf[bestL - 1], b = acf[bestL], c = acf[bestL + 1];
  const den = a - 2 * b + c;
  const P0 = opts.forceBpm ? (60 * fps) / opts.forceBpm : bestL + (den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0);
  onProgress(0.8);
  const rmsTop = percentile(rms, 0.95) || 1;

  // 5. Beats: Ellis dynamic programming (follows drift, prefers strong onsets),
  // run for several tempo hypotheses: the autocorrelation winner and its 2:1,
  // 3:2 and 4:3 relatives. Swung hats and half-time grooves fool one guess, so
  // the grid whose beats sit on the strongest hits wins the vote.
  const track = (P, tight = 100) => {
    const score = new Float32Array(nF), back = new Int32Array(nF).fill(-1);
    const lo2 = Math.round(P / 2), hi2 = Math.round(2 * P);
    // The jump penalty depends only on the gap, so it is computed once per gap.
    const pen = new Float64Array(hi2 + 1);
    for (let d = Math.max(0, lo2); d <= hi2; d++) { const r = Math.log(d / P); pen[d] = tight * r * r; }
    for (let i = 0; i < nF; i++) {
      let best = -Infinity, bi = -1;
      for (let p = Math.max(0, i - hi2), pEnd = i - lo2; p <= pEnd; p++) {
        const s = score[p] - pen[i - p];
        if (s > best) { best = s; bi = p; }
      }
      score[i] = onset[i] + (bi >= 0 ? Math.max(0, best) : 0);
      back[i] = best > 0 ? bi : -1;
    }
    let end = nF - 1, endV = -Infinity;
    for (let i = Math.max(0, nF - Math.round(2 * P)); i < nF; i++) if (score[i] > endV) { endV = score[i]; end = i; }
    let beatF = [];
    for (let i = end; i >= 0; i = back[i]) beatF.push(i);
    beatF.reverse();

    // Kickless intros/outros are ambiguous on their own (offbeat hats look like
    // beats). Count them in the way a person would: carry the grid of the first
    // and last kick-confirmed stretches outward at the local period.
    const kicked = (f) => Math.max(kickLocal[Math.max(0, f - 2)], kickLocal[f], kickLocal[Math.min(nF - 1, f + 2)]) > 0.3;
    const confirmedRun = (i) => { let k = 0; for (let j = i; j < i + 8 && j < beatF.length; j++) if (kicked(beatF[j])) k++; return k >= 6; };
    // Least-squares line through a run of beats: fractional period, no drift.
    const fitLine = (i0, i1) => {
      i0 = Math.max(0, i0); i1 = Math.min(beatF.length - 1, i1);
      const n = i1 - i0 + 1;
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let j = i0; j <= i1; j++) { sx += j; sy += beatF[j]; sxx += j * j; sxy += j * beatF[j]; }
      const per = n > 1 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : P;
      return { per, at: (j) => (sy - per * sx) / n + per * j };
    };
    if (beatF.length > 24) {
      let first = -1;
      for (let i = 0; i + 8 <= beatF.length; i++) {
        if (confirmedRun(i)) { first = i; while (first < i + 4 && !(kicked(beatF[first]) && kicked(beatF[first + 1]))) first++; break; }
      }
      if (first > 0) {
        let before = 0;
        for (let j = 0; j < first; j++) if (kicked(beatF[j])) before++;
        if (before < first / 2) {
          const line = fitLine(first, first + 15), lead = [];
          for (let k = 1; ; k++) { const f = line.at(first - k); if (f < 0) break; lead.push(Math.round(f)); }
          beatF = lead.reverse().concat(beatF.slice(first));
        }
      }
      let last = -1;
      for (let i = beatF.length - 8; i >= 0; i--) {
        if (confirmedRun(i)) { last = i + 7; while (last > i + 3 && !(kicked(beatF[last]) && kicked(beatF[last - 1]))) last--; break; }
      }
      if (last > 0 && last < beatF.length - 1) {
        let after = 0;
        for (let j = last + 1; j < beatF.length; j++) if (kicked(beatF[j])) after++;
        if (after < (beatF.length - 1 - last) / 2) {
          const line = fitLine(last - 15, last), tail = [];
          for (let k = 1; ; k++) { const f = line.at(last + k); if (f >= nF) break; tail.push(Math.round(f)); }
          beatF = beatF.slice(0, last + 1).concat(tail);
        }
      }
    }

    // Trim beats in silence at either end.
    const smoothRms = (f) => {
      let s = 0, n = 0;
      for (let i = Math.max(0, f - 8); i <= Math.min(nF - 1, f + 8); i++) { s += rms[i]; n++; }
      return s / n / rmsTop;
    };
    while (beatF.length && smoothRms(beatF[0]) < 0.03) beatF.shift();
    while (beatF.length && smoothRms(beatF[beatF.length - 1]) < 0.03) beatF.pop();
    return beatF.filter((f) => f >= 0 && f < nF);
  };
  // Contrast: how much harder the song hits on the beats than halfway between.
  // A grid in the wrong 3:4 / 2:3 relation scores ~1x; the right one scores 5-20x.
  const s3 = new Float32Array(nF);
  for (let i = 0; i < nF; i++) s3[i] = Math.max(onset[Math.max(0, i - 1)], onset[i], onset[Math.min(nF - 1, i + 1)]);
  const contrast = (bf) => {
    let on = 0, off = 0;
    for (let i = 0; i + 1 < bf.length; i++) { on += s3[bf[i]]; off += s3[Math.round((bf[i] + bf[i + 1]) / 2)]; }
    return on / Math.max(off, 1e-6);
  };
  // Share of the kick drums that land on a beat. The felt beat rides the kick, so
  // a tempo switch must not knock the kicks off the grid (house music's loud
  // offbeat hats would otherwise make a 2:3 grid look quieter "between beats").
  const kickPk = pickPeaks(kickOn, fps, { minGap: 0.12, k: 1.0, floor: 0.2 });
  const tolF = Math.max(3, Math.round(0.05 * fps));
  const kickFit = (bf) => {
    if (kickPk.length < 16) return 1;
    let hit = 0, j = 0;
    for (const f of kickPk) {
      while (j + 1 < bf.length && bf[j + 1] <= f) j++;
      const d = Math.min(Math.abs(f - bf[j]), j + 1 < bf.length ? Math.abs(bf[j + 1] - f) : 1e9);
      if (d <= tolF) hit++;
    }
    return hit / kickPk.length;
  };
  // The octave comes from the autocorrelation + prior above and is trusted. The
  // vote only fixes 3:4 / 2:3 confusions (swung hats, triplet feels), and only
  // on clear evidence, so songs that already lock can't be talked out of it.
  const hypotheses = opts.forceBpm ? [1] : [1, 4 / 3, 3 / 4, 3 / 2, 2 / 3];
  const table = [];
  let first = null, best = null;
  for (const mult of hypotheses) {
    const bpmC = (60 * fps) / P0 * mult;
    if (!opts.forceBpm && mult !== 1 && (bpmC < 60 || bpmC > 200)) continue;
    const Pc = P0 / mult, bf = track(Pc);
    if (bf.length < 8) continue;
    const c = { bpm: bpmC, P: Pc, beatF: bf, contrast: contrast(bf), kicks: kickFit(bf) };
    table.push({ bpm: bpmC, contrast: c.contrast, kicks: c.kicks });
    if (mult === 1) first = c;
    else if (!best || c.contrast > best.contrast) best = c;
  }
  if (opts.debug) opts.debug.tempo = table;
  if (first && best && best.contrast > 1.5 * first.contrast && best.contrast > 2.5 && best.kicks >= 0.7 * first.kicks) first = best;   // a wrong 2:3 grid catches ~1/3 of a 4-on-the-floor kick
  best = first;
  if (!best) best = { P: P0, beatF: track(P0), bpm: (60 * fps) / P0 };
  const P = best.P, bpm = best.bpm;
  let beatF = best.beatF;
  onProgress(0.85);

  // 6. Envelopes for visuals, normalised per song.
  const env = {
    low: normalizeTo(low), mid: normalizeTo(mid), high: normalizeTo(high),
    rms: normalizeTo(rms), onset: normalizeTo(onset, 0.99),
  };

  // 7. Kicks and general onsets as discrete events.
  const lowN = kickOn, highN = normalizeTo(highOn, 0.99), onN = env.onset;
  const kicks = pickPeaks(lowN, fps, { minGap: 0.12, k: 1.0, floor: 0.2 }).map(toTimeK);
  const onsets = pickPeaks(onN, fps, { minGap: 0.07, k: 0.8, floor: 0.12 }).map(toTime);
  const hats = pickPeaks(highN, fps, { minGap: 0.06, k: 1.0, floor: 0.2 }).map(toTime);

  // 8. Downbeats: which of the 4 beat phases carries the most bass + change.
  const beatTimes = beatF.map(toTimeK);
  const nB = beatF.length;
  const near = (arr, f) => Math.max(arr[Math.max(0, f - 1)], arr[f], arr[Math.min(nF - 1, f + 1)]);
  // Beat-level novelty: loudness change across each beat (catches section starts).
  const loudAt = (f0, f1) => { let s = 0; for (let i = f0; i < f1; i++) s += rms[i]; return s / Math.max(1, f1 - f0); };
  const beatNov = new Float32Array(nB);
  for (let i = 0; i < nB; i++) {
    const f = beatF[i], w = Math.round(2 * P);
    const before = loudAt(Math.max(0, f - w), f), after = loudAt(f, Math.min(nF, f + w));
    beatNov[i] = Math.abs(Math.log((after + 1e-4) / (before + 1e-4)));
  }
  let phase = 0, phaseV = -Infinity;
  for (let ph = 0; ph < 4; ph++) {
    let s = 0, n = 0;
    for (let i = ph; i < nB; i += 4) { s += near(lowN, beatF[i]) + 0.5 * near(onN, beatF[i]) + 3 * beatNov[i]; n++; }
    s /= n || 1;
    if (s > phaseV) { phaseV = s; phase = ph; }
  }
  const downIdx = [];
  for (let i = phase; i < nB; i += 4) downIdx.push(i);
  const downbeats = downIdx.map((i) => beatTimes[i]);
  onProgress(0.9);

  // 9. Sections: bar-level features, novelty between 4-bar windows, greedy picks.
  const nBars = downbeats.length;
  let sections = [];
  if (nBars >= 4) {
    const feats = [];
    for (let k = 0; k < nBars; k++) {
      const f0 = toFrame(downbeats[k]);
      const f1 = k + 1 < nBars ? toFrame(downbeats[k + 1]) : Math.min(nF, f0 + Math.round(4 * P));
      let r = 0, l = 0, m = 0, h = 0, o = 0;
      const n = Math.max(1, f1 - f0);
      for (let i = f0; i < f1; i++) { r += rms[i]; l += env.low[i]; m += env.mid[i]; h += env.high[i]; o += onN[i]; }
      feats.push([Math.log(r / n + 1e-4), l / n, m / n, h / n, o / n]);
    }
    const dims = feats[0].length;
    for (let d = 0; d < dims; d++) {
      const col = feats.map((v) => v[d]);
      const [m, sd] = meanStd(col);
      for (const v of feats) v[d] = (v[d] - m) / (sd || 1);
    }
    feats.forEach((v) => (v[0] *= 1.6)); // loudness matters most
    const K = 4, nov = new Float32Array(nBars);
    for (let bIdx = 2; bIdx < nBars - 1; bIdx++) {
      const a0 = Math.max(0, bIdx - K), b1 = Math.min(nBars, bIdx + K);
      const ma = new Array(dims).fill(0), mb = new Array(dims).fill(0);
      for (let i = a0; i < bIdx; i++) for (let d = 0; d < dims; d++) ma[d] += feats[i][d] / (bIdx - a0);
      for (let i = bIdx; i < b1; i++) for (let d = 0; d < dims; d++) mb[d] += feats[i][d] / (b1 - bIdx);
      let s = 0;
      for (let d = 0; d < dims; d++) s += (ma[d] - mb[d]) ** 2;
      nov[bIdx] = Math.sqrt(s) * (bIdx % 4 === 0 ? 1.15 : 1);
    }
    // Robust threshold (median and MAD, not mean and spread): one huge change late
    // in a song (a breakdown into the last drop) used to raise the bar so high that
    // every verse/chorus boundary before it went unseen (Untitled read 0:00-2:53 as
    // one section).
    const nmed = percentile(nov, 0.5);
    const mad = percentile(Array.from(nov, (v) => Math.abs(v - nmed)), 0.5) * 1.4826;
    const cands = [];
    for (let i = 1; i < nBars - 1; i++) {
      if (nov[i] >= nov[i - 1] && nov[i] >= nov[i + 1] && nov[i] > nmed + 0.5 * mad) cands.push(i);
    }
    cands.sort((p, q) => nov[q] - nov[p]);
    const maxSections = Math.max(2, Math.round(duration / 14));
    const cuts = [];
    for (const cIdx of cands) {
      if (cuts.length >= maxSections - 1) break;
      if (cIdx < 4 || nBars - cIdx < 4) continue;   // a cut 2 bars from the end made a 1-bar "section" out of the fade-out
      if (cuts.every((u) => Math.abs(u - cIdx) >= 4)) cuts.push(cIdx);
    }
    cuts.sort((p, q) => p - q);
    const bounds = [0, ...cuts, nBars];
    const barLoud = feats.map((v) => v[0]);
    const lo5 = percentile(barLoud, 0.05), hi95 = percentile(barLoud, 0.95);
    for (let s = 0; s < bounds.length - 1; s++) {
      let e = 0;
      for (let i = bounds[s]; i < bounds[s + 1]; i++) e += barLoud[i];
      e /= bounds[s + 1] - bounds[s];
      const energy = Math.max(0, Math.min(1, (e - lo5) / (hi95 - lo5 || 1)));
      sections.push({
        start: s === 0 ? 0 : downbeats[bounds[s]],
        end: bounds[s + 1] >= nBars ? duration : downbeats[bounds[s + 1]],
        bar0: bounds[s], bars: bounds[s + 1] - bounds[s], energy,
      });
    }
  } else {
    sections.push({ start: 0, end: duration, bar0: 0, bars: nBars, energy: 0.6 });
  }
  sections.forEach((s, i) => {
    s.level = s.energy < 0.3 ? 0 : s.energy < 0.55 ? 1 : s.energy < 0.8 ? 2 : 3;
    const prevE = i > 0 ? sections[i - 1].energy : 0;
    s.drop = i > 0 && s.energy >= 0.65 && s.energy - prevE >= 0.2;
  });

  // 10. Harmony: the song's key and whether it leans major (open, bright) or
  // minor (aching, dark), for the whole song and for each section.
  const ch = chromaFrames(x, rate);
  const sumChroma = (t0, t1) => {
    const c = new Array(12).fill(0);
    const a = Math.max(0, Math.floor(t0 / ch.hopSec)), b = Math.min(ch.frames, Math.ceil(t1 / ch.hopSec));
    for (let f = a; f < b; f++) for (let i = 0; i < 12; i++) c[i] += ch.out[f * 12 + i];
    return c;
  };
  const songKey = keyOf(sumChroma(0, duration));
  for (const sec of sections) {
    const k = keyOf(sumChroma(sec.start, sec.end));
    sec.mode = k.mode;
    sec.lean = k.lean;
  }

  // 12. Drops and their build-ups, bar by bar from the low end. A drop is the bar
  // where the bass slams back in: well above the bars just before it, loud for
  // the song. Its build is the stretch before it where the low end thinned out
  // (producers pull the bass before a drop) or the highs climbed (risers, rolls).
  const frameOf = (t) => Math.max(0, Math.min(env.low.length - 1, Math.round((t - (ONSET_POS * N) / rate) * fps)));
  const barMean = (arr, i) => {
    const a = frameOf(downbeats[i]), b = Math.max(a + 1, frameOf(i + 1 < downbeats.length ? downbeats[i + 1] : duration));
    let s = 0;
    for (let k = a; k < b; k++) s += arr[k];
    return s / (b - a);
  };
  const drops = [];
  const nb = downbeats.length;
  const L = Array.from({ length: nb }, (_, i) => barMean(env.low, i));
  const Rm = Array.from({ length: nb }, (_, i) => barMean(env.rms, i));
  if (nb > 8 && env.low.length) {
    const H = Array.from({ length: nb }, (_, i) => barMean(env.high, i));
    const l60 = percentile(L, 0.6), r50 = percentile(Rm, 0.5);
    let lastDrop = -99;
    for (let i = 4; i < nb - 1; i++) {
      const prev = (L[i - 1] + L[i - 2] + L[i - 3] + L[i - 4]) / 4, dip = Math.min(L[i - 1], L[i - 2]);
      if (i - lastDrop < 8 || L[i] < l60 || Rm[i] < r50) continue;
      if (L[i] < Math.max(prev * 1.45, prev + 0.12) || dip > L[i] * 0.72) continue;
      let b0 = i - 1;                                   // walk back through the thinned-out (or rising) bars
      while (b0 > Math.max(0, i - 8) && (L[b0 - 1] < L[i] * 0.8 || H[b0 - 1] < H[b0])) b0--;
      drops.push({ t: downbeats[i], buildStart: downbeats[Math.min(b0, i - 1)], strength: Math.max(0.4, Math.min(1, (L[i] - prev) / Math.max(0.1, L[i]) * 1.6)) });
      lastDrop = i;
    }
  }
  // The section changes the sections already call drops count too (if not already found).
  for (const s of sections) if (s.drop && !drops.some((d) => Math.abs(d.t - s.start) < 4)) {
    const bl = 60 / (bpm || 120) * 4;
    drops.push({ t: s.start, buildStart: Math.max(0, s.start - bl * 4), strength: 0.8 });
  }
  drops.sort((a, b) => a.t - b.t);
  // One drop, not two: hits within 4 bars of each other are the same drop, at its
  // strongest, landing where the bass actually slams back in (a section boundary
  // can sit a couple of bars early, mid-riser).
  const barSec = (60 / (bpm || 120)) * 4;
  const jump = (t) => {
    let j = 0;
    for (let k = 1; k < nb; k++) if (Math.abs(downbeats[k] - t) < Math.abs(downbeats[j] - t)) j = k;
    return j >= 2 ? L[j] - (L[j - 1] + L[j - 2]) / 2 : 0;
  };
  for (let i = drops.length - 1; i > 0; i--) {
    if (drops[i].t - drops[i - 1].t < barSec * 4) {
      if (jump(drops[i].t) > jump(drops[i - 1].t)) drops[i - 1].t = drops[i].t;
      drops[i - 1].strength = Math.max(drops[i - 1].strength, drops[i].strength);
      drops[i - 1].buildStart = Math.min(drops[i - 1].buildStart, drops[i].buildStart);
      drops.splice(i, 1);
    }
  }
  // How big each drop really is. Most of them are the bass coming back after a
  // one-bar fill; a real one pulls the bass out for bars, then hits much louder
  // than its build and stays there. size (0..1) weighs the loudness and bass lift
  // over the build, how long the bass was out, how long the hit lasts and how
  // loud it is for the song. end: where the hit's loud stretch lets go (its reign).
  // The biggest few (size >= 0.55, at most three; failing that, the one biggest of
  // 0.4 or more) are the song's big drops: the room builds toward them, holds back
  // the lyric pictures and changes form.
  if (nb > 8) {
    const sortedR = Float32Array.from(Rm).sort();
    const mean = (a, i0, i1) => { let s = 0, n = 0; for (let k = Math.max(0, i0); k < Math.min(nb, i1); k++) { s += a[k]; n++; } return n ? s / n : 0; };
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    for (const d of drops) {
      let i = 0;
      for (let k = 1; k < nb; k++) if (Math.abs(downbeats[k] - d.t) < Math.abs(downbeats[i] - d.t)) i = k;
      const Lp = (L[i] + L[Math.min(nb - 1, i + 1)]) / 2, Rp = (Rm[i] + Rm[Math.min(nb - 1, i + 1)]) / 2;
      let pre = 0;
      while (pre < 8 && i - pre - 1 >= 0 && L[i - pre - 1] < 0.55 * Lp) pre++;
      let post = 0;
      while (i + post < nb && post < 16 && Rm[i + post] >= 0.72 * Rp && L[i + post] >= 0.45 * Lp) post++;
      const postR = mean(Rm, i, i + 4);
      const rlift = postR - mean(Rm, i - 4, i), llift = Lp - mean(L, i - 4, i);
      let loud = 0;
      while (loud < nb && sortedR[loud] < postR) loud++;
      loud /= nb;
      let size = 0.4 * clamp01(rlift / 0.35) + 0.3 * clamp01(llift / 0.4) + 0.15 * clamp01(pre / 6) + 0.15 * clamp01(post / 8);
      if (post < 3 || loud < 0.55) size *= 0.5;          // a blip, or not loud for this song
      d.size = Math.round(size * 100) / 100;
      d.end = i + Math.max(2, post) < nb ? downbeats[i + Math.max(2, post)] : duration;
    }
    const big = drops.filter((d) => d.size >= 0.55).sort((a, b) => b.size - a.size).slice(0, 3);
    // Every song with a real drop gets its climax: when none reaches 0.55, the
    // biggest drop of at least 0.4 is the one (the later one when two are close,
    // since a song saves its biggest moment for late).
    if (!big.length) {
      const climax = drops.filter((d) => d.size >= 0.4).sort((a, b) => (b.size + 0.04 * b.t / duration) - (a.size + 0.04 * a.t / duration))[0];
      if (climax) big.push(climax);
    }
    for (const d of drops) d.big = big.includes(d);
    if (big.length) big[0].peak = true;
  }

  // 11. Chords: the triad that best fits each bar (root, major/minor, how
  // clearly), so colour can follow the harmony the way the ear does.
  const TRIADS = [];
  for (let r = 0; r < 12; r++) for (const minor of [0, 1]) {
    const t = new Array(12).fill(0);
    t[r] = 1; t[(r + (minor ? 3 : 4)) % 12] = 1; t[(r + 7) % 12] = 0.8;
    TRIADS.push({ root: r, minor, t });
  }
  const chords = [];
  const bars = downbeats.length > 1 ? Array.from(downbeats) : [0];
  for (let i = 0; i < bars.length; i++) {
    const t0 = bars[i], t1 = i + 1 < bars.length ? bars[i + 1] : duration;
    if (t1 - t0 < 0.2) continue;
    const c = sumChroma(t0, t1);
    let best = null;
    for (const tri of TRIADS) {
      const score = pearson(c, tri.t);
      if (!best || score > best.score) best = { t: t0, root: tri.root, minor: tri.minor, score };
    }
    chords.push(best);
  }
  onProgress(1);

  return {
    duration, bpm: beatTimes.length >= 8 ? bpm : 0, fps, offset: (ONSET_POS * N) / rate,   // no beat grid found (silence): no tempo, not 201 BPM
    beats: Float32Array.from(beatTimes),
    downbeats: Float32Array.from(downbeats),
    kicks: Float32Array.from(kicks),
    onsets: Float32Array.from(onsets),
    hats: Float32Array.from(hats),
    sections,
    env,
    key: songKey.key, mode: songKey.mode, keyConfidence: songKey.score, lean: songKey.lean, tonic: songKey.tonic,
    chords, drops,
  };
}
