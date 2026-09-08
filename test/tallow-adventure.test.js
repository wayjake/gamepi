'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tallow = require('../src/games/tallow');
const W = require('../src/games/tallow/world');
const input = require('../src/input');
const renderer = require('../src/gfx/scene');
const invariants = require('./invariants');
function drive(game) {
  const pad = new input.Pad();
  const tick = () => game.update(1/30,{p1:pad.read()});
  const tap = key => {pad.set(key,true);tick();pad.set(key,false);tick();};
  const walk = node => {
    assert.equal(game.state().screen,'explore');
    for(let i=0;i<400;i++) {
      const s=game.state();
      if(Math.abs(s.x-node.x)<0.012 && Math.abs(s.y-node.y)<0.018) break;
      pad.set('left',s.x>node.x+0.009);pad.set('right',s.x<node.x-0.009);
      pad.set('up',s.y>node.y+0.014);pad.set('down',s.y<node.y-0.014);tick();
    }
    pad.clear();tick();tap('a');
  };
  const action = n => {while(game.state().cursor!==n)tap('right');tap('a');};
  const fight = (capture=false) => {
    for(let i=0;i<100 && game.state().screen==='battle';i++) {
      const s=game.state(),b=s.battle,c=s.roster[s.lead];
      if(capture && b.enemy.hp<=b.max/2) action(3);
      else if(c.hp<W.maxHP(c)*0.5 || b.turn%3===2) action(2);
      else action(capture?0:b.energy?1:0);
    }
    assert.equal(game.state().screen,'result','fight must resolve');
  };
  return {tap,walk,action,fight};
}
function memory() {let data=null;return {load:()=>data,write:s=>{data=JSON.parse(JSON.stringify(s));}};}

test('Tallow adventure: fresh campaign collects, grinds, kindles and opens all four roads',()=>{
  const store=memory(),game=tallow.create(720,480,{seed:14,save:store}),d=drive(game);
  d.tap('a');
  const check=()=>invariants.legalFrame(game.scene(),renderer.render(game.scene()),game.state().screen);
  check();
  for(let region=0;region<4;region++) {
    assert.equal(game.state().region,region);
    for(let slot=0;slot<3;slot++) {
      if(game.state().roster.some(c=>c.id===region*3+slot))continue;
      d.walk(W.NODES[0]);d.tap('b');
      d.walk(W.NODES[slot+1]);check();d.fight(true);check();d.tap('a');
      assert.ok(game.state().roster.some(c=>c.id===region*3+slot));
    }
    // Repeat local tracks to grow a chosen companion: progress survives visits home.
    for(let loops=0;game.state().roster[0].level<W.REGIONS[region].level+1 && loops<30;loops++) {
      d.walk(W.NODES[0]);d.tap('b');d.walk(W.NODES[1]);d.fight();d.tap('a');
    }
    d.tap('b'); check();
    d.tap('select'); // invest battle rewards in the starter
    d.tap('b');
    d.walk(W.NODES[0]);check();d.tap('b');
    d.walk(W.NODES[4]);d.fight();check();
    assert.ok(region===3?game.state().complete:game.state().unlocked>region,'keeper must unlock travel');
    d.tap('a');if(region<3)d.tap('a');
  }
  const end=game.state();
  assert.equal(end.roster.length,12);assert.equal(end.complete,true);assert.equal(end.roster[0].rank,3);
  const loaded=tallow.create(720,480,{seed:14,save:store}).state();
  assert.equal(loaded.complete,true);assert.equal(loaded.roster.length,12);assert.equal(loaded.wax,end.wax);
});

test('Tallow adventure: pause preserves roster return destination; upgrades cannot be bought without wax',()=>{
 const game=tallow.create(720,480,{seed:1}),d=drive(game);d.tap('a');d.tap('b');
 d.tap('select');assert.equal(game.state().roster[0].rank,0);
 d.tap('start');assert.equal(game.state().screen,'paused');d.tap('b');assert.equal(game.state().screen,'roster');
 d.tap('b');assert.equal(game.state().screen,'explore');
});

test('Tallow adventure: battle intent, failed bond, swapping and retreat obey turn costs',()=>{
 const game=tallow.create(720,480,{seed:3}),d=drive(game);d.tap('a');d.walk(W.NODES[2]);
 d.action(3);assert.equal(game.state().battle.turn,0);assert.equal(game.state().roster.length,1);
 d.action(2);assert.equal(game.state().battle.turn,1);assert.equal(game.state().battle.energy,3);
 d.tap('b');d.tap('start');d.tap('b');d.tap('b');assert.equal(game.state().screen,'battle');
 d.action(5);assert.equal(game.state().screen,'explore');
});

test('Tallow adventure: corrupt saves recover and write failures stay playable',()=>{
 for(const s of [null,{}, {version:1,roster:[null]}, {version:1,region:0,unlocked:0,wax:0,complete:false,roster:[null]}]) {
  assert.doesNotThrow(()=>tallow.create(720,480,{seed:1,save:{load:()=>s,write(){}}}));
 }
 const game=tallow.create(720,480,{seed:2,save:{load:()=>null,write(){throw Error('disk');}}}),d=drive(game);
 d.tap('a');d.walk(W.NODES[0]);assert.match(game.state().message,/Journal unavailable/);d.tap('b');assert.equal(game.state().screen,'explore');
});

test('Tallow adventure: elemental arts reward matchups',()=>{
 const a=W.companion(0,3),weak=W.companion(1,3),resistant=W.companion(2,3);
 assert.ok(W.damage(a,weak,true)>W.damage(a,resistant,true));
});
