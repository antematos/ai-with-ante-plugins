// Chat and project names as the desktop app shows them, read from disk and git.
// Reads only: nothing here writes to the store.
import type { EngineInterface } from 'claude-code'

import { cwdIn, repoNameOf, titleIn } from './logic'

type $ = EngineInterface

/** Repository names already looked up, by folder; '' for a folder outside any repository. */
export type RepoCache = Record<string, string>
/** Start folders already found, by transcript path; a chat's start never changes. */
export type StartCache = Record<string, string>

/** How much of a transcript's end is read for its title; its start, for its folder. */
const TAIL = 256 * 1024
/** The most of a transcript read when the title is not near its end. */
const MOST = 4 * 1024 * 1024

/** The folder's own name: the last part of its path. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(part => part !== '')
  return parts[parts.length - 1] ?? path
}

/** The title in transcript `path`; undefined when unreadable or untitled. */
export async function titleAt($: $, path: string): Promise<string | undefined> {
  try {
    const { size } = await $.fs.stat(path)
    const from = Math.max(0, size - TAIL)
    const title = titleIn(await $.fs.read(path, { offset: from, length: TAIL }))
    // The title can sit early in a long chat: then read from the start.
    if (title !== undefined || from === 0) return title
    return titleIn(await $.fs.read(path, { offset: 0, length: Math.min(size, MOST) }))
  } catch {
    return undefined // unreadable now; the next read tries again
  }
}

/** The project's name for folder `root`: its git repository's name, else the folder's. */
export async function projectAt($: $, repos: RepoCache, root: string): Promise<string> {
  return (await repoAt($, repos, root)) ?? folderName(root)
}

/**
 * The folder a transcript's chat started in, which the app groups it by; not
 * where its shell or the engine's root moved later. Undefined when unreadable.
 */
export async function startFolderOf($: $, starts: StartCache, path: string): Promise<string | undefined> {
  if (path in starts) return starts[path]
  try {
    // Usually in the first lines; a long first message can push it further in.
    let folder = cwdIn(await $.fs.read(path, { offset: 0, length: TAIL }))
    if (folder === undefined) {
      const { size } = await $.fs.stat(path)
      if (size > TAIL) folder = cwdIn(await $.fs.read(path, { offset: 0, length: Math.min(size, MOST) }))
    }
    if (folder !== undefined) starts[path] = folder
    return folder
  } catch {
    return undefined // unreadable now, or no folder recorded yet: asked again next time
  }
}

/** The git repository's name for a folder, or undefined outside one; an answer is kept, a failure is not. */
async function repoAt($: $, repos: RepoCache, folder: string): Promise<string | undefined> {
  if (folder in repos) return repos[folder] || undefined
  try {
    const run = await $.process.run(['git', '-C', folder, 'remote', 'get-url', 'origin'], { timeoutMs: 5000 })
    const name = run.exitCode === 0 ? repoNameOf(run.stdout) : undefined
    repos[folder] = name ?? ''
    return name
  } catch {
    return undefined // no git, or it timed out: asked again next time
  }
}
