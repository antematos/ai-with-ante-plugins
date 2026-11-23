import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { MIN, makeWorld, usage } from './world'
import { start, turn } from './turns'

const GREEN = '#16a34a'
const AMBER = '#f59e0b'
const RED = '#ef4444'
const BLUE = '#3b82f6'
const GREY = '#c4c4c4'

const FOOTER = {
  plugin: 'cache-clock',
  component: 'SessionMode',
  props: { modes: [] },
} as const

async function footer($: Engine) {
  return $.ui.mount({ ...FOOTER, surface: 'desktop' })
}

/** The bar's cells as colour runs, e.g. [[GREEN, 4], [GREY, 1]]. */
async function barOf(ui: Awaited<ReturnType<typeof footer>>) {
  const texts = await ui.findAll({ type: 'Text', text: /^▬+$/ })
  return texts.filter(t => t.props.color !== undefined).map(t => [t.props.color, t.text.length])
}

test('before any cache reading the footer draws nothing of its own', async ($, on) => {
  makeWorld(on)
  await start($)
  const ui = await footer($)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /▬/ })).toBeUndefined()
  await ui.unmount()
})

test('a 5-minute write counts from the start of the request', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(5000, 0, 0), 30_000)
  const ui = await footer($)
  expect((await ui.find({ type: 'Button' }))?.key).toBe('hold')
  expect(await ui.find({ type: 'Text', text: '4:30' })).toMatchObject({ props: { color: GREEN } })
  expect(await barOf(ui)).toEqual([[GREEN, 5]])
  await ui.unmount()
})

test('a 1-hour write gives 60 minutes, and a read alone keeps it', { timeoutMs: 30_000 }, async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(0, 8000, 0))
  let ui = await footer($)
  expect(await ui.find({ type: 'Text', text: '60:00' })).toBeDefined()
  await ui.unmount()
  await w.clock.advance(10 * MIN)
  await turn($, w, usage(0, 0, 9000))
  ui = await footer($)
  expect(await ui.find({ type: 'Text', text: '60:00' })).toBeDefined()
  await ui.unmount()
})

test('colours: green over half, amber to a fifth, red the last fifth, then cold', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await w.clock.advance(2 * MIN + 31_000) // 2:29 left of 5:00
  let ui = await footer($)
  expect(await ui.find({ type: 'Text', text: '2:29' })).toMatchObject({ props: { color: AMBER } })
  expect(await barOf(ui)).toEqual([[AMBER, 3], [GREY, 2]])
  await ui.unmount()

  await w.clock.advance(90_000) // 0:59 left
  ui = await footer($)
  expect(await ui.find({ type: 'Text', text: '0:59' })).toMatchObject({ props: { color: RED } })
  expect(await barOf(ui)).toEqual([[RED, 1], [GREY, 4]])
  await ui.unmount()

  await w.clock.advance(60_000)
  ui = await footer($)
  expect(await ui.find({ type: 'Text', text: 'cold' })).toMatchObject({ props: { color: BLUE } })
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await barOf(ui)).toEqual([[GREY, 5]])
  await ui.unmount()
})

test('the terminal footer is left to Claude Code', async ($, on) => {
  const w = makeWorld(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await start($)
  await turn($, w, usage(5000, 0, 0))
  const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})
