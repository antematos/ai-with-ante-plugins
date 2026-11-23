import { expect, test } from 'claude-code/testing'
import { makeWorld, usage } from './world'
import { beginTurn, endTurn, start, turn } from './turns'

const FOOTER = {
  plugin: 'cache-clock',
  surface: 'desktop',
  component: 'SessionMode',
  props: { modes: [] },
} as const

const ORANGE = '#D97757'

test('a helper agent\'s requests are not counted', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  const id = await beginTurn($, w, usage(5000, 0, 0), 'agent-1')
  await endTurn($, id, 'agent-1')
  expect([...w.store.keys()].filter(k => k.startsWith('chat:'))).toEqual([])
  const ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

test('while a turn runs the footer shows only a moving orange sign', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  const id = await beginTurn($, w, usage(0, 0, 5000))
  const ui = await $.ui.mount(FOOTER)
  const first = await ui.find({ type: 'Text', text: /^[·✢✳✶✻✽]$/ })
  expect(first?.props.color).toBe(ORANGE)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /▬|:/ })).toBeUndefined()
  await w.clock.advance(150)
  const second = await ui.find({ type: 'Text', text: /^[·✢✳✶✻✽]$/ })
  expect(second?.text).not.toBe(first?.text)
  await ui.unmount()

  await endTurn($, id)
  const after = await $.ui.mount(FOOTER)
  expect((await after.find({ type: 'Button' }))?.key).toBe('hold')
  await after.unmount()
})

test('a subagent turn does not start the running sign', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await beginTurn($, w, usage(0, 0, 100), 'agent-1')
  const ui = await $.ui.mount(FOOTER)
  expect((await ui.find({ type: 'Button' }))?.key).toBe('hold')
  await ui.unmount()
})
