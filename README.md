# AI with Ante: Claude Code add-ons

Small, free add-ons for Claude Code from AI with Ante.

You need [Claude Code](https://claude.com/claude-code) installed.

## Install

The steps are the same on Mac and Windows.

### In the desktop app

1. In the Claude desktop app, click **Plugins** in the left sidebar.
2. Click **Add** (top right), then **Add marketplace**.
3. Click **Add from a repository**.
4. In the **URL** box, paste this, then click **Sync**:

   ```
   antematos/ai-with-ante-plugins
   ```

5. The add-ons appear in the list. Click **+** on the one you want.
6. A note says the add-on runs code on your computer. Click **Continue**.
7. Quit Claude completely and open it again.

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
