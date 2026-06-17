// RUNELANDS — Solana wallet-login tests (server-authoritative gate).
// Proves: a spectator cannot move/act until they connect a wallet; a real ed25519 signature
// over the server's nonce unlocks play; a forged signature is rejected; the wallet is linked to
// the account (returns auto-verified); and the same wallet on a new device adopts the account —
// all WITHOUT resetting existing guest progress.
//   run:  node test/wallet.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const { Bot, ok, passCount, sleep, startServer, waitHealthy } = require('./harness');

const PORT = 2613, URL = 'ws://localhost:' + PORT;
const PREFIX = 'Sign in to RUNELANDS\nWallet login — nonce: ';

function signWallet(kp, nonce){
  const sig = nacl.sign.detached(new Uint8Array(Buffer.from(PREFIX + nonce, 'utf8')), kp.secretKey);
  return { pubkey: bs58.encode(kp.publicKey), sig: Array.from(sig) };
}
const posOf = bot => { const me = bot.state && bot.state.players && bot.state.players.find(p => p.id === bot.id); return me ? { x: me.x, y: me.y } : null; };
async function waitPos(bot, ms=1500){ const t0=Date.now(); while(Date.now()-t0<ms){ const p=posOf(bot); if(p) return p; await sleep(40); } return null; }
async function pushInput(bot, tx, ty, ms){ const t0=Date.now(); while(Date.now()-t0<ms){ bot.send({ t:'input', x:tx, y:ty, dir:0 }); await sleep(70); } }

async function main(){
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-wallet-'));
  startServer({ port: PORT, dataDir, env: { WALLET_REQUIRED:'1', SPAWN_PROTECT_MS:'200' } }); // gate ON for this suite
  await waitHealthy(URL);

  // ===== a spectator (no wallet) cannot move =====
  console.log('\n[1] spectator without a wallet cannot move');
  const a = new Bot('Alfa', URL); const init = await a.connect({ guest: 'wallet-guest-A' });
  ok(init.walletRequired === true && init.walletOk === false, 'server requires a wallet (not yet verified)');
  ok(typeof init.nonce === 'string' && init.nonce.length > 0, 'server issued a login nonce');
  const spawn = await waitPos(a); ok(spawn, 'got spawn position');
  await pushInput(a, spawn.x - 120, spawn.y, 700);
  ok(Math.hypot(posOf(a).x - spawn.x, posOf(a).y - spawn.y) < 5, 'movement is ignored before connecting a wallet');

  // ===== connect + sign a real Solana wallet → unlocked =====
  console.log('\n[2] connect a Solana wallet (sign the nonce) → can move');
  const kp = nacl.sign.keyPair();
  const w = signWallet(kp, init.nonce);
  a.send({ t:'wallet', pubkey: w.pubkey, sig: w.sig });
  const okMsg = await a.waitFor(m => m.t === 'walletok', 4000, 'walletok');
  ok(okMsg && okMsg.pubkey === w.pubkey, 'server verified the signature (walletok)');
  await pushInput(a, spawn.x - 120, spawn.y, 1000);
  ok(Math.hypot(posOf(a).x - spawn.x, posOf(a).y - spawn.y) > 20, 'can move after the wallet is verified');
  a.close(); await sleep(300);

  // ===== returning with the same guest → auto-unlocked (wallet remembered, no re-sign) =====
  console.log('\n[3] returning same guest is auto-unlocked (wallet remembered, no re-sign)');
  const a2 = new Bot('Alfa', URL); const init2 = await a2.connect({ guest: 'wallet-guest-A' });
  ok(init2.walletOk === true && init2.wallet === w.pubkey, 'a linked wallet returns ready to play (no re-sign)');
  a2.close(); await sleep(150);

  // ===== a forged signature is rejected =====
  console.log('\n[4] a forged signature is rejected (still gated)');
  const b = new Bot('Bravo', URL); await b.connect({ guest: 'wallet-guest-B' });
  b.send({ t:'wallet', pubkey: bs58.encode(nacl.sign.keyPair().publicKey), sig: Array.from({ length:64 }, () => 0) });
  const fail = await b.waitFor(m => m.t === 'walletfail', 3000, 'walletfail').catch(() => null);
  ok(fail, 'forged signature returned walletfail');
  const sB = await waitPos(b); await pushInput(b, sB.x - 120, sB.y, 600);
  ok(Math.hypot(posOf(b).x - sB.x, posOf(b).y - sB.y) < 5, 'still cannot move after a failed verify');
  b.close(); await sleep(150);

  // ===== same wallet, new device → adopts the original account (cross-device login) =====
  console.log('\n[5] the same wallet on a new guest adopts the original account');
  const c = new Bot('Alfa', URL); const initC = await c.connect({ guest: 'a-fresh-browser-id' });
  const w2 = signWallet(kp, initC.nonce); // same keypair as session 1
  c.send({ t:'wallet', pubkey: w2.pubkey, sig: w2.sig });
  const okC = await c.waitFor(m => m.t === 'walletok', 4000, 'walletok (adopt)');
  ok(okC.guest === 'wallet-guest-A', 'cross-device login adopted the original account (guest=' + okC.guest + ')');
  c.close(); await sleep(150);

  // ===== with the gate OFF, connecting a wallet still links it (opt-in) =====
  console.log('\n[6] gate off → Connect Wallet still verifies + links (opt-in)');
  const PORT2 = 2614, URL2 = 'ws://localhost:' + PORT2;
  const dataDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-wallet2-'));
  startServer({ port: PORT2, dataDir: dataDir2, env: { WALLET_REQUIRED:'0', SPAWN_PROTECT_MS:'200' } });
  await waitHealthy(URL2);
  const d = new Bot('Delta', URL2); const initD = await d.connect({ guest: 'gateoff-guest' });
  ok(initD.walletRequired === false && initD.walletOk === true, 'gate off: player may already play (walletOk)');
  const kp2 = nacl.sign.keyPair(); const w3 = signWallet(kp2, initD.nonce);
  d.send({ t:'wallet', pubkey: w3.pubkey, sig: w3.sig });
  const okD = await d.waitFor(m => m.t === 'walletok', 4000, 'walletok (gate off)');
  ok(okD && okD.pubkey === w3.pubkey, 'gate off: wallet is still verified + linked (was the no-op bug)');
  d.close(); await sleep(150);
  fs.rmSync(dataDir2, { recursive:true, force:true });

  fs.rmSync(dataDir, { recursive:true, force:true });
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' WALLET-LOGIN CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
