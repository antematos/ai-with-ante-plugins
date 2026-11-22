# Issue tracker: GitHub

Issues for this repo live on the public repo `antematos/ai-with-ante-plugins`. Use the `gh` CLI, and always pass `--repo antematos/ai-with-ante-plugins`.

## Conventions

- **Create an issue**: `gh issue create --repo antematos/ai-with-ante-plugins --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --repo antematos/ai-with-ante-plugins --comments`.
- **List issues**: `gh issue list --repo antematos/ai-with-ante-plugins --state open --json number,title,labels`.
- **Comment**: `gh issue comment <number> --repo antematos/ai-with-ante-plugins --body "..."`
- **Labels**: `gh issue edit <number> --repo antematos/ai-with-ante-plugins --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --repo antematos/ai-with-ante-plugins --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo antematos/ai-with-ante-plugins --comments`.
