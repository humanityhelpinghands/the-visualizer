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
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
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
import think as oasis_think
THINK = oasis_think.Think(ROOT)
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
    try:
        mtime = os.stat(path).st_mtime
    except OSError:
        return None
    return "/cache/lyrics/" + urllib.parse.quote(stem + ".lrc") + "?v=%d" % int(mtime)

# Listening history: {song: {"seconds": heard, "plays": n, "skips": n, "last": unix time,
#                             "disliked": true when you've said "not for me"}}
PLAYS_PATH = os.path.join(ROOT, "cache", "plays.json")
PLAYS_LOCK = threading.Lock()
PERF_PATH = os.path.join(ROOT, "cache", "perf.jsonl")
# The other space, opened inside the Loft (the music keeps playing): its folder sits beside this one.
SPACES = {"atlas": os.path.join(os.path.dirname(ROOT), "atlas-of-you")}
ATLAS_LOCK = threading.Lock()


def fresh_atlas():
    """Redraws the Atlas from the songs, plays and ideas (a second's work), at most every five minutes."""
    out = os.path.join(SPACES["atlas"], "atlas.html")
    with ATLAS_LOCK:
        if os.path.exists(out) and time.time() - os.path.getmtime(out) < 300:
            return
        try:
            subprocess.run(["node", "build.mjs"], cwd=SPACES["atlas"], timeout=30, capture_output=True, creationflags=NO_WINDOW)   # (no console window: under the windowless starter it would flash one over the room)
        except (OSError, subprocess.SubprocessError) as e:
            print("[loft] The Atlas could not be redrawn (it shows the last one): %s" % e)


# Closing the Loft's window closes the Loft (when the desktop icon started it): the page says it's
# alive every few seconds and says goodbye as it closes; a goodbye with no page back within a few
# seconds (a reload comes back) or a long silence ends the server, and the voice and lyrics with it.
ALIVE = {"last": 0.0, "bye": 0.0}
NOW = {"at": 0.0, "is": {}}   # what the page last said it is playing (it rides on the page's hello)


SAY_FAILED = None   # (the windowless starter sets this to its own "could not start" message: with no console, a start that ends without a window would end in silence)
HELD_WAIT = 20.0    # (seconds a second click waits for a Visualizer that is still starting to answer on the port)


def close_due(now, last, bye):
    """True when, by the clock, the room's page has gone quiet for good: a goodbye over 20 s ago with no hello since, or no
    hello at all for 150 s. (20 s, not 6: when the icon is clicked again a new window replaces the old one, the old one says
    goodbye, and a new page still loading in the background can take longer than 6 s to say its next hello. A minimized,
    paused window only checks in once a minute.) The window itself has the last word: watch_window."""
    return (bye > last and now - bye > 20) or now - last > 150


def watch_window():
    while True:
        time.sleep(1)
        now, last, bye = time.time(), ALIVE["last"], ALIVE["bye"]
        if not last:
            if now - START > 180:   # (the window never opened)
                if SAY_FAILED: SAY_FAILED("no window said hello within 180 s of the start, so the server ended")
                os._exit(0)
            continue
        # after 150 s of a page too starved to check in while a heavy job ran. The lyrics failed and Windows' voice took over.
        # The goodbye rule asks the window too since 2026-11-12: a reload says goodbye as well, and on a starved PC the page
        # that comes back can need longer than 20 s for its first hello.)
        if close_due(now, last, bye) and not loft_windows():
            print("[loft] The window closed: closing the Loft. (last hello %.0f s ago, goodbye %s)" % (now - last, "%.0f s ago" % (now - bye) if bye else "never"), flush=True)   # (which of the two reasons it was, for the day it closes with the window still open)
            for lock in (PLAYS_LOCK, PERF_LOCK, ATLAS_LOCK):   # (let a save in progress finish first)
                lock.acquire(timeout=3)
            os._exit(0)


START = time.time()
PERF_LOCK = threading.Lock()


_PERF_CACHE = [None, []]   # (mtime_ns, size) of cache/perf.jsonl, and its rows


def read_perf():
    """The perf log's rows (a fresh list each call), parsed again only when the file changed."""
    try:
        st = os.stat(PERF_PATH)
    except OSError:
        return []
    key = (st.st_mtime_ns, st.st_size)
    if _PERF_CACHE[0] != key:
        _PERF_CACHE[1] = _read_perf_file()
        _PERF_CACHE[0] = key
    return list(_PERF_CACHE[1])


def _read_perf_file():
    try:
        with open(PERF_PATH, encoding="utf-8") as f:
            rows = []
            for l in f:
                try:
                    if l.strip():
                        rows.append(json.loads(l))
                except ValueError:   # one torn line (a crash mid-write) must not wipe the whole log on the next save
                    pass
            return rows
    except OSError:
        return []

PLAYS = None


def read_plays():
    """The listening history on disk now. None yet: {}. Broken: kept aside, {} (and said so). Locked for a
    moment (antivirus, the indexer, the other server mid-save): tried again, then an error, never mistaken
    for an empty history (that wiped it once a save followed)."""
    for attempt in range(5):
        try:
            with open(PLAYS_PATH, encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                raise ValueError("expected an object of songs")   # (valid JSON of another shape would crash every report)
            return data
        except FileNotFoundError:
            return {}
        except ValueError as e:   # unreadable: keep it aside, start fresh, say so
            bad = PLAYS_PATH + ".unreadable"
            try:
                os.replace(PLAYS_PATH, bad)
            except OSError:
                pass
            print("[loft] Listening history was unreadable (%s); kept it as %s and started fresh." % (e, bad), file=sys.stderr)
            return {}
        except OSError:
            if attempt == 4:
                raise
            time.sleep(0.2)


def plays():
    global PLAYS
    if PLAYS is None:
        PLAYS = read_plays()
    return PLAYS


def save_plays():
    os.makedirs(os.path.dirname(PLAYS_PATH), exist_ok=True)
    tmp = PLAYS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(PLAYS, f, indent=1)
    for attempt in range(5):   # (Windows refuses the swap while another process has the file open)
        try:
            os.replace(tmp, PLAYS_PATH)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)


# Clip renders (js/render.js): the page draws the show frame by frame and posts
# each one as a numbered JPEG (several at once, in any order); they're put back in
# order and encoded to H.264 here, and the song's own audio for
# the same stretch is cut and muxed in, so picture and sound line up exactly.
# One render at a time, into renders/.
RENDERS = os.path.join(ROOT, "renders")
RENDER_LOCK = threading.Lock()
RENDER = None


class ClipRender:
    def __init__(self, path, audio_path, t0, t1, fps, width, height, master=False, lean=False):
        import av   # (PyAV, part of the lyrics setup; only needed when rendering)
        from fractions import Fraction
        self.av, self.path, self.audio_path, self.t0, self.t1, self.n = av, path, audio_path, t0, t1, 0
        self.master, self.fps, self.lean, self.size = master, fps, bool(master and lean), (width, height)
        if master and self.lean:
            # FAST (render_song fast=True): the frames go straight into the X file as they arrive; no lossless master is
            # written beside it (several GB of disk writes) and nothing is measured against one afterwards.
            self.master_path, self.out, self.video, self.audio = None, None, None, None
            self.x = x_encoder(path, audio_path, t0, t1, fps, width, height)
        elif master:
            # A whole-song post (render.js, master: true): the page sends each frame's raw RGBA bytes, kept here as a
            # lossless master (x264 at qp 0, the exact frames in HD's own 4:2:0 colour). The X file is encoded
            # from it afterwards (XEncode) and measured against it, so "same as live" is a number.
            self.master_path = os.path.join(RENDERS, "masters", os.path.splitext(os.path.basename(path))[0] + " master.mkv")
            os.makedirs(os.path.dirname(self.master_path), exist_ok=True)
            self.out = av.open(self.master_path, "w")
            self.video = self.out.add_stream("libx264", rate=fps)
            self.video.width, self.video.height, self.video.pix_fmt = width, height, "yuv420p"
            self.video.time_base = Fraction(1, fps)
            self.video.options = {"qp": "0", "preset": "ultrafast",
                                  "x264-params": "colorprim=bt709:transfer=bt709:colormatrix=bt709"}
            self.audio = None
            self.jpeg = av.CodecContext.create("png", "r")
            # The X file is packed as the frames arrive (each frame's exact 4:2:0 bytes piped to ffmpeg), so packing
            # runs alongside the drawing instead of after it: a song takes the longer of the two, not their sum.
            self.x = x_encoder(path, audio_path, t0, t1, fps, width, height)
        else:
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
        self.broken = False

    def frame(self, i, data):
        if i < self.n or i in self.pending:
            raise ValueError("frame %d arrived twice" % i)
        if i > self.n + 2000:   # (the page sends a few at once; one this far ahead would sit in memory for good)
            raise ValueError("frame %d is too far ahead of %d" % (i, self.n))
        self.pending[i] = data
        try:
            self._encode_ready()
        except Exception:
            self.broken = True
            raise

    def _encode_ready(self):
        while self.n in self.pending:
            data = self.pending.pop(self.n)
            if self.master:   # the frame's own RGBA bytes (render.js 'raw')
                w, h = self.size
                if len(data) != w * h * 4:
                    raise ValueError("frame %d is %d bytes, not %dx%d RGBA" % (self.n, len(data), w, h))
                import numpy as np
                imgs = [self.av.VideoFrame.from_ndarray(np.frombuffer(data, np.uint8).reshape(h, w, 4), format="rgba")]
            else:
                imgs = self.jpeg.decode(self.av.Packet(data))
            for img in imgs:
                if (img.width, img.height) != self.size:
                    raise ValueError("frame %d is %dx%d" % (self.n, img.width, img.height))
                if self.master:   # (the canvas's RGB into HD video's own BT.709, limited range, tagged so above)
                    img = img.reformat(format="yuv420p", dst_colorspace="ITU709", dst_color_range="MPEG")
                else:   # (a JPEG's full-range BT.601 colour into HD video's own BT.709, tagged so below)
                    img = img.reformat(format="yuv420p", src_colorspace="ITU601", dst_colorspace="ITU709")
                img.pts = self.n
                if self.video is not None:   # (a lean render keeps no master: the X file below is all it writes)
                    for pkt in self.video.encode(img):
                        self.out.mux(pkt)
                if self.master:
                    if self.x.poll() is not None:
                        raise RuntimeError("the X encoder stopped: " + "".join(self.x.err[-5:]).strip())
                    self.x.stdin.write(img.to_ndarray().tobytes())
            self.n += 1

    def finish(self):
        if self.video is not None:
            for pkt in self.video.encode():
                self.out.mux(pkt)
        if self.master:
            if self.out is not None:
                self.out.close()
            self.x.stdin.close()   # (the encoder finishes in x_encode, off this request)
            return
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
            if getattr(self, "x", None):
                self.x.kill()
                self.x.wait()
            if self.out is not None:
                self.out.close()
        finally:
            for p in (self.path, getattr(self, "master_path", None)):
                if p and os.path.exists(p):
                    os.remove(p)


# The X file, made from a whole-song master (ClipRender master=True) in the background:
# H.264 High, 4:2:0, closed GOP, AAC LC stereo, 60 fps at most (X's own upload rules), at the
# smallest size that still measures the same as the master. Then it is measured: VMAF of the
# X file against the lossless master, written next to the MP4 and reported to the page.
# Settings picked by measurement (tools/x_encode_study.py, 2026-11-05, 30 s of Changing Its Name over its 2:02 drop):
# slower + crf 20 + tune animation was the smallest of 16 candidates at VMAF 95 or more (95.8, worst 1% of frames 91.6,
# 15.6 Mb/s, about 117 MB a minute); plain slow crf 20 needed 18.4 Mb/s for 95.0. x265 was 22% smaller but X lists
# only H.264. The old clip setting (crf 16, medium) is kept for clips.
X_VIDEO = ["-c:v", "libx264", "-preset", "slower", "-tune", "animation", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p",
           "-x264-params", "open-gop=0:keyint=120:colorprim=bt709:transfer=bt709:colormatrix=bt709",
           "-maxrate", "25M", "-bufsize", "50M"]
X_AUDIO = ["-c:a", "aac", "-profile:a", "aac_low", "-b:a", "256k", "-ar", "48000", "-ac", "2"]
# seconds per 10 s of 1080p60, the card 2.3. Its bitrate modes (qvbr 18 to 26) never reached the bar (VMAF 82 to 89); fixed
# quality did: cqp 25 measured VMAF 96.1, worst 1% of frames 92.0, 19.1 Mb/s, encoding at 62 fps (x264 slower: 95.8, 91.6,
# 15.6 Mb/s, 12.9 fps). cqp 26 fell to 95.1 / 90.6. Every GOP starts on a key frame (closed, like open-gop=0). If the card's
# encoder is missing or fails its one-time test, the x264 setting above is used, as before.
X_VIDEO_CARD = ["-c:v", "h264_amf", "-usage", "transcoding", "-quality", "quality", "-vbaq", "true", "-preanalysis", "true",
                "-bf", "2", "-rc", "cqp", "-qp_i", "25", "-qp_p", "25", "-qp_b", "27", "-g", "120", "-gops_per_idr", "1",
                "-profile:v", "high", "-pix_fmt", "yuv420p",
                "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]
CARD = None   # None: not tried yet; then True or False for the life of the server


def card_works():
    """One tiny test encode on the card; False on any failure."""
    try:
        r = subprocess.run([ffmpeg_bin(), "-hide_banner", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=60:d=0.25",
                            *X_VIDEO_CARD, "-f", "null", "-"], capture_output=True, timeout=30, creationflags=NO_WINDOW)
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def x_video(width=1920, height=1080):
    """The card's settings when it works; the processor's for tiny frames (the card's encoder refused 320x180 on this PC)."""
    global CARD
    if width < 640 or height < 360:
        return X_VIDEO
    if CARD is None:
        CARD = card_works()
    return X_VIDEO_CARD if CARD else X_VIDEO
XJOB = {"state": "idle"}

# noticing that I'm rendering it."): a render is polite. Every process it starts runs at Windows' lowest priority, the frame
#  old hold still let 4 hidden frames a second through. Measured in the preview at 18:45 CT: one hidden frame at twice HD's size
POLITE = getattr(subprocess, "IDLE_PRIORITY_CLASS", 0)
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


# in every hello (2 s); while none are late the pace grows from 1 hidden frame a second by half a frame per hello, a few late
# halve it, many stop it (the whole wait). The six frame lanes share one pace. Additive increase, multiplicative decrease, read
SPARE_START, SPARE_STEP, SPARE_MAX = 1.0, 0.5, 30.0
SPARE = {"rate": 0.0, "next": 0.0}
SPARE_LOCK = threading.Lock()


def spare_hello(late, frames, rate=None):
    """The hidden render's pace (frames a second) after one hello of the player window with `late` of its `frames` late."""
    r = SPARE["rate"] if rate is None else rate
    if not frames: return r
    if late <= frames * 0.01: return SPARE_START if r <= 0 else min(SPARE_MAX, r + SPARE_STEP)
    if late <= frames * 0.03: return r / 2
    return 0.0


def held(is_watching=None, running=None, nap=0.05):
    """Holds this frame's reply, and so the hidden drawing behind it, while someone watches (the player window playing on screen) and the
    render still runs, letting one frame through at the spare pace (none at pace 0); every frame lane shares that one pace.
    Returns the seconds held (0 when nobody is watching)."""
    is_watching = is_watching or watching
    running = running or (lambda: RENDER is not None)
    t0 = time.time()
    while running() and is_watching():
        with SPARE_LOCK:
            r, now = SPARE["rate"], time.time()
            if r > 0 and now >= SPARE["next"]:
                SPARE["next"] = max(SPARE["next"] + 1 / r, now)
                break
        time.sleep(nap)
    return time.time() - t0


def watching(now=None):
    """The Visualizer window is playing and on screen (its hello, every 2 s; the hidden render's own hello is left out)."""
    now = time.time() if now is None else now
    return now - NOW["at"] < 6 and bool(NOW["is"].get("playing")) and NOW["is"].get("visible") is not False



def idle_thread():
    """Drop the calling thread (the frame socket's: it packs the master) to Windows' idle priority."""
    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.kernel32.SetThreadPriority(ctypes.windll.kernel32.GetCurrentThread(), -15)   # THREAD_PRIORITY_IDLE
        except Exception:
            pass


JOBS = []   # job handles stay open while their processes run (closing one does not end them)


def start_idle(cmd, **kw):
    """Popen at idle priority inside a Windows job that locks every process of its tree at idle. Chromium raises its own
    helpers' priority (measured 2026-11-07: 3 of the hidden browser's 9 processes above idle); a job's priority limit wins.
    The process starts suspended, joins the job, then runs, so no child is born outside it. Off Windows: a plain Popen."""
    if os.name != "nt":
        return subprocess.Popen(cmd, **kw)
    import ctypes
    from ctypes import wintypes
    p = subprocess.Popen(cmd, creationflags=NO_WINDOW | POLITE | 0x4, **kw)   # 0x4: CREATE_SUSPENDED
    try:
        class Limits(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]
        k = ctypes.windll.kernel32
        k.CreateJobObjectW.restype = wintypes.HANDLE
        job = k.CreateJobObjectW(None, None)
        lim = Limits(LimitFlags=0x20, PriorityClass=POLITE)   # JOB_OBJECT_LIMIT_PRIORITY_CLASS, idle
        k.SetInformationJobObject(wintypes.HANDLE(job), 2, ctypes.byref(lim), ctypes.sizeof(lim))   # basic limits
        k.AssignProcessToJobObject(wintypes.HANDLE(job), wintypes.HANDLE(int(p._handle)))
        JOBS.append(job)
    finally:
        ctypes.windll.ntdll.NtResumeProcess(ctypes.c_void_p(int(p._handle)))
    return p


def ffmpeg_bin(name="ffmpeg"):
    import shutil
    here = os.path.join(os.path.dirname(ROOT), "tools", "ffmpeg", "bin", name + ".exe")
    return here if os.path.isfile(here) else (shutil.which(name) or name)


def x_encoder(out, audio_path, t0, t1, fps, width, height):
    """ffmpeg packing the X file from raw 4:2:0 frames on its stdin, with the song's own sound from t0 to t1."""
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostats", "-y",
           "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", "%dx%d" % (width, height), "-r", str(fps),
           "-color_range", "tv", "-colorspace", "bt709", "-i", "pipe:0",
           "-ss", "%.6f" % t0, "-t", "%.6f" % (t1 - t0), "-i", audio_path,
           "-map", "0:v:0", "-map", "1:a:0", *x_video(width, height), *X_AUDIO, "-shortest",
           "-map_metadata", "-1", "-movflags", "+faststart", "-progress", "pipe:1", out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=NO_WINDOW | POLITE)
    p.err, p.packed = [], 0

    def read_progress():
        for line in p.stdout:
            if line.startswith(b"frame="):
                p.packed = int(line.split(b"=", 1)[1] or 0)
    threading.Thread(target=read_progress, daemon=True).start()
    threading.Thread(target=lambda: p.err.extend(l.decode("utf-8", "replace") for l in p.stderr), daemon=True).start()
    return p


def x_encode_start(r):
    song, fast = XJOB.get("song"), bool(XJOB.get("fast"))
    XJOB.clear()
    XJOB.update({"state": "encoding", "step": "packing the last frames for X", "frames": r.n, "done": r.x.packed, "song": song, "fast": fast,
                 "path": os.path.relpath(r.path, ROOT), "started": getattr(r, "started", time.time())})
    threading.Thread(target=x_encode, args=(r,), daemon=True).start()


def free_path(out):
    """A render never lands on a video already made: 'name.mp4', then 'name 2.mp4', 'name 3.mp4'. (A second video
    of one song wrote over the first, and its STOP then deleted it: the 422.9 MB X video, 2026-11-05.)"""
    base, ext = os.path.splitext(out)
    k = 2
    while os.path.exists(out):
        out, k = "%s %d%s" % (base, k, ext), k + 1
    return out


def downloads_dir():
    return os.path.join(os.path.expanduser("~"), "Downloads")


def x_final_path(song, folder=None):
    """Where a finished X video lands:
    Downloads, named after the song, never over a video already there."""
    import re
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", str(song or "")).strip(" .")
    safe = re.sub(r"\s+", " ", safe) or "song"
    return free_path(os.path.join(folder or downloads_dir(), safe[:120] + ".mp4"))


XWORK = []   # the ffmpeg running for the X job right now (packing, then measuring), so STOP can end it


def x_stop():
    """STOP while the X file packs or is measured: end that ffmpeg; x_encode sees 'stopped' and cleans up."""
    XJOB.update({"state": "stopped", "error": "stopped"})
    for p in list(XWORK):
        if p.poll() is None:
            p.kill()


def x_encode(r):
    master, out, n = r.master_path, r.path, r.n
    XWORK[:] = [r.x]
    try:
        while r.x.poll() is None:
            XJOB["done"] = r.x.packed
            time.sleep(0.5)
        if XJOB.get("state") == "stopped":
            raise InterruptedError("stopped")
        if r.x.returncode != 0:
            raise RuntimeError("ffmpeg: " + "".join(r.x.err[-5:]).strip())
        XJOB.update({"step": "measuring it against the master" if master else "moving it to Downloads", "done": 0,
                     "mb": round(os.path.getsize(out) / 1e6, 1)})
        if master:   # (FAST keeps no master, so there is nothing to measure against: it is done as soon as it is packed)
            XJOB.update(x_measure(out, master, n))
            with open(os.path.splitext(out)[0] + " quality.json", "w", encoding="utf-8") as f:
                json.dump({k: XJOB[k] for k in ("mb", "vmaf", "vmaf_low", "frames", "path") if k in XJOB}, f, indent=1)
        final = x_final_path(XJOB.get("song") if master else "%s (quick)" % (XJOB.get("song") or "song"))
        os.makedirs(os.path.dirname(final), exist_ok=True)
        import shutil
        shutil.move(out, final)
        XJOB.update({"state": "done", "step": "done", "path": final, "seconds": round(time.time() - XJOB["started"])})
        if master:
            os.remove(master)   # (several GB; the MP4 and its measurement are what's kept)
    except Exception as e:
        if XJOB.get("state") == "stopped":
            for f in (out, master):
                if f and os.path.exists(f):
                    os.remove(f)
        else:
            print("[loft] X encode failed: %s: %s" % (type(e).__name__, e), file=sys.stderr)
            XJOB.update({"state": "failed", "error": "%s: %s" % (type(e).__name__, e)})
    finally:
        XWORK.clear()
        close_render_browser()


# The hidden browser a whole-song render draws in (render_song): its own profile, no window on screen,
RENDER_BROWSER = None


def render_song(port, name, fps=60, width=1920, height=1080, supersample=2, fast=False):
    """fast: 30 frames a second instead of
    60 and no supersampling, so about an eighth of the drawing, and no lossless master or quality measure afterwards (lean)."""
    global RENDER_BROWSER
    close_render_browser()
    if fast:
        fps, supersample = 30, 1
    exe = next((c for c in [os.path.join(os.environ.get(k, ""), *p) for k, p in (
        ("ProgramFiles", ("BraveSoftware", "Brave-Browser", "Application", "brave.exe")),
        ("LOCALAPPDATA", ("BraveSoftware", "Brave-Browser", "Application", "brave.exe")),
        ("ProgramFiles", ("Google", "Chrome", "Application", "chrome.exe")),
        ("ProgramFiles(x86)", ("Microsoft", "Edge", "Application", "msedge.exe")))] if os.path.isfile(c)), None)
    if not exe:
        raise RuntimeError("no Brave, Chrome or Edge to draw in")
    url = "http://127.0.0.1:%d/?%s" % (port, urllib.parse.urlencode({"xrender": name, "fps": fps, "w": width, "h": height, "ss": supersample,
                                                                      **({"lean": 1} if fast else {})}))
    profile = os.path.join(os.environ.get("LOCALAPPDATA", ROOT), "TheLoft", "render")
    XJOB.clear()
    XJOB.update({"state": "starting", "step": "opening the hidden render window", "song": name, "started": time.time(), "fast": bool(fast)})
    RENDER_BROWSER = start_idle([exe, "--headless=new", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist",
                                       "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--window-size=1280,720",
                                       "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
                                       "--user-data-dir=%s" % profile, "--no-first-run", "--no-default-browser-check",
                                       *(["--remote-debugging-port=%s" % os.environ["LOFT_RENDER_DEBUG"]] if os.environ.get("LOFT_RENDER_DEBUG") else []), url],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)   # (its whole tree locked at idle)


def close_render_browser():
    global RENDER_BROWSER
    b, RENDER_BROWSER = RENDER_BROWSER, None
    if b is not None and b.poll() is None:
        subprocess.run(["taskkill", "/PID", str(b.pid), "/T", "/F"], capture_output=True, creationflags=NO_WINDOW) if os.name == "nt" else b.kill()


def x_measure(out, master, n):
    """VMAF (the 1080p model) of the X file's frames against the master's, every frame: the mean and the
    worst 1% (a few bad frames hide in a mean)."""
    log = os.path.join(RENDERS, "masters", "vmaf.json")
    # (frames paired by number: the master's Matroska rounds times to whole milliseconds, and pairing by time
    # matched some frames with their neighbours; measured 2026-11-05)
    graph = ("[0:v]settb=1/60,setpts=N,format=yuv420p[d];[1:v]settb=1/60,setpts=N,format=yuv420p[m];"
             "[d][m]libvmaf=shortest=1:log_fmt=json:log_path='%s':n_threads=%d" % (log.replace("\\", "/").replace(":", "\\:"), max(2, (os.cpu_count() or 4) - 2)))
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostats", "-i", out, "-i", master, "-lavfi", graph,
           "-f", "null", "-", "-progress", "pipe:1"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=NO_WINDOW | POLITE)
    XWORK[:] = [p]
    if XJOB.get("state") == "stopped":
        p.kill()
    err = []
    threading.Thread(target=lambda: err.extend(p.stderr), daemon=True).start()
    for line in p.stdout:
        if line.startswith("frame="):
            XJOB["done"] = int(line.split("=", 1)[1] or 0)
    if p.wait() != 0:
        raise RuntimeError("VMAF: " + "".join(err[-5:]).strip())
    with open(log, encoding="utf-8") as f:
        frames = [fr["metrics"]["vmaf"] for fr in json.load(f)["frames"]]
    os.remove(log)
    worst = sorted(frames)[:max(1, len(frames) // 100)]
    return {"vmaf": round(sum(frames) / len(frames), 2), "vmaf_low": round(sum(worst) / len(worst), 2), "measured": len(frames)}


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 64   # a clip render posts several frames at once (the default 5 refused some)
    # One Loft per port, ever: Windows' "reuse address" lets a second process bind a port already in use
    # (two Lofts answering on 8030 at once); an exclusive bind makes the second one fail cleanly instead.
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def handle_error(self, request, client_address):
        # The window closing mid-reply (its last listening report, sent as it shuts) is normal:
        # the report was already saved. Only a real failure gets the full traceback in the log.
        if isinstance(sys.exc_info()[1], (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


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

    #  2026-11-05 18:31 port-out, 1866 of 1901 TIME_WAIT ports were ours. HTTP/1.1 keeps one connection for many asks. Every
    #  answer here sends its length (send_json, the file and range replies), which keeping the connection needs.)
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # Files may be kept by the browser but are checked each time (an unchanged one answers
        # "304 not modified" instead of re-sending megabytes of textures and songs); answers
        # from /api/ are never kept.
        self.send_header("Cache-Control", "no-store" if self.path.startswith("/api/") else "no-cache")
        if self.command == "POST":
            self.send_header("Connection", "close")   # (said out loud, so the asker opens a fresh one: see do_POST)
        super().end_headers()

    # Byte ranges ("Range: bytes=a-b"): a seek in a song fetches only what it needs instead of the
    # whole file again. Anything unusual (several ranges, a bad one) gets the whole file, as before.
    _range_left = None

    def send_head(self):
        self._range_left = None
        rng = self.headers.get("Range")
        if not rng or self.path.split("?", 1)[0].endswith("/"):
            return super().send_head()
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return super().send_head()
        try:
            unit, spec = rng.strip().split("=", 1)
            if unit.strip().lower() != "bytes" or "," in spec:
                return super().send_head()
            a, b = (x.strip() for x in spec.split("-", 1))
        except ValueError:
            return super().send_head()
        try:
            f = open(path, "rb")
        except OSError:
            return super().send_head()
        try:
            fs = os.fstat(f.fileno())
            size = fs.st_size
            if a == "" and b.isdigit():                 # the last b bytes
                start, end = max(0, size - int(b)), size - 1
            elif a.isdigit() and (b == "" or b.isdigit()):
                start, end = int(a), size - 1 if b == "" else min(int(b), size - 1)
            else:
                f.close()
                return super().send_head()
            if start >= size or end < start:
                f.close()
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%d" % size)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            self.send_response(206)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Last-Modified", self.date_time_string(fs.st_mtime))
            self.end_headers()
            f.seek(start)
            self._range_left = end - start + 1
            return f
        except Exception:
            f.close()
            raise

    def copyfile(self, source, outputfile):
        left = self._range_left
        if left is None:
            return super().copyfile(source, outputfile)
        self._range_left = None
        while left > 0:
            buf = source.read(min(left, 1 << 20))
            if not buf:
                break
            outputfile.write(buf)
            left -= len(buf)

    def translate_path(self, path):
        parts = urllib.parse.unquote(urllib.parse.urlsplit(path).path).split("/")
        if len(parts) > 3 and parts[1] == "spaces" and parts[2] in SPACES:
            base = os.path.realpath(SPACES[parts[2]])
            full = os.path.realpath(os.path.join(base, *[p for p in parts[3:] if p not in ("", ".", "..")]))
            return full if full == base or full.startswith(base + os.sep) else base   # (never outside that space's folder)
        return super().translate_path(path)

    def local_only(self, posting=False):
        """Only the Loft's own page may talk to this server. Binding to 127.0.0.1 keeps the network out, but any
        website open in the same browser could still POST here (text/plain needs no preflight: it could start Claude
        through /api/oasis/think, rewrite the listening history or write files under renders/), and a rebinding
        domain could read the whole folder back. So: the Host must be this server's own address, and a POST that
        names an Origin must name this server too (no Origin at all, as from curl or a beacon, is fine)."""
        port = self.server.server_address[1]
        ours = ("127.0.0.1:%d" % port, "localhost:%d" % port)
        host = (self.headers.get("Host") or "").lower()
        if host and host not in ours:
            return False
        origin = (self.headers.get("Origin") or "").lower()
        return not (posting and origin and origin not in ("http://" + o for o in ours))

    def body_len(self, cap):
        """Content-Length clamped to 0..cap: a negative one made rfile.read() wait for the connection to close,
        holding a server thread for good."""
        try:
            return max(0, min(int(self.headers.get("Content-Length") or 0), cap))
        except ValueError:
            return 0

    def do_GET(self):
        if not self.local_only():
            return self.send_json({"error": "forbidden"}, 403)
        url = urllib.parse.urlsplit(self.path)
        # Another website can still make the browser GET here (an <img> pointed at /api/say runs Kokoro
        # each time). The browser says when a request comes from another site: those get nothing but /api/now.
        if (url.path.startswith("/api/") or url.path.startswith("/spaces/")) and url.path != "/api/now" \
                and (self.headers.get("Sec-Fetch-Site") or "").lower() == "cross-site":
            return self.send_json({"error": "forbidden"}, 403)
        if url.path == "/api/render/ws":
            return self.render_socket()
        if url.path == "/spaces/atlas/atlas.html" and os.path.isdir(SPACES["atlas"]):
            fresh_atlas()
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
        if url.path == "/api/oasis/learned":
            return self.send_json(THINK.learned())
        if url.path == "/api/now":
            fresh = time.time() - NOW["at"] < 15
            return self.send_json({"ok": True, **(NOW["is"] if fresh else {}), **({"age": round(time.time() - NOW["at"], 1)} if fresh else {})})
        if url.path == "/api/perf":
            with PERF_LOCK:
                return self.send_json({"rows": read_perf()[-2000:]})
        return super().do_GET()

    def do_POST(self):
        self.close_connection = True   # (a body this answer did not read whole must never be taken for the next request)
        if not self.local_only(posting=True):
            return self.send_json({"error": "forbidden"}, 403)
        path = urllib.parse.urlsplit(self.path).path
        if path.startswith("/api/render/"):
            return self.render(path[len("/api/render/"):])
        if path == "/api/hear":
            return self.send_heard()
        if path == "/api/perf":
            return self.save_perf()
        if path == "/api/here":
            return self.here()
        if path == "/api/window":
            return self.send_json({"ok": toggle_window()})
        if path == "/api/oasis/think":
            try:
                n = self.body_len(16384)
                b = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            except (ValueError, TypeError, AttributeError) as e:
                return self.send_json({"error": "bad request: %s" % e}, 400)
            return self.send_json(THINK.ask(str(b.get("said", "")), [str(x) for x in (b.get("songs") or [])][:200]))
        if path == "/api/quit":   # (only the desktop icon's Loft closes itself; a dev server stays up)
            if "--close-with-window" in sys.argv and os.name == "nt":
                threading.Thread(target=quit_loft, daemon=True).start()
                return self.send_json({"ok": True, "closing": True})
            return self.send_json({"ok": True, "closing": False})
        if path in ("/api/alive", "/api/bye"):
            ALIVE["last" if path == "/api/alive" else "bye"] = time.time()
            if path == "/api/bye":
                NOW["at"] = 0.0
            else:
                try:
                    b = json.loads(self.rfile.read(self.body_len(1024)) or b"{}")
                    if isinstance(b, dict) and b.get("song") and not b.get("render"):
                        NOW["is"] = {k: b.get(k) for k in ("song", "t", "dur", "playing", "feeling", "next", "visible")}
                        NOW["at"] = time.time()
                        with SPARE_LOCK:
                            if RENDER is not None and watching():
                                SPARE["rate"] = spare_hello(int(b.get("late") or 0), int(b.get("frames") or 0))
                            else:
                                SPARE["rate"] = 0.0
                except (ValueError, TypeError):
                    pass
            return self.send_json({"ok": True})
        if path != "/api/played":
            return self.send_json({"error": "not found"}, 404)
        try:
            n = self.body_len(4096)
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            name = str(body["name"])[:300]
            seconds = max(0.0, min(float(body.get("seconds") or 0), 900.0))
        except (ValueError, KeyError, TypeError) as e:
            return self.send_json({"error": "bad listening report: %s" % e}, 400)
        global PLAYS
        with PLAYS_LOCK:
            try:
                PLAYS = read_plays()   # (fresh from disk: another Loft on this PC, e.g. a preview, may have written since)
            except OSError as e:
                return self.send_json({"error": "listening history is locked: %s" % e}, 503)
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
            try:
                save_plays()
            except OSError as e:
                return self.send_json({"error": "listening history could not be saved: %s" % e}, 503)
            out = dict(entry)
        return self.send_json(out)

    # Frame rate per stretch of listening (js/main.js), so a card running hot over hours
    # shows up as frames falling over time. One JSON line each, the last 5000 kept.
    def save_perf(self):
        try:
            n = self.body_len(2048)
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            row = {k: body[k] for k in ("song", "fps", "low", "secs", "quality", "cap", "w", "h", "gpu", "gpu90", "cpu", "cpu90", "stalls", "longest") if k in body}   # (stalls, longest: the freezes over 0.1 s in that minute and the longest one, which the frame rate cannot show)
            row["song"] = str(row.get("song", ""))[:200]
            row["at"] = int(time.time())
            row["port"] = self.server.server_address[1]
        except (ValueError, TypeError) as e:
            return self.send_json({"error": "bad perf report: %s" % e}, 400)
        with PERF_LOCK:
            rows = read_perf()
            rows.append(row)
            tmp = PERF_PATH + ".tmp"   # (whole file swapped in: a crash mid-write never tears the log)
            with open(tmp, "w", encoding="utf-8") as f:
                f.write("".join(json.dumps(r) + "\n" for r in rows[-5000:]))
            try:
                os.replace(tmp, PERF_PATH)
                st = os.stat(PERF_PATH)   # (what was just written is the log now: no need to parse it back)
                _PERF_CACHE[0], _PERF_CACHE[1] = (st.st_mtime_ns, st.st_size), rows[-5000:]
            except OSError:
                pass
        return self.send_json({"ok": True})

    # Which Lofts are open right now, across every server run from this folder (the
    def here(self):
        try:
            n = self.body_len(256)
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

    def render_socket(self):
        """Frames of a master over one WebSocket per sender (render.js 'raw'): each message is the frame's number
        (4 bytes, little end first) then its RGBA bytes; each gets a one-line reply. An HTTP upload per frame kept its
        8 MB copy alive in the page until a garbage collection that barely ran (10 GB by frame 3,600, measured
        2026-11-05); a socket frees each frame once it is sent."""
        import hashlib, struct
        origin = self.headers.get("Origin") or ""
        port = self.server.server_address[1]
        if origin not in ("http://127.0.0.1:%d" % port, "http://localhost:%d" % port) or \
                (self.headers.get("Upgrade") or "").lower() != "websocket":
            return self.send_json({"error": "forbidden"}, 403)
        accept = base64.b64encode(hashlib.sha1((self.headers["Sec-WebSocket-Key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.close_connection = True
        rf, wf = self.rfile, self.wfile

        def send(op, payload):
            n = len(payload)
            head = bytes([0x80 | op]) + (bytes([n]) if n < 126 else bytes([126]) + struct.pack(">H", n) if n < 65536 else bytes([127]) + struct.pack(">Q", n))
            wf.write(head + payload)
            wf.flush()

        def read_exact(n):
            b = rf.read(n)
            if len(b) < n:
                raise EOFError
            return b

        message = bytearray()
        idle_thread()
        try:
            while True:
                b0, b1 = read_exact(2)
                op, n = b0 & 0x0F, b1 & 0x7F
                if n == 126:
                    n = struct.unpack(">H", read_exact(2))[0]
                elif n == 127:
                    n = struct.unpack(">Q", read_exact(8))[0]
                if n > 40_000_000:
                    return
                mask = read_exact(4) if b1 & 0x80 else None
                data = read_exact(n)
                if mask:
                    import numpy as np
                    m = np.frombuffer((mask * (n // 4 + 1))[:n], np.uint8)
                    data = (np.frombuffer(data, np.uint8) ^ m).tobytes()
                if op == 8:   # close
                    return send(8, b"")
                if op == 9:   # ping
                    send(10, data)
                    continue
                message += data
                if not b0 & 0x80:   # (a message in several pieces: wait for the last)
                    continue
                msg, message = bytes(message), bytearray()
                i = struct.unpack("<I", msg[:4])[0]
                err = self.take_frame(i, msg[4:])
                held()
                send(1, json.dumps({"i": i, "error": err}).encode())
        except (EOFError, ConnectionError, OSError):
            return

    def take_frame(self, i, body):
        """One frame for the render that's running; None, or what went wrong."""
        global RENDER
        with RENDER_LOCK:
            if RENDER is None:
                return "no render is running"
            try:
                RENDER.frame(i, body)
                return None
            except Exception as e:
                if RENDER.broken:   # a frame in its turn would not go in: the render can't go on
                    r, RENDER = RENDER, None
                    r.cancel()
                    return "render stopped: %s" % e
                return "bad frame: %s" % e

    def render(self, step):
        global RENDER
        n = self.body_len(40_000_001)
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
                    out = free_path(os.path.join(RENDERS, "%s (%s).mp4" % (name, stamp)))
                    if XJOB.get("state") == "encoding":
                        return self.send_json({"error": "an X file is still encoding; wait for it to finish"}, 409)
                    RENDER = ClipRender(out, audio, t0, t1, fps, w, h, master=bool(q.get("master")), lean=bool(q.get("lean")))
                    RENDER.keep_master = q.get("master") == "keep"
                    RENDER.total, RENDER.started = int(round((t1 - t0) * fps)), XJOB.get("started") or time.time()
                    held()
                    return self.send_json({"ok": True, "path": os.path.relpath(out, ROOT)})
                if step == "status":   # a render's progress: frames drawn (and packed for X), then the measuring
                    if RENDER is not None and RENDER_BROWSER is not None and RENDER_BROWSER.poll() is not None:
                        RENDER.cancel()   # (the hidden window died mid-song: say so, never sit at "drawing" for good)
                        RENDER = None
                        XJOB.update({"state": "failed", "error": "the hidden render window closed mid-song"})
                    if RENDER is not None:
                        s = {"state": "drawing", "done": RENDER.n, "frames": RENDER.total, "master": RENDER.master,
                             "started": getattr(RENDER, "started", None), "song": XJOB.get("song"), "fast": XJOB.get("fast", False),
                             "polite": watching(), "spare": SPARE["rate"]}
                        if RENDER.master:
                            s["packed"] = RENDER.x.packed
                        return self.send_json(s)
                    if XJOB.get("state") == "starting" and (RENDER_BROWSER is None or RENDER_BROWSER.poll() is not None):
                        XJOB.update({"state": "failed", "error": "the hidden render window closed before it began"})
                    return self.send_json(XJOB)
                if step == "song":   # a whole song for X, drawn in the hidden render browser (render_song)
                    q = json.loads(body.decode("utf-8") or "{}")
                    if RENDER is not None or XJOB.get("state") in ("starting", "encoding"):
                        return self.send_json({"error": "a render is already running; wait for it or stop it"}, 409)
                    render_song(self.server.server_address[1], str(q["name"]), fast=bool(q.get("fast")))
                    return self.send_json({"ok": True})
                if step == "reveal":   # SHOW FILE on a finished X video: Explorer opens on it (only inside renders/)
                    f = os.path.realpath(os.path.join(ROOT, str(XJOB.get("path") or "")))
                    ok_dirs = (os.path.realpath(RENDERS), os.path.realpath(downloads_dir()))
                    if XJOB.get("state") != "done" or not any(f.startswith(d + os.sep) for d in ok_dirs) or not os.path.isfile(f):
                        return self.send_json({"error": "no finished X video to show"}, 404)
                    subprocess.Popen(["explorer", "/select,", f])
                    return self.send_json({"ok": True})
                if step == "fail":   # the render page hit an error (main.js renderForX)
                    q = json.loads(body.decode("utf-8") or "{}")
                    if RENDER is not None:
                        RENDER.cancel()
                        RENDER = None
                    XJOB.update({"state": "failed", "error": str(q.get("error") or "the render page failed")[:300]})
                    close_render_browser()
                    return self.send_json({"ok": True})
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
                if RENDER is None and step != "cancel":
                    return self.send_json({"error": "no render is running"}, 409)
                if step == "pace":
                    held()
                    return self.send_json({"ok": True})
                if step == "frame":
                    if not body:
                        return self.send_json({"error": "empty frame"}, 400)
                    i = int(urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)["i"][0])
                    try:
                        RENDER.frame(i, body)
                    except Exception as e:
                        if RENDER.broken:   # a frame in its turn would not decode: the clip can't go on (later ones would pile up)
                            r, RENDER = RENDER, None
                            r.cancel()
                            return self.send_json({"error": "render stopped: %s" % e}, 400)
                        raise
                    return self.send_json({"n": RENDER.n})
                if step == "finish":
                    r, RENDER = RENDER, None
                    if r.pending:
                        r.cancel()
                        return self.send_json({"error": "frames missing before %d" % min(r.pending)}, 400)
                    r.finish()
                    if r.master and r.keep_master and r.master_path:   # (a study master: kept as it is, no X file)
                        return self.send_json({"path": os.path.relpath(r.master_path, ROOT), "frames": r.n,
                                               "mb": round(os.path.getsize(r.master_path) / 1e6, 1)})
                    if r.master:   # the X file is made from the master in the background; the page polls status
                        x_encode_start(r)
                        return self.send_json({"state": "encoding", "frames": r.n, "path": os.path.relpath(r.path, ROOT)})
                    return self.send_json({"path": os.path.relpath(r.path, ROOT), "frames": r.n,
                                           "mb": round(os.path.getsize(r.path) / 1e6, 1)})
                if step == "cancel":
                    r, RENDER = RENDER, None
                    if r is not None:
                        r.cancel()
                    if RENDER_BROWSER is not None or XJOB.get("state") in ("starting", "encoding"):   # (STOP on a whole-song render)
                        x_stop()
                        close_render_browser()
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
        n = self.body_len(8_000_001)
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
                  "the Observatory, the Visualizer, the Loft, Mission Control, the radio, the edge of the universe, something lonely.")
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
            with PLAYS_LOCK:   # (the first read of plays.json must not race a listening report)
                try:
                    history = dict(plays())
                except OSError:   # locked right now: this list without counts; the next read tries again
                    history = {}
            since = None
            for name in names:
                stem, ext = os.path.splitext(name)
                if ext.lower() not in AUDIO_EXT:
                    continue
                if since is None:
                    since = listening_since()

                def find(*cands):
                    for c in cands:
                        hit = lower.get(c.lower())
                        if hit:
                            return "/music/" + urllib.parse.quote(hit)
                    return None

                own = find(stem + ".lrc", stem + ".srt")
                auto = None if own else auto_lyrics_url(stem)
                info = autolyrics.lrc_info(stem) if auto and autolyrics else None
                heard = history.get(stem, {})
                st = os.stat(os.path.join(MUSIC, name))   # (once per song, not three times)
                tracks.append({
                    "name": stem,
                    "url": "/music/" + urllib.parse.quote(name),
                    "v": "%d-%d" % (int(st.st_mtime), st.st_size),   # the file's own version: a remembered song map is only trusted for this exact file
                    "lyrics": own or auto,
                    "lyricsAuto": bool(auto),
                    "lyricsYours": bool(info and info["kind"] == "yours"),   # your words from the song file, timed by the loft
                    "voice": find(stem + ".voice.lrc", stem + ".voice.txt"),
                    "added": int(st.st_ctime),   # when the file arrived (Windows: its creation time)
                    "isNew": int(st.st_ctime) > since,   # arrived after the Loft's first listen
                    "listened": heard.get("seconds", 0), "plays": heard.get("plays", 0),
                    "skips": heard.get("skips", 0), "last": heard.get("last", 0),
                    "disliked": bool(heard.get("disliked")),
                })
        self.send_json({"tracks": tracks})

    def log_message(self, fmt, *args):
        # Only shout about failures; a quiet console is a readable console.
        if len(args) > 1 and str(args[1])[:1] in ("4", "5"):
            sys.stderr.write("[loft] %s\n" % (fmt % args))


# The moment listening in the Loft began (the earliest play on record), kept once in
# cache/listening-since.json so it never drifts. A song whose file arrived after it is new.
_SINCE = None
def listening_since():
    global _SINCE
    if _SINCE is None:
        path = os.path.join(ROOT, "cache", "listening-since.json")
        try:
            with open(path, encoding="utf-8") as f:
                _SINCE = int(json.load(f)["since"])
        except (OSError, ValueError, KeyError, TypeError):
            with PLAYS_LOCK:
                lasts = [int(v.get("last") or 0) for v in plays().values() if v.get("last")]
            _SINCE = min(lasts) if lasts else int(time.time())
            try:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump({"since": _SINCE}, f)
            except OSError as e:
                sys.stderr.write("[loft] listening-since not saved: %s\n" % e)
    return _SINCE


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


def already_open(port):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/now" % port, timeout=0.6) as r:
            return r.status == 200
    except OSError:
        return False


def open_window(url):
    """The Loft in its own app window: no tabs, no address bar, allowed to play the moment it opens
    (its own small browser profile, so those settings never touch your normal browsing)."""
    candidates = [os.path.join(os.environ.get(k, ""), *p) for k, p in (
        ("ProgramFiles", ("BraveSoftware", "Brave-Browser", "Application", "brave.exe")),
        ("LOCALAPPDATA", ("BraveSoftware", "Brave-Browser", "Application", "brave.exe")),
        ("ProgramFiles", ("Google", "Chrome", "Application", "chrome.exe")),
        ("ProgramFiles(x86)", ("Microsoft", "Edge", "Application", "msedge.exe")),
        ("ProgramFiles", ("Microsoft", "Edge", "Application", "msedge.exe")))]
    exe = next((c for c in candidates if os.path.isfile(c)), None)
    if not exe:
        return webbrowser.open(url)
    profile = os.path.join(os.environ.get("LOCALAPPDATA", ROOT), "TheLoft", "window")
    subprocess.Popen([exe, "--app=%s?auto%s" % (url, "&bg" if "--bg" in sys.argv else ""), "--user-data-dir=%s" % profile, "--autoplay-policy=no-user-gesture-required",
                      "--start-fullscreen", "--no-first-run", "--no-default-browser-check"],
                     creationflags=0x00000040 if "--bg" in sys.argv else 0)   # (background mode: idle priority, a game always wins the CPU)


def first_window(url):
    """The window of a fresh start. If it cannot be opened nothing would ever show, and the server would end by itself three
    minutes later: under the windowless starter that is said (SAY_FAILED) and the server ends now."""
    try:
        open_window(url)
    except Exception:
        import traceback
        why = traceback.format_exc()
        print("[loft] The window could not be opened.\n%s" % why, flush=True)
        if SAY_FAILED:
            SAY_FAILED("the window could not be opened\n" + why)
            os._exit(1)


NOT_THE_ROOM = ("ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS", "#32770")   # (a console and a message box)


def is_room(title, kind):
    """True for the room's own window, by its title and the kind of window it is. A console is never the room (the console
    starter and MAKE A DEMO.bat title theirs "The Visualizer" too, and a second click raised that black window in place of
    the room), and neither is a message box."""
    named = title in ("The Visualizer", "The Loft") or title.endswith((" · The Visualizer", " · The Loft"))   # (it was The Loft until 2026-10-11: a page from before the rename still counts)
    return named and kind not in NOT_THE_ROOM


def loft_windows():
    """The open Loft windows (Windows only), by their title."""
    if os.name != "nt":
        return []
    import ctypes
    from ctypes import wintypes
    user32, found = ctypes.windll.user32, []

    def each(hwnd, _):
        n = user32.GetWindowTextLengthW(hwnd)
        if n and user32.IsWindowVisible(hwnd):
            buf, kind = ctypes.create_unicode_buffer(n + 1), ctypes.create_unicode_buffer(80)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            user32.GetClassNameW(hwnd, kind, 80)
            if is_room(buf.value, kind.value):
                found.append(hwnd)
        return True
    user32.EnumWindows(ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(each), 0)
    return found


def raise_window():
    """Brings an open Loft window to the front (restoring it if minimized). True if there was one."""
    found = loft_windows()
    if not found:
        return False
    import ctypes
    ctypes.windll.user32.ShowWindow(found[0], 9)   # SW_RESTORE
    ctypes.windll.user32.SetForegroundWindow(found[0])
    return True


def toggle_window():
    """The Loft's window between full screen and a normal window (title bar, X, minimize), the way F11 does it. The
    desktop icon opens the window in the browser's own full screen, which a page is not allowed to leave, so the
    full screen button asks here and the key is pressed for it, only while a Loft window is the one in front."""
    if os.name != "nt":
        return False
    import ctypes
    user32 = ctypes.windll.user32
    if user32.GetForegroundWindow() not in loft_windows():
        return False
    user32.keybd_event(0x7A, 0, 0, 0)   # F11 down
    user32.keybd_event(0x7A, 0, 2, 0)   # F11 up
    return True


def quit_loft():
    """EXIT in the Esc menu: the same as the window's X (closes the window, then the server)."""
    import ctypes
    time.sleep(0.4)   # (let the music fade)
    for hwnd in loft_windows():
        ctypes.windll.user32.PostMessageW(hwnd, 0x0010, 0, 0)   # WM_CLOSE
    time.sleep(1)
    print("[loft] Exit from the menu: closing the Visualizer.")
    for lock in (PLAYS_LOCK, PERF_LOCK, ATLAS_LOCK):   # (let a save in progress finish first)
        lock.acquire(timeout=3)
    os._exit(0)


def ping_alive(port):
    try:
        urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:%d/api/alive" % port, data=b"{}", method="POST"), timeout=1).close()
    except OSError:
        pass


def main():
    global WORKER
    sys.stdout.reconfigure(line_buffering=True)   # progress lines show up immediately, even when piped
    os.makedirs(MUSIC, exist_ok=True)
    first = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else FIRST_PORT
    claimed = None
    if "--close-with-window" in sys.argv:
        # The desktop icon: exactly one Loft. Claiming the port is the lock (atomic, so two clicks at
        # once can't both win); whoever loses just keeps the running Loft alive and shows its window,
        # before loading anything heavy (no second voice or lyrics worker spinning up for nothing).
        try:
            claimed = Server(("127.0.0.1", first), Handler)
        except OSError:
            until = time.time() + HELD_WAIT   # (it may still be starting. By the clock: a port that takes the call and never answers costs 0.85 s a try, and 80 tries came to 68 s)
            while claimed is None and time.time() < until:
                if already_open(first):
                    ping_alive(first)   # (a Loft closing this second stays up for the new window)
                    if not raise_window():   # its window is open: bring it forward, never a second one
                        open_window("http://127.0.0.1:%d/" % first)
                    return
                time.sleep(0.25)
                try:   # (the Visualizer that held the port has just closed: this click starts a fresh one in its place)
                    claimed = Server(("127.0.0.1", first), Handler)
                except OSError:
                    pass
            if claimed is None:
                # (raised, not printed: the click would end with nothing on screen. The windowless starter turns it into its one message)
                raise RuntimeError("Port %d is held by something that isn't answering as the Visualizer." % first)
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
    # Already running (the .bat clicked twice): just bring up its window, never a second Loft.
    if not claimed and "--no-browser" not in sys.argv and already_open(first):
        print("[loft] The Visualizer is already running: opening its window.")
        open_window("http://127.0.0.1:%d/" % first)
        return
    port, server = (first, claimed) if claimed else open_server(first)
    url = "http://127.0.0.1:%d/" % port
    print("[loft] The Visualizer is open at %s" % url)
    print("[loft] Drop songs into: %s" % MUSIC)
    if not claimed:   # (the console starter; under the windowless one there is no such window, and closing the room's own window closes the server)
        print("[loft] Close this window to shut the loft.")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.6, lambda: first_window(url)).start()
    if "--close-with-window" in sys.argv:
        threading.Thread(target=watch_window, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[loft] Closed.")


if __name__ == "__main__":
    main()
