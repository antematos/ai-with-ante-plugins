import { expect, test } from 'claude-code/testing'
import { HOUR, MIN, T0, makeWorld, usage } from './world'
import { start, turn } from './turns'

function pane() {
  return {
    plugin: 'cache-clock',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'cache-clock',
    props: {
      title: 'Cache Clock',
      isFocused: false,
      bodyColumns: 100,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  } as const
}

/** Another window's warm chat; `seenAt` is when its window last checked in. */
function other(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    project: 'garden-notes',
    size: 100_000,
    lastAt: T0 - 10 * MIN,
    lifeMs: HOUR,
    isRunning: false,
    ...extra,
  }
}

type Ui = Awaited<ReturnType<Parameters<Parameters<typeof test>[1]>[0]['ui']['mount']>>

async function boxes(ui: Ui) {
  return (await ui.findAll({ type: 'Button' })).map(b => b.key).filter(k => String(k).startsWith('hold:'))
}

test('a chat whose window is awake can be held from the panel; a sleeping one cannot', async ($, on) => {
  const w = makeWorld(on, {
    'chat:awake': other('awake', 'Awake chat', { seenAt: T0 }),
    'chat:asleep': other('asleep', 'Sleeping chat', { seenAt: T0 - 20 * MIN }),
  })
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  const ui = await $.ui.mount(pane())
  const keys = await boxes(ui)
  expect(keys).toContain('hold:awake')
  expect(keys).not.toContain('hold:asleep')
  // Still listed, with its time left.
  expect(await ui.find({ type: 'Text', text: 'Sleeping chat' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '50:00' })).toBeDefined()
  await ui.unmount()
})

test('a held chat whose window fell asleep no longer shows as held', async ($, on) => {
  const w = makeWorld(on, {
    'chat:asleep': other('asleep', 'Sleeping chat', { seenAt: T0 - 20 * MIN }),
    'hold:asleep': { until: T0 + 4 * HOUR },
  })
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: '6:00 pm' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '50:00' })).toBeDefined()
  await ui.unmount()
})

test('a chat stopped mid-reply stops showing as running once its window goes quiet', async ($, on) => {
  const w = makeWorld(on, {
    'chat:crashed': other('crashed', 'Crashed mid-reply', { isRunning: true, seenAt: T0 }),
  })
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  let ui = await $.ui.mount(pane())
  const characters = async () =>
    (await ui.findAll({ type: 'Svg' })).filter(s => String(s.props.source).includes('animateTransform')).length
  expect(await characters()).toBe(2)
  await ui.unmount()
  await w.clock.advance(5 * MIN)
  ui = await $.ui.mount(pane())
  expect(await characters()).toBe(0)
  expect(await ui.find({ type: 'Text', text: '45:00' })).toBeDefined()
  await ui.unmount()
})

test('an open window keeps checking in on its own record', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  await w.clock.advance(10 * MIN)
  const seenAt = (w.store.get('chat:chat-a') as { seenAt?: number }).seenAt ?? 0
  expect(seenAt).toBeGreaterThan(T0 + 9 * MIN)
})

test('a window never saves over another chat’s record, even to fix its name', async ($, on) => {
  const w = makeWorld(on, {
    'chat:other': other('other', 'Old name', { transcript: '/t/other.jsonl', root: '/work/elsewhere', seenAt: T0 }),
  })
  w.files['/t/other.jsonl'] = JSON.stringify({ type: 'custom-title', customTitle: 'New name' }) + '\n'
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  const before = JSON.stringify(w.store.get('chat:other'))
  await w.clock.advance(2 * MIN)
  expect(JSON.stringify(w.store.get('chat:other'))).toBe(before)
  // Yet the panel shows the name the app shows.
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: 'New name' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Old name' })).toBeUndefined()
  await ui.unmount()
})

test('a save changes only its own fields: what another window wrote meanwhile stays', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(0, 0, 400_000, 1000))
  // Hold the chat and let a keep-warm ping go out and wait.
  w.forkUsage = usage(0, 0, 400_000)
  w.isForkHeld = true
  await $.command.run({ command: 'keep-warm', args: '', origin: { kind: 'composer' } as never, presentation: {} as never })
  await w.clock.advance(4 * MIN + 31_000)
  expect(w.forks).toHaveLength(1)
  // Meanwhile another window (an older version, say) writes a field on the record.
  const record = w.store.get('chat:chat-a') as Record<string, unknown>
  w.store.set('chat:chat-a', { ...record, appId: 'local_other-window' })
  w.releaseFork()
  await w.clock.advance(1000)
  const after = w.store.get('chat:chat-a') as Record<string, unknown>
  expect(after.appId).toBe('local_other-window')
  expect(after.lastAt).toBeGreaterThan(T0)
})

test('a keep-warm ping that fails outright stops the hold once, not every second', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(0, 0, 400_000, 1000))
  w.isForkBroken = true
  await $.command.run({ command: 'keep-warm', args: '', origin: { kind: 'composer' } as never, presentation: {} as never })
  await w.clock.advance(4 * MIN + 45_000)
  expect(w.forks).toHaveLength(1)
  expect(w.store.has('hold:chat-a')).toBe(false)
})
