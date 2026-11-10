// Lyrics: .lrc (line or word stamps) and .srt. Untimed words get spread by
// syllables across the line, then snapped onto real onsets in the song.
// The loft's own .lrc files (voice/align.py) add [sec:Chorus] before each
// section, [how:spoken|soft|whisper|loud|backing|adlib] before a line, and a
// last bare <time> on each line for when its singing ends.
import { bsearch } from './conductor.js';

const parseStamp = (s) => {
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s.trim());
  return m ? parseInt(m[1], 10) * 60 + parseFloat(m[2]) : null;
};

const syllables = (w) => {
  const s = w.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return 1;
  const groups = s.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
};

export function parseLrc(text) {
  const out = { meta: {}, lines: [] };
  let offset = 0, section = null, secIdx = -1, how = null;
  for (const raw of text.split(/\r?\n/)) {
    const tags = [];
    let rest = raw, m;
    while ((m = /^\s*\[([^\]]*)\]/.exec(rest))) { tags.push(m[1]); rest = rest.slice(m[0].length); }
    const times = [];
    for (const tag of tags) {
      const t = parseStamp(tag);
      if (t !== null) times.push(t);
      else {
        const kv = /^(\w+):(.*)$/.exec(tag);
        if (kv && kv[1].toLowerCase() === 'sec') { section = kv[2].trim(); secIdx++; }
        else if (kv && kv[1].toLowerCase() === 'how') how = kv[2].trim().toLowerCase();
        else if (kv) {
          out.meta[kv[1].toLowerCase()] = kv[2].trim();
          if (kv[1].toLowerCase() === 'offset') offset = (parseFloat(kv[2]) || 0) / 1000;
        }
      }
    }
    if (!times.length) continue;
    // Word stamps: <mm:ss.xx>word
    const words = [];
    const re = /<(\d+:\d+(?:\.\d+)?)>\s*([^<]*)/g;
    let wm, timedWords = false, sungEnd = null;
    while ((wm = re.exec(rest))) {
      const t = parseStamp(wm[1]);
      const ws = wm[2].trim().split(/\s+/).filter(Boolean);
      sungEnd = !ws.length && words.length ? t : null;    // a bare stamp after the last word: the singing ends here
      for (const w of ws) { words.push({ w, t }); timedWords = true; }
    }
    const plain = rest.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    for (const t of times) {
      out.lines.push({
        t: t - offset, text: plain, section, secIdx, how,
        sungEnd: sungEnd != null ? sungEnd - offset : null,
        words: timedWords ? words.map((x) => ({ w: x.w, t: x.t - offset })) : null,
      });
    }
    how = null;
  }
  // Same moment: the ad-lib first, so the lead line is the one that shows.
  out.lines.sort((a, b) => a.t - b.t || (b.how === 'adlib') - (a.how === 'adlib'));
  return out;
}

export function parseSrt(text) {
  const out = { meta: {}, lines: [] };
  const stamp = (s) => {
    const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s);
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : null;
  };
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const rows = block.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    const at = rows.findIndex((r) => r.includes('-->'));
    if (at < 0) continue;
    const [a, b] = rows[at].split('-->');
    const t = stamp(a), end = stamp(b);
    if (t === null) continue;
    const plain = rows.slice(at + 1).join(' ').replace(/<[^>]*>/g, '').trim();
    if (plain) out.lines.push({ t, end, text: plain, words: null });
  }
  out.lines.sort((x, y) => x.t - y.t);
  return out;
}

export function parseLyrics(text, name = '') {
  return /\.srt$/i.test(name) || /-->/.test(text) ? parseSrt(text) : parseLrc(text);
}

// Fill in ends and word timings. `onsets` are detected hits (seconds).
// A line whose singing end is known stays HOLD seconds after it (so it never
// hangs over an instrumental break), unless the next line comes first.
const HOLD = 1.8;
// A line the aligner crammed (its words stamped a few hundredths apart, a line it
// couldn't place) would flash on screen for a fraction of a second: it's left out,
// and the line before holds.
const crammed = (l) => {
  if (!l.words || l.words.length < 3) return false;
  let tight = 0;
  for (let k = 1; k < l.words.length; k++) if (l.words[k].t - l.words[k - 1].t <= 0.035) tight++;
  return tight >= 0.6 * (l.words.length - 1);
};
export function timeLyrics(parsed, duration, onsets) {
  // An empty timed line clears the screen (the standard way to end a line before a break).
  const all = parsed.lines;
  const lines = all.filter((l) => l.text && !crammed(l)), kept = new Set(lines);
  lines.forEach((l) => {
    let next = duration;
    for (const o of all) if (o.t > l.t + 1e-6 && (o.text === '' || kept.has(o))) { next = o.t; break; }
    if (l.end == null) l.end = l.sungEnd != null ? l.sungEnd + HOLD : l.t + 10;
    l.end = Math.min(l.end, next);
    if (!l.words) {
      const ws = l.text.split(/\s+/).filter(Boolean);
      const syl = ws.map(syllables), total = syl.reduce((a, b) => a + b, 0);
      // Sung lines rarely run faster than ~4 syllables/s or fill their whole gap.
      const span = Math.max(0.3, Math.min(l.end - l.t - 0.05, total * 0.3 + 0.35));
      let acc = 0;
      l.words = ws.map((w, k) => { const t = l.t + (acc / total) * span; acc += syl[k]; return { w, t }; });
      if (onsets && onsets.length) snapWords(l.words, onsets, l.end);
    }
    // Unknown singing end (line stamps only): the last word lasts as long as it takes
    // to sing, not through the whole gap (it isn't a held note).
    const lw = l.words[l.words.length - 1];
    const last = l.sungEnd != null ? Math.min(l.sungEnd, l.end) : Math.min(l.end, lw.t + 0.35 + 0.3 * syllables(lw.w));
    l.words.forEach((w, k) => { w.end = k + 1 < l.words.length ? l.words[k + 1].t : last; });
  });
  return lines;
}

function snapWords(words, onsets, lineEnd) {
  let floor = -Infinity;
  for (let k = 0; k < words.length; k++) {
    const w = words[k], i = bsearch(onsets, w.t);
    let best = null;
    for (const j of [i, i + 1]) {
      if (j < 0 || j >= onsets.length) continue;
      const d = Math.abs(onsets[j] - w.t);
      if (d <= (k === 0 ? 0.06 : 0.11) && (!best || d < best.d)) best = { d, t: onsets[j] };
    }
    let t = best ? best.t : w.t;
    t = Math.max(t, floor + 0.07);
    if (t < lineEnd) w.t = t;
    floor = w.t;
  }
}

// Hooks stand taller and lift the colour. When the lyrics carry their
// sections, the chorus is the hook; otherwise, any line the song repeats.
// `first` marks the opening line of each section.
const HOOK = /^(final |last |big )?(post-?)?chorus|^hook|^refrain/i;
export function markHooks(lines) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim();
  const count = new Map();
  for (const l of lines) count.set(norm(l.text), (count.get(norm(l.text)) || 0) + 1);
  const sectioned = lines.some((l) => l.section);
  // Screams: the lyrics direct a section to be screamed or shouted ([how:loud], from
  // your [Screamed] / [Shout] tags) and its line is written in capitals, the way
  // screamo is written. Both, so a pop hook in capitals, a stray prompt token or a
  // belted chorus never counts; and when a whole file is in capitals the casing
  // says nothing at all.
  const caps = (text) => {
    const words = text.split(/\s+/).filter((w) => !/[\d_]/.test(w)).map((w) => w.replace(/[^A-Za-z]/g, '')).filter((w) => w.length >= 2);
    const up = words.filter((w) => w === w.toUpperCase());
    return words.length > 0 && up.length / words.length >= 0.5 && up.join('').length >= 3;
  };
  const loudSecs = new Set(lines.filter((l) => l.how === 'loud').map((l) => l.secIdx));
  const allCaps = lines.length >= 4 && lines.filter((l) => caps(l.text)).length >= lines.length * 0.6;
  lines.forEach((l, i) => {
    l.hook = l.how !== 'adlib' && (sectioned ? HOOK.test(l.section || '') : count.get(norm(l.text)) >= 2);
    l.first = sectioned && l.how !== 'adlib' && (i === 0 || lines[i - 1].secIdx !== l.secIdx);
    l.gapBefore = i ? l.t - lines[i - 1].end : l.t;
    l.scream = !allCaps && l.how !== 'adlib' && loudSecs.has(l.secIdx) && caps(l.text);
  });
  return lines;
}

export function lineAt(lines, t) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 && t < lines[ans].end ? ans : -1;
}
