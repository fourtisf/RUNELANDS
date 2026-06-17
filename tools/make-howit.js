// Generates a clean, professional "How it works" banner for the X thread (marketing/howit.png, 1200x630).
// Flat purple+gold design that matches the RUNELANDS UI — 3 numbered steps + prize row + CTA.
// Run: node tools/make-howit.js
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const W = 1200, H = 630;
const cw = 356, gap = 26, x0 = 40;
const x1 = x0, x2 = x0 + cw + gap, x3 = x0 + 2 * (cw + gap);
const cardY = 230, cardH = 234;

function card(x, num, title, lines) {
  const bx = x + 48, by = cardY + 52;
  let t = `
    <rect x="${x}" y="${cardY}" width="${cw}" height="${cardH}" rx="20" fill="#2d2342" fill-opacity="0.95" stroke="#473a63" stroke-width="1.5"/>
    <circle cx="${bx}" cy="${by}" r="28" fill="url(#gold)"/>
    <text x="${bx}" y="${by + 11}" text-anchor="middle" font-size="31" font-weight="bold" fill="#1a1206">${num}</text>
    <text x="${x + 92}" y="${by + 12}" font-size="31" font-weight="bold" fill="#f1ecf8">${title}</text>`;
  lines.forEach((ln, i) => { t += `<text x="${x + 32}" y="${cardY + 122 + i * 33}" font-size="21" fill="#b1a4c6">${ln}</text>`; });
  return t;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d2342"/><stop offset="1" stop-color="#15111f"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset="0.5" stop-color="#f0c64a"/><stop offset="1" stop-color="#b8902a"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="url(#gold)"/>
  <rect x="15" y="15" width="${W - 30}" height="${H - 30}" rx="22" fill="none" stroke="#473a63" stroke-width="1.5"/>

  <g text-anchor="middle" font-family="DejaVu Sans">
    <text x="600" y="80" font-size="26" font-weight="bold" letter-spacing="11" fill="#f0c64a">R U N E L A N D S</text>
    <text x="600" y="152" font-size="62" font-weight="bold" fill="#f1ecf8">HOW IT WORKS</text>
    <text x="600" y="194" font-size="23" fill="#b1a4c6">$1000 Season Showdown   ·   free to play   ·   7-day season</text>
  </g>

  <g font-family="DejaVu Sans">
    ${card(x1, '1', 'CONNECT', ['Connect a Solana wallet', '(Phantom) and jump in —', 'free, no purchase needed.'])}
    ${card(x2, '2', 'EARN POINTS', ['Hunt monsters, fish, mine,', 'farm &amp; build. Every action', 'earns you season points.'])}
    ${card(x3, '3', 'WIN CASH', ['Climb the leaderboard.', 'Top 5 win, plus a raffle', 'for everyone over 2,000 pts.'])}
  </g>

  <g text-anchor="middle" font-family="DejaVu Sans">
    <text x="600" y="524" font-size="22" font-weight="bold" fill="#ffe9a8">1st $300  ·  2nd $175  ·  3rd $100  ·  4th $75  ·  5th $50    +    $300 Raffle</text>
    <g transform="translate(600,576)">
      <rect x="-242" y="-30" width="484" height="60" rx="30" fill="url(#gold)"/>
      <text x="0" y="11" font-size="29" font-weight="bold" fill="#1a1206">PLAY FREE   ·   runelands.fun</text>
    </g>
  </g>
</svg>`;

const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: true } }).render().asPng();
const out = path.join(__dirname, '..', 'marketing', 'howit.png');
fs.writeFileSync(out, png);
console.log('wrote', out, Math.round(png.length / 1024) + 'KB');
