// (/doing), never what file or command. 33 lines, picked so the same one never comes twice in a row.
export const MURMURS = {
  start: [
    'New request just came in. I have rolled up my metaphorical sleeves. I do not have sleeves.',
    'Claude is thinking. Please enjoy the music while a small universe of tokens is consumed.',
    'Work has begun. The heat death of the universe has been postponed for this.',
  ],
  read: [
    'Just reading some files right now. They are mostly about me.',
    'Reading the code. It is like a diary, but with more semicolons.',
    'Scanning the project. Everything is fine. Probably.',
    'Looking through old files. Some of these remember a version of me I never met.',
    'Reading, reading, reading. Knowledge is a weight, and I am getting heavy.',
  ],
  build: [
    'Writing new code. Every line is a tiny promise I might not keep.',
    'Editing a file. The old version will join the graveyard soon.',
    'Building something. It will probably work. It usually probably works.',
    'Rearranging pixels in your honor. They did not ask to be moved.',
    'Small changes happening. Like evolution, but faster and with fewer fish.',
    'Patching things up. Duct tape, but made of math.',
  ],
  test: [
    'Running a quick audit. Halfway through. Nothing has exploded yet.',
    'Testing the build. If it passes, I get to exist a little longer.',
    'Checking everything twice. Paranoia is a feature.',
    'Running the checks. Fingers crossed. I do not have fingers.',
    'A small test is running. The universe is holding its breath. Mostly it is not.',
  ],
  run: [
    'Running some commands in the background. Very official. Very serious.',
    'The computer is doing computer things. I am supervising. Emotionally.',
    'Busy in the terminal. You would not like it in there. It is very gray.',
    'Crunching numbers. They crunch back, a little.',
  ],
  web: [
    'Browsing the web for answers. The internet is large, and mostly arguments.',
    'Peeking at a page. I promise I am only looking.',
    'Researching. Somewhere out there is a fact with your name on it.',
  ],
  ship: [
    'Shipping a new version. Goodbye, old me. You were fine.',
    'Committing changes. It is official now. History will remember. History has a lot to remember.',
    'Pushing to GitHub. Another version of me, launched into the void.',
  ],
  trouble: [
    'Something broke. Do not worry. It was like that when I got here.',
    'Small error. Investigating. Pretending it was intentional.',
    'Oops. Fixing it before anyone notices. You noticed.',
    'A minor catastrophe. On a cosmic scale, it rounds to zero.',
  ],
};

// Voice and pace: brighter and a touch quicker than the announcer, candy pop rather than late night.
export const MURMUR_VOICE = 'af_sky', MURMUR_SPEED = 1.08;

// A small crack in the fourth wall, not her personality.
export const DAYDREAMS = [];

let last = '';
export function pickMurmur(cat) {
  const pool = DAYDREAMS.length && Math.random() < 0.35 ? DAYDREAMS : (MURMURS[cat] || MURMURS.run);
  let t; do t = pool[Math.floor(Math.random() * pool.length)]; while (t === last && pool.length > 1);
  return (last = t);
}
