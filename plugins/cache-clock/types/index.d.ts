/** One chat's record, saved under `chat:<id>` by that chat alone. */
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
    }
  }
}
