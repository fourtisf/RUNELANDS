// Plotlands — load test (the "simulate 50+ bots before launch" the docs insist on).
// Spins up a real server, connects N bot clients that move around like players, and measures
// the things that decide whether one process is enough: broadcast rate, latency, bandwidth, RSS.
//
//   node test/loadtest.js [bots=50] [seconds=8]   (or: npm run loadtest)
//
// Exits non-zero if the server can't keep a healthy tick rate under load, so it's CI-usable.
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { TILE, W, H, tileAt, T, startServer, waitHealthy, sleep } = require('./harness');

const N = parseInt(process.argv[2] || process.env.BOTS || '50', 10);
const SECONDS = parseInt(process.argv[3] || process.env.SECONDS || '8', 10);
const PORT = 2605, URL = 'ws://localhost:' + PORT;

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a,b)=>a-b); return s[Math.min(s.length-1, Math.floor(p/100*s.length))]; };
const rssMB = pid => { try { const m = fs.readFileSync('/proc/'+pid+'/status','utf8').match(/VmRSS:\s+(\d+)/); return m ? Math.round(+m[1]/1024) : null; } catch(e){ return null; } };

// a load bot: joins, then random-walks (sending input ~12/s) and pings via chat once/sec
class LoadBot {
  constructor(i){ this.i=i; this.connected=false; this.states=0; this.bytes=0; this.rtts=[]; this.x=0; this.y=0; this.dir=0; }
  start(){ return new Promise(res=>{
    this.ws = new WebSocket(URL);
    this.ws.on('message', buf => {
      this.bytes += buf.length;
      let m; try{ m=JSON.parse(buf); }catch{ return; }
      if (m.t==='init'){ this.id=m.id; this.x=m.self.tp?m.self.tp.x:1280; this.y=m.self.tp?m.self.tp.y:960; this.connected=true; res(); }
      else if (m.t==='state'){ this.states++; }
      else if (m.t==='chat' && m.id===this.id){ const t0=+String(m.msg).split(':')[1]; if(t0) this.rtts.push(Date.now()-t0); }
    });
    this.ws.on('open', ()=> this.ws.send(JSON.stringify({t:'join', name:'Bot'+this.i, guest:'load-'+this.i})));
    this.ws.on('error', ()=> res()); // count as not-connected
  }); }
  tickMove(){ if(!this.connected) return;
    // random short step, staying on walkable land
    const ang=Math.random()*7, nx=this.x+Math.cos(ang)*8, ny=this.y+Math.sin(ang)*8;
    const t=tileAt(Math.floor(nx/TILE),Math.floor(ny/TILE));
    if(t!==T.WATER&&t!==T.SHALLOW&&t!==T.STONE){ this.x=nx; this.y=ny; }
    this.dir=Math.floor(Math.random()*4);
    this.send({t:'input', x:Math.round(this.x), y:Math.round(this.y), dir:this.dir});
  }
  ping(){ if(this.connected) this.send({t:'chat', msg:'p:'+Date.now()}); }
  send(o){ if(this.ws.readyState===1) this.ws.send(JSON.stringify(o)); }
  close(){ try{ this.ws.close(); }catch(e){} }
}

async function main(){
  console.log(`\nLoad test: ${N} bots for ${SECONDS}s against one process (MAX_PLAYERS default 60)\n`);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'isle-load-'));
  const srv = startServer({ port: PORT, dataDir });
  await waitHealthy(URL);
  const rssStart = rssMB(srv.pid);

  // connect all bots
  const bots = Array.from({length:N}, (_,i)=> new LoadBot(i));
  await Promise.all(bots.map(b=> b.start()));
  const connected = bots.filter(b=>b.connected).length;
  console.log(`connected: ${connected}/${N}`);

  // drive activity
  const moveTimer = setInterval(()=> { for(const b of bots) b.tickMove(); }, 80);   // ~12.5 inputs/s each
  const pingTimer = setInterval(()=> { for(const b of bots) b.ping(); }, 1000);
  const t0 = Date.now();
  await sleep(SECONDS*1000);
  clearInterval(moveTimer); clearInterval(pingTimer);
  const elapsed = (Date.now()-t0)/1000;

  // collect metrics
  const rssEnd = rssMB(srv.pid);
  const totalStates = bots.reduce((s,b)=>s+b.states,0);
  const totalBytes = bots.reduce((s,b)=>s+b.bytes,0);
  const statesPerBotPerSec = totalStates / connected / elapsed;     // server tick rate seen by clients (~15)
  const allRtts = bots.flatMap(b=>b.rtts);
  const downKBs = totalBytes/1024/elapsed;                          // total downstream bandwidth
  const perBotKBs = downKBs/connected;

  console.log('\n── results ───────────────────────────────');
  console.log(`broadcast rate seen by clients : ${statesPerBotPerSec.toFixed(1)} /s  (target ~15)`);
  console.log(`chat round-trip latency        : p50 ${pct(allRtts,50)}ms  p95 ${pct(allRtts,95)}ms  (n=${allRtts.length})`);
  console.log(`downstream bandwidth           : ${downKBs.toFixed(0)} KB/s total · ${perBotKBs.toFixed(1)} KB/s per bot`);
  console.log(`server memory (RSS)            : ${rssStart}MB → ${rssEnd}MB`);
  console.log('──────────────────────────────────────────');

  bots.forEach(b=>b.close());
  srv.kill();
  fs.rmSync(dataDir,{recursive:true,force:true});

  // health gate: nearly all bots connected and the tick held up under load
  const healthy = connected >= N*0.95 && statesPerBotPerSec >= 12;
  if (!healthy){ console.log(`\nFAIL: unhealthy under load (connected ${connected}/${N}, rate ${statesPerBotPerSec.toFixed(1)}/s)`); process.exit(1); }
  console.log(`\nPASS: ${connected} concurrent players held a ${statesPerBotPerSec.toFixed(1)}/s tick. ✓`);
  console.log('Note: state broadcast is O(players²) (everyone sees everyone). This is comfortable for');
  console.log('tens of players; for hundreds, shard into rooms + add area-of-interest (see DEPLOY.md §Scaling).');
  process.exit(0);
}

process.on('SIGINT', ()=>process.exit(1));
main().catch(e=>{ console.error('\n'+e.stack); process.exit(1); });
