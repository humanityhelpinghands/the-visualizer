# The Visualizer

A 3D room for music. Press play and the room reads the song: the beat, the drops, the
builds, the screams, what the words feel like. A living core in the middle answers
every hit, the camera moves like someone is holding it, and the walls, floor and sky
follow the song from its first breath to its last.

It comes with **108 songs**, made with Suno by the person who built this room, each
with its lyrics already timed. Add your own next to them.

Built by vibe coding with Claude. The code is free: do whatever you want with it.

## Run it

1. Install **Python 3** (python.org) and a recent **Chrome, Edge or Brave** (it needs WebGL2).
2. Windows: double-click `START THE LOFT.bat`. Mac / Linux: `./start.sh`.
   It opens in your browser at `http://127.0.0.1:8030`.
3. Your own music: drop it in the `music` folder (`.mp3 .flac .wav .ogg .m4a .aac`).
   A matching `.lrc` file gives a song timed lyrics.

Everything runs on your own machine. Nothing is uploaded anywhere. On Windows the
launcher pulls the newest version of this repo each time it starts (when it was
cloned with git), so fixes reach you by themselves.

**Optional voice:** on first start the launcher tries to set up a local voice
(Kokoro) that announces songs, and Whisper, which times the lyrics of your own songs
and lets you hold **M** and talk to it ("play something lonely"). That download is a
few hundred MB, once. Without it the Visualizer still runs, and the songs that came
with it still show their lyrics.

## Keys

| Key | |
| --- | --- |
| Space | play / pause |
| ← → | seek (shift: 15 s) |
| ↑ ↓ | volume |
| N / P | next / previous |
| S | shuffle |
| L | search songs |
| T | lyrics on / off |
| C | cut the camera |
| H | hide everything |
| F | fullscreen (or double-click) |
| X / K | mark a chill / jump to a chill |
| 0 to 9 | jump through the song |
| M (hold) | talk to it |
| Esc | menu: graphics, a PC test, frame rate over time |
| ? | these keys |

## Make a video

The **For X** key draws the whole song as a 1080p video at 60 frames a second and
puts the MP4 in your Downloads folder, named after the song. **Fast** beside it makes
a 30 frames a second one about three times quicker. While you watch, the video only
draws in the room's spare time, so your own playback stays smooth. It needs
[ffmpeg](https://ffmpeg.org) on your PATH.

## Performance

Esc → Settings → **Test my PC** measures your card on the loudest part of a song and
chooses the sharpest setting that keeps it under half busy. If frames start slipping
(a game opened in the background), it steps down by itself, and back up once things
are smooth.

## Where things are

- `js/analysis.js`: reads a song (beats, sections, drops)
- `js/emotion.js`: what the words feel, and the colours of each feeling
- `js/visuals.js`, `js/scene/`: the room, the core, the camera, the light
- `js/render.js`, `js/xvideo.js`: the video maker
- `server.py`: a small local server (files, lyrics, voice, videos)
- `voice/`: the voice, and the lyric timing (Whisper, lined up against the words in each song file)
- `tools/blender/`: the scripts that rendered the textures in `assets/`

## The songs

The songs in `music/` are not under the code licence. Listen to them and share them
with credit; do not sell them.
