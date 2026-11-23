import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { HOUR, MIN, T0, makeWorld, usage } from './world'
import { beginTurn, endTurn, start, turn } from './turns'

const SLOW = { timeoutMs: 30_000 }

async function keepWarm($: Engine) {
  return $.command.run({
    command: 'keep-warm',
    args: '',
    origin: { kind: 'composer' } as never,
    presentation: {} as never,
  })
}

test('a held chat is pinged shortly before it cools, and its clock restarts', SLOW, async ($, on) => {
  const w = makeWorld(on)
  w.forkUsage = usage(0, 0, 9000)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await keepWarm($)
  await w.clock.advance(4 * MIN + 20_000) // 40 s left: not yet
  expect(w.forks).toEqual([])
  await w.clock.advance(15_000) // 25 s left: ping
  expect(w.forks).toHaveLength(1)
  expect((w.store.get('chat:chat-a') as { lastAt: number }).lastAt).toBe(T0 + 4 * MIN + 30_000)
  await w.clock.advance(4 * MIN) // still warm after the old five minutes
  expect(w.forks).toHaveLength(1)
  expect(w.store.has('hold:chat-a')).toBe(true)
  expect(w.toasts).toEqual([])
})

test('the ping names no effort level', SLOW, async ($, on) => {
  const w = makeWorld(on)
  w.forkUsage = usage(0, 0, 9000)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await keepWarm($)
  await w.clock.advance(4 * MIN + 40_000)
  expect(w.forkEfforts).toEqual([undefined])
})

test('a ping that misses the cache stops the hold and says so', SLOW, async ($, on) => {
  const w = makeWorld(on)
  w.forkUsage = usage(9000, 0, 100) // wrote more than it read
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await keepWarm($)
  await w.clock.advance(4 * MIN + 40_000)
  expect(w.forks).toHaveLength(1)
  expect(w.store.has('hold:chat-a')).toBe(false)
  expect(w.toasts.join(' ')).toMatch(/missed the cache.*hold has stopped/)
  await w.clock.advance(10 * MIN)
  expect(w.forks).toHaveLength(1)
})

test('a cold chat is never pinged', SLOW, async ($, on) => {
  const w = makeWorld(on)
  w.forkUsage = usage(0, 0, 9000)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await w.clock.advance(6 * MIN)
  w.store.set('hold:chat-a', { until: T0 + HOUR }) // set from another window
  await w.clock.advance(5 * MIN)
  expect(w.forks).toEqual([])
})

test('another window can hold this chat through the shared store', SLOW, async ($, on) => {
  const w = makeWorld(on)
  w.forkUsage = usage(0, 0, 9000)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  w.store.set('hold:chat-a', { until: T0 + HOUR })
  await w.clock.advance(4 * MIN + 40_000)
  expect(w.forks).toHaveLength(1)
})

test('opening a conversation clears a hold left behind by a crash', async ($, on) => {
  const w = makeWorld(on, {
    'hold:chat-a': { until: T0 + HOUR },
    'hold:chat-other': { until: T0 + HOUR },
  })
  await start($)
  expect(w.store.has('hold:chat-a')).toBe(false)
  expect(w.store.has('hold:chat-other')).toBe(true)
})

test('after /clear the hold ends and the new chat is saved under its own id', SLOW, async ($, on) => {
  const w = makeWorld(on)
  w.forkUsage = usage(0, 0, 9000)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await keepWarm($)
  await $.session.end({ reason: 'clear', sessionId: 'chat-a', resume: {} as never })
  w.id = 'chat-b'
  expect(w.store.has('hold:chat-a')).toBe(false)
  await w.clock.advance(1000)
  await turn($, w, usage(3000, 0, 0))
  expect((w.store.get('chat:chat-b') as { size: number }).size).toBe(4000)
  expect((w.store.get('chat:chat-a') as { size: number }).size).toBe(6000)
  await w.clock.advance(4 * MIN + 40_000)
  expect(w.forks).toEqual([])
})

test('when the window moves to another conversation without an end event, the hold still ends', SLOW, async ($, on) => {
  const w = makeWorld(on)
  w.forkUsage = usage(0, 0, 9000)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await keepWarm($)
  w.id = 'chat-b'
  await w.clock.advance(1000)
  expect(w.store.has('hold:chat-a')).toBe(false)
  await w.clock.advance(5 * MIN)
  expect(w.forks).toEqual([])
})

test('one toast per warm period when the chat turns red', SLOW, async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await w.clock.advance(3 * MIN + 30_000)
  expect(w.toasts).toEqual([])
  await w.clock.advance(31_000) // 0:59 left
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).not.toMatch(/\$/)
  await w.clock.advance(30_000)
  expect(w.toasts).toHaveLength(1)
  await turn($, w, usage(0, 0, 9000))
  await w.clock.advance(4 * MIN + 1000)
  expect(w.toasts).toHaveLength(2)
})

test('a held chat is still pinged while a long turn waits on a tool', SLOW, async ($, on) => {
  const w = makeWorld(on)
  w.forkUsage = usage(0, 0, 9000)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await keepWarm($)
  const id = await beginTurn($, w, usage(0, 0, 6000)) // one request, then a long tool wait
  await w.clock.advance(4 * MIN + 40_000)
  expect(w.forks).toHaveLength(1)
  expect(w.store.has('hold:chat-a')).toBe(true)
  await endTurn($, id)
})

test('a hold found already cold stops and says so, and is never pinged', SLOW, async ($, on) => {
  const w = makeWorld(on)
  w.forkUsage = usage(0, 0, 9000)
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await keepWarm($)
  const chat = w.store.get('chat:chat-a') as { lastAt: number }
  w.store.set('chat:chat-a', { ...chat, lastAt: chat.lastAt - 10 * MIN }) // the machine slept
  await w.clock.advance(2_000)
  expect(w.forks).toEqual([])
  expect(w.store.has('hold:chat-a')).toBe(false)
  expect(w.toasts.join(' ')).toMatch(/went cold.*hold has stopped/)
})

test('a ping keeps the cache lifetime of the chat', SLOW, async ($, on) => {
  const w = makeWorld(on)
  w.forkUsage = usage(50, 0, 90_000) // the ping's own reply is written to a 5-minute cache
  await start($)
  await turn($, w, usage(0, 5000, 0)) // a 1-hour chat
  await keepWarm($)
  await w.clock.advance(59 * MIN)
  expect(w.forks).toHaveLength(1)
  expect((w.store.get('chat:chat-a') as { lifeMs: number }).lifeMs).toBe(HOUR)
})

test('a slow ping that reaches the cache keeps the hold', SLOW, async ($, on) => {
  const w = makeWorld(on)
  w.forkUsage = usage(0, 0, 9000)
  w.isForkHeld = true // the reply comes back only after the old five minutes are up
  await start($)
  await turn($, w, usage(5000, 0, 0))
  await keepWarm($)
  await w.clock.advance(4 * MIN + 40_000) // ping goes out with about 20 s left
  expect(w.forks).toHaveLength(1)
  await w.clock.advance(30_000) // the reply is still out, past the old expiry
  expect(w.store.has('hold:chat-a')).toBe(true)
  expect(w.toasts).toEqual([])
  w.releaseFork() // the reply arrives and reached the cache
  await w.clock.advance(2_000)
  expect(w.store.has('hold:chat-a')).toBe(true)
  expect(w.toasts).toEqual([])
  expect((w.store.get('chat:chat-a') as { lastAt: number }).lastAt).toBeGreaterThan(0)
})
