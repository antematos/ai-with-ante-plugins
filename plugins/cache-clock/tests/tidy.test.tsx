import { expect, test } from 'claude-code/testing'
import { HOUR, MIN, T0, makeWorld, usage } from './world'
import { start, turn } from './turns'

/** An invented app chat ID, shaped as the desktop app writes them. */
const APP_ID = 'local_5a1d9e7c-2b3f-4c8d-a1e2-3f4a5b6c7d8e'

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

/** Another window's chat that went cold `coldAgo` ago. */
function cold(id: string, name: string, coldAgo: number, extra = {}) {
  return {
    [`chat:${id}`]: {
      id,
      name,
      project: 'garden-notes',
      size: 120_000,
      lastAt: T0 - coldAgo - HOUR,
      lifeMs: HOUR,
      isRunning: false,
      ...extra,
    },
  }
}

async function names(w: ReturnType<typeof makeWorld>, $: Parameters<Parameters<typeof test>[1]>[0]) {
  const ui = await $.ui.mount(pane())
  const all = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return all
}

test('a cold chat leaves the list four hours after going cold', async ($, on) => {
  const w = makeWorld(on, {
    ...cold('recent', 'Cold three hours', 3 * HOUR),
    ...cold('stale', 'Cold five hours', 5 * HOUR),
  })
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  const shown = await names(w, $)
  expect(shown).toContain('Cold three hours')
  expect(shown).not.toContain('Cold five hours')
  expect(w.store.has('chat:stale')).toBe(false)
})

test('a chat whose window has closed leaves the list as soon as it is cold', async ($, on) => {
  const w = makeWorld(on, {
    ...cold('closed', 'Closed and cold', 1 * MIN, { endedAt: T0 - 30 * MIN }),
    ...cold('open', 'Open and cold', 1 * MIN),
    'chat:warm': {
      ...cold('warm', 'Closed but warm', 0)['chat:warm'],
      lastAt: T0 - 10 * MIN,
      endedAt: T0 - 5 * MIN,
    },
  })
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  const shown = await names(w, $)
  expect(shown).not.toContain('Closed and cold')
  expect(shown).toContain('Open and cold')
  expect(shown).toContain('Closed but warm')
})

test('ending a chat marks its record closed; starting it again clears the mark', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  await $.session.end({ reason: 'other', sessionId: 'chat-a', resume: {} as never })
  expect(w.store.get('chat:chat-a')).toMatchObject({ endedAt: T0 })
  await start($)
  expect(w.store.get('chat:chat-a')).not.toHaveProperty('endedAt')
})

test('clicking a name shows “opening” on that row at once, for a few seconds', async ($, on) => {
  const w = makeWorld(on, {
    'chat:seed': {
      ...cold('seed', 'Seed order list', 0)['chat:seed'],
      lastAt: T0 - 10 * MIN,
      appId: APP_ID,
    },
  })
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'open:seed' })
  expect(await ui.find({ type: 'Text', text: 'opening…' })).toBeDefined()
  await w.clock.advance(4000)
  expect(await ui.find({ type: 'Text', text: 'opening…' })).toBeUndefined()
  await ui.unmount()
})

test('a chat the window returns to is open again: once cold, its footer still says cold', { timeoutMs: 60_000 }, async ($, on) => {
  // An in-process resume or /clear fires no session.start.
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(0, 8000, 0))
  await $.session.end({ reason: 'resume', sessionId: 'chat-a', resume: {} as never })
  w.id = 'chat-b'
  await turn($, w, usage(0, 8000, 0))
  await $.session.end({ reason: 'resume', sessionId: 'chat-b', resume: {} as never })
  w.id = 'chat-a'
  await w.clock.advance(2000)
  expect(w.store.get('chat:chat-a')).not.toHaveProperty('endedAt')
  await w.clock.advance(61 * MIN)
  const ui = await $.ui.mount({ plugin: 'cache-clock', component: 'SessionMode', props: { modes: [] }, surface: 'desktop' } as const)
  expect(await ui.find({ type: 'Text', text: 'cold' })).toBeDefined()
  await ui.unmount()
})

test('pressing a name again keeps “opening…” for its own three seconds', async ($, on) => {
  const w = makeWorld(on, {
    'chat:seed': { ...cold('seed', 'Seed order list', 0)['chat:seed'], lastAt: T0 - 10 * MIN, appId: APP_ID },
  })
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'open:seed' })
  await w.clock.advance(2500)
  await ui.press({ key: 'open:seed' })
  await w.clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: 'opening…' })).toBeDefined()
  await ui.unmount()
})

test('a deleted chat leaves the list at once, even while warm', async ($, on) => {
  const w = makeWorld(on, {
    'chat:gone': {
      ...cold('gone', 'Deleted but warm', 0)['chat:gone'],
      lastAt: T0 - 10 * MIN,
      transcript: '/t/gone.jsonl',
    },
    'chat:kept': {
      ...cold('kept', 'Still here', 0)['chat:kept'],
      lastAt: T0 - 10 * MIN,
      transcript: '/t/kept.jsonl',
    },
  })
  w.deleted.add('/t/gone.jsonl')
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  const shown = await names(w, $)
  expect(shown).not.toContain('Deleted but warm')
  expect(shown).toContain('Still here')
  expect(w.store.has('chat:gone')).toBe(false)
})

test('a chat saves where its conversation is kept', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  expect(w.store.get('chat:chat-a')).toMatchObject({ transcript: '/t/chat-a.jsonl' })
})

test('a chat deleted while the panel is open leaves within a second', async ($, on) => {
  const w = makeWorld(on, {
    'chat:gone': { ...cold('gone', 'Deleted later', 0)['chat:gone'], lastAt: T0 - 10 * MIN, transcript: '/t/gone.jsonl' },
  })
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  expect(await names(w, $)).toContain('Deleted later')
  w.deleted.add('/t/gone.jsonl')
  await w.clock.advance(1000)
  expect(await names(w, $)).not.toContain('Deleted later')
})

test('a run that keeps no transcript is not taken for deleted', async ($, on) => {
  const w = makeWorld(on)
  w.deleted.add('/t/chat-a.jsonl')
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  expect(w.store.get('chat:chat-a')).toBeDefined()
  expect(w.store.get('chat:chat-a')).not.toHaveProperty('transcript')
})
