// RUNELANDS — enemy-table parity check (a critical convention).
// The ENEMY gameplay numbers MUST be identical in server.js and isle_online.html, or online
// players would see enemies behave differently from what the server simulates. This is a fast,
// deterministic static check (no server needed).
//   run:  node test/enemymatch.js
const fs = require('fs');
const path = require('path');
const { ok, passCount } = require('./harness');

function extractEnemy(src, label){
  const m = src.match(/const ENEMY\s*=\s*(\{[\s\S]*?\n\})\s*;/);
  if(!m) throw new Error('ENEMY table not found in ' + label);
  return (new Function('return (' + m[1] + ')'))();
}

const root = path.join(__dirname, '..');
const server = extractEnemy(fs.readFileSync(path.join(root,'server.js'),'utf8'), 'server.js');
const clientScript = fs.readFileSync(path.join(root,'isle_online.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const client = extractEnemy(clientScript, 'isle_online.html');

// fields that drive simulation/economy — these must agree (col/eye/name are client-only visuals; weight is server-only)
const FIELDS = ['hp','accel','fric','dmg','coin','xp','wood','stone','r','aggro'];

console.log('\nenemy-table parity (server.js ↔ isle_online.html)');
ok(JSON.stringify(Object.keys(server).sort()) === JSON.stringify(Object.keys(client).sort()),
   'both define the same enemy types: ' + Object.keys(server).sort().join(', '));
for(const t of Object.keys(server)){
  let same = true;
  for(const f of FIELDS) if(server[t][f] !== client[t][f]) same = false;
  ok(same, 'enemy "' + t + '" gameplay fields match');
}

console.log('\n========================================');
console.log('ALL ' + passCount() + ' ENEMY-PARITY CHECKS PASSED ✓');
console.log('========================================');
process.exit(0);
