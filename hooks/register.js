// Tokencraft — a Minecraft HUD for Claude Code.
//
// Claude's tool calls turn into blocks and XP. The band above the prompt draws
// hearts (5-hour plan limit left), hunger (context left), the XP bar with your
// level, and a nine-slot hotbar of what Claude mined this session — on Desktop
// inside an animated Minecraft world (scene.js), in the terminal as colored text.
// Every answer gets a loot line. /f3 prints where you are; /smelt runs a focus timer.
//
// Where state lives:
//   module variables  this session's hotbar and this turn's loot (lost on reload)
//   $.store           lifetime XP and blocks, milestones, prefs, the furnace —
//                     shared by every session on this Mac
// What it reaches: it reads .git/HEAD (and a MaiOS sprint file, where a repo has one)
// for /f3, and plays two sound files it ships. It starts no process and makes no
// network call.

import {
  BLOCKS,
  TURN_XP,
  blockFor,
  branchOf,
  clockOf,
  emptyCounts,
  gitdirOf,
  dayOf,
  hudRuns,
  levelOf,
  lootLine,
  newAdvancements,
  parseSmelt,
  pickaxeOf,
  sprintItemOf,
  totalOf,
  vitalsOf,
  HOTBAR,
} from './blocks.js'
import { sceneSvg } from './scene.js'

const SOUND_LEVEL_UP = 'sounds/levelup.wav'
const SOUND_SMELTED = 'sounds/smelted.wav'

// Desktop reports the band's width in cells of its code font. Measured from a
// screenshot, a 749 px band reported 89 cells: 8.4 px a cell. The frame the scene is
// drawn in gets exactly that size, one scene unit per pixel; without a size the app
// falls back to a 300×150 frame. A hair under 8.4 so the frame never overflows.
// A different font or zoom has a different cell: the `px_per_column` option (in
// /config) re-tunes it, and /f3's Band line shows the cells and pixels to tune by.
const PX_PER_COLUMN = 8.35
let pxPerColumn = PX_PER_COLUMN

// This session and this turn
let session = emptyCounts()
let turnLoot = emptyCounts()
let turnCreepers = 0
let turnXp = 0
let turnLevelUp = 0
let selected = null
let usage = null
let ticks = 0
// False in a `claude -p` run or a script: nothing draws, so no loot line, toast or sound
let isWatched = true
// What the scene animates: pickups, the last level-up, milestone and red test run
let recent = []
let levelUpAt = 0
let advancement = null
let creeperAt = 0
let smeltDone = null
// /weather's choice for this session; 'auto' follows the plan limits
let weather = 'auto'
// The last band drawn, for /f3 and to skip toasts the scene already shows
let lastBand = null
let lastMinuteShown = null

// Lifetime figures: what $.store held at the last flush, plus what is still pending
let storedXp = 0
let storedLifetime = {}
let pendingXp = 0
let pendingBlocks = {}
let unlocked = []
let prefs = { hud: true, sound: true }
let smelt = null
let todayStored = 0

const xpNow = () => storedXp + pendingXp
const drawsScene = () => lastBand !== null && lastBand.surface !== 'terminal'

function lifetimeNow() {
  const all = { ...storedLifetime }
  for (const [id, n] of Object.entries(pendingBlocks)) all[id] = (all[id] ?? 0) + n
  return all
}

function resetTurn() {
  turnLoot = emptyCounts()
  turnCreepers = 0
  turnXp = 0
  turnLevelUp = 0
}

// What the HUD draws, from the state above
function hudView(now) {
  const vitals = vitalsOf(usage)
  const lvl = levelOf(xpNow())
  return { hearts: vitals.hearts, hunger: vitals.hunger, level: lvl.level, progress: lvl.progress, counts: session, selected, smelt, now }
}

// What the Desktop scene draws: the HUD, plus the world's own state
function sceneView(now, W, isWorking) {
  const vitals = vitalsOf(usage)
  return {
    ...hudView(now),
    ...levelOf(xpNow()),
    W,
    isWorking,
    contextUsed: vitals.contextUsed,
    fiveHourUsed: vitals.fiveHourUsed,
    sevenDayUsed: vitals.sevenDayUsed,
    weather,
    recent,
    levelUpAt,
    advancement,
    creeperAt,
    smeltDone,
    lifetimeTotal: totalOf(lifetimeNow()),
    todayXp: todayStored + pendingXp,
  }
}

function hudAlt(view) {
  return `Level ${view.level}, hearts ${view.hearts / 2} of 10, hunger ${view.hunger / 2} of 10, ${totalOf(view.counts)} blocks this session`
}

// Read the lifetime figures back from $.store
async function load($) {
  const today = (await $.store.get('today')) ?? {}
  todayStored = today.date === dayOf(await $.clock.now()) ? Number(today.xp ?? 0) : 0
  storedXp = Number((await $.store.get('xp')) ?? 0)
  storedLifetime = { ...((await $.store.get('lifetime')) ?? {}) }
  unlocked = [...((await $.store.get('advancements')) ?? [])]
  prefs = { hud: true, sound: true, ...((await $.store.get('prefs')) ?? {}) }
  smelt = (await $.store.get('smelt')) ?? null
}

// Add what this session earned to what $.store holds now, so two sessions earning
// at once both count; a write landing between our get and set is the one loss
async function flush($) {
  if (pendingXp === 0 && Object.keys(pendingBlocks).length === 0) return
  const xpDelta = pendingXp
  const blockDelta = pendingBlocks
  pendingXp = 0
  pendingBlocks = {}
  const xp = Number((await $.store.get('xp')) ?? 0) + xpDelta
  const saved = { ...((await $.store.get('lifetime')) ?? {}) }
  for (const [id, n] of Object.entries(blockDelta)) saved[id] = (saved[id] ?? 0) + n
  storedXp = xp
  storedLifetime = saved
  await $.store.set('xp', xp)
  await $.store.set('lifetime', saved)
  // Today's XP starts over at local midnight
  const date = dayOf(await $.clock.now())
  const today = (await $.store.get('today')) ?? {}
  todayStored = (today.date === date ? Number(today.xp ?? 0) : 0) + xpDelta
  await $.store.set('today', { date, xp: todayStored })
}

// Count one block (or none, for XP alone), then any level-up and milestone
function earn($, block, xp, now) {
  const before = levelOf(xpNow()).level
  if (block) {
    turnLoot[block] += 1
    session[block] += 1
    selected = block
    pendingBlocks[block] = (pendingBlocks[block] ?? 0) + 1
    recent = [...recent.filter((r) => now - r.at < 2000), { id: block, at: now }]
  }
  pendingXp += xp
  turnXp += xp
  const after = levelOf(xpNow()).level
  if (after > before) levelUp($, after, now)
  celebrate($, after, now)
  $.ui.invalidate('ui.render')
}

function levelUp($, level, now) {
  turnLevelUp = level
  levelUpAt = now
  const tier = pickaxeOf(level)
  const isNewTier = tier !== pickaxeOf(level - 1)
  if (!isWatched) return
  // The scene plays its own level-up; a toast there would say it twice
  if (drawsScene() && !isNewTier) {
    if (prefs.sound) $.audio.play({ asset: SOUND_LEVEL_UP }).catch(() => {})
    return
  }
  $.ui.toast('⬆ Level ' + level + (isNewTier ? ' · ' + tier + ' pickaxe unlocked!' : ''), { timeoutMs: 5000 })
  // Not awaited: a tool result never waits on a sound
  if (prefs.sound) $.audio.play({ asset: SOUND_LEVEL_UP }).catch(() => {})
}

function celebrate($, level, now) {
  const fresh = newAdvancements({ lifetime: lifetimeNow(), level }, unlocked)
  if (fresh.length === 0) return
  unlocked = [...unlocked, ...fresh.map((a) => a.id)]
  advancement = { title: fresh[0].title, icon: fresh[0].icon, at: now }
  if (isWatched && !drawsScene()) for (const a of fresh) $.ui.toast('🏆 Milestone reached: ' + a.title, { timeoutMs: 6000 })
  $.store.set('advancements', unlocked).catch(() => {})
}

// Another session may have lit or finished the furnace; the store is the truth
async function syncFurnace($) {
  const saved = (await $.store.get('smelt')) ?? null
  if ((saved?.id ?? null) === (smelt?.id ?? null)) return
  smelt = saved
  $.ui.invalidate('ui.render')
}

async function finishSmelt($, now) {
  const done = smelt
  smelt = null
  $.ui.invalidate('ui.render')
  // Only a session that still finds this furnace in the store pays, so two open
  // sessions don't both pay for one smelt
  const saved = await $.store.get('smelt')
  if (!saved || saved.id !== done.id) return
  await $.store.delete('smelt')
  pendingBlocks.smelted = (pendingBlocks.smelted ?? 0) + 1
  smeltDone = { at: now, minutes: done.minutes }
  earn($, null, done.minutes, now)
  $.ui.toast('🔥 Smelted "' + done.label + '"! +' + done.minutes + ' XP. Take five.', { timeoutMs: 10000 })
  if (prefs.sound && isWatched) $.audio.play({ asset: SOUND_SMELTED }).catch(() => {})
  await flush($)
}

// Runs once a second: the furnace's clock, cross-session sync, and a flush.
// A store hiccup is skipped; the next tick tries again
async function tick($) {
  ticks += 1
  try {
    if (ticks % 5 === 0) await syncFurnace($)
    if (ticks % 30 === 0) await flush($)
    if (!smelt) return
    const now = await $.clock.now()
    if (now >= smelt.endsAt) return await finishSmelt($, now)
    // The arrow animates itself: redraw when the minutes shown change, and each
    // second of the last minute
    const left = smelt.endsAt - now
    const shown = left > 60_000 ? Math.ceil(left / 60_000) : left
    if (shown !== lastMinuteShown) {
      lastMinuteShown = shown
      $.ui.invalidate('ui.render')
    }
  } catch {}
}

// Whether any app draws this session; empty in a `claude -p` run
async function watchCheck($) {
  isWatched = (await $.session.surfaces()).length > 0
}

async function registerCommands($) {
  const commands = [
    { name: 'f3', description: 'Tokencraft debug screen: branch, sprint item, context, level', immediate: true },
    { name: 'smelt', description: 'Focus timer: /smelt 25 <task> · /smelt stop', argumentHint: '[minutes] [task] | stop', immediate: true },
    { name: 'hud', description: 'Tokencraft HUD: on · off · sound on · sound off', argumentHint: '[on|off|sound on|sound off]', immediate: true },
    { name: 'weather', description: 'Tokencraft weather: clear · rain · storm · snow · auto (follows your plan limits)', argumentHint: '[clear|rain|storm|snow|auto]', immediate: true },
  ]
  for (const spec of commands) {
    // A taken name throws; log it and keep registering the rest
    try {
      await $.command.register(spec)
    } catch (err) {
      $.ui.log('/' + spec.name + ' not added: ' + String(err?.message ?? err))
    }
  }
}

// The branch: .git/HEAD in a checkout, or through the gitdir file in a worktree
async function readBranch($) {
  try {
    return branchOf(await $.fs.read('.git/HEAD'))
  } catch {}
  try {
    const gitdir = gitdirOf(await $.fs.read('.git'))
    if (gitdir) return branchOf(await $.fs.read(gitdir + '/HEAD'))
  } catch {}
  return null
}

// The first open sprint item from MaiOS's local board mirror, in this checkout or the main one
async function readSprint($) {
  const roots = [await $.session.root()]
  const repo = await $.session.repo()
  if (repo?.root && !roots.includes(repo.root)) roots.push(repo.root)
  for (const root of roots) {
    try {
      return { item: sprintItemOf(await $.fs.read(root + '/maios/planning/sprint.local.md')) }
    } catch {}
  }
  return null
}

const k = (tokens) => Math.round(tokens / 1000) + 'k'

export function register(on, options) {
  const tuned = Number(options?.px_per_column)
  pxPerColumn = tuned >= 4 && tuned <= 20 ? tuned : PX_PER_COLUMN
  on('session.start', async ($, e, next) => {
    await load($)
    await watchCheck($)
    try {
      usage = await $.session.usage()
    } catch {}
    $.clock.every(1000, () => tick($))
    await registerCommands($)
    return next(e)
  })

  // Every finished tool call, a subagent's too, may drop a block
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const block = blockFor(e.tool, e, result)
    if (!block) return result
    const now = await $.clock.now()
    if (block === 'creeper') {
      turnCreepers += 1
      creeperAt = now
      $.ui.invalidate('ui.render')
    } else {
      earn($, block, BLOCKS[block].xp, now)
    }
    return result
  })

  on('turn.start', async ($, e, next) => {
    resetTurn()
    await watchCheck($)
    return next(e)
  })

  // The loot line under the answer, then a flush to the store
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    if (!e.isAborted) earn($, null, TURN_XP, await $.clock.now())
    const line = lootLine(turnLoot, turnCreepers, turnXp, turnLevelUp)
    try {
      await flush($)
    } catch {}
    // A script's answer stays exactly what Claude wrote
    if (!line || !isWatched) return result
    return { ...result, text: result?.text ? result.text + '\n' + line : line }
  })

  // Fresh context and plan-limit figures after each turn: hunger and hearts
  on('session.measure', async ($, e, next) => {
    usage = e
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // /clear is a respawn: the hotbar empties, XP and lifetime stay
  on('classic.SessionStart', { source: 'clear' }, async ($, e, next) => {
    session = emptyCounts()
    selected = null
    resetTurn()
    $.ui.toast('☠ You respawned. Hotbar cleared, XP kept.')
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    try {
      await flush($)
    } catch {}
    return next(e)
  })

  // The HUD: pixel art where the app draws SVG (Desktop), colored text in the terminal
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!prefs.hud || e.props.hasSurvey) return next(e)
    const now = await $.clock.now()
    const { Box, Text, Svg } = $.ui.resolve(e)
    const columns = e.props.bodyColumns || e.viewport?.columns || 120
    // Every app but the terminal draws SVG; branch on the app, not on the constructor
    if (e.surface !== 'terminal') {
      const W = Math.max(480, Math.min(3000, Math.round(columns * pxPerColumn)))
      lastBand = { surface: e.surface, columns, width: W }
      const view = sceneView(now, W, e.props.isWorking)
      // isInteractive runs the animations and tooltips, in a frame of exactly this size
      const scene = sceneSvg(view)
      return Box({
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'center',
        children: [Svg({ source: scene.source, alt: hudAlt(view), isInteractive: true, width: scene.width, height: scene.height })],
      })
    }
    lastBand = { surface: 'terminal', columns }
    const view = hudView(now)
    const row = (runs) =>
      Box({ flexDirection: 'row', justifyContent: 'center', children: runs.map(([text, color, isBold]) => Text({ color, bold: isBold, wrap: 'truncate', children: [text] })) })
    return Box({ flexDirection: 'column', children: hudRuns(view).map(row) })
  })

  // The spinner keeps your words and adds what this turn has mined so far
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const mined = totalOf(turnLoot)
    if (mined === 0) return next(e)
    return next({ ...e, props: { ...e.props, suffix: e.props.suffix + ' ⛏ ' + mined } })
  })

  on('command.run', { command: 'f3' }, async ($) => {
    try {
      usage = await $.session.usage()
    } catch {}
    const vitals = vitalsOf(usage)
    const lvl = levelOf(xpNow())
    const branch = await readBranch($)
    const sprint = await readSprint($)
    const version = (await $.session.version()).version
    const now = await $.clock.now()
    const life = lifetimeNow()

    // Only a repo with a MaiOS sprint file gets a Sprint line
    const sprintText = !sprint
      ? null
      : !sprint.item
        ? 'every sprint item is done'
        : (sprint.item.isActive ? 'working on it: ' : 'next up: ') + sprint.item.name + ' (' + sprint.item.key + ')'
    const contextText =
      typeof vitals.contextUsed === 'number'
        ? vitals.contextUsed + '% used' + (vitals.contextWindow && vitals.contextTokens !== undefined ? ' · ' + k(vitals.contextWindow - vitals.contextTokens) + ' of ' + k(vitals.contextWindow) + ' left' : '')
        : 'no reading yet'
    const limitsText =
      vitals.fiveHourUsed === undefined ? 'no plan-limit reading yet' : '5h ' + vitals.fiveHourUsed + '% · 7d ' + (vitals.sevenDayUsed ?? '?') + '%'
    const owned = HOTBAR.filter((id) => session[id] > 0)

    const lines = [
      'Tokencraft F3 · Claude Code ' + version,
      'Branch    ' + (branch ?? 'not a git checkout'),
      ...(sprintText ? ['Sprint    ' + sprintText] : []),
      'Context   ' + contextText + ' · hunger ' + vitals.hunger / 2 + '/10',
      'Limits    ' + limitsText + ' · hearts ' + vitals.hearts / 2 + '/10',
      'Level     ' + lvl.level + ' · ' + lvl.into + '/' + lvl.need + ' XP to ' + (lvl.level + 1) + ' · ' + pickaxeOf(lvl.level) + ' pickaxe',
      'Session   ' + (owned.length ? owned.map((id) => BLOCKS[id].emoji + ' ' + session[id]).join(' · ') : 'nothing mined yet'),
      'Lifetime  ' + totalOf(life) + ' blocks · ' + unlocked.length + ' milestones',
      'Furnace   ' + (smelt ? '🔥 ' + clockOf(smelt.endsAt - now) + ' left · ' + smelt.label : 'cold · /smelt 25 <task>'),
      'Today     +' + (todayStored + pendingXp) + ' XP',
    ]
    if (lastBand) lines.push('Band      ' + lastBand.surface + ' · ' + lastBand.columns + ' columns' + (lastBand.width ? ' × ' + pxPerColumn + ' → ' + lastBand.width + ' px scene' : ''))
    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'smelt' }, async ($, e) => {
    const ask = parseSmelt(e.args)
    const now = await $.clock.now()
    if (ask.isStop) {
      if (!smelt) return { text: 'The furnace is cold. Light it with /smelt 25 <task>.' }
      const label = smelt.label
      smelt = null
      await $.store.delete('smelt')
      $.ui.invalidate('ui.render')
      return { text: '🧯 Furnace out on "' + label + '". An unfinished smelt pays no XP.' }
    }
    if (smelt) return { text: '🔥 Already smelting "' + smelt.label + '", ' + clockOf(smelt.endsAt - now) + ' left. /smelt stop first.' }
    smelt = { id: String(now), startedAt: now, endsAt: now + ask.minutes * 60_000, minutes: ask.minutes, label: ask.label }
    await $.store.set('smelt', smelt)
    $.ui.invalidate('ui.render')
    return { text: '🔥 Furnace lit: ' + ask.minutes + ' min on "' + ask.label + '". Finishing pays +' + ask.minutes + ' XP. /smelt stop puts it out.' }
  })

  on('command.run', { command: 'weather' }, async ($, e) => {
    const ask = e.args.trim().toLowerCase()
    const choices = ['clear', 'rain', 'storm', 'snow', 'auto']
    if (!choices.includes(ask)) {
      return { text: 'Weather is ' + weather + '. Pick one: ' + choices.join(' · ') + '. auto = rain past 70% of the 5-hour limit, storm past 90%, snow past 70% of the 7-day limit.' }
    }
    weather = ask
    $.ui.invalidate('ui.render')
    return { text: ask === 'auto' ? '🌦 Weather follows your plan limits again.' : '🌦 Weather set to ' + ask + ' for this session. /weather auto puts it back.' }
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'sound on' || arg === 'sound off') prefs = { ...prefs, sound: arg === 'sound on' }
    else if (arg === 'on' || arg === 'off') prefs = { ...prefs, hud: arg === 'on' }
    else prefs = { ...prefs, hud: !prefs.hud }
    await $.store.set('prefs', prefs)
    $.ui.invalidate('ui.render')
    return { text: 'HUD ' + (prefs.hud ? 'on' : 'off') + ' · sounds ' + (prefs.sound ? 'on' : 'off') }
  })
}
