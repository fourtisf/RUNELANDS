// Shared test harness for RUNELANDS: deterministic map gen (to locate tiles),
// a tiny ws bot client, server process control, and assertion helpers.
// Used by integration.js (economy/combat) and persistence.js.
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const TILE = 40, W = 128, H = 96;
const T = { WATER:0, SHALLOW:1, SAND:2, GRASS:3, FOREST:4, STONE:5, FLOWER:6 };

// ---- replicate server/client map gen so tests can find tiles deterministically ----
function seed(x,y){let n=x*374761393+y*668265263;n=(n^(n>>>13))>>>0;n=Math.imul(n,1274126177)>>>0;n=(n^(n>>>16))>>>0;return n/4294967296;}
function noise(x,y,s){return seed(Math.floor(x*s),Math.floor(y*s));}
const map=[];
(function gen(){const cx=W/2,cy=H/2;
  function pondAt(x,y){const P=[[50,38,5],[80,40,5],[80,58,5],[48,60,5],[64,68,4],[64,30,4]]; // several big inland fishing ponds
    for(let i=0;i<P.length;i++){const d=Math.hypot(x-P[i][0],y-P[i][1]);if(d<P[i][2]-0.7)return 2;if(d<P[i][2]+0.5)return 1;if(d<P[i][2]+5)return 3;}return 0;}
  for(let y=0;y<H;y++){map[y]=[];for(let x=0;x<W;x++){
    const dx=(x-cx)/(W*0.44),dy=(y-cy)/(H*0.44),d=Math.sqrt(dx*dx+dy*dy);
    const n=noise(x,y,0.18)*0.30+noise(x,y,0.5)*0.16+noise(x,y,0.9)*0.07;
    const land=d-n-0.10;let t;
    if(land>0.62)t=T.WATER;else if(land>0.50)t=T.SHALLOW;else if(land>0.40)t=T.SAND;
    else{t=T.GRASS;const ff=seed(x,y)*0.45+noise(x,y,0.30)*0.55,sf=noise(x,y,0.16);
      if(sf>0.86)t=T.STONE;else if(ff>0.62)t=T.FOREST;else if(seed(x+31,y+11)>0.90)t=T.FLOWER;}
    const pv=pondAt(x,y);if(pv===2)t=T.WATER;else if(pv===1&&t!==T.WATER)t=T.SHALLOW;else if(pv===3&&(t===T.FOREST||t===T.STONE||t===T.FLOWER))t=T.GRASS; // clear the pond shore (no trees/rocks)
    map[y][x]=t;}}
  for(let y=cy-2;y<=cy+2;y++)for(let x=cx-2;x<=cx+2;x++)if(map[y][x]===T.FOREST||map[y][x]===T.STONE)map[y][x]=T.GRASS;
})();
const tileAt=(x,y)=>(x<0||y<0||x>=W||y>=H)?T.WATER:map[y][x];
const walkableTile=(x,y)=>{const t=tileAt(x,y);return t!==T.WATER&&t!==T.SHALLOW&&t!==T.STONE;};
const center=(tx,ty)=>({x:(tx+0.5)*TILE,y:(ty+0.5)*TILE});

// a standing tile next to a tree, plus two adjacent grass tiles for build/farm
// Tiles NEAREST the spawn (map center) so bots have short, clear (land) paths to walk —
// important now that the server clamps movement speed (no teleporting via a single input).
function findTiles(){
  const cx=Math.floor(W/2), cy=Math.floor(H/2), N=[[1,0],[-1,0],[0,1],[0,-1]];
  const cand=[]; for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++)cand.push({x,y,d:(x-cx)*(x-cx)+(y-cy)*(y-cy)});
  cand.sort((a,b)=>a.d-b.d);
  let tree=null,treeStand=null,grassStand=null,grassBuild=null;
  for(const c of cand){const {x,y}=c;
    if(!tree && tileAt(x,y)===T.FOREST){for(const [dx,dy] of N) if(tileAt(x+dx,y+dy)===T.GRASS){tree={x,y};treeStand={x:x+dx,y:y+dy};break;}}
    if(!grassStand && tileAt(x,y)===T.GRASS){for(const [dx,dy] of N) if(tileAt(x+dx,y+dy)===T.GRASS && !(tree&&x+dx===tree.x&&y+dy===tree.y)){grassStand={x,y};grassBuild={x:x+dx,y:y+dy};break;}}
    if(tree&&grassStand)break;
  }
  if(!tree||!grassStand)throw new Error('test setup: could not locate required tiles');
  return {tree,treeStand,grassStand,grassBuild};
}

// a STONE tile nearest the spawn with an adjacent walkable tile to stand on while mining
function findStone(){
  const cx=Math.floor(W/2), cy=Math.floor(H/2), N=[[1,0],[-1,0],[0,1],[0,-1]];
  const cand=[]; for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++)if(tileAt(x,y)===T.STONE)cand.push({x,y,d:(x-cx)*(x-cx)+(y-cy)*(y-cy)});
  cand.sort((a,b)=>a.d-b.d);
  for(const c of cand){ for(const [dx,dy] of N) if(walkableTile(c.x+dx,c.y+dy)) return { stone:{x:c.x,y:c.y}, stand:{x:c.x+dx,y:c.y+dy} }; }
  throw new Error('test setup: no stone tile with an adjacent walkable neighbour');
}

// a WATER/SHALLOW tile nearest the spawn with an adjacent walkable tile to fish from
function findWater(){
  const cx=Math.floor(W/2), cy=Math.floor(H/2), N=[[1,0],[-1,0],[0,1],[0,-1]];
  const cand=[]; for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){const t=tileAt(x,y); if(t===T.WATER||t===T.SHALLOW)cand.push({x,y,d:(x-cx)*(x-cx)+(y-cy)*(y-cy)});}
  cand.sort((a,b)=>a.d-b.d);
  for(const c of cand){ for(const [dx,dy] of N) if(walkableTile(c.x+dx,c.y+dy)) return { water:{x:c.x,y:c.y}, stand:{x:c.x+dx,y:c.y+dy} }; }
  throw new Error('test setup: no water tile with an adjacent walkable neighbour');
}

// BFS a 4-connected walkable-tile path from `from` to `to`; returns waypoints (excluding start) or null
function pathTiles(from, to){
  const kk=(x,y)=>x+','+y, N=[[1,0],[-1,0],[0,1],[0,-1]];
  const prev=new Map(); prev.set(kk(from.x,from.y), null); const q=[from];
  while(q.length){ const c=q.shift(); if(c.x===to.x&&c.y===to.y) break;
    for(const [dx,dy] of N){ const nx=c.x+dx, ny=c.y+dy, k=kk(nx,ny);
      if(nx<0||ny<0||nx>=W||ny>=H||prev.has(k)||!walkableTile(nx,ny)) continue;
      prev.set(k,c); q.push({x:nx,y:ny}); } }
  if(!prev.has(kk(to.x,to.y))) return null;
  const path=[]; for(let cur={x:to.x,y:to.y}; cur; cur=prev.get(kk(cur.x,cur.y))) path.push(cur);
  return path.reverse().slice(1);
}
// walk a bot along a tile path (each hop is short, so the speed-clamp can't stall it)
async function walkPath(bot, path){ for(const w of path) await bot.moveTo(w.x, w.y, 4000); }

// ---- tiny bot client ----
class Bot{
  constructor(name,url){this.name=name;this.url=url;this.self=null;this.state=null;this.initMsg=null;this.events=[];this.waiters=[];}
  connect(extra){return new Promise((res,rej)=>{this.ws=new WebSocket(this.url);
    this.ws.on('open',()=>this.ws.send(JSON.stringify({t:'join',name:this.name,...(extra||{})})));
    this.ws.on('message',b=>{const m=JSON.parse(b);this._route(m);if(m.t==='init'){this.id=m.id;this.self=m.self;this.initMsg=m;res(m);}});
    this.ws.on('error',rej);});}
  _route(m){
    if(m.t==='self')this.self=m;
    if(m.t==='state')this.state=m;
    this.events.push(m);
    for(let i=this.waiters.length-1;i>=0;i--){if(this.waiters[i].pred(m)){this.waiters[i].res(m);this.waiters.splice(i,1);}}
  }
  send(o){this.ws.send(JSON.stringify(o));}
  // Walk to a tile by sending stepped inputs (the server clamps speed, so we can't teleport).
  // Resolves when the bot's server-reported position is on the tile (or after maxMs).
  async moveTo(tx,ty,maxMs=9000){const c=center(tx,ty),t0=Date.now();
    while(Date.now()-t0<maxMs){
      const me=this.state&&this.state.players&&this.state.players.find(p=>p.id===this.id);
      if(me && Math.hypot(me.x-c.x,me.y-c.y)<TILE*0.6) return;
      this.send({t:'input',x:Math.round(c.x),y:Math.round(c.y),dir:0});
      await sleep(70);
    }
  }
  waitFor(pred,ms=4000,label='event'){return new Promise((res,rej)=>{
    const w={pred,res};this.waiters.push(w);
    setTimeout(()=>{const i=this.waiters.indexOf(w);if(i>=0){this.waiters.splice(i,1);rej(new Error('timeout waiting for '+label));}},ms);});}
  // poll a condition against the bot's *current* state (self/state) — immune to the
  // race where a message arrives between awaiting one event and registering the next waiter
  async waitUntil(fn,ms=4000,label='condition'){const t0=Date.now();
    while(Date.now()-t0<ms){ if(fn(this)) return; await sleep(30); }
    throw new Error('timeout waiting for '+label);}
  close(){try{this.ws.close();}catch(e){}}
}

// ---- assertions ----
let passed=0;
function ok(cond,msg){if(!cond)throw new Error('FAIL: '+msg);passed++;console.log('  ✓ '+msg);}
function passCount(){return passed;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// re-issue chop intents until the tree regrows and the bot's wood reaches `target`
async function chopUntilWood(bot,target,tree){
  for(let i=0;i<60;i++){ if(bot.self.wood>=target) return;
    bot.send({t:'edit',kind:'chop',x:tree.x,y:tree.y}); await sleep(120); }
  throw new Error('could not reach wood>='+target+' (have '+bot.self.wood+')');
}

// Pursue enemies (movement is server speed-clamped) until `until(bot)` is true. Locks one
// target until it dies; if it can't be approached for a while (e.g. across water) it's
// blacklisted and we move on. With attack:true it also swings at the target (to kill it).
async function huntEnemy(bot, opts={}){
  const { attack=false, type=null, until, ms=24000 } = opts;
  const blacklist=new Set(); let targetId=null, lastDist=1e9, stall=0; const t0=Date.now();
  const mine=()=> bot.state && bot.state.players && bot.state.players.find(p=>p.id===bot.id);
  while(Date.now()-t0<ms){
    if(until(bot)) return true;
    const me=mine(), st=bot.state;
    if(me && st && st.slimes && st.slimes.length){
      let target = targetId!=null ? st.slimes.find(s=>s.id===targetId && !blacklist.has(s.id)) : null;
      if(!target){ let pool=st.slimes.filter(s=>!blacklist.has(s.id) && (!type||s.type===type));
        if(!pool.length){ blacklist.clear(); pool=st.slimes.filter(s=>!type||s.type===type); }
        let nd=1e9; for(const s of pool){ const d=Math.hypot(s.x-me.x,s.y-me.y); if(d<nd){nd=d;target=s;} }
        targetId=target?target.id:null; lastDist=1e9; stall=0; }
      if(target){ const nd=Math.hypot(target.x-me.x,target.y-me.y);
        if(nd<lastDist-2){ lastDist=nd; stall=0; } else if(++stall>22){ blacklist.add(targetId); targetId=null; stall=0; }
        const tx=Math.floor(target.x/TILE), ty=Math.floor(target.y/TILE);
        if(walkableTile(tx,ty)) bot.send({t:'input',x:target.x,y:target.y,dir:0});
        if(attack) bot.send({t:'attack',id:target.id});
      }
    }
    await sleep(70);
  }
  return false;
}

// ---- server process control ----
const servers=[];
function startServer({port,dataDir,env={}}){
  const child=spawn('node',[path.join(__dirname,'..','server.js')],
    {env:{...process.env,PORT:String(port),FARM_GROW_MS:'400',TREE_REGROW_MS:'800',NOBUILD_TILES:'0',WALLET_REQUIRED:'0',DATA_DIR:dataDir,DATABASE_URL:'',...env},
     stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',()=>{});child.stderr.on('data',d=>process.stderr.write('[server] '+d));
  servers.push(child);
  return child;
}
function killServers(){for(const c of servers){try{c.kill();}catch(e){}}servers.length=0;}
process.on('exit',killServers);
process.on('SIGINT',()=>process.exit(1));
async function waitHealthy(url){for(let i=0;i<60;i++){try{await new Promise((res,rej)=>{const w=new WebSocket(url);w.on('open',()=>{w.close();res();});w.on('error',rej);});return;}catch(e){await sleep(100);}}throw new Error('server did not start: '+url);}

module.exports = { TILE, W, H, T, map, tileAt, walkableTile, center, findTiles, findStone, findWater, pathTiles, walkPath, Bot, ok, passCount, sleep, chopUntilWood, huntEnemy, startServer, killServers, waitHealthy };
