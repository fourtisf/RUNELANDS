# RUNELANDS — Premium image prompts (logo / header / banner / tweet)

Copy-paste these into an AI image generator. **Premium 3D look.** Same world & palette
across all four so the brand stays cohesive.

## ⭐ ONE master prompt (all-in-one — just change `--ar`)
```
Premium AAA marketing key art for "RUNELANDS", a free browser fantasy realm MMO (cozy build–fight–trade with an own-land economy). A breathtaking 3D isometric fantasy realm diorama floating above a deep arcane moat: pale runestone shores, lush rolling green hills, little stylized low-poly trees, a cozy village with a royal purple heraldic merchant pavilion, a small heroic character mid-adventure, glowing golden dashed land-claim plots marking owned parcels, sparkles of gold coins, and a faint Warlord boss silhouette far in the distance. Featured front and center: a bold golden 3D wordmark logo "RUNELANDS" with a battlemented castle-keep emblem, the tagline "Build · Fight · Trade · Own Land", and a glossy golden call-to-action button reading "PLAY FREE — runelands.fun". Color palette: royal purple #2d2342, deep arcane water #1f6f90, lush green #4d9c53, golden accent #f0c64a, gold highlight #ffe9a8, arcane violet #ab7bff, runestone grey #8c94a9. Style: premium 3D isometric diorama, miniature stylized world, soft global illumination, subsurface scattering, warm cinematic arcane rim light, rich royal purple and gold, vibrant saturated colors, clean low-poly with smooth shading, octane/redshift render, ultra-detailed, polished AAA mobile-game key art, Behance/Dribbble featured, crisp legible text, no clutter --ar 16:9 --v 6
```

> ✅ **Already rendered in-repo.** This exact prompt is realized as a ready-to-use vector
> asset — run `node marketing/build.js` → `marketing/keyart.png` (1920×1080, 16:9). It's an
> on-brand isometric fantasy realm diorama (royal purple + gold, castle crest, crisp text,
> glossy CTA) you can ship immediately, or feed the prompt above to an external 3D renderer
> for a photoreal variant.

**Swap the aspect ratio per asset (everything else stays the same):**
- Logo / avatar → `--ar 1:1` (it's fine if the wordmark is small/omitted on the icon)
- X header → `--ar 3:1` and add: `keep the lower-left corner empty for a circular profile avatar`
- X banner / tweet image → `--ar 16:9`

> Text legibility: use **Ideogram** or **DALL·E 3 / GPT-4o image** for the version with words.
> Midjourney = best art but mangles text → append `, no text, no words, no letters` and add the
> wordmark in Canva.

---


### ⚠️ Tool tip (important for text)
- Need **legible text** in the image ("RUNELANDS", "runelands.fun")? Use **Ideogram** or
  **DALL·E 3** / **GPT-4o image** — they render words correctly.
- **Midjourney** = best art, but it *mangles text*. Either prompt it textless and add the
  wordmark in Canva/Figma, or use the textless variants below.
- Always upscale to ≥2× and export PNG.

### 🎨 Brand kit (paste into any prompt)
- Name wordmark: **RUNELANDS** · Tagline: **Build · Fight · Trade · Own Land** · URL: **runelands.fun**
- Vibe: cozy top-down/isometric **fantasy realm MMO** with land ownership (subtle web3 / play-to-own)
- Palette: royal purple `#2d2342`, deep arcane water `#1f6f90`, lush green `#4d9c53`, golden
  accent `#f0c64a`, gold highlight `#ffe9a8`, arcane violet `#ab7bff`, runestone grey `#8c94a9`
- Always include: tiny stylized trees, a royal **heraldic merchant pavilion**, a small **hero**
  character, glowing **golden dashed land-claim plots**, a **battlemented castle-keep** brand emblem 🏰

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
Premium mobile-game app icon for "RUNELANDS", a cozy fantasy realm MMO. A tiny 3D isometric realm
floating above a deep arcane moat with lush green grass and little stylized trees; a bold golden
battlemented castle-keep emblem rising in the center; one glowing golden dashed land-claim plot on
the grass. Rounded-square icon, soft polished golden bezel, deep royal-purple background, subtle
inner glow, centered, iconic and readable at small sizes. premium 3D isometric diorama, soft global
illumination, royal purple and gold, vibrant, octane render, App-Store-featured quality --ar 1:1 --v 6
```
Aspect: 1:1 (export 1024×1024). *Keep it wordless — it's an avatar.*

## 2) X / TWITTER HEADER — ultra-wide (3:1, 1500×500)
```
Premium X/Twitter header for "RUNELANDS" browser fantasy realm MMO. RIGHT side: a wide cinematic 3D
isometric realm diorama above a deep arcane moat — pale runestone shores, rolling green hills,
stylized trees, a royal heraldic merchant pavilion, a tiny hero, and glowing golden dashed land-claim
plots. LEFT side: bold golden 3D wordmark "RUNELANDS" with a small castle-keep emblem, and the
tagline "Build · Fight · Trade · Own Land" beneath it. Deep royal-purple gradient backdrop, soft
volumetric arcane light, golden accents. IMPORTANT: keep the lower-left corner empty for a circular
profile avatar. crisp legible text, premium AAA game key art --ar 3:1
```
Aspect: 3:1 (export 1500×500). **Use Ideogram/DALL·E for the text.** Keep lower-left clear.

## 3) PROMO / X BANNER — landscape (16:9)
```
Premium promotional banner key art for "RUNELANDS", a free browser fantasy realm MMO. A gorgeous 3D
isometric realm world floating above a deep arcane moat: pale runestone shores, green hills, stylized
trees, a cozy village with a royal heraldic merchant pavilion and a tiny hero, glowing golden dashed
land-claim plots marking owned parcels, a faint Warlord boss silhouette in the distance. Big bold
golden 3D logo "RUNELANDS" with a castle-keep emblem and the tagline "Build · Fight · Trade · Own
Land". Warm cinematic arcane lighting, royal purple and gold, vibrant, ultra-detailed, premium AAA
mobile-game marketing art --ar 16:9 --v 6
```
Aspect: 16:9 (export 1920×1080).

## 4) TWEET BANNER — first-tweet hero (16:9, 1600×900)
```
Premium launch hero key art for "RUNELANDS", a free browser fantasy realm MMO. Cinematic 3D isometric
diorama: a beautiful miniature realm above a deep arcane moat with pale runestone shores, rolling
green hills, stylized trees, a cozy village + royal heraldic merchant pavilion, a heroic little
character mid-adventure, and several glowing golden dashed land-claim plots across owned land.
Upper-left: huge bold golden 3D logo "RUNELANDS" + castle-keep emblem, tagline "Build · Fight · Trade
· Own Land", and a glossy golden call-to-action button reading "PLAY FREE — runelands.fun". Warm
arcane rim light, sparkle of coins, royal purple and gold, vibrant and inviting, premium AAA game
marketing art, Behance featured --ar 16:9 --v 6
```
Aspect: 16:9 (export 1600×900 or 1920×1080). **Use Ideogram/DALL·E for the button + logo text.**

---

## Textless variants (for Midjourney, then add text in Canva)
Append `, no text, no words, no letters` to prompts 2–4 and overlay the wordmark/CTA yourself in
Canva/Figma using:
- Wordmark **RUNELANDS** in a heavy rounded sans (e.g. Poppins/Nunito ExtraBold), gold `#f0c64a`
  with a dark drop shadow.
- Tagline **Build · Fight · Trade · Own Land** in white.
- CTA pill **PLAY FREE → runelands.fun** on a gold rounded button.

## Alt art angles to try
- "night raid": the same realm at dusk, lanterns glowing, the Warlord boss looming, players rallying.
- "land rush": top-down map covered in glowing golden claimed plots, coins raining, leaderboard UI.
- "cozy onboarding": single hero chopping a tree by the heraldic merchant pavilion, soft morning light (great for ads).
