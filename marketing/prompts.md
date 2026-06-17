# Plotlands — Premium image prompts (logo / header / banner / tweet)

Copy-paste these into an AI image generator. **Premium 3D look.** Same world & palette
across all four so the brand stays cohesive.

## ⭐ ONE master prompt (all-in-one — just change `--ar`)
```
Premium AAA marketing key art for "Plotlands", a free browser MMO island game (cozy build–fight–trade with an own-land economy). A breathtaking 3D isometric island diorama floating on a turquoise sea: golden sandy beaches, lush rolling green hills, little stylized low-poly trees, a cozy village with a red-and-white striped merchant tent, a small heroic character mid-adventure, glowing golden dashed land-claim plots marking owned parcels, sparkles of gold coins, and a faint Warlord boss silhouette far in the distance. Featured front and center: a bold golden 3D wordmark logo "PLOTLANDS" with a snow-capped mountain-peak emblem, the tagline "Build · Fight · Trade · Own Land", and a glossy golden call-to-action button reading "PLAY FREE — plotlands.fun". Color palette: turquoise water #2a93b3, lush green #5fa85b, golden accent #f4cf57, sandy beach #e6d6a0, dark slate #1f2a36. Style: premium 3D isometric diorama, miniature stylized world, soft global illumination, subsurface scattering, warm cinematic sunset rim light, vibrant saturated colors, clean low-poly with smooth shading, octane/redshift render, ultra-detailed, polished AAA mobile-game key art, Behance/Dribbble featured, crisp legible text, no clutter --ar 16:9 --v 6
```

> ✅ **Already rendered in-repo.** This exact prompt is realized as a ready-to-use vector
> asset — run `node marketing/build.js` → `marketing/keyart.png` (1920×1080, 16:9). It's an
> on-brand isometric diorama (exact palette, crisp text, glossy CTA) you can ship immediately,
> or feed the prompt above to an external 3D renderer for a photoreal variant.

**Swap the aspect ratio per asset (everything else stays the same):**
- Logo / avatar → `--ar 1:1` (it's fine if the wordmark is small/omitted on the icon)
- X header → `--ar 3:1` and add: `keep the lower-left corner empty for a circular profile avatar`
- X banner / tweet image → `--ar 16:9`

> Text legibility: use **Ideogram** or **DALL·E 3 / GPT-4o image** for the version with words.
> Midjourney = best art but mangles text → append `, no text, no words, no letters` and add the
> wordmark in Canva.

---


### ⚠️ Tool tip (important for text)
- Need **legible text** in the image ("PLOTLANDS", "plotlands.fun")? Use **Ideogram** or
  **DALL·E 3** / **GPT-4o image** — they render words correctly.
- **Midjourney** = best art, but it *mangles text*. Either prompt it textless and add the
  wordmark in Canva/Figma, or use the textless variants below.
- Always upscale to ≥2× and export PNG.

### 🎨 Brand kit (paste into any prompt)
- Name wordmark: **PLOTLANDS** · Tagline: **Build · Fight · Trade · Own Land** · URL: **plotlands.fun**
- Vibe: cozy top-down/isometric **island MMO** with land ownership (subtle web3 / play-to-own)
- Palette: turquoise sea `#2a93b3`, lush green `#5fa85b`, golden accent `#f4cf57`, sandy beach
  `#e6d6a0`, dark slate UI `#1f2a36`
- Always include: tiny stylized trees, a striped **merchant tent**, a small **hero** character,
  glowing **golden dashed land-claim plots**

### Reusable STYLE SUFFIX (append to any prompt)
> premium 3D isometric diorama, miniature stylized world, soft global illumination, gentle
> subsurface scattering, vibrant saturated colors, clean low-poly + smooth shading, octane/redshift
> render, cinematic warm rim light, ultra-detailed, polished AAA mobile-game key art, Behance/Dribbble
> featured quality, no clutter --style raw

### Reusable NEGATIVE (for tools that support it)
> blurry, misspelled text, gibberish text, watermark, logo soup, ui buttons, photo-realistic
> humans, dark/muddy, low-res, jpeg artifacts, cluttered

---

## 1) LOGO / APP ICON — square (1:1)
```
Premium mobile-game app icon for "Plotlands", a cozy island MMO. A tiny 3D isometric island
floating on turquoise water with lush green grass and little stylized trees; a bold golden
mountain-peak emblem rising in the center; one glowing golden dashed land-claim plot on the grass.
Rounded-square icon, soft polished golden bezel, dark slate background, subtle inner glow, centered,
iconic and readable at small sizes. premium 3D isometric diorama, soft global illumination, vibrant,
octane render, App-Store-featured quality --ar 1:1 --v 6
```
Aspect: 1:1 (export 1024×1024). *Keep it wordless — it's an avatar.*

## 2) X / TWITTER HEADER — ultra-wide (3:1, 1500×500)
```
Premium X/Twitter header for "Plotlands" browser MMO. RIGHT side: a wide cinematic 3D isometric
island diorama on turquoise sea — golden beaches, rolling green hills, stylized trees, a striped
merchant tent, a tiny hero, and glowing golden dashed land-claim plots. LEFT side: bold golden 3D
wordmark "PLOTLANDS" with a small mountain emblem, and the tagline "Build · Fight · Trade · Own Land"
beneath it. Dark teal gradient backdrop, soft volumetric light, golden accents. IMPORTANT: keep the
lower-left corner empty for a circular profile avatar. crisp legible text, premium AAA game key art
--ar 3:1
```
Aspect: 3:1 (export 1500×500). **Use Ideogram/DALL·E for the text.** Keep lower-left clear.

## 3) PROMO / X BANNER — landscape (16:9)
```
Premium promotional banner key art for "Plotlands", a free browser MMO island. A gorgeous 3D
isometric island world floating on turquoise sea: golden beaches, green hills, stylized trees, a
cozy village with a striped merchant tent and a tiny hero, glowing golden dashed land-claim plots
marking owned parcels, a faint Warlord boss silhouette in the distance. Big bold golden 3D logo
"PLOTLANDS" with a mountain emblem and the tagline "Build · Fight · Trade · Own Land". Warm cinematic
lighting, vibrant, ultra-detailed, premium AAA mobile-game marketing art --ar 16:9 --v 6
```
Aspect: 16:9 (export 1920×1080).

## 4) TWEET BANNER — first-tweet hero (16:9, 1600×900)
```
Premium launch hero key art for "Plotlands", a free browser MMO island. Cinematic 3D isometric
diorama: a beautiful miniature island on turquoise sea with golden beaches, rolling green hills,
stylized trees, a cozy village + striped merchant tent, a heroic little character mid-adventure, and
several glowing golden dashed land-claim plots across owned land. Upper-left: huge bold golden 3D
logo "PLOTLANDS" + mountain emblem, tagline "Build · Fight · Trade · Own Land", and a glossy golden
call-to-action button reading "PLAY FREE — plotlands.fun". Warm sunset rim light, sparkle of coins,
vibrant and inviting, premium AAA game marketing art, Behance featured --ar 16:9 --v 6
```
Aspect: 16:9 (export 1600×900 or 1920×1080). **Use Ideogram/DALL·E for the button + logo text.**

---

## Textless variants (for Midjourney, then add text in Canva)
Append `, no text, no words, no letters` to prompts 2–4 and overlay the wordmark/CTA yourself in
Canva/Figma using:
- Wordmark **PLOTLANDS** in a heavy rounded sans (e.g. Poppins/Nunito ExtraBold), gold `#f4cf57`
  with a dark drop shadow.
- Tagline **Build · Fight · Trade · Own Land** in white.
- CTA pill **PLAY FREE → plotlands.fun** on a gold rounded button.

## Alt art angles to try
- "night raid": same island at dusk, lanterns glowing, the Warlord boss looming, players rallying.
- "land rush": top-down map covered in glowing golden claimed plots, coins raining, leaderboard UI.
- "cozy onboarding": single hero chopping a tree by the merchant tent, soft morning light (great for ads).
