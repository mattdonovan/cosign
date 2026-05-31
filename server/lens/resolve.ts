import { existsSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

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

const COMPONENT_EXT = new Set([
  '.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.astro',
]);

export type ResolveResult =
  | { kind: 'resolved'; path: string; matchedQuery?: string }
  | { kind: 'tied'; matches: string[]; query: string }
  | { kind: 'none'; query: string };

// Resolve a CLI/MCP argument into a file path. Accepts:
//   - an explicit path
//   - a component name (fuzzy-matched against the cwd tree)
//   - a phrase (stopwords stripped, words scored against filenames)
export async function resolveTarget(
  args: string[],
  cwd: string,
): Promise<ResolveResult> {
  // 1. Try args verbatim as a path.
  const candidates = [args.join(' '), args[0]].filter(Boolean) as string[];
  for (const c of candidates) {
    const direct = resolve(cwd, c);
    if (existsSync(direct) && statSync(direct).isFile()) {
      return { kind: 'resolved', path: direct };
    }
  }

  // 2. Fuzzy search using the words from the input.
  const words = args
    .join(' ')
    .toLowerCase()
    .split(/[\s,.;:'"!?()\[\]/_-]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

  if (words.length === 0) {
    return { kind: 'none', query: args.join(' ') };
  }

  const files = await walkProject(cwd);
  const scored = files
    .map((f) => ({ file: f, score: scoreMatch(f, words) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { kind: 'none', query: words.join(' ') };
  }

  const top = scored[0].score;
  const tied = scored.filter((s) => s.score === top).map((s) => s.file);

  if (tied.length > 1) {
    return { kind: 'tied', matches: tied, query: words.join(' ') };
  }

  return { kind: 'resolved', path: tied[0], matchedQuery: words.join(' ') };
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
