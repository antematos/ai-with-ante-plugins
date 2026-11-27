/**
 * One chat's record under `chat:<id>`. Only the chat's own window writes it;
 * other windows read it, and any window may remove it once it is no longer listed.
 */
export type CacheClockChat = {
  id: string
  name: string
  project: string
  /** Input + cache read + cache write tokens of the last main-thread request. */
  size: number
  /** When the last request that read or wrote the cache started (ms). */
  lastAt: number
  /** How long the cache lives after `lastAt` (ms): 5 or 60 minutes. */
  lifeMs: number
  isRunning: boolean
  /** The desktop app's own ID for the chat (`local_…`); absent outside the app. */
  appId?: string
  /** The folder the chat works in, so any window can name its project. */
  root?: string
  /** The chat's conversation file; once it is gone from disk, the chat was deleted. */
  transcript?: string
  /** When the chat's window closed or moved to another chat (ms); absent while open. */
  endedAt?: number
  /** When the chat's window last checked in (ms), about every 30 s while it is awake. */
  seenAt?: number
}

/** What the drawings read, refreshed every second. */
export type CacheClockSnapshot = {
  now: number
  myId: string
  /** This chat's record; null before its first cache reading. */
  me: CacheClockChat | null
  /** Every chat on this computer still listed (this one included). */
  chats: CacheClockChat[]
  /** Hold end times by chat id. */
  holds: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    'cache-clock': {
      snap: Shaped<CacheClockSnapshot | null>
      isRunning: boolean
      frame: number
      isChoosing: boolean
      opening: string | null
    }
  }
}
