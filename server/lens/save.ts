import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PassOneResponse } from '../generate/schemas.ts';

type Decision = PassOneResponse['decisions'][number];

export interface ReviewPayload {
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

export interface SaveResult {
  jsonPath: string;
  htmlPath: string;
}

export async function saveReview(
  cwd: string,
  payload: ReviewPayload,
): Promise<SaveResult> {
  const reviewDir = join(cwd, '.cosign', 'reviews');
  await mkdir(reviewDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(reviewDir, `${stamp}-${payload.fileName}.json`);
  const htmlPath = join(reviewDir, `${stamp}-${payload.fileName}.html`);
  await writeFile(jsonPath, JSON.stringify(payload, null, 2));
  await writeFile(htmlPath, renderHtml(payload));
  return { jsonPath, htmlPath };
}

export function groupByCategory(items: Decision[]): Array<[string, Decision[]]> {
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

export function renderHtml(p: ReviewPayload): string {
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
