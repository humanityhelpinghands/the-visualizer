// frames. The show's own math cuts every frame time to 0.1 s, so the log's frame rate could never show one: a minute at 80.5
// frames a second against 82 could hide a dozen. This counts the gaps themselves, uncut, and keeps the longest.
export const STALL = 0.1;

export function makeStalls(limit = STALL) {
  let n = 0, longest = 0;
  return {
    // counts: false for a gap that is no freeze of the show: the first frame after a pause or a hidden window (the gap is
    // the pause itself) and a song's first seconds (loading a song is allowed a hitch).
    see(gap, counts = true) { if (counts && gap > limit) { n += 1; if (gap > longest) longest = gap; } },
    take() { const out = { stalls: n, longest: +longest.toFixed(2) }; n = 0; longest = 0; return out; },
    drop() { n = 0; longest = 0; },
  };
}
