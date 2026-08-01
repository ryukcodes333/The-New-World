/**
 * Pokemon evolution card image generator.
 * Uses assets/evolve-bg.png as the exact background (1536×1024).
 * Overlays: Pokémon name, type, sprites, and congrats text via sharp + SVG.
 *
 * All coordinates below were measured directly off the background PNG
 * (pixel-scanned for box borders / fills), not guessed — that's what was
 * causing the sprite/text to overlap the boxes before.
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

// ── Layout constants (measured off assets/evolve-bg.png, 1536×1024) ──
//
//  Left column                          Right column
//    Name box   x 59–510, y 283–370       Name box   x 1021–1473, y 283–370
//    Type pill  x 175–395, y 396–446      Type pill  x 1135–1350, y 396–446
//    Podium     x 30–560, y 669–772       Podium     x 974–1504, y 669–772
//
//  Bottom congrats bar: x 60–1480, y 813–968
//    Star icon centered ~x=140   Divider ~x=235   Text starts ~x=260
//
const LEFT = {
  nameBox:  { x: 59,  y: 283, w: 451, h: 87,  cx: 285,  cy: 326 },
  typePill: { x: 175, y: 396, w: 220, h: 50,  cx: 285,  cy: 421 },
  podium:   { cx: 295, top: 669, bottom: 772 },
}
const RIGHT = {
  nameBox:  { x: 1021, y: 283, w: 452, h: 87, cx: 1247, cy: 326 },
  typePill: { x: 1135, y: 396, w: 215, h: 50, cx: 1242, cy: 421 },
  podium:   { cx: 1239, top: 669, bottom: 772 },
}

// Safe vertical zone for sprites: below the type pill, resting on the podium
const SPRITE_TOP    = 460  // clears typePill bottom (446) with a margin
const SPRITE_BOTTOM = 705  // sits just above the podium's front rim

// ── SVG text overlay (transparent background) ─────────────────────
function buildOverlaySvg(opts) {
  const { preName, preTypes, evoName, evoTypes } = opts
  const preType = (preTypes || [])[0] || 'normal'
  const evoType = (evoTypes || [])[0] || 'normal'

  const preNameUp = esc(String(preName).toUpperCase())
  const evoNameUp = esc(String(evoName).toUpperCase())
  const preNameRaw = esc(String(preName))
  const evoNameRaw = esc(String(evoName))
  const preTypeLabel = esc(String(preType).toUpperCase())
  const evoTypeLabel = esc(String(evoType).toUpperCase())

  const preTypeColor = typeColor(preType)
  const evoTypeColor = typeColor(evoType)

  // Scale font size down for long names so they stay inside the name box
  const leftFontSize  = Math.min(38, Math.max(20, Math.floor(LEFT.nameBox.w  / Math.max(preNameUp.length, 1) * 1.7)))
  const rightFontSize = Math.min(38, Math.max(20, Math.floor(RIGHT.nameBox.w / Math.max(evoNameUp.length, 1) * 1.7)))

  // Type badge pill dimensions (match the template's pill size)
  const lp = LEFT.typePill, rp = RIGHT.typePill

  return `<svg xmlns="http://www.w3.org/2000/svg"
      width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">

    <!-- ══ LEFT NAME ══ -->
    <text x="${LEFT.nameBox.cx}" y="${LEFT.nameBox.cy}"
      font-family="'Arial Black',Arial,sans-serif"
      font-size="${leftFontSize}" font-weight="900"
      fill="#ffffff" text-anchor="middle"
      dominant-baseline="central"
      letter-spacing="1">${preNameUp}</text>

    <!-- ══ LEFT TYPE PILL ══ -->
    <rect x="${lp.x}" y="${lp.y}" width="${lp.w}" height="${lp.h}" rx="8"
      fill="${preTypeColor}" opacity="0.92"/>
    <text x="${lp.cx}" y="${lp.cy}"
      font-family="Arial,sans-serif" font-size="16" font-weight="700"
      fill="#ffffff" text-anchor="middle" dominant-baseline="central"
      letter-spacing="1">${preTypeLabel}</text>

    <!-- ══ RIGHT NAME ══ -->
    <text x="${RIGHT.nameBox.cx}" y="${RIGHT.nameBox.cy}"
      font-family="'Arial Black',Arial,sans-serif"
      font-size="${rightFontSize}" font-weight="900"
      fill="#ffffff" text-anchor="middle"
      dominant-baseline="central"
      letter-spacing="1">${evoNameUp}</text>

    <!-- ══ RIGHT TYPE PILL ══ -->
    <rect x="${rp.x}" y="${rp.y}" width="${rp.w}" height="${rp.h}" rx="8"
      fill="${evoTypeColor}" opacity="0.92"/>
    <text x="${rp.cx}" y="${rp.cy}"
      font-family="Arial,sans-serif" font-size="16" font-weight="700"
      fill="#ffffff" text-anchor="middle" dominant-baseline="central"
      letter-spacing="1">${evoTypeLabel}</text>

    <!-- ══ BOTTOM CONGRATS BAR (bar spans y 813–968) ══ -->
    <text x="260" y="865"
      font-family="Arial,sans-serif" font-size="24" font-weight="700"
      fill="#ffffff">Congratulations!</text>

    <text x="260" y="905"
      font-family="Arial,sans-serif" font-size="21" fill="#cccccc">
      <tspan>${preNameRaw} evolved into </tspan><tspan fill="#e42b3c" font-weight="700">${evoNameRaw}</tspan><tspan>!</tspan>
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

  // 2. Fetch official artwork sprites (high quality)
  const artBase = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork'
  const [preBuf, evoBuf] = await Promise.all([
    opts.preId ? downloadBuffer(`${artBase}/${opts.preId}.png`) : Promise.resolve(null),
    opts.evoId ? downloadBuffer(`${artBase}/${opts.evoId}.png`) : Promise.resolve(null),
  ])

  const composites = []

  // Left sprite — stage 1, smaller, resting on the left podium
  if (preBuf) {
    try {
      const boxW = 260, boxH = SPRITE_BOTTOM - SPRITE_TOP // 245
      const s = await sharp(preBuf)
        .resize(boxW, boxH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png().toBuffer()
      composites.push({ input: s, top: SPRITE_TOP, left: Math.round(LEFT.podium.cx - boxW / 2) })
    } catch {}
  }

  // Right sprite — stage 2, drawn a bit larger, resting on the right podium
  if (evoBuf) {
    try {
      const boxW = 300, boxH = SPRITE_BOTTOM - SPRITE_TOP // 245
      const s = await sharp(evoBuf)
        .resize(boxW, boxH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png().toBuffer()
      composites.push({ input: s, top: SPRITE_TOP, left: Math.round(RIGHT.podium.cx - boxW / 2) })
    } catch {}
  }

  // 3. Composite sprites onto the background FIRST (so text/pills draw on top,
  //    never behind the artwork — this is what fixed the overlap issue)
  if (composites.length) {
    try {
      base = await sharp(base).composite(composites).png().toBuffer()
    } catch {}
  }

  // 4. Build the text/pill overlay SVG and composite it on top
  try {
    const svg = buildOverlaySvg(opts)
    const overlayBuf = await sharp(Buffer.from(svg)).png().toBuffer()
    base = await sharp(base).composite([{ input: overlayBuf, top: 0, left: 0 }]).png().toBuffer()
  } catch { return null }

  return base
}

module.exports = { buildEvolveImage }
