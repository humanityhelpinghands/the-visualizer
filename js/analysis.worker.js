import { analyze } from './analysis.js';

self.onmessage = (e) => {
  const { id, channels, sampleRate } = e.data;
  try {
    // The mono mixdown happens here, off the page's thread (it took ~110 ms there:
    // a visible stutter in every song while the next one was being prepared).
    let mono = channels[0];
    if (channels.length > 1) {
      mono = new Float32Array(channels[0].length);
      const k = 1 / channels.length;
      if (channels.length === 2) {
        // Stereo in one pass; fround keeps the per-channel Float32 rounding of the
        // general loop below, so the mix is bit-identical.
        const l = channels[0], r = channels[1];
        for (let i = 0; i < mono.length; i++) mono[i] = Math.fround(0 + l[i] * k) + r[i] * k;
      } else {
        for (const d of channels) for (let i = 0; i < mono.length; i++) mono[i] += d[i] * k;
      }
    }
    const result = analyze(mono, sampleRate, (p) => self.postMessage({ id, type: 'progress', p }));
    const transfer = [result.beats.buffer, result.downbeats.buffer, result.kicks.buffer, result.onsets.buffer,
      result.hats.buffer, ...Object.values(result.env).map((a) => a.buffer)];
    self.postMessage({ id, type: 'done', result }, transfer);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err && err.stack || err) });
  }
};
