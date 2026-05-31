#!/usr/bin/env node
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { AnthropicProvider } from '../server/generate/anthropic.ts';
import type { LedgerItem, Origin, PassOneResponse } from '../server/generate/schemas.ts';
import { runCodeReview } from '../server/lens/code-review.ts';

const COSIGN_VERSION = '0.1.0';

function printUsage(): void {
  console.log(`cosign ${COSIGN_VERSION}

Usage:
  cosign review <file>       Run the default review lens on a single component file
  cosign --version           Print version

Flags:
  --json                     Print machine-readable JSON to stdout instead of pretty output
  --no-write                 Skip writing the review file under .cosign/reviews/

Setup:
  Set ANTHROPIC_API_KEY in your shell or in a .env file in the cwd.

Output:
  Pretty terminal summary by default. The full ledger is always saved to
  .cosign/reviews/<timestamp>-<filename>.json in the current directory unless
  --no-write is passed.`);
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

  const [cmd, target] = positional;
  if (cmd !== 'review') {
    console.error(`Unknown command: ${cmd}`);
    printUsage();
    process.exit(1);
  }
  if (!target) {
    console.error('Missing file path. Usage: cosign review <file>');
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      'ANTHROPIC_API_KEY is not set. Add it to your shell or a .env file and try again.',
    );
    process.exit(1);
  }

  const filePath = resolve(process.cwd(), target);
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
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

function groupByCategory(items: LedgerItem[]): Array<[string, LedgerItem[]]> {
  const order = [
    'structure',
    'tokens',
    'content',
    'states',
    'accessibility',
    'responsiveness',
    'motion',
  ];
  const map = new Map<string, LedgerItem[]>();
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
