"""The loft's voice: Kokoro-82M (timestamped ONNX export) on the CPU.

say(text) -> 24 kHz mono WAV bytes + when each word starts and ends, taken from
the model's own predicted phoneme durations, so captions can light each word
the instant it is spoken. The GPU stays free for the visuals.
"""
import io
import os
import re
import threading
import time
import wave
from collections import OrderedDict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, "kokoro-timestamped-fp32.onnx")   # fp32 runs ~3.5x faster than int8 on desktop CPUs
VOICES = os.path.join(HERE, "voices-v1.0.bin")
MODEL_URL = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/resolve/main/onnx/model.onnx"
VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
SR = 24000
UNITS_PER_SEC = 40.0          # one predicted duration unit = 600 samples at 24 kHz
LEAD_UNITS = 3                # sound starts ~3 units before the pad token ends (same fix as Kokoro's own timestamps)
DEFAULT_VOICE = "af_heart"

# Where espeak, reading one word at a time, says it the way no one does.
PRONOUNCE = {
    "a": "ɐ",                    # alone, espeak reads the article as the letter: "make AY wish"
    "copies": "kˈɑːpiz",         # not "cop-is"
    "copied": "kˈɑːpid",
}
_TAIL = re.compile(r"^(.*?)([.,!?:;…\"“”'’)\]-]*)\s*$", re.S)


def fix_word(word, ph):
    """Correct espeak's phonemes for one word (punctuation it kept stays on)."""
    core, punct = _TAIL.match(ph).groups()
    key = re.sub(r"[^a-z]", "", word.lower().replace("’", "'"))
    if key in PRONOUNCE:
        core = PRONOUNCE[key]
    elif key.endswith("ies") and core.endswith("ɪz"):
        core = core[:-2] + "iz"          # babies, copies: the y stays an "ee"
    elif key.endswith("ied") and core.endswith("ɪd"):
        core = core[:-2] + "id"
    return core + punct

# A short list worth auditioning in the loft; any Kokoro voice id (or a blend
# like "af_heart:0.7,af_nicole:0.3") works through the API.
CURATED = [
    ("af_heart", "Heart: warm, close (default)"),
    ("af_heart:0.65,af_nicole:0.35", "Night: Heart with a late-night hush"),
    ("af_bella", "Bella: bright"),
    ("af_nicole", "Nicole: whisper"),
    ("bf_emma", "Emma: British"),
    ("am_michael", "Michael: low male"),
    ("am_fenrir", "Fenrir: deep male"),
    ("bm_george", "George: British male"),
]


class KokoroVoice:
    def __init__(self, threads=6):
        import onnxruntime as ort
        from kokoro_onnx.tokenizer import Tokenizer
        import phonemizer

        so = ort.SessionOptions()
        so.intra_op_num_threads = threads      # leave cores for the browser
        so.inter_op_num_threads = 1
        self.sess = ort.InferenceSession(MODEL, so, providers=["CPUExecutionProvider"])
        self.voices = np.load(VOICES)
        self.tok = Tokenizer()
        self._phonemize = phonemizer.phonemize
        self.lock = threading.Lock()
        self.cache = OrderedDict()

    def voice_ids(self):
        return sorted(self.voices.files)

    def _style(self, voice, n_tokens):
        parts = []
        for chunk in voice.split(","):
            name, _, w = chunk.partition(":")
            name = name.strip()
            if name not in self.voices.files:
                raise ValueError("unknown voice: %s" % name)
            parts.append((name, float(w) if w else 1.0))
        total = sum(w for _, w in parts) or 1.0
        pack = sum(self.voices[name] * (w / total) for name, w in parts)
        return pack[min(n_tokens, len(pack) - 1)].astype(np.float32)

    def say(self, text, voice=DEFAULT_VOICE, speed=0.95):
        text = " ".join(text.split())
        if not text:
            raise ValueError("nothing to say")
        key = (text, voice, round(speed, 3))
        with self.lock:
            hit = self.cache.get(key)
            if hit:
                self.cache.move_to_end(key)
                return hit
            words = text.split(" ")
            # Phonemize word by word: we then know exactly which tokens are whose.
            phon = self._phonemize(words, "en-us", preserve_punctuation=True, with_stress=True)
            phon = [fix_word(w, p) for w, p in zip(words, phon)]
            vocab = self.tok.vocab
            space = vocab[" "]
            ids, spans = [0], []
            for k, p in enumerate(phon):
                toks = [vocab[c] for c in p.strip() if c in vocab]
                a = len(ids)
                ids.extend(toks)
                spans.append((a, len(ids)))
                if k + 1 < len(phon):
                    ids.append(space)
            ids.append(0)
            if len(ids) > 510:
                raise ValueError("line too long for one breath (%d phonemes)" % len(ids))
            style = self._style(voice, len(ids) - 2).reshape(1, 256)
            t0 = time.perf_counter()
            audio, dur = self.sess.run(None, {
                "input_ids": np.array([ids], dtype=np.int64),
                "style": style,
                "speed": np.array([speed], dtype=np.float32),
            })
            gen = time.perf_counter() - t0
            audio = audio.reshape(-1)
            dur = dur.reshape(-1)
            edges = np.maximum(0.0, np.concatenate([[0.0], np.cumsum(dur)]) - LEAD_UNITS) / UNITS_PER_SEC
            timed = []
            for w, (a, b) in zip(words, spans):
                if b > a:
                    timed.append({"w": w, "t": round(float(edges[a]), 3), "end": round(float(edges[b]), 3)})
                else:  # nothing pronounceable (e.g. a lone symbol): borrow the next start
                    timed.append({"w": w, "t": None, "end": None})
            for i, x in enumerate(timed):
                if x["t"] is None:
                    nxt = next((y["t"] for y in timed[i + 1:] if y["t"] is not None), float(edges[-1]))
                    x["t"] = x["end"] = nxt
            peak = float(np.max(np.abs(audio))) or 1.0
            pcm = (np.clip(audio / max(peak, 0.5) * 0.95, -1, 1) * 32767).astype("<i2")
            buf = io.BytesIO()
            with wave.open(buf, "wb") as wv:
                wv.setnchannels(1)
                wv.setsampwidth(2)
                wv.setframerate(SR)
                wv.writeframes(pcm.tobytes())
            out = {
                "wav": buf.getvalue(), "words": timed, "duration": len(audio) / SR,
                "modelDuration": float(edges[-1]), "genSeconds": gen, "voice": voice,
            }
            self.cache[key] = out
            if len(self.cache) > 96:
                self.cache.popitem(last=False)
            return out


_engine = None
_error = None
_ready = threading.Event()


def ensure_models():
    """First run on a new PC: download the model files (~350 MB, once)."""
    import urllib.request
    for path, url in ((MODEL, MODEL_URL), (VOICES, VOICES_URL)):
        if os.path.exists(path) and os.path.getsize(path) > 1_000_000:
            continue
        print("[loft] Downloading voice file %s (one time)..." % os.path.basename(path), flush=True)
        tmp = path + ".part"
        urllib.request.urlretrieve(url, tmp)
        os.replace(tmp, path)


def start_loading():
    """Load the model in the background so the first announcement is instant."""
    def load():
        global _engine, _error
        try:
            ensure_models()
            eng = KokoroVoice()
            eng.say("The loft is open.")      # warm-up compiles the graph
            _engine = eng
        except Exception as e:                  # reported to the browser, never hidden
            _error = "%s: %s" % (type(e).__name__, e)
        finally:
            _ready.set()
    threading.Thread(target=load, daemon=True).start()


def engine(timeout=30):
    _ready.wait(timeout)
    if _engine is None:
        raise RuntimeError(_error or "Kokoro is still loading")
    return _engine


def status():
    if not _ready.is_set():
        return {"state": "loading"}
    if _engine is None:
        return {"state": "error", "error": _error}
    return {"state": "ready"}
