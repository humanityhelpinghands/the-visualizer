// Never green, measured: reads the picture just drawn (call it straight after the
// render, in the same task) and counts the lit pixels that read green, or olive (a
// dark yellow). `murk` counts dim golds and browns: fine as the falloff of a warm
// glow, olive-looking as a wide field beside violet.
export function greenPixels(gl, buf) {
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  if (!buf || buf.length !== w * h * 4) buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let lit = 0, green = 0, murk = 0, worst = null;
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 24) continue;
    lit++;
    const s = (mx - mn) / mx, v = mx / 255;
    if (s < 0.25) continue;
    let hue = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn);
    hue = (hue * 60 + 360) % 360;
    if ((hue >= 70 && hue <= 165) || (hue >= 48 && hue < 70 && v < 0.6)) { green++; if (!worst || s > worst[3]) worst = [r, g, b, s]; }
    else if (hue >= 22 && hue < 48 && v < 0.35 && s > 0.45) murk++;
  }
  return { lit, green, share: lit ? +(green / lit).toFixed(5) : 0, murk, worst: worst && worst.slice(0, 3).join(','), buf };
}
