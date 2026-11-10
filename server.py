"""The Loft — tiny local server.

Serves this folder, lists music/ at /api/tracks (with how much you've heard
each song), records listening at /api/played (cache/plays.json), speaks through
the Kokoro voice at /api/say (voice/tts.py), transcribes lyrics in the
background (voice/lyrics.py). Voice and lyrics are optional and need the .venv.
Binds to 127.0.0.1 so nothing outside this PC can reach it.
"""
import base64
import http.server
import json
import os
import socket
import sys
import threading
import time
import urllib.parse
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
MUSIC = os.path.join(ROOT, "music")
AUDIO_EXT = {".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".opus", ".webm"}
FIRST_PORT = 8030

# Kokoro voice (optional). Without it the loft falls back to the browser voice.
sys.path.insert(0, os.path.join(ROOT, "voice"))
try:
    import tts
    TTS_IMPORT_ERROR = None
except Exception as e:  # missing packages: reported to the browser, never hidden
    tts = None
    TTS_IMPORT_ERROR = "%s: %s" % (type(e).__name__, e)
try:
    import lyrics as autolyrics
    LYRICS_IMPORT_ERROR = None
except Exception as e:
    autolyrics = None
    LYRICS_IMPORT_ERROR = "%s: %s" % (type(e).__name__, e)
# Talk to Oasis: push-to-talk, heard by Whisper (voice/hear.py).
try:
    import hear as oasis_ear
    HEAR_IMPORT_ERROR = None
except Exception as e:
    oasis_ear = None
    HEAR_IMPORT_ERROR = "%s: %s" % (type(e).__name__, e)
WORKER = None   # the background lyrics worker, started in main()


def auto_lyrics_url(stem):
    """The cached lyrics for a song, versioned by file time so a re-timed
    .lrc is never served stale from the browser cache."""
    path = os.path.join(ROOT, "cache", "lyrics", stem + ".lrc")
    if not os.path.exists(path):
        return None
    return "/cache/lyrics/" + urllib.parse.quote(stem + ".lrc") + "?v=%d" % int(os.path.getmtime(path))

# Listening history: {song: {"seconds": heard, "plays": n, "skips": n, "last": unix time,
#                             "disliked": true when you've said "not for me"}}
PLAYS_PATH = os.path.join(ROOT, "cache", "plays.json")
PLAYS_LOCK = threading.Lock()
PERF_PATH = os.path.join(ROOT, "cache", "perf.jsonl")
PERF_LOCK = threading.Lock()


def read_perf():
    try:
        with open(PERF_PATH, encoding="utf-8") as f:
            return [json.loads(l) for l in f if l.strip()]
    except (OSError, ValueError):
        return []

PLAYS = None


def plays():
    global PLAYS
    if PLAYS is None:
        try:
            with open(PLAYS_PATH, encoding="utf-8") as f:
                PLAYS = json.load(f)
        except FileNotFoundError:
            PLAYS = {}
        except (OSError, ValueError) as e:   # unreadable: keep it aside, start fresh, say so
            bad = PLAYS_PATH + ".unreadable"
            os.replace(PLAYS_PATH, bad)
            print("[loft] Listening history was unreadable (%s); kept it as %s and started fresh." % (e, bad), file=sys.stderr)
            PLAYS = {}
    return PLAYS


def save_plays():
    os.makedirs(os.path.dirname(PLAYS_PATH), exist_ok=True)
    tmp = PLAYS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(PLAYS, f, indent=1)
    os.replace(tmp, PLAYS_PATH)


# Clip renders (js/render.js): the page draws the show frame by frame and posts
# each one as a numbered JPEG (several at once, in any order); they're put back in
# order and encoded to H.264 here, and the song's own audio for
# the same stretch is cut and muxed in, so picture and sound line up exactly.
# One render at a time, into renders/.
RENDERS = os.path.join(ROOT, "renders")
RENDER_LOCK = threading.Lock()
RENDER = None


class ClipRender:
    def __init__(self, path, audio_path, t0, t1, fps, width, height):
        import av   # (PyAV, part of the lyrics setup; only needed when rendering)
        from fractions import Fraction
        self.av, self.path, self.audio_path, self.t0, self.t1, self.n = av, path, audio_path, t0, t1, 0
        self.out = av.open(path, "w", options={"movflags": "+faststart"})
        self.video = self.out.add_stream("libx264", rate=fps)
        self.video.width, self.video.height, self.video.pix_fmt = width, height, "yuv420p"
        self.video.time_base = Fraction(1, fps)
        # Sized for posting: high quality, capped near 24 Mb/s (stars and rain are hard to compress).
        self.video.options = {"crf": "16", "preset": "medium", "profile": "high", "maxrate": "40M", "bufsize": "80M",
                              "x264-params": "colorprim=bt709:transfer=bt709:colormatrix=bt709"}
        self.audio = self.out.add_stream("aac", rate=48000, layout="stereo")
        self.audio.bit_rate = 256000
        self.jpeg = av.CodecContext.create("mjpeg", "r")
        self.pending = {}   # frames that arrived ahead of their turn

    def frame(self, i, data):
        if i < self.n or i in self.pending:
            raise ValueError("frame %d arrived twice" % i)
        self.pending[i] = data
        while self.n in self.pending:
            for img in self.jpeg.decode(self.av.Packet(self.pending.pop(self.n))):
                if (img.width, img.height) != (self.video.width, self.video.height):
                    raise ValueError("frame %d is %dx%d" % (self.n, img.width, img.height))
                # (a JPEG's full-range BT.601 colour into HD video's own BT.709, tagged so below)
                img = img.reformat(format="yuv420p", src_colorspace="ITU601", dst_colorspace="ITU709")
                img.pts = self.n
                for pkt in self.video.encode(img):
                    self.out.mux(pkt)
            self.n += 1

    def finish(self):
        for pkt in self.video.encode():
            self.out.mux(pkt)
        # The song from t0 to t1, at 48 kHz stereo.
        import numpy as np
        from fractions import Fraction
        rate = 48000
        src = self.av.open(self.audio_path)
        res = self.av.AudioResampler(format="fltp", layout="stereo", rate=rate)
        chunks = []
        for fr in src.decode(audio=0):
            for r in res.resample(fr):
                chunks.append(r.to_ndarray())
        for r in res.resample(None):
            chunks.append(r.to_ndarray())
        src.close()
        pcm = np.concatenate(chunks, axis=1)[:, int(round(self.t0 * rate)):int(round(self.t1 * rate))]
        pcm = np.ascontiguousarray(pcm, dtype=np.float32)
        n = 1024
        for i in range(0, pcm.shape[1], n):
            fr = self.av.AudioFrame.from_ndarray(np.ascontiguousarray(pcm[:, i:i + n]), format="fltp", layout="stereo")
            fr.sample_rate, fr.pts, fr.time_base = rate, i, Fraction(1, rate)
            for pkt in self.audio.encode(fr):
                self.out.mux(pkt)
        for pkt in self.audio.encode():
            self.out.mux(pkt)
        self.out.close()

    def cancel(self):
        try:
            self.out.close()
        finally:
            if os.path.exists(self.path):
                os.remove(self.path)


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 64   # a clip render posts several frames at once (the default 5 refused some)


class Handler(http.server.SimpleHTTPRequestHandler):
    # Windows' registry sometimes maps .js to text/plain, which kills ES modules.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".html": "text/html; charset=utf-8",
        ".json": "application/json",
        ".lrc": "text/plain; charset=utf-8",
        ".srt": "text/plain; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".opus": "audio/ogg",
        ".wav": "audio/wav",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if url.path == "/api/tracks":
            return self.send_tracks()
        if url.path == "/api/voice":
            return self.send_voice_status()
        if url.path == "/api/say":
            return self.send_say(urllib.parse.parse_qs(url.query))
        if url.path == "/api/lyrics":
            return self.send_lyrics_status(urllib.parse.parse_qs(url.query))
        if url.path == "/api/hear":
            if oasis_ear is None:
                return self.send_json({"state": "error", "error": HEAR_IMPORT_ERROR})
            return self.send_json(oasis_ear.status())
        if url.path == "/api/perf":
            with PERF_LOCK:
                return self.send_json({"rows": read_perf()[-2000:]})
        return super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        if path.startswith("/api/render/"):
            return self.render(path[len("/api/render/"):])
        if path == "/api/hear":
            return self.send_heard()
        if path == "/api/perf":
            return self.save_perf()
        if path == "/api/here":
            return self.here()
        if path != "/api/played":
            return self.send_json({"error": "not found"}, 404)
        try:
            n = min(int(self.headers.get("Content-Length") or 0), 4096)
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            name = str(body["name"])[:300]
            seconds = max(0.0, min(float(body.get("seconds") or 0), 900.0))
        except (ValueError, KeyError, TypeError) as e:
            return self.send_json({"error": "bad listening report: %s" % e}, 400)
        with PLAYS_LOCK:
            entry = plays().setdefault(name, {"seconds": 0.0, "plays": 0, "last": 0})
            entry["seconds"] = round(entry["seconds"] + seconds, 1)
            if body.get("play"):
                entry["plays"] += 1
            if body.get("skip"):
                entry["skips"] = entry.get("skips", 0) + 1
            if "dislike" in body:
                entry["disliked"] = bool(body["dislike"])
            if seconds or body.get("play") or body.get("skip"):
                entry["last"] = int(time.time())
            save_plays()
            out = dict(entry)
        return self.send_json(out)

    # Frame rate per stretch of listening (js/main.js), so a card running hot over hours
    # shows up as frames falling over time. One JSON line each, the last 5000 kept.
    def save_perf(self):
        try:
            n = min(int(self.headers.get("Content-Length") or 0), 2048)
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            row = {k: body[k] for k in ("song", "fps", "low", "secs", "quality", "cap", "w", "h") if k in body}
            row["song"] = str(row.get("song", ""))[:200]
            row["at"] = int(time.time())
        except (ValueError, TypeError) as e:
            return self.send_json({"error": "bad perf report: %s" % e}, 400)
        with PERF_LOCK:
            rows = read_perf()
            rows.append(row)
            with open(PERF_PATH, "w", encoding="utf-8") as f:
                f.write("".join(json.dumps(r) + "\n" for r in rows[-5000:]))
        return self.send_json({"ok": True})

    # Which Lofts are open right now, across every server run from this folder (the
    # user's on 8030, Claude's preview on 8040): each checks in every 10 s.
    def here(self):
        try:
            n = min(int(self.headers.get("Content-Length") or 0), 256)
            me = str(json.loads(self.rfile.read(n).decode("utf-8") or "{}")["id"])[:40]
        except (ValueError, KeyError, TypeError) as e:
            return self.send_json({"error": "bad hello: %s" % e}, 400)
        path = os.path.join(ROOT, "cache", "presence.json")
        now = time.time()
        with PERF_LOCK:
            try:
                with open(path, encoding="utf-8") as f:
                    seen = json.load(f)
            except (OSError, ValueError):
                seen = {}
            seen = {k: v for k, v in seen.items() if now - v < 25}
            seen[me] = now
            try:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(seen, f)
            except OSError:
                pass
        return self.send_json({"others": len(seen) - 1})

    def render(self, step):
        global RENDER
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if 0 < n <= 40_000_000 else b""
        with RENDER_LOCK:
            try:
                if step == "start":
                    if RENDER is not None:
                        RENDER.cancel()   # a render the page abandoned
                        RENDER = None
                    q = json.loads(body.decode("utf-8") or "{}")
                    url = urllib.parse.unquote(urllib.parse.urlsplit(str(q["track"])).path)
                    if not url.startswith("/music/"):
                        return self.send_json({"error": "only songs in music/ can be rendered"}, 400)
                    audio = os.path.realpath(os.path.join(MUSIC, url[len("/music/"):]))
                    if not audio.startswith(os.path.realpath(MUSIC) + os.sep) or not os.path.isfile(audio):
                        return self.send_json({"error": "song not found in music/"}, 404)
                    t0, t1 = float(q["from"]), float(q["to"])
                    fps, w, h = int(q.get("fps", 60)), int(q.get("width", 1920)), int(q.get("height", 1080))
                    if not (0 <= t0 < t1 and 1 <= fps <= 120 and 16 <= w <= 3840 and 16 <= h <= 2160 and w % 2 == 0 and h % 2 == 0):
                        return self.send_json({"error": "bad render settings"}, 400)
                    name = "".join(c for c in str(q.get("name") or "clip") if c.isalnum() or c in " -_()'").strip()[:80] or "clip"
                    stamp = "%d-%02d to %d-%02d" % (t0 // 60, t0 % 60, t1 // 60, t1 % 60)
                    os.makedirs(RENDERS, exist_ok=True)
                    out = os.path.join(RENDERS, "%s (%s).mp4" % (name, stamp))
                    RENDER = ClipRender(out, audio, t0, t1, fps, w, h)
                    return self.send_json({"ok": True, "path": os.path.relpath(out, ROOT)})
                if step == "sheet":
                    # A clip's contact sheet (render.js): its moments as one PNG, for review.
                    q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                    file = "".join(c for c in (q.get("file") or [""])[0] if c.isalnum() or c in " -_()'").strip()[:120]
                    if not file or not body.startswith(b"\x89PNG"):
                        return self.send_json({"error": "bad contact sheet"}, 400)
                    os.makedirs(os.path.join(RENDERS, "sheets"), exist_ok=True)
                    out = os.path.join(RENDERS, "sheets", file + ".png")
                    with open(out, "wb") as f:
                        f.write(body)
                    return self.send_json({"path": os.path.relpath(out, ROOT)})
                if RENDER is None:
                    return self.send_json({"error": "no render is running"}, 409)
                if step == "frame":
                    if not body:
                        return self.send_json({"error": "empty frame"}, 400)
                    i = int(urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)["i"][0])
                    RENDER.frame(i, body)
                    return self.send_json({"n": RENDER.n})
                if step == "finish":
                    r, RENDER = RENDER, None
                    if r.pending:
                        r.cancel()
                        return self.send_json({"error": "frames missing before %d" % min(r.pending)}, 400)
                    r.finish()
                    return self.send_json({"path": os.path.relpath(r.path, ROOT), "frames": r.n,
                                           "mb": round(os.path.getsize(r.path) / 1e6, 1)})
                if step == "cancel":
                    r, RENDER = RENDER, None
                    r.cancel()
                    return self.send_json({"ok": True})
                return self.send_json({"error": "not found"}, 404)
            except (ValueError, KeyError, TypeError) as e:
                return self.send_json({"error": "bad render request: %s" % e}, 400)
            except Exception as e:   # an encoder failure: reported to the page, never hidden
                print("[loft] render failed: %s: %s" % (type(e).__name__, e), file=sys.stderr)
                return self.send_json({"error": "render failed: %s: %s" % (type(e).__name__, e)}, 500)

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_heard(self):
        """Talk to Oasis: a few seconds of your voice in, the words out. Whisper is
        primed with the shelf's song names and the house's own words."""
        if oasis_ear is None:
            return self.send_json({"error": "Listening needs faster-whisper: " + HEAR_IMPORT_ERROR}, 503)
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 < n <= 8_000_000:
            return self.send_json({"error": "send a few seconds of audio"}, 400)
        data = self.rfile.read(n)
        names = []
        if os.path.isdir(MUSIC):
            for f in sorted(os.listdir(MUSIC), key=str.lower):
                stem, ext = os.path.splitext(f)
                short = stem.split(" — ")[0].split(" (")[0].replace(" cover", "").strip()
                if ext.lower() in AUDIO_EXT and short not in names:
                    names.append(short)
        prompt = ("Oasis. Play " + ", ".join(names[:70]) + ". Next, pause, louder, quieter, the drop, the lyrics, "
                  "the Loft, the drop, the lyrics, something lonely.")
        try:
            return self.send_json(oasis_ear.hear(data, prompt))
        except Exception as e:
            print("[loft] listening failed: %s: %s" % (type(e).__name__, e), file=sys.stderr)
            return self.send_json({"error": "%s: %s" % (type(e).__name__, e)}, 500)

    def send_voice_status(self):
        if tts is None:
            return self.send_json({"state": "error", "error": "Kokoro is not installed (" + TTS_IMPORT_ERROR + "). Run START THE LOFT.bat once with internet to set it up."})
        st = tts.status()
        st.update({"voices": [{"id": v, "label": l} for v, l in tts.CURATED], "default": tts.DEFAULT_VOICE})
        return self.send_json(st)

    def send_say(self, q):
        if tts is None:
            return self.send_json({"error": "Kokoro is not installed: " + TTS_IMPORT_ERROR}, 503)
        text = (q.get("text") or [""])[0][:400]
        voice = (q.get("voice") or [tts.DEFAULT_VOICE])[0]
        try:
            speed = max(0.6, min(1.4, float((q.get("speed") or ["0.95"])[0])))
            r = tts.engine().say(text, voice=voice, speed=speed)
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        except Exception as e:
            print("[loft] voice failed: %s: %s" % (type(e).__name__, e), file=sys.stderr)
            return self.send_json({"error": "%s: %s" % (type(e).__name__, e)}, 503)
        return self.send_json({
            "sampleRate": 24000, "duration": r["duration"], "words": r["words"],
            "genSeconds": round(r["genSeconds"], 3), "voice": r["voice"],
            "audio": base64.b64encode(r["wav"]).decode("ascii"),
        })

    def send_lyrics_status(self, q):
        if WORKER is None:
            return self.send_json({"state": "error", "error": LYRICS_IMPORT_ERROR or "auto-lyrics is off"})
        out = WORKER.summary()
        name = (q.get("want") or [""])[0]
        if name and name in WORKER.songs():   # only songs on the shelf (never a path someone else made up)
            WORKER.want(name)
            out["song"] = {"name": name, "status": WORKER.status_of(name)}
            if out["song"]["status"] == "done":
                out["song"]["url"] = auto_lyrics_url(name)
        return self.send_json(out)

    def send_tracks(self):
        tracks = []
        if os.path.isdir(MUSIC):
            names = sorted(os.listdir(MUSIC), key=str.lower)
            lower = {n.lower(): n for n in names}
            for name in names:
                stem, ext = os.path.splitext(name)
                if ext.lower() not in AUDIO_EXT:
                    continue

                def find(*cands):
                    for c in cands:
                        hit = lower.get(c.lower())
                        if hit:
                            return "/music/" + urllib.parse.quote(hit)
                    return None

                own = find(stem + ".lrc", stem + ".srt")
                auto = None if own else auto_lyrics_url(stem)
                info = autolyrics.lrc_info(stem) if auto and autolyrics else None
                heard = plays().get(stem, {})
                tracks.append({
                    "name": stem,
                    "url": "/music/" + urllib.parse.quote(name),
                    "lyrics": own or auto,
                    "lyricsAuto": bool(auto),
                    "lyricsYours": bool(info and info["kind"] == "yours"),   # your words from the song file, timed by the loft
                    "voice": find(stem + ".voice.lrc", stem + ".voice.txt"),
                    "listened": heard.get("seconds", 0), "plays": heard.get("plays", 0),
                    "skips": heard.get("skips", 0), "last": heard.get("last", 0),
                    "disliked": bool(heard.get("disliked")),
                })
        self.send_json({"tracks": tracks})

    def log_message(self, fmt, *args):
        # Only shout about failures; a quiet console is a readable console.
        if len(args) > 1 and str(args[1])[:1] in ("4", "5"):
            sys.stderr.write("[loft] %s\n" % (fmt % args))


def open_server(start):
    # A port nobody answers on, that we can also bind (Windows reserves some ranges
    # for Hyper-V/WSL/Docker, and a port can be taken between the probe and the bind).
    for port in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                continue
        try:
            return port, Server(("127.0.0.1", port), Handler)
        except OSError:
            continue
    raise SystemExit("[loft] No free port between %d and %d." % (start, start + 19))


def main():
    global WORKER
    sys.stdout.reconfigure(line_buffering=True)   # progress lines show up immediately, even when piped
    os.makedirs(MUSIC, exist_ok=True)
    if autolyrics is not None and "--no-lyrics" not in sys.argv:
        WORKER = autolyrics.Worker(threads=3)
        print("[loft] Auto-lyrics: transcribing songs in the background (3 CPU threads, cached once).")
    elif autolyrics is None:
        print("[loft] Auto-lyrics unavailable (%s)." % LYRICS_IMPORT_ERROR)
    if tts is not None:
        tts.start_loading()
        print("[loft] Kokoro voice warming up on the CPU...")
    else:
        print("[loft] Kokoro voice unavailable (%s); using the browser voice." % TTS_IMPORT_ERROR)
    first = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else FIRST_PORT
    port, server = open_server(first)
    url = "http://127.0.0.1:%d/" % port
    print("[loft] The Loft is open at %s" % url)
    print("[loft] Drop songs into: %s" % MUSIC)
    print("[loft] Close this window to shut the loft.")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[loft] Closed.")


if __name__ == "__main__":
    main()
