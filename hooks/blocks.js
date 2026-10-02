// Tokencraft — the pure half of the mod: which block a tool call earns, the XP
// curve, and the HUD drawings. Nothing here touches the mods API; register.js
// owns every `$` call, so `claude plugin validate` lists all of them in one place.

// The nine hotbar slots, left to right, like Minecraft's nine
export const HOTBAR = ['stone', 'planks', 'tnt', 'diamond', 'emerald', 'redstone', 'egg', 'pearl', 'book']

// What each block is called, how it shows in text, and the XP it pays
export const BLOCKS = {
  stone: { name: 'stone', emoji: '🪨', xp: 1 },
  planks: { name: 'planks', emoji: '🪵', xp: 2 },
  tnt: { name: 'TNT', emoji: '🧨', xp: 1 },
  diamond: { name: 'diamond', emoji: '💎', xp: 10 },
  emerald: { name: 'emerald', emoji: '💚', xp: 7 },
  redstone: { name: 'redstone', emoji: '🔴', xp: 1 },
  egg: { name: 'spawn egg', emoji: '🥚', xp: 3 },
  pearl: { name: 'ender pearl', emoji: '🟣', xp: 1 },
  book: { name: 'enchanted book', emoji: '📕', xp: 2 },
}

// XP for a finished turn, on top of what its tool calls earned
export const TURN_XP = 3

// A shell command that runs a test suite: green pays a diamond, red spawns a creeper
const TEST_RUN = /\b(pytest|vitest|jest|mocha|rspec|phpunit|go test|cargo test|bun test|deno test|claude plugin test|(npm|pnpm|yarn)( run)? test)\b/
const COMMIT = /\bgit\s+commit\b/

// Which block a finished tool call earns: a block id, 'creeper' for a red test
// run, or null for nothing (refused calls and tools with no block earn nothing)
export function blockFor(tool, input, result) {
  const isRefused = !result || result.deny !== undefined
  if (isRefused) return null
  const isFailed = result.isError === true
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = String(input?.command ?? '')
    if (TEST_RUN.test(command)) return isFailed ? 'creeper' : 'diamond'
    if (isFailed) return null
    return COMMIT.test(command) ? 'emerald' : 'tnt'
  }
  if (isFailed) return null
  if (['Read', 'Grep', 'Glob', 'LS'].includes(tool)) return 'stone'
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) return 'planks'
  if (tool === 'Agent' || tool === 'Task') return 'egg'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'pearl'
  if (tool === 'Skill') return 'book'
  if (tool.startsWith('mcp__')) return 'redstone'
  return null
}

export function emptyCounts() {
  return Object.fromEntries(HOTBAR.map((id) => [id, 0]))
}

export function totalOf(counts) {
  return HOTBAR.reduce((sum, id) => sum + (counts[id] ?? 0), 0)
}

// XP from level L to L+1 — Minecraft Java's own curve
export function xpToNext(level) {
  if (level < 16) return 2 * level + 7
  if (level < 31) return 5 * level - 38
  return 9 * level - 158
}

// A lifetime XP total as a level, the XP into it, and how full the bar is
export function levelOf(totalXp) {
  let level = 0
  let left = Math.max(0, Math.floor(totalXp))
  while (left >= xpToNext(level)) {
    left -= xpToNext(level)
    level += 1
  }
  const need = xpToNext(level)
  return { level, into: left, need, progress: left / need }
}

// The pickaxe tier a level unlocks, shown on level-up and in /f3
export function pickaxeOf(level) {
  if (level >= 30) return 'Netherite'
  if (level >= 20) return 'Diamond'
  if (level >= 10) return 'Iron'
  if (level >= 5) return 'Stone'
  return 'Wooden'
}

// Milestones: one toast each, the first time its condition holds. Titles are our
// own; ids stay as they were, so saved progress keeps counting
export const ADVANCEMENTS = [
  { id: 'stone-age', title: 'Rockhound', icon: 'stone', hint: 'mine 100 stone', when: (s) => s.lifetime.stone >= 100 },
  { id: 'diamonds', title: 'First Diamond', icon: 'diamond', hint: 'a green test run', when: (s) => s.lifetime.diamond >= 1 },
  { id: 'first-trade', title: 'Committed', icon: 'emerald', hint: 'a commit', when: (s) => s.lifetime.emerald >= 1 },
  { id: 'builder', title: 'Master Builder', icon: 'planks', hint: 'place 100 planks', when: (s) => s.lifetime.planks >= 100 },
  { id: 'hot-stuff', title: 'Forged in Focus', icon: 'furnace', hint: 'finish a /smelt', when: (s) => (s.lifetime.smelted ?? 0) >= 1 },
  { id: 'iron-tools', title: 'Iron Will', icon: 'book', hint: 'reach level 10', when: (s) => s.level >= 10 },
]

export function newAdvancements(state, unlocked) {
  return ADVANCEMENTS.filter((a) => !unlocked.includes(a.id) && a.when(state))
}

// Ten icons of two halves each, from a percent of something left
export function halvesOf(percentLeft) {
  if (typeof percentLeft !== 'number' || Number.isNaN(percentLeft)) return 20
  return Math.max(0, Math.min(20, Math.round(percentLeft / 5)))
}

// Hearts are the 5-hour plan limit left; hunger is the context window left
export function vitalsOf(usage) {
  const fiveHour = usage?.rateLimits?.find((r) => r.kind === 'five_hour')
  const sevenDay = usage?.rateLimits?.find((r) => r.kind === 'seven_day')
  const contextUsed = usage?.context?.percent
  return {
    hearts: fiveHour ? halvesOf(100 - fiveHour.percentUsed) : 20,
    hunger: typeof contextUsed === 'number' ? halvesOf(100 - contextUsed) : 20,
    fiveHourUsed: fiveHour?.percentUsed,
    sevenDayUsed: sevenDay?.percentUsed,
    contextUsed,
    contextTokens: usage?.context?.tokens,
    contextWindow: usage?.context?.window,
  }
}

// The first open item of the sprint, read the way MaiOS's board.sh `next` reads it
export function sprintItemOf(markdown) {
  let isInSprint = false
  for (const line of String(markdown).split('\n')) {
    if (/^## Sprint/.test(line)) {
      isInSprint = true
      continue
    }
    if (/^## /.test(line)) {
      isInSprint = false
      continue
    }
    if (!isInSprint || !/^- \[[ ~]\] /.test(line)) continue
    const rest = line.slice(6)
    const cut = rest.indexOf(' — ')
    if (cut < 0) return null
    const parts = rest.slice(cut + 3).split(' · ')
    const spec = parts.slice(1).find((p) => p.startsWith('spec: '))
    return { isActive: line[3] === '~', key: rest.slice(0, cut), name: parts[0], spec: spec ? spec.slice(6) : '' }
  }
  return null
}

// `.git` is a directory in a checkout and a `gitdir:` file in a worktree
export function gitdirOf(dotGitFile) {
  const match = /^gitdir: (.+)$/m.exec(String(dotGitFile))
  return match ? match[1].trim() : null
}

export function branchOf(head) {
  const match = /^ref: refs\/heads\/(.+)$/m.exec(String(head))
  return match ? match[1].trim() : String(head).trim().slice(0, 8) + ' (detached)'
}

// The local calendar day, for today's XP
export function dayOf(ms) {
  return new Date(ms).toLocaleDateString('en-CA')
}

export function clockOf(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
}

// What /smelt was typed with: minutes and a label, or stop
export function parseSmelt(args) {
  const text = String(args ?? '').trim()
  if (/^(stop|off|cancel)$/i.test(text)) return { isStop: true }
  const match = /^(\d+)\s*(.*)$/.exec(text)
  const minutes = match ? Number(match[1]) : 25
  const label = (match ? match[2] : text).trim() || 'focus'
  return { isStop: false, minutes: Math.max(1, Math.min(180, minutes)), label }
}

// The line under an answer: what the turn's tool calls dropped
export function lootLine(loot, creepers, xp, levelUp) {
  const parts = HOTBAR.filter((id) => loot[id] > 0).map((id) => '+' + loot[id] + ' ' + BLOCKS[id].emoji + ' ' + BLOCKS[id].name)
  if (creepers > 0) parts.push('💥 ' + creepers + (creepers === 1 ? ' creeper' : ' creepers'))
  if (parts.length === 0 && !levelUp) return ''
  let line = parts.join(' · ') + (xp > 0 ? ' · +' + xp + ' XP' : '')
  if (levelUp) line += (line ? ' · ' : '') + '⬆ Level ' + levelUp
  return line
}

// The same HUD for the terminal, as colored text runs: [text, color, isBold]
export function hudRuns({ hearts, hunger, level, progress, counts, smelt, now }) {
  const icons = (halves, full, half, empty) =>
    Array.from({ length: 10 }, (_, i) => (halves - i * 2 >= 2 ? full : halves - i * 2 === 1 ? half : empty)).join('')
  const lit = Math.round(20 * Math.max(0, Math.min(1, progress)))
  const top = [
    [icons(hearts, '♥', '♥', '♡'), 'red', false],
    ['  Lv ' + level + ' ', 'green', true],
    ['━'.repeat(lit), 'green', false],
    ['─'.repeat(20 - lit), 'gray', false],
    ['  ' + icons(hunger, '●', '◐', '○'), 'yellow', false],
  ]
  const owned = HOTBAR.filter((id) => (counts[id] ?? 0) > 0)
  const bottom = owned.length
    ? [[owned.map((id) => BLOCKS[id].emoji + ' ' + counts[id]).join('  '), 'white', false]]
    : [['hotbar empty: Claude mines as it works', 'gray', false]]
  if (smelt) {
    const done = Math.max(0, Math.min(1, (now - smelt.startedAt) / (smelt.endsAt - smelt.startedAt)))
    const arrow = Math.round(10 * done)
    const left = smelt.endsAt - now
    const time = left > 60_000 ? Math.ceil(left / 60_000) + 'm' : clockOf(left)
    bottom.push(['   🔥 ' + smelt.label + ' ', 'yellow', false], ['▰'.repeat(arrow) + '▱'.repeat(10 - arrow) + ' ' + time, 'yellow', true])
  }
  return [top, bottom]
}
