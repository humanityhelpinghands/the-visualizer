// Talk to Oasis: hold M (or the orb at the top) in any room, say what you want,
// let go. The server's Whisper writes it down (/api/hear, primed with your songs'
// names), a small grammar works out what you meant, the room does it, and the house
// answers in the Loft's voice. No account, no cloud: it all runs here.
//
// A room hands talk() what it can do: { name, play(song), playing(), pause(),
// resume(), next(), prev(), volume(dv), duck(on), drop(), lyrics(on), shuffle(),
// dislike(), go(scale), journey(), radio(on), replay(), status() }. Anything it
// lacks goes to the room that has it.
import { speak, unlock } from './say.js';

const FEEL = {
  lonely: 'loneliness', alone: 'loneliness', isolated: 'loneliness', loneliness: 'loneliness',
  sad: 'sadness', blue: 'sadness', down: 'sadness', depressed: 'sadness', crying: 'sadness', grief: 'sadness', heartbroken: 'sadness',
  angry: 'anger', mad: 'anger', rage: 'anger', furious: 'anger', pissed: 'anger', heavy: 'anger',
  happy: 'joy', joyful: 'joy', upbeat: 'joy', fun: 'joy', excited: 'joy', party: 'joy', dance: 'joy',
  hopeful: 'hope', hope: 'hope', optimistic: 'hope', uplifting: 'hope',
  calm: 'calm', chill: 'calm', relaxing: 'calm', relaxed: 'calm', peaceful: 'calm', sleepy: 'calm', soft: 'calm', mellow: 'calm', slow: 'calm',
  scary: 'fear', scared: 'fear', afraid: 'fear', anxious: 'fear', nervous: 'fear', dread: 'fear', dark: 'fear',
  love: 'love', romantic: 'love', loving: 'love', sweet: 'love',
  sexy: 'desire', wanting: 'desire', hungry: 'desire', obsessed: 'desire',
  nostalgic: 'nostalgia', memories: 'nostalgia', remember: 'nostalgia',
  defiant: 'defiance', rebellious: 'defiance', strong: 'defiance', fight: 'defiance', fighting: 'defiance', unstoppable: 'defiance',
  mysterious: 'mystery', weird: 'mystery', strange: 'mystery', cosmic: 'mystery', spacey: 'mystery', trippy: 'mystery',
};
const ADJ = { loneliness: 'lonely', sadness: 'sad', anger: 'angry', joy: 'bright', hope: 'hopeful', calm: 'calm', fear: 'uneasy', love: 'tender', desire: 'hungry', nostalgia: 'nostalgic', defiance: 'defiant', mystery: 'strange' };
const SCALES = [
  [/\bedge\b|observable universe|end of (the )?universe|oldest light/, 'edge'], [/cosmic web/, 'web'],
  [/andromeda|local group|other galax/, 'local'], [/milky way|our galaxy|the galaxy/, 'galaxy'],
  [/\b(my|your|the) (stars|songs)\b|song stars/, 'stars'], [/neighbo(u)?rhood|nearby stars/, 'neighbourhood'],
  [/oort/, 'oort'], [/solar system|planets|\bsun\b/, 'solar'], [/\bmoon\b/, 'moon'], [/\bearth\b|home planet/, 'earth'],
];
const STOP = new Set('the a an to of and my me some song songs track please oasis hey can you could would i want wanna like play put on hear let us lets that this it one'.split(' '));
const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];

// ── the library: every song with what it feels  ──
let library = null;
function songs() {
  if (!library) library = import('../library/songs.js').then((m) => m.loadSongs()).catch(() => []);
  return library;
}
function close(a, b) {   // one slip allowed in a longer word (Whisper's spelling of a name)
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, slips = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++slips > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return slips + (a.length - i) + (b.length - j) <= 1;
}
export async function findSong(query) {
  const list = await songs(), q = norm(query).split(' ').filter((w) => w && !STOP.has(w)), wantCover = /\bcover\b/.test(query);
  if (!q.length) return null;
  let best = null, bestScore = 0;
  for (const s of list) {
    const words = norm(s.short).split(' ').filter((w) => w && !STOP.has(w));
    if (!words.length) continue;
    const hit = words.filter((w) => q.some((x) => close(x, w))).length;
    let score = hit / words.length + 0.04 * hit + (/\bcover\b/i.test(s.name) === wantCover ? 0.05 : 0) - (s.disliked ? 0.1 : 0) + Math.min(0.03, s.listened / 1e5);
    if (hit === 0) score = 0;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return bestScore >= 0.6 ? best : null;
}
export async function songFeeling(feeling) {
  const list = (await songs()).filter((s) => !s.disliked);
  const by = list.map((s) => [s, (s.top.find(([e]) => e === feeling) || [, 0])[1]]).filter(([, w]) => w > 0.2).sort((a, b) => b[1] - a[1]);
  return by.length ? pickOne(by.slice(0, 5))[0] : null;
}
async function songAxis(axis) {
  const list = (await songs()).filter((s) => !s.disliked).sort((a, b) => b.axes[axis] - a.axes[axis]);
  return list.length ? pickOne(list.slice(0, 4)) : null;
}

// ── what you meant ────────────────────────────────────────────────────
export function understand(said) {
  let t = norm(said).replace(/^(hey |ok |okay )?oasis\b ?/, '').replace(/\b(please|can you|could you|would you|will you)\b/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return { act: 'hello' };
  const has = (re) => re.test(t);
  if (has(/\bwhat can you do\b|\bhelp\b|\bcommands\b/)) return { act: 'help' };
  if (has(/^(hi|hello|hey|yo|good morning|good evening)\b/) && t.split(' ').length <= 3) return { act: 'hello' };
  if (has(/\bthank/)) return { act: 'thanks' };
  if (has(/\bgood ?night\b/)) return { act: 'goodnight' };
  if (has(/self ?destruct/)) return { act: 'destruct' };
  if (has(/how (big|large|old|wide) is (the )?universe|universe.*how (big|large|old)/)) return { act: 'universe' };
  if (has(/\bare we alone\b|anyone out there|is there life/)) return { act: 'alone' };
  if (has(/meaning of (life|it all|everything)|what's the point|what is the point/)) return { act: 'meaning' };
  if (has(/who (made|built|created|are) you|who made this/)) return { act: 'maker' };
  if (has(/can'?t sleep|cannot sleep|insomnia|help me sleep/)) return { act: 'sleep' };
  if (has(/\b(the )?loft\b|take me home|go home|back home/)) return { act: 'room', room: 'loft' };
  if (has(/^(next|skip)\b|next (song|one|track)|skip (this|it|song)/)) return { act: 'next' };
  if (has(/^(previous|back)\b|go back|last song|previous (song|one|track)/)) return { act: 'prev' };
  if (has(/^(pause|stop|hold on|hold up|wait)\b|\bshut up\b|\bsilence\b/)) return { act: 'pause' };
  if (has(/^(resume|continue|unpause|keep going|go on)\b|^play( it)?( again)?$/)) return { act: 'resume' };
  if (has(/\blouder\b|turn it up|volume up|crank/)) return { act: 'volume', dv: 0.15 };
  if (has(/\bquieter\b|\bsofter\b|turn it down|volume down|too loud/)) return { act: 'volume', dv: -0.15 };
  if (has(/\bdrop\b/)) return { act: 'drop' };
  if (has(/(hide|turn off|no|kill|stop) (the )?(lyrics|words)/)) return { act: 'lyrics', on: false };
  if (has(/(show|turn on|bring back) (the )?(lyrics|words)|\blyrics\b/)) return { act: 'lyrics', on: true };
  if (has(/not for me|i don'?t like (this|it)|hate this|never play this/)) return { act: 'dislike' };
  if (has(/\bshuffle\b/)) return { act: 'shuffle' };
  if (has(/what('s| is)( this| playing| that)|what song|which song|name of (this|the) song/)) return { act: 'what' };
  const m = /^(play|put on|i want to hear|let me hear|give me|queue|spin|throw on)\b ?(.*)$/.exec(t);
  const rest = m ? m[2] : t;
  if (/\b(surprise|random|anything|whatever|dealer'?s choice)\b/.test(rest)) return { act: 'surprise' };
  const feel = rest.split(' ').map((w) => FEEL[w]).find(Boolean);
  if (feel && (!m || /^(something|anything|a song|songs?|music|me something|some)\b/.test(rest) || rest.split(' ').length <= 2)) return { act: 'feel', feeling: feel };
  if (/\b(vast|huge|infinite|enormous|big)\b/.test(rest) && /\bsomething\b/.test(rest)) return { act: 'axis', axis: 'vast' };
  if (/\b(void|empty|nothing|emptiness)\b/.test(rest)) return { act: 'axis', axis: 'void' };
  if (/\bi('?m| am| feel)\b/.test(t) && feel) return { act: 'feel', feeling: feel };
  return { act: 'song', query: rest, playWord: !!m };
}

// ── doing it ──────────────────────────────────────────────────────────
const ROOM_URL = { loft: 'index.html' };
const HOME = { play: 'loft', resume: 'loft', pause: 'loft', next: 'loft', prev: 'loft', volume: 'loft', drop: 'loft', lyrics: 'loft', shuffle: 'loft', dislike: 'loft', what: 'loft' };
function carry(room, cmd, line) {
  if (cmd.act && cmd.act !== 'noop') {
    try { sessionStorage.setItem('oasis.pending', JSON.stringify({ ...cmd, at: Date.now() })); } catch { /* no storage: just open the room */ }
  }
  return { line, then: () => { location.href = ROOM_URL[room] + (cmd.songName ? (room === 'loft' ? '?play=' : '?song=') + encodeURIComponent(cmd.songName) : ''); } };
}

async function act(room, cmd) {
  const can = (f) => typeof room[f] === 'function';
  const now = () => (can('playing') ? room.playing() : null);
  switch (cmd.act) {
    case 'hello': return { line: pickOne(["I'm here. Technically, I'm always here.", 'Listening. Say what you need.', 'Hello. The universe is still expanding, if you were wondering.']) };
    case 'help': return { line: 'Try: play something lonely. Play a song by name. Next. Louder. Take me to the drop. Or ask me how big the universe is.' };
    case 'thanks': return { line: pickOne(["Any time. I've got nothing but time.", 'Of course.', "That's what I'm here for. Allegedly."]) };
    case 'goodnight': if (can('pause')) setTimeout(() => room.pause(), 3500); return { line: "Good night. I'll keep the stars on." };
    case 'destruct': return { line: 'Self destruct in three. Two. No. You would miss the next song.' };
    case 'universe': return { line: "Ninety-three billion light-years across, and you are the middle of it. Everyone is. That's how light works." };
    case 'alone': return { line: 'Statistically, no. Tonight, possibly.' };
    case 'meaning': return { line: 'Paying attention, mostly. You are already doing it.' };
    case 'maker': return { line: 'You did. I just hum along.' };
    case 'room':
      if (cmd.room === room.name) return { line: can('status') ? room.status() : pickOne(["You're already here.", 'This is it. Look around.']) };
      return carry(cmd.room, {}, 'Back to the Loft.');
    case 'sleep': {
      const s = await songFeeling('calm');
      if (s) return play(room, s, 'Here is something slow. The universe can wait until morning.');
      return { line: 'Close your eyes. Everything out there will still be there.' };
    }
    case 'feel': {
      const s = await songFeeling(cmd.feeling);
      if (!s) return { line: `I couldn't find anything ${ADJ[cmd.feeling]} on the shelf. Strange, for this shelf.` };
      return play(room, s, pickOne([`Something ${ADJ[cmd.feeling]}. Here's ${s.short}.`, `${s.short}. It knows the feeling.`]));
    }
    case 'axis': {
      const s = await songAxis(cmd.axis);
      return s ? play(room, s, cmd.axis === 'vast' ? `${s.short}. Big enough?` : `${s.short}. Stare back.`) : { line: 'Nothing that size here.' };
    }
    case 'surprise': {
      const list = (await songs()).filter((s) => !s.disliked).sort((a, b) => a.listened - b.listened);
      const s = pickOne(list.slice(0, Math.max(1, Math.ceil(list.length / 3))));   // from the least heard third
      return s ? play(room, s, `Rolling the cosmic dice. ${s.short}.`) : { line: 'The shelf is empty.' };
    }
    case 'song': {
      const s = await findSong(cmd.query);
      if (s) return play(room, s, pickOne([`${s.short}.`, `Here's ${s.short}.`, `${s.short}. Good choice for a speck of dust.`]));
      return { line: cmd.playWord ? `I don't know a song called ${cmd.query}.` : `I heard: ${cmd.query}. I don't know that one yet. Say help for ideas.` };
    }
    case 'what': {
      const s = now();
      if (!s) return can('playing') ? { line: 'Nothing is playing. Just the hum of the universe.' } : carry('loft', {}, 'The Loft knows. Taking you there.');
      return { line: `This is ${s.short}${s.primary ? `. It feels ${ADJ[s.primary]}` : ''}.` };
    }
  }
  const fn = { next: 'next', prev: 'prev', pause: 'pause', resume: 'resume', volume: 'volume', drop: 'drop', lyrics: 'lyrics', shuffle: 'shuffle', dislike: 'dislike', go: 'go', journey: 'journey', radio: 'radio', replay: 'replay' }[cmd.act];
  if (fn && can(fn)) {
    const arg = cmd.act === 'volume' ? cmd.dv : cmd.act === 'lyrics' || cmd.act === 'radio' ? cmd.on : cmd.scale;
    const said = await room[fn](arg);
    return { line: said || { next: 'Moving on.', prev: 'Going back.', pause: 'Holding.', resume: "And we're back.", volume: cmd.dv > 0 ? 'Louder.' : 'Softer.', drop: 'Hold on.', lyrics: cmd.on ? 'Words on.' : 'Just the music.', shuffle: 'Shuffled.', dislike: "Noted. It won't come up on its own again.", go: 'Flying.', journey: 'From here to the edge. Sit back.', radio: cmd.on ? 'Radio on.' : 'Radio off.', replay: "Here's the day again." }[cmd.act] };
  }
  if (fn && HOME[cmd.act]) return carry(HOME[cmd.act], cmd, 'That happens in the Loft. Taking you there.');
  return { line: "I can't do that from here yet." };
}
function play(room, s, line) {
  if (typeof room.play === 'function') { room.play(s); return { line }; }
  return carry('loft', { act: 'noop', songName: s.name }, `${line} Opening the Loft: one click and it plays.`);
}

// ── the orb ───────────────────────────────────────────────────────────
const CSS = `
#oasis { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); z-index: 35; display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; }
#oasis .orb { pointer-events: auto; position: relative; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; transition: width 0.25s, height 0.25s, box-shadow 0.25s;
  background: radial-gradient(circle at 40% 35%, #fff 0, #ffb6f0 18%, #b46bff 48%, #3a1a7a 78%, transparent 80%);
  box-shadow: 0 0 calc(8px + 30px * var(--lv, 0)) rgba(214, 107, 255, calc(0.35 + 0.6 * var(--lv, 0))); opacity: 0; pointer-events: none; }
#oasis.listening .orb, #oasis.thinking .orb { opacity: 1; }   /* hidden until you hold M: it only shows while it hears you */
#oasis.listening .orb { width: 46px; height: 46px; }
#oasis.thinking .orb { animation: oasisThink 1s linear infinite; }
@keyframes oasisThink { 50% { transform: scale(0.82); filter: hue-rotate(40deg); } }
#oasis .said { max-width: min(520px, 86vw); padding: 7px 12px; border-radius: 12px; text-align: center; font: 500 13px/1.4 "Space Grotesk", system-ui, sans-serif;
  color: rgba(238, 240, 255, 0.75); background: rgba(10, 8, 24, 0.72); border: 1px solid rgba(255, 255, 255, 0.12); backdrop-filter: blur(12px);
  opacity: 0; transform: translateY(-4px); transition: opacity 0.3s, transform 0.3s; }
#oasis .said.in { opacity: 1; transform: none; }
#oasis .said i { font-style: normal; color: #f2d2ff; }
#oasis .said b { display: block; font-weight: 600; color: #fff; margin-top: 2px; }
body.bare #oasis .said { display: none; }`;

export function talk(room) {
  if (document.getElementById('oasis')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const box = document.createElement('div');
  box.id = 'oasis';
  box.innerHTML = '<div class="orb" title="Talk to Oasis: hold M (or hold this) and speak"></div><div class="said"></div>';
  document.body.appendChild(box);
  const orb = box.querySelector('.orb'), bubble = box.querySelector('.said');
  const voice = (() => { try { return JSON.parse(localStorage.getItem('loft.kokoroVoice')) || 'af_heart'; } catch { return 'af_heart'; } })();
  let rec = null, chunks = [], stream = null, meter = null, raf = 0, t0 = 0, hideT = 0;

  function show(html, ms = 6000) {
    bubble.innerHTML = html;
    bubble.classList.add('in');
    clearTimeout(hideT);
    hideT = setTimeout(() => bubble.classList.remove('in'), ms);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  async function begin() {
    if (rec) return;
    unlock();
    try {
      stream = stream && stream.active ? stream : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      show(`<b>Oasis can't hear you.</b>Allow the microphone for this page (${esc(err.name)}).`, 8000);
      return;
    }
    if (typeof room.duck === 'function') room.duck(true);
    chunks = [];
    rec = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : {});
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.start();
    t0 = performance.now();
    box.classList.add('listening');
    show('<i>listening…</i>', 30000);
    // The orb swells with your voice.
    const ctx = unlock(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    meter = () => {
      an.getByteTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += ((v - 128) / 128) ** 2;
      orb.style.setProperty('--lv', Math.min(1, Math.sqrt(s / buf.length) * 5).toFixed(3));
      raf = requestAnimationFrame(meter);
    };
    meter();
  }
  async function end() {
    if (!rec) return;
    const r = rec;
    rec = null;
    cancelAnimationFrame(raf);
    orb.style.setProperty('--lv', 0);
    box.classList.remove('listening');
    const held = performance.now() - t0;
    const done = new Promise((res) => { r.onstop = res; });
    r.stop();
    await done;
    if (typeof room.duck === 'function') room.duck(false);
    if (held < 350) { show('<i>Hold M while you talk, then let go.</i>', 4000); return; }
    box.classList.add('thinking');
    show('<i>…</i>', 30000);
    try {
      const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
      const res = await fetch('/api/hear', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      await handle(j.text);
    } catch (err) {
      show(`<b>Something went wrong.</b>${esc(err.message)}`, 8000);
    } finally {
      box.classList.remove('thinking');
    }
  }
  async function handle(text, quiet = false) {
    const cmd = understand(text || '');
    const out = text ? await act(room, cmd) : { line: "I didn't catch that." };
    if (!quiet) show(`${text ? `<i>“${esc(text)}”</i>` : ''}<b>${esc(out.line)}</b>`);
    const spoken = out.line ? speak(out.line, { voice }) : Promise.resolve();
    if (out.then) { await Promise.race([spoken, new Promise((r) => setTimeout(r, 2600))]); out.then(); }
    return { cmd, line: out.line };
  }

  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'm' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    e.stopImmediatePropagation();
    begin();
  }, true);
  addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'm') end(); }, true);
  orb.addEventListener('pointerdown', (e) => { e.preventDefault(); orb.setPointerCapture(e.pointerId); begin(); });
  orb.addEventListener('pointerup', end);
  orb.addEventListener('pointercancel', end);
  fetch('/api/hear').catch(() => {});   // wakes the listener up before the first word

  // A request carried over from another room.
  try {
    const p = JSON.parse(sessionStorage.getItem('oasis.pending') || 'null');
    sessionStorage.removeItem('oasis.pending');
    if (p && p.act && Date.now() - p.at < 20000) setTimeout(() => act(room, p).then((o) => o.line && show(`<b>${esc(o.line)}</b>`)), 1800);
  } catch { /* nothing carried */ }

  window.oasis = { handle, understand, room };
  return window.oasis;
}
