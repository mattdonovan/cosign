# cosign

You are still the author. Cosign reads what an AI produced for you — a component, a screen, a vibe-coded feature — and gives you a ledger of every design decision in it: what came from a design system, what the AI interpreted, and what it invented. Ratify, revise, or revert each one. The "co-sign" is yours.

For designers reviewing AI-authored work, engineers shipping AI-generated UIs, and PMs, marketers, and founders who started designing because AI let them — anyone who wants AI in the loop without ceding authorship of the decisions.

> Pre-release. The CLI review lens runs today. An in-browser review side panel is in progress. Cosign isn't on npm yet (the bare name is parked by an unrelated 2014 package), so install is via clone for now; the eventual destination is `npx cosign-cli`.

## Install

Requires Node 20+ and an API key for one of the supported AI providers (see below).

```bash
git clone https://github.com/mattdonovan/cosign
cd cosign
npm install
npm run build:cli
npm link
```

`npm link` registers `cosign` as a global command on your machine, available from any directory.

To pull a new version later, from the cosign clone:

```bash
npm run update
```

That's a shortcut for `git pull && npm install` (the `prepare` script rebuilds the CLI binary automatically). `npm link` doesn't need to run again — it already points at the rebuilt binary.

## Configure an AI provider

Cosign runs as its own process and makes its own API calls. Your IDE's AI (Cursor, Claude Code, Windsurf, etc.) authenticates separately and doesn't share credentials with other tools — so cosign needs its own key. Set the env var for whichever provider you want to use, in your shell or in a `.env` file in the project you're reviewing:

```bash
# Pick whichever provider you already have a key for:
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export OPENROUTER_API_KEY=sk-or-...
```

Cosign auto-detects which provider to use from whichever key is set. To force one when you have multiple, set `COSIGN_PROVIDER=anthropic|openai|openrouter`. Override the model with `COSIGN_MODEL_REVIEW=...`. Point at any OpenAI-compatible endpoint with `COSIGN_BASE_URL=...`.

## Run

From inside any project:

```bash
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

In Cursor, Claude Code, Windsurf, or any IDE with an AI assistant that can run shell commands, just say what you want:

> _"Use cosign to review the hero on this page."_

The assistant will look at the workspace, pick the right file, and run `cosign review <path>` for you. The CLI's fuzzy matching means it works even when the assistant passes through a loose phrase.

## Use cases

**Designer auditing an AI-generated component.** A teammate hands you a TSX file Cursor wrote for them. Run cosign on it before signing off — every color, spacing, copy choice, focus state, and accessibility decision surfaces as an `AI` item you can ratify, revise, or revert. The ledger is your review surface.

**Engineer triaging unreviewed AI decisions before merging.** Run cosign on any vibe-coded component on the branch. The `AI` count tells you how many decisions still need a human reading; the `SRC` count tells you how much actually traces back to your design tokens.

**PM checking copy and structure before launch.** Cosign treats UI copy as a decision. If the AI wrote your headline or invented the menu labels, they'll show up under `content · AI` with a one-line "why it matters."

**Founder or solo builder reviewing outsourced work.** Cosign reads code the same way regardless of who wrote it. Run it on a contractor's delivery to surface the choices that haven't been made deliberately.

## Where it works

Any environment with a terminal and a file path: Cursor, VS Code, GitHub Codespaces, plain shell, Warp, iTerm. Hosted in-browser builders (Figma Make, v0, Bolt, Lovable) don't expose a local terminal — export the code to a local repo first, then run cosign on the exported files.

## Roadmap

- Publish to npm as `cosign-cli`
- Lens selector (default plus accessibility, brand, copy-voice, etc.)
- Repo integration: post reviews as PR comments or issues
- Browser side panel with click-to-highlight on the live page
- Designer-authorship score per decision
- Visual diff loop with [Argos](https://argos-ci.com) for regression across regenerations

## License

[MIT](LICENSE)
