#!/usr/bin/env node
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ProviderConfigError, resolveProvider } from '../server/generate/factory.ts';
import type { Origin, PassOneResponse } from '../server/generate/schemas.ts';
import { runCodeReview } from '../server/lens/code-review.ts';
import { resolveTarget } from '../server/lens/resolve.ts';
import { groupByCategory, saveReview, type ReviewPayload } from '../server/lens/save.ts';
import { runMcpServer } from '../server/mcp/server.ts';

type Decision = PassOneResponse['decisions'][number];

const COSIGN_VERSION = '0.1.0';

function printUsage(): void {
  console.log(`cosign ${COSIGN_VERSION}

Usage:
  cosign review <file-or-name>     Run the default review lens
  cosign mcp                       Start a local MCP server over stdio
  cosign --version                 Print version

The file argument can be:
  - An explicit path: src/components/Hero.tsx
  - A name to fuzzy-match against your project: hero
  - Words for an AI assistant to forward: review the hero on this page
  (everything after "review" is parsed; typos like "revew" / "rev" also work)

Flags:
  --json                           Print machine-readable JSON to stdout
  --no-write                       Skip writing the review file
  --open / --no-open               Open / don't open the HTML review in your
                                   browser (default: open)
  --help, -h                       This message

Setup:
  Set an API key for your AI provider: ANTHROPIC_API_KEY, OPENAI_API_KEY,
  or OPENROUTER_API_KEY. Either in your shell or a .env file in the cwd.

MCP setup:
  Add to Claude Code / Cursor / any MCP client's config:
    {
      "mcpServers": {
        "cosign": { "command": "cosign", "args": ["mcp"] }
      }
    }
  Or run: claude mcp add cosign cosign mcp`);
}

interface Flags {
  json: boolean;
  noWrite: boolean;
  open: boolean | null;
  help: boolean;
  version: boolean;
}

function parseFlags(argv: string[]): { positional: string[]; flags: Flags } {
  const flags: Flags = {
    json: false,
    noWrite: false,
    open: null,
    help: false,
    version: false,
  };
  const positional: string[] = [];
  for (const a of argv) {
    if (a === '--json') flags.json = true;
    else if (a === '--no-write') flags.noWrite = true;
    else if (a === '--open') flags.open = true;
    else if (a === '--no-open') flags.open = false;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a === '--version' || a === '-V') flags.version = true;
    else positional.push(a);
  }
  return { positional, flags };
}

// ----- input forgiveness -----

const KNOWN_COMMANDS = ['review', 'mcp'];

function resolveCommand(input: string): string | null {
  const cmd = input.toLowerCase();
  if (KNOWN_COMMANDS.includes(cmd)) return cmd;
  for (const known of KNOWN_COMMANDS) {
    if (known.startsWith(cmd) && cmd.length >= 2) return known;
    if (levenshtein(cmd, known) <= 2) return known;
  }
  return null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

async function main(): Promise<void> {
  const { positional, flags } = parseFlags(process.argv.slice(2));

  if (flags.version) {
    console.log(COSIGN_VERSION);
    process.exit(0);
  }
  if (flags.help || positional.length === 0) {
    printUsage();
    process.exit(flags.help ? 0 : 1);
  }

  const [rawCmd, ...rest] = positional;
  const cmd = resolveCommand(rawCmd);
  if (!cmd) {
    console.error(`Unknown command: "${rawCmd}". Did you mean "review" or "mcp"?`);
    printUsage();
    process.exit(1);
  }
  if (cmd !== rawCmd && rawCmd !== 'rev' && rawCmd !== 'mc') {
    console.error(C.dim(`(interpreting "${rawCmd}" as "${cmd}")`));
  }

  if (cmd === 'mcp') {
    await runMcpServer();
    return;
  }

  // cmd === 'review' from here on
  if (rest.length === 0) {
    console.error(
      'What should I review? Pass a file path, a component name, or a phrase like "the hero on the home page".',
    );
    process.exit(1);
  }

  let resolved;
  try {
    resolved = resolveProvider(process.env);
  } catch (e) {
    if (e instanceof ProviderConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  const cwd = process.cwd();
  const resolveResult = await resolveTarget(rest, cwd);
  if (resolveResult.kind === 'none') {
    console.error(`No component files in ${prettyPath(cwd)} match "${resolveResult.query}".`);
    process.exit(1);
  }
  if (resolveResult.kind === 'tied') {
    const list = resolveResult.matches
      .slice(0, 6)
      .map((f, i) => `  ${i + 1}. ${prettyPath(f)}`)
      .join('\n');
    console.error(
      `Multiple files match "${resolveResult.query}":\n${list}\n\nNarrow it down: cosign review ${prettyPath(resolveResult.matches[0])}`,
    );
    process.exit(1);
  }
  const filePath = resolveResult.path;
  if (resolveResult.matchedQuery) {
    console.error(
      C.dim(`(matched "${resolveResult.matchedQuery}" → ${prettyPath(filePath)})`),
    );
  }

  const source = await readFile(filePath, 'utf-8');
  const fileName = basename(filePath);

  if (!flags.json) {
    console.error(
      C.dim('Reviewing ') + C.bold(fileName) + C.dim(` with ${resolved.label}…`),
    );
  }

  const t0 = Date.now();
  let review: PassOneResponse;
  try {
    review = await runCodeReview(resolved.provider, resolved.model, { fileName, source });
  } catch (e) {
    console.error('Review failed:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  const elapsedMs = Date.now() - t0;

  let jsonPath: string | null = null;
  let htmlPath: string | null = null;
  if (!flags.noWrite) {
    const payload: ReviewPayload = {
      version: COSIGN_VERSION,
      lens: 'default',
      provider: resolved.name,
      model: resolved.model,
      filePath,
      fileName,
      createdAt: new Date().toISOString(),
      elapsedMs,
      review,
    };
    const saved = await saveReview(cwd, payload);
    jsonPath = saved.jsonPath;
    htmlPath = saved.htmlPath;
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(review, null, 2) + '\n');
    return;
  }

  if (process.stdout.isTTY) {
    printPretty(review, filePath);
  } else {
    printMarkdown(review, filePath, htmlPath, elapsedMs);
  }

  if (htmlPath) {
    const url = `file://${htmlPath}`;
    const lines = process.stdout.isTTY
      ? [
          '',
          C.dim('View in browser: ') + url,
          C.dim('Saved to        ') + prettyPath(jsonPath!),
          C.dim('Took            ') + (elapsedMs / 1000).toFixed(1) + 's',
        ]
      : ['', `View in browser: ${url}`, `Took ${(elapsedMs / 1000).toFixed(1)}s`];
    for (const l of lines) console.log(l);

    const shouldOpen = flags.open !== false;
    if (shouldOpen) openInBrowser(htmlPath);
  }
}

function openInBrowser(htmlPath: string): void {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';
  try {
    const child = spawn(cmd, [htmlPath], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // best-effort; URL is already printed
  }
}

// ----- pretty output (TTY: ANSI) -----

const C = {
  reset: '\x1b[0m',
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  mag: (s: string) => `\x1b[35m${s}\x1b[0m`,
};

function originTag(origin: Origin): string {
  if (origin === 'sourced') return C.green('SRC');
  if (origin === 'interpreted') return C.cyan('INT');
  return C.yellow('AI ');
}

function printPretty(review: PassOneResponse, filePath: string): void {
  console.log('');
  console.log(C.bold(prettyPath(filePath)));
  console.log(C.dim('─'.repeat(Math.min(prettyPath(filePath).length, 60))));

  for (const [category, items] of groupByCategory(review.decisions)) {
    console.log('');
    console.log(C.mag(category.toUpperCase()) + C.dim(` · ${items.length}`));
    for (const item of items) {
      console.log(
        `  ${originTag(item.origin)} ${C.bold(item.summary)} ${C.dim(item.region)}`,
      );
      if (item.whyItMatters && item.whyItMatters.trim().length > 0) {
        console.log('      ' + C.dim(item.whyItMatters));
      }
      if (item.sourceRef) {
        console.log('      ' + C.dim('↳ ' + item.sourceRef));
      }
    }
  }

  const counts = countByOrigin(review.decisions);
  console.log('');
  console.log(C.dim('─'.repeat(60)));
  console.log(
    `${C.bold(String(review.decisions.length))} decisions  ` +
      `${C.green(String(counts.sourced))} sourced · ` +
      `${C.cyan(String(counts.interpreted))} interpreted · ` +
      `${C.yellow(String(counts.ai))} ai`,
  );
}

function countByOrigin(items: Decision[]) {
  return {
    sourced: items.filter((d) => d.origin === 'sourced').length,
    interpreted: items.filter((d) => d.origin === 'interpreted').length,
    ai: items.filter((d) => d.origin === 'ai').length,
  };
}

// ----- markdown output (piped / subprocess) -----

function originBadge(origin: Origin): string {
  if (origin === 'sourced') return '`SRC`';
  if (origin === 'interpreted') return '`INT`';
  return '`AI`';
}

function printMarkdown(
  review: PassOneResponse,
  filePath: string,
  htmlPath: string | null,
  elapsedMs: number,
): void {
  const counts = countByOrigin(review.decisions);

  const lines: string[] = [];
  lines.push(`# ${prettyPath(filePath)}`);
  lines.push('');
  lines.push(
    `**${review.decisions.length} decisions** — ${counts.sourced} sourced · ${counts.interpreted} interpreted · ${counts.ai} ai · _${(elapsedMs / 1000).toFixed(1)}s_`,
  );
  if (htmlPath) {
    lines.push('');
    lines.push(`**View the full review:**`);
    lines.push('');
    lines.push(`file://${htmlPath}`);
  }

  for (const [category, items] of groupByCategory(review.decisions)) {
    lines.push('');
    lines.push(`## ${category} (${items.length})`);
    lines.push('');
    for (const item of items) {
      lines.push(
        `- ${originBadge(item.origin)} **${item.summary}** \`${item.region}\``,
      );
      if (item.whyItMatters && item.whyItMatters.trim().length > 0) {
        lines.push(`  - _${item.whyItMatters}_`);
      }
      if (item.sourceRef) {
        lines.push(`  - source: \`${item.sourceRef}\``);
      }
    }
  }

  console.log(lines.join('\n'));
}

function prettyPath(abs: string): string {
  const cwd = process.cwd();
  return abs.startsWith(cwd) ? abs.slice(cwd.length + 1) || basename(abs) : abs;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});
