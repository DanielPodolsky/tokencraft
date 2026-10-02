// Tokencraft — the Desktop band: a Minecraft world drawn as one animated SVG,
// with the HUD centered over it the way the game draws it.
//
// The sky is the context window: a fresh context is sunrise, half full is noon,
// 80% is sunset, past 90% it's night, and a creeper shows up asking for /compact.
// The weather is the plan limits: rain past 70% of the 5-hour limit, a thunderstorm
// past 90%, and snow — the ground turning white — past 70% of the 7-day limit.
// /weather overrides it for the session.
// Claude mines beside the HUD while it works; the furnace burns while /smelt runs;
// the sign keeps your level, lifetime blocks and today's XP.
//
// Every redraw rebuilds the SVG, so each looping animation starts at a phase taken
// from the wall clock (a negative `begin`) and one-shot effects start at the moment
// they happened: a redraw never makes anything jump or replay.

import { BLOCKS, HOTBAR, clockOf, pickaxeOf } from './blocks.js'

export const SCENE_H = 140
const HUD_W = 364
const GROUND = 116
const PX = 2.9 // one miner pixel, in scene units

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const r1 = (v) => Math.round(v * 10) / 10
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// A looping animation's begin, so its phase follows the clock across redraws
const phase = (now, seconds) => `-${((now % (seconds * 1000)) / 1000).toFixed(2)}s`
// A one-shot animation's begin, counted from the moment it happened
const since = (now, at) => `-${(Math.max(0, now - at) / 1000).toFixed(2)}s`

// Seeded random, so trees, flowers and stars stay put from one redraw to the next
function rng(seed) {
  let s = seed >>> 0
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32
}

// Pixel art as one path per color: a run of same-colored pixels is one segment
function art(rows, colors) {
  const runs = {}
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      let n = 1
      while (x + n < row.length && row[x + n] === row[x]) n += 1
      const color = colors[row[x]]
      if (color) (runs[color] ??= []).push(`M${x} ${y}h${n}v1h-${n}z`)
      x += n
    }
  })
  return Object.entries(runs)
    .map(([color, d]) => `<path fill="${color}" d="${d.join('')}"/>`)
    .join('')
}

// --- Textures (8×8 unless noted; '.' is see-through) -----------------------

const TEX = {
  stone: [['aabaacaa', 'abbcaaba', 'caaabcaa', 'aacaaaab', 'baabcaac', 'aacaabaa', 'abaacaba', 'caabaaac'], { a: '#8b8b8b', b: '#6e6e6e', c: '#a8a8a8' }],
  planks: [['abaaaaab', 'aaaaabaa', 'cccccccc', 'aaabaaaa', 'aaaaaaba', 'cccccccc', 'aabaaaaa', 'aaaaabaa'], { a: '#b8945f', b: '#9f7d4b', c: '#6f5230' }],
  tnt: [['rrsrrsrr', 'rsrrsrrs', 'wwwwwwww', 'wkwkkwkw', 'wwwwwwww', 'rrsrrsrr', 'rsrrsrrs', 'rrrrrrrr'], { r: '#db3b26', s: '#a8261a', w: '#f2f2f2', k: '#262626' }],
  diamond: [['........', '..oooo..', '.ocwcco.', 'ocwccbbo', '.occbbo.', '..obbo..', '...oo...', '........'], { o: '#0e5a55', c: '#4be8df', w: '#eafffd', b: '#1fa59f' }],
  emerald: [['...oo...', '..ollo..', '.olggdo.', 'olgggddo', '.oggddo.', '..oddo..', '...oo...', '........'], { o: '#07431e', l: '#a7f6c4', g: '#17c45a', d: '#0b7a35' }],
  redstone: [['........', '..r..r..', '.rRr.rr.', '..rrRr..', '.r.rr.r.', '..rR.rr.', '.rr..r..', '........'], { r: '#9e1b10', R: '#ff3b2b' }],
  egg: [['...ee...', '..eeee..', '.eebeee.', '.eeeebe.', '.ebeeee.', '.eeeeee.', '..eebe..', '...ee...'], { e: '#bd8e6b', b: '#5e3f2b' }],
  pearl: [['..oooo..', '.otttto.', 'otTTttto', 'otTLTtto', 'ottTttto', 'otttttto', '.otttto.', '..oooo..'], { o: '#0b3b36', t: '#127b6d', T: '#2fbfa8', L: '#c4f7ec' }],
  book: [['.bbbbbb.', 'bppppppb', 'bpPppppb', 'bppPpppb', 'bpppPppb', 'bppppPpb', 'bppppppb', '.bwwwwb.'], { b: '#5a2a13', p: '#7b3fa0', P: '#d29bff', w: '#ece4d2' }],
  furnace: [['gggggggg', 'gddddddg', 'gdkkkkdg', 'gdkffkdg', 'gdkfFkdg', 'gddddddg', 'gGgGgGgg', 'gggggggg'], { g: '#7d7d7d', d: '#585858', k: '#1d1d1d', f: '#ff8a00', F: '#ffd23a', G: '#666666' }],
  furnaceCold: [['gggggggg', 'gddddddg', 'gdkkkkdg', 'gdkkkkdg', 'gdkkkkdg', 'gddddddg', 'gGgGgGgg', 'gggggggg'], { g: '#7d7d7d', d: '#585858', k: '#1d1d1d', G: '#666666' }],
  grass: [['GgGggGgG', 'gdgGdggd', 'dDdgdDdd', 'ddDddddD', 'dddDdddd', 'dDdddDdd', 'ddddDddd', 'dddddddD'], { g: '#5fa83b', G: '#4a8f2c', d: '#8b5a35', D: '#6e4527' }],
  sun: [['yyyyyyyy', 'yYYYYYYy', 'yYwwwwYy', 'yYwwwwYy', 'yYwwwwYy', 'yYwwwwYy', 'yYYYYYYy', 'yyyyyyyy'], { y: '#ffd93b', Y: '#ffea7a', w: '#fffbe0' }],
  moon: [['mmmmmmmm', 'mMmmmmmm', 'mmmmMMmm', 'mmmmMMmm', 'mMMmmmmm', 'mMMmmmMm', 'mmmmmmmm', 'mmmmmmmm'], { m: '#f1f0d6', M: '#c9c7a8' }],
  // 8×16: head, body, feet
  creeper: [
    ['gGggggGg', 'ggGggggg', 'gkkggkkg', 'gkkggkkg', 'gggkkggg', 'ggkkkkgg', 'ggkkkkgg', 'ggkggkgg', '.gGgggg.', '.ggggGg.', '.gggggg.', '.gGgggg.', '.ggggGg.', '.gggggg.', 'gggggggg', 'gg.gg.gg'],
    { g: '#5cb85c', G: '#3e8e3e', k: '#10200f' },
  ],
  // 12×17: Claude the miner, coral shirt, without the right arm (that one swings)
  miner: [
    ['..hhhhhhhh..', '..hhhhhhhh..', '..hssssssh..', '..swpsswps..', '..ssssssss..', '..sssmmsss..', '..ssssssss..', 'aatttttttt..', 'aatttttttt..', 'aatttttttt..', 'aatttttttt..', 'sstttttttt..', '..llllllll..', '..llllllll..', '..lll..lll..', '..lll..lll..', '..ggg..ggg..'],
    { h: '#3b2a1d', s: '#e0ac8a', w: '#ffffff', p: '#2d3a8c', m: '#b07a5c', a: '#c96442', t: '#d97757', l: '#3b4a7a', g: '#4a4a4a' },
  ],
}

const HEART = ['.kk.kk..', 'kffkffk.', 'kfffffk.', 'kfffffk.', '.kfffk..', '..kfk...', '...k....', '........']
const DRUMSTICK = ['......kk', '.....kwk', '..kkkkk.', '.kffffk.', 'kfffffk.', 'kffffk..', 'kfffk...', '.kkk....']

// A bar icon with 2, 1 or 0 lit halves: 'f' lit, 'e' empty
function halves(rows, lit) {
  return rows.map((row) => [...row].map((ch, col) => (ch === 'f' ? (lit === 2 || (lit === 1 && col < 4) ? 'f' : 'e') : ch)).join(''))
}

// The pickaxe tier shows on the miner's tool
const PICK_COLOR = { Wooden: '#a07a46', Stone: '#9a9a9a', Iron: '#e2e2e2', Diamond: '#4be8df', Netherite: '#5a4b4b' }

// The sky's colors, top and horizon, as the context window fills
const SKY = [
  [0.0, '#f39a63', '#ffe0b0'],
  [0.15, '#79c0ff', '#d2ecff'],
  [0.5, '#4a9fff', '#a6d6ff'],
  [0.72, '#ff9e5e', '#ffd49a'],
  [0.84, '#3e2f70', '#e9735b'],
  [0.93, '#070b24', '#1a2552'],
]

function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

export function skyAt(p) {
  if (p <= SKY[0][0]) return [SKY[0][1], SKY[0][2]]
  for (let i = 1; i < SKY.length; i++) {
    if (p <= SKY[i][0]) {
      const t = (p - SKY[i - 1][0]) / (SKY[i][0] - SKY[i - 1][0])
      return [mix(SKY[i - 1][1], SKY[i][1], t), mix(SKY[i - 1][2], SKY[i][2], t)]
    }
  }
  const last = SKY[SKY.length - 1]
  return [last[1], last[2]]
}

// What each slot stands for, in its tooltip
const HOW = {
  stone: 'file reads and searches',
  planks: 'edits and writes',
  tnt: 'shell commands',
  diamond: 'green test runs',
  emerald: 'commits',
  redstone: 'MCP tool calls',
  egg: 'subagents',
  pearl: 'web fetches and searches',
  book: 'skills',
}

function tree(x, scale = 1, isSnowy = false) {
  const s = scale
  const snow = isSnowy
    ? `<rect x="-14" y="-72" width="28" height="4" fill="#f4f8ff"/><rect x="-20" y="-62" width="40" height="3" fill="#f4f8ff"/><rect x="-24" y="-34" width="10" height="2" fill="#f4f8ff"/>`
    : ''
  return (
    `<g transform="translate(${r1(x)},${GROUND}) scale(${s})">` +
    `<rect x="-4" y="-34" width="8" height="34" fill="#6b4f2a"/><rect x="-1" y="-34" width="2" height="34" fill="#5a4022"/>` +
    `<rect x="-20" y="-60" width="40" height="28" fill="#3f8f2f"/><rect x="-14" y="-70" width="28" height="12" fill="#3f8f2f"/>` +
    `<rect x="-16" y="-56" width="6" height="6" fill="#2f6f23"/><rect x="6" y="-48" width="6" height="6" fill="#2f6f23"/>` +
    `<rect x="-6" y="-66" width="6" height="6" fill="#4caf3a"/><rect x="10" y="-60" width="6" height="6" fill="#4caf3a"/>` +
    `<rect x="-20" y="-40" width="8" height="6" fill="#2f6f23"/>${snow}</g>`
  )
}

function cloud(now, y, w, seconds, offset, W, night, isGrey) {
  const fill = night > 0.5 ? '#9aa3c0' : isGrey ? '#d9dfe7' : '#ffffff'
  return (
    `<g opacity="${night > 0.5 ? 0.35 : 0.9}"><animateTransform attributeName="transform" type="translate" from="${-w - 20} ${r1(y)}" to="${W + 20} ${r1(y)}" dur="${seconds}s" begin="${phase(now + offset, seconds)}" repeatCount="indefinite"/>` +
    `<rect width="${w}" height="8" fill="${fill}"/><rect x="${r1(w * 0.18)}" y="-6" width="${r1(w * 0.46)}" height="6" fill="${fill}"/>` +
    `<rect x="${r1(w * 0.1)}" y="8" width="${r1(w * 0.7)}" height="3" fill="${fill}" opacity="0.8"/></g>`
  )
}

// The whole band. `v` is the view register.js builds; W is the scene's width in units.
export function sceneSvg(v) {
  const { W, now } = v
  const H = SCENE_H
  const p = typeof v.contextUsed === 'number' ? clamp(v.contextUsed / 100, 0, 1) : 0.35
  const [skyTop, skyLow] = skyAt(p)
  const night = clamp((p - 0.8) / 0.13, 0, 1)
  const hudX = Math.round(W / 2 - HUD_W / 2)
  const hudY = H - 82 - 6
  const leftEnd = hudX - 14
  const rightStart = hudX + HUD_W + 14
  const rz = W - rightStart
  const tier = pickaxeOf(v.level)
  const limit = typeof v.fiveHourUsed === 'number' ? v.fiveHourUsed : 0
  const weekly = typeof v.sevenDayUsed === 'number' ? v.sevenDayUsed : 0
  const weather = v.weather && v.weather !== 'auto' ? v.weather : limit >= 90 ? 'storm' : weekly >= 70 ? 'snow' : limit >= 70 ? 'rain' : 'clear'
  const isStorm = weather === 'storm'
  const isRaining = weather === 'rain' || isStorm
  const isSnowing = weather === 'snow'
  // One seeded stream per layer, so a layer drawn or skipped never moves another
  const starRand = rng(1)
  const cloudRand = rng(2)
  const floraRand = rng(3)
  const rainRand = rng(4)
  const snowRand = rng(5)

  // --- defs ----------------------------------------------------------------
  let defs =
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skyTop}"/><stop offset="1" stop-color="${skyLow}"/></linearGradient>` +
    `<radialGradient id="glow"><stop offset="0" stop-color="#ffcf6a" stop-opacity="0.55"/><stop offset="1" stop-color="#ffcf6a" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="frame"><rect width="${W}" height="${H}"/></clipPath>` +
    `<pattern id="grass" width="24" height="24" patternUnits="userSpaceOnUse"><g transform="scale(3)">${art(...TEX.grass)}</g></pattern>`
  for (const id of [...HOTBAR, 'furnace', 'furnaceCold', 'sun', 'moon', 'creeper', 'miner']) defs += `<g id="t-${id}">${art(...TEX[id])}</g>`
  for (const lit of [0, 1, 2]) {
    defs += `<g id="h${lit}">${art(halves(HEART, lit), { k: '#1a1a1a', f: '#e8262c', e: '#3c3c3c' })}</g>`
    defs += `<g id="d${lit}">${art(halves(DRUMSTICK, lit), { k: '#1a1a1a', f: '#c8742b', e: '#3c3c3c', w: lit ? '#ededed' : '#4a4a4a' })}</g>`
  }

  // --- sky: gradient, stars, sun or moon, clouds -----------------------------
  let sky = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`
  if (night > 0) {
    for (let i = 0; i < Math.round(W / 25); i++) {
      const x = r1(starRand() * W)
      const y = r1(starRand() * (GROUND - 34))
      const size = starRand() > 0.8 ? 2.5 : 1.5
      const a = r1(night * (0.5 + starRand() * 0.5))
      const seconds = r1(2 + starRand() * 3)
      sky += `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#fff" opacity="${a}"><animate attributeName="opacity" values="${a};${r1(a * 0.2)};${a}" dur="${seconds}s" begin="${phase(now + i * 997, seconds)}" repeatCount="indefinite"/></rect>`
    }
  }
  if (p < 0.88) {
    const t = Math.min(p / 0.85, 1)
    const x = r1(W * (0.04 + 0.92 * t) - 16)
    const y = r1(46 - 36 * Math.sin(Math.PI * t))
    sky += `<g transform="translate(${x},${y})"><title>Context ${Math.round(p * 100)}% used: the sun sets as it fills</title><rect x="-6" y="-6" width="44" height="44" fill="#fff6c0" opacity="0.25"/><g transform="scale(4)"><use href="#t-sun"/></g></g>`
  }
  if (p >= 0.84) {
    const t = clamp((p - 0.84) / 0.16, 0, 1)
    const x = r1(W * (0.04 + 0.92 * t) - 14)
    const y = r1(46 - 36 * Math.sin(Math.PI * t))
    sky += `<g transform="translate(${x},${y}) scale(3.5)"><title>Context ${Math.round(p * 100)}% used: night. /compact brings the sunrise</title><use href="#t-moon"/></g>`
  }
  for (let i = 0; i < Math.max(5, Math.round(W / 190)); i++) {
    const seconds = Math.round(150 + cloudRand() * 90)
    sky += cloud(now, 6 + cloudRand() * 30, Math.round(40 + cloudRand() * 50), seconds, cloudRand() * seconds * 1000, W, night || (isRaining ? 0.6 : 0), isSnowing)
  }
  if (isRaining) sky += `<rect width="${W}" height="${H}" fill="#3a4250" opacity="${isStorm ? 0.45 : 0.25}"/>`
  if (isSnowing) sky += `<rect width="${W}" height="${H}" fill="#c9d6e3" opacity="0.32"/>`

  // --- world: ground, trees, flowers, Claude, furnace, sign, creeper --------
  let world = `<rect x="0" y="${GROUND}" width="${W}" height="${H - GROUND}" fill="url(#grass)"/>`
  // Snow settles on the grass in a white layer, a little uneven
  if (isSnowing) {
    world += `<g><title>Snow: 7-day limit ${weekly}% used</title><rect x="0" y="${GROUND - 1}" width="${W}" height="5" fill="#f4f8ff"/>`
    for (let x = 0; x < W; x += 18 + Math.round(snowRand() * 30)) world += `<rect x="${x}" y="${GROUND - 3}" width="${8 + Math.round(snowRand() * 14)}" height="2" fill="#f4f8ff"/>`
    world += `<rect x="0" y="${GROUND + 4}" width="${W}" height="2" fill="#dfe8f2" opacity="0.8"/></g>`
  }
  // Trees and flowers fill the room either side of the HUD, more of them on a wide band
  if (leftEnd > 60) world += tree(leftEnd * 0.12, 0.9, isSnowing)
  if (leftEnd > 420) world += tree(leftEnd * 0.84, 0.8, isSnowing)
  if (rz > 150) world += tree(rightStart + rz * 0.93, 1, isSnowing)
  if (rz > 460) world += tree(rightStart + rz * 0.36, 0.85, isSnowing)
  for (let i = 0; i < Math.round(W / 70); i++) {
    const isLeft = i % 2 === 0
    const zoneStart = isLeft ? 0 : rightStart
    const zoneW = isLeft ? leftEnd : rz
    const x = r1(zoneStart + floraRand() * zoneW)
    const color = ['#e8262c', '#ffd93b', '#ffffff', '#c86bff'][Math.floor(floraRand() * 4)]
    const isFlower = floraRand() > 0.5
    if (zoneW < 40) continue
    world += isFlower ? `<rect x="${x}" y="${GROUND - 6}" width="1.5" height="6" fill="#3e8e3e"/><rect x="${r1(x - 1)}" y="${GROUND - 8}" width="3.5" height="3" fill="${color}"/>` : `<path fill="#4caf3a" d="M${x} ${GROUND}l1 -5l1 5zM${r1(x + 2)} ${GROUND}l1.5 -7l1.5 7z"/>`
  }

  // Claude, mining when a turn runs, standing by when it doesn't
  const mx = Math.max(18, Math.round(leftEnd * 0.46))
  const minerTop = GROUND - 17 * PX
  const bx = Math.round(mx + 13 * PX)
  const working = v.isWorking === true
  const swing = working
    ? `<animateTransform attributeName="transform" type="rotate" values="-60 10.5 7.5;22 10.5 7.5;-60 10.5 7.5" keyTimes="0;0.4;1" dur="0.6s" begin="${phase(now, 0.6)}" repeatCount="indefinite"/>`
    : ''
  const bob = working ? '' : `<animateTransform attributeName="transform" type="translate" values="0 0;0 -0.8;0 0" dur="2.6s" begin="${phase(now, 2.6)}" repeatCount="indefinite"/>`
  world +=
    `<g transform="translate(${mx},${r1(minerTop)})"><title>Claude${working ? ': mining' : ': waiting for you'} · ${tier} pickaxe</title><g>${bob}<g transform="scale(${PX})">` +
    `<use href="#t-miner"/><g transform="rotate(${working ? 0 : -12} 10.5 7.5)"><g>${swing}` +
    `<rect x="10" y="7" width="2" height="4" fill="#c96442"/><rect x="10" y="11" width="2" height="1" fill="#e0ac8a"/>` +
    `<rect x="10.5" y="4.5" width="1" height="7" fill="#7a5230"/><path fill="${PICK_COLOR[tier]}" d="M8 3.6h7v1.2h-7zM7.2 4.6h1.4v1.2h-1.4zM14.4 4.6h1.4v1.2h-1.4z"/>` +
    `</g></g></g></g>` +
    `<g transform="translate(${r1(5 * PX)},-12)"><rect x="-17" y="-1" width="34" height="10" fill="#000" opacity="0.45"/><text x="0" y="6.5" text-anchor="middle" font-size="7" fill="#fff">Claude</text></g></g>`
  // The block Claude works on: cracks and chips fly while it swings
  world += `<g transform="translate(${bx},${GROUND - 24}) scale(3)"><use href="#t-stone"/></g>`
  if (working) {
    world += `<path d="M${bx + 4} ${GROUND - 20}l6 6l-2 5l7 6M${bx + 20} ${GROUND - 22}l-5 7l3 4" stroke="#1d1d1d" stroke-width="1.2" fill="none" opacity="0"><animate attributeName="opacity" values="0;0.9;0" keyTimes="0;0.45;1" dur="0.6s" begin="${phase(now, 0.6)}" repeatCount="indefinite"/></path>`
    for (const [dx, dy] of [[-10, -14], [-4, -20], [6, -16], [-12, -6]]) {
      world += `<rect x="${bx + 2}" y="${GROUND - 18}" width="2.5" height="2.5" fill="#9a9a9a" opacity="0"><animate attributeName="opacity" values="0;1;0" keyTimes="0;0.4;1" dur="0.6s" begin="${phase(now, 0.6)}" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 0;0 0;${dx} ${dy}" keyTimes="0;0.4;1" dur="0.6s" begin="${phase(now, 0.6)}" repeatCount="indefinite"/></rect>`
    }
  }
  // A torch beside Claude, lit once the sun goes down
  const tx = mx - 10
  world += `<rect x="${tx}" y="${GROUND - 12}" width="2.4" height="12" fill="#7a5230"/><rect x="${tx - 0.4}" y="${GROUND - 15}" width="3.2" height="3.2" fill="#ffb300"/>`
  if (night > 0.2) {
    world += `<circle cx="${tx + 1.2}" cy="${GROUND - 13}" r="34" fill="url(#glow)" opacity="${r1(night)}"><animate attributeName="r" values="32;36;33;35;32" dur="1.4s" begin="${phase(now, 1.4)}" repeatCount="indefinite"/></circle>`
  }

  // The furnace: lit and smoking while /smelt runs, the arrow filling on its own
  const fx = Math.round(rightStart + Math.max(8, rz * 0.06))
  if (v.smelt) {
    const total = v.smelt.endsAt - v.smelt.startedAt
    const left = Math.max(0, v.smelt.endsAt - now)
    const done = clamp(1 - left / total, 0, 1)
    const minutes = left > 60_000 ? Math.ceil(left / 60_000) + 'm' : clockOf(left)
    world +=
      `<g><title>Smelting "${esc(v.smelt.label)}": ${clockOf(left)} left. /smelt stop puts it out</title>` +
      `<g transform="translate(${fx},${GROUND - 32}) scale(4)"><use href="#t-furnace"/></g>` +
      `<rect x="${fx + 12}" y="${GROUND - 20}" width="8" height="8" fill="#ffe08a" opacity="0.4"><animate attributeName="opacity" values="0.15;0.6;0.3;0.55;0.15" dur="0.9s" begin="${phase(now, 0.9)}" repeatCount="indefinite"/></rect>`
    for (let i = 0; i < 3; i++) {
      world += `<rect x="${fx + 13 + i * 3}" y="${GROUND - 36}" width="3.5" height="3.5" fill="#bdbdbd" opacity="0"><animate attributeName="opacity" values="0;0.7;0" dur="2.4s" begin="${phase(now + i * 800, 2.4)}" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 0;${2 - i * 2} -22" dur="2.4s" begin="${phase(now + i * 800, 2.4)}" repeatCount="indefinite"/></rect>`
    }
    const ax = fx + 38
    const ay = GROUND - 22
    const arrow = `M${ax} ${ay - 3}h16v-3l6 6l-6 6v-3h-16z`
    world +=
      `<path d="${arrow}" fill="#3c3c3c" stroke="#000" stroke-width="0.8"/>` +
      `<clipPath id="arrowfill"><rect x="${ax}" y="${ay - 7}" width="${r1(22 * done)}" height="14"><animate attributeName="width" from="${r1(22 * done)}" to="22" dur="${Math.max(1, Math.round(left / 1000))}s" fill="freeze"/></rect></clipPath>` +
      `<path d="${arrow}" fill="#fff" clip-path="url(#arrowfill)"/>` +
      `<text x="${ax + 26}" y="${ay + 3}" font-size="9" fill="#fff" stroke="#000" stroke-width="1.6" paint-order="stroke">${minutes}</text>` +
      `<g transform="translate(${fx + 16},${GROUND - 42})"><rect x="-34" y="-8" width="68" height="11" fill="#000" opacity="0.5"/><text x="0" y="0.5" text-anchor="middle" font-size="7" fill="#ffd23a">${esc(v.smelt.label.slice(0, 16))}</text></g></g>`
  } else {
    world += `<g transform="translate(${fx},${GROUND - 32}) scale(4)"><title>Furnace cold: /smelt 25 &lt;task&gt; lights it</title><use href="#t-furnaceCold"/></g>`
  }

  // A finished smelt: the furnace pops its XP for four seconds
  if (v.smeltDone && now - v.smeltDone.at < 4000) {
    world +=
      `<g opacity="0"><animate attributeName="opacity" values="1;1;0" keyTimes="0;0.75;1" dur="4s" begin="${since(now, v.smeltDone.at)}" fill="freeze"/>` +
      `<animateTransform attributeName="transform" type="translate" values="${fx + 16} ${GROUND - 40};${fx + 16} ${GROUND - 70}" dur="4s" begin="${since(now, v.smeltDone.at)}" fill="freeze"/>` +
      `<path fill="#e6e6e6" stroke="#6b6b6b" stroke-width="0.8" d="M-10 -2h16l4 -6h-16z"/>` +
      `<text x="0" y="12" text-anchor="middle" font-size="9" fill="#ffd23a" stroke="#000" stroke-width="1.8" paint-order="stroke">Smelted! +${v.smeltDone.minutes} XP</text></g>`
  }

  // The sign: level and pickaxe, lifetime blocks, today's XP
  if (rz > 200) {
    const sx = Math.round(rightStart + rz * 0.56)
    world +=
      `<g transform="translate(${sx},${GROUND})"><title>Lifetime: ${v.lifetimeTotal} blocks · today +${v.todayXp} XP</title>` +
      `<rect x="-2.5" y="-20" width="5" height="20" fill="#6b4f2a"/><rect x="-50" y="-64" width="100" height="46" fill="#b98a50" stroke="#6b4f2a" stroke-width="2.5"/>` +
      `<text text-anchor="middle" font-size="9" fill="#2b1d0e"><tspan x="0" y="-49">Lv ${v.level} · ${tier}</tspan><tspan x="0" y="-37">${v.lifetimeTotal} mined</tspan><tspan x="0" y="-25">today +${v.todayXp} XP</tspan></text></g>`
  }

  // Night brings a creeper: the context is nearly full, it wants a /compact
  if (night >= 0.35 && rz > 120) {
    const cx = Math.round(rightStart + rz * (rz > 190 ? 0.8 : 0.62))
    world +=
      `<g transform="translate(${cx},${GROUND - 16 * 2.4})"><title>Context ${Math.round(p * 100)}% used. Run /compact before the creeper does</title>` +
      `<g><animateTransform attributeName="transform" type="translate" values="0 0;1.5 0;0 0;-1.5 0;0 0" dur="3.2s" begin="${phase(now, 3.2)}" repeatCount="indefinite"/><g transform="scale(2.4)"><use href="#t-creeper"/></g></g>` +
      `<g transform="translate(10,-12)"><rect x="-26" y="-9" width="52" height="12" rx="2" fill="#fff"/><path d="M-4 3l4 5l2 -5z" fill="#fff"/><text x="0" y="-0.5" text-anchor="middle" font-size="7" fill="#1d1d1d">ssss… /compact</text></g></g>`
  }

  // A red test run: a creeper hisses beside Claude for three seconds
  if (v.creeperAt && now - v.creeperAt < 3000) {
    const cx = bx + 30
    world +=
      `<g transform="translate(${cx},${GROUND - 16 * 2.2})" opacity="1"><animate attributeName="opacity" values="1;1;0" keyTimes="0;0.85;1" dur="3s" begin="${since(now, v.creeperAt)}" fill="freeze"/>` +
      `<title>Tests failed</title><g transform="scale(2.2)"><use href="#t-creeper"/></g>` +
      `<rect width="${8 * 2.2}" height="${16 * 2.2}" fill="#fff" opacity="0"><animate attributeName="opacity" values="0;0.85;0" dur="0.3s" begin="${phase(now, 0.3)}" repeatCount="indefinite"/></rect>` +
      `<text x="9" y="-4" text-anchor="middle" font-size="8" fill="#fff" stroke="#000" stroke-width="1.6" paint-order="stroke">tests failed</text></g>`
  }

  let tint = night > 0 ? `<rect width="${W}" height="${H}" fill="#0a1033" opacity="${r1(night * 0.42)}"/>` : ''
  // Rain past 70% of the 5-hour limit; past 90%, lightning too
  if (isRaining) {
    for (let i = 0; i < Math.round(W / (isStorm ? 9 : 16)); i++) {
      const x = r1(rainRand() * (W + 40))
      const seconds = r1(0.55 + rainRand() * 0.3)
      tint += `<rect x="${x}" y="-12" width="1.2" height="9" fill="#a9c8ff" opacity="0.55"><animateTransform attributeName="transform" type="translate" values="0 0;-8 ${GROUND + 12}" dur="${seconds}s" begin="${phase(now + i * 131, seconds)}" repeatCount="indefinite"/></rect>`
    }
  }
  // Snowflakes drift down slowly, swaying as they fall
  if (isSnowing) {
    for (let i = 0; i < Math.round(W / 11); i++) {
      const x = r1(snowRand() * W)
      const seconds = r1(4 + snowRand() * 4)
      const size = snowRand() > 0.7 ? 2.6 : 1.6
      const sway = r1(3 + snowRand() * 5)
      tint += `<rect x="${x}" y="-6" width="${size}" height="${size}" fill="#fff" opacity="0.92"><animateTransform attributeName="transform" type="translate" values="0 0;${sway} ${r1(GROUND * 0.33)};${-sway} ${r1(GROUND * 0.66)};${r1(sway / 2)} ${GROUND + 6}" dur="${seconds}s" begin="${phase(now + i * 173, seconds)}" repeatCount="indefinite"/></rect>`
    }
  }
  if (isStorm) {
    tint += `<rect width="${W}" height="${H}" fill="#fff" opacity="0"><animate attributeName="opacity" values="0;0;0.7;0;0.45;0;0" keyTimes="0;0.8;0.82;0.85;0.87;0.9;1" dur="7s" begin="${phase(now, 7)}" repeatCount="indefinite"/></rect>`
  }

  // --- HUD: hearts, hunger, XP bar, hotbar, centered as in the game ---------
  const shake = (i, on) => (on ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -0.8;0 0.6;0 0" dur="0.32s" begin="${phase(now + i * 61, 0.32)}" repeatCount="indefinite"/>` : '')
  let hearts = ''
  let hunger = ''
  for (let i = 0; i < 10; i++) {
    const h = clamp(v.hearts - i * 2, 0, 2)
    const d = clamp(v.hunger - i * 2, 0, 2)
    hearts += `<g transform="translate(${i * 8},0)"><g>${shake(i, v.hearts <= 6)}<use href="#h${h}"/></g></g>`
    hunger += `<g transform="translate(${174 - i * 8},0)"><g>${shake(i, v.hunger <= 6)}<use href="#d${d}"/></g></g>`
  }
  const fiveHour = typeof v.fiveHourUsed === 'number' ? `5-hour limit ${v.fiveHourUsed}% used${isStorm ? ': thunderstorm' : isRaining ? ': rain' : ''}` : 'no plan-limit reading yet'
  const ctx = typeof v.contextUsed === 'number' ? `context ${v.contextUsed}% used` : 'no context reading yet'
  const filled = Math.round(180 * clamp(v.progress, 0, 1))
  let hud =
    `<g><title>Hearts: ${fiveHour}</title>${hearts}</g><g><title>Hunger: ${ctx}${v.hunger <= 6 ? '. Eat: /compact' : ''}</title>${hunger}</g>` +
    `<g><title>Level ${v.level} · ${v.into}/${v.need} XP to ${v.level + 1} · ${tier} pickaxe</title>` +
    `<rect x="0" y="11" width="182" height="5" fill="#000"/><rect x="1" y="12" width="180" height="3" fill="#2a2a2a"/>`
  if (filled > 0) {
    hud +=
      `<rect x="1" y="12" width="${filled}" height="3" fill="#80ff20"/>` +
      `<clipPath id="xpfill"><rect x="1" y="12" width="${filled}" height="3"/></clipPath>` +
      `<rect y="12" width="8" height="3" fill="#fff" opacity="0.55" clip-path="url(#xpfill)"><animate attributeName="x" values="-8;${filled + 2};${filled + 2}" keyTimes="0;0.5;1" dur="4s" begin="${phase(now, 4)}" repeatCount="indefinite"/></rect>`
  }
  for (let n = 1; n < 18; n++) hud += `<rect x="${1 + n * 10}" y="12" width="1" height="3" fill="#000" opacity="0.45"/>`
  hud += `<text x="91" y="14.5" text-anchor="middle" font-size="8" fill="#80ff20" stroke="#000" stroke-width="1.6" paint-order="stroke">${v.level}</text></g>`
  hud += `<rect x="1" y="20" width="182" height="22" fill="#000" opacity="0.35"/><rect x="0" y="19" width="182" height="22" fill="#000"/>`
  HOTBAR.forEach((id, i) => {
    const count = v.counts[id] ?? 0
    const x = 1 + i * 20
    hud +=
      `<g class="slot"><title>${BLOCKS[id].name} × ${count}: ${HOW[id]}</title><rect x="${x}" y="20" width="20" height="20" fill="#8b8b8b"/><rect x="${x + 1}" y="21" width="18" height="18" fill="#6f6f6f"/>` +
      `<g class="lift"><g transform="translate(${x + 2},22) scale(2)" opacity="${count > 0 ? 1 : 0.28}"><use href="#t-${id}"/></g></g></g>`
  })
  const pick = HOTBAR.indexOf(v.selected)
  if (pick >= 0) hud += `<rect x="${pick * 20}" y="19" width="22" height="22" fill="none" stroke="#f4f4f4" stroke-width="1.5"/>`
  HOTBAR.forEach((id, i) => {
    const count = v.counts[id] ?? 0
    if (count > 0) hud += `<text x="${20 + i * 20}" y="39" text-anchor="end" font-size="7" fill="#fff" stroke="#3f3f3f" stroke-width="1" paint-order="stroke">${count > 999 ? '999+' : count}</text>`
  })

  // --- effects: pickups, level-up, milestone --------------------------------
  let fx2 = ''
  for (const pickup of v.recent ?? []) {
    if (now - pickup.at > 1600) continue
    const i = HOTBAR.indexOf(pickup.id)
    if (i < 0) continue
    const x = hudX + (1 + i * 20 + 10) * 2
    const y = hudY + 36
    fx2 +=
      `<g opacity="0"><animate attributeName="opacity" values="1;1;0" keyTimes="0;0.6;1" dur="1.6s" begin="${since(now, pickup.at)}" fill="freeze"/>` +
      `<animateTransform attributeName="transform" type="translate" values="${x} ${y};${x} ${y - 30}" dur="1.6s" begin="${since(now, pickup.at)}" fill="freeze"/>` +
      `<g transform="translate(-12,-8) scale(1.5)"><use href="#t-${pickup.id}"/></g><text x="3" y="2" font-size="9" fill="#fff" stroke="#000" stroke-width="1.6" paint-order="stroke">+1</text></g>`
  }
  if (v.levelUpAt && now - v.levelUpAt < 3500) {
    const cx = W / 2
    fx2 +=
      `<g transform="translate(${cx},${hudY - 8})" opacity="0"><animate attributeName="opacity" values="1;1;0" keyTimes="0;0.8;1" dur="3.5s" begin="${since(now, v.levelUpAt)}" fill="freeze"/>` +
      `<g><animateTransform attributeName="transform" type="scale" values="0.2;1.3;1" keyTimes="0;0.15;1" dur="3.5s" begin="${since(now, v.levelUpAt)}" fill="freeze"/>` +
      `<text text-anchor="middle" font-size="14" fill="#80ff20" stroke="#000" stroke-width="2.4" paint-order="stroke">LEVEL ${v.level}!</text></g></g>`
    for (let i = 0; i < 8; i++) {
      const from = `${mx + 18} ${GROUND - 30}`
      const to = `${hudX + 30 + i * 40} ${hudY + 26}`
      const begin = since(now, v.levelUpAt + i * 120)
      fx2 += `<rect width="4" height="4" fill="#c8ff3c" stroke="#5a8a00" stroke-width="0.8" opacity="0"><animate attributeName="opacity" values="1;1;0" keyTimes="0;0.85;1" dur="1.1s" begin="${begin}" fill="freeze"/><animateMotion path="M${from} Q${r1((mx + hudX) / 2)} ${-10 - i * 4} ${to}" dur="1.1s" begin="${begin}" fill="freeze"/></rect>`
    }
  }
  if (v.advancement && now - v.advancement.at < 6000) {
    const ax = W - 214
    fx2 +=
      `<g transform="translate(${ax},8)"><g><animateTransform attributeName="transform" type="translate" values="230 0;0 0;0 0;230 0" keyTimes="0;0.08;0.9;1" dur="6s" begin="${since(now, v.advancement.at)}" fill="freeze"/>` +
      `<rect width="206" height="38" rx="3" fill="#212121" stroke="#5a5a5a" stroke-width="1.5"/><g transform="translate(8,7) scale(3)"><use href="#t-${v.advancement.icon}"/></g>` +
      `<text x="42" y="16" font-size="8" fill="#ffff55">Milestone reached!</text><text x="42" y="29" font-size="9" fill="#fff">${esc(v.advancement.title)}</text></g></g>`
  }

  const style =
    // color-scheme matches the app's theme, so the frame stays see-through, never white
    `<style>:root{color-scheme:light dark}text{font-family:ui-monospace,Menlo,Monaco,monospace;font-weight:700}` +
    `.slot .lift{transition:transform .15s ease-out}.slot:hover .lift{transform:translateY(-1.5px)}</style>`
  const source =
    // slice: if the frame's shape is ever off by a pixel, crop the edges rather than letterbox
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges">${style}<defs>${defs}</defs>` +
    `<g clip-path="url(#frame)">${sky}${world}${tint}<g transform="translate(${hudX},${hudY}) scale(2)">${hud}</g>${fx2}</g></svg>`
  return { source, width: W, height: H }
}
