// Generates the contest social/OG banner (marketing/contest-og.png, 1200x630):
// the Plotlands isometric ISLAND from the keyart (cropped so the keyart's own text is off-frame) as a
// cinematic background + a soft dark overlay + the $1000 contest copy.
// Run after editing: node tools/make-og.js   (server serves it at /banner.png)
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const art = fs.readFileSync(path.join(__dirname, '..', 'marketing', 'keyart.png')).toString('base64');

// dark "shadow" copy of a text node, offset behind, for legibility over the art
const sh = (x, y, size, ls, t, dx = 3, dy = 4) =>
  `<text x="${x + dx}" y="${y + dy}" font-size="${size}" font-weight="bold" letter-spacing="${ls}" fill="#03060c" fill-opacity="0.6">${t}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#060b14" stop-opacity="0.40"/>
      <stop offset="0.46" stop-color="#060b14" stop-opacity="0.60"/>
      <stop offset="1" stop-color="#04070e" stop-opacity="0.90"/>
    </linearGradient>
    <radialGradient id="vig" cx="50%" cy="44%" r="78%">
      <stop offset="0.5" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.5"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff0a8"/><stop offset="0.5" stop-color="#f6c945"/><stop offset="1" stop-color="#dd9e26"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="#0a1622"/>
  <image href="data:image/png;base64,${art}" width="1920" height="1080" transform="translate(-398,-354) scale(1.04)"/>
  <rect width="1200" height="630" fill="url(#shade)"/>
  <rect width="1200" height="630" fill="url(#vig)"/>
  <rect x="18" y="18" width="1164" height="594" rx="26" fill="none" stroke="#f0c64a" stroke-opacity="0.6" stroke-width="3"/>

  <g text-anchor="middle" font-family="DejaVu Sans">
    ${sh(600, 95, 33, 13, 'P L O T L A N D S', 2, 2)}
    <text x="600" y="95" font-size="33" font-weight="bold" letter-spacing="13" fill="#ffe07a">P L O T L A N D S</text>
    ${sh(600, 142, 25, 10, 'SEASON SHOWDOWN', 2, 2)}
    <text x="600" y="142" font-size="25" font-weight="bold" letter-spacing="10" fill="#e7f1fb">SEASON SHOWDOWN</text>

    ${sh(600, 350, 214, 0, '$1000', 4, 6)}
    <text x="600" y="350" font-size="214" font-weight="bold" fill="url(#gold)">$1000</text>
    ${sh(600, 414, 54, 9, 'PRIZE POOL', 2, 3)}
    <text x="600" y="414" font-size="54" font-weight="bold" letter-spacing="9" fill="#ffffff">PRIZE POOL</text>

    ${sh(600, 478, 25, 0, '1st $300    2nd $175    3rd $100    4th $75    5th $50    +  $300 Raffle', 2, 2)}
    <text x="600" y="478" font-size="25" font-weight="bold" fill="#ffe07a">1st $300    2nd $175    3rd $100    4th $75    5th $50    +  $300 Raffle</text>

    <g transform="translate(600,550)">
      <rect x="-282" y="-37" width="564" height="74" rx="37" fill="#03060c" fill-opacity="0.4"/>
      <rect x="-280" y="-35" width="560" height="70" rx="35" fill="url(#gold)"/>
      <text x="0" y="12" font-size="34" font-weight="bold" fill="#221703">PLAY FREE  ·  plotlands.fun</text>
    </g>

    ${sh(600, 611, 19, 0, 'Free Solana island MMO · connect your wallet · climb the leaderboard · win real cash', 1, 2)}
    <text x="600" y="611" font-size="19" fill="#cdddec">Free Solana island MMO · connect your wallet · climb the leaderboard · win real cash</text>
  </g>
</svg>`;

const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: true } }).render().asPng();
const out = path.join(__dirname, '..', 'marketing', 'contest-og.png');
fs.writeFileSync(out, png);
console.log('wrote', out, Math.round(png.length / 1024) + 'KB');
