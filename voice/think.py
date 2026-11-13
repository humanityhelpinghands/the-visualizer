"""Oasis's second opinion: when she doesn't understand what was said, Claude (through your own
Claude Code) works out what you meant, as one of the actions she already knows. Every answer is
remembered by phrase (cache/oasis-learned.json), so the next time it's instant and free."""
import glob
import json
import os
import re
import subprocess
import threading



def claude_exe():
    """The newest Claude Code engine the desktop app has (the one on PATH can be old), else PATH's."""
    found = sorted(glob.glob(os.path.join(os.environ.get("APPDATA", ""), "Claude", "claude-code", "*", "*", "claude.exe")), key=os.path.getmtime)
    return found[-1] if found else "claude"

LOCK = threading.Lock()
ACTS = """{"act":"song","query":"<exact song title from the list>"}   play a song
{"act":"feel","feeling":"<one of: love desire anger sadness loneliness fear joy hope nostalgia defiance calm mystery>"}   a song for a feeling
{"act":"least"} / {"act":"most"}   the least / most played song
{"act":"surprise"}   any song
{"act":"next"} {"act":"prev"} {"act":"pause"} {"act":"resume"} {"act":"shuffle"} {"act":"what"}   playback; what = name the song playing
{"act":"volume","dv":0.15} / {"act":"volume","dv":-0.15}   louder / softer
{"act":"drop"}   jump to the next drop
{"act":"lyrics","on":true|false}
{"act":"space","space":"atlas"|"signal"|"lab"|null}   open a space in the Loft (null = back to the Loft)
{"act":"say","line":"<one short spoken sentence>"}   anything else: answer in Oasis's voice (dry, self-aware, a little doomed, warm; under 25 words)"""

PROMPT = """You are the understanding behind Oasis, the voice of the Visualizer (a 3D music room for the listener's own songs). Speech-to-text heard the listener say:

"{said}"

(It may be misheard: guess what was meant.) The songs: {songs}

Answer with JSON only: one action from this list, exactly in its shape.
{acts}"""


class Think:
    def __init__(self, root):
        self.path = os.path.join(root, "cache", "oasis-learned.json")

    def learned(self):
        with LOCK:
            try:
                with open(self.path, encoding="utf-8") as f:
                    return json.load(f)
            except (OSError, ValueError):
                return {}

    def ask(self, said, songs):
        key = re.sub(r"[^a-z0-9' ]+", " ", said.lower()).strip()
        key = re.sub(r"\s+", " ", key)
        prompt = PROMPT.format(said=said.strip()[:300], songs="; ".join(songs)[:4000], acts=ACTS)
        try:
            r = subprocess.run([claude_exe(), "-p", "--model", "claude-sonnet-5-5", "--output-format", "text"], input=prompt,
                               capture_output=True, text=True, encoding="utf-8", timeout=60, creationflags=0x08000000 if os.name == "nt" else 0)
        except (OSError, subprocess.SubprocessError) as e:
            return {"error": str(e)}
        m = re.search(r"\{.*\}", r.stdout or "", re.S)
        try:
            cmd = json.loads(m.group(0)) if m else None
        except ValueError:
            cmd = None
        if not isinstance(cmd, dict) or not cmd.get("act"):
            return {"error": ((r.stderr or r.stdout or "no answer").strip()[:200])}
        if cmd["act"] != "say" and key:   # (a spoken one-off isn't worth remembering; an action is)
            with LOCK:
                try:
                    with open(self.path, encoding="utf-8") as f:
                        known = json.load(f)
                except (OSError, ValueError):
                    known = {}
                known[key] = cmd
                os.makedirs(os.path.dirname(self.path), exist_ok=True)
                tmp = self.path + ".tmp"   # (swapped in whole: a crash mid-write never loses what she learned)
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(known, f, ensure_ascii=False, indent=1)
                os.replace(tmp, self.path)
        return {"cmd": cmd}
