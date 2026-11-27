import { expect, test } from 'claude-code/testing'
import { MIN, makeWorld, usage } from './world'
import { start, turn } from './turns'
import { cwdIn, repoNameOf, titleIn } from '../hooks/logic'

const pane = {
  plugin: 'cache-clock',
  surface: 'desktop',
  component: 'Pane',
  requestId: 'cache-clock',
  props: { title: 'Cache Clock', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** Every text the panel draws. */
async function drawn($: Parameters<Parameters<typeof test>[1]>[0]): Promise<string[]> {
  const ui = await $.ui.mount(pane)
  const all = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return all
}

const line = (entry: Record<string, unknown>) => JSON.stringify({ sessionId: 'chat-a', ...entry }) + '\n'
const said = (text: string) => line({ type: 'user', message: { content: text } })
const aiTitle = (title: string) => line({ type: 'ai-title', aiTitle: title })
const customTitle = (title: string) => line({ type: 'custom-title', customTitle: title })

test('the title: a name the person gave wins over the app’s own, the latest of each', () => {
  expect(titleIn(said('hi') + aiTitle('Garden plan') + said('more'))).toBe('Garden plan')
  expect(titleIn(aiTitle('Garden plan') + customTitle('Seed order') + aiTitle('Later guess'))).toBe('Seed order')
  expect(titleIn(customTitle('First') + customTitle('Second'))).toBe('Second')
  expect(titleIn(said('no title here'))).toBeUndefined()
  // A read that starts mid-line skips the broken line.
  expect(titleIn('le":"cut"}\n' + aiTitle('Whole'))).toBe('Whole')
  expect(titleIn(customTitle('   '))).toBeUndefined()
})

test('the project: the repository’s own name', () => {
  expect(repoNameOf('https://github.com/someone/case-library.git')).toBe('case-library')
  expect(repoNameOf('https://github.com/someone/case-library')).toBe('case-library')
  expect(repoNameOf('git@github.com:someone/seed-notes.git')).toBe('seed-notes')
  expect(repoNameOf('C:\\repos\\herb-beds\\')).toBe('herb-beds')
  expect(repoNameOf('  ')).toBeUndefined()
})

test('a chat the app titled shows that title, with no prompt sent', async ($, on) => {
  const w = makeWorld(on)
  w.files['/t/chat-a.jsonl'] = said('hi') + aiTitle('Plan the herb beds')
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  expect(w.store.get('chat:chat-a')).toMatchObject({ name: 'Plan the herb beds' })
})

test('a chat renamed while it runs shows the new name within half a minute', async ($, on) => {
  const w = makeWorld(on)
  w.files['/t/chat-a.jsonl'] = aiTitle('Plan the herb beds')
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  w.files['/t/chat-a.jsonl'] += customTitle('🏆 Herb beds, final')
  await w.clock.advance(MIN / 2)
  expect(w.store.get('chat:chat-a')).toMatchObject({ name: '🏆 Herb beds, final' })
})

test('the title is found even when it sits early in a long conversation', async ($, on) => {
  const w = makeWorld(on)
  w.files['/t/chat-a.jsonl'] = customTitle('Early title') + said('x'.repeat(600_000))
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  expect(w.store.get('chat:chat-a')).toMatchObject({ name: 'Early title' })
})

test('the project heading is the repository’s name when the folder has one', async ($, on) => {
  const w = makeWorld(on)
  w.gitRemote = 'https://github.com/someone/case-library.git'
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  expect(w.store.get('chat:chat-a')).toMatchObject({ project: 'case-library' })
})

/** Another window's warm chat, asleep, with its transcript and folder saved. */
function asleep(w: ReturnType<typeof makeWorld>, name: string, project: string) {
  w.store.set('chat:other', {
    id: 'other',
    name,
    project,
    size: 100_000,
    lastAt: Date.now(),
    lifeMs: 60 * MIN,
    isRunning: false,
    transcript: '/t/other.jsonl',
    root: '/work/Database folder',
  })
}

test('a chat renamed while asleep shows its new name in any open window, its record untouched', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  const now = (w.store.get('chat:chat-a') as { lastAt: number }).lastAt
  asleep(w, '🏆 Old name', 'case-library')
  ;(w.store.get('chat:other') as { lastAt: number }).lastAt = now
  w.files['/t/other.jsonl'] = line({ type: 'custom-title', customTitle: 'New name' })
  await w.clock.advance(MIN / 2)
  expect(await drawn($)).toContain('New name')
  expect(w.store.get('chat:other')).toMatchObject({ name: '🏆 Old name' })
})

test('a sleeping chat’s project heading is corrected from its saved folder', async ($, on) => {
  const w = makeWorld(on)
  w.gitRemote = 'https://github.com/someone/case-library.git'
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  const now = (w.store.get('chat:chat-a') as { lastAt: number }).lastAt
  asleep(w, 'Some chat', 'Database folder')
  ;(w.store.get('chat:other') as { lastAt: number }).lastAt = now
  await w.clock.advance(MIN / 2)
  expect(await drawn($)).not.toContain('Database folder')
  expect(await drawn($)).toContain('case-library')
})

test('a chat saves its folder, so other windows can name its project', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  expect(w.store.get('chat:chat-a')).toHaveProperty('root')
})

test('an older record with no folder takes its repository from the transcript’s folder', async ($, on) => {
  const w = makeWorld(on)
  w.gitRemote = 'https://github.com/someone/case-library.git'
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  const now = (w.store.get('chat:chat-a') as { lastAt: number }).lastAt
  asleep(w, 'Some chat', 'Database folder')
  const record = w.store.get('chat:other') as Record<string, unknown>
  delete record.root
  record.lastAt = now
  w.files['/t/other.jsonl'] = line({ type: 'user', cwd: '/work/Database folder/sub' })
  await w.clock.advance(MIN / 2)
  expect(await drawn($)).not.toContain('Database folder')
})

test('the working folder: the first a transcript records, where the chat started', () => {
  // Later entries follow the shell wherever it moved.
  expect(cwdIn(line({ cwd: '/a' }) + line({ type: 'x' }) + line({ cwd: '/b' }))).toBe('/a')
  expect(cwdIn(line({ type: 'x' }))).toBeUndefined()
})

test('a chat whose shell moved into another repository keeps its own project', async ($, on) => {
  const w = makeWorld(on)
  w.gitRemotes = { '/work/home': '', '/work/home/config': 'https://github.com/someone/settings-repo.git' }
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  const now = (w.store.get('chat:chat-a') as { lastAt: number }).lastAt
  asleep(w, 'Some chat', 'home')
  const record = w.store.get('chat:other') as Record<string, unknown>
  delete record.root
  record.lastAt = now
  w.files['/t/other.jsonl'] = line({ type: 'user', cwd: '/work/home' }) + line({ type: 'tool', cwd: '/work/home/config' })
  await w.clock.advance(MIN / 2)
  expect(await drawn($)).toContain('home')
  expect(await drawn($)).not.toContain('settings-repo')
})

test('this chat’s own heading is the folder it started in, as the app groups it', async ($, on) => {
  const w = makeWorld(on)
  // Started in a home folder outside any repository; the engine's root later followed the shell into a repository.
  w.cwd = '/work/recipe-site'
  w.gitRemotes = { '/work/recipe-site': 'https://github.com/someone/recipe-site.git' }
  w.files['/t/chat-a.jsonl'] = line({ type: 'user', cwd: '/home/sam' }) + line({ type: 'tool', cwd: '/work/recipe-site' })
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  expect(w.store.get('chat:chat-a')).toMatchObject({ project: 'sam', root: '/home/sam' })
  expect(await drawn($)).toContain('sam')
  expect(await drawn($)).not.toContain('recipe-site')
})

test('another chat’s heading follows where it started, even when its saved folder says otherwise', async ($, on) => {
  const w = makeWorld(on)
  await start($)
  await turn($, w, usage(0, 0, 400_000))
  const now = (w.store.get('chat:chat-a') as { lastAt: number }).lastAt
  asleep(w, 'Some chat', 'ai-plugins')
  ;(w.store.get('chat:other') as { lastAt: number }).lastAt = now
  w.files['/t/other.jsonl'] = line({ type: 'user', cwd: '/home/sam' })
  await w.clock.advance(MIN / 2)
  expect(await drawn($)).toContain('sam')
  expect(await drawn($)).not.toContain('ai-plugins')
})
