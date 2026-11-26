# AI with Ante: Claude Code add-ons

Small, free add-ons for Claude Code from AI with Ante.

You need [Claude Code](https://claude.com/claude-code) installed.

## Install

The steps are the same on Mac and Windows.

### In the desktop app

1. In any Claude Code chat, type `/plugin` and press Enter. The Plugins screen opens.
2. Click **Add** (top right), then **Add marketplace**.
3. Click **Add from a repository**, paste this link, and confirm:

   ```
   https://github.com/antematos/ai-with-ante-plugins
   ```

4. Find the add-on you want in the list and click **Install**.
5. Quit Claude completely and open it again.

### In a terminal

Paste these into Claude Code, one at a time:

```
/plugin marketplace add antematos/ai-with-ante-plugins
```

Then install the add-on you want by name:

```
/plugin install <name>@ai-with-ante
```

Restart Claude Code after installing.

## What's here

| Add-on | What it does | Install name |
|---|---|---|
| [Cache Clock](plugins/cache-clock/README.md) | Shows how long each chat stays warm, beside the model name and in a side panel, and can hold a chat warm. | `cache-clock` |

## Updates

To get the latest versions:

```
/plugin marketplace update ai-with-ante
```

## Licence

MIT. See [LICENSE](LICENSE).
