// A pretend machine for the tests: clock, shared store, session id, the model.
// Every name here is invented.
import { mock } from 'claude-code/testing'
import type { On, TurnUsage } from 'claude-code'

export const MIN = 60_000
export const HOUR = 60 * MIN
/** 2 pm local time on 24 Nov 2026. */
export const T0 = new Date(2026, 10, 24, 14, 0, 0).getTime()

export type World = {
  clock: ReturnType<typeof mock.clock>
  store: Map<string, unknown>
  toasts: string[]
  forks: string[]
  forkEfforts: unknown[]
  /** The usage the next main-thread request reports. */
  usage: TurnUsage | null
  /** The usage the next keep-warm ping reports; null makes it unanswered. */
  forkUsage: TurnUsage | null
  id: string
  cwd: string
  opened: string[]
}

export function usage(write5m: number, write1h: number, read: number, input = 1000): TurnUsage {
  return {
    input_tokens: input,
    output_tokens: 200,
    cache_creation_input_tokens: write5m + write1h,
    cache_read_input_tokens: read,
    ephemeral_5m_input_tokens: write5m,
    ephemeral_1h_input_tokens: write1h,
    model: 'claude-test',
  }
}

export function makeWorld(on: On, start: Record<string, unknown> = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: T0 }),
    store: new Map(Object.entries(start)),
    toasts: [],
    forks: [],
    forkEfforts: [],
    usage: null,
    forkUsage: null,
    id: 'chat-a',
    cwd: '/work/garden-notes',
    opened: [],
  }
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    w.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('session.id', () => ({ value: w.id }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('session.root', () => ({ value: w.cwd.split('/').slice(0, 3).join('/') }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('model.fork', (_, e) => {
    w.forks.push(e.prompt)
    w.forkEfforts.push(e.effort)
    if (w.forkUsage === null) {
      return { value: { isAnswered: false, reason: 'empty-reply', usage: usage(0, 0, 0, 0) } }
    }
    return { value: { isAnswered: true, text: 'ok', usage: w.forkUsage } }
  })
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'done',
      toolUses: [],
      stopReason: 'end_turn',
      usage: w.usage,
    }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  return w
}
