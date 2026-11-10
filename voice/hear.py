"""Talk to Oasis: what you said, in words.

Push-to-talk audio from the browser (a few seconds of webm/opus or wav), heard by
the same Whisper the lyrics use (small.en on the CPU, its own copy so a song
being transcribed never makes you wait), primed with the house's own words (the
songs' names, the rooms, the commands) so a title comes back spelled the way the
shelf spells it. The model loads on first use, or early on a GET of /api/hear.
"""
import io
import threading

MODEL = "small.en"
_model = None
_lock = threading.Lock()
_state = {"state": "idle"}


def _load():
    global _model
    with _lock:
        if _model is None:
            _state["state"] = "loading"
            try:
                from faster_whisper import WhisperModel
                _model = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=4)   # 4: ~1.4 s a command (2: ~1.9 s), same words
                _state["state"] = "ready"
            except Exception as e:   # reported to the page, never hidden
                _state.update(state="error", error="%s: %s" % (type(e).__name__, e))
                raise
    return _model


def status():
    """Where the listener is, warming it up in the background on the first ask."""
    if _state["state"] == "idle":
        _state["state"] = "loading"
        threading.Thread(target=_warm, daemon=True).start()
    return dict(_state)


def _warm():
    try:
        _load()
    except Exception:
        pass   # the error is in _state for the page


def decode(data):
    """Any audio the browser sends (webm/opus, wav...) as 16 kHz mono floats.
    (faster-whisper's own decoder passes PyAV an option newer PyAV refuses.)"""
    import av
    import numpy as np
    out = []
    with av.open(io.BytesIO(data), mode="r") as box:
        res = av.AudioResampler(format="s16", layout="mono", rate=16000)
        for frame in box.decode(audio=0):
            out += [f.to_ndarray().reshape(-1) for f in res.resample(frame) or []]
        out += [f.to_ndarray().reshape(-1) for f in res.resample(None) or []]
    return (np.concatenate(out) if out else np.zeros(0, np.int16)).astype(np.float32) / 32768.0


def hear(data, prompt=None):
    audio = decode(data)
    model = _load()
    with _lock:   # one listener at a time
        segs, _ = model.transcribe(audio, language="en", beam_size=3, vad_filter=True, condition_on_previous_text=False,
                                   initial_prompt=prompt, without_timestamps=True)
        text = " ".join(s.text.strip() for s in segs).strip()
    return {"text": text, "seconds": round(len(audio) / 16000, 2)}
