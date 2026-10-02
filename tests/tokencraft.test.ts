import { expect, mock, test } from 'claude-code/testing'
import { blockFor, levelOf, parseSmelt, sprintItemOf, xpToNext } from '../hooks/blocks.js'

// What $.session.usage() answers in these tests: 30% of context used, 5h limit 20% used
const USAGE = {
  startedAt: 0,
  context: { tokens: 300_000, window: 1_000_000, percent: 30 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 20 },
    { kind: 'seven_day', percentUsed: 40 },
  ],
  cost: { usd: 1.2 },
}

const SPRINT = [
  '# Sprint — mirror',
  '',
  '## Sprint — Week 40',
  '',
  '- [x] board:1 — Shipped thing · status: Completed',
  '- [ ] board:42 — Redesign the settings page · status: Ready',
  '',
  '## Backlog — later',
  '- [ ] board:9 — Not this one · status: —',
].join('\n')

const BAND = {
  plugin: 'tokencraft',
  component: 'AbovePrompt',
  requestId: 'band',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 110, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

// Every stub a session needs: $.store in a Map, a mock clock, and tool calls that
// succeed unless the command says `fail`
function stubs(on, saved = new Map<string, unknown>(), surfaces: string[] = ['terminal']) {
  const toasts: string[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    saved.delete(e.key)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: USAGE }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('command.register', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('tool.call', ($, e) => (String(e.command ?? '').includes('fail') ? { result: 'boom', isError: true } : { result: 'ok' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  // What Claude Code draws when the mod passes a site on: the spinner's word and suffix
  on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [String(e.props?.word ?? 'drawn by Claude Code') + String(e.props?.suffix ?? '')] }))
  return { saved, toasts, clock }
}

const start = ($) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
const done = (turnId: string) => ({ turnId, answer: 'done', durationMs: 1000, isAborted: false, usage: null })

test('the XP curve is Minecraft’s', async () => {
  expect(xpToNext(0)).toBe(7)
  expect(levelOf(352).level).toBe(16)
  expect(levelOf(1395).level).toBe(30)
  expect(levelOf(1394).level).toBe(29)
})

test('each tool earns its block, and refused calls earn nothing', async () => {
  expect(blockFor('Read', {}, { result: 'ok' })).toBe('stone')
  expect(blockFor('Edit', {}, { result: 'ok' })).toBe('planks')
  expect(blockFor('Bash', { command: 'git commit -m x' }, { result: 'ok' })).toBe('emerald')
  expect(blockFor('Bash', { command: 'npm test' }, { result: 'ok' })).toBe('diamond')
  expect(blockFor('Bash', { command: 'npm test' }, { result: 'x', isError: true })).toBe('creeper')
  expect(blockFor('Bash', { command: 'ls' }, { result: 'ok' })).toBe('tnt')
  expect(blockFor('mcp__github__get_pr', {}, { result: 'ok' })).toBe('redstone')
  expect(blockFor('Read', {}, { deny: 'no' })).toBe(null)
  expect(blockFor('TodoWrite', {}, { result: 'ok' })).toBe(null)
})

test('a turn ends with a loot line, a level-up, and its XP saved', async ($, on) => {
  const { saved, toasts } = stubs(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'Read', file_path: 'a.md' })
  await $.tool.call({ tool: 'Read', file_path: 'b.md' })
  await $.tool.call({ tool: 'Edit', file_path: 'a.md', old_string: 'x', new_string: 'y' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  const answer = await $.turn.complete(done('t1'))

  // 2 stone (1 each) + planks (2) + diamond (10) + the turn (3) = 17 XP: level 2
  expect(answer.text).toContain('+2 🪨 stone')
  expect(answer.text).toContain('+1 🪵 planks')
  expect(answer.text).toContain('+1 💎 diamond')
  expect(answer.text).toContain('+17 XP')
  expect(answer.text).toContain('⬆ Level 2')
  expect(saved.get('xp')).toBe(17)
  expect(toasts.some((t) => t.startsWith('⬆ Level'))).toBe(true)
  expect(toasts).toContain('🏆 Milestone reached: First Diamond')
})

test('a red test run spawns a creeper and pays no diamond', async ($, on) => {
  stubs(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'Bash', command: 'npm test -- --fail' })
  const answer = await $.turn.complete(done('t1'))
  expect(answer.text).toContain('💥 1 creeper')
  expect(answer.text).not.toContain('diamond')
})

test('a claude -p run keeps its answer clean and plays nothing', async ($, on) => {
  const { saved, toasts } = stubs(on, new Map(), [])
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  const answer = await $.turn.complete(done('t1'))
  expect(answer.text).toBe('')
  expect(toasts).toEqual([])
  // The XP still counts
  expect(saved.get('xp')).toBe(13)
})

test('a turn with no tool calls adds no line', async ($, on) => {
  stubs(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'hi' })
  const answer = await $.turn.complete(done('t1'))
  expect(answer.text).toBe('')
})

test('the HUD is pixel art on Desktop and colored text in the terminal', async ($, on) => {
  stubs(on)
  await start($)
  await $.tool.call({ tool: 'Read', file_path: 'a.md' })

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = await desktop.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  expect(svg.props.source).toContain('<svg')
  expect(svg.props.alt).toContain('hearts 8 of 10')
  expect(svg.props.alt).toContain('hunger 7 of 10')
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await terminal.find({ type: 'Text', text: /Lv \d+/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /🪨 1/ })).toBeDefined()
  await terminal.unmount()
})

test('the spinner keeps its word and adds what the turn mined', async ($, on) => {
  stubs(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'go' })
  await $.tool.call({ tool: 'Read', file_path: 'a.md' })
  await $.tool.call({ tool: 'Grep', pattern: 'x' })
  const spinner = await $.ui.mount({
    plugin: 'tokencraft',
    component: 'Spinner',
    requestId: 'main',
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'tool-use' },
  })
  expect(await spinner.find({ type: 'Text', text: 'Sauteing… ⛏ 2' })).toBeDefined()
})

test('/smelt runs its minutes, pays once, and clears the furnace', async ($, on) => {
  const { saved, toasts, clock } = stubs(on)
  await start($)
  const lit = await $.command.run({ command: 'smelt', args: '1 write the tests' })
  expect(lit.text).toContain('Furnace lit: 1 min on "write the tests"')
  expect(saved.get('smelt')).toBeDefined()

  await clock.advance(30_000)
  expect(toasts.some((t) => t.startsWith('🔥 Smelted'))).toBe(false)
  await clock.advance(31_000)
  expect(toasts).toContain('🔥 Smelted "write the tests"! +1 XP. Take five.')
  expect(saved.get('smelt')).toBeUndefined()
  expect(saved.get('xp')).toBe(1)
  expect(toasts).toContain('🏆 Milestone reached: Forged in Focus')
})

test('/smelt stop puts the furnace out with no XP', async ($, on) => {
  const { saved } = stubs(on)
  await start($)
  await $.command.run({ command: 'smelt', args: '25' })
  const out = await $.command.run({ command: 'smelt', args: 'stop' })
  expect(out.text).toContain('Furnace out on "focus"')
  expect(saved.get('smelt')).toBeUndefined()
  expect(saved.get('xp')).toBeUndefined()
})

test('/f3 shows the branch, the sprint item, context and level', async ($, on) => {
  stubs(on)
  on('fs.read', ($, e) => {
    if (e.path.endsWith('.git/HEAD')) return { value: 'ref: refs/heads/feat/tokencraft\n' }
    if (e.path.endsWith('sprint.local.md')) return { value: SPRINT }
    return { deny: 'ENOENT' }
  })
  on('session.root', () => ({ value: '/work' }))
  on('session.repo', () => ({ value: null }))
  on('session.version', () => ({ value: { version: '2.1.287', base: '2.1.287' } }))
  await start($)
  const f3 = await $.command.run({ command: 'f3', args: '' })
  expect(f3.text).toContain('Claude Code 2.1.287')
  expect(f3.text).toContain('Branch    feat/tokencraft')
  expect(f3.text).toContain('next up: Redesign the settings page (board:42)')
  expect(f3.text).toContain('Context   30% used · 700k of 1000k left · hunger 7/10')
  expect(f3.text).toContain('5h 20% · 7d 40%')
  expect(f3.text).toContain('Level     0 · 0/7 XP to 1 · Wooden pickaxe')
})

test('/f3 leaves the Sprint line out where the repo has no sprint file', async ($, on) => {
  stubs(on)
  on('fs.read', ($, e) => (e.path.endsWith('.git/HEAD') ? { value: 'ref: refs/heads/main\n' } : { deny: 'ENOENT' }))
  on('session.root', () => ({ value: '/work' }))
  on('session.repo', () => ({ value: null }))
  on('session.version', () => ({ value: { version: '2.1.287', base: '2.1.287' } }))
  await start($)
  const f3 = await $.command.run({ command: 'f3', args: '' })
  expect(f3.text).toContain('Branch    main')
  expect(f3.text).not.toContain('Sprint')
})

test('/weather sets the weather for the session and refuses anything else', async ($, on) => {
  stubs(on)
  await start($)
  expect((await $.command.run({ command: 'weather', args: 'snow' })).text).toContain('Weather set to snow')
  expect((await $.command.run({ command: 'weather', args: 'hail' })).text).toContain('Weather is snow. Pick one')
  expect((await $.command.run({ command: 'weather', args: 'auto' })).text).toContain('follows your plan limits')
})

test('/hud off hands the band back to Claude Code', async ($, on) => {
  const { saved } = stubs(on)
  await start($)
  const off = await $.command.run({ command: 'hud', args: 'off' })
  expect(off.text).toBe('HUD off · sounds on')
  expect(saved.get('prefs')).toEqual({ hud: false, sound: true })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /drawn by Claude Code/ })).toBeDefined()
})

test('the sprint parser reads the first open item of the Sprint section only', async () => {
  expect(sprintItemOf(SPRINT)).toEqual({ isActive: false, key: 'board:42', name: 'Redesign the settings page', spec: '' })
  expect(sprintItemOf('## Sprint\n- [x] a — done')).toBe(null)
  expect(parseSmelt('')).toEqual({ isStop: false, minutes: 25, label: 'focus' })
  expect(parseSmelt('45 fix the login bug')).toEqual({ isStop: false, minutes: 45, label: 'fix the login bug' })
})
