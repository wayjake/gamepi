'use strict';
// The six registers, and the three places on the dial a shadow can be held.
//
// This is the type chart. Six is the most a player can hold in their head
// while also working two rods, and it is enough that no shadow covers more
// than half of it.
//
// The dial is the other half of the system, and it is a fact about real shadow
// puppets rather than an invention: a puppet pressed against the sheet throws
// a small hard-edged shadow, and one carried back towards the lamp throws a
// huge soft one. So every shadow reads three ways without a second drawing,
// and moving between them is where the skill is.

const REGISTERS = {
  grief: { label: 'GRIEF', dye: 'sky' },
  defiance: { label: 'DEFIANCE', dye: 'ember' },
  comedy: { label: 'COMEDY', dye: 'sun' },
  tenderness: { label: 'TENDERNESS', dye: 'rose' },
  dread: { label: 'DREAD', dye: 'violet' },
  wonder: { label: 'WONDER', dye: 'moss' },
};

// Ordered, and `upTo` is the top of each band on a 0..1 dial. reading() in
// shadow.js takes the first band the depth falls inside, so these must stay in
// order and the last must be 1.
const ZONES = [
  { id: 'sharp', label: 'SHARP', where: 'AT THE SHEET', upTo: 0.30 },
  { id: 'full', label: 'FULL', where: 'MID-FLOOR', upTo: 0.70 },
  { id: 'looming', label: 'LOOMING', where: 'AT THE LAMP', upTo: 1 },
];

const NAMES = Object.keys(REGISTERS);

module.exports = { REGISTERS, ZONES, NAMES };
