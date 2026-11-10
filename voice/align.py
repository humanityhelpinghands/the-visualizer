"""Your words, the song's timing.

Suno writes the lyrics you gave it into every MP3 it makes (the ID3 "USLT"
frame, with [Verse]/[Chorus] markers), so the loft never has to guess what is
sung, only when. Whisper listens and guesses words with times; this lines its
guesses up against your text (a Needleman-Wunsch alignment with fuzzy,
sound-alike word matching), so "heiress" heard for "air asked" still lands on
the right words at the right moment. Then:

- a line Whisper missed is placed in the gap where it must have been sung,
- a chorus the song sang once more than written is recognised as your lines,
- an ad-lib it heard clearly ("hey, hey") is kept, marked as an ad-lib,
- (Spoken) / (Soft) / (Whispered) directions travel with their line, and
  (parenthesised) backing lines show only if they were actually sung.

    python voice/align.py "music/Song.mp3"     (prints the timed lyrics)
"""
import re
import zlib

# ── reading the lyrics out of the file ────────────────────────────────


def _syncsafe(b):
    return (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3]


def _unsync(b):
    return b.replace(b"\xff\x00", b"\xff")


def _decode(enc, raw):
    codec = {0: "latin-1", 1: "utf-16", 2: "utf-16-be"}.get(enc, "utf-8")
    return raw.decode(codec, "replace")


def _after_descriptor(enc, raw):
    """USLT text follows a null-terminated descriptor; skip it."""
    if enc in (1, 2):
        for i in range(0, len(raw) - 1, 2):
            if raw[i] == 0 and raw[i + 1] == 0:
                return raw[i + 2:]
        return b""
    i = raw.find(b"\x00")
    return b"" if i < 0 else raw[i + 1:]


# Nulls, zero-width and direction marks some exports leave in the text.
INVISIBLE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]")


def tag_lyrics(path):
    """The lyrics stored in an MP3's ID3v2 tag (USLT frame), or None."""
    try:
        with open(path, "rb") as f:
            head = f.read(10)
            if len(head) < 10 or head[:3] != b"ID3" or head[3] not in (3, 4):
                return None
            ver, flags = head[3], head[5]
            data = f.read(_syncsafe(head[6:10]))
    except OSError:
        return None
    if ver == 3 and flags & 0x80:
        data = _unsync(data)
    i = 0
    if flags & 0x40:                                   # extended header
        i = _syncsafe(data[0:4]) if ver == 4 else 4 + int.from_bytes(data[0:4], "big")
    best = None
    while i + 10 <= len(data):
        fid = data[i:i + 4]
        if not re.fullmatch(rb"[A-Z0-9]{4}", fid):
            break
        size = _syncsafe(data[i + 4:i + 8]) if ver == 4 else int.from_bytes(data[i + 4:i + 8], "big")
        fl = data[i + 9]
        body = data[i + 10:i + 10 + size]
        i += 10 + size
        if fid != b"USLT":
            continue
        try:
            if ver == 4:
                if fl & 0x04:                          # encrypted
                    continue
                if fl & 0x40:
                    body = body[1:]
                if fl & 0x01:
                    body = body[4:]
                if fl & 0x02:
                    body = _unsync(body)
                if fl & 0x08:
                    body = zlib.decompress(body)
            else:
                if fl & 0x40:
                    continue
                if fl & 0x80:
                    body = zlib.decompress(body[4:])
            enc = body[0]
            text = _decode(enc, _after_descriptor(enc, body[4:]))
        except (IndexError, zlib.error):
            continue
        text = INVISIBLE.sub("", text.replace("\r\n", "\n").replace("\r", "\n")).strip()
        if text and (best is None or len(text) > len(best)):
            best = text
    return best


# ── your text: lines, sections, directions ────────────────────────────

SECTION = re.compile(r"^(intro|verse|pre[- ]?chorus|post[- ]?chorus|chorus|hook|bridge|outro|interlude|break(down)?|"
                     r"drop|refrain|instrumental|solo|build(-?up)?|end|final|coda|tag|rap|choir|breakdown)\b", re.I)
HOW = [("spoken", re.compile(r"spoken|speak|talk|narrat|monolog", re.I)),
       ("whisper", re.compile(r"whisper", re.I)),
       ("soft", re.compile(r"\bsoft|quiet|gentle|hush|breath|tender|low voice|falsetto", re.I)),
       ("loud", re.compile(r"shout|scream|yell|belt|loud|powerful|anthem", re.I))]
# Parenthesised lines made of these are production notes, not singing.
CUE = re.compile(r"organ|guitar|piano|drum|beat|bass|synth|string|fade|instrument|music|hum|clap|silence|pause|"
                 r"riser|sfx|vinyl|crackle|ambient|pad|choir|orchestra|horn|brass|break|drop|swell|outro|intro|"
                 r"echo|reverb|vocal|harmon|beat|tempo|bpm|key|tone|build|rain|noise|static|tape", re.I)


def _how_of(s):
    for name, rx in HOW:
        if rx.search(s):
            return name
    return None


def parse_written(text):
    """Lines of your lyrics: {words, section, sec_i, how, optional}.
    words: [display word, ...]; inline (parentheses) words are backing vocals."""
    lines, section, sec_i, pending_how, sec_how = [], None, 0, None, None
    text = INVISIBLE.sub("", text)
    rows = []
    for raw in text.split("\n"):                       # "...dark booth[Final Chorus]": a tag mid-line starts a new line
        rows.extend(p for p in re.split(r"(\[[^\]]*\])", raw))
    for raw in rows:
        s = raw.strip()
        if not s or re.fullmatch(r"(?i)lyrics\s*:?", s):         # a "Lyrics:" heading pasted in with the words
            continue
        m = re.fullmatch(r"\[(.*)\]", s) or re.fullmatch(r"\((.*)\)", s)
        if m:
            inner = m.group(1).strip()
            if SECTION.match(inner):
                label = re.split(r"\s*(?::|\||,|\(|\s[-–]\s)\s*", inner, maxsplit=1)[0].strip()   # "Verse 1: soft" -> "Verse 1"
                section, sec_i = label.title(), sec_i + 1
                sec_how = _how_of(inner[len(label):]) if len(inner) > len(label) else None
                pending_how = None
                continue
            how = _how_of(inner)
            if s.startswith("[") or how or (len(inner.split()) <= 4 and CUE.search(inner)):
                if how:
                    pending_how = how
                continue
            # a sung parenthesised line: backing vocals, shown only if heard
            lines.append({"li": len(lines), "words": s.split(), "section": section, "sec_i": sec_i, "how": "backing", "optional": True})
            continue
        lines.append({"li": len(lines), "words": s.split(), "section": section, "sec_i": sec_i,
                      "how": pending_how or sec_how, "optional": False})
        pending_how = None
    return lines


# ── words: normalising and comparing ──────────────────────────────────

NUM = {"0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven",
       "8": "eight", "9": "nine", "10": "ten", "11": "eleven", "12": "twelve", "20": "twenty", "100": "hundred"}
EQUIV = {"til": "till", "until": "till", "cuz": "cause", "coz": "cause", "cos": "cause", "because": "cause",
         "gonna": "going", "wanna": "want", "gotta": "got", "okay": "ok", "yea": "yeah", "ya": "you", "em": "them",
         "tho": "though", "thru": "through", "alright": "allright", "ooh": "oh", "whoa": "woah", "mmm": "mm", "hmm": "mm"}
STOP = set("a an the and or but of to in on at for with is are was were be i you we it me my your our this that so "
           "im its do did not no oh yeah".split())


def tokens(word):
    w = word.lower().replace("’", "'").replace("‘", "'")
    w = re.sub(r"[^a-z0-9'\- ]", "", w)
    out = []
    for p in re.split(r"[-\s]+", w):
        p = p.replace("'", "")
        if p:
            out.append(NUM.get(p, p))
    return out


def _lev(a, b):
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _phon(w):
    """A rough sound-key: 'night'/'knight', 'flame'/'phlame', 'sea'/'see' agree."""
    w = re.sub(r"^kn|^wr|^wh", lambda m: m.group(0)[1], w)
    for a, b in (("ph", "f"), ("ck", "k"), ("gh", ""), ("q", "k"), ("x", "ks"), ("z", "s"), ("v", "f"), ("dg", "j")):
        w = w.replace(a, b)
    w = re.sub(r"c(?=[eiy])", "s", w).replace("c", "k")
    w = re.sub(r"d$", "t", w)
    if not w:
        return w
    w = w[0] + re.sub(r"[aeiouy]", "", w[1:])
    return re.sub(r"(.)\1+", r"\1", w)


_sim_cache = {}


def sim(a, b):
    key = (a, b)
    if key in _sim_cache:
        return _sim_cache[key]
    if a == b:
        s = 1.0
    elif EQUIV.get(a, a) == EQUIV.get(b, b):
        s = 0.95
    elif a + "g" == b or b + "g" == a or a + "s" == b or b + "s" == a:
        s = 0.9
    else:
        s = 1 - _lev(a, b) / max(len(a), len(b))
        pa, pb = _phon(a), _phon(b)
        if pa and pb:
            s = max(s, 0.85 * (1 - _lev(pa, pb) / max(len(pa), len(pb))))
        if min(len(a), len(b)) <= 2:
            s *= 0.7                                   # "a" vs "i": tiny words say little
    _sim_cache[key] = s
    return s


# ── the alignment ─────────────────────────────────────────────────────

RATE = 0.3          # seconds per word when a word's time has to be inferred
HOLD_GAP = 0.12     # breath between inferred lines


def _nw(A, B):
    """Global alignment of your tokens A to heard tokens B. Returns, for each
    A index, the matched B index or -1, plus the set of B indices used."""
    n, m = len(A), len(B)
    dA = [0.05 if a["optional"] else 0.45 for a in A]          # your word not heard
    iB = [0.25 + 0.3 * b["p"] for b in B]                      # heard word not in your text
    NEG = -1e18
    prev = [0.0] * (m + 1)
    for j in range(1, m + 1):
        prev[j] = prev[j - 1] - iB[j - 1]
    back = []
    for i in range(1, n + 1):
        a = A[i - 1]["tok"]
        cur = [prev[0] - dA[i - 1]] + [NEG] * m
        bt = bytearray(m + 1)
        bt[0] = 1
        for j in range(1, m + 1):
            d = prev[j - 1] + 2 * sim(a, B[j - 1]["tok"]) - 1
            u = prev[j] - dA[i - 1]
            l = cur[j - 1] - iB[j - 1]
            if d >= u and d >= l:
                cur[j], bt[j] = d, 0
            elif u >= l:
                cur[j], bt[j] = u, 1
            else:
                cur[j], bt[j] = l, 2
        back.append(bt)
        prev = cur
    match = [-1] * n
    i, j = n, m
    while i > 0 or j > 0:
        if i == 0:
            j -= 1
            continue
        if j == 0:
            i -= 1
            continue
        step = back[i - 1][j]
        if step == 0:
            match[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif step == 1:
            i -= 1
        else:
            j -= 1
    return match


def _local(line_toks, run):
    """Best placement of a whole written line inside a run of heard tokens.
    Returns (score per token, [run index or -1 per line token])."""
    n, m = len(line_toks), len(run)
    NEG = -1e18
    prev = [0.0] * (m + 1)                                      # free start anywhere in the run
    back = []
    for i in range(1, n + 1):
        cur = [prev[0] - 0.45] + [NEG] * m
        bt = bytearray(m + 1)
        bt[0] = 1
        for j in range(1, m + 1):
            d = prev[j - 1] + 2 * sim(line_toks[i - 1], run[j - 1]["tok"]) - 1
            u = prev[j] - 0.45
            l = cur[j - 1] - 0.4
            if d >= u and d >= l:
                cur[j], bt[j] = d, 0
            elif u >= l:
                cur[j], bt[j] = u, 1
            else:
                cur[j], bt[j] = l, 2
        back.append(bt)
        prev = cur
    j_end = max(range(m + 1), key=lambda j: prev[j])            # free end too
    score = prev[j_end]
    match = [-1] * n
    i, j = n, j_end
    while i > 0:
        step = back[i - 1][j] if j > 0 else 1
        if step == 0:
            match[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif step == 1:
            i -= 1
        else:
            j -= 1
    return score / max(1, n), match


def _heard_tokens(heard):
    """heard: [{w, start, end, p}] -> tokens, splitting 'half-bent' etc."""
    out = []
    for k, h in enumerate(heard):
        ts = tokens(h["w"])
        if not ts or h.get("p", 0.7) < 0.02:      # Whisper at zero confidence is inventing (often echoing its prompt)
            continue
        dur = max(0.02, h["end"] - h["start"]) / len(ts)
        for q, t in enumerate(ts):
            out.append({"tok": t, "start": h["start"] + q * dur, "end": h["start"] + (q + 1) * dur,
                        "p": h.get("p", 0.7), "w": h["w"], "k": k})
    return out


def coherent(anchors):
    """anchors: [(word index, start time, weight, ...)] in line order. A sung
    line hangs together: split wherever two heard words sit further apart in
    time than their distance in the line allows, keep the strongest piece."""
    if len(anchors) < 2:
        return anchors
    groups, cur = [], [anchors[0]]
    for prev, a in zip(anchors, anchors[1:]):
        if a[1] - prev[1] > 2.5 + 1.6 * max(1, a[0] - prev[0]) or a[1] < prev[1] - 0.5:
            groups.append(cur)
            cur = []
        cur.append(a)
    groups.append(cur)
    return max(groups, key=lambda g: sum(x[2] for x in g))


def _fill(times, bounds):
    """times: [(start, end) or None] per word of a line; fill the gaps by
    interpolating between known words, extrapolating at RATE at the edges.
    bounds: (earliest, latest) the line may occupy."""
    n = len(times)
    known = [i for i, t in enumerate(times) if t]
    lo, hi = bounds
    if not known:
        return None
    a = known[0]
    for i in range(a - 1, -1, -1):                              # before the first heard word
        t = max(lo, times[i + 1][0] - RATE)
        times[i] = (t, times[i + 1][0])
    b = known[-1]
    for i in range(b + 1, n):                                   # after the last
        t = min(hi, times[i - 1][1] + 0.02)
        times[i] = (t, min(hi, t + RATE))
    for x, y in zip(known, known[1:]):                          # between two heard words
        if y - x > 1:
            t0, t1 = times[x][1], times[y][0]
            if t1 < t0:
                t1 = t0
            step = (t1 - t0) / (y - x)
            for q, i in enumerate(range(x + 1, y), 1):
                s = t0 + (q - 0.5) * step
                times[i] = (s, s + max(0.05, step))
    # monotonic, never earlier than the previous word
    for i in range(1, n):
        if times[i][0] < times[i - 1][0] + 0.03:
            s = times[i - 1][0] + 0.03
            times[i] = (s, max(s + 0.03, times[i][1]))
    return times


def align(written, heard, junk=()):
    """written: parse_written() lines. heard: Whisper words [{w, start, end, p}].
    Returns timed lines: {words: [{w, t, end}], section, sec_i, how, src}
    where src is 'heard' (anchored), 'placed' (inferred) or 'adlib'."""
    A = []
    for li, L in enumerate(written):
        depth = 0
        for wi, w in enumerate(L["words"]):
            opened = w.count("(") > 0
            depth += w.count("(")
            backing = depth > 0 or L["optional"]
            for t in tokens(w):
                A.append({"tok": t, "li": li, "wi": wi, "optional": backing})
            depth = max(0, depth - w.count(")"))
            del opened
    B = _heard_tokens(heard)
    if not A or not B:
        return []
    match = _nw(A, B)

    # Per line: which words were heard, and how sure.
    out = [None] * len(written)
    used_B = set()
    for li, L in enumerate(written):
        idx = [q for q, a in enumerate(A) if a["li"] == li]
        nw = len(L["words"])
        times, weight, got = [None] * nw, 0.0, 0.0
        anchors = []
        for q in idx:
            a = A[q]
            w = 0.35 if a["tok"] in STOP else 1.0
            weight += w
            j = match[q]
            if j < 0:
                continue
            s = sim(a["tok"], B[j]["tok"])
            if s >= 0.5:
                anchors.append((a["wi"], B[j]["start"], w * s, q))
        keep_q = {x[3] for x in coherent(anchors)}
        for q in idx:
            j = match[q]
            if j < 0:
                continue
            if q not in keep_q:
                match[q] = -1                                   # a stray match far from the rest of its line
                continue
            a = A[q]
            got += (0.35 if a["tok"] in STOP else 1.0) * sim(a["tok"], B[j]["tok"])
            if times[a["wi"]] is None:
                times[a["wi"]] = (B[j]["start"], B[j]["end"])
            else:
                times[a["wi"]] = (times[a["wi"]][0], B[j]["end"])
            used_B.add(j)
        ratio = got / max(weight, 1e-6)
        if L["optional"]:
            keep = ratio >= 0.5
        else:
            keep = got >= 1.0 or ratio >= 0.4
        out[li] = {"times": times if keep else None, "ratio": ratio}

    # Also count weak matches as used, so they don't reappear as ad-libs.
    for q, j in enumerate(match):
        if j >= 0:
            used_B.add(j)

    # Fill in each heard line's other words; bound by its heard neighbours.
    starts = [None] * len(written)
    for li in range(len(written)):
        t = out[li]["times"]
        if t:
            ks = [x for x in t if x]
            starts[li] = (ks[0][0], ks[-1][1])
    result = []
    for li, L in enumerate(written):
        t = out[li]["times"]
        if not t:
            continue
        prev_end = max([starts[k][1] for k in range(li) if starts[k]] or [0.0])
        nxt = [starts[k][0] for k in range(li + 1, len(written)) if starts[k]]
        hi = nxt[0] - 0.05 if nxt else 1e9
        filled = _fill(list(t), (prev_end + 0.02, hi))
        if filled:
            result.append(_line(L, filled, "heard"))
            starts[li] = (filled[0][0], filled[-1][1])

    # Lines nobody heard: place them in the gap where they must have been sung.
    li = 0
    while li < len(written):
        if out[li]["times"] or written[li]["optional"]:
            li += 1
            continue
        run = [li]
        while run[-1] + 1 < len(written) and not out[run[-1] + 1]["times"]:
            run.append(run[-1] + 1)
        li = run[-1] + 1
        run = [r for r in run if not written[r]["optional"]]
        if not run:
            continue
        P = max((k for k in range(run[0]) if starts[k]), default=None)
        Q = min((k for k in range(run[-1] + 1, len(written)) if starts[k]), default=None)
        if P is None or Q is None:
            continue                                            # before the first or after the last heard line: unknowable
        g0, g1 = starts[P][1] + HOLD_GAP, starts[Q][0] - HOLD_GAP
        need = sum(len(written[r]["words"]) * RATE + HOLD_GAP for r in run)
        gap = g1 - g0
        same_p = written[run[0]]["sec_i"] == written[P]["sec_i"]
        same_q = written[run[-1]]["sec_i"] == written[Q]["sec_i"]
        if gap < need * 0.6 or (gap > need * 3 + 4 and not (same_p or same_q)):
            continue                                            # no room (not sung), or a long silence we can't place within
        rate = RATE * min(1.6, max(0.6, gap / need)) if gap < need * 1.6 else RATE
        if same_p or not same_q:
            t = g0
        else:
            t = g1 - sum(len(written[r]["words"]) * rate + HOLD_GAP for r in run)
        for r in run:
            times = []
            for _ in written[r]["words"]:
                times.append((t, t + rate))
                t += rate
            result.append(_line(written[r], times, "placed"))
            t += HOLD_GAP

    # Heard runs that matched nothing: an extra repeat of one of your lines,
    # or an ad-lib.
    taken = sorted((l["words"][0]["t"], l["end"]) for l in result)
    def busy(s, e):
        return any(s < b - 0.1 and e > a + 0.1 for a, b in taken)
    uniq = {}
    for L in written:
        key = " ".join(tokens(" ".join(L["words"])))
        if key and key not in uniq:
            uniq[key] = L
    runs, cur = [], []
    for j, b in enumerate(B):
        if j in used_B:
            if cur:
                runs.append(cur)
            cur = []
        else:
            cur.append(b)
    if cur:
        runs.append(cur)
    for run in runs:
        _rescue(run, uniq, result, busy, junk)

    result.sort(key=lambda l: l["words"][0]["t"])
    return result


def _rescue(run, uniq, result, busy, junk):
    if not run or busy(run[0]["start"], run[-1]["end"]):
        return
    best = (0.0, None, None)
    if len(run) >= 2:
        for key, L in uniq.items():
            toks = key.split()
            if len(toks) < 2 or len(toks) > len(run) + 2:
                continue
            score, m = _local(toks, run)
            if score > best[0]:
                best = (score, L, m)
    score, L, m = best
    if L is not None and score >= 0.45:
        anchors = [(q, run[j]["start"], 1.0, j) for q, j in enumerate(m) if j >= 0]
        kept = {x[3] for x in coherent(anchors)}
        m = [j if j in kept else -1 for j in m]
        hit = [j for j in m if j >= 0]
        a, b = min(hit), max(hit)
        # map tokens back to the line's words
        times = [None] * len(L["words"])
        q = 0
        for wi, w in enumerate(L["words"]):
            for _ in tokens(w):
                j = m[q]
                q += 1
                if j >= 0 and times[wi] is None:
                    times[wi] = (run[j]["start"], run[j]["end"])
        filled = _fill(times, (run[a]["start"] - 1.0, run[b]["end"] + 1.0))
        if filled:
            result.append(_line(L, filled, "heard"))
        _rescue(run[:a], uniq, result, busy, junk)
        _rescue(run[b + 1:], uniq, result, busy, junk)
        return
    # An ad-lib, if Whisper was sure of it.
    words = []
    for b in run:
        if not words or words[-1]["k"] != b["k"]:
            words.append(dict(b))
    text = " ".join(w["w"].strip() for w in words).strip()
    mean_p = sum(w["p"] for w in words) / len(words)
    toks = [t for w in words for t in tokens(w["w"])]
    # Only real ad-libs ("hey, hey", "oh-oh", "yeah"): whatever else Whisper
    # heard between your lines is usually it inventing words over the music.
    if (text.lower() in junk or mean_p < 0.6 or not toks or any(t not in ADLIBS for t in toks)
            or (len(words) == 1 and mean_p < 0.8)):
        return
    L = {"words": [w["w"].strip() for w in words], "section": None, "sec_i": -1, "how": "adlib"}
    result.append(_line(L, [(w["start"], w["end"]) for w in words], "adlib"))


ADLIBS = set("hey hei ay ayy yeah yea yeh oh ooh oo woo whoa woah uh huh ah aah la na da mm mmm hmm ha haha go come on "
              "lets alright ok okay yo baby yes no wait now again".split())


def _line(L, times, src):
    words = [{"w": w, "t": round(t[0], 2), "end": round(t[1], 2)} for w, t in zip(L["words"], times)]
    return {"li": L.get("li"), "words": words, "end": words[-1]["end"], "section": L["section"], "sec_i": L["sec_i"],
            "how": L["how"], "src": src}


# ── writing ───────────────────────────────────────────────────────────

def stamp(t):
    t = max(0.0, t)
    return "%02d:%05.2f" % (int(t // 60), t % 60)


def holes(written, lines, duration):
    """Stretches of the song where some of your lines weren't heard:
    [(t0, t1, [written lines])], between the heard lines around them."""
    at = {l["li"]: (l["words"][0]["t"], l["end"]) for l in lines if l["src"] == "heard" and l["li"] is not None}
    out, run = [], []
    def close(nxt):
        if not run:
            return
        prev = [at[k][1] for k in range(run[0]["li"]) if k in at]
        t0 = prev[-1] if prev else 0.0
        t1 = at[nxt][0] if nxt is not None else duration
        if t1 - t0 >= 1.5:
            out.append((t0, t1, list(run)))
        run.clear()
    for L in written:
        if L["optional"]:
            continue
        if L["li"] in at:
            close(L["li"])
        else:
            run.append(L)
    close(None)
    return out


def to_lrc(lines, header):
    out = list(header)
    sec_i, section = None, None
    for l in lines:
        if l["how"] != "adlib" and l["sec_i"] != sec_i and l["section"]:
            out.append("[sec:%s]" % l["section"])
            sec_i, section = l["sec_i"], l["section"]
        if l["how"]:
            out.append("[how:%s]" % l["how"])
        ws = l["words"]
        out.append("[%s]" % stamp(ws[0]["t"]) + " ".join("<%s>%s" % (stamp(w["t"]), w["w"]) for w in ws)
                   + "<%s>" % stamp(l["end"]))
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    import sys
    for p in sys.argv[1:]:
        text = tag_lyrics(p)
        print("=== %s: %s" % (p, "no lyrics in the file" if not text else "%d lines written" % len(parse_written(text))))
        for L in parse_written(text or ""):
            print("  %-12s %-8s %s" % (L["section"], L["how"] or "", " ".join(L["words"])))
