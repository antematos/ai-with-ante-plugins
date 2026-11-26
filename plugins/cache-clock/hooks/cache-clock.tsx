import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import type { CacheClockChat, CacheClockSnapshot } from '../types'
import {
  COLOR,
  SPINNER,
  cellsOf,
  clockText,
  colorOf,
  holdChoicesFor,
  isListed,
  lifetimeOf,
  orderChats,
  phaseOf,
  pingLeadFor,
  quickHoldFor,
  sizeOf,
  sizeText,
  timeOfDay,
} from './logic'
import type { ChatRow, Usage } from './logic'

type $ = EngineInterface

const snapAtom = atom({ plugin: 'cache-clock', key: 'snap' } as const, null, { shape: 'snap-1' })
const runningAtom = atom({ plugin: 'cache-clock', key: 'isRunning' } as const, false)
const frameAtom = atom({ plugin: 'cache-clock', key: 'frame' } as const, 0)
const choosingAtom = atom({ plugin: 'cache-clock', key: 'isChoosing' } as const, false)
/** The chat whose name was just pressed, shown as opening until the app switches. */
const openingAtom = atom({ plugin: 'cache-clock', key: 'opening' } as const, null)

const CHAT = 'chat:'
const HOLD = 'hold:'
const PANE = 'cache-clock'
/** `pane:<id>`: chat `id` asked for the panel and has not closed it by hand. */
const PANE_WISH = 'pane:'
/** A panel wish for a chat not seen this long is forgotten. */
const WISH_FOR = 30 * 24 * 60 * 60 * 1000
const UNTITLED = 'Untitled chat'
/** The shape of the desktop app's chat IDs; nothing else is ever opened. */
const APP_ID = /^local_[A-Za-z0-9-]{1,64}$/

/** The keep-warm ping: a tiny question over the chat as last sent, read from the cache. */
const PING =
  'Cache Clock keep-warm check. You have no tools. Reply with the single word ok, straight away, without thinking it over.'

/** The character, redrawn from squares on a 16 by 10 grid. */
const SHAPE =
  '<path fill="#D97757" fill-rule="evenodd" d="M2 0H14V4H2Z M4 2H5V4H4Z M11 2H12V4H11Z M0 4H16V6H0Z M2 6H14V8H2Z M3 8H4V10H3Z M5 8H6V10H5Z M10 8H11V10H10Z M12 8H13V10H12Z"/>'
const CHARACTER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -1 16 11"><g>${SHAPE}<animateTransform attributeName="transform" type="translate" values="0 0;0 -1;0 0" dur="1.2s" repeatCount="indefinite"/></g></svg>`

/** What the module remembers between hooks; never drawn. */
type Memory = {
  id: string | undefined
  ticker: Timer | undefined
  spinner: Timer | undefined
  isPinging: boolean
  /** The `lastAt` of the warm period already warned about. */
  warnedAt: number | undefined
  names: Record<string, string>
  /** The desktop app's ID for this chat, once the app has drawn it. */
  appId: string | undefined
  /** Clears the "opening…" row; replaced by each new press. */
  openingTimer: Timer | undefined
  /** The panel was up when last looked: its going away while this chat runs means closed by hand. */
  isPaneUp: boolean
}

// ---- the shared store -------------------------------------------------------

async function readChat($: $, id: string): Promise<CacheClockChat | undefined> {
  const value = await $.store.get(CHAT + id)
  return isChat(value) ? value : undefined
}

function isChat(value: unknown): value is CacheClockChat {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.project === 'string' &&
    typeof v.size === 'number' &&
    typeof v.lastAt === 'number' &&
    typeof v.lifeMs === 'number' &&
    typeof v.isRunning === 'boolean'
  )
}

/**
 * The desktop app's ID for this chat, kept once the app has drawn the session.
 * A terminal or background run started from inside a desktop chat inherits
 * that chat's environment but is never drawn in the app, so the variable alone
 * does not make the ID its own. The app can leave a chat's surfaces while the
 * chat keeps working, so the ID is remembered rather than checked each time.
 * `isDrawn` says the app has just attached, whatever the roster reads yet.
 */
async function appIdOf($: $, mem: Memory, isDrawn = false): Promise<string | undefined> {
  if (mem.appId === undefined && (isDrawn || (await $.session.surfaces()).includes('desktop'))) {
    const value = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
    if (isAppId(value)) mem.appId = value
  }
  return mem.appId
}

function isAppId(value: unknown): value is string {
  return typeof value === 'string' && APP_ID.test(value)
}

/**
 * Asks the computer to open chat `appId` in the desktop app, as an outside link
 * would; says where to find the chat when that fails.
 */
async function openChat($: $, mem: Memory, id: string, appId: string, name: string): Promise<void> {
  // Shown at once: the app takes a moment to switch once the computer passes it the link.
  mem.openingTimer?.cancel()
  await update($, openingAtom, () => id)
  mem.openingTimer = $.clock.after(3000, () => void update($, openingAtom, () => null))
  const link = `claude://claude.ai/epitaxy/${appId}`
  let isOpened = false
  try {
    const { platform } = await $.session.info()
    const argv =
      platform === 'macos'
        ? ['open', link]
        : platform === 'windows'
          ? ['rundll32', 'url.dll,FileProtocolHandler', link]
          : null
    if (argv !== null) {
      isOpened = (await $.process.run(argv, { timeoutMs: 10_000 })).exitCode === 0
    }
  } catch {
    isOpened = false
  }
  if (!isOpened) $.ui.toast(`Couldn’t open “${name}”. Find it in the sidebar.`)
}

function untilOf(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const until = (value as { until?: unknown }).until
  return typeof until === 'number' ? until : undefined
}

function atOf(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const at = (value as { at?: unknown }).at
  return typeof at === 'number' ? at : undefined
}

function projectOf(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(part => part !== '')
  return parts[parts.length - 1] ?? cwd
}

/** Holds chat `id` until `until`, or stops its hold with null. */
async function setHold($: $, mem: Memory, id: string, until: number | null): Promise<void> {
  if (until === null) await $.store.delete(HOLD + id)
  else await $.store.set(HOLD + id, { until })
  await refresh($, mem)
}

/** The session id now, noticing when the window moved to another conversation. */
async function currentId($: $, mem: Memory): Promise<string> {
  const id = await $.session.id()
  if (mem.id !== undefined && mem.id !== id) {
    const old = mem.id
    mem.id = id
    mem.warnedAt = undefined
    await leaveConversation($, old)
    await $.store.delete(HOLD + id)
    await reopen($, id)
    // The panel belongs to the window: it follows the window to its new chat.
    if (mem.isPaneUp) {
      await $.store.delete(PANE_WISH + old)
      await $.store.set(PANE_WISH + id, { at: await $.clock.now() })
    }
  }
  mem.id = id
  return id
}

/** A conversation this window no longer shows: its hold ends, it is not running, it is closed. */
async function leaveConversation($: $, id: string): Promise<void> {
  await $.store.delete(HOLD + id)
  const chat = await readChat($, id)
  if (chat !== undefined) {
    await $.store.set(CHAT + id, { ...chat, isRunning: false, endedAt: await $.clock.now() })
  }
}

/** This window shows chat `id` again: its record is open. */
async function reopen($: $, id: string): Promise<void> {
  const chat = await readChat($, id)
  if (chat?.endedAt === undefined) return
  const { endedAt: _, ...open } = chat
  await $.store.set(CHAT + id, open)
}

/** Reads every chat and hold from the store into the drawn snapshot. */
async function refresh($: $, mem: Memory): Promise<CacheClockSnapshot> {
  const now = await $.clock.now()
  const id = await currentId($, mem)
  const chats: CacheClockChat[] = []
  const holds: Record<string, number> = {}
  for (const key of await $.store.keys()) {
    if (key.startsWith(CHAT)) {
      const value = await $.store.get(key)
      if (isChat(value) && isListed(value, now)) chats.push(value)
    } else if (key.startsWith(HOLD)) {
      const until = untilOf(await $.store.get(key))
      const owner = key.slice(HOLD.length)
      if (until !== undefined && until > now) holds[owner] = until
      else if (owner === id) await $.store.delete(key)
    }
  }
  const me = chats.find(chat => chat.id === id) ?? null
  const snap: CacheClockSnapshot = { now, myId: id, me, chats, holds }
  await update($, snapAtom, () => snap)
  return snap
}

async function isPaneOpen($: $): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

/** /cache-clock: opens the panel and remembers this chat wants it. */
async function openPane($: $, mem: Memory): Promise<void> {
  await $.ui.open({ id: PANE, title: 'Cache Clock' })
  const id = await currentId($, mem)
  await $.store.set(PANE_WISH + id, { at: await $.clock.now() })
  mem.isPaneUp = await isPaneOpen($)
}

/**
 * Brings the panel back to a chat that asked for it and never closed it by
 * hand: the app shuts an idle chat's engine down, and its panel goes with it.
 */
async function restorePane($: $, mem: Memory): Promise<void> {
  const id = await currentId($, mem)
  if ((await $.store.get(PANE_WISH + id)) === undefined) return
  try {
    if (!(await isPaneOpen($))) await $.ui.open({ id: PANE, title: 'Cache Clock' })
    mem.isPaneUp = await isPaneOpen($)
    if (mem.isPaneUp) await $.store.set(PANE_WISH + id, { at: await $.clock.now() })
  } catch {
    // Refused for now; the wish stays for the next start.
  }
}

/** A panel that went away while this chat ran was closed by hand: forget the wish. */
async function notePaneClosed($: $, mem: Memory): Promise<void> {
  if (!mem.isPaneUp || (await isPaneOpen($))) return
  mem.isPaneUp = false
  await $.store.delete(PANE_WISH + (await currentId($, mem)))
}

/** Once a second: redraw, warn once on red, ping a held chat before it cools. */
async function tick($: $, mem: Memory): Promise<void> {
  await notePaneClosed($, mem)
  const snap = await refresh($, mem)
  const me = snap.me
  if (me === null) return
  const left = me.lastAt + me.lifeMs - snap.now
  const holdUntil = snap.holds[me.id]
  if (holdUntil !== undefined) {
    // A held chat is kept warm even while a long turn waits on a tool.
    if (mem.isPinging) {
      // A keep-warm reply is still out: wait for it before judging the chat cold.
    } else if (left <= 0) {
      await setHold($, mem, me.id, null)
      $.ui.toast("This chat's cache went cold before it could be kept warm, so the hold has stopped.")
    } else if (left <= pingLeadFor(me.lifeMs) && !mem.isPinging) {
      await ping($, mem, me)
    }
    return
  }
  if (await read($, runningAtom)) return
  if (phaseOf(left, me.lifeMs) === 'red' && mem.warnedAt !== me.lastAt) {
    mem.warnedAt = me.lastAt
    $.ui.toast(`This chat's cache goes cold in ${clockText(left)}. Reply or press Hold to keep it warm.`)
  }
}

/** Saves this chat's app ID on its record, for a chat that has not replied since. */
async function noteAppId($: $, mem: Memory, isDrawn = false): Promise<void> {
  const appId = await appIdOf($, mem, isDrawn)
  if (appId === undefined) return
  const id = await currentId($, mem)
  const chat = await readChat($, id)
  if (chat === undefined || chat.appId === appId) return
  await $.store.set(CHAT + id, { ...chat, appId })
  await refresh($, mem)
}

/** One keep-warm ping of this chat; a ping that misses the cache stops the hold. */
async function ping($: $, mem: Memory, chat: CacheClockChat): Promise<void> {
  mem.isPinging = true
  try {
    const startedAt = await $.clock.now()
    const reply = await $.model.fork({ prompt: PING })
    if ((await $.session.id()) !== chat.id) return
    if (!reply.isAnswered) {
      await $.store.delete(HOLD + chat.id)
      $.ui.toast('Cache Clock could not keep this chat warm, so the hold has stopped.')
      return
    }
    const used: Usage = reply.usage
    if ((used.cache_read_input_tokens ?? 0) <= (used.cache_creation_input_tokens ?? 0)) {
      await $.store.delete(HOLD + chat.id)
      $.ui.toast('The keep-warm ping missed the cache, so the hold has stopped.')
      return
    }
    const latest = (await readChat($, chat.id)) ?? chat
    if (latest.lastAt > startedAt) return
    // A ping refreshes the chat's own cache: its lifetime stays as the chat's requests set it.
    await $.store.set(CHAT + chat.id, { ...latest, lastAt: startedAt })
  } finally {
    mem.isPinging = false
    await refresh($, mem)
  }
}

// ---- the main thread's requests and turns -----------------------------------

async function noteRequest($: $, mem: Memory, startedAt: number, used: Usage | null): Promise<void> {
  if (used === null) return
  const id = await currentId($, mem)
  const before = await readChat($, id)
  const lifeMs = lifetimeOf(used, before?.lifeMs)
  if (lifeMs === undefined) return
  // A record is this chat's own, so an app ID it saved earlier stays its own.
  const appId = (await appIdOf($, mem)) ?? before?.appId
  const chat: CacheClockChat = {
    id,
    name: mem.names[id] ?? before?.name ?? UNTITLED,
    project: projectOf(await $.session.root()),
    size: sizeOf(used),
    lastAt: startedAt,
    lifeMs,
    isRunning: await read($, runningAtom),
    ...(appId === undefined ? {} : { appId }),
  }
  await $.store.set(CHAT + id, chat)
  await refresh($, mem)
}

/** A main-thread turn starts or ends: the sign spins, the record says so. */
async function setRunning($: $, mem: Memory, isRunning: boolean): Promise<void> {
  mem.spinner?.cancel()
  mem.spinner = undefined
  await update($, runningAtom, () => isRunning)
  if (isRunning) {
    mem.spinner = $.clock.every(150, () => void update($, frameAtom, frame => (frame + 1) % SPINNER.length))
  }
  const id = await currentId($, mem)
  const chat = await readChat($, id)
  if (chat !== undefined && chat.isRunning !== isRunning) {
    await $.store.set(CHAT + id, { ...chat, isRunning })
  }
  await refresh($, mem)
}

/** The chat's title as Claude Code names it. */
async function noteTitle($: $, mem: Memory, id: string, title: string | undefined): Promise<void> {
  if (title === undefined || title.trim() === '') return
  mem.names[id] = title.trim()
  const chat = await readChat($, id)
  if (chat !== undefined && chat.name !== mem.names[id]) {
    await $.store.set(CHAT + id, { ...chat, name: mem.names[id] })
  }
}

/** /keep-warm: toggles the hold on this chat. */
async function keepWarm($: $, mem: Memory): Promise<string> {
  const snap = await refresh($, mem)
  const me = snap.me
  if (snap.holds[snap.myId] !== undefined) {
    await setHold($, mem, snap.myId, null)
    return 'Hold stopped.'
  }
  if (me === null || me.lastAt + me.lifeMs <= snap.now) {
    return 'This chat has no warm cache to hold.'
  }
  const until = snap.now + quickHoldFor(me.lifeMs)
  await setHold($, mem, me.id, until)
  return `Keeping this chat warm until ${timeOfDay(until)}.`
}

/** Removes chats the panel no longer lists, and holds past their end. */
async function prune($: $): Promise<void> {
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    const value = await $.store.get(key)
    if (key.startsWith(CHAT) && isChat(value) && !isListed(value, now)) {
      await $.store.delete(key)
    } else if (key.startsWith(HOLD) && (untilOf(value) ?? 0) <= now) {
      await $.store.delete(key)
    } else if (key.startsWith(PANE_WISH) && (atOf(value) ?? 0) + WISH_FOR <= now) {
      await $.store.delete(key)
    }
  }
}

// ---- the module ---------------------------------------------------------------

export const register: Register = on => {
  const mem: Memory = {
    id: undefined,
    ticker: undefined,
    spinner: undefined,
    isPinging: false,
    warnedAt: undefined,
    names: {},
    appId: undefined,
    openingTimer: undefined,
    isPaneUp: false,
  }

  on('session.start', async ($, e, next) => {
    const id = await $.session.id()
    mem.id = id
    await $.store.delete(HOLD + id)
    await reopen($, id)
    await prune($)
    await $.command.register({ name: 'cache-clock', description: 'Show how long each chat stays warm' })
    await $.command.register({ name: 'keep-warm', description: 'Hold this chat warm, or stop the hold' })
    mem.ticker?.cancel()
    mem.ticker = $.clock.every(1000, () => void tick($, mem))
    await refresh($, mem)
    await noteAppId($, mem)
    await restorePane($, mem)
    return next(e)
  })

  // The app draws this chat again, as when it is brought back on screen.
  on('session.attach', { surface: 'desktop' }, async ($, e, next) => {
    await noteAppId($, mem, true)
    await restorePane($, mem)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await leaveConversation($, e.sessionId)
    await update($, choosingAtom, () => false)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    await noteTitle($, mem, e.session_id, e.session_title)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteTitle($, mem, e.session_id, e.session_title)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    await update($, choosingAtom, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'cache-clock' }, async $ => {
    await openPane($, mem)
    return { text: 'Cache Clock panel opened.' }
  })

  on('command.run', { command: 'keep-warm' }, async $ => ({ text: await keepWarm($, mem) }))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await setRunning($, mem, true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await setRunning($, mem, false)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const startedAt = await $.clock.now()
    const result = yield* next(e)
    await noteRequest($, mem, startedAt, result.usage)
    return result
  })

  // A. Beside the model name.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const snap = await read($, snapAtom)
    const isRunning = await read($, runningAtom)
    const { Box, Button, Text } = $.ui.resolve(e)
    const tail = await next(e)
    if (isRunning) {
      const frame = await read($, frameAtom)
      return (
        <Box flexDirection="row" gap={1}>
          <Text color={COLOR.orange}>{SPINNER[frame % SPINNER.length]}</Text>
          {tail}
        </Box>
      )
    }
    const me = snap?.me ?? null
    if (snap === null || me === null) return tail
    const holdUntil = snap.holds[me.id]
    if (holdUntil !== undefined) {
      return (
        <Box flexDirection="row" gap={1}>
          <Button key="held" onPress={() => setHold($, mem, me.id, null)}>
            Held
          </Button>
          <Text color={COLOR.green}>to {timeOfDay(holdUntil)}</Text>
          {tail}
        </Box>
      )
    }
    const left = me.lastAt + me.lifeMs - snap.now
    const phase = phaseOf(left, me.lifeMs)
    const filled = cellsOf(left, me.lifeMs)
    return (
      <Box flexDirection="row" gap={1}>
        {phase !== 'cold' && (
          <Button key="hold" onPress={() => update($, choosingAtom, isOpen => !isOpen)}>
            Hold
          </Button>
        )}
        <Text>
          {filled > 0 && <Text color={colorOf(phase)}>{'▬'.repeat(filled)}</Text>}
          {filled < 5 && <Text color={COLOR.track}>{'▬'.repeat(5 - filled)}</Text>}
        </Text>
        <Text color={colorOf(phase)} tabular>
          {phase === 'cold' ? 'cold' : clockText(left)}
        </Text>
        {tail}
      </Box>
    )
  })

  // The hold row above the prompt, only while choosing.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isChoosing = await read($, choosingAtom)
    const snap = await read($, snapAtom)
    const me = snap?.me ?? null
    if (!isChoosing || snap === null || me === null || me.lastAt + me.lifeMs <= snap.now) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const close = () => update($, choosingAtom, () => false)
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text>Hold for</Text>
        {holdChoicesFor(me.lifeMs).map(choice => (
          <Button
            key={choice.key}
            onPress={async () => {
              await close()
              await setHold($, mem, me.id, (await $.clock.now()) + choice.ms)
            }}
          >
            {choice.label}
          </Button>
        ))}
        <Box flexGrow={1} />
        <Button key="close" role="dismiss" onPress={close}>
          ×
        </Button>
      </Box>
    )
  })

  // C. The side panel.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = await read($, snapAtom)
    const opening = await read($, openingAtom)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isNarrow = e.props.bodyColumns < 46
    const barCols = isNarrow ? 4 : 8
    const barPx = isNarrow ? 30 : 56
    const groups = snap === null ? [] : orderChats(snap.chats, snap.holds, snap.now)
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined

    const columns = (
      bar: RenderChildren,
      name: RenderChildren,
      size: RenderChildren,
      time: RenderChildren,
      hold: RenderChildren,
      key: string,
    ) => (
      <Box key={key} flexDirection="row" gap={1} alignItems="center" paddingY="xs">
        <Box width={barCols} flexShrink={0}>
          {bar}
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={6} overflow="hidden">
          {name}
        </Box>
        <Box width={5} flexShrink={0} justifyContent="flex-end">
          {size}
        </Box>
        <Box width={8} flexShrink={0} justifyContent="flex-end">
          {time}
        </Box>
        <Box width={4} flexShrink={0} justifyContent="flex-end">
          {hold}
        </Box>
      </Box>
    )

    const character = (label: string) =>
      Svg === undefined ? (
        <Text color={COLOR.orange}>✻</Text>
      ) : (
        <Svg source={CHARACTER} alt={label} width={26} height={18} isInteractive />
      )

    const pill = (share: number, color: string) => {
      if (Svg === undefined) return null
      const fill = Math.round(Math.max(0, Math.min(1, share)) * barPx)
      const source =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${barPx} 8">` +
        `<rect y="1" width="${barPx}" height="6" rx="3" fill="${COLOR.paneTrack}"/>` +
        (fill > 0 ? `<rect y="1" width="${fill}" height="6" rx="3" fill="${color}"/>` : '') +
        '</svg>'
      const alt = `${Math.round(Math.max(0, Math.min(1, share)) * 100)}% of the cache time left`
      return <Svg source={source} alt={alt} width={barPx} height={8} isInteractive />
    }

    const row = (r: ChatRow) => {
      const { chat } = r
      const isCold = r.kind === 'cold'
      const label = (
        <Text wrap="truncate" maxLines={1} color={isCold ? COLOR.quiet : undefined}>
          {chat.name}
        </Text>
      )
      const appId = chat.appId
      const name =
        e.surface === 'desktop' && isAppId(appId) ? (
          <Button key={`open:${chat.id}`} plain onPress={() => openChat($, mem, chat.id, appId, chat.name)}>
            {label}
          </Button>
        ) : (
          label
        )
      const size = (
        <Text color={COLOR.quiet} tabular>
          {sizeText(chat.size)}
        </Text>
      )
      if (opening === chat.id) {
        return columns(null, name, size, <Text color={COLOR.tick}>opening…</Text>, null, `row:${chat.id}`)
      }
      if (r.kind === 'running') {
        return columns(character('running'), name, size, character('running'), null, `row:${chat.id}`)
      }
      if (r.kind === 'cold') {
        return columns(
          pill(0, COLOR.green),
          name,
          size,
          <Text color={COLOR.blue}>cold</Text>,
          null,
          `row:${chat.id}`,
        )
      }
      const isHeld = r.kind === 'held'
      const phase = phaseOf(r.leftMs, chat.lifeMs)
      const tickBox = (
        <Button
          key={`hold:${chat.id}`}
          plain
          onPress={async () =>
            setHold($, mem, chat.id, isHeld ? null : (await $.clock.now()) + quickHoldFor(chat.lifeMs))
          }
        >
          {isHeld ? <Text color={COLOR.tick}>☑</Text> : <Text>☐</Text>}
        </Button>
      )
      return columns(
        isHeld ? pill(1, COLOR.green) : pill(r.leftMs / chat.lifeMs, colorOf(phase)),
        name,
        size,
        isHeld ? (
          <Text color={COLOR.green}>{timeOfDay(r.holdUntil ?? 0)}</Text>
        ) : (
          <Text color={colorOf(phase)} tabular>
            {clockText(r.leftMs)}
          </Text>
        ),
        tickBox,
        `row:${chat.id}`,
      )
    }

    const quiet = (label: string) => (
      <Text color={COLOR.quiet} size="caption">
        {label}
      </Text>
    )

    return (
      <Box flexDirection="column">
        {columns(null, null, quiet('Size'), quiet('Time'), quiet('Hold'), 'head')}
        {groups.length === 0 && <Text dimColor>No chats have a cache reading yet.</Text>}
        {groups.map((group, i) => (
          <Box key={`project:${group.project}`} flexDirection="column">
            {i > 0 && Svg !== undefined && (
              <Svg
                source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4000 1" preserveAspectRatio="none"><rect width="4000" height="1" fill="${COLOR.hairline}"/></svg>`}
                alt="Divider"
                height={1}
                isInteractive
              />
            )}
            <Box paddingTop="sm">
              <Text weight="semibold">{group.project}</Text>
            </Box>
            {group.rows.map(row)}
          </Box>
        ))}
      </Box>
    )
  })
}
