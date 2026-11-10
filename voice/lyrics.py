"""Lyrics for every song, timed to the word, cached in cache/lyrics/.

Songs from Suno carry the lyrics you wrote inside the MP3 (see align.py). For
those, Whisper (faster-whisper small.en, int8 on the CPU) only listens for
WHEN each word is sung: it's primed with your opening lines, and its guesses
are aligned to your exact text. Wherever some of your lines still weren't
heard, it listens to just that stretch again, primed with exactly the lines
that should be there. Songs without written lyrics fall back to plain
transcription. A real .lrc next to the song always wins.

Files per song:  <stem>.lrc         what the loft shows
                 <stem>.heard.json  what Whisper heard (re-aligning is instant)

Runs as a gentle background worker inside the server (3 threads, one song at a
time, whatever's playing first), or by hand:  python voice/lyrics.py "music/Song.mp3"
"""
import json
import os
import re
import sys
import threading
import time
from collections import deque

import numpy as np

import align

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MUSIC = os.path.join(ROOT, "music")
CACHE = os.path.join(ROOT, "cache", "lyrics")
AUDIO_EXT = {".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".opus", ".webm"}
MODEL = "small.en"
ALIGN_VERSION = 4          # bump when align.py improves: every song re-aligns from its .heard.json at startup
LISTEN_VERSION = 2         # 2: missed stretches re-heard with the lines that belong there
LISTENED = "whisper %s, primed with your lyrics" % MODEL
# Whisper's favourite inventions over instrumentals.
JUNK = {"thank you.", "thanks for watching!", "thank you for watching.", "you", "♪", "music", "[music]", "(music)"}


def stamp(t):
    return "%02d:%05.2f" % (int(t // 60), t % 60)


def load_mono16k(path):
    # faster-whisper's own decoder (PyAV, installed with it): every audio format the
    # loft plays, mono at 16 kHz. (soundfile was never in requirements.txt, so new
    # songs failed to transcribe on a launcher-built setup.)
    from faster_whisper import decode_audio
    return decode_audio(path, sampling_rate=16000).astype(np.float32)


FIRST_PERSON = {"I", "I'm", "I've", "I'll", "I'd"}


def split_line(words, max_words=8):
    """Break long Whisper segments where a sung line really ends: Whisper
    capitalises the start of each lyric line, punctuation marks phrase ends,
    and singers breathe in the gaps. Lean toward balanced halves."""
    n = len(words)
    if n <= max_words:
        return [words]
    best, cut = -1e9, n // 2 - 1
    for i in range(1, n - 2):             # split after words[i]; both sides keep 2+ words
        w, nxt = words[i][2], words[i + 1][2]
        s = 2.0 * (words[i + 1][0] - words[i][1])
        if w[-1:] in ",.;:!?":
            s += 0.8
        if nxt[:1].isupper() and nxt not in FIRST_PERSON:
            s += 0.6
        s -= 0.6 * abs((i + 1) - n / 2) / n
        if s > best:
            best, cut = s, i
    return split_line(words[:cut + 1], max_words) + split_line(words[cut + 1:], max_words)


def opening(written, n_words=90):
    """Your first lines, as Whisper's context for what it's about to hear."""
    out, n = [], 0
    for L in written:
        if n > n_words:
            break
        if not L["optional"]:
            out.append(" ".join(L["words"]))
            n += len(L["words"])
    return "\n".join(out)


class Transcriber:
    def __init__(self, threads=3):
        from faster_whisper import WhisperModel
        self.model = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=threads)

    def words(self, audio, prompt=None, offset=0.0):
        """Every word Whisper hears, with its time and confidence. Nothing is
        filtered: the aligner decides what to trust. Priming with your opening
        lines keeps it from losing the first verse; each later window is heard
        fresh (carrying context forward made it loop on some songs)."""
        segs, _ = self.model.transcribe(
            audio, language="en", word_timestamps=True, condition_on_previous_text=False,
            initial_prompt=prompt, vad_filter=False, beam_size=5)
        out = []
        for s in segs:
            for w in s.words or []:
                if w.word.strip():
                    out.append({"w": w.word.strip(), "start": round(w.start + offset, 2), "end": round(w.end + offset, 2),
                                "p": round(w.probability, 3)})
        return out

    def fill_holes(self, audio, written, heard):
        """Listen again where your lines weren't heard: each missed stretch,
        in pieces of up to 25 s, primed with exactly the lines that belong
        there. Keeps the new words only if more of your lines are heard."""
        sr, dur = 16000, len(audio) / 16000
        before = align.align(written, heard, junk=JUNK)
        score = sum(1 for l in before if l["src"] == "heard")
        merged = list(heard)
        for t0, t1, run in align.holes(written, before, dur):
            prompt = "\n".join(" ".join(L["words"]) for L in run)
            fresh, a = [], t0
            while a < t1 - 0.5:
                b = min(t1, a + 25.0)
                lo, hi = max(0.0, a - 0.4), min(dur, b + 0.4)
                got = self.words(audio[int(lo * sr):int(hi * sr)], prompt=prompt, offset=lo)
                fresh += [w for w in got if a <= w["start"] < b]
                a = b
            trial = sorted([w for w in merged if not (t0 < w["start"] < t1)] + fresh, key=lambda w: w["start"])
            after = align.align(written, trial, junk=JUNK)
            got = sum(1 for l in after if l["src"] == "heard")
            if got > score:
                merged, score = trial, got
        return merged

    def lrc(self, path):
        """Plain transcription, for songs with no lyrics in the file."""
        segs, _ = self.model.transcribe(
            load_mono16k(path), language="en", word_timestamps=True, condition_on_previous_text=False,
            vad_filter=False, beam_size=5, no_speech_threshold=0.5)
        out = ["[by:loft auto-lyrics, whisper %s]" % MODEL, "[loft:%d heard]" % ALIGN_VERSION]
        for s in segs:
            text = s.text.strip()
            if not text or text.lower() in JUNK:
                continue
            if s.avg_logprob < -1.0 or s.compression_ratio > 2.4:
                continue                      # garbled or looping: skip rather than show nonsense
            if s.no_speech_prob > 0.8 and s.avg_logprob < -0.5:
                continue
            words = [(w.start, w.end, w.word.strip()) for w in (s.words or []) if w.word.strip()]
            if not words:
                continue
            for line in split_line(words):
                out.append("[%s]" % stamp(line[0][0]) + " ".join("<%s>%s" % (stamp(a), w) for a, _, w in line))
        return "\n".join(out) + "\n"


def stem_of(name):
    return os.path.splitext(name)[0]


def has_own_lyrics(stem):
    return any(os.path.exists(os.path.join(MUSIC, stem + ext)) for ext in (".lrc", ".srt"))


def cache_path(stem):
    return os.path.join(CACHE, stem + ".lrc")


def heard_path(stem):
    return os.path.join(CACHE, stem + ".heard.json")


def lrc_info(stem):
    """What a cached .lrc is: {"version": n, "kind": "yours"|"heard", "full": bool} or None."""
    try:
        with open(cache_path(stem), encoding="utf-8") as f:
            head = f.read(400)
    except OSError:
        return None
    m = re.search(r"\[loft:(\d+) (\w+)(?: (\w+))?\]", head)
    if not m:
        return {"version": 1, "kind": "heard", "full": True}
    return {"version": int(m.group(1)), "kind": m.group(2), "full": m.group(3) != "quick"}


def words_from_lrc(path):
    """Word times out of an older auto-lyrics .lrc (before .heard.json existed)."""
    words = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            for m in re.finditer(r"<(\d+):(\d+(?:\.\d+)?)>([^<]*)", line):
                w = m.group(3).strip()
                if w:
                    t = int(m.group(1)) * 60 + float(m.group(2))
                    words.append({"w": w, "start": t, "end": t + 0.3, "p": 0.7})
    for a, b in zip(words, words[1:]):
        a["end"] = round(min(a["start"] + 1.2, max(a["start"] + 0.05, b["start"])), 2)
    return words


def write_atomic(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def load_heard(stem):
    try:
        with open(heard_path(stem), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def yours_lrc(title, written, heard, source, full):
    lines = align.align(written, heard, junk=JUNK)
    header = ["[ti:%s]" % title, "[by:loft lyrics: your words from the song file, timed by %s]" % source,
              "[loft:%d yours%s]" % (ALIGN_VERSION, "" if full else " quick")]
    return align.to_lrc(lines, header), lines


class Worker:
    """One song at a time, gently. want() moves a song to the front of the line."""

    def __init__(self, threads=3):
        self.threads = threads
        self.state = "starting"
        self.error = None
        self.working = None
        self.failed = {}
        self.front = deque()
        self.wake = threading.Event()
        self.lock = threading.Lock()
        self.written = {}            # stem -> parsed lyrics from the file (or None), by file mtime
        threading.Thread(target=self._run, daemon=True).start()

    def songs(self):
        if not os.path.isdir(MUSIC):
            return []
        return [stem_of(n) for n in sorted(os.listdir(MUSIC), key=str.lower) if os.path.splitext(n)[1].lower() in AUDIO_EXT]

    def audio_path(self, stem):
        for n in os.listdir(MUSIC):
            if stem_of(n) == stem and os.path.splitext(n)[1].lower() in AUDIO_EXT:
                return os.path.join(MUSIC, n)
        return None

    def written_of(self, stem):
        path = self.audio_path(stem)
        if not path:
            return None
        key = os.path.getmtime(path)
        hit = self.written.get(stem)
        if hit is None or hit[0] != key:
            text = align.tag_lyrics(path)
            parsed = align.parse_written(text) if text else None
            hit = (key, parsed if parsed else None)
            self.written[stem] = hit
        return hit[1]

    def status_of(self, stem):
        if has_own_lyrics(stem):
            return "own"
        info = lrc_info(stem)
        if info and info["full"] and info["version"] >= ALIGN_VERSION:
            if info["kind"] != "yours":
                return "done"
            h = load_heard(stem)
            if h and h.get("listen", 1) >= LISTEN_VERSION:
                return "done"
        if info and info["kind"] == "heard" and info["version"] < ALIGN_VERSION and not self.written_of(stem):
            return "done"                     # plain transcription of a song with no written lyrics: nothing to improve
        if stem in self.failed:
            return "error"
        if stem == self.working:
            return "working"
        return "queued" if self.state == "ready" else self.state

    def want(self, stem):
        with self.lock:
            if stem in self.front:
                self.front.remove(stem)
            self.front.appendleft(stem)
        self.wake.set()

    def summary(self):
        songs = self.songs()
        done = sum(1 for s in songs if self.status_of(s) in ("own", "done"))
        return {"state": self.state, "error": self.error, "done": done, "total": len(songs), "working": self.working}

    def _next(self):
        with self.lock:
            while self.front:
                s = self.front.popleft()
                if self.status_of(s) in ("queued",):
                    return s
        for s in self.songs():
            if self.status_of(s) == "queued":
                return s
        return None

    def quick_pass(self):
        """Before any listening: every song with written lyrics gets your exact
        words right away, aligned to whatever Whisper already heard (an older
        transcript or .heard.json). The full re-listen follows in the background."""
        n = 0
        for stem in self.songs():
            if has_own_lyrics(stem):
                continue
            info = lrc_info(stem)
            if info and info["version"] >= ALIGN_VERSION:
                continue
            written = self.written_of(stem)
            if not written:
                continue
            try:
                heard, source, full = None, None, False
                if os.path.exists(heard_path(stem)):
                    with open(heard_path(stem), encoding="utf-8") as f:
                        h = json.load(f)
                    heard, source, full = h["words"], h["source"], h.get("full", False)
                elif info:                    # an older transcript: keep what it heard before replacing it
                    heard, source = words_from_lrc(cache_path(stem)), "an earlier listen"
                    write_atomic(heard_path(stem), json.dumps({"source": source, "full": False, "words": heard}))
                if not heard:
                    continue
                text, _ = yours_lrc(stem, written, heard, source, full)
                write_atomic(cache_path(stem), text)
                n += 1
            except Exception as e:            # one bad file never stops the rest; reported
                print("[loft] lyrics: quick alignment failed for %s: %s: %s" % (stem, type(e).__name__, e), file=sys.stderr)
        if n:
            print("[loft] lyrics: %d songs now show your own words (fine timing follows in the background)" % n)

    def process(self, stem):
        path = self.audio_path(stem)
        written = self.written_of(stem)
        if written:
            audio = load_mono16k(path)
            h = load_heard(stem)
            if not h or not h.get("full"):
                h = {"source": LISTENED, "full": True, "listen": 1, "words": self.t.words(audio, prompt=opening(written))}
            if h.get("listen", 1) < LISTEN_VERSION:
                h["words"] = self.t.fill_holes(audio, written, h["words"])
                h["listen"] = LISTEN_VERSION
            write_atomic(heard_path(stem), json.dumps(h))
            heard = h["words"]
            text, lines = yours_lrc(stem, written, heard, LISTENED, True)
            sung = sum(1 for L in written if not L["optional"])
            got = sum(1 for l in lines if l["src"] == "heard")
            note = "%d of %d lines heard" % (min(got, sung), sung)
        else:
            text = self.t.lrc(path)
            note = "transcribed"
        write_atomic(cache_path(stem), text)
        return note

    def _run(self):
        os.makedirs(CACHE, exist_ok=True)
        try:
            self.quick_pass()
        except Exception as e:
            print("[loft] lyrics: quick pass failed: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        try:
            self.t = Transcriber(self.threads)
            self.state = "ready"
        except Exception as e:  # missing package or model: reported, never hidden
            self.state = "error"
            self.error = "%s: %s" % (type(e).__name__, e)
            print("[loft] auto-lyrics unavailable: %s" % self.error, file=sys.stderr)
            return
        while True:
            try:
                stem = self._next()
                if stem and not self.audio_path(stem):
                    continue
            except Exception as e:   # one bad name must never stop the worker for the whole session
                print("[loft] lyrics: skipped a request: %s: %s" % (type(e).__name__, e), file=sys.stderr)
                self.wake.wait(15)           # and never spin: wait before looking again
                self.wake.clear()
                continue
            if not stem:
                self.wake.wait(15)
                self.wake.clear()
                continue
            self.working = stem
            t0 = time.perf_counter()
            try:
                note = self.process(stem)
                print("[loft] lyrics ready: %s (%s, %.0fs)" % (stem, note, time.perf_counter() - t0))
            except Exception as e:
                self.failed[stem] = "%s: %s" % (type(e).__name__, e)
                print("[loft] lyrics failed for %s: %s" % (stem, self.failed[stem]), file=sys.stderr)
            finally:
                self.working = None
            time.sleep(1.5)                  # breathe between songs: keep the CPU cool


if __name__ == "__main__":
    w = Worker.__new__(Worker)
    w.written = {}
    w.t = Transcriber(threads=6)
    os.makedirs(CACHE, exist_ok=True)
    for p in sys.argv[1:]:
        t0 = time.perf_counter()
        note = w.process(stem_of(os.path.basename(p)))
        print("%s: %s in %.0fs" % (p, note, time.perf_counter() - t0))
