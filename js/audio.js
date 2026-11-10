// Audio engine. The song plays from a decoded AudioBuffer, so the clock is
// sample-exact and seeking is instant. Every visual reads `heardTime()`: the
// moment of the song currently leaving the speakers, smoothed to the frame.

export class AudioEngine {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.duck = this.ctx.createGain();
    this.master = this.ctx.createGain();
    this.duck.connect(this.master).connect(this.ctx.destination);
    // Analyser taps the raw song, so volume and voice ducking never dim the visuals.
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.55;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    // Voice bus: speech plays beside the music (the duck only dims the song).
    this.voiceBus = this.ctx.createGain();
    this.voiceBus.connect(this.master);
    this.voiceAnalyser = this.ctx.createAnalyser();
    this.voiceAnalyser.fftSize = 512;
    this.voiceBus.connect(this.voiceAnalyser);
    this.voiceSrc = null;
    this._vwave = new Float32Array(512);

    this.buffer = null;
    this.source = null;
    this.playing = false;
    this.startedAt = 0;     // ctx time at which song time 0 played
    this.pausedAt = 0;      // song time while paused
    this.onEnded = null;
    this._smooth = 0;
    this._lastPerf = 0;
  }

  async decode(arrayBuffer) {
    return await this.ctx.decodeAudioData(arrayBuffer);
  }

  setBuffer(buffer) {
    this.stop();
    this.buffer = buffer;
    this.pausedAt = 0;
    this._smooth = 0;
  }

  get duration() { return this.buffer ? this.buffer.duration : 0; }

  async play(offset = this.pausedAt) {
    if (!this.buffer) return;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this._kill();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.duck);
    src.connect(this.analyser);
    offset = Math.max(0, Math.min(offset, this.buffer.duration - 0.01));
    const when = this.ctx.currentTime + 0.03;
    src.start(when, offset);
    this.startedAt = when - offset;
    this.source = src;
    this.playing = true;
    this._smooth = offset;
    src.onended = () => {
      if (this.source !== src) return; // replaced by a seek or pause
      this.playing = false;
      this.pausedAt = this.buffer.duration;
      this.source = null;
      if (this.onEnded) this.onEnded();
    };
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.rawTime();
    this._kill();
    this.playing = false;
  }

  stop() {
    this._kill();
    this.playing = false;
    this.pausedAt = 0;
  }

  seek(t) {
    t = Math.max(0, Math.min(t, this.duration));
    if (this.playing) this.play(t);
    else { this.pausedAt = t; this._smooth = t; }
  }

  _kill() {
    if (!this.source) return;
    const s = this.source;
    this.source = null;
    s.onended = null;
    try { s.stop(); } catch (err) {
      // A source that never started cannot stop; that is the only expected case.
      if (err.name !== 'InvalidStateError') throw err;
    }
    s.disconnect();
  }

  // Song time at the audio thread's cursor (ahead of the speakers).
  rawTime() {
    if (!this.playing) return this.pausedAt;
    return Math.max(0, this.ctx.currentTime - this.startedAt);
  }

  // Context time of the sample leaving the speakers right now.
  ctxHeard() {
    const ts = this.ctx.getOutputTimestamp ? this.ctx.getOutputTimestamp() : null;
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    return this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
  }

  // Song time at the speakers right now, smoothed so frames never stutter.
  heardTime(dtSec) {
    if (!this.playing) { this._smooth = this.pausedAt; return this._smooth; }
    const est = Math.max(0, this.ctxHeard() - this.startedAt);
    // Advance by wall time, then pull gently toward the audio estimate.
    this._smooth += dtSec;
    const err = est - this._smooth;
    if (Math.abs(err) > 0.08) this._smooth = est;
    else this._smooth += err * 0.12;
    return this._smooth;
  }

  // Plays a speech clip; returns the context time its first sample sounds.
  playVoice(buffer) {
    this.stopVoice();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.voiceBus);
    const when = this.ctx.currentTime + 0.05;
    src.start(when);
    this.voiceSrc = src;
    src.onended = () => { if (this.voiceSrc === src) this.voiceSrc = null; };
    return when;
  }

  stopVoice() {
    const s = this.voiceSrc;
    if (!s) return;
    this.voiceSrc = null;
    s.onended = null;
    try { s.stop(); } catch (err) { if (err.name !== 'InvalidStateError') throw err; }
    s.disconnect();
  }

  voiceLevel() {
    if (!this.voiceSrc) return 0;
    this.voiceAnalyser.getFloatTimeDomainData(this._vwave);
    let s = 0;
    for (const v of this._vwave) s += v * v;
    return Math.min(1, Math.sqrt(s / this._vwave.length) * 4);
  }

  setVolume(v) { this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03); }

  setDuck(on) {
    this.duck.gain.cancelScheduledValues(this.ctx.currentTime);
    this.duck.gain.setTargetAtTime(on ? 0.28 : 1, this.ctx.currentTime, on ? 0.06 : 0.25);
  }

  readSpectrum() {
    this.analyser.getByteFrequencyData(this.freq);
    return this.freq;
  }
}
