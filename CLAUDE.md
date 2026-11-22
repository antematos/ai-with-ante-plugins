# ai-with-ante-plugins

Ante's public repo of Claude Code add-ons for the AI with Ante audience. People install from it with `/plugin marketplace add antematos/ai-with-ante-plugins`.

## Map

| Path | Holds |
|---|---|
| `.claude-plugin/marketplace.json` | The catalogue. Every add-on in `plugins/` is listed here with its version. |
| `plugins/<name>/` | One add-on each: `.claude-plugin/plugin.json`, its code, its own `README.md`. |
| `CONTEXT.md` | The agreed words. |
| `docs/agents/` | Where the engineering skills find the issue tracker, labels and domain docs. |
| `docs/adr/` | Decisions that shape the repo. |

## Rules

- **Own work only.** Everything here is written for this repo. Never copy code, text or assets from another person's project. Ideas are fine; code is not. Anything from outside needs a licence check and a credit, decided by Ante first.
- **Public repo.** Never commit secrets, personal details, client data, or paths and names from Ante's machine.
- **Test first** (`tdd` skill) for every add-on.
- **Check before landing.** `claude plugin validate .` passes, and each add-on is installed from the marketplace and tried once before its version is bumped.
- **Versions.** Bump the version in both `plugin.json` and `marketplace.json` when an add-on changes.
- **Audience.** READMEs are for beginners: plain words, short steps, paste-in commands first.
- **Branches.** Work on a branch per issue; Ante merges into `main`.

## Agent skills

### Issue tracker

GitHub Issues on `antematos/ai-with-ante-plugins`, via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
