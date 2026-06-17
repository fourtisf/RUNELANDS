// Compile-only check of the inline <script> blocks in the HTML pages (catch syntax errors w/o a browser).
const fs = require('fs'), vm = require('vm'), path = require('path');
const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let total = 0;
for (const file of ['isle_online.html', 'leaderboard.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  let m, i = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc=/i.test(attrs)) continue;       // skip external scripts
    i++; total++;
    try { new vm.Script(m[2], { filename: file + '#script' + i }); console.log('  ✓ ' + file + ' <script> #' + i + ' compiles (' + m[2].split('\n').length + ' lines)'); }
    catch (e) { console.error('  ✗ ' + file + ' <script> #' + i + ' FAILED: ' + e.message); process.exit(1); }
  }
  re.lastIndex = 0;
}
console.log('client: ' + total + ' inline <script> block(s) compiled OK');
