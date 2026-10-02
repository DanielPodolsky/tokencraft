import { expect, mock, test } from 'claude-code/testing'
import { levelOf } from '../hooks/blocks.js'
import { sceneSvg, skyAt } from '../hooks/scene.js'

const NOW = 1_759_400_000_000
const FULL = { stone: 31, planks: 12, tnt: 9, diamond: 2, emerald: 1, redstone: 4, egg: 1, pearl: 3, book: 1 }

// A scene with everything switched on at once: the heaviest markup it can produce
const busy = (overrides = {}) => ({
  W: 2600,
  now: NOW,
  ...levelOf(1100),
  hearts: 2,
  hunger: 1,
  counts: FULL,
  selected: 'diamond',
  contextUsed: 95,
  fiveHourUsed: 95,
  isWorking: true,
  recent: [{ id: 'stone', at: NOW - 200 }, { id: 'planks', at: NOW - 100 }],
  levelUpAt: NOW - 500,
  creeperAt: NOW - 300,
  advancement: { title: 'First Diamond', icon: 'diamond', at: NOW - 1000 },
  smelt: { startedAt: NOW - 600_000, endsAt: NOW + 900_000, label: 'a very long focus label' },
  smeltDone: { at: NOW - 1000, minutes: 25 },
  lifetimeTotal: 12_345,
  todayXp: 999,
  ...overrides,
})

test('the busiest scene stays under the 131,072-character SVG limit', async () => {
  const scene = sceneSvg(busy())
  expect(scene.source.length < 131_072).toBe(true)
  expect(scene.source).toContain('viewBox="0 0 2600 140"')
})

test('the HUD sits in the middle of the band', async () => {
  expect(sceneSvg(busy({ W: 1000 })).source).toContain('translate(318,52) scale(2)')
  expect(sceneSvg(busy({ W: 760 })).source).toContain('translate(198,52) scale(2)')
})

test('the sky follows the context window: sunrise, noon, night', async () => {
  expect(skyAt(0)[0]).toBe('#f39a63')
  expect(skyAt(0.5)[0]).toBe('#4a9fff')
  expect(skyAt(1)[0]).toBe('#070b24')
  const night = sceneSvg(busy({ contextUsed: 92, fiveHourUsed: 10, creeperAt: 0 })).source
  expect(night).toContain('ssss… /compact')
  expect(night).toContain('#t-moon')
  const noon = sceneSvg(busy({ contextUsed: 40, fiveHourUsed: 10, creeperAt: 0 })).source
  expect(noon).not.toContain('ssss…')
  expect(noon).toContain('#t-sun')
})

test('the weather follows the 5-hour limit: dry, rain, storm', async () => {
  const at = (fiveHourUsed) => sceneSvg(busy({ fiveHourUsed })).source
  expect(at(40)).not.toContain('#a9c8ff')
  expect(at(75)).toContain('#a9c8ff')
  expect(at(75)).not.toContain('values="0;0;0.7;0;0.45;0;0"')
  expect(at(95)).toContain('values="0;0;0.7;0;0.45;0;0"')
})

test('snow follows the 7-day limit and settles on the ground', async () => {
  const at = (sevenDayUsed, fiveHourUsed = 10) => sceneSvg(busy({ sevenDayUsed, fiveHourUsed })).source
  expect(at(40)).not.toContain('Snow: 7-day limit')
  expect(at(75)).toContain('Snow: 7-day limit 75% used')
  // A thunderstorm outranks snow
  expect(at(75, 95)).not.toContain('Snow: 7-day limit')
  // /weather overrides the limits
  expect(sceneSvg(busy({ sevenDayUsed: 0, fiveHourUsed: 0, weather: 'snow' })).source).toContain('Snow: 7-day limit 0% used')
  expect(sceneSvg(busy({ sevenDayUsed: 90, fiveHourUsed: 0, weather: 'clear' })).source).not.toContain('Snow: 7-day limit')
})

test('Claude swings only while a turn runs', async () => {
  expect(sceneSvg(busy({ isWorking: true })).source).toContain('values="-60 10.5 7.5;22 10.5 7.5;-60 10.5 7.5"')
  expect(sceneSvg(busy({ isWorking: false })).source).not.toContain('values="-60 10.5 7.5')
})

test('a redraw keeps loops in phase with the clock', async () => {
  const a = sceneSvg(busy({ now: NOW })).source
  const b = sceneSvg(busy({ now: NOW + 300 })).source
  // The pickaxe loop is 0.6 s: 300 ms later its begin has moved by 0.3 s
  expect(a).toContain(`begin="-${((NOW % 600) / 1000).toFixed(2)}s"`)
  expect(b).toContain(`begin="-${(((NOW + 300) % 600) / 1000).toFixed(2)}s"`)
})

test('one-shot effects are left out once they have played', async () => {
  const later = sceneSvg(busy({ now: NOW + 10_000 })).source
  expect(later).not.toContain('LEVEL ')
  expect(later).not.toContain('Milestone reached!')
  expect(later).not.toContain('tests failed')
  expect(later).not.toContain('Smelted!')
})

test('labels are escaped into the markup', async () => {
  const scene = sceneSvg(busy({ smelt: { startedAt: NOW, endsAt: NOW + 60_000, label: '<b>&"x"' } })).source
  expect(scene).toContain('&lt;b&gt;&amp;&quot;x&quot;')
  expect(scene).not.toContain('<b>&"x"')
})

// A Desktop session with nothing saved, and its band drawn at 110 columns
async function desktopBand($, on) {
  mock.clock(on, { now: NOW })
  on('store.get', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 10, percent: 50 }, rateLimits: [] } }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const band = await $.ui.mount({
    plugin: 'tokencraft',
    component: 'AbovePrompt',
    requestId: 'band',
    surface: 'desktop',
    viewport: { columns: 120, rows: 40 },
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 110, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  return band.find({ type: 'Svg' })
}

test('the Desktop band draws one interactive SVG at the band width', async ($, on) => {
  const svg = await desktopBand($, on)
  expect(svg.props.isInteractive).toBe(true)
  // Without a size the app draws a 300×150 frame: the scene gets the band's own
  // size, 110 columns × 8.35 px (the option's default), one unit per pixel
  expect(svg.props.width).toBe(919)
  expect(svg.props.height).toBe(140)
  expect(svg.props.source).toContain('viewBox="0 0 919 140"')
  expect(svg.props.source).toContain('preserveAspectRatio="xMidYMid slice"')
  expect(svg.props.source).toContain('color-scheme:light dark')
})

test('the px_per_column option re-tunes the band width', { options: { px_per_column: 10 } }, async ($, on) => {
  const svg = await desktopBand($, on)
  expect(svg.props.width).toBe(1100)
  expect(svg.props.source).toContain('viewBox="0 0 1100 140"')
})
