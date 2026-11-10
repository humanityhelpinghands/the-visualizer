# The Loft

A 3D room for your own music. Drop songs in, press play, and the room reads them:
the beat, the drops, the builds, the screams, what the words feel like. A living
singularity in the middle of it all answers every hit, the camera moves like
someone is holding it, and the walls, floor and sky follow the song from its first
breath to its last.

Built by vibe coding with Claude Opus 5.5. Free. Do whatever you want with it.

## Run it

1. Install **Python 3** (python.org) and a recent **Chrome or Edge** (it needs WebGL2).
2. Put your music in the `music` folder (`.mp3 .flac .wav .ogg .m4a .aac`). A
   matching `.lrc` file gives a song timed lyrics.
3. Windows: double-click `START THE LOFT.bat`. Mac / Linux: `./start.sh`.
   It opens in your browser at `http://127.0.0.1:8030`.

Everything runs on your own machine. Nothing is uploaded anywhere.

**Optional voice:** on first start the launcher tries to set up a local voice
(Kokoro) that announces songs, and Whisper, which transcribes lyrics for songs
without a `.lrc` and lets you hold **M** and talk to it ("play something lonely").
That download is a few hundred MB, once. Without it the Loft still runs.

## Keys

| Key | |
| --- | --- |
| Space | play / pause |
| ← → | seek (shift: 15 s) |
| N / P | next / previous |
| S | shuffle |
| L | search songs |
| T | lyrics on / off |
| C | cut the camera |
| H | hide everything |
| F | fullscreen |
| M (hold) | talk to it |
| Esc | menu: graphics, a PC test, frame rate over time |

## Performance

The demo was run on a Radeon RX 6600 XT, i5-12400F, 32 GB RAM, at 60 fps on the
highest quality with the card about a third busy. The Loft picks its own quality:
Esc → Settings → **Test my PC** measures your card on the loudest part of a song
and chooses the sharpest setting that keeps it under half busy. If frames start
slipping (a game or Blender opened in the background), it steps down by itself,
and back up once things are smooth.

## Where things are

- `js/analysis.js`: reads a song (beats, sections, drops)
- `js/emotion.js`: what the words feel, and the colours of each feeling
- `js/visuals.js`, `js/scene/`: the room, the core, the camera, the light
- `server.py`: a tiny local server (files, lyrics, voice)
- `tools/blender/`: the scripts that rendered the textures in `assets/`

Spotify, YouTube, your own player: not wired up. Someone will figure it out.
