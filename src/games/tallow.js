'use strict';

const fs = require('fs');
const path = require('path');
const input = require('../input');
const { picture } = require('../gfx/safearea');
const W = require('./tallow/world');
const art = require('./tallow/view');
const MENU = [{ id: 'adventure', label: 'ENTER THE VALLEY' }, { id: 'how', label: 'HOW TO PLAY' }, { id: 'quit', label: 'QUIT' }];
const SAVE = path.join(require('../scores').DIR, 'tallow.json');
const fileStore = {
  load() { try { return JSON.parse(fs.readFileSync(SAVE, 'utf8')); } catch { return null; } },
  write(data) {
    fs.mkdirSync(path.dirname(SAVE), { recursive: true });
    fs.writeFileSync(`${SAVE}.tmp`, JSON.stringify(data));
    fs.renameSync(`${SAVE}.tmp`, SAVE);
  },
};
function validSave(s) {
  return s && s.version === 1 && Number.isInteger(s.region) && s.region >= 0 && s.region < 4
    && Number.isInteger(s.unlocked) && s.unlocked >= s.region && s.unlocked <= 3
    && Number.isInteger(s.wax) && s.wax >= 0 && s.wax <= 1000000
    && typeof s.complete === 'boolean' && Array.isArray(s.roster) && s.roster.length > 0 && s.roster.length <= 12
    && new Set(s.roster.map(c => c?.id)).size === s.roster.length
    && s.roster.every(c => c && Number.isInteger(c.id) && W.CREATURES[c.id]
      && Number.isInteger(c.level) && c.level >= 1 && c.level <= 12
      && Number.isInteger(c.rank) && c.rank >= 0 && c.rank <= 3
      && Number.isInteger(c.xp) && c.xp >= 0 && c.xp < W.xpNeed(c))
    && Number.isInteger(s.lead) && s.lead >= 0 && s.lead < s.roster.length;
}
function create(width = 720, height = 480, options = {}) {
  const court = picture(width, height);
  // Explicit seeds make tests and previews independent of the user's save.
  const store = options.save ?? (options.seed === undefined ? fileStore : { load: () => null, write() {} });
  let seed = (options.seed ?? 0x54414c4c) >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sounds = [];
  const g = { screen: 'menu', exit: false, cursor: 0, elapsed: 0, region: 0, unlocked: 0, wax: 0,
    roster: [W.companion(0)], lead: 0, pick: 0, complete: false, x: 0.12, y: 0.66,
    message: 'Follow the tracks. A small flame walks beside you.', battle: null, returnTo: 'explore',
    motes: Array.from({ length: 20 }, () => ({ x: random(), y: random() })), saved: false };
  try {
    const s = store.load();
    if (validSave(s)) {
      for (const key of ['region', 'unlocked', 'wax', 'lead', 'complete']) g[key] = s[key];
      g.roster = s.roster.map(c => { const v = { ...c, element: W.CREATURES[c.id].element }; v.hp = W.maxHP(v); return v; });
      g.saved = true;
    }
  } catch { g.message = 'The old journal could not be read.'; }
  const sound = name => sounds.push(name);
  function save() {
    try {
      store.write({ version: 1, region: g.region, unlocked: g.unlocked, wax: g.wax,
        roster: g.roster, lead: g.lead, complete: g.complete });
      g.saved = true;
    } catch { g.message = 'Journal unavailable. Progress stays this session.'; }
  }
  const active = () => g.roster[g.lead];
  function heal() { g.roster.forEach(c => { c.hp = W.maxHP(c); }); }
  function near() { return W.NODES.find(n => Math.hypot((g.x - n.x) * court.w, (g.y - n.y) * 290) < 39); }
  function reward(bound) {
    const b = g.battle;
    const amount = b.boss ? 18 + g.region * 8 : 5 + g.region * 3;
    g.wax += amount;
    let learned = '';
    for (const index of b.used) {
      const c = g.roster[index];
      if (c.level < 12) c.xp += (b.boss ? 20 : 9) + b.enemy.level * 3;
      while (c.level < 12 && c.xp >= W.xpNeed(c)) {
        c.xp -= W.xpNeed(c); c.level++; c.hp = Math.min(W.maxHP(c), c.hp + 6);
        learned = ` ${W.CREATURES[c.id].name} grew to L${c.level}!`;
      }
      if (c.level === 12) c.xp = 0;
    }
    if (bound && !g.roster.some(c => c.id === b.enemy.id)) g.roster.push(W.companion(b.enemy.id, b.enemy.level));
    if (b.boss) {
      if (g.region === 3) { g.complete = true; g.message = 'The valley wakes. Every little light answers.'; }
      else { g.unlocked = Math.max(g.unlocked, g.region + 1); g.message = 'The keeper yields. A new road is open.'; }
    } else g.message = bound ? `${W.CREATURES[b.enemy.id].name} befriended. +${amount} WAX.${learned}` : `Tracks settle. +${amount} WAX.${learned}`;
    b.result = true; g.screen = 'result'; sound('unlock'); save();
  }
  function encounter(node) {
    if (!g.roster.some(c => c.hp > 0)) { heal(); g.x = 0.12; g.y = 0.66; }
    if (active().hp <= 0) g.lead = g.roster.findIndex(c => c.hp > 0);
    const boss = node.kind === 'gate';
    const region = W.REGIONS[g.region];
    const id = g.region * 3 + (boss ? g.region % 3 : node.slot);
    const enemy = W.companion(id, boss ? region.level : 1 + g.region * 2 + Math.floor(random() * 2));
    if (boss) { enemy.element = region.element; enemy.hp += 12; }
    g.battle = { enemy, max: enemy.hp, boss, turn: 0, energy: 2, used: [g.lead], result: false };
    g.cursor = 0; g.screen = 'battle';
    g.message = boss ? 'The keeper blocks the road. Prove your bond.'
      : g.roster.some(c => c.id === id) ? 'Familiar tracks. Win to earn wax and experience.'
        : 'Weaken it to half health, then BEFRIEND.';
  }
  function reply(guard = false) {
    const b = g.battle;
    const charged = b.turn % 3 === 2;
    const hit = Math.max(1, Math.round(W.damage(b.enemy, active(), charged) * (guard ? 0.35 : 1)));
    active().hp = Math.max(0, active().hp - hit); b.turn++;
    g.message += ` ${charged ? 'Surge' : 'Reply'}: -${hit} HP.`;
    if (active().hp === 0) {
      const next = g.roster.findIndex(c => c.hp > 0);
      if (next < 0) {
        heal(); g.x = 0.12; g.y = 0.66; g.screen = 'result'; b.result = true;
        g.message = 'Your lantern brings everyone home. Rested at camp.'; save();
      } else {
        g.lead = next;
        if (!b.used.includes(next)) b.used.push(next);
        g.message = `${W.CREATURES[active().id].name} steps in. Your friend is safe.`;
      }
    }
  }
  function act(action) {
    const b = g.battle;
    if (action === 5) { g.screen = 'explore'; g.message = 'You slip back onto the road.'; return; }
    if (action === 4) { g.pick = g.lead; g.returnTo = 'battle'; g.screen = 'roster'; return; }
    if (action === 3) {
      if (b.boss) { g.message = 'Keepers cannot be befriended. Defeat this one.'; return; }
      if (b.enemy.hp > b.max / 2) { g.message = 'Still wary. Reduce its HP to half first.'; return; }
      if (g.roster.some(c => c.id === b.enemy.id)) {
        g.message = 'Already your friend. Win for wax and experience.'; return;
      }
      reward(true); return;
    }
    if (action === 2) {
      b.energy = Math.min(3, b.energy + 1);
      active().hp = Math.min(W.maxHP(active()), active().hp + 5 + active().rank * 2);
      g.message = 'Shelter: recover HP and 1 spark.'; reply(true); return;
    }
    if (action === 1 && b.energy === 0) { g.message = 'No sparks. SHELTER restores one.'; return; }
    const hit = W.damage(active(), b.enemy, action === 1);
    if (action === 1) b.energy--;
    // A basic strike leaves an unfamiliar wild creature a chance to bond.
    const mercy = action === 0 && !b.boss && !g.roster.some(c => c.id === b.enemy.id);
    b.enemy.hp = Math.max(mercy ? 1 : 0, b.enemy.hp - hit);
    g.message = `${action === 1 ? 'Wild art' : 'Strike'}: ${hit} damage.`;
    sound('paddle');
    if (b.enemy.hp === 0) reward(false); else reply();
  }
  function update(dt, pads = {}) {
    const p = input.merge(pads.p1 ?? input.idle(), pads.p2 ?? input.idle());
    const e = p.pressed; g.elapsed += Math.min(dt, 0.1);
    if (g.screen === 'menu') {
      if (e.down) g.cursor = (g.cursor + 1) % MENU.length;
      if (e.up) g.cursor = (g.cursor + MENU.length - 1) % MENU.length;
      if (e.a || e.start) {
        const id = MENU[g.cursor].id;
        if (id === 'quit') g.exit = true;
        else g.screen = id === 'how' ? 'how' : 'explore';
      }
    } else if (g.screen === 'how') { if (e.b || e.a) g.screen = 'menu'; }
    else if (g.screen === 'paused') {
      if (e.b || e.start || e.a) g.screen = g.pausedFrom;
      if (e.select) { save(); g.screen = 'menu'; g.cursor = 0; }
    } else if (e.start) { g.pausedFrom = g.screen; g.screen = 'paused'; }
    else if (g.screen === 'explore') {
      let dx = Number(p.right) - Number(p.left), dy = Number(p.down) - Number(p.up);
      const norm = Math.hypot(dx, dy) || 1;
      g.x = Math.max(0.06, Math.min(0.94, g.x + dx / norm * Math.min(dt, 0.1) * 0.29));
      g.y = Math.max(0.20, Math.min(0.84, g.y + dy / norm * Math.min(dt, 0.1) * 0.5));
      if (e.b) { g.screen = 'roster'; g.returnTo = 'explore'; g.pick = g.lead; }
      if (e.a) {
        const n = near();
        if (n?.kind === 'camp') { heal(); g.screen = 'camp'; g.pick = g.region; g.message = 'Everyone rested. Spend wax in your collection.'; save(); }
        else if (n?.kind === 'gate' && (g.region < g.unlocked || g.complete)) {
          if (g.region < 3) { g.region++; g.x = 0.12; g.y = 0.66; g.message = W.REGIONS[g.region].lore; save(); }
          else { g.message = 'The valley is awake. Twelve lights to find.'; }
        } else if (n) encounter(n);
      }
    } else if (g.screen === 'camp') {
      if (e.left) g.pick = Math.max(0, g.pick - 1);
      if (e.right) g.pick = Math.min(g.unlocked, g.pick + 1);
      if (e.a) { g.region = g.pick; g.x = 0.12; g.y = 0.66; g.screen = 'explore'; g.message = W.REGIONS[g.region].lore; save(); }
      if (e.b) g.screen = 'explore';
      if (e.select) { g.screen = 'roster'; g.returnTo = 'camp'; g.pick = g.lead; }
    } else if (g.screen === 'roster') {
      if (e.left) g.pick = (g.pick + g.roster.length - 1) % g.roster.length;
      if (e.right) g.pick = (g.pick + 1) % g.roster.length;
      if (e.b) g.screen = g.returnTo;
      if (e.a) {
        if (g.roster[g.pick].hp <= 0) g.message = 'Rest at camp to wake this friend.';
        else if (g.returnTo === 'battle' && g.pick === g.lead) { g.screen = 'battle'; }
        else {
          g.lead = g.pick;
          if (g.returnTo === 'battle') {
            if (!g.battle.used.includes(g.lead)) g.battle.used.push(g.lead);
            g.screen = 'battle'; g.message = 'A new friend steps forward.'; reply();
          } else { g.message = `${W.CREATURES[active().id].name} now walks beside you.`; save(); }
        }
      }
      if (e.select && g.returnTo !== 'battle') {
        const c = g.roster[g.pick], cost = W.upgradeCost(c);
        if (c.rank >= 3) g.message = 'Fully kindled. This light will never go out.';
        else if (g.wax < cost) g.message = `Need ${cost} wax. Follow wild tracks to earn more.`;
        else { g.wax -= cost; c.rank++; c.hp = W.maxHP(c); g.message = `${W.CREATURES[c.id].name} kindled! Body and power grow.`; sound('unlock'); save(); }
      }
    } else if (g.screen === 'battle') {
      if (e.right || e.down) g.cursor = (g.cursor + 1) % 6;
      if (e.left || e.up) g.cursor = (g.cursor + 5) % 6;
      if (e.a) act(g.cursor);
      if (e.b) { g.pick = g.lead; g.returnTo = 'battle'; g.screen = 'roster'; }
    } else if (g.screen === 'result' && (e.a || e.b)) { g.screen = 'explore'; g.battle = null; }
  }
  return { update, scene: () => art.scene(width, height, court, g, near()), court,
    state: () => JSON.parse(JSON.stringify(g)), drain: () => sounds.splice(0),
    music: () => g.screen === 'battle' ? 'lamplight' : g.complete ? 'warmth' : 'tallow' };
}
module.exports = { title: 'TALLOW', blurb: 'SMALL CREATURES. A DROWNED WORLD.',
  meta: { players: [1], rating: 'pg', audio: '8-bit', graphics: '2d', content: ['a mysterious drowned valley'] },
  accent: 'sun', emblem: art.emblem, create, MENU, validSave };
