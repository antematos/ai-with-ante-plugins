# Cache Clock

See how long each chat stays "warm", so you can reply before it goes cold.

## Install

Paste these into Claude Code, one at a time:

```
/plugin marketplace add antematos/ai-with-ante-plugins
```

```
/plugin install cache-clock@ai-with-ante
```

Then restart Claude Code.

## What is a warm chat?

Claude keeps a copy of your chat for a short time after each reply. This copy is called the prompt cache. While it is there, your next message is much cheaper, because Claude only has to read the copy. Once the time runs out, the chat goes cold, and your next message re-sends the whole chat at a higher price.

The cache lasts 5 minutes or 1 hour, depending on your setup. Every new message (and every keep-warm ping, see below) starts the clock again.

Cache Clock shows the time left. It reads the numbers Claude Code already has, so watching the clock costs nothing.

## What you see

Beside the model name, under the prompt box (desktop app):

- A small bar and the time left, for example `53:05`.
- **Green**: more than half the time is left.
- **Amber**: between half and one fifth is left.
- **Red**: the last fifth. You also get one small pop-up note when a chat turns red.
- **cold** in blue: the time is up.
- While Claude is working, the bar and clock make way for a small moving orange star.

Nothing shows in a brand-new chat until Claude has replied once.

## Hold: keep a chat warm

Press **Hold** beside the bar. A row opens above the prompt: hold for 1 h, 4 h or 8 h (15, 30 or 45 minutes if your cache lasts 5 minutes). Press the × to close the row without choosing.

While a chat is held, the button reads **Held** and the time in green shows when the hold ends, for example `to 4:30 pm`. Press **Held** to stop.

How it works: shortly before the chat would go cold, Cache Clock sends Claude one tiny background question. That reads the cached chat and starts its clock again. If a ping ever finds the cache already gone, the hold stops and tells you, so it never keeps paying full price.

A hold belongs to one chat. It ends when its time is up, or when that window starts a new chat (`/clear`), resumes another, or restarts. A held chat's window must stay open for the hold to work.

You can also type:

```
/keep-warm
```

to start or stop a hold on the current chat (8 hours, or 45 minutes on a 5-minute cache).

## The side panel

Type:

```
/cache-clock
```

A panel opens beside the chat. It lists every chat on this computer that runs Cache Clock, grouped by project, the most urgent first.

| Column | Shows |
|---|---|
| (bar) | How much time is left |
| Name | The chat's name. In the desktop app, click it to go to that chat |
| Size | How big the chat is, in tokens (for example `410k`) |
| Time | Time left, the hold's end time (for example `4:30 pm`) when held, `cold`, or the Claude Code character while that chat is working |
| Hold | Tick to hold that chat for 8 hours (45 minutes on a 5-minute cache); untick to stop |

A cold chat stays in the list, greyed, for a day and then drops off.

A chat's name becomes clickable once that chat has replied at least once with Cache Clock 0.2.0 or later. If a click doesn't take you to the chat, find it in the sidebar by its name.

## What it costs

Cache Clock itself costs nothing to watch. Holding a chat costs one small ping each time the clock is about to run out. Here is how cached input is priced, compared with the normal input price ("1x"):

| What | Price |
|---|---|
| Writing the cache, 5-minute | 1.25x |
| Writing the cache, 1-hour | 2x |
| Reading the cache (Fable 5.2 and 5.1, Mythos 5.2 and 5.1) | 0.025x |
| Reading the cache (Opus 5.5 and Sonnet 5.5) | 0.05x |
| Reading the cache (all other models) | 0.1x |

Each ping is billed as a cache read of the whole chat, plus a few new words. Reading the cache also refreshes its lifetime.

Prices checked 23 Nov 2026 on [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing). Check there for today's prices.

## Works on

- Windows: supported.
- macOS: untested so far.

The bar beside the model name shows in the desktop app. The panel works in the desktop app and the terminal. Clicking a name to go to a chat works in the desktop app only.

## Credit

The little running character is Anthropic's Claude Code character, redrawn from simple squares. Credit to Anthropic.

## Licence

MIT. See [LICENSE](../../LICENSE).
