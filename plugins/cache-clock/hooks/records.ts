// The shared store: every chat's record, every hold and every panel wish.
// All reads and writes of those keys go through here.
import type { EngineInterface } from 'claude-code'

import type { CacheClockChat } from '../types'
import { isListed } from './logic'

type $ = EngineInterface

const CHAT = 'chat:'
const HOLD = 'hold:'
/** `pane:<id>`: chat `id` asked for the panel and has not closed it by hand. */
const WISH = 'pane:'
/** A panel wish for a chat not seen this long is forgotten. */
const WISH_FOR = 30 * 24 * 60 * 60 * 1000

/** Everything in the store, read in one pass. */
export type Scan = {
  /** Every well-formed chat record, listed or not. */
  chats: CacheClockChat[]
  /** Hold end times by chat id, past ones included. */
  holds: Record<string, number>
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

function numberIn(value: unknown, field: 'until' | 'at'): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const n = (value as Record<string, unknown>)[field]
  return typeof n === 'number' ? n : undefined
}

export async function readChat($: $, id: string): Promise<CacheClockChat | undefined> {
  const value = await $.store.get(CHAT + id)
  return isChat(value) ? value : undefined
}

/**
 * Saves `fields` on chat `id`'s record as it stands at this moment, leaving
 * every other field as it is; a field given as undefined is removed. With no
 * record yet, one is made only when the fields make a whole record. Only the
 * chat's own window calls this for its chat. Returns the record as saved.
 */
export async function patchChat(
  $: $,
  id: string,
  fields: Partial<CacheClockChat>,
): Promise<CacheClockChat | undefined> {
  // Saves to one record wait their turn, so one never puts back what another just changed.
  const before = saving.get(id) ?? Promise.resolve()
  let done = () => {}
  const mine = new Promise<void>(resolve => (done = resolve))
  saving.set(id, mine)
  try {
    await before
    const next: Record<string, unknown> = { ...((await readChat($, id)) ?? {}), ...fields, id }
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
    if (!isChat(next)) return undefined
    await $.store.set(CHAT + id, next)
    return next
  } finally {
    done()
    if (saving.get(id) === mine) saving.delete(id)
  }
}

/** The save to each record now under way, by chat id. */
const saving = new Map<string, Promise<void>>()

/** Every chat record and hold, in one pass over the store. */
export async function scan($: $): Promise<Scan> {
  const chats: CacheClockChat[] = []
  const holds: Record<string, number> = {}
  for (const key of await $.store.keys()) {
    if (key.startsWith(CHAT)) {
      const value = await $.store.get(key)
      if (isChat(value)) chats.push(value)
    } else if (key.startsWith(HOLD)) {
      const until = numberIn(await $.store.get(key), 'until')
      if (until !== undefined) holds[key.slice(HOLD.length)] = until
    }
  }
  return { chats, holds }
}

/** Holds chat `id` until `until`, or stops its hold with null. */
export async function setHold($: $, id: string, until: number | null): Promise<void> {
  if (until === null) await $.store.delete(HOLD + id)
  else await $.store.set(HOLD + id, { until })
}

/** Whether chat `id` asked for the panel and never closed it by hand. */
export async function hasWish($: $, id: string): Promise<boolean> {
  return (await $.store.get(WISH + id)) !== undefined
}

/** Chat `id` wants the panel, as of `now`; or, with null, no longer does. */
export async function setWish($: $, id: string, now: number | null): Promise<void> {
  if (now === null) await $.store.delete(WISH + id)
  else await $.store.set(WISH + id, { at: now })
}

/** Whether chat `chat` was deleted: its conversation file is gone from disk. */
export async function isDeleted($: $, chat: CacheClockChat): Promise<boolean> {
  if (chat.transcript === undefined) return false
  try {
    if (await $.fs.exists(chat.transcript)) return false
    // Only a missing file in a folder this window can see counts: an engine
    // that shares the store but not the disk must not delete live chats.
    const folder = chat.transcript.replace(/[\\/][^\\/]*$/, '')
    return folder !== chat.transcript && folder !== '' && (await $.fs.exists(folder))
  } catch {
    return false
  }
}

/**
 * Removes chats the panel no longer lists or that were deleted, holds past
 * their end, and panel wishes for chats unused for 30 days.
 */
export async function prune($: $, now: number): Promise<void> {
  for (const key of await $.store.keys()) {
    const value = await $.store.get(key)
    if (key.startsWith(CHAT)) {
      if (isChat(value) && (!isListed(value, now) || (await isDeleted($, value)))) await $.store.delete(key)
    } else if (key.startsWith(HOLD)) {
      if ((numberIn(value, 'until') ?? 0) <= now) await $.store.delete(key)
    } else if (key.startsWith(WISH)) {
      if ((numberIn(value, 'at') ?? 0) + WISH_FOR <= now) await $.store.delete(key)
    }
  }
}
