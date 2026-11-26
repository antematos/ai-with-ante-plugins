// Pure rules of the Cache Clock: no `$`, no drawing.
import type { CacheClockChat } from '../types'

/** The token counts a request or a ping reports. */
export type Usage = {
  input_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  ephemeral_5m_input_tokens?: number
  ephemeral_1h_input_tokens?: number
}

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const FIVE_MINUTES = 5 * MINUTE

export const COLOR = {
  green: '#16a34a',
  amber: '#f59e0b',
  red: '#ef4444',
  blue: '#3b82f6',
  orange: '#D97757',
  track: '#c4c4c4',
  paneTrack: '#e3e1da',
  quiet: '#9a988f',
  tick: '#2f7de1',
  hairline: '#eceae3',
} as const

export type Phase = 'green' | 'amber' | 'red' | 'cold'

/**
 * How long the cache lives after a request, from its usage: a 1-hour write
 * gives an hour, a 5-minute write five minutes, a read alone keeps what was
 * there before. Undefined when the request neither read nor wrote the cache.
 * Where a request wrote both, the 5-minute part is the conversation's tail
 * (the API puts 1-hour entries first), so the tail's five minutes count.
 */
export function lifetimeOf(used: Usage, previousMs: number | undefined): number | undefined {
  const write5m = used.ephemeral_5m_input_tokens ?? 0
  const write1h = used.ephemeral_1h_input_tokens ?? 0
  const written = used.cache_creation_input_tokens ?? 0
  const read = used.cache_read_input_tokens ?? 0
  if (write5m > 0) return FIVE_MINUTES
  if (write1h > 0) return HOUR
  if (written > 0) return FIVE_MINUTES
  if (read > 0) return previousMs ?? FIVE_MINUTES
  return undefined
}

/** Input + cache read + cache write tokens. */
export function sizeOf(used: Usage): number {
  return (
    (used.input_tokens ?? 0) +
    (used.cache_read_input_tokens ?? 0) +
    (used.cache_creation_input_tokens ?? 0)
  )
}

export function phaseOf(leftMs: number, lifeMs: number): Phase {
  if (leftMs <= 0) return 'cold'
  const share = leftMs / lifeMs
  if (share > 0.5) return 'green'
  if (share > 0.2) return 'amber'
  return 'red'
}

export function colorOf(phase: Phase): string {
  return phase === 'cold' ? COLOR.blue : COLOR[phase]
}

/** Filled cells of the five-cell footer bar: at least one while warm. */
export function cellsOf(leftMs: number, lifeMs: number): number {
  if (leftMs <= 0) return 0
  return Math.min(5, Math.max(1, Math.ceil((leftMs / lifeMs) * 5)))
}

/** `M:SS`, minutes uncapped (`60:00`), rounding up so a fresh hour reads 60:00. */
export function clockText(leftMs: number): string {
  const total = Math.max(0, Math.ceil(leftMs / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Local time as `4:30 pm`. */
export function timeOfDay(ms: number): string {
  const at = new Date(ms)
  const hours = at.getHours()
  const minutes = String(at.getMinutes()).padStart(2, '0')
  const half = hours < 12 ? 'am' : 'pm'
  const twelve = hours % 12 === 0 ? 12 : hours % 12
  return `${twelve}:${minutes} ${half}`
}

/** Tokens as `410k`, or `1.2M` past a million. */
export function sizeText(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
}

export type HoldChoice = { key: string; label: string; ms: number }

/** The lengths the hold row offers. */
export function holdChoicesFor(lifeMs: number): HoldChoice[] {
  if (lifeMs <= FIVE_MINUTES) {
    return [
      { key: 'for-15m', label: '15 min', ms: 15 * MINUTE },
      { key: 'for-30m', label: '30 min', ms: 30 * MINUTE },
      { key: 'for-45m', label: '45 min', ms: 45 * MINUTE },
    ]
  }
  return [
    { key: 'for-1h', label: '1 h', ms: HOUR },
    { key: 'for-4h', label: '4 h', ms: 4 * HOUR },
    { key: 'for-8h', label: '8 h', ms: 8 * HOUR },
  ]
}

/** What the tick box and /keep-warm hold for: 8 hours, or 45 minutes on a 5-minute cache. */
export function quickHoldFor(lifeMs: number): number {
  return lifeMs <= FIVE_MINUTES ? 45 * MINUTE : 8 * HOUR
}

/** How long before going cold a held chat is pinged: 30 s of 5 minutes, 60 s of an hour. */
export function pingLeadFor(lifeMs: number): number {
  return Math.min(60_000, lifeMs / 10)
}

/** The running sign's frames. */
export const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'] as const

/** A listed chat drops off this long after going cold. */
export const DROP_AFTER = 4 * HOUR

/**
 * Whether the panel still lists a chat: until four hours after it went cold,
 * and a chat whose window has closed (archived, quit, /clear) only while warm.
 */
export function isListed(chat: CacheClockChat, now: number): boolean {
  const coldAt = chat.lastAt + chat.lifeMs
  if (chat.endedAt !== undefined && coldAt <= now && !chat.isRunning) return false
  return coldAt + DROP_AFTER > now
}

export type ChatRow = {
  chat: CacheClockChat
  kind: 'warm' | 'held' | 'running' | 'cold'
  leftMs: number
  holdUntil?: number
}

export type ProjectGroup = { project: string; rows: ChatRow[] }

/**
 * The panel's order: most urgent first. Warm chats by time left and held
 * chats by their hold's end, then running chats, then cold ones (most
 * recently cold first). Projects follow their most urgent chat.
 */
export function orderChats(
  chats: readonly CacheClockChat[],
  holds: Readonly<Record<string, number>>,
  now: number,
): ProjectGroup[] {
  const seen = new Set<string>()
  const rows: { row: ChatRow; rank: number; key: number }[] = []
  for (const chat of chats) {
    if (seen.has(chat.id)) continue
    seen.add(chat.id)
    const leftMs = chat.lastAt + chat.lifeMs - now
    const holdUntil = holds[chat.id]
    if (chat.isRunning) {
      rows.push({ row: { chat, kind: 'running', leftMs }, rank: 1, key: 0 })
    } else if (leftMs <= 0) {
      rows.push({ row: { chat, kind: 'cold', leftMs }, rank: 2, key: -(chat.lastAt + chat.lifeMs) })
    } else if (holdUntil !== undefined) {
      rows.push({ row: { chat, kind: 'held', leftMs, holdUntil }, rank: 0, key: holdUntil - now })
    } else {
      rows.push({ row: { chat, kind: 'warm', leftMs }, rank: 0, key: leftMs })
    }
  }
  rows.sort((a, b) => a.rank - b.rank || a.key - b.key)
  const groups: ProjectGroup[] = []
  for (const { row } of rows) {
    let group = groups.find(g => g.project === row.chat.project)
    if (group === undefined) {
      group = { project: row.chat.project, rows: [] }
      groups.push(group)
    }
    group.rows.push(row)
  }
  return groups
}

/**
 * The chat's title as the app shows it, from its transcript's text: the
 * latest name the person gave (`custom-title`), else the latest the app gave
 * (`ai-title`). Undefined when the text holds neither.
 */
export function titleIn(text: string): string | undefined {
  let custom: string | undefined
  let ai: string | undefined
  for (const line of text.split('\n')) {
    if (!line.includes('-title"')) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue // a line cut at the start of a partial read
    }
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as { type?: unknown; customTitle?: unknown; aiTitle?: unknown }
    if (e.type === 'custom-title' && typeof e.customTitle === 'string' && e.customTitle.trim() !== '') {
      custom = e.customTitle.trim()
    } else if (e.type === 'ai-title' && typeof e.aiTitle === 'string' && e.aiTitle.trim() !== '') {
      ai = e.aiTitle.trim()
    }
  }
  return custom ?? ai
}

/** A repository's name from its remote address: `…/case-library.git` gives `case-library`. */
export function repoNameOf(remote: string): string | undefined {
  const parts = remote.trim().replace(/\.git$/, '').split(/[\\/:]/).filter(part => part !== '')
  return parts[parts.length - 1]
}
