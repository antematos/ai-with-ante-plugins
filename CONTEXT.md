# Context

The words this repo uses, so issues, code and docs say the same thing.

- **Add-on**: one Claude Code plugin in `plugins/<name>/`. The word used with the audience.
- **Plugin**: Claude Code's technical name for an add-on. Fine in code and docs for builders.
- **Marketplace**: the catalogue file `.claude-plugin/marketplace.json` that lists every add-on. Its name is `ai-with-ante`, so installs read `<name>@ai-with-ante`.
- **Warm / cold** (Cache Clock): a chat is warm while its prompt cache lives (5 minutes or an hour after its last request), cold after.
- **Hold** (Cache Clock): keeping a chat warm with small background pings until a chosen time. Only the chat's own window sends them.
- **Awake / asleep** (Cache Clock): a chat is awake while its window checks in (about every 30 seconds); the desktop app puts idle chats to sleep. Only awake chats can be held or shown as working.
- **Listed** (Cache Clock): shown in the panel: until 4 hours after going cold, or only while warm once closed; a deleted chat never.
- **Closed** (Cache Clock): its window ended or moved to another chat (archived, quit, `/clear`).
- **Panel wish** (Cache Clock): a chat asked for the panel with `/cache-clock` and hasn't closed it by hand, so the panel comes back when the chat wakes.
- **Record** (Cache Clock): one chat's saved entry in the shared store, written only by that chat's own window.
- **Audience**: AI with Ante viewers. Mostly beginners; they install by pasting commands into Claude Code.
