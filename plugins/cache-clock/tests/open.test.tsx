import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { HOUR, MIN, T0, usage, makeWorld } from './world'
import { start, turn } from './turns'

/** An invented app chat ID, shaped as the desktop app writes them. */
const APP_ID = 'local_0b6f2c1e-4d3a-4f6b-9c2d-7e8f9a0b1c2d'
const LINK = `claude://claude.ai/epitaxy/${APP_ID}`

function pane(surface: 'desktop' | 'terminal' = 'desktop') {
  return {
    plugin: 'cache-clock',
    surface,
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

/** Another window's warm chat, with whatever app ID it saved. */
function seed(extra: Record<string, unknown>) {
  return {
    'chat:seed': {
      id: 'seed',
      name: 'Seed order list',
      project: 'garden-notes',
      size: 230_000,
      lastAt: T0 - 30 * MIN,
      lifeMs: HOUR,
      isRunning: false,
      ...extra,
    },
  }
}

async function openPanel($: Engine, w: ReturnType<typeof makeWorld>) {
  await start($)
  await turn($, w, usage(0, 0, 400_000))
}

test('a chat in the desktop app saves its app chat ID on its record', async ($, on) => {
  const w = makeWorld(on)
  w.env.CLAUDE_CODE_HOST_SESSION_ID = APP_ID
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  expect(w.store.get('chat:chat-a')).toMatchObject({ appId: APP_ID })
})

test('on Windows, clicking a chat name opens that chat in the app', async ($, on) => {
  const w = makeWorld(on, seed({ appId: APP_ID }))
  await openPanel($, w)
  const ui = await $.ui.mount(pane())
  expect((await ui.find({ key: 'open:seed' }))?.text).toBe('Seed order list')
  await ui.press({ key: 'open:seed' })
  expect(w.ran).toEqual([['rundll32', 'url.dll,FileProtocolHandler', LINK]])
  await ui.unmount()
})

test('on a Mac, clicking a chat name opens that chat in the app', async ($, on) => {
  const w = makeWorld(on, seed({ appId: APP_ID }))
  w.platform = 'macos'
  await openPanel($, w)
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'open:seed' })
  expect(w.ran).toEqual([['open', LINK]])
  await ui.unmount()
})

test('when a chat cannot be opened, a note says to find it in the sidebar', async ($, on) => {
  const w = makeWorld(on, seed({ appId: APP_ID }))
  await openPanel($, w)
  const ui = await $.ui.mount(pane())
  const NOTE = 'Couldn’t open “Seed order list”. Find it in the sidebar.'

  w.exitCode = 1
  await ui.press({ key: 'open:seed' })
  expect(w.toasts).toEqual([NOTE])

  w.exitCode = null // the opener cannot start
  await ui.press({ key: 'open:seed' })
  expect(w.toasts).toEqual([NOTE, NOTE])

  w.platform = 'linux' // no opener known: nothing is run
  const ranBefore = w.ran.length
  await ui.press({ key: 'open:seed' })
  expect(w.toasts).toEqual([NOTE, NOTE, NOTE])
  expect(w.ran).toHaveLength(ranBefore)
  await ui.unmount()
})

test('a name stays plain text without a well-formed app ID, and on the terminal', async ($, on) => {
  const like = (id: string, name: string, appId: string) => ({
    [`chat:${id}`]: { ...seed({})['chat:seed'], id, name, appId },
  })
  const w = makeWorld(on, {
    ...seed({ appId: 'local_x" & calc' }),
    ...like('herbs', 'Plant the herbs', 'https://example.com/x'),
    ...like('beds', 'Dig the beds', APP_ID),
  })
  await openPanel($, w)
  const desktop = await $.ui.mount(pane())
  expect(await desktop.find({ key: 'open:seed' })).toBeUndefined()
  expect(await desktop.find({ key: 'open:herbs' })).toBeUndefined()
  expect(await desktop.find({ key: 'open:beds' })).toBeDefined()
  await desktop.unmount()

  const terminal = await $.ui.mount(pane('terminal'))
  expect(await terminal.find({ type: 'Text', text: 'Dig the beds' })).toBeDefined()
  expect(await terminal.find({ key: 'open:beds' })).toBeUndefined()
  await terminal.unmount()
})
