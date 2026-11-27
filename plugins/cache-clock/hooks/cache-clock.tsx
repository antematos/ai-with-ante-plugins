import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import type { CacheClockChat, CacheClockSnapshot } from '../types'
import {
  CHECK_IN_EVERY,
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
import { projectAt, startFolderOf, titleAt } from './names'
import type { RepoCache } from './names'
import { hasWish, isDeleted, patchChat, prune, readChat, scan, setHold, setWish } from './records'

type $ = EngineInterface

const snapAtom = atom({ plugin: 'cache-clock', key: 'snap' } as const, null, { shape: 'snap-1' })
const runningAtom = atom({ plugin: 'cache-clock', key: 'isRunning' } as const, false)
const frameAtom = atom({ plugin: 'cache-clock', key: 'frame' } as const, 0)
const choosingAtom = atom({ plugin: 'cache-clock', key: 'isChoosing' } as const, false)
/** The chat whose name was just pressed, shown as opening until the app switches. */
const openingAtom = atom({ plugin: 'cache-clock', key: 'opening' } as const, null)

const PANE = 'cache-clock'
const UNTITLED = 'Untitled chat'
/** The shape of the desktop app's chat IDs; nothing else is ever opened. */
const APP_ID = /^local_[A-Za-z0-9-]{1,64}$/
/** Ticks (seconds) between reads of the names on disk and check-ins. */
const SLOW_TICKS = CHECK_IN_EVERY / 1000

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
  /** A tick is redrawing: the next one waits its turn by skipping. */
  isTicking: boolean
  isPinging: boolean
  /** The names on disk are being read. */
  isReading: boolean
  /** Ticks since the names were last read. */
  ticks: number
  /** The `lastAt` of the warm period already warned about. */
  warnedAt: number | undefined
  /** The desktop app's ID for this chat, once the app has drawn it. */
  appId: string | undefined
  /** Clears the "opening…" row; replaced by each new press. */
  openingTimer: Timer | undefined
  /** The panel is open in this window, as far as this window knows. */
  isPaneUp: boolean
  /** Repository names already looked up, by folder. */
  repos: RepoCache
  /** The folder this chat started in, once read from its transcript. */
  startFolder: string | undefined
  /** Other chats' names and project headings as the app shows them: drawn, never saved. */
  seen: Record<string, Partial<Pick<CacheClockChat, 'name' | 'project'>>>
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

/** Holds chat `id` until `until`, or stops its hold with null, and redraws. */
async function holdChat($: $, mem: Memory, id: string, until: number | null): Promise<void> {
  await setHold($, id, until)
  await refresh($, mem)
}

/** The session id now, noticing when the window moved to another conversation. */
async function currentId($: $, mem: Memory): Promise<string> {
  const id = await $.session.id()
  if (mem.id !== undefined && mem.id !== id) {
    const old = mem.id
    mem.id = id
    mem.warnedAt = undefined
    mem.startFolder = undefined
    await leaveConversation($, old)
    await setHold($, id, null)
    await reopen($, id)
    // The panel belongs to the window: it follows the window to its new chat.
    if (mem.isPaneUp) {
      await setWish($, old, null)
      await setWish($, id, await $.clock.now())
    }
  }
  mem.id = id
  return id
}

/** A conversation this window no longer shows: its hold ends, it is not running, it is closed. */
async function leaveConversation($: $, id: string): Promise<void> {
  await setHold($, id, null)
  await patchChat($, id, { isRunning: false, endedAt: await $.clock.now() })
}

/** This window shows chat `id` again: its record is open. */
async function reopen($: $, id: string): Promise<void> {
  if ((await readChat($, id))?.endedAt !== undefined) await patchChat($, id, { endedAt: undefined })
}

/** This chat's conversation file, where the engine says. */
async function transcriptOf($: $): Promise<string | undefined> {
  try {
    const path = (await $.session.info()).transcriptPath
    // A run that keeps no transcript must not read as deleted.
    return path !== '' && (await $.fs.exists(path)) ? path : undefined
  } catch {
    return undefined
  }
}

/** Reads every listed chat and live hold into the drawn snapshot. */
async function refresh($: $, mem: Memory): Promise<CacheClockSnapshot> {
  const now = await $.clock.now()
  const id = await currentId($, mem)
  const found = await scan($)
  const chats: CacheClockChat[] = []
  for (const chat of found.chats) {
    if (!isListed(chat, now)) continue
    // Hidden here; the record itself is removed by `prune` at the next start.
    if (await isDeleted($, chat)) continue
    chats.push(chat.id === id ? chat : { ...chat, ...mem.seen[chat.id] })
  }
  const holds: Record<string, number> = {}
  for (const [owner, until] of Object.entries(found.holds)) {
    if (until > now) holds[owner] = until
    else if (owner === id) await setHold($, id, null)
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
  await setWish($, await currentId($, mem), await $.clock.now())
  mem.isPaneUp = await isPaneOpen($)
}

/**
 * Brings the panel back to a chat that asked for it and never closed it by
 * hand: the app shuts an idle chat's engine down, and its panel goes with it.
 */
async function restorePane($: $, mem: Memory, isDrawn = false): Promise<void> {
  // Only where the app draws this chat: a terminal resume of it gets no panel unasked.
  if (!isDrawn && !(await $.session.surfaces()).includes('desktop')) return
  const id = await currentId($, mem)
  if (!(await hasWish($, id))) return
  try {
    if (!(await isPaneOpen($))) await $.ui.open({ id: PANE, title: 'Cache Clock' })
    mem.isPaneUp = await isPaneOpen($)
    if (mem.isPaneUp) await setWish($, id, await $.clock.now())
  } catch {
    // Refused for now; the wish stays for the next start.
  }
}

/**
 * Once a second: redraw, warn once on red, ping a held chat before it cools.
 * Every 30 s, also check in and read the names on disk, without holding up the redraw.
 */
async function tick($: $, mem: Memory): Promise<void> {
  mem.ticks += 1
  if (mem.ticks >= SLOW_TICKS) {
    mem.ticks = 0
    // The check-in never waits on the reads: a slow disk must not make this chat look asleep.
    void checkIn($, mem).catch(() => {})
    void readNames($, mem)
  }
  if (mem.isTicking) return
  mem.isTicking = true
  try {
    const snap = await refresh($, mem)
    const me = snap.me
    if (me === null) return
    const left = me.lastAt + me.lifeMs - snap.now
    if (snap.holds[me.id] !== undefined) {
      // A held chat is kept warm even while a long turn waits on a tool.
      // While a keep-warm reply is still out, wait for it before judging the chat cold.
      if (mem.isPinging) return
      if (left <= 0) {
        await holdChat($, mem, me.id, null)
        $.ui.toast("This chat's cache went cold before it could be kept warm, so the hold has stopped.")
      } else if (left <= pingLeadFor(me.lifeMs)) {
        void ping($, mem, me).catch(() => {})
      }
      return
    }
    if (await read($, runningAtom)) return
    if (phaseOf(left, me.lifeMs) === 'red' && mem.warnedAt !== me.lastAt) {
      mem.warnedAt = me.lastAt
      $.ui.toast(`This chat's cache goes cold in ${clockText(left)}. Reply or press Hold to keep it warm.`)
    }
  } finally {
    mem.isTicking = false
  }
}

/** Saves this chat's app ID on its record, for a chat that has not replied since. */
async function noteAppId($: $, mem: Memory, isDrawn = false): Promise<void> {
  const appId = await appIdOf($, mem, isDrawn)
  if (appId === undefined) return
  const id = await currentId($, mem)
  const chat = await readChat($, id)
  if (chat === undefined || chat.appId === appId) return
  await patchChat($, id, { appId })
  await refresh($, mem)
}

/** One keep-warm ping of this chat; a ping that misses the cache stops the hold. */
async function ping($: $, mem: Memory, chat: CacheClockChat): Promise<void> {
  mem.isPinging = true
  try {
    const startedAt = await $.clock.now()
    let reply: Awaited<ReturnType<typeof $.model.fork>> | undefined
    try {
      reply = await $.model.fork({ prompt: PING })
    } catch {
      reply = undefined // no reply at all: treated as unanswered, so it is not tried every second
    }
    if ((await $.session.id()) !== chat.id) return
    if (reply === undefined || !reply.isAnswered) {
      await setHold($, chat.id, null)
      $.ui.toast('Cache Clock could not keep this chat warm, so the hold has stopped.')
      return
    }
    const used: Usage = reply.usage
    if ((used.cache_read_input_tokens ?? 0) <= (used.cache_creation_input_tokens ?? 0)) {
      await setHold($, chat.id, null)
      $.ui.toast('The keep-warm ping missed the cache, so the hold has stopped.')
      return
    }
    // A request made meanwhile already moved the clock on.
    if (((await readChat($, chat.id))?.lastAt ?? 0) > startedAt) return
    // A ping refreshes the chat's own cache: its lifetime stays as the chat's requests set it.
    await patchChat($, chat.id, { lastAt: startedAt })
  } finally {
    mem.isPinging = false
    await refresh($, mem)
  }
}

/** This chat's window is awake: its record says when it last checked in. */
async function checkIn($: $, mem: Memory): Promise<void> {
  await patchChat($, await currentId($, mem), { seenAt: await $.clock.now() })
}

/** Every 30 s: this chat's record takes its name and project; other chats' names are read for drawing. */
async function readNames($: $, mem: Memory): Promise<void> {
  if (mem.isReading) return
  mem.isReading = true
  try {
    await noteOwn($, mem)
    await readOthers($, mem)
    await refresh($, mem)
  } catch {
    // Unreadable now; the next read tries again.
  } finally {
    mem.isReading = false
  }
}

/** This chat's record takes its title and project as the app shows them, and checks in as awake. */
async function noteOwn($: $, mem: Memory): Promise<void> {
  // The id first: a switch to another chat during the reads must not give it this chat's name.
  const id = await currentId($, mem)
  const path = await transcriptOf($)
  const name = path === undefined ? undefined : await titleAt($, path)
  await patchChat($, id, {
    seenAt: await $.clock.now(),
    ...(await placeOf($, mem, path)),
    ...(name === undefined ? {} : { name }),
  })
}

/**
 * Where this chat belongs, as the app groups it: the folder it started in and
 * that folder's project name. The engine's root can follow the work elsewhere.
 */
async function placeOf($: $, mem: Memory, transcript: string | undefined): Promise<{ root: string; project: string }> {
  if (mem.startFolder === undefined && transcript !== undefined) mem.startFolder = await startFolderOf($, transcript)
  const root = mem.startFolder ?? (await $.session.root())
  return { root, project: await projectAt($, mem.repos, root) }
}

/**
 * Other listed chats' names and projects as the app shows them, read from
 * their own files: a chat asleep cannot update its record. Kept for drawing
 * only; each record is written by its own chat alone.
 */
async function readOthers($: $, mem: Memory): Promise<void> {
  const now = await $.clock.now()
  const id = await currentId($, mem)
  const seen: Memory['seen'] = {}
  for (const chat of (await scan($)).chats) {
    if (chat.id === id || !isListed(chat, now)) continue
    const name = chat.transcript === undefined ? undefined : await titleAt($, chat.transcript)
    // Where the chat started, as the app groups it; else the folder its record saved.
    const folder = (chat.transcript === undefined ? undefined : await startFolderOf($, chat.transcript)) ?? chat.root
    const project = folder === undefined ? undefined : await projectAt($, mem.repos, folder)
    seen[chat.id] = {
      ...(name === undefined ? {} : { name }),
      ...(project === undefined ? {} : { project }),
    }
  }
  mem.seen = seen
}

// ---- the main thread's requests and turns -----------------------------------

async function noteRequest($: $, mem: Memory, startedAt: number, used: Usage | null): Promise<void> {
  if (used === null) return
  const id = await currentId($, mem)
  const before = await readChat($, id)
  const lifeMs = lifetimeOf(used, before?.lifeMs)
  if (lifeMs === undefined) return
  const appId = await appIdOf($, mem)
  const transcript = await transcriptOf($)
  await patchChat($, id, {
    // A new record's place; after that the 30 s check-in keeps it.
    ...(before === undefined ? { name: UNTITLED, ...(await placeOf($, mem, transcript)) } : {}),
    size: sizeOf(used),
    lastAt: startedAt,
    lifeMs,
    isRunning: await read($, runningAtom),
    seenAt: await $.clock.now(),
    // A chat making requests is open.
    endedAt: undefined,
    // A record is this chat's own, so an app ID or transcript it saved earlier stays its own.
    ...(appId === undefined ? {} : { appId }),
    ...(transcript === undefined ? {} : { transcript }),
  })
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
  await patchChat($, await currentId($, mem), { isRunning, seenAt: await $.clock.now() })
  await refresh($, mem)
}

/** /keep-warm: toggles the hold on this chat. */
async function keepWarm($: $, mem: Memory): Promise<string> {
  const snap = await refresh($, mem)
  const me = snap.me
  if (snap.holds[snap.myId] !== undefined) {
    await holdChat($, mem, snap.myId, null)
    return 'Hold stopped.'
  }
  if (me === null || me.lastAt + me.lifeMs <= snap.now) {
    return 'This chat has no warm cache to hold.'
  }
  const until = snap.now + quickHoldFor(me.lifeMs)
  await holdChat($, mem, me.id, until)
  return `Keeping this chat warm until ${timeOfDay(until)}.`
}

// ---- the module ---------------------------------------------------------------

export const register: Register = on => {
  const mem: Memory = {
    id: undefined,
    ticker: undefined,
    spinner: undefined,
    isTicking: false,
    isPinging: false,
    isReading: false,
    ticks: 0,
    warnedAt: undefined,
    appId: undefined,
    openingTimer: undefined,
    isPaneUp: false,
    repos: {},
    startFolder: undefined,
    seen: {},
  }

  on('session.start', async ($, e, next) => {
    const id = await $.session.id()
    mem.id = id
    await setHold($, id, null)
    await reopen($, id)
    await prune($, await $.clock.now())
    await $.command.register({ name: 'cache-clock', description: 'Show how long each chat stays warm' })
    await $.command.register({ name: 'keep-warm', description: 'Hold this chat warm, or stop the hold' })
    mem.ticker?.cancel()
    mem.ticker = $.clock.every(1000, () => void tick($, mem))
    await refresh($, mem)
    await noteAppId($, mem)
    await restorePane($, mem)
    await readNames($, mem)
    return next(e)
  })

  // The app draws this chat again, as when it is brought back on screen.
  on('session.attach', { surface: 'desktop' }, async ($, e, next) => {
    await noteAppId($, mem, true)
    await restorePane($, mem, true)
    await readNames($, mem)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Closed by hand (its × or close key): the panel is not brought back. An
  // engine unload or shutdown is not the person's choice, so the wish stays.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      mem.isPaneUp = false
      await setWish($, await currentId($, mem), null)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await leaveConversation($, e.sessionId)
    await update($, choosingAtom, () => false)
    return next(e)
  })

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
    if (e.agentId === undefined) {
      await setRunning($, mem, false)
      await readNames($, mem)
    }
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
          <Button key="held" onPress={() => holdChat($, mem, me.id, null)}>
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
              await holdChat($, mem, me.id, (await $.clock.now()) + choice.ms)
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
      // Only an awake window can keep its chat warm, so a sleeping chat offers no hold.
      const tickBox = r.canHold && (
        <Button
          key={`hold:${chat.id}`}
          plain
          onPress={async () =>
            holdChat($, mem, chat.id, isHeld ? null : (await $.clock.now()) + quickHoldFor(chat.lifeMs))
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
