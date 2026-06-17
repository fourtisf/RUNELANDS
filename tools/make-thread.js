// Generates the full clean "how it works" X-thread banner SET (1200x630 each), all in one consistent
// dark+gold style matching the leaderboard:
//   marketing/s1-connect.png, s2-earn.png, s3-win.png, prizes.png, cta.png
// (the hero marketing/howit.png is made by tools/make-howit.js)
// Run: node tools/make-thread.js
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const W = 1200, H = 630, F = 'DejaVu Sans';
const DEFS = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d2342"/><stop offset="1" stop-color="#15111f"/></linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset="0.5" stop-color="#f0c64a"/><stop offset="1" stop-color="#b8902a"/></linearGradient>
</defs>`;
const frame = () => `
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="url(#gold)"/>
  <rect x="15" y="15" width="${W - 30}" height="${H - 30}" rx="22" fill="none" stroke="#473a63" stroke-width="1.5"/>`;
const header = (sub) => `
  <text x="600" y="74" text-anchor="middle" font-size="24" font-weight="bold" letter-spacing="10" fill="#f0c64a" font-family="${F}">R U N E L A N D S</text>
  ${sub ? `<text x="600" y="108" text-anchor="middle" font-size="20" fill="#b1a4c6" font-family="${F}">${sub}</text>` : ''}`;
const footer = (left) => `
  <text x="60" y="590" font-size="20" font-weight="bold" fill="#f0c64a" font-family="${F}">${left || ''}</text>
  <text x="1140" y="590" text-anchor="end" font-size="20" font-weight="bold" fill="#d8cdec" font-family="${F}">runelands.fun</text>`;
function write(name, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${DEFS}${frame()}${body}</svg>`;
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: true } }).render().asPng();
  fs.writeFileSync(path.join(__dirname, '..', 'marketing', name), png);
  console.log('wrote', name, Math.round(png.length / 1024) + 'KB');
}

// ---- step banners: big gold number + title + supporting copy ----
function step(num, title, lines) {
  const cx = 250, cy = 332, r = 120;
  let b = header('$1000 Season Showdown')
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#gold)" stroke-width="6"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${r - 17}" fill="#2d2342"/>`
    + `<text x="${cx}" y="${cy + 50}" text-anchor="middle" font-size="150" font-weight="bold" fill="url(#gold)" font-family="${F}">${num}</text>`
    + `<text x="410" y="266" font-size="66" font-weight="bold" fill="#f1ecf8" font-family="${F}">${title}</text>`;
  lines.forEach((ln, i) => { b += `<text x="414" y="${330 + i * 44}" font-size="27" fill="#b1a4c6" font-family="${F}">${ln}</text>`; });
  return b + footer('STEP ' + num + ' OF 3');
}

write('s1-connect.png', step('1', 'CONNECT', ['Connect a Solana wallet (Phantom)', 'and jump straight in.', 'Free — no purchase, no token.']));
write('s2-earn.png', step('2', 'EARN POINTS', ['Hunt monsters, fish, mine, farm', 'and build. Every action earns', 'Season Points on the live board.']));
write('s3-win.png', step('3', 'WIN CASH', ['Climb the leaderboard.', 'Top 5 win cash + a $300 raffle', 'for everyone over 2,000 points.']));

// ---- prizes banner: $1000 + tier pills + raffle ----
(function prizes() {
  let b = header('Season Showdown');
  b += `<text x="600" y="182" text-anchor="middle" font-size="38" font-weight="bold" letter-spacing="5" fill="#f1ecf8" font-family="${F}">PRIZE POOL</text>`;
  b += `<text x="600" y="312" text-anchor="middle" font-size="150" font-weight="bold" fill="url(#gold)" font-family="${F}">$1000</text>`;
  const tiers = [['1st', '$300'], ['2nd', '$175'], ['3rd', '$100'], ['4th', '$75'], ['5th', '$50']];
  const pw = 200, pg = 16, totalW = tiers.length * pw + (tiers.length - 1) * pg, sx = (W - totalW) / 2, py = 372, ph = 88;
  tiers.forEach((t, i) => {
    const x = sx + i * (pw + pg);
    b += `<rect x="${x}" y="${py}" width="${pw}" height="${ph}" rx="16" fill="#2d2342" stroke="#473a63" stroke-width="1.5"/>`
      + `<text x="${x + pw / 2}" y="${py + 34}" text-anchor="middle" font-size="22" font-weight="bold" fill="#b1a4c6" font-family="${F}">${t[0]}</text>`
      + `<text x="${x + pw / 2}" y="${py + 70}" text-anchor="middle" font-size="34" font-weight="bold" fill="url(#gold)" font-family="${F}">${t[1]}</text>`;
  });
  b += `<g transform="translate(600,512)"><rect x="-330" y="-26" width="660" height="52" rx="26" fill="url(#gold)"/>`
    + `<text x="0" y="9" text-anchor="middle" font-size="25" font-weight="bold" fill="#1a1206" font-family="${F}">+  $300 RAFFLE  ·  every player over 2,000 pts</text></g>`;
  return write('prizes.png', b + footer('7-DAY SEASON'));
})();

// ---- closing CTA banner ----
(function cta() {
  const b = header('')
    + `<text x="600" y="206" text-anchor="middle" font-size="42" font-weight="bold" letter-spacing="8" fill="#f1ecf8" font-family="${F}">SEASON SHOWDOWN</text>`
    + `<text x="600" y="372" text-anchor="middle" font-size="178" font-weight="bold" fill="url(#gold)" font-family="${F}">$1000</text>`
    + `<text x="600" y="420" text-anchor="middle" font-size="29" fill="#b1a4c6" font-family="${F}">free to play   ·   7-day season   ·   win real cash</text>`
    + `<g transform="translate(600,508)"><rect x="-258" y="-37" width="516" height="74" rx="37" fill="url(#gold)"/>`
    + `<text x="0" y="13" text-anchor="middle" font-size="34" font-weight="bold" fill="#1a1206" font-family="${F}">PLAY FREE   ·   runelands.fun</text></g>`;
  return write('cta.png', b);
})();
