'use strict';

// A finite bestiary. Every region adds three bodies and a new travel ability.
const CREATURES = [
  ['WICKLET', 'ember', 'fox', 'A small flame that followed you home.'],
  ['REEDLING', 'moss', 'frog', 'It sings the names of missing roads.'],
  ['DUSKMOTH', 'tide', 'moth', 'Its wings remember the summer sky.'],
  ['CINDERHARE', 'ember', 'hare', 'Warm footprints cross the cold marsh.'],
  ['BELLTOAD', 'moss', 'frog', 'The chapel bell rings in its throat.'],
  ['GLASSFIN', 'tide', 'fish', 'You can see the rain inside it.'],
  ['KILNFOX', 'ember', 'fox', 'It sleeps where the houses stood.'],
  ['MOSSBACK', 'moss', 'stag', 'A forest grows between its antlers.'],
  ['VEILRAY', 'tide', 'moth', 'A piece of night learning to swim.'],
  ['ASHCROWN', 'ember', 'stag', 'The last keeper of the furnace.'],
  ['ROOTWARD', 'moss', 'hare', 'It tends a garden under the lake.'],
  ['DEEPBELL', 'tide', 'fish', 'Something below is answering.'],
].map(([name, element, body, lore], id) => ({ id, name, element, body, lore, region: Math.floor(id / 3) }));
const REGIONS = [
  { name: 'LANTERN BANK', gate: 'THE REED KEEPER', level: 3, element: 'moss', lore: 'The lamps are lit. Nobody lives here.' },
  { name: 'THE SUNKEN MARSH', gate: 'THE BELL KEEPER', level: 5, element: 'tide', lore: 'A bell rings beneath your footsteps.' },
  { name: 'COLD KILN', gate: 'THE ASH KEEPER', level: 7, element: 'ember', lore: 'The furnaces have begun to breathe.' },
  { name: 'ASHCOMBE BELOW', gate: 'THE RESERVOIR', level: 9, element: 'tide', lore: 'Something has kept the valley alive.' },
];
const NODES = [
  { x: 0.12, y: 0.66, kind: 'camp', label: 'LANTERN CAMP' },
  { x: 0.32, y: 0.40, kind: 'wild', slot: 0, label: 'WARM TRACKS' },
  { x: 0.51, y: 0.69, kind: 'wild', slot: 1, label: 'RUSTLING REEDS' },
  { x: 0.66, y: 0.33, kind: 'wild', slot: 2, label: 'PALE WINGS' },
  { x: 0.87, y: 0.55, kind: 'gate', label: 'THE KEEPER' },
];
const strong = { ember: 'moss', moss: 'tide', tide: 'ember' };
const maxHP = c => 24 + c.level * 6 + c.rank * 8;
const power = c => 5 + c.level * 2 + c.rank * 3;
const xpNeed = c => 12 + c.level * 6;
const upgradeCost = c => 12 + c.rank * 16;
const damage = (attacker, defender, skill = false) => Math.max(2, Math.round((power(attacker) - defender.level * 0.5) * (skill ? (strong[attacker.element] === defender.element ? 1.8 : strong[defender.element] === attacker.element ? 0.8 : 1.25) : 1)));
function companion(id, level = 1) {
  const c = { id, level, rank: 0, xp: 0, hp: 0, element: CREATURES[id].element };
  c.hp = maxHP(c);
  return c;
}
module.exports = { CREATURES, REGIONS, NODES, strong, maxHP, power, xpNeed, upgradeCost, damage, companion };
