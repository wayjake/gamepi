'use strict';
// The Book: what the troupe performs.
//
// A scene is a list of beats, and a beat is a register plus a line of the
// story. That pairing is the point of the whole game -- the thing you are
// grinding is not a fight with a story bolted on top, it is the story, said
// one beat at a time by whoever you have kept bright enough to say it.
//
// Lines are capitals because the font has no lower case worth using, and no
// longer than WRAP so the caption never has to wrap mid-performance.

const { REGISTERS } = require('./registers');

const WRAP = 38;

const SCENES = [
  {
    id: 'lock',
    title: 'THE LOCK',
    // The tutorial page, and it teaches by narrowing: the first four beats are
    // GRIEF and DEFIANCE only, which is one shadow held two ways.
    beats: [
      { register: 'grief', line: 'THE VALLEY WAS TOLD IN MARCH.' },
      { register: 'grief', line: 'THEY HAD UNTIL MICHAELMAS TO GO.' },
      { register: 'defiance', line: 'HOB MARROW KEPT THE LOCK ANYWAY.' },
      { register: 'defiance', line: 'HE OILED A GATE NOBODY WOULD USE.' },
      { register: 'comedy', line: 'NAN SOLD HIM TEA HE DID NOT WANT.' },
      { register: 'tenderness', line: 'AND SAT WHILE HE DRANK IT.' },
      { register: 'defiance', line: 'THE SURVEYOR CAME BACK IN JUNE.' },
      { register: 'dread', line: 'HE HAD A NUMBER FOR THE CHURCH.' },
      { register: 'wonder', line: 'TAM ORCHARD RAN AHEAD TO SEE IT.' },
      { register: 'grief', line: 'FATHER BELL RANG THE BELL HIMSELF.' },
      { register: 'dread', line: 'THE GATES CAME DOWN AT MIDNIGHT.' },
      { register: 'tenderness', line: 'HOB WALKED OUT LAST, AND SLOWLY.' },
      { register: 'wonder', line: 'BY MORNING THERE WAS A LAKE.' },
    ],
  },
  {
    id: 'drawing',
    title: 'THE DRAWING OF THE VALLEY',
    beats: [
      { register: 'wonder', line: 'THE WATER TOOK A YEAR TO ARRIVE.' },
      { register: 'dread', line: 'IT CAME UP THE LANES LIKE A GUEST.' },
      { register: 'grief', line: 'THE ORCHARD WENT UNDER IN LEAF.' },
      { register: 'comedy', line: 'NAN SAID SHE HAD SEEN WORSE RENT.' },
      { register: 'defiance', line: 'AND WOULD NOT SELL HER WEIGHTS.' },
      { register: 'tenderness', line: 'THE PIKE CAME IN OVER THE WALL.' },
      { register: 'wonder', line: 'AND SWAM THE LENGTH OF THE STREET.' },
      { register: 'dread', line: 'THE WORKS PUT A FENCE ON THE HILL.' },
      { register: 'grief', line: 'AND A SIGN WITH NO NAME ON IT.' },
      { register: 'defiance', line: 'WE PLAY IT SO THE NAME KEEPS.' },
      { register: 'tenderness', line: 'THAT IS THE WHOLE OF THE TRADE.' },
      { register: 'wonder', line: 'ASHCOMBE. SAY IT WITH ME.' },
    ],
  },
];

// Wraps a line into pages of the caption box. Kept even though every line in
// the Book is short enough not to need it: a line that grows past WRAP should
// page rather than fall off the sheet, and the test asserts it never has to.
function paginate(line, wrap = WRAP) {
  const pages = [];
  let page = '';
  for (const word of line.split(' ')) {
    if (page && page.length + 1 + word.length > wrap) { pages.push(page); page = word; }
    else page = page ? `${page} ${word}` : word;
  }
  if (page) pages.push(page);
  return pages;
}

// Checked at require time. The second rule is the one worth having: a scene
// calling for a register nothing in the rack can produce is a page that cannot
// be performed, and it would take a playthrough to that page to find out.
function validate(scenes = SCENES, cast = null) {
  const seen = new Set();
  for (const scene of scenes) {
    const where = `tallow book: ${scene.id ?? '(no id)'}`;
    if (!scene.id || !scene.title) throw new Error(`${where}: a scene needs an id and a title`);
    if (seen.has(scene.id)) throw new Error(`${where}: two scenes share an id`);
    seen.add(scene.id);
    if (!Array.isArray(scene.beats) || scene.beats.length < 4) throw new Error(`${where}: a scene is at least four beats`);
    for (const [i, beat] of scene.beats.entries()) {
      if (!REGISTERS[beat.register]) throw new Error(`${where}: beat ${i} calls for ${JSON.stringify(beat.register)}, not a register`);
      if (!beat.line) throw new Error(`${where}: beat ${i} says nothing`);
      if (paginate(beat.line).length > 1) throw new Error(`${where}: beat ${i} is longer than the caption box: "${beat.line}"`);
    }
    if (cast) castable(scene, cast, where);
  }
  return scenes;
}

// Every register a scene asks for has to be reachable by somebody in the rack,
// in some zone. Angels' rule that no gate is locked behind the key it holds,
// said about a page instead of a door.
function castable(scene, cast, where = `tallow book: ${scene.id}`) {
  const reachable = new Set();
  for (const shadow of cast) for (const register of Object.values(shadow.zones)) reachable.add(register);
  for (const beat of scene.beats) {
    if (!reachable.has(beat.register)) {
      throw new Error(`${where}: nothing in the rack can play ${beat.register}`);
    }
  }
  return true;
}

validate();

module.exports = { SCENES, WRAP, paginate, validate, castable };
