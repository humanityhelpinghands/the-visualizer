// The house's voice, for any room: Kokoro through the server (/api/say), or the
// browser's own voice when Kokoro isn't there. Lines take turns, one at a time.
let ctx = null, queue = Promise.resolve();

// Browsers keep sound off until a click or key: call this from one.
export function unlock() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function speak(text, { voice = 'af_heart', speed = 0.95, volume = 0.9 } = {}) {
  const line = async () => {
    try {
      const r = await fetch(`/api/say?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}&speed=${speed}`);
      const j = await r.json();
      if (!r.ok || !j.audio) throw new Error(j.error || r.statusText);
      const a = unlock(), bytes = Uint8Array.from(atob(j.audio), (c) => c.charCodeAt(0));
      const buf = await a.decodeAudioData(bytes.buffer);
      await new Promise((done) => {
        const src = a.createBufferSource(), g = a.createGain();
        g.gain.value = volume;
        src.buffer = buf;
        src.connect(g).connect(a.destination);
        src.onended = done;
        src.start();
        setTimeout(done, (buf.duration + 0.5) * 1000);   // a context the browser keeps muted never ends its line: move on anyway
      });
    } catch {
      if (!('speechSynthesis' in window)) return;
      await new Promise((done) => { const u = new SpeechSynthesisUtterance(text); u.onend = u.onerror = done; speechSynthesis.speak(u); setTimeout(done, 4000 + text.length * 120); });   // (Chrome sometimes never ends it: the queue must not stall)
    }
  };
  queue = queue.then(line, line);
  return queue;
}
