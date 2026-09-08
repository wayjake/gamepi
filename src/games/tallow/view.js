'use strict';
const path = require('path');
const psf = require('../../psf');
const { PALETTE: P } = require('../../gfx/palette');
const W = require('./world');
const FONT = psf.load(path.join(__dirname, '../../../assets/Lat15-TerminusBold16.psf.gz'));
const rect = (x,y,w,h,fill) => ({ type:'rect', x:Math.round(x),y:Math.round(y),w:Math.round(w),h:Math.round(h),fill });
const disc = (x,y,r,fill) => ({ type:'disc',x:Math.round(x),y:Math.round(y),r:Math.round(r),fill });
const colour = element => P[{ ember:'sun', moss:'moss', tide:'sky' }[element]];
function creature(c, x, y, size, t = 0, facing = 1) {
  const def = W.CREATURES[c.id], s = size / 100 * (1 + c.rank * 0.12);
  const shapes = [], dark = P.shade;
  const d = (a,b,r,col=dark) => shapes.push(disc(x+a*s*facing,y+b*s,r*s,col));
  const r = (a,b,w,h,col=dark) => shapes.push(rect(x+(facing===1?a:-a-w)*s,y+b*s,w*s,h*s,col));
  const bob = Math.sin(t * 2 + c.id) * 2;
  y += bob;
  if (def.body === 'moth') {
    d(-25,-30,25); d(25,-30,25); d(-21,-5,17); d(21,-5,17); r(-5,-48,10,58);
    r(-13,-60,5,22); r(8,-60,5,22); d(-25,-32,8,colour(c.element)); d(25,-32,8,colour(c.element));
  } else if (def.body === 'fish') {
    d(0,-23,26); d(-28,-23,17); r(-44,-43,10,40); r(0,-57,8,22); d(4,-57,6,colour(c.element));
  } else if (def.body === 'frog') {
    d(0,-17,28); d(-22,-2,17); d(22,-2,17); d(-15,-41,12); d(15,-41,12);
    d(-15,-43,4,colour(c.element)); d(15,-43,4,colour(c.element)); r(-9,-15,18,7,colour(c.element));
  } else {
    d(-6,-24,24); d(15,-46,18); d(30,-41,10);
    r(-23,-17,9,31); r(8,-17,9,31);
    if (def.body === 'hare') { r(3,-91,9,40); r(20,-96,9,44); d(-31,-20,10); }
    else if (def.body === 'stag') {
      r(4,-82,6,29); r(26,-86,6,35); r(-8,-79,19,6); r(26,-78,20,6); r(-9,-92,6,18); r(40,-92,6,18);
    } else { r(5,-70,9,19); r(22,-70,9,19); d(-32,-32,15); d(-43,-44,11); }
    d(22,-48,4,colour(c.element)); r(-4,-32,12,9,colour(c.element));
  }
  if (c.rank) { d(0,-110,5,colour(c.element)); if (c.rank > 1) { d(-15,-104,4,colour(c.element)); d(15,-104,4,colour(c.element)); } }
  return shapes;
}
function emblem({x,y,w,h}) {
  return [rect(x,y,w,h,P.lamp2),disc(x+w*0.6,y+h*0.45,h*0.4,P.lamp4),...creature(W.companion(0),x+w*0.5,y+h*0.8,h*0.8)];
}
function scene(width,height,court,g,near) {
  const {x,y,w,h} = court, cx=x+w/2;
  const shapes=[], labels=[];
  const add = (...s) => shapes.push(...s);
  const text = (s,px,py,scale=1,fill=P.cream,anchor='start') => labels.push({text:s,x:Math.round(px),y:Math.round(py),scale,fill,anchor,font:FONT});
  const center = (s,py,scale=1,fill=P.cream) => text(s,cx,py,scale,fill,'middle');
  const title = s => center(s,y+14,2,P.linen);
  const footer = s => center(s,y+h-23,1,P.lamp3);
  const wrap = (s,py,fill=P.cream) => {
    const words=s.split(' '); let line='', row=0;
    for (const word of words) { if ((line+word).length>70) { text(line,x+24,py+row++*18,1,fill); line=''; } line+=word+' '; }
    if(line) text(line.trim(),x+24,py+row*18,1,fill);
  };
  const bar=(px,py,value,max,bw=170,fill=P.moss)=>{add(rect(px,py,bw,8,P.lamp0),rect(px,py,Math.max(0,bw*value/max),8,fill));};
  // Broad bands and sparse motes keep the old lamp-lit, cut-paper atmosphere.
  for(let i=0;i<8;i++) add(rect(x,y+i*h/8,w,Math.ceil(h/8),P['lamp'+[0,1,2,3,3,2,1,0][i]]));
  for(const m of g.motes) add(disc(x+m.x*w,y+60+m.y*(h-120),2,P.lamp3));
  // Drowned buildings across the far bank; all surfaces, no outlines.
  for(let i=0;i<9;i++) {
    const bx=x+i*w/8, bh=24+(i*17+g.region*13)%43;
    add(rect(bx,y+140-bh,30,bh,P.lamp1),rect(bx+10,y+120-bh,9,22,P.lamp1));
  }
  add(rect(x,y,w,56,P.soot),rect(x,y+h-86,w,86,P.soot));
  if(g.screen==='menu') {
    title('TALLOW'); center('THE VALLEY KEEPS ITS LITTLE LIGHTS',y+62,1,P.shade);
    add(...creature(W.companion(0),cx-110,y+238,105,g.elapsed),...creature(W.companion(1),cx+110,y+242,85,g.elapsed));
    add(rect(x,y+260,w,h-260,P.soot));
    const menu=[g.saved?'CONTINUE THE JOURNEY':'ENTER THE VALLEY','HOW TO PLAY','QUIT'];
    menu.forEach((s,i)=>center((g.cursor===i?'> ':'  ')+s,y+265+i*34, i===g.cursor?2:1,i===g.cursor?P.sun:P.cream));
    footer('D-PAD CHOOSE   A CONFIRM');
  } else if(g.screen==='how') {
    title('A LIGHT TO FOLLOW');
    ['Walk with the D-pad. A inspects nearby tracks.',
      'Wild tracks always return: battle, earn wax, grow.',
      'Weaken a creature to half HP. BEFRIEND is certain.',
      'B opens your collection. A chooses your companion.',
      'SELECT spends wax to kindle it, up to three times.',
      'STRIKE spares new creatures. WILD ART spends a spark.',
      'EMBER beats MOSS. MOSS beats TIDE. TIDE beats EMBER.',
      'SHELTER heals, guards and restores a spark.',
      'Keepers surge every third turn. Watch their intent.',
      'Camps heal freely and let you revisit open regions.',
      'Beat four keepers. Find all twelve creatures.',
      'Progress saves after rewards, upgrades and travel.'].forEach((s,i)=>text(s,x+24,y+70+i*23,1,i<10?P.shade:P.cream));
    footer('A / B BACK');
  } else if(g.screen==='explore') {
    title(W.REGIONS[g.region].name);
    text(`${g.roster.length}/12 FRIENDS`,x+16,y+61,1,P.shade);
    text(`${g.wax} WAX`,x+w-16,y+61,1,P.shade,'end');
    const nx=n=>x+n.x*w, ny=n=>y+65+n.y*290;
    // The same valley changes character as the journey descends.
    if(g.region===1 || g.region===3) {
      add(rect(x,y+255,w,84,P.lamp1));
      for(let i=0;i<12;i++) add(rect(x+14+(i*71)%Math.max(1,w-65),y+270+(i%4)*17,38,3,P.lamp2));
    }
    if(g.region===2) {
      for(let i=0;i<5;i++) {
        const bx=x+45+i*120;
        add(rect(bx,y+96,26,65,P.lamp0),rect(bx-8,y+144,42,30,P.lamp0),rect(bx+6,y+153,14,16,P.sun));
      }
    }
    if(g.region===3) {
      add(rect(cx-30,y+98,60,74,P.lamp0),rect(cx-12,y+72,24,100,P.lamp0),disc(cx,y+123,8,P.lamp3));
    }
    for(let i=0;i<14;i++) {
      const rx=x+10+i*(w-20)/14, ry=y+314+(i%3)*9;
      add(rect(rx,ry-17,4,22,P.lamp0),rect(rx+7,ry-26,4,31,P.lamp0),disc(rx+9,ry-26,4,P.lamp0));
    }
    // A winding causeway makes destinations legible while allowing free movement.
    for(let i=1;i<W.NODES.length;i++) {
      const a=W.NODES[i-1],b=W.NODES[i];
      for(let j=0;j<=24;j++) add(disc(nx(a)+(nx(b)-nx(a))*j/24,ny(a)+(ny(b)-ny(a))*j/24,8,P.lamp2));
    }
    W.NODES.forEach((n,i)=>{
      const px=nx(n),py=ny(n);
      if(n.kind==='camp') { add(rect(px-14,py-24,28,30,P.shade),disc(px,py-11,8,P.sun),rect(px-18,py+7,36,6,P.shade)); }
      else if(n.kind==='gate') {add(rect(px-20,py-56,10,65,P.shade),rect(px+10,py-56,10,65,P.shade),rect(px-20,py-56,40,10,P.shade),disc(px,py-27,8,g.region<g.unlocked||g.complete?P.moss:P.sun));}
      else { add(...creature(W.companion(g.region*3+n.slot),px,py,35,g.elapsed)); }
      if(near===n) add(rect(px-20,py+20,40,4,P.sun));
    });
    const px=x+g.x*w, py=y+65+g.y*290;
    add(disc(px,py-21,7,P.shade),rect(px-7,py-15,14,23,P.shade),rect(px-7,py+5,5,10,P.shade),rect(px+2,py+5,5,10,P.shade),disc(px+13,py-7,5,P.sun));
    add(...creature(g.roster[g.lead],px-29,py+5,24,g.elapsed));
    const prompt=near ? near.kind==='gate' ? g.region<g.unlocked?'A  WALK THE OPEN ROAD':g.complete?'THE VALLEY IS AWAKE':`A  ${W.REGIONS[g.region].gate} / L${W.REGIONS[g.region].level}` : near.kind==='camp'?'A  REST / TRAVEL':`A  TRACK ${W.CREATURES[g.region*3+near.slot].name}` : 'FOLLOW THE CREATURE TRACKS';
    center(prompt,y+h-77,1,P.sun); wrap(g.message,y+h-55); footer('D-PAD WALK   B CREATURES   START PAUSE');
  } else if(g.screen==='battle'||g.screen==='result') {
    const b=g.battle,c=g.roster[g.lead],enemy=b.enemy;
    title(b.boss?W.REGIONS[g.region].gate:`WILD ${W.CREATURES[enemy.id].name}`);
    text(`${W.CREATURES[c.id].name} L${c.level}`,x+28,y+68,1,P.shade);
    text(`${enemy.element.toUpperCase()} L${enemy.level}`,x+w-28,y+68,1,P.shade,'end');
    bar(x+28,y+91,c.hp,W.maxHP(c)); bar(x+w-198,y+91,enemy.hp,b.max,170,P.ember);
    text(`${c.hp}/${W.maxHP(c)} HP  ${b.energy} SPARKS`,x+28,y+108,1,P.shade);
    text(`${enemy.hp}/${b.max} HP`,x+w-28,y+108,1,P.shade,'end');
    add(...creature(c,x+w*0.26,y+260,103,g.elapsed),...creature(enemy,x+w*0.75,y+260,b.boss?120:98,g.elapsed,-1));
    center(g.screen==='result'?(g.complete?'THE VALLEY WAKES':'THE ROAD REMAINS'):`NEXT: ${b.turn%3===2?'SURGE! SHELTER CAN GUARD IT':'STRIKE'}   |   ${c.element.toUpperCase()} > ${W.strong[c.element].toUpperCase()}`,y+280,1,P.shade);
    if(g.screen==='battle') {
      ['STRIKE','WILD ART','SHELTER','BEFRIEND','SWAP','RETREAT'].forEach((s,i)=>{
        const bx=x+18+(i%3)*(w-36)/3, by=y+309+Math.floor(i/3)*25;
        if(g.cursor===i) add(rect(bx-4,by-3,(w-48)/3,23,P.shade));
        text((g.cursor===i?'> ':'  ')+s,bx,by,1,g.cursor===i?P.sun:P.cream);
      });
    }
    wrap(g.message,y+h-76); footer(g.screen==='result'?'A  CONTINUE':'D-PAD CHOOSE   A ACT   B SWAP   START PAUSE');
  } else if(g.screen==='roster') {
    const c=g.roster[g.pick], def=W.CREATURES[c.id];
    title(`${def.name}  ${g.pick+1}/${g.roster.length}`);
    add(...creature(c,x+w*0.24,y+275,115,g.elapsed));
    const tx=x+w*0.48;
    text(`${def.element.toUpperCase()}   LEVEL ${c.level}`,tx,y+84,1,P.shade);
    text(`KINDLED ${c.rank}/3`,tx,y+115,2,P.shade);
    text(`HP ${c.hp}/${W.maxHP(c)}  POWER ${W.power(c)}`,tx,y+160,1,P.shade);
    bar(tx,y+188,c.xp,W.xpNeed(c),220,P.sun);
    text(c.level===12?'LEVEL COMPLETE':`GROWTH ${c.xp}/${W.xpNeed(c)}`,tx,y+205,1,P.shade);
    text(c.rank===3?'FULLY KINDLED':`KINDLE: ${W.upgradeCost(c)} WAX`,tx,y+243,1,P.shade);
    text(`YOUR WAX: ${g.wax}`,tx,y+269,1,P.shade);
    center(def.lore,y+316,1,P.shade);
    wrap(g.message,y+h-76);
    footer(g.returnTo==='battle'?'LEFT / RIGHT   A SWAP   B BACK':'LEFT / RIGHT   A LEAD   SELECT KINDLE   B BACK');
  } else if(g.screen==='camp') {
    title('LANTERN CAMP');
    add(disc(cx,y+160,46,P.lamp4),rect(cx-16,y+125,32,66,P.shade),disc(cx,y+157,11,P.sun));
    center('ALL FRIENDS RESTORED',y+224,2,P.shade);
    center('< '+W.REGIONS[g.pick].name+' >',y+281,1,P.shade);
    center(`${g.unlocked+1}/4 ROADS OPEN   ${g.roster.length}/12 FRIENDS`,y+317,1,P.shade);
    wrap(g.message,y+h-74); footer('LEFT / RIGHT TRAVEL   A GO   SELECT CREATURES   B BACK');
  } else if(g.screen==='paused') {
    title('THE LANTERN WAITS'); center('YOUR FRIENDS ARE SAFE HERE',y+182,1,P.shade);
    center('A / B / START  RESUME',y+262,1,P.shade); footer('SELECT  SAVE AND RETURN TO MENU');
  }
  return {title:`Tallow (${g.screen})`,width,height,background:P.soot,matte:court,matteColour:P.soot,font:FONT,layers:[{flat:true,shapes}],text:labels};
}
module.exports={scene,emblem,creature};
