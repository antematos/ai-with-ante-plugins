// Drives the plugin the way a session does.
import type { Engine } from 'claude-code/testing'
import type { TurnUsage } from 'claude-code'
import type { World } from './world'

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/work/garden-notes', surface: 'desktop', isInteractive: true })
}

let turns = 0

/** Starts a main-thread turn and makes one model request; leaves it running. */
export async function beginTurn($: Engine, w: World, used: TurnUsage | null, agentId?: string): Promise<string> {
  turns += 1
  const turnId = `turn-${turns}`
  await $.turn.start({ text: 'hello', turnId, agentId })
  w.usage = used
  const stream = $.turn.step({ turnId, index: 0, model: 'claude-test', messageCount: 1, agentId })
  for (;;) {
    const step = await stream.next()
    if (step.done) break
  }
  return turnId
}

export async function endTurn($: Engine, turnId: string, agentId?: string): Promise<void> {
  await $.turn.complete({
    answer: 'done',
    durationMs: 1000,
    isAborted: false,
    turnId,
    agentId,
    reason: 'answer',
  })
}

/** One whole main-thread turn whose request took `tookMs`. */
export async function turn($: Engine, w: World, used: TurnUsage | null, tookMs = 0): Promise<void> {
  const id = await beginTurn($, w, used)
  if (tookMs > 0) await w.clock.advance(tookMs)
  await endTurn($, id)
}
