import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { HOUR, MIN, T0, makeWorld, usage } from './world'
import { start, turn } from './turns'

const GREEN = '#16a34a'

const FOOTER = {
  plugin: 'cache-clock',
  surface: 'desktop',
  component: 'SessionMode',
  props: { modes: [] },
} as const

const BAND = {
  plugin: 'cache-clock',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const

async function pressHold($: Engine, key = 'hold') {
  const ui = await $.ui.mount(FOOTER)
  await ui.press({ key })
  await ui.unmount()
}

async function bandButtons($: Engine, surface: 'desktop' | 'terminal' = 'desktop') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const buttons = await ui.findAll({ type: 'Button' })
  await ui.unmount()
  return buttons.map(b => b.text)
}

test('Hold opens a row of lengths for a 1-hour cache; pressing Hold again closes it', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(0, 8000, 0))
  expect(await bandButtons($)).toEqual([])
  await pressHold($)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: 'Hold for' }))).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['1 h', '4 h', '8 h', 'Close'])
    expect((await ui.find({ type: 'Button', key: 'close' }))?.props.role).toBe('dismiss')
    expect(await ui.find({ type: 'Button', text: 'Cancel' })).toBeUndefined()
    await ui.unmount()
  }
  await pressHold($)
  expect(await bandButtons($)).toEqual([])
})

test('a 5-minute cache offers 15, 30 and 45 minutes', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await pressHold($)
  expect(await bandButtons($)).toEqual(['15 min', '30 min', '45 min', 'Close'])
})

test('picking a length holds the chat: Held chip, full green bar, end time', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(0, 8000, 0))
  await pressHold($)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'for-1h' })
  await band.unmount()
  expect(await bandButtons($)).toEqual([])
  expect(w.store.get('hold:chat-a')).toEqual({ until: T0 + HOUR })

  const ui = await $.ui.mount(FOOTER)
  expect((await ui.find({ type: 'Button' }))?.key).toBe('held')
  expect(await ui.find({ type: 'Text', text: 'to 3:00 pm' })).toMatchObject({ props: { color: GREEN } })
  const cells = await ui.findAll({ type: 'Text', text: /^▬+$/ })
  expect(cells.filter(c => c.props.color !== undefined).map(c => [c.props.color, c.text])).toEqual([[GREEN, '▬▬▬▬▬']])
  await ui.press({ key: 'held' })
  await ui.unmount()
  expect(w.store.has('hold:chat-a')).toBe(false)
})

test('the × and a submitted prompt both close the hold row', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(0, 8000, 0))
  await pressHold($)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'close' })
  await band.unmount()
  expect(await bandButtons($)).toEqual([])

  await pressHold($)
  await $.prompt.submit({ text: 'next question', wait: false, origin: { kind: 'composer' } as never })
  expect(await bandButtons($)).toEqual([])
})

test('the hold row is never drawn on a cold chat', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await pressHold($)
  await w.clock.advance(5 * MIN + 1000)
  expect(await bandButtons($)).toEqual([])
})

test('/keep-warm toggles an 8-hour hold, 45 minutes on a 5-minute cache', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(0, 8000, 0))
  const ran = await $.command.run({ command: 'keep-warm', args: '', origin: { kind: 'composer' } as never, presentation: {} as never })
  expect(w.store.get('hold:chat-a')).toEqual({ until: T0 + 8 * HOUR })
  expect(JSON.stringify(ran)).toContain('10:00 pm')
  await $.command.run({ command: 'keep-warm', args: '', origin: { kind: 'composer' } as never, presentation: {} as never })
  expect(w.store.has('hold:chat-a')).toBe(false)

  await turn($, w, usage(5000, 0, 0))
  await $.command.run({ command: 'keep-warm', args: '', origin: { kind: 'composer' } as never, presentation: {} as never })
  expect(w.store.get('hold:chat-a')).toEqual({ until: T0 + 45 * MIN })
})

test('/keep-warm on a cold chat holds nothing', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await w.clock.advance(6 * MIN)
  await $.command.run({ command: 'keep-warm', args: '', origin: { kind: 'composer' } as never, presentation: {} as never })
  expect(w.store.has('hold:chat-a')).toBe(false)
})

test('a hold ends at its end time', async ($, on) => {
  const w = makeWorld(on)
  w.forkUsage = usage(0, 0, 9000)
  await start($)
  await turn($, w, usage(0, 8000, 0))
  await $.command.run({ command: 'keep-warm', args: '', origin: { kind: 'composer' } as never, presentation: {} as never })
  w.store.set('hold:chat-a', { until: T0 + 2 * MIN })
  await w.clock.advance(3 * MIN)
  expect(w.store.has('hold:chat-a')).toBe(false)
  const ui = await $.ui.mount(FOOTER)
  expect((await ui.find({ type: 'Button' }))?.key).toBe('hold')
  await ui.unmount()
})
