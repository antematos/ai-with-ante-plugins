import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { HOUR, MIN, T0, makeWorld, usage } from './world'
import { start, turn } from './turns'

const GREEN = '#16a34a'
const RED = '#ef4444'
const BLUE = '#3b82f6'

function pane(bodyColumns: number) {
  return {
    plugin: 'cache-clock',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'cache-clock',
    props: {
      title: 'Cache Clock',
      isFocused: false,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  } as const
}

function chat(id: string, name: string, project: string, lastAgo: number, lifeMs: number, extra = {}) {
  return {
    id,
    name,
    project,
    size: 100_000,
    lastAt: T0 - lastAgo,
    lifeMs,
    isRunning: false,
    ...extra,
  }
}

/** Five invented chats in two invented projects, plus this window's own. */
const OTHERS = {
  'chat:seed': chat('seed', 'Seed order list', 'garden-notes', 30 * MIN, HOUR, { size: 230_000 }),
  'chat:search': chat('search', 'Fix the search page', 'recipe-site', 10 * MIN, HOUR, { size: 95_000 }),
  'hold:search': { until: T0 + 2 * HOUR + 30 * MIN },
  'chat:about': chat('about', 'Rewrite the about page and tidy every heading on the site', 'recipe-site', 3 * MIN, HOUR),
  'chat:photos': chat('photos', 'Import the photo archive', 'recipe-site', 1 * MIN, HOUR, { isRunning: true, size: 140_000 }),
  'chat:old': chat('old', 'Untitled chat', 'recipe-site', 2 * HOUR, HOUR, { size: 18_000 }),
  'chat:gone': chat('gone', 'Long gone', 'recipe-site', 26 * HOUR, HOUR),
}

async function texts(ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text)
}

async function openPanel($: Engine, w: ReturnType<typeof makeWorld>) {
  w.id = 'beds'
  await start($)
  await turn($, w, usage(0, 0, 400_000, 10_000)) // a read with no history: 5 minutes
  await w.clock.advance(4 * MIN)
}

test('/cache-clock opens the panel', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await $.command.run({ command: 'cache-clock', args: '', origin: { kind: 'composer' } as never, presentation: {} as never })
  expect(w.opened).toEqual(['cache-clock'])
})

test('rows: projects by their most urgent chat, each chat once, cold last, a day-old cold chat gone', { timeoutMs: 30_000 }, async ($, on) => {
  const w = makeWorld(on, OTHERS)
  await openPanel($, w)
  const ui = await $.ui.mount(pane(100))
  const all = await texts(ui)
  const order = all.filter(t =>
    ['garden-notes', 'recipe-site', 'Untitled chat', 'Seed order list', 'Fix the search page', 'Import the photo archive', 'Long gone'].includes(t) ||
    t.startsWith('Rewrite') ||
    t === 'Untitled chat',
  )
  // This window's chat ("Untitled chat", 1:00 left) is the most urgent.
  expect(order).toEqual([
    'garden-notes',
    'Untitled chat',
    'Seed order list',
    'recipe-site',
    'Rewrite the about page and tidy every heading on the site',
    'Fix the search page',
    'Import the photo archive',
    'Untitled chat',
  ])
  expect(all.slice(0, 3)).toEqual(['Size', 'Time', 'Hold'])
  expect(all).not.toContain('Next to go cold')
  await ui.unmount()
})

test('each kind of row draws its parts', async ($, on) => {
  const w = makeWorld(on, OTHERS)
  await openPanel($, w)
  const ui = await $.ui.mount(pane(100))
  const red = await ui.find({ type: 'Text', text: '1:00' })
  expect(red?.props.color).toBe(RED)
  expect(await ui.find({ type: 'Text', text: '410k' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '4:30 pm' }))?.props.color).toBe(GREEN)
  expect(JSON.stringify(await ui.drawn())).not.toContain('to 4:30 pm')
  expect((await ui.find({ type: 'Text', text: 'cold' }))?.props.color).toBe(BLUE)
  const name = await ui.find({ type: 'Text', text: /^Rewrite/ })
  expect(name?.props).toMatchObject({ maxLines: 1 }) // the desktop table keeps maxLines and always cuts the end

  // Tick boxes on warm and held rows only.
  const boxes = (await ui.findAll({ type: 'Button' })).map(b => [b.key, b.text])
  expect(boxes).toEqual([
    ['hold:beds', '☐'],
    ['hold:seed', '☐'],
    ['hold:about', '☐'],
    ['hold:search', '☑'],
  ])

  // Pills are pictures, never characters; the running chat shows the character twice.
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.filter(s => String(s.props.source).includes('animateTransform'))).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /▬/ })).toBeUndefined()
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/\$\d/)
  await ui.unmount()
})

test('ticking a row holds that chat for 8 hours; unticking stops it', async ($, on) => {
  const w = makeWorld(on, OTHERS)
  await openPanel($, w)
  const ui = await $.ui.mount(pane(100))
  await ui.press({ key: 'hold:seed' })
  expect(w.store.get('hold:seed')).toEqual({ until: T0 + 4 * MIN + 8 * HOUR })
  await ui.press({ key: 'hold:search' })
  expect(w.store.has('hold:search')).toBe(false)
  await ui.press({ key: 'hold:beds' })
  expect(w.store.get('hold:beds')).toEqual({ until: T0 + 4 * MIN + 45 * MIN })
  await ui.unmount()
})

test('narrow: fixed right-hand columns, the header built from the same boxes, a smaller bar', async ($, on) => {
  const w = makeWorld(on, OTHERS)
  await openPanel($, w)
  for (const columns of [100, 40]) {
    const ui = await $.ui.mount(pane(columns))
    const tree = JSON.stringify(await ui.drawn())
    expect(tree).toContain('"width":5')
    expect(tree).toContain('"width":8')
    expect(tree).toContain('"gap":1')
    expect(tree).toContain('"width":4')
    expect(tree).toContain('"minWidth":6')
    expect(tree).not.toContain('"width":16')
    const pills = (await ui.findAll({ type: 'Svg' })).filter(s => !String(s.props.source).includes('animate') && s.props.height === 8)
    expect(new Set(pills.map(p => p.props.width))).toEqual(new Set([columns < 46 ? 30 : 56]))
    expect(pills.every(p => String(p.props.alt).length > 0)).toBe(true)
    expect(pills.every(p => p.props.isInteractive === true && !/<svg[^>]*width=/.test(String(p.props.source)))).toBe(true)
    await ui.unmount()
  }
})

test('the terminal draws the panel without pictures', async ($, on) => {
  const w = makeWorld(on, OTHERS)
  await openPanel($, w)
  const ui = await $.ui.mount({ ...pane(100), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Seed order list' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '✻' }))?.props.color).toBe('#D97757')
  await ui.unmount()
})

test('the project heading is the session root folder, not where the shell moved to', async ($, on) => {
  const w = makeWorld(on, {})
  w.cwd = '/work/recipe-site/src/deep'
  await openPanel($, w)
  const ui = await $.ui.mount(pane(100))
  expect(await ui.find({ type: 'Text', text: 'recipe-site' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'deep' })).toBeFalsy()
  await ui.unmount()
})
