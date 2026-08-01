/**
 * Pokemon evolution card image generator.
 * Uses assets/evolve-bg.png as the exact background (1536×1024).
 * Overlays: Pokémon name, type, sprites, and congrats text via sharp + SVG.
 */

const https = require('https')
const http  = require('http')
const path  = require('path')

// Background image – copied into assets/
const BG_PATH = path.join(__dirname, 'assets', 'evolve-bg.png')

// Canvas dimensions (must match the background file)
const W = 1536, H = 1024

// ── Download helper ───────────────────────────────────────────────
function downloadBuffer(url, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null) }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end',  () => resolve(Buffer.concat(chunks)))
      res.on('error', () => resolve(null))
    })
    req.on('error',   () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

// ── Escape XML special chars ──────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Type → background colour for the badge overlay ───────────────
function typeColor(type) {
  const map = {
    normal:   '#9099A1', fire:     '#FF9C54', water:    '#4D90D5',
    electric: '#F4D23C', grass:    '#63BB5B', ice:      '#74CEC0',
    fighting: '#CE4069', poison:   '#AB6AC8', ground:   '#D97746',
    flying:   '#89AAE3', psychic:  '#F97176', bug:      '#90C12C',
    rock:     '#C7B78B', ghost:    '#5269AC', dragon:   '#0A6DC4',
    dark:     '#5A5366', steel:    '#5A8EA1', fairy:    '#EC8FE6',
    shadow:   '#6B3FA0',
  }
  return map[(type || '').toLowerCase()] || '#777777'
}

// ── SVG text-only overlay (transparent background) ────────────────
// Positions are measured against the 1536×1024 background template:
//
//  Left zone
//    Name box center ............. x=222,  y=200
//    Type badge center ........... x=192,  y=276
//    Sprite circle center ........ x=222,  y=555   (sprite drawn separately)
//
//  Right zone
//    Name box center ............. x=1314, y=200
//    Type badge center ........... x=1344, y=276
//    Sprite circle center ........ x=1314, y=555   (sprite drawn separately)
//
//  Bottom congrats bar
//    Line 1 (bold "Congratulations!") ...... x=155, y=768
//    Line 2 ("[Pre] evolved into [Evo]!") .. x=155, y=800
//
function buildOverlaySvg(opts) {
  const { preName, preTypes, evoName, evoTypes } = opts
  const preType = (preTypes  || [])[0] || 'normal'
  const evoType = (evoTypes  || [])[0] || 'normal'

  const preNameUp = esc(String(preName).toUpperCase())
  const evoNameUp = esc(String(evoName).toUpperCase())
  const preNameRaw = esc(String(preName))
  const evoNameRaw = esc(String(evoName))
  const preTypeLabel = esc(String(preType).toUpperCase())
  const evoTypeLabel = esc(String(evoType).toUpperCase())

  const preTypeColor = typeColor(preType)
  const evoTypeColor = typeColor(evoType)

  // Scale font size down for long names so they stay inside the box
  // Left box inner width ≈ 320px  |  Right box inner width ≈ 390px
  const leftFontSize  = Math.min(34, Math.max(18, Math.floor(320  / Math.max(preNameUp.length, 1) * 1.6)))
  const rightFontSize = Math.min(34, Math.max(18, Math.floor(390 / Math.max(evoNameUp.length, 1) * 1.6)))

  // Type badge pill dimensions
  const typePillW = 130, typePillH = 34

  return `<svg xmlns="http://www.w3.org/2000/svg"
      width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">

    <!-- ══ LEFT NAME (inside the white-outline box, center x=222 y=200) ══ -->
    <text x="222" y="${200 + leftFontSize * 0.35}"
      font-family="'Arial Black',Arial,sans-serif"
      font-size="${leftFontSize}" font-weight="900"
      fill="#ffffff" text-anchor="middle"
      dominant-baseline="middle"
      letter-spacing="1">${preNameUp}</text>

    <!-- ══ LEFT TYPE (replace the grey TYPE pill, center x=192 y=276) ══ -->
    <rect x="${192 - typePillW / 2}" y="${276 - typePillH / 2}"
      width="${typePillW}" height="${typePillH}" rx="5"
      fill="${preTypeColor}" opacity="0.92"/>
    <text x="192" y="276"
      font-family="Arial,sans-serif" font-size="15" font-weight="700"
      fill="#ffffff" text-anchor="middle" dominant-baseline="middle"
      letter-spacing="1">${preTypeLabel}</text>

    <!-- ══ RIGHT NAME (inside the red-outline box, center x=1314 y=200) ══ -->
    <text x="1314" y="${200 + rightFontSize * 0.35}"
      font-family="'Arial Black',Arial,sans-serif"
      font-size="${rightFontSize}" font-weight="900"
      fill="#ffffff" text-anchor="middle"
      dominant-baseline="middle"
      letter-spacing="1">${evoNameUp}</text>

    <!-- ══ RIGHT TYPE (replace the red TYPE pill, center x=1344 y=276) ══ -->
    <rect x="${1344 - typePillW / 2}" y="${276 - typePillH / 2}"
      width="${typePillW}" height="${typePillH}" rx="5"
      fill="${evoTypeColor}" opacity="0.92"/>
    <text x="1344" y="276"
      font-family="Arial,sans-serif" font-size="15" font-weight="700"
      fill="#ffffff" text-anchor="middle" dominant-baseline="middle"
      letter-spacing="1">${evoTypeLabel}</text>

    <!-- ══ BOTTOM CONGRATS BAR ══ -->
    <!-- "Congratulations!" bold white -->
    <text x="155" y="768"
      font-family="Arial,sans-serif" font-size="22" font-weight="700"
      fill="#ffffff">Congratulations!</text>

    <!-- "[PreName] evolved into [EvoName]!" -->
    <text x="155" y="800"
      font-family="Arial,sans-serif" font-size="20" fill="#cccccc">
      <tspan>${preNameRaw} evolved into </tspan><tspan fill="#cc2222" font-weight="700">${evoNameRaw}</tspan><tspan>!</tspan>
    </text>
  </svg>`
}

// ── Main export ───────────────────────────────────────────────────
async function buildEvolveImage(opts) {
  /*
   * opts = {
   *   preName:  string,  preId:  number,  preTypes:  string[],
   *   evoName:  string,  evoId:  number,  evoTypes:  string[],
   * }
   * Returns a PNG Buffer or null on error.
   */
  let sharp
  try { sharp = require('sharp') } catch { return null }

  // 1. Load the background image as base
  let base
  try {
    base = await sharp(BG_PATH).png().toBuffer()
  } catch { return null }

  // 2. Build the text overlay SVG and convert to PNG
  let overlayBuf
  try {
    const svg = buildOverlaySvg(opts)
    overlayBuf = await sharp(Buffer.from(svg)).png().toBuffer()
  } catch { return null }

  // 3. Composite text overlay onto background
  try {
    base = await sharp(base).composite([{ input: overlayBuf, top: 0, left: 0 }]).png().toBuffer()
  } catch { return null }

  // 4. Fetch official artwork sprites (high quality)
  const artBase = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork'
  const [preBuf, evoBuf] = await Promise.all([
    opts.preId ? downloadBuffer(`${artBase}/${opts.preId}.png`) : Promise.resolve(null),
    opts.evoId ? downloadBuffer(`${artBase}/${opts.evoId}.png`) : Promise.resolve(null),
  ])

  const composites = []

  // Left sprite — sits inside the left circle platform (center x=222, y=555)
  // Size: 280×280, so top-left = (222-140, 555-260) = (82, 295)
  if (preBuf) {
    try {
      const sz = 280
      const s = await sharp(preBuf)
        .resize(sz, sz, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png().toBuffer()
      composites.push({ input: s, top: 555 - sz, left: 222 - Math.round(sz / 2) })
    } catch {}
  }

  // Right sprite — sits inside the right circle platform (center x=1314, y=555)
  // Size: 340×340, so top-left = (1314-170, 555-320) = (1144, 235)
  if (evoBuf) {
    try {
      const sz = 340
      const s = await sharp(evoBuf)
        .resize(sz, sz, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png().toBuffer()
      composites.push({ input: s, top: 555 - sz, left: 1314 - Math.round(sz / 2) })
    } catch {}
  }

  // 5. Composite sprites onto the image
  if (composites.length) {
    try {
      base = await sharp(base).composite(composites).png().toBuffer()
    } catch {}
  }

  return base
}

module.exports = { buildEvolveImage }
