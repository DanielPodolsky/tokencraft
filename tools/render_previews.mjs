// Renders the README's scene previews straight from hooks/scene.js: the same
// function the Desktop band calls, fed fixed views, so the pictures are the mod's
// own output. The SVGs animate (SMIL) wherever an <img> shows them; hover tooltips
// don't, since an <img> takes no input.
// Run from the repo root: node tools/render_previews.mjs

import { writeFileSync } from 'node:fs'
import { levelOf } from '../hooks/blocks.js'
import { sceneSvg } from '../hooks/scene.js'

const NOW = 1_759_400_000_000
const W = 1000
const COUNTS = { stone: 48, planks: 17, tnt: 12, diamond: 3, emerald: 2, redstone: 6, egg: 1, pearl: 4, book: 2 }

// A mid-session view; each preview overrides what it is about
const view = (overrides) => ({
  W,
  now: NOW,
  ...levelOf(260),
  hearts: 16,
  hunger: 13,
  counts: COUNTS,
  selected: 'planks',
  contextUsed: 35,
  fiveHourUsed: 20,
  sevenDayUsed: 30,
  weather: 'auto',
  isWorking: true,
  recent: [],
  levelUpAt: 0,
  advancement: null,
  creeperAt: 0,
  smelt: null,
  smeltDone: null,
  lifetimeTotal: 1_284,
  todayXp: 86,
  ...overrides,
})

const PREVIEWS = {
  // Fresh-ish context: blue sky, Claude mining while a turn runs
  day: view({}),
  // Context 76% used: the sun goes down; 5-hour limit 78% used: rain
  sunset: view({ contextUsed: 76, hunger: 5, fiveHourUsed: 78, hearts: 4, isWorking: false }),
  // Context 94% used: night, and a creeper asking for /compact
  night: view({ contextUsed: 94, hunger: 1, isWorking: false, selected: 'diamond' }),
  // 5-hour limit 95% used: a thunderstorm
  storm: view({ contextUsed: 55, hunger: 9, fiveHourUsed: 95, hearts: 1 }),
  // 7-day limit 82% used: snow; /smelt running: the furnace burns
  snow: view({ contextUsed: 20, hunger: 16, sevenDayUsed: 82, isWorking: false, smelt: { startedAt: NOW - 9 * 60_000, endsAt: NOW + 16 * 60_000, minutes: 25, label: 'write the tests' } }),
}

for (const [name, v] of Object.entries(PREVIEWS)) {
  const { source } = sceneSvg(v)
  writeFileSync(`docs/previews/${name}.svg`, source + '\n')
  console.log(`docs/previews/${name}.svg  ${(source.length / 1024).toFixed(1)} KB`)
}
