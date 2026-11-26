import { expect, test } from 'claude-code/testing'
import { HOUR, T0, makeWorld } from './world'
import { start } from './turns'

const run = { command: 'cache-clock', args: '', origin: { kind: 'composer' } as never, presentation: {} as never }

test('the panel comes back when its chat starts again, until it is closed by hand', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await $.command.run(run)
  expect(w.panes.has('cache-clock')).toBe(true)

  // The app shuts the idle chat down; its panel goes with it.
  w.panes.clear()
  await start($)
  expect(w.panes.has('cache-clock')).toBe(true)

  // Closed by hand while the chat runs: it stays closed.
  w.panes.delete('cache-clock')
  await w.clock.advance(1000)
  await start($)
  expect(w.panes.has('cache-clock')).toBe(false)
})

test('the panel comes back when the app draws its chat again', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await $.command.run(run)
  w.panes.clear()
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(w.panes.has('cache-clock')).toBe(true)
})

test('a chat that never asked for the panel does not get one', async ($, on) => {
  const w = makeWorld(on, { 'pane:chat-other': { at: T0 } })
  await start($)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(w.panes.has('cache-clock')).toBe(false)
})

test('an open panel is not opened a second time', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await $.command.run(run)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await w.clock.advance(3000)
  expect(w.opened).toEqual(['cache-clock'])
})

test('after /clear the panel stays with the window', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await $.command.run(run)
  await $.session.end({ reason: 'clear', sessionId: 'chat-a', resume: {} as never })
  w.id = 'chat-b'
  await w.clock.advance(1000)
  w.panes.clear()
  await start($)
  expect(w.panes.has('cache-clock')).toBe(true)
})

test('a panel wish for a chat unused for 30 days is cleared', async ($, on) => {
  const w = makeWorld(on, { 'pane:old': { at: T0 - 31 * 24 * HOUR }, 'pane:recent': { at: T0 - HOUR } })
  await start($)
  expect(w.store.has('pane:old')).toBe(false)
  expect(w.store.has('pane:recent')).toBe(true)
})
