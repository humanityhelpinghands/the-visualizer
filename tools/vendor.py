"""Copies the loft's web dependencies into vendor/ so it runs with no internet.

  python tools/vendor.py

three.js: starts from the modules the loft imports and follows their imports.
Fonts (latin): Unbounded, Space Grotesk, Cormorant Garamond italic, Anton, Space Mono,
from Google Fonts, rewritten to local files. Each mood speaks in one of them.
"""
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(ROOT, "vendor")
THREE = "https://cdn.jsdelivr.net/npm/three@0.170.0/"
ENTRY = [
    "build/three.module.js",
    "examples/jsm/misc/GPUComputationRenderer.js",
    "examples/jsm/postprocessing/EffectComposer.js",
    "examples/jsm/postprocessing/RenderPass.js",
    "examples/jsm/postprocessing/UnrealBloomPass.js",
    "examples/jsm/postprocessing/ShaderPass.js",
    "examples/jsm/postprocessing/OutputPass.js",
]
FONTS = ("https://fonts.googleapis.com/css2?family=Unbounded:wght@400;600;800&family=Space+Grotesk:wght@300;400;500;600;700"
         "&family=Cormorant+Garamond:ital,wght@1,500;1,600;1,700&family=Anton&family=Space+Mono:wght@400;700&display=swap")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def save(rel, data):
    path = os.path.join(VENDOR, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def vendor_three():
    seen, todo = set(), list(ENTRY)
    while todo:
        rel = todo.pop()
        if rel in seen:
            continue
        seen.add(rel)
        src = get(THREE + rel)
        save("three/" + rel, src)
        for spec in re.findall(rb"""(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]""", src):
            spec = spec.decode()
            if spec.startswith("."):
                todo.append(os.path.normpath(os.path.join(os.path.dirname(rel), spec)).replace("\\", "/"))
    return sorted(seen)


def vendor_fonts():
    css = get(FONTS).decode()
    blocks = re.findall(r"/\* ([\w-]+) \*/\s*(@font-face \{.*?\})", css, re.S)
    keep = []
    for subset, block in blocks:
        if subset not in ("latin", "latin-ext"):
            continue
        url = re.search(r"url\((https://[^)]+)\)", block).group(1)
        name = url.rsplit("/", 1)[-1]
        save("fonts/" + name, get(url))
        keep.append("/* %s */\n%s" % (subset, block.replace(url, name)))
    save("fonts/fonts.css", "\n".join(keep).encode())
    return len(keep)


if __name__ == "__main__":
    files = vendor_three()
    print("three.js: %d files" % len(files))
    print("fonts: %d faces" % vendor_fonts())
