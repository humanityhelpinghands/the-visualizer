// The sky listens to the words: a sung weather word (rain, fire, light, fog)
// changes the sky over the next few seconds (World.weather).

// Weather words: [rain, embers, aurora, haze].
const WEATHER = {
  rain: 'rain raining rainy tears tear cry crying cried storm storms puddle',
  embers: 'fire flame flames burn burning burned spark sparks ember embers ash heat',
  aurora: 'light lights glow shine shining daylight dawn sunrise stars aurora heaven',
  haze: 'fog smoke haze mist blur static dust ghost ghosts faded fading',
};

const SKY = new Map();
Object.entries(WEATHER).forEach(([kind, words], i) => words.split(/\s+/).forEach((w) => SKY.set(w, i)));

const clean = (w) => w.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z']/g, '').replace(/'s$/, '').replace(/'/g, '');
function lookup(map, word) {
  const w = clean(word);
  if (!w) return undefined;
  if (map.has(w)) return map.get(w);
  for (const v of [w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ing$/, ''), w.replace(/ing$/, 'e'), w.replace(/ed$/, ''), w.replace(/ed$/, 'e')]) {
    if (v.length > 2 && map.has(v)) return map.get(v);
  }
  return undefined;
}
export const weatherOf = (word) => { const k = lookup(SKY, word); return k === undefined ? -1 : k; };

// Sets line.weather = [{ k (word index), kind }] on every sung line (ad-libs leave the sky alone).
export function planWeather(lines) {
  for (const l of lines) {
    l.weather = [];
    if (l.how === 'adlib') continue;
    l.words.forEach((w, k) => {
      const sky = weatherOf(w.w);
      if (sky >= 0) l.weather.push({ k, kind: sky });
    });
  }
  return lines;
}
