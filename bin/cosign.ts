#!/usr/bin/env node
import 'dotenv/config';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { AnthropicProvider } from '../server/generate/anthropic.ts';
import type { Origin, PassOneResponse } from '../server/generate/schemas.ts';

type Decision = PassOneResponse['decisions'][number];
import { runCodeReview } from '../server/lens/code-review.ts';

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
  help: boolean;
  version: boolean;
}

function parseFlags(argv: string[]): { positional: string[]; flags: Flags } {
  const flags: Flags = { json: false, noWrite: false, help: false, version: false };
  const positional: string[] = [];
  for (const a of argv) {
    if (a === '--json') flags.json = true;
    else if (a === '--no-write') flags.noWrite = true;
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

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      'ANTHROPIC_API_KEY is not set. Add it to your shell or a .env file and try again.',
    );
    process.exit(1);
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
  const model = process.env.COSIGN_MODEL_REVIEW?.trim() || 'claude-sonnet-4-6';
  const provider = new AnthropicProvider(apiKey);

  if (!flags.json) {
    console.error(C.dim('Reviewing ') + C.bold(fileName) + C.dim(` with ${model}…`));
  }

  let review: PassOneResponse;
  try {
    review = await runCodeReview(provider, model, { fileName, source });
  } catch (e) {
    console.error('Review failed:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  let savedPath: string | null = null;
  if (!flags.noWrite) {
    const reviewDir = join(process.cwd(), '.cosign', 'reviews');
    await mkdir(reviewDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    savedPath = join(reviewDir, `${stamp}-${fileName}.json`);
    const payload = {
      version: COSIGN_VERSION,
      lens: 'default',
      model,
      filePath,
      fileName,
      createdAt: new Date().toISOString(),
      review,
    };
    await writeFile(savedPath, JSON.stringify(payload, null, 2));
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(review, null, 2) + '\n');
    return;
  }

  printPretty(review, filePath);
  if (savedPath) {
    console.log(C.dim(`\nSaved to ${prettyPath(savedPath)}`));
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

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});
