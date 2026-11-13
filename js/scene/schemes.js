// colours stay the home look; a song's big moments can hand the room to a scheme for a while:
// the bars, the grid and the strings wear it, the sky keeps the mood, and the core keeps its
// own pair unless the scheme brings one. Each listen picks one, weighted by how well it fits
// the song's feeling and the time of year. Never orange or gold (the grade folds them to red
// anyway); the darkest tones stay the mood's own, so a scheme's green is never a muddy one.
//
// wall: the three bands of bars (bass, mids, highs). floor: the grid's lines; accent: what a
// wave lights them to. core: [rim, body] (optional). anim: 'rgb' runs the classic LED
// colour cycle; 'flip' trades its first two colours on every beat; 'holo' drifts slowly between
// pink, lilac and cyan (never through yellow).
export const SCHEMES = [
  { id: 'matrix', wall: ['#00ff41', '#00c832', '#8dffad'], floor: '#00ff41', accent: '#c8ffd6', core: ['#e0ffe8', '#00b836'],
    fits: { mystery: 1, fear: 1, defiance: 1, neon: 1, loneliness: 0.6 } },
  { id: 'rgb', anim: 'rgb', wall: ['#ff1a4a', '#2a6bff', '#18f070'], floor: '#ff1a4a', accent: '#ffffff',
    fits: { joy: 1, neon: 1, defiance: 1, anger: 0.8, desire: 0.7, hope: 0.6 } },
  { id: 'christmas', anim: 'flip', wall: ['#ff1a3c', '#16e05a', '#ffffff'], floor: '#ff1a3c', accent: '#ffffff', core: ['#ffffff', '#e0102a'],
    fits: { joy: 0.6, love: 0.6, hope: 0.6, nostalgia: 0.7, calm: 0.3 }, season: (m, d) => (m === 11 || (m === 10 && d >= 15) ? 6 : 0.15) },
  { id: 'vaporwave', wall: ['#ff71ce', '#01cdfe', '#05ffa1'], floor: '#b967ff', accent: '#01cdfe',
    fits: { nostalgia: 1, calm: 0.8, desire: 0.7, kawaii: 0.6, loneliness: 0.5 } },
  { id: 'outrun', wall: ['#ff2a6d', '#d300c5', '#05d9e8'], floor: '#ff2a6d', accent: '#05d9e8',
    fits: { anger: 1, defiance: 1, desire: 1, neon: 0.8, powerpoint: 0.8 } },
  { id: 'kawaii', wall: ['#ffb3de', '#c5a3ff', '#a0f0d8'], floor: '#ff9ad5', accent: '#9ad8ff', core: ['#ffffff', '#ff8ad0'],
    fits: { joy: 1, kawaii: 1, love: 0.8, hope: 0.6 } },
  { id: 'cottoncandy', wall: ['#ff9ad5', '#9ad7ff', '#d4a5ff'], floor: '#9ad7ff', accent: '#ffc6ea',
    fits: { love: 1, kawaii: 0.8, nostalgia: 0.7, calm: 0.5 } },
  { id: 'aurora', wall: ['#00ffa3', '#00c2ff', '#a64dff'], floor: '#00e0a0', accent: '#a6ffdf',
    fits: { calm: 1, sadness: 0.8, loneliness: 0.9, mystery: 0.8, hope: 0.5 } },
  { id: 'aero', wall: ['#00b4ff', '#7dff3a', '#e6fbff'], floor: '#00b4ff', accent: '#a4ff6a',
    fits: { hope: 1, joy: 0.8, calm: 0.7 } },
  { id: 'toxic', wall: ['#b4ff00', '#ff00c8', '#00f0ff'], floor: '#b4ff00', accent: '#ff7ae6', core: ['#f2ffd0', '#7a00ff'],
    fits: { anger: 0.8, fear: 0.8, neon: 1, defiance: 0.6 } },
  { id: 'ice', wall: ['#e8fbff', '#7fd4ff', '#4060ff'], floor: '#7fd4ff', accent: '#ffffff',
    fits: { sadness: 1, calm: 0.7, loneliness: 0.7, fear: 0.4 } },
  { id: 'gameboy', wall: ['#9bff6a', '#5fe04a', '#d8ffb0'], floor: '#7dff5a', accent: '#e4ffc8',
    fits: { nostalgia: 1, joy: 0.7, hope: 0.6, neon: 0.5 } },
  { id: 'holo', anim: 'holo', wall: ['#ff8ae6', '#7fe8ff', '#c9a8ff'], floor: '#c9a8ff', accent: '#ffffff', core: ['#ffffff', '#c58aff'],
    fits: { mystery: 0.9, desire: 0.8, kawaii: 0.8, calm: 0.7, neon: 0.7, hope: 0.5 } },
  { id: 'synthsunset', wall: ['#ff3d9a', '#b43dff', '#3de8ff'], floor: '#ff3d9a', accent: '#8af3ff',
    fits: { desire: 1, nostalgia: 0.9, defiance: 0.7, loneliness: 0.6, powerpoint: 0.6 } },
  { id: 'sakura', wall: ['#ffa8cc', '#ffd0e4', '#ffffff'], floor: '#ffb0d2', accent: '#fff0f6', core: ['#ffffff', '#ff9cc8'],
    fits: { love: 1, calm: 0.8, nostalgia: 0.8, sadness: 0.6, kawaii: 0.7, hope: 0.5 } },
  { id: 'biolume', wall: ['#00e5ff', '#2a7bff', '#7dffe8'], floor: '#00d0ff', accent: '#b8fff4',
    fits: { mystery: 1, calm: 0.9, loneliness: 1, fear: 0.7, sadness: 0.7 } },
  { id: 'cga', wall: ['#00f0ff', '#ff3df0', '#ffffff'], floor: '#00f0ff', accent: '#ff3df0',
    fits: { neon: 1, joy: 0.8, defiance: 0.7, powerpoint: 0.8, nostalgia: 0.6 } },
  { id: 'galaxy', wall: ['#8a4dff', '#4a5cff', '#e8e4ff'], floor: '#7a5cff', accent: '#f4f0ff', core: ['#f4f0ff', '#6a3dff'],
    fits: { mystery: 1, loneliness: 0.9, sadness: 0.8, fear: 0.6, calm: 0.7, hope: 0.4 } },
  { id: 'lavalamp', wall: ['#ff2a5a', '#c030ff', '#ff8ac8'], floor: '#ff2a8a', accent: '#ffc2e6',
    fits: { anger: 0.9, desire: 1, love: 0.8, defiance: 0.7, joy: 0.5 } },
  { id: 'pride', anim: 'rgb', slow: 0.03, wall: ['#ff1a4a', '#2a6bff', '#a64dff'], floor: '#ff1a4a', accent: '#ffffff',
    fits: { joy: 1, love: 0.9, hope: 0.9, kawaii: 0.6, defiance: 0.6 } },
];

// One scheme for this listen: mostly what fits the feelings (and the season), now and then a
// wild card that doesn't (a twentieth of the weight goes to every scheme regardless).
export function pickScheme(mood, R = Math.random, now = new Date()) {
  const m = now.getMonth(), d = now.getDate();
  const w = SCHEMES.map((s) => ((s.fits[mood] || 0) + 0.05) * (s.season ? s.season(m, d) : 1));
  let r = R() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < SCHEMES.length; i++) if ((r -= w[i]) <= 0) return SCHEMES[i];
  return SCHEMES[0];
}
