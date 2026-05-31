#!/usr/bin/env node
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { ProviderConfigError, resolveProvider } from '../server/generate/factory.ts';
import type { Origin, PassOneResponse } from '../server/generate/schemas.ts';
import { runCodeReview } from '../server/lens/code-review.ts';

type Decision = PassOneResponse['decisions'][number];

const COSIGN_VERSION = '0.1.0';

function printUsage(): void {
  console.log(`cosign ${COSIGN_VERSION}

Usage:
  cosign review <file-or-name>     Run the default review lens
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
                                   browser (default: open when run from a TTY)
  --help, -h                       This message

Setup:
  Set ANTHROPIC_API_KEY in your shell or in a .env file in the cwd.

Output:
  Pretty terminal summary + a full ledger saved to
  .cosign/reviews/<timestamp>-<filename>.json in the current directory.`);
}

interface Flags {
  json: boolean;
  noWrite: boolean;
  open: boolean | null; // null = default (auto-open when TTY)
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

const KNOWN_COMMANDS = ['review'];

function resolveCommand(input: string): string | null {
  const cmd = input.toLowerCase();
  if (KNOWN_COMMANDS.includes(cmd)) return cmd;
  for (const known of KNOWN_COMMANDS) {
    // Common typos / abbreviations: rev, reveiw, revw, revew, reveiw…
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

const STOPWORDS = new Set([
  'a', 'an', 'the', 'on', 'in', 'at', 'of', 'for', 'and', 'or', 'but',
  'this', 'that', 'these', 'those', 'my', 'your', 'our', 'their', 'its',
  'page', 'screen', 'component', 'file', 'view',
  'please', 'just', 'really', 'maybe',
]);
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.vite', '.cache', '.cosign',
  '.svelte-kit', '.output', '.nuxt', '.turbo',
  'dist', 'dist-server', 'build', 'out', 'coverage',
]);
const COMPONENT_EXT = new Set(['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.astro']);

async function resolveTarget(args: string[]): Promise<string> {
  const cwd = process.cwd();

  // 1. Try the args verbatim as a path (handles both `review src/Hero.tsx` and
  // `review "src/Hero.tsx"`).
  const candidates = [args.join(' '), args[0]].filter(Boolean) as string[];
  for (const c of candidates) {
    const direct = resolve(cwd, c);
    if (existsSync(direct) && statSync(direct).isFile()) return direct;
  }

  // 2. Fuzzy search using the words from the input.
  const words = args
    .join(' ')
    .toLowerCase()
    .split(/[\s,.;:'"!?()\[\]/_-]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

  if (words.length === 0) {
    throw new Error(
      `Couldn't find "${args.join(' ')}" as a file and no usable search words remain.`,
    );
  }

  const files = await walkProject(cwd);
  const scored = files
    .map((f) => ({ file: f, score: scoreMatch(f, words) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    throw new Error(
      `No component files in ${prettyPath(cwd)} match "${words.join(' ')}".`,
    );
  }

  const top = scored[0].score;
  const tied = scored.filter((s) => s.score === top).map((s) => s.file);

  if (tied.length > 1) {
    const list = tied.slice(0, 6).map((f, i) => `  ${i + 1}. ${prettyPath(f)}`).join('\n');
    throw new Error(
      `Multiple files match "${words.join(' ')}":\n${list}\n\nNarrow it down: cosign review ${prettyPath(tied[0])}`,
    );
  }

  console.error(
    C.dim(`(matched "${words.join(' ')}" → ${prettyPath(tied[0])})`),
  );
  return tied[0];
}

function scoreMatch(filePath: string, words: string[]): number {
  const base = basename(filePath, extname(filePath)).toLowerCase();
  const full = filePath.toLowerCase();
  let s = 0;
  for (const w of words) {
    if (base === w) s += 20;
    else if (base.startsWith(w)) s += 10;
    else if (base.includes(w)) s += 6;
    else if (full.includes(`/${w}`)) s += 3;
    else if (full.includes(w)) s += 1;
  }
  return s;
}

async function walkProject(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.') continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(join(dir, e.name));
      } else if (e.isFile() && COMPONENT_EXT.has(extname(e.name).toLowerCase())) {
        results.push(join(dir, e.name));
      }
    }
  }
  await walk(root);
  return results;
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
    console.error(`Unknown command: "${rawCmd}". Did you mean "review"?`);
    printUsage();
    process.exit(1);
  }
  if (cmd !== rawCmd) {
    console.error(C.dim(`(interpreting "${rawCmd}" as "${cmd}")`));
  }
  if (rest.length === 0) {
    console.error('What should I review? Pass a file path, a component name, or a phrase like "the hero on the home page".');
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

  let filePath: string;
  try {
    filePath = await resolveTarget(rest);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
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

  let savedPath: string | null = null;
  let htmlPath: string | null = null;
  if (!flags.noWrite) {
    const reviewDir = join(process.cwd(), '.cosign', 'reviews');
    await mkdir(reviewDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    savedPath = join(reviewDir, `${stamp}-${fileName}.json`);
    htmlPath = join(reviewDir, `${stamp}-${fileName}.html`);
    const payload = {
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
    await writeFile(savedPath, JSON.stringify(payload, null, 2));
    await writeFile(htmlPath, renderHtml(payload));
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(review, null, 2) + '\n');
    return;
  }

  // TTY → colored ANSI. Anything else (piped, subprocess of Claude Code /
  // Cursor / etc.) → markdown, which renders cleanly in those host UIs.
  if (process.stdout.isTTY) {
    printPretty(review, filePath);
  } else {
    printMarkdown(review, filePath, htmlPath, elapsedMs);
  }

  if (htmlPath) {
    const url = `file://${htmlPath}`;

    // Always print the file URL, regardless of TTY. When a host AI like
    // Claude Code is reformatting our output, a bare URL on its own line is
    // the form most likely to survive intact.
    const lines = process.stdout.isTTY
      ? [
          '',
          C.dim('View in browser: ') + url,
          C.dim('Saved to        ') + prettyPath(savedPath!),
          C.dim('Took            ') + (elapsedMs / 1000).toFixed(1) + 's',
        ]
      : ['', `View in browser: ${url}`, `Took ${(elapsedMs / 1000).toFixed(1)}s`];
    for (const l of lines) console.log(l);

    // Auto-open the HTML in the user's default browser by default. Pass
    // --no-open to suppress (useful when running over SSH, in CI, or when
    // you really do just want the path).
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
    // Browser-opening is best-effort; the file:// URL is already printed.
  }
}

// ----- pretty output -----

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

  const grouped = groupByCategory(review.decisions);
  for (const [category, items] of grouped) {
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

  const counts = {
    sourced: review.decisions.filter((d) => d.origin === 'sourced').length,
    interpreted: review.decisions.filter((d) => d.origin === 'interpreted').length,
    ai: review.decisions.filter((d) => d.origin === 'ai').length,
  };
  console.log('');
  console.log(C.dim('─'.repeat(60)));
  console.log(
    `${C.bold(String(review.decisions.length))} decisions  ` +
      `${C.green(String(counts.sourced))} sourced · ` +
      `${C.cyan(String(counts.interpreted))} interpreted · ` +
      `${C.yellow(String(counts.ai))} ai`,
  );
}

function groupByCategory(items: Decision[]): Array<[string, Decision[]]> {
  const order = [
    'structure',
    'tokens',
    'content',
    'states',
    'accessibility',
    'responsiveness',
    'motion',
  ];
  const map = new Map<string, Decision[]>();
  for (const it of items) {
    const list = map.get(it.category) ?? [];
    list.push(it);
    map.set(it.category, list);
  }
  return order.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
}

function prettyPath(abs: string): string {
  const cwd = process.cwd();
  return abs.startsWith(cwd) ? abs.slice(cwd.length + 1) || basename(abs) : abs;
}

// ----- markdown output (used when stdout isn't a TTY: piped, subprocess) -----

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
  const counts = {
    sourced: review.decisions.filter((d) => d.origin === 'sourced').length,
    interpreted: review.decisions.filter((d) => d.origin === 'interpreted').length,
    ai: review.decisions.filter((d) => d.origin === 'ai').length,
  };

  const lines: string[] = [];
  lines.push(`# ${prettyPath(filePath)}`);
  lines.push('');
  lines.push(
    `**${review.decisions.length} decisions** — ${counts.sourced} sourced · ${counts.interpreted} interpreted · ${counts.ai} ai · _${(elapsedMs / 1000).toFixed(1)}s_`,
  );
  if (htmlPath) {
    // Bare URL on its own line — auto-linked by most markdown renderers and
    // far more likely to survive being reformatted by a host AI than the
    // [name](url) link syntax was.
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

// ----- HTML viewer (self-contained file written next to the JSON) -----

interface ReviewPayload {
  version: string;
  lens: string;
  provider: string;
  model: string;
  filePath: string;
  fileName: string;
  createdAt: string;
  elapsedMs: number;
  review: PassOneResponse;
}

function renderHtml(p: ReviewPayload): string {
  const counts = {
    sourced: p.review.decisions.filter((d) => d.origin === 'sourced').length,
    interpreted: p.review.decisions.filter((d) => d.origin === 'interpreted').length,
    ai: p.review.decisions.filter((d) => d.origin === 'ai').length,
  };

  const sections = groupByCategory(p.review.decisions)
    .map(([category, items]) => {
      const cards = items
        .map(
          (d) => `
        <article class="card origin-${d.origin}">
          <header>
            <span class="origin">${d.origin}</span>
            <span class="region">${esc(d.region)}</span>
          </header>
          <p class="summary">${esc(d.summary)}</p>
          ${d.whyItMatters ? `<p class="why">${esc(d.whyItMatters)}</p>` : ''}
          ${d.sourceRef ? `<p class="source">↳ <code>${esc(d.sourceRef)}</code></p>` : ''}
        </article>`,
        )
        .join('');
      return `
      <section>
        <h2>${esc(category)} <span class="count">${items.length}</span></h2>
        <div class="cards">${cards}</div>
      </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>cosign — ${esc(p.fileName)}</title>
<style>
  :root {
    --canvas: #121212; --surface: #1a1a1a; --surface-2: #1f1f1f;
    --fg: #fafafa; --muted: rgba(250,250,250,0.6); --subtle: rgba(250,250,250,0.4);
    --line: rgba(250,250,250,0.08); --line-strong: rgba(250,250,250,0.16);
    --ai: #FFC400; --ai-soft: rgba(255,196,0,0.12);
    --src: #0CC2A4; --src-soft: rgba(12,194,164,0.12);
    --int: #7dd3fc; --int-soft: rgba(125,211,252,0.12);
    --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    --sans: 'Inter Tight', 'Inter', system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 48px 32px; max-width: 960px; margin-inline: auto;
    background: var(--canvas); color: var(--fg);
    font-family: var(--sans); font-size: 14px; line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  header.top { margin-bottom: 32px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
  .kind { font-family: var(--mono); font-size: 12px; color: var(--subtle);
    letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 8px; }
  h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
  .file { font-family: var(--mono); font-size: 12px; color: var(--muted); margin-top: 4px; }
  .meta { font-family: var(--mono); font-size: 12px; color: var(--muted); margin-top: 12px;
    display: flex; gap: 16px; flex-wrap: wrap; }
  .meta b { font-weight: 600; }
  .meta .n-ai { color: var(--ai); }
  .meta .n-int { color: var(--int); }
  .meta .n-src { color: var(--src); }
  section { margin-top: 32px; }
  section h2 { margin: 0 0 12px; font-family: var(--mono); font-size: 12px;
    color: var(--subtle); letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; }
  section h2 .count { color: var(--subtle); margin-left: 6px; font-weight: 400; }
  .cards { display: flex; flex-direction: column; gap: 8px; }
  .card { padding: 12px; border: 1px solid var(--line); border-radius: 8px;
    background: var(--surface); display: flex; flex-direction: column; gap: 6px; }
  .card.origin-ai { border-color: var(--ai-soft); background: var(--ai-soft); }
  .card.origin-interpreted { background: var(--int-soft); }
  .card.origin-sourced { background: var(--src-soft); }
  .card header { display: flex; align-items: center; gap: 8px;
    font-family: var(--mono); font-size: 10px; letter-spacing: 0.04em; }
  .origin { padding: 2px 6px; border-radius: 999px; font-weight: 600; text-transform: uppercase; }
  .origin-ai .origin { background: var(--ai-soft); color: var(--ai); }
  .origin-interpreted .origin { background: var(--int-soft); color: var(--int); }
  .origin-sourced .origin { background: var(--src-soft); color: var(--src); }
  .region { color: var(--subtle); }
  .summary { margin: 0; color: var(--fg); }
  .why { margin: 0; color: var(--muted); font-size: 13px; }
  .source { margin: 0; font-family: var(--mono); font-size: 11px; color: var(--subtle); }
  .source code { background: var(--surface-2); padding: 1px 5px; border-radius: 4px; color: var(--fg); }
</style>
</head>
<body>
<header class="top">
  <div class="kind">cosign review · ${esc(p.lens)} lens</div>
  <h1>${esc(p.fileName)}</h1>
  <div class="file">${esc(p.filePath)}</div>
  <div class="meta">
    <span><b>${p.review.decisions.length}</b> decisions</span>
    <span class="n-src"><b>${counts.sourced}</b> sourced</span>
    <span class="n-int"><b>${counts.interpreted}</b> interpreted</span>
    <span class="n-ai"><b>${counts.ai}</b> ai</span>
    <span>${esc(p.provider)} · ${esc(p.model)}</span>
    <span>${(p.elapsedMs / 1000).toFixed(1)}s</span>
    <span>${esc(new Date(p.createdAt).toLocaleString())}</span>
  </div>
</header>
${sections}
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});
