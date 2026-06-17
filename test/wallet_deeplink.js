// RUNELANDS — Phantom MOBILE deeplink login. The phone leaves the page (to the Phantom app) and returns
// via a reload, so the signature is produced on one socket and submitted on another. The server must
// therefore accept a recently-issued login nonce (one-time), while still rejecting unknown/used ones.
//   run:  node test/wallet_deeplink.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const { Bot, ok, passCount, sleep, startServer, killServers, waitHealthy } = require('./harness');

const PREFIX = 'Sign in to RUNELANDS\nWallet login — nonce: ';
function sign(kp, nonce){ const sig = nacl.sign.detached(new Uint8Array(Buffer.from(PREFIX + nonce, 'utf8')), kp.secretKey); return { pubkey: bs58.encode(kp.publicKey), sig: Array.from(sig) }; }
function httpGet(port, p){ return new Promise(res=>{ http.get({host:'localhost',port,path:p}, r=>{ let d=''; r.on('data',c=>d+=c); r.on('end',()=>res({status:r.statusCode, ct:r.headers['content-type']||'', len:d.length})); }).on('error',()=>res({status:0})); }); }

async function main(){
  const PORT = 2627, URL = 'ws://localhost:' + PORT;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-deeplink-'));
  startServer({ port: PORT, dataDir: dir, env: { SPAWN_PROTECT_MS:'200' } });
  await waitHealthy(URL);

  console.log('\n[1] a nonce issued BEFORE the reload verifies on a NEW socket (the mobile round-trip)');
  const a1 = new Bot('Mob', URL); const init1 = await a1.connect({ guest:'g-mob' });
  const N0 = init1.nonce; ok(typeof N0==='string' && N0.length>0, 'the first socket was issued a login nonce');
  a1.close(); await sleep(200);                                   // leaving for Phantom → page reloads
  const a2 = new Bot('Mob', URL); const init2 = await a2.connect({ guest:'g-mob' });
  ok(init2.nonce && init2.nonce !== N0, 'the reloaded socket gets a fresh, different nonce');
  const kp = nacl.sign.keyPair(); const w = sign(kp, N0);         // signature is over the PRE-reload nonce
  a2.send({ t:'wallet', pubkey:w.pubkey, sig:w.sig, nonce:N0 });
  const r1 = await a2.waitFor(m => m.t==='walletok'||m.t==='walletfail', 4000, 'wallet response');
  ok(r1.t==='walletok' && r1.pubkey===w.pubkey, 'old nonce + new socket → walletok (deeplink works)');
  a2.close(); await sleep(120);

  console.log('\n[2] a nonce the server never issued is rejected');
  const b = new Bot('Eve', URL); await b.connect({ guest:'g-eve' });
  const kpB = nacl.sign.keyPair(); const FAKE = 'deadbeefdeadbeefdeadbeefdeadbeef'; const wB = sign(kpB, FAKE);
  b.send({ t:'wallet', pubkey:wB.pubkey, sig:wB.sig, nonce:FAKE });
  const rB = await b.waitFor(m => m.t==='walletok'||m.t==='walletfail', 4000, 'wallet response');
  ok(rB.t==='walletfail', 'an unknown (never-issued) nonce cannot be used');
  b.close(); await sleep(120);

  console.log('\n[3] a consumed nonce cannot be replayed (one-time use)');
  const c = new Bot('Mallory', URL); await c.connect({ guest:'g-mal' });
  const kpC = nacl.sign.keyPair(); const wC = sign(kpC, N0);      // N0 was already spent in [1]
  c.send({ t:'wallet', pubkey:wC.pubkey, sig:wC.sig, nonce:N0 });
  const rC = await c.waitFor(m => m.t==='walletok'||m.t==='walletfail', 4000, 'wallet response');
  ok(rC.t==='walletfail', 'the already-used nonce is gone → replay rejected');
  c.close(); await sleep(120);

  console.log('\n[4] the desktop flow (no nonce field) still verifies on the live socket');
  const d = new Bot('Desk', URL); const initD = await d.connect({ guest:'g-desk' });
  const kpD = nacl.sign.keyPair(); const wD = sign(kpD, initD.nonce);
  d.send({ t:'wallet', pubkey:wD.pubkey, sig:wD.sig });           // no nonce → server uses the socket nonce
  const rD = await d.waitFor(m => m.t==='walletok'||m.t==='walletfail', 4000, 'wallet response');
  ok(rD.t==='walletok', 'desktop wallet login (socket nonce) is unaffected');
  d.close(); await sleep(120);

  console.log('\n[5] the browser crypto (tweetnacl) is served for the deeplink');
  const js = await httpGet(PORT, '/nacl.min.js');
  ok(js.status===200 && /javascript/.test(js.ct) && js.len>5000, '/nacl.min.js is served as javascript');

  try{ fs.rmSync(dir,{recursive:true,force:true}); }catch(e){}
  killServers();
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' DEEPLINK CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}
main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
