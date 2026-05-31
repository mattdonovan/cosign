# cosign

You are still the author. Cosign reads what an AI produced for you — a component, a screen, a vibe-coded feature — and gives you a ledger of every design decision in it: what came from a design system, what the AI interpreted, and what it invented. Ratify, revise, or revert each one. The "co-sign" is yours.

For designers reviewing AI-authored work, engineers shipping AI-generated UIs, and PMs, marketers, founders who started designing because AI let them — anyone who wants AI in the loop without ceding authorship of the decisions.

> Early development. The CLI review lens runs today. An in-browser review side panel is in progress.

## Install

Requires Node 20+ and an [Anthropic API key](https://console.anthropic.com/).

```bash
git clone https://github.com/mattdonovan/cosign
cd cosign
npm install
npm run build:cli
npm link
```

## Run

From inside any project:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cosign review src/components/Hero.tsx
```

You can also point at a file by name or by description — cosign will fuzzy-match against your project tree:

```bash
cosign review hero
cosign review the hero on this page
cosign revew header   # typos are tolerated
```

You'll get a colored terminal summary of every design decision in the file, grouped by category and tagged by origin:

- **SRC** — sourced from a design token, variable, or system constant
- **INT** — a hard-coded literal that maps to a system value
- **AI** — an opinionated decision with no system origin (Decision Debt)

The full ledger is saved to `.cosign/reviews/<timestamp>-<filename>.json` in the project's current directory.

Flags: `--json` for machine output, `--no-write` to skip the saved file, `--help` for everything else.

## With an AI assistant

In Cursor, Claude Code, Windsurf, or any IDE with an AI assistant that can run shell commands, you can just say what you want:

> _"Use cosign to review the hero on this page."_

The assistant will look at the workspace, pick the right file, and run `cosign review <path>` for you. The CLI's fuzzy matching means it works even when the assistant passes through a loose phrase.

## Where it works

Any environment with a terminal and a file path: Cursor, VS Code, GitHub Codespaces, plain shell. Hosted in-browser builders (Figma Make, v0, Bolt) don't expose a local terminal — export the code to a local repo first, then run cosign on the exported files.

## Roadmap

- Lens selector (default + accessibility, brand, etc.)
- Repo integration: post reviews as PR comments or issues
- Browser side panel with click-to-highlight on the live page
- Designer-authorship score per decision
- Visual diff loop with [Argos](https://argos-ci.com) for regression across regenerations

## License

[MIT](LICENSE)
