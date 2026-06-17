// RUNELANDS — launch art generator. Produces on-brand SVGs + PNGs.
//   node marketing/build.js   →  keyart / tweet-banner / x-header / logo  (.svg + .png)
//   keyart = premium 16:9 hero key art (isometric diorama) — the master-prompt look, rendered.
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const OUT = __dirname;
// RUNELANDS premium palette — royal purple + gold, deep arcane river/moat, lush realm.
const C = { water1:'#1f6f90', water0:'#14323f', grass:'#4d9c53', grass2:'#57a95d', grassD:'#459152',
  sand:'#8c94a9', gold:'#f0c64a', goldD:'#b8902a', goldL:'#ffe9a8', arc:'#ab7bff', arcD:'#7a3df0',
  panel:'#2d2342', panel2:'#1e1830', bg:'#15111f', line:'#8c94a9', stone:'#b6bdcc',
  txt:'#f1ecf8', dim:'#b1a4c6', tree1:'#2f6b34', tree2:'#3c8043', tree3:'#49934f', trunk:'#6b4a2a',
  tent:'#7a3df0', body:'#5a3ea5', skin:'#f0c89a', ok:'#57a95d' };
const F = "'DejaVu Sans','Liberation Sans',sans-serif";

const tree = (x,y,s=1) => `<g transform="translate(${x} ${y}) scale(${s})">
  <ellipse cx="0" cy="7" rx="12" ry="4.5" fill="#000" opacity=".18"/>
  <rect x="-3.2" y="-2" width="6.4" height="13" rx="2.5" fill="${C.trunk}"/>
  <circle cx="0" cy="-9" r="16" fill="${C.tree1}"/><circle cx="-5.5" cy="-13" r="12" fill="${C.tree2}"/>
  <circle cx="4.5" cy="-15" r="8.5" fill="${C.tree3}"/><circle cx="-8" cy="-16" r="4" fill="#fff" opacity=".12"/></g>`;

const tent = (x,y,s=1) => `<g transform="translate(${x} ${y}) scale(${s})">
  <ellipse cx="0" cy="16" rx="22" ry="6" fill="#000" opacity=".18"/>
  <rect x="-19" y="-3" width="38" height="21" rx="2" fill="#7a4a2a"/>
  <rect x="-23" y="-16" width="46" height="13" fill="${C.tent}"/>
  ${[0,1,2,3,4].map(i=>`<rect x="${-23+i*9.4}" y="-16" width="4.7" height="13" fill="#f4f4f4"/>`).join('')}
  <rect x="-21" y="-16" width="3" height="35" fill="#5a3a22"/><rect x="18" y="-16" width="3" height="35" fill="#5a3a22"/></g>`;

const hero = (x,y,s=1) => `<g transform="translate(${x} ${y}) scale(${s})">
  <ellipse cx="0" cy="15" rx="13" ry="5" fill="#000" opacity=".22"/>
  <rect x="-9" y="-2" width="18" height="17" rx="2.5" fill="${C.body}"/>
  <rect x="-8" y="-18" width="16" height="16" rx="2.5" fill="${C.skin}"/>
  <rect x="-8" y="-18" width="16" height="6" fill="#5a3a22"/>
  <rect x="-4.5" y="-9" width="2.4" height="2.4" fill="#16202b"/><rect x="2.1" y="-9" width="2.4" height="2.4" fill="#16202b"/></g>`;

// CASTLE / KEEP emblem (replaces the old mountain `peak`). Heraldic crenellated keep:
// twin battlemented towers + a taller central keep with a dark arched gate. Gold faces,
// lighter-gold highlight on the lit (left) edges, dark base shadow. Same signature as peak.
const peak = (x,y,s=1,col=C.gold) => `<g transform="translate(${x} ${y}) scale(${s})">
  <ellipse cx="0" cy="26" rx="40" ry="7" fill="#1a1226" opacity=".35"/>
  <!-- side towers -->
  <path d="M-38 24 L-38 -6 L-38 -6 L-38 -12 L-32 -12 L-32 -6 L-26 -6 L-26 -12 L-20 -12 L-20 24 Z" fill="${col}"/>
  <path d="M38 24 L38 -6 L38 -12 L32 -12 L32 -6 L26 -6 L26 -12 L20 -12 L20 24 Z" fill="${col}"/>
  <!-- central keep (taller) -->
  <path d="M-16 24 L-16 -20 L-16 -28 L-9 -28 L-9 -20 L-3 -20 L-3 -28 L3 -28 L3 -20 L9 -20 L9 -28 L16 -28 L16 -20 L16 24 Z" fill="${col}"/>
  <!-- arched gate -->
  <path d="M-7 24 L-7 4 Q0 -5 7 4 L7 24 Z" fill="#241a36"/>
  <rect x="-1.4" y="4" width="2.8" height="20" fill="${col}" opacity=".55"/>
  <!-- lit-edge highlights (left faces) -->
  <rect x="-38" y="-6" width="3" height="30" fill="${C.goldL}" opacity=".85"/>
  <rect x="-16" y="-20" width="3" height="44" fill="${C.goldL}" opacity=".85"/>
  <rect x="20" y="-6" width="3" height="30" fill="${C.goldL}" opacity=".5"/>
  <!-- merlon top sheen -->
  <rect x="-16" y="-28" width="7" height="3" fill="${C.goldL}" opacity=".7"/>
  <rect x="-3" y="-28" width="6" height="3" fill="${C.goldL}" opacity=".7"/></g>`;

// an island scene (grass blob + sand rim + trees + tent + hero + a glowing claimed plot)
function island(cx, cy, sc){
  const sand = [[-150,-30,210,140],[140,5,225,150],[0,75,190,120],[-40,-90,150,95]]
    .map(([x,y,rx,ry])=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${C.sand}"/>`).join('');
  const grass = [[-150,-30,184,118],[140,5,200,128],[0,72,166,100],[-40,-90,126,76]]
    .map(([x,y,rx,ry])=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${C.grass}"/>`).join('');
  const patches = [[-120,20,40,16],[60,-30,34,14],[150,60,44,18],[-10,90,30,12]]
    .map(([x,y,rx,ry])=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${C.grassD}" opacity=".5"/>`).join('');
  const plot = `<g transform="translate(120 38)"><rect x="-44" y="-44" width="88" height="88" rx="6" fill="${C.gold}" opacity=".14"/>
    <rect x="-44" y="-44" width="88" height="88" rx="6" fill="none" stroke="${C.gold}" stroke-width="3.5" stroke-dasharray="11 8"/>
    ${tent(120,4,1.0)}</g>`;
  const trees = [[-150,-44,1.15],[-92,-78,1],[-186,12,1.05],[-120,64,1.1],[-44,-110,.95],[36,-70,1.05],
    [200,-30,1],[244,46,1.1],[60,96,1.05],[-30,40,1],[170,-72,.95]]
    .map(([x,y,s])=>tree(x,y,s)).join('');
  return `<g transform="translate(${cx} ${cy}) scale(${sc})">
    <ellipse cx="0" cy="120" rx="340" ry="70" fill="#000" opacity=".10"/>
    ${sand}${grass}${patches}${trees}${plot}${hero(150,86,1.25)}</g>`;
}

// faint tile grid over the water (evokes the game's tiled world)
function grid(w,h,step=56){let l='';for(let x=step;x<w;x+=step)l+=`<line x1="${x}" y1="0" x2="${x}" y2="${h}"/>`;
  for(let y=step;y<h;y+=step)l+=`<line x1="0" y1="${y}" x2="${w}" y2="${y}"/>`;
  return `<g stroke="#ffffff" stroke-width="1" opacity=".04">${l}</g>`;}

const defs = `<defs>
  <radialGradient id="wat" cx="62%" cy="40%" r="85%"><stop offset="0%" stop-color="${C.water1}"/><stop offset="100%" stop-color="${C.water0}"/></radialGradient>
  <linearGradient id="pan" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${C.panel}"/><stop offset="100%" stop-color="${C.panel2}"/></linearGradient>
  <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000" flood-opacity=".45"/></filter>
</defs>`;

// wordmark: gold "RUNELANDS" with a dark shadow + the castle/keep mark
const wordmark = (x,y,size) => `
  ${peak(x+size*0.5, y-size*0.05, size/58)}
  <text x="${x+size*1.32}" y="${y}" font-family=${JSON.stringify(F)} font-weight="bold" font-size="${size}" letter-spacing="${size*0.005}">
    <tspan fill="#0c1118">RUNELANDS</tspan></text>
  <text x="${x+size*1.305}" y="${y-size*0.03}" font-family=${JSON.stringify(F)} font-weight="bold" font-size="${size}" letter-spacing="${size*0.005}" fill="${C.gold}">RUNELANDS</text>`;

const pill = (x,y,w,h,text,fs) => `<g>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h/2}" fill="${C.gold}" filter="url(#sh)"/>
  <text x="${x+w/2}" y="${y+h*0.66}" text-anchor="middle" font-family=${JSON.stringify(F)} font-weight="bold" font-size="${fs}" fill="#15202b">${text}</text></g>`;

// small gold-outline "feature chip" (dark fill, gold text) — used for a gameplay-verb strip
const chip = (x,y,w,h,text,fs) => `<g>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h/2}" fill="${C.panel2}" stroke="${C.gold}" stroke-width="2"/>
  <text x="${x+w/2}" y="${y+h*0.68}" text-anchor="middle" font-family=${JSON.stringify(F)} font-weight="bold" font-size="${fs}" fill="${C.gold}" letter-spacing="1">${text}</text></g>`;
// lay out a row of chips left→right starting at x, return the SVG
const chipRow = (x,y,h,fs,labels) => { let cx=x; return labels.map(t=>{ const w=28+t.length*(fs*0.66); const g=chip(cx,y,w,h,t,fs); cx+=w+12; return g; }).join(''); };

// ---------- 1) TWEET BANNER 1600x900 ----------
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">${defs}
  <rect width="1600" height="900" fill="url(#wat)"/>${grid(1600,900)}
  ${island(1370, 300, 0.9)}
  <text x="70" y="138" font-family=${JSON.stringify(F)} font-weight="bold" font-size="25" letter-spacing="5" fill="${C.gold}">BROWSER MMO  ·  PLAY FREE  ·  NO DOWNLOAD</text>
  ${wordmark(70, 280, 116)}
  <text x="74" y="368" font-family=${JSON.stringify(F)} font-weight="bold" font-size="44" fill="${C.txt}">Build · Fight · Trade · <tspan fill="${C.gold}">Own Land</tspan></text>
  ${['Chop wood, mine stone and fish the coast','Craft planks &amp; tools — upgrade your hero','Claim land plots that pay you passive rent','Survive monster hordes &amp; hunt the Warlord boss','Buy &amp; sell plots, top the leaderboard, daily rewards']
    .map((t,i)=>`<g transform="translate(78 ${426+i*50})"><circle cx="9" cy="-6" r="7" fill="${C.ok}"/><path d="M5 -6 l3 3 l6 -7" stroke="#15202b" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="34" y="0" font-family=${JSON.stringify(F)} font-size="28" fill="${C.txt}">${t}</text></g>`).join('')}
  ${chipRow(78, 690, 42, 22, ['MINE','FISH','CRAFT','CLAIM LAND','TRADE'])}
  ${pill(78, 754, 540, 76, 'PLAY FREE  →  runelands.fun', 34)}
  <text x="80" y="872" font-family=${JSON.stringify(F)} font-size="22" fill="${C.dim}">Claim your corner of the realm — a build · fight · trade MMO with an own-land economy.</text>
</svg>`;

// ---------- 2) X-HEADER + 3) LOGO: premium versions are defined further below, after the
//            shared isometric-diorama components (search for `const header` / `const logo`). ----------

// ===================== PREMIUM KEY ART — 16:9 hero poster (1920x1080) =====================
// Realizes the master prompt as a true isometric diorama: floating extruded island, sunset
// rim light, merchant village, hero, glowing land-claim plots, coins, a faint Warlord boss.
// diorama palette — dark arcane-stone island sides + lush realm greens; `red` is now the
// royal banner/keep accent (purple) so the merchant pavilion reads as a heraldic tent.
const K = { rockX:'#1a1428', rockD:'#2b2140', treeL:'#57a95d', treeM:'#3c8043', treeD:'#2f6b34', red:'#7a3df0' };

// isometric world transform (2:1) — one shared grid so props/plots/island stay coherent
const IZ = { ox:980, oy:360, tw:50, th:25 };
const iso = (gx,gy)=>[ IZ.ox+(gx-gy)*IZ.tw, IZ.oy+(gx+gy)*IZ.th ];
const NN=iso(0,0), EE=iso(8,0), SS=iso(8,8), WW=iso(0,8), CB=[(NN[0]+SS[0])/2,(NN[1]+SS[1])/2];
const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];
const PTS=a=>a.map(p=>`${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

// low-poly pine — light from upper-right (right halves brighter) + cast shadow
const tierP=(w,h,yb,L,R)=>`<path d="M0 ${yb-h} L${-w} ${yb} L0 ${yb} Z" fill="${L}"/><path d="M0 ${yb-h} L${w} ${yb} L0 ${yb} Z" fill="${R}"/>`;
const pine=s=>`<g transform="scale(${s})">
  <ellipse cx="-8" cy="4" rx="20" ry="7" fill="#0a1a0e" opacity=".22"/>
  <rect x="-4" y="-8" width="8" height="14" rx="2.5" fill="#5b3a1f"/>
  ${tierP(22,26,-4,K.treeD,K.treeM)}${tierP(17,24,-18,'#37803a',K.treeL)}${tierP(11,23,-32,'#39863d','#7fcc6a')}
  <circle cx="3" cy="-46" r="2.4" fill="#cdf0b3" opacity=".7"/></g>`;
const bush=s=>`<g transform="scale(${s})">
  <ellipse cx="-6" cy="4" rx="16" ry="6" fill="#0a1a0e" opacity=".22"/>
  <rect x="-3" y="-6" width="6" height="12" rx="2" fill="#5b3a1f"/>
  <circle cx="-5" cy="-12" r="10" fill="${K.treeD}"/><circle cx="0" cy="-15" r="11" fill="${K.treeM}"/>
  <circle cx="6" cy="-17" r="8.5" fill="${K.treeL}"/><circle cx="9" cy="-20" r="3" fill="#cdf0b3" opacity=".6"/></g>`;

// red/white striped merchant tent with gold pennant
const tentK=s=>`<g transform="scale(${s})">
  <ellipse cx="-8" cy="8" rx="36" ry="11" fill="#0a1a0e" opacity=".25"/>
  <rect x="-30" y="-2" width="60" height="22" rx="3" fill="#7a4a2a"/>
  <rect x="-30" y="-2" width="14" height="22" fill="#000" opacity=".18"/>
  <clipPath id="troof"><path d="M0 -42 L36 -2 L-36 -2 Z"/></clipPath>
  <g clip-path="url(#troof)">
    <rect x="-36" y="-44" width="72" height="44" fill="${K.red}"/>
    ${[-30,-18,-6,6,18,30].map(x=>`<rect x="${x-3.2}" y="-44" width="6.4" height="44" fill="#f4efe4"/>`).join('')}
    <path d="M0 -42 L-36 -2 L0 -2 Z" fill="#000" opacity=".2"/></g>
  <path d="M0 -42 L36 -2 L-36 -2 Z" fill="none" stroke="#8d2f22" stroke-width="1.5"/>
  <rect x="-13" y="2" width="26" height="18" rx="1.5" fill="#241307"/>
  <rect x="-1.6" y="-60" width="3.2" height="20" fill="#6b4a2a"/>
  <path d="M1.6 -60 l18 5 l-18 5 Z" fill="${C.gold}"/></g>`;

// hero adventurer with raised sword
const heroK=s=>`<g transform="scale(${s})">
  <ellipse cx="-5" cy="6" rx="13" ry="5" fill="#0a1a0e" opacity=".25"/>
  <g transform="rotate(18 11 -20)"><rect x="9.5" y="-40" width="3.2" height="26" rx="1.6" fill="#e6edf3"/><rect x="8" y="-40" width="1.4" height="26" fill="#aab8c4"/></g>
  <rect x="-8" y="-13" width="16" height="17" rx="3.5" fill="${C.body}"/>
  <rect x="3" y="-13" width="5" height="17" rx="2.5" fill="#2c557f"/>
  <rect x="-8" y="-5" width="16" height="3.5" fill="${C.gold}"/>
  <circle cx="0" cy="-19" r="7.2" fill="${C.skin}"/>
  <path d="M-7.2 -20 a7.2 7 0 0 1 14.4 0 Z" fill="#5a3a22"/>
  <rect x="6" y="-12" width="8" height="3.2" rx="1.6" fill="#8a6a3a"/></g>`;

// gold coins (stack on land + loose floating coin)
const coinStack=s=>`<g transform="scale(${s})">
  <ellipse cx="0" cy="7" rx="16" ry="6" fill="#0a1a0e" opacity=".22"/>
  ${[0,1,2,3].map(i=>`<ellipse cx="0" cy="${-i*6}" rx="13" ry="6.5" fill="${i%2?'#e7bd44':C.gold}" stroke="#9a7320" stroke-width="1"/>`).join('')}
  <ellipse cx="-3.5" cy="-21" rx="4.5" ry="2.2" fill="#fff" opacity=".6"/></g>`;
const coin=s=>`<g transform="scale(${s})"><circle r="9" fill="${C.goldD}"/><circle cy="-1.4" r="9" fill="${C.gold}"/>
  <circle cy="-1.4" r="5.6" fill="none" stroke="#caa12f" stroke-width="1.3"/>
  <ellipse cx="-3" cy="-4.5" rx="3" ry="2.2" fill="#fff" opacity=".55"/></g>`;
const spark=(x,y,r,o=.92)=>`<path transform="translate(${x} ${y})" d="M0 ${-r} L${r*.2} ${-r*.2} L${r} 0 L${r*.2} ${r*.2} L0 ${r} L${-r*.2} ${r*.2} L${-r} 0 L${-r*.2} ${-r*.2} Z" fill="#fff6cf" opacity="${o}"/>`;
const bird=(x,y,s=1)=>`<path transform="translate(${x} ${y}) scale(${s})" d="M-9 0 Q-4 -6 0 -1 Q4 -6 9 0" fill="none" stroke="#15323d" stroke-width="2" stroke-linecap="round" opacity=".55"/>`;

// faint distant Warlord boss silhouette (horns, pauldrons, axe, glowing red eyes)
const boss=(x,y,s,op=.2)=>`<g transform="translate(${x} ${y}) scale(${s})" opacity="${op}" filter="url(#haze)">
  <g fill="#0b1620">
    <path d="M-24 64 L-32 8 Q-40 -12 -20 -16 L20 -16 Q40 -12 32 8 L24 64 L10 64 L7 26 L-7 26 L-10 64 Z"/>
    <path d="M-28 -12 L-48 -4 L-40 -24 Z"/><path d="M28 -12 L48 -4 L40 -24 Z"/>
    <rect x="-13" y="-42" width="26" height="28" rx="7"/>
    <path d="M-13 -38 L-24 -58 L-5 -42 Z"/><path d="M13 -38 L24 -58 L5 -42 Z"/>
    <rect x="44" y="-34" width="6" height="98" rx="3"/><path d="M44 -34 q44 8 30 46 L44 8 Z"/></g>
  <circle cx="-6" cy="-28" r="2.8" fill="#ff5a44"/><circle cx="6" cy="-28" r="2.8" fill="#ff5a44"/></g>`;

// glowing golden dashed land-claim plot (isometric tile region) with corner posts
const plotIso=(gx,gy,n)=>{const A=iso(gx,gy),B=iso(gx+n,gy),Cc=iso(gx+n,gy+n),D=iso(gx,gy+n);
  const posts=[A,B,Cc,D].map(p=>`<rect x="${(p[0]-2).toFixed(1)}" y="${(p[1]-11).toFixed(1)}" width="4" height="12" rx="1.5" fill="${C.gold}"/><circle cx="${p[0].toFixed(1)}" cy="${(p[1]-12).toFixed(1)}" r="2.6" fill="#fff3bf"/>`).join('');
  return `<g filter="url(#glow)"><polygon points="${PTS([A,B,Cc,D])}" fill="${C.gold}" opacity=".13"/>
    <polygon points="${PTS([A,B,Cc,D])}" fill="none" stroke="${C.gold}" stroke-width="3" stroke-dasharray="13 9" stroke-linejoin="round"/></g>${posts}`;};

// the floating isometric island: water cast shadow, extruded rock sides, beach rim, lit grass top
function islandK(){
  const D=62, T=84;
  const Wd=[WW[0],WW[1]+D], Sd=[SS[0],SS[1]+D], Ed=[EE[0],EE[1]+D], apex=[SS[0],SS[1]+D+T];
  const [gN,gE,gS,gW]=[lerp(CB,NN,.86),lerp(CB,EE,.86),lerp(CB,SS,.86),lerp(CB,WW,.86)];
  const patches=[[2,2.6,30,13],[5.5,4,34,15],[3.4,5.6,26,11]].map(([gx,gy,rx,ry])=>{const p=iso(gx,gy);
    return `<ellipse cx="${p[0]}" cy="${p[1]}" rx="${rx}" ry="${ry}" fill="#3a7a3b" opacity=".4"/>`;}).join('');
  return `
    <ellipse cx="${CB[0]-22}" cy="${apex[1]-18}" rx="430" ry="92" fill="#0f0b1a" opacity=".55" filter="url(#soft)"/>
    <polygon points="${PTS([Wd,Sd,apex])}" fill="${K.rockX}"/><polygon points="${PTS([Sd,Ed,apex])}" fill="${K.rockD}"/>
    <polygon points="${PTS([WW,SS,Sd,Wd])}" fill="url(#wallL)"/><polygon points="${PTS([SS,EE,Ed,Sd])}" fill="url(#wallR)"/>
    <polyline points="${PTS([Sd,Ed])}" fill="none" stroke="#ab7bff" stroke-width="2" opacity=".4"/>
    <polygon points="${PTS([NN,EE,SS,WW])}" fill="${C.sand}"/>
    <polygon points="${PTS([NN,EE,SS,WW])}" fill="#fff" opacity=".06"/>
    <polygon points="${PTS([gN,gE,gS,gW])}" fill="url(#grassG)"/>
    ${patches}
    <polyline points="${PTS([WW,NN,EE])}" fill="none" stroke="#ffe6a6" stroke-width="3" opacity=".5"/>
    <polyline points="${PTS([EE,SS])}" fill="none" stroke="#ffdf9c" stroke-width="2.5" opacity=".35"/>
    <polyline points="${PTS([gW,gN,gE])}" fill="none" stroke="#bfe89a" stroke-width="2" opacity=".4"/>`;
}
// tiny faint island on the horizon for depth
const miniIsle=(x,y,s)=>`<g transform="translate(${x} ${y}) scale(${s})" opacity=".5">
  <ellipse cx="0" cy="40" rx="120" ry="26" fill="#0f0b1a" opacity=".4" filter="url(#soft)"/>
  <polygon points="0,-30 90,15 0,60 -90,15" fill="${C.sand}"/><polygon points="0,-30 90,15 0,30 -90,15" fill="#57a95d"/>
  <polygon points="-90,15 0,60 0,30" fill="#1a1428"/><polygon points="0,60 90,15 0,30" fill="#2b2140"/>
  ${[[-30,6],[20,2],[-4,16]].map(([a,b])=>`<g transform="translate(${a} ${b})">${pine(0.8)}</g>`).join('')}</g>`;

// heraldic castle crest medallion (gold-ringed purple badge) + 3D extruded gold wordmark
const crest=(cx,cy,r)=>`<g filter="url(#ds)">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#2d2342" stroke="url(#goldG)" stroke-width="${r*0.13}"/>
  <circle cx="${cx}" cy="${cy}" r="${r*0.7}" fill="#1e1830"/>
  ${peak(cx, cy+6, r/74)}</g>`;
const wordmark3d=(cx,y,size)=>{
  let depth=''; for(let i=9;i>=1;i--) depth+=`<text x="${cx+i*0.9}" y="${y+i}" text-anchor="middle" font-family=${JSON.stringify(F)} font-weight="bold" font-size="${size}" letter-spacing="${size*0.01}" fill="#6e4f12">RUNELANDS</text>`;
  return `${depth}
    <text x="${cx}" y="${y}" text-anchor="middle" font-family=${JSON.stringify(F)} font-weight="bold" font-size="${size}" letter-spacing="${size*0.01}" fill="url(#goldG)">RUNELANDS</text>
    <text x="${cx-1}" y="${y-size*0.045}" text-anchor="middle" font-family=${JSON.stringify(F)} font-weight="bold" font-size="${size}" letter-spacing="${size*0.01}" fill="#fff7d6" opacity=".28">RUNELANDS</text>`;
};
const ctaBtn=(cx,y,w,h,label)=>{const x=cx-w/2;return `<g filter="url(#ds)">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h/2}" fill="url(#ctaG)" stroke="#fff3c4" stroke-width="2"/>
  <rect x="${x+7}" y="${y+5}" width="${w-14}" height="${h*0.4}" rx="${h*0.2}" fill="#fff" opacity=".25"/>
  <g transform="translate(${x+h*0.62} ${y+h/2})"><circle r="${h*0.3}" fill="#15202b"/><path d="M${-h*0.1} ${-h*0.16} L${h*0.18} 0 L${-h*0.1} ${h*0.16} Z" fill="${C.gold}"/></g>
  <text x="${cx+h*0.42}" y="${y+h*0.64}" text-anchor="middle" font-family=${JSON.stringify(F)} font-weight="bold" font-size="${h*0.4}" fill="#15202b">${label}</text></g>`;};

const kdefs=`<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#15111f"/><stop offset=".46" stop-color="#2d2342"/><stop offset="1" stop-color="#1e1830"/></linearGradient>
  <radialGradient id="sun" cx="80%" cy="16%" r="60%"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".9"/><stop offset="30%" stop-color="#ab7bff" stop-opacity=".42"/><stop offset="100%" stop-color="#7a3df0" stop-opacity="0"/></radialGradient>
  <linearGradient id="refl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ab7bff" stop-opacity="0"/><stop offset=".5" stop-color="#ffe9a8" stop-opacity=".22"/><stop offset="1" stop-color="#ab7bff" stop-opacity="0"/></linearGradient>
  <linearGradient id="grassG" gradientUnits="userSpaceOnUse" x1="${EE[0]}" y1="${EE[1]}" x2="${WW[0]}" y2="${WW[1]}"><stop offset="0" stop-color="#57a95d"/><stop offset="1" stop-color="#3c7a3c"/></linearGradient>
  <linearGradient id="wallR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a3e6b"/><stop offset="1" stop-color="#1e1830"/></linearGradient>
  <linearGradient id="wallL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2140"/><stop offset="1" stop-color="#120d1c"/></linearGradient>
  <linearGradient id="goldG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset=".5" stop-color="#f0c64a"/><stop offset="1" stop-color="#b8902a"/></linearGradient>
  <radialGradient id="ctaG" cx="50%" cy="28%" r="85%"><stop offset="0" stop-color="#ffe9a8"/><stop offset=".6" stop-color="#f0c64a"/><stop offset="1" stop-color="#b8902a"/></radialGradient>
  <linearGradient id="scrimT" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#06151d" stop-opacity=".62"/><stop offset="1" stop-color="#06151d" stop-opacity="0"/></linearGradient>
  <linearGradient id="scrimB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#06151d" stop-opacity="0"/><stop offset="1" stop-color="#06151d" stop-opacity=".66"/></linearGradient>
  <radialGradient id="vig" cx="50%" cy="44%" r="74%"><stop offset="58%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#04121a" stop-opacity=".55"/></radialGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="16"/></filter>
  <filter id="haze" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.4"/></filter>
  <filter id="ds" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000" flood-opacity=".5"/></filter>
</defs>`;

// scene props placed in iso grid, painter-sorted by screen Y so overlaps read correctly
const propList=[
  ['tent',1.9,1.9,1.5],['hero',3.7,5.5,1.45],['coinStack',6.1,5.4,1.0],
  ['pine',0.8,3.7,1.2],['pine',0.7,5.9,1.25],['pine',6.6,0.9,1.05],['pine',7.2,2.7,1.1],
  ['pine',5.7,1.6,1.05],['pine',4.5,6.9,1.2],['pine',1.7,6.9,1.2],['pine',7.0,4.4,1.1],
  ['pine',3.1,0.7,1.0],['pine',2.6,5.1,1.1],['bush',4.1,3.0,1.1],['bush',5.5,6.2,1.0],
  ['bush',2.3,4.3,1.05],['bush',1.4,2.8,1.0],['coin',6.7,3.0,1.0],['coin',2.9,3.5,1.0],
];
const mk={tent:tentK,hero:heroK,coinStack,pine,bush,coin};
const propsSvg=propList.map(([k,gx,gy,s])=>{const p=iso(gx,gy);return {y:p[1],s:`<g transform="translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})">${mk[k](s)}</g>`};})
  .sort((a,b)=>a.y-b.y).map(o=>o.s).join('');
const plots = plotIso(0.8,0.8,2.3)+plotIso(4.8,0.9,2.1)+plotIso(2.9,4.6,2.4)+plotIso(5.5,4.8,1.8);
const fcoins=[[742,486,1.05],[806,452,0.85],[1196,486,0.95],[700,560,0.8],[1250,548,0.85],[980,452,0.8]]
  .map(([x,y,s])=>`<g transform="translate(${x} ${y})">${coin(s)}</g>`).join('');
const sparks=[[742,452,11],[1212,452,10],[980,420,8],[648,540,7],[1296,536,9],[884,486,6],[1086,510,7],[560,470,6]]
  .map(([x,y,r])=>spark(x,y,r)).join('');
const birds=bird(1500,150,1.1)+bird(1545,178,0.9)+bird(1466,196,0.8)+bird(250,150,0.7);

const keyart = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">${kdefs}
  <rect width="1920" height="1080" fill="url(#sky)"/>
  <rect width="1920" height="1080" fill="url(#sun)"/>
  <rect x="1380" y="560" width="150" height="440" fill="url(#refl)" filter="url(#soft)"/>
  ${grid(1920,1080,64)}
  ${birds}
  ${boss(300,332,1.45)}
  ${miniIsle(255,470,0.62)}
  ${miniIsle(1700,560,0.46)}
  ${islandK()}
  ${plots}
  ${propsSvg}
  ${fcoins}${sparks}
  <rect width="1920" height="1080" fill="url(#vig)"/>
  <rect width="1920" height="320" fill="url(#scrimT)"/>
  <rect y="800" width="1920" height="280" fill="url(#scrimB)"/>
  <text x="960" y="72" text-anchor="middle" font-family=${JSON.stringify(F)} font-weight="bold" font-size="23" letter-spacing="9" fill="${C.gold}" opacity=".92">FREE BROWSER MMO · NO DOWNLOAD</text>
  ${crest(960,138,44)}
  ${wordmark3d(960,272,120)}
  <text x="960" y="330" text-anchor="middle" font-family=${JSON.stringify(F)} font-weight="bold" font-size="40" fill="${C.txt}" filter="url(#ds)">Build · Fight · Trade · <tspan fill="${C.gold}">Own Land</tspan></text>
  ${ctaBtn(960,978,560,80,'PLAY FREE — runelands.fun')}
  <rect x="22" y="22" width="1876" height="1036" rx="26" fill="none" stroke="url(#goldG)" stroke-width="2.5" opacity=".5"/>
</svg>`;

// ===================== THREAD BANNERS — 4 themed 16:9 cards (1600x900) =====================
// Reuse the diorama + components; each card reframes the same world for one thread beat.
const G=(x,y,s,inner)=>`<g transform="translate(${x} ${y}) scale(${s})">${inner}</g>`;
const place=(cx,cy,s,inner)=>`<g transform="translate(${(cx-980*s).toFixed(1)} ${(cy-560*s).toFixed(1)}) scale(${s})">${inner}</g>`;
const dioBase = islandK()+plots+propsSvg;
const dioCoins = fcoins+sparks;

// land-deed scroll (parchment + dashed mini-plot + wax seal)
const scroll=s=>`<g transform="scale(${s})" filter="url(#ds)">
  <rect x="-52" y="-34" width="12" height="72" rx="6" fill="#c8a058"/><rect x="40" y="-34" width="12" height="72" rx="6" fill="#c8a058"/>
  <rect x="-44" y="-30" width="88" height="62" rx="3" fill="#f0e3c0"/>
  <rect x="-18" y="-20" width="36" height="24" fill="none" stroke="${C.gold}" stroke-width="2.5" stroke-dasharray="6 4"/>
  <circle cx="0" cy="20" r="8.5" fill="${C.red}"/><circle cx="0" cy="20" r="8.5" fill="none" stroke="#8d2f22" stroke-width="1.5"/></g>`;

// small log pile (gather loop)
const logs=s=>`<g transform="scale(${s})">
  <ellipse cx="0" cy="8" rx="24" ry="7" fill="#0a1a0e" opacity=".22"/>
  <rect x="-22" y="-1" width="42" height="11" rx="5.5" fill="#7a5230"/><ellipse cx="-22" cy="4.5" rx="4" ry="5.5" fill="#caa46a"/><circle cx="-22" cy="4.5" r="2" fill="#7a5230"/>
  <rect x="-15" y="-11" width="42" height="11" rx="5.5" fill="#875d37"/><ellipse cx="-15" cy="-5.5" rx="4" ry="5.5" fill="#d8b277"/><circle cx="-15" cy="-5.5" r="2" fill="#875d37"/></g>`;

const xdefs=`<defs>
  <linearGradient id="bgDay" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2f54"/><stop offset=".46" stop-color="#2d2342"/><stop offset="1" stop-color="#1e1830"/></linearGradient>
  <linearGradient id="bgMap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d2342"/><stop offset="1" stop-color="#15111f"/></linearGradient>
  <linearGradient id="bgNight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c1620"/><stop offset=".5" stop-color="#3c1a22"/><stop offset="1" stop-color="#110910"/></linearGradient>
  <linearGradient id="bgEcon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#312257"/><stop offset=".5" stop-color="#221a44"/><stop offset="1" stop-color="#0f0b22"/></linearGradient>
  <radialGradient id="sunWarm" cx="78%" cy="16%" r="62%"><stop offset="0" stop-color="#fffaea" stop-opacity=".95"/><stop offset="34%" stop-color="#ffe2a0" stop-opacity=".5"/><stop offset="100%" stop-color="#ffe2a0" stop-opacity="0"/></radialGradient>
  <radialGradient id="goldGlow" cx="70%" cy="42%" r="62%"><stop offset="0" stop-color="#ffe7a4" stop-opacity=".45"/><stop offset="100%" stop-color="#ffe7a4" stop-opacity="0"/></radialGradient>
  <radialGradient id="redglow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ff3b2a" stop-opacity=".55"/><stop offset="100%" stop-color="#ff3b2a" stop-opacity="0"/></radialGradient>
  <linearGradient id="scrimL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#06121a" stop-opacity=".85"/><stop offset=".52" stop-color="#06121a" stop-opacity=".22"/><stop offset="1" stop-color="#06121a" stop-opacity="0"/></linearGradient>
  <linearGradient id="grassG2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#86cc72"/><stop offset="1" stop-color="#3c7a3c"/></linearGradient>
  <radialGradient id="icSea" cx="50%" cy="38%" r="80%"><stop offset="0" stop-color="#2d2342"/><stop offset="1" stop-color="#120d1c"/></radialGradient>
  <linearGradient id="mtnR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe79a"/><stop offset="1" stop-color="#e3b43c"/></linearGradient>
  <linearGradient id="mtnL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e0b950"/><stop offset="1" stop-color="#b0842a"/></linearGradient>
  <radialGradient id="icGold" cx="50%" cy="38%" r="82%"><stop offset="0" stop-color="#ffeab0"/><stop offset=".55" stop-color="#f3cc62"/><stop offset="1" stop-color="#d59f33"/></radialGradient>
  <radialGradient id="icNavy" cx="50%" cy="40%" r="82%"><stop offset="0" stop-color="#2d2342"/><stop offset="1" stop-color="#120d1c"/></radialGradient>
  <linearGradient id="mtnDeep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0c64a"/><stop offset="1" stop-color="#b8902a"/></linearGradient>
</defs>`;

const lockup=(x,y)=>`${crest(x+22,y-10,22)}
  <text x="${x+52}" y="${y}" font-family=${JSON.stringify(F)} font-weight="bold" font-size="34" fill="url(#goldG)">RUNELANDS</text>
  <text x="${x+54}" y="${y+25}" font-family=${JSON.stringify(F)} font-size="21" fill="${C.dim}">runelands.fun · free browser MMO</text>`;

function threadBanner(o){
  const tY=246, lh=88;
  const kicker=`<text x="76" y="156" font-family=${JSON.stringify(F)} font-weight="bold" font-size="25" letter-spacing="6" fill="${C.gold}">${o.kicker}</text>`;
  const title=o.lines.map((t,i)=>`<text x="74" y="${tY+i*lh}" font-family=${JSON.stringify(F)} font-weight="bold" font-size="76" fill="${C.txt}">${t}</text>`).join('');
  const sY=tY+(o.lines.length-1)*lh+72;
  const sub=o.sub.map((t,i)=>`<text x="76" y="${sY+i*40}" font-family=${JSON.stringify(F)} font-size="29" fill="${C.txt}">${t}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">${kdefs}${xdefs}
  <rect width="1600" height="900" fill="url(#${o.bg})"/>
  ${o.glow||''}
  ${grid(1600,900,60)}
  ${o.scene}
  <rect width="1600" height="900" fill="url(#vig)"/>
  <rect width="1600" height="900" fill="url(#scrimL)"/>
  <rect y="770" width="1600" height="130" fill="url(#scrimB)"/>
  ${kicker}${title}${sub}
  ${lockup(74,840)}
</svg>`;
}

// 1) BUILD — bright daytime, the cozy island diorama
const sceneBuild = place(1120,520,0.94, dioBase+G(902,616,1.0,logs(1.0))+dioCoins)
  + bird(1470,150,1.1)+bird(1516,178,0.9)+bird(300,156,0.8);

// 2) OWN LAND — dark slate ownership map: a grid of glowing claim-plots, some owned
function landMap(){
  const N=1.7, step=2.05, owned={'0-0':'tent','2-0':'pine','1-1':'coinStack','3-1':'pine','2-2':'tent','0-2':'coinStack','3-0':'bush'};
  let pl='', ct='';
  for(let a=0;a<4;a++)for(let b=0;b<3;b++){const gx=a*step, gy=b*step; pl+=plotIso(gx,gy,N);
    const c=owned[a+'-'+b]; if(c){const p=iso(gx+N/2,gy+N/2); ct+=G(p[0],p[1], c==='coinStack'?0.6:0.7, ({tent:tentK,pine,bush,coinStack})[c](1));}}
  return pl+ct;
}
const sceneLand = `<g transform="translate(120 -34) scale(1.04)">${landMap()}</g>`
  + G(1392,296,0.92,scroll(1)) + spark(1438,248,12)
  + `<text x="1392" y="366" text-anchor="middle" font-family=${JSON.stringify(F)} font-weight="bold" font-size="19" letter-spacing="1" fill="${C.gold}">LAND DEED</text>`
  + G(1304,470,0.66,coin(1)) + spark(900,468,9) + spark(1250,520,8);

// 3) WARLORD — night raid: a looming boss over a dark ridge, heroes rallying, embers
const embers=[[904,520,3],[1004,460,2],[1180,500,3],[1286,442,2.4],[1086,560,2.6],[1342,560,3],[860,600,2],[1392,486,2.6],[980,610,2.2],[1240,470,2]]
  .map(([x,y,r])=>`<circle cx="${x}" cy="${y}" r="${r}" fill="#ff7a3a" opacity=".7"/>`).join('');
const sceneBoss = `<ellipse cx="1110" cy="430" rx="480" ry="400" fill="url(#redglow)"/>`
  + boss(1110,470,3.6,0.92)
  + `<ellipse cx="1130" cy="868" rx="540" ry="120" fill="#0b0507"/>`
  + G(968,840,1.55,heroK(1)) + G(1290,856,1.4,heroK(1)) + embers;

// 4) ON-CHAIN ECONOMY — purple vault: a tower of coins, coin-rain, a floating claimed plot
const coinRain=[[862,182,.7],[946,150,.85],[1034,198,.7],[1124,158,.9],[1214,190,.75],[1304,160,.7],[1384,206,.64],
  [800,236,.6],[902,286,.7],[1186,300,.8],[1330,296,.7],[1420,256,.6],[1004,330,.64],[1258,360,.74],[1086,418,.68],[1340,430,.66],[940,404,.62]]
  .map(([x,y,s])=>G(x,y,s,coin(s))).join('');
const sceneEcon = `<ellipse cx="1150" cy="702" rx="320" ry="132" fill="url(#goldGlow)"/>`
  + `<g transform="translate(180 -16) scale(1.02)">${plotIso(0,0,1.7)}</g>`
  + coinRain
  + G(1052,716,2.1,coinStack(1)) + G(1248,716,2.1,coinStack(1)) + G(1100,700,2.0,coinStack(1))
  + G(1200,700,2.0,coinStack(1)) + G(1150,728,2.7,coinStack(1))
  + G(1150,560,1.6,coin(1)) + G(1024,654,1.0,coin(1)) + G(1278,650,1.0,coin(1))
  + spark(1392,250,13) + spark(980,250,10) + spark(1150,470,10) + spark(1292,560,8);

const t1=threadBanner({bg:'bgDay', glow:`<rect width="1600" height="900" fill="url(#sunWarm)"/>`,
  kicker:'GATHER · CRAFT · BUILD', lines:['BUILD YOUR', `<tspan fill="${C.gold}">REALM KEEP</tspan>`],
  sub:['Chop trees, farm, and sell wood to the Merchant.','Fight slimes for XP and level up — server-authoritative.'], scene:sceneBuild});
const t2=threadBanner({bg:'bgMap', glow:`<rect width="1600" height="900" fill="url(#goldGlow)"/>`,
  kicker:'CLAIM · PROTECT · EARN', lines:['CLAIM LAND', `<tspan fill="${C.gold}">THAT PAYS RENT</tspan>`],
  sub:['Spend a Land Deed to claim a plot. It is protected','and pays you rent every minute. Own more → earn more.'], scene:sceneLand});
const t3=threadBanner({bg:'bgNight', glow:'',
  kicker:'WORLD BOSS EVENT', lines:['HUNT THE', `<tspan fill="#ff7a4a">WARLORD</tspan>`],
  sub:['A roaming Warlord boss spawns every few minutes.','Huge HP, huge loot — rally players and take it down.'], scene:sceneBoss});
const t4=threadBanner({bg:'bgEcon', glow:`<rect width="1600" height="900" fill="url(#goldGlow)"/>`,
  kicker:'OWN-LAND ECONOMY', lines:['YOUR LAND,', `<tspan fill="${C.gold}">ON-CHAIN</tspan>`],
  sub:['An own-land economy. On-chain land (Solana/USDC) is','on the roadmap. Play free now — no wallet needed.'], scene:sceneEcon});

// ===================== PREMIUM X-HEADER (1500x500) =====================
// Left: gold castle crest + 3D wordmark + tagline. Right: the isometric realm diorama.
// Lower-left is kept clear for the circular profile avatar.
const header = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="500" viewBox="0 0 1500 500">${kdefs}${xdefs}
  <rect width="1500" height="500" fill="url(#sky)"/>
  <rect width="1500" height="500" fill="url(#sun)"/>
  ${grid(1500,500,60)}
  ${place(1158,250,0.52, dioBase+dioCoins)}
  <rect width="1500" height="500" fill="url(#vig)"/>
  <rect width="1500" height="500" fill="url(#scrimL)"/>
  ${crest(150,150,54)}
  ${wordmark3d(480,256,92)}
  <text x="480" y="320" text-anchor="middle" font-family=${JSON.stringify(F)} font-weight="bold" font-size="34" fill="${C.txt}">Build · Fight · Trade · <tspan fill="${C.gold}">Own Land</tspan></text>
  <text x="480" y="360" text-anchor="middle" font-family=${JSON.stringify(F)} font-size="23" fill="${C.dim}">A free browser fantasy realm MMO — play free, no download · runelands.fun</text>
</svg>`;

// ===================== PREMIUM LOGO / APP ICON (1:1) =====================
// Gold castle/keep emblem on a dark purple badge over a tiny floating claimed island.
// deep-gold keep emblem — battlemented towers + bronze outline (reads on the gold background)
const emblem=(x,y,s)=>`<g transform="translate(${x} ${y}) scale(${s})">
  <ellipse cx="0" cy="27" rx="42" ry="9" fill="#1a1226" opacity=".25"/>
  <path d="M-34 24 L-34 -8 L-34 -14 L-27 -14 L-27 -8 L-20 -8 L-20 24 Z M20 24 L20 -8 L20 -14 L27 -14 L27 -8 L34 -8 L34 24 Z" fill="url(#mtnDeep)" stroke="#5e3f12" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M-16 24 L-16 -22 L-9 -22 L-9 -28 L-3 -28 L-3 -22 L3 -22 L3 -28 L9 -28 L9 -22 L16 -22 L16 24 Z" fill="url(#mtnDeep)" stroke="#5e3f12" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M-7 24 L-7 2 Q0 -6 7 2 L7 24 Z" fill="#5e3f12"/></g>`;

// icon scene: gold keep rising from a small isometric claimed island (no glow, no white)
const iconScene=()=>{const cx=200,cy=250,hw=158,hh=79,D=46,T=58,gi=0.82,
  N=[cx,cy-hh],E=[cx+hw,cy],S=[cx,cy+hh],W=[cx-hw,cy],g=p=>[cx+(p[0]-cx)*gi,cy+(p[1]-cy)*gi],
  [gN,gE,gS,gW]=[g(N),g(E),g(S),g(W)],Wd=[W[0],W[1]+D],Sd=[S[0],S[1]+D],Ed=[E[0],E[1]+D],ap=[cx,S[1]+D+T];
  return `<ellipse cx="${cx}" cy="${(ap[1]-10).toFixed(1)}" rx="${hw}" ry="${(hw*0.24).toFixed(1)}" fill="#3a2a08" opacity=".28" filter="url(#soft)"/>
   <polygon points="${PTS([Wd,Sd,ap])}" fill="${K.rockX}"/><polygon points="${PTS([Sd,Ed,ap])}" fill="${K.rockD}"/>
   <polygon points="${PTS([W,S,Sd,Wd])}" fill="url(#wallL)"/><polygon points="${PTS([S,E,Ed,Sd])}" fill="url(#wallR)"/>
   <polygon points="${PTS([N,E,S,W])}" fill="${C.sand}"/><polygon points="${PTS([gN,gE,gS,gW])}" fill="url(#grassG2)"/>
   <polyline points="${PTS([W,N,E])}" fill="none" stroke="#eaf6d8" stroke-width="2" opacity=".35"/>
   <g transform="translate(${cx-50} ${cy+30})"><polygon points="-30,-9 0,-24 30,-9 0,6" fill="#2f6f31" opacity=".55"/><polygon points="-30,-9 0,-24 30,-9 0,6" fill="none" stroke="#3a2a08" stroke-width="2.6" stroke-dasharray="8 6"/></g>
   <g transform="translate(${cx-92} ${cy})">${pine(0.78)}</g>
   <g transform="translate(${cx+86} ${cy+20})">${pine(0.8)}</g>
   ${emblem(cx+4, cy-4, 2.0)}`;};

// Logo = the header's gold castle crest, enlarged as a medallion on a deep-purple field.
const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">${kdefs}${xdefs}
  <rect width="400" height="400" fill="url(#icNavy)"/>
  ${crest(200,202,158)}
</svg>`;

function render(name, svg, scale=2){
  fs.writeFileSync(path.join(OUT, name+'.svg'), svg);
  const r = new Resvg(svg, { fitTo:{ mode:'zoom', value:scale }, font:{ loadSystemFonts:true } });
  fs.writeFileSync(path.join(OUT, name+'.png'), r.render().asPng());
  const m = svg.match(/width="(\d+)" height="(\d+)"/);
  console.log(`✓ ${name}.png  (${m[1]*scale}x${m[2]*scale})  + ${name}.svg`);
}
render('keyart', keyart, 1);
render('thread-1-build', t1, 1.25);
render('thread-2-land', t2, 1.25);
render('thread-3-warlord', t3, 1.25);
render('thread-4-economy', t4, 1.25);
render('tweet-banner', banner);
render('x-header', header);
render('logo', logo, 2.56);
render('favicon', logo, 0.64);          // 256x256 — browser tab icon
render('apple-touch-icon', logo, 0.45); // 180x180 — iOS home-screen icon
console.log('done → marketing/');
