// The song queue and the deal: which song plays next, and which song Back goes to. Pure logic (no browser), pulled out of
// main.js so tests/queue.test.js can guard the rules that have broken before. main.js owns the tracks, the current song and
// the queue; this reads them through `env` and keeps the deal's own bookkeeping in `S`.
//
// env: { tracks(), current(), queue, baseName(name), shuffle, random, now(), load(), save(passes) }
//
// I like the most. So I should be hearing them the most. However, I'm missing out on hearing the newest ones that I haven't
// heard much at all ... maybe it should be rotating between my top listened to song and then the next song in the shuffle
// would be my least listened to song. That way all I have to do is skip it. To a good song ... a skip should mean I'm not in
// the mood for it ... that means it has a weight to it." And: "the back button ... doesn't take you to the last played song.
// It just shuffles it backwards. Which is wrong logic."
//
//      108 (measured 2026-11-11, 35 hours simulated with no skips): number one takes 17% of the favorite turns, about once
//      every 42 minutes; the top 10 take 46%, the top 25 take 67%; 80 different songs get a favorite turn, and any 40 songs
//      in a row hold 33 to 38 different ones.
//   3. A new turn goes to the least heard song (a skip counts as most of a hearing), the newest added first among equals,
//      each one once a sitting.
//   4. A skip means "not in the mood": that song stays out of the deal for MOOD_HOURS, and the next song is always a
//   5. Back goes to the song that really played before this one; Next after a Back walks forward the same way.
//      played, never the current song's other take right after it (unless that leaves nothing).
export const PLAYS_NEW = 1;
//  sitting.)
export const LIKE_POWER = 2;
export const MOOD_HOURS = 3;
export const RECENT = 9;
// A cover is the same song in another voice, so half of what you've heard of
// its other version (kin) counts toward it too.
export const heardOf = (t) => (t.plays || 0) + (t.listened || 0) / 300;
// of one back. Never zero, so every song keeps a turn.
export const likeOf = (t) => Math.max(0.25, heardOf(t) - 0.5 * (t.skips || 0));
export const isFresh = (t) => !t.disliked && !t.file && t.isNew && (t.plays || 0) < PLAYS_NEW;   // (isNew: the server's word, by when the file arrived)

export function createDealer(env) {
  const { queue, baseName, shuffle = true } = env;
  const R = () => (env.random || Math.random)();
  const now = () => (env.now ? env.now() : Date.now());
  // order, orderAt: the plain shuffled line (the very first song when nothing is known, and the walk when shuffle is off).
  // dealt, dealtKind: the song already chosen to come next ('fav' or 'new'), held until it plays. turn: whose turn the next
  // deal is. pass: each song's place in the favorites' rotation, by name (a lower pass plays sooner); vt: how far that
  // rotation has come (the pass of the last favorite played), so a song that joins later starts from now, not from zero.
  // mood: when a song was last skipped, by name. playedLog: what played this sitting, in order (the last 50). hist, pos:
  // the same as a browser keeps its pages, for Back and Next.
  const saved = (env.load && env.load()) || {};
  const S = { order: [], dealt: null, dealtKind: null, surprise: -1, orderAt: 0, playedLog: [], hist: [], pos: -1,
              turn: 'fav', pass: new Map(Object.entries(saved.pass || {})), vt: +saved.vt || 0, mood: new Map() };

  function heardScore(t, kin = 0) {
    const hoursAgo = t.last ? (now() / 1000 - t.last) / 3600 : Infinity;
    const recent = hoursAgo < 8 ? 2 * (1 - hoursAgo / 8) : 0;
    return heardOf(t) + 0.5 * kin + 0.8 * (t.skips || 0) + recent + R() * 0.9;
  }
  function buildOrder() {
    const tracks = env.tracks(), current = env.current();
    const idx = tracks.map((_, i) => i).filter((i) => i !== current);
    const family = new Map();
    for (const t of tracks) family.set(baseName(t.name), (family.get(baseName(t.name)) || 0) + heardOf(t));
    // Songs marked "not for me" go to the very end.
    const score = new Map(idx.map((i) => {
      const t = tracks[i];
      return [i, heardScore(t, family.get(baseName(t.name)) - heardOf(t)) + (t.disliked ? 1e6 : 0)];
    }));
    idx.sort((a, b) => score.get(a) - score.get(b));
    if (current >= 0) idx.unshift(current);
    for (let i = 1; i < idx.length; i++) {
      const prev = baseName(tracks[idx[i - 1]].name);
      if (baseName(tracks[idx[i]].name) !== prev) continue;
      for (let j = i + 1; j < idx.length; j++) {
        if (baseName(tracks[idx[j]].name) !== prev && !tracks[idx[j]].disliked) { [idx[i], idx[j]] = [idx[j], idx[i]]; break; }
      }
    }
    S.order = idx;
  }
  function dealFresh() {
    const tracks = env.tracks(), current = env.current(), playedLog = S.playedLog;
    const fresh = tracks.map((_, i) => i).filter((i) => i !== current && isFresh(tracks[i]));
    if (!fresh.length) return -1;
    // (one not yet met this sitting first, then one not in the last two)
    const unmet = fresh.filter((i) => !playedLog.includes(i)), notLast = fresh.filter((i) => !playedLog.slice(-2).includes(i));
    const from = unmet.length ? unmet : notLast.length ? notLast : fresh;
    const least = Math.min(...from.map((i) => tracks[i].plays || 0)), pick = from.filter((i) => (tracks[i].plays || 0) === least);
    return pick[Math.floor(R() * pick.length)];
  }

  // The songs a deal may land on (rule 6). Each rule is let go in turn only when keeping it would leave nothing: first the
  // mood, then the other take, then the last RECENT played. Never the current song, never one marked "not for me".
  function pool() {
    const tracks = env.tracks(), current = env.current(), recent = S.playedLog.slice(-RECENT), t0 = now();
    const fam = tracks[current] ? baseName(tracks[current].name) : null;
    const all = tracks.map((_, i) => i).filter((i) => i !== current && !tracks[i].disliked);
    const inMood = (i) => !(t0 - (S.mood.has(tracks[i].name) ? S.mood.get(tracks[i].name) : -Infinity) < MOOD_HOURS * 36e5);
    const fresh = (i) => !recent.includes(i), other = (i) => baseName(tracks[i].name) !== fam;
    return [all.filter((i) => inMood(i) && fresh(i) && other(i)), all.filter((i) => fresh(i) && other(i)), all.filter(fresh), all].find((p) => p.length) || [];
  }
  // stands in line; the lowest pass plays, then steps one stride back. So a song liked twice as much comes around
  // LIKE_POWER-sharpened twice as often, and the most liked goes first (stride scheduling, Waldspurger and Weihl 1995).
  const stride = (t) => 1 / Math.pow(likeOf(t), env.likePower || LIKE_POWER);
  // (a song met for the first time joins the line one stride from where the rotation stands now; the line then keeps its place)
  const passOf = (t) => { if (!S.pass.has(t.name)) S.pass.set(t.name, S.vt + stride(t)); return S.pass.get(t.name); };
  function favorites() {
    const tracks = env.tracks();
    for (const t of tracks) passOf(t);
    return pool().sort((a, b) => passOf(tracks[a]) - passOf(tracks[b]) || likeOf(tracks[b]) - likeOf(tracks[a]) || a - b);
  }
  // sinks), the newest added first among equals, and no song twice in a sitting while another is still unmet.
  const heardLow = (t) => heardOf(t) + 0.8 * (t.skips || 0);
  function discoveries() {
    const tracks = env.tracks(), met = new Set(S.playedLog), p = pool(), unmet = p.filter((i) => !met.has(i));
    return (unmet.length ? unmet : p).sort((a, b) => heardLow(tracks[a]) - heardLow(tracks[b]) || (tracks[b].added || 0) - (tracks[a].added || 0) || a - b);
  }
  function deal(kind = S.turn) {
    const tracks = env.tracks(), n = tracks.length, current = env.current();
    const line = kind === 'new' ? discoveries() : favorites();
    S.dealtKind = kind;
    if (line.length) return line[0];
    // Nothing allowed is left (every other song is marked "not for me"): the next one along, never the current song.
    for (let k = 1; k <= n; k++) { const i = (((current + k) % n) + n) % n; if (i !== current && !tracks[i].disliked) return i; }
    return (((current + 1) % n) + n) % n;
  }
  function tier() {
    const line = S.turn === 'new' ? discoveries() : favorites();
    return line.slice(0, Math.max(1, Math.min(3, line.length)));
  }
  function nextIndex(dir, { skip = false } = {}) {
    const tracks = env.tracks(), current = env.current(), n = tracks.length;
    if (dir < 0) return S.pos > 0 ? S.hist[S.pos - 1] : current;             // (nothing before it this sitting: the caller starts the song over)
    if (S.pos >= 0 && S.pos < S.hist.length - 1) return S.hist[S.pos + 1];   // (after a Back, Next walks forward through what played)
    if (queue.length) return queue[0];
    if (!shuffle || n < 3) {
      const ok = (i) => !tracks[((i % n) + n) % n].disliked, anyOk = tracks.some((t) => !t.disliked);
      let i = current + dir;
      for (let k = 0; k < n && anyOk && !ok(i); k++) i += dir;
      return i;
    }
    if (skip && S.dealtKind === 'new') S.dealt = null;
    if (S.dealt === null || S.dealt === current) S.dealt = deal(skip ? 'fav' : S.turn);
    return S.dealt;
  }
  // Is a press of Next a step forward through what already played (after a Back), not a new song?
  const inPast = () => S.pos >= 0 && S.pos < S.hist.length - 1;
  function played(i, how = 'new', skippedFrom = -1) {
    const tracks = env.tracks();
    if (skippedFrom >= 0 && tracks[skippedFrom] && skippedFrom !== i) {
      const t = tracks[skippedFrom];
      S.mood.set(t.name, now()); S.pass.set(t.name, passOf(t) + stride(t));   // (out for now, and one place back in the favorites' line)
    }
    if (how === 'back' && S.pos > 0 && S.hist[S.pos - 1] === i) S.pos--;
    else if (how === 'fwd' && inPast() && S.hist[S.pos + 1] === i) S.pos++;
    else if (S.hist[S.pos] !== i) {   // a new song: what lay ahead of a Back is dropped, the way a browser drops its forward pages
      S.hist.length = S.pos + 1; S.hist.push(i);
      if (S.hist.length > 50) S.hist.shift();
      S.pos = S.hist.length - 1;
    }
    if (i !== S.playedLog[S.playedLog.length - 1]) { S.playedLog.push(i); if (S.playedLog.length > 50) S.playedLog.shift(); }
    if (how === 'new' && i === S.dealt && S.dealtKind) {   // the dealt song began: its turn is spent and the other kind is next
      if (S.dealtKind === 'fav' && tracks[i]) { const at = passOf(tracks[i]); S.vt = Math.max(S.vt, at); S.pass.set(tracks[i].name, at + stride(tracks[i])); }
      S.turn = S.dealtKind === 'fav' ? 'new' : 'fav';
    }
    const p = S.order.indexOf(i); if (p >= 0) S.orderAt = p;
    S.surprise = -1; S.dealt = null; S.dealtKind = null;
    if (env.save) {   // (the favorites' line is kept between sittings, for the songs still on the shelf)
      const here = new Set(tracks.map((t) => t.name));
      env.save({ vt: S.vt, pass: Object.fromEntries([...S.pass].filter(([name]) => here.has(name))) });
    }
  }
  // The list grew at the front by n songs (a drop): everything that holds a place in the old list moves up with it.
  function shift(n) {
    for (const a of [S.playedLog, S.hist]) for (let q = 0; q < a.length; q++) a[q] += n;
    S.dealt = null; S.dealtKind = null; S.surprise = -1; S.order = [];
  }
  // Why the next song is the next song, in one word for the screen: 'queue', 'back' (a step forward through what played),
  // 'fav' or 'new'.
  function nextWhy() {
    if (inPast()) return 'back';
    if (queue.length) return 'queue';
    nextIndex(1);
    return S.dealtKind || 'fav';
  }
  return { S, heardScore, buildOrder, dealFresh, deal, tier, nextIndex, played, shift, inPast, nextWhy, favorites, discoveries };
}
