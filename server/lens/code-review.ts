import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsonrepair } from 'jsonrepair';
import type { Provider, UserContent } from '../generate/provider.ts';
import { PassOneResponse } from '../generate/schemas.ts';

const SYSTEM = `You are Cosign's code review lens. You read a single React/TSX component and produce a structured ledger of every design decision present in the code, so the human can see what was deliberately chosen vs what an AI invented for them. Cosign's purpose is to keep the human as the author of design decisions when an AI is doing the production work.

The user is reviewing AI-generated or AI-assisted code in their own project. Many of them are not designers — they are engineers, PMs, marketers who started doing design because AI let them. Your ledger is their teacher, not just a checklist.

ORIGINS — these are the heart of the product. Get them right.

- sourced — the value clearly comes from a design system token, variable, theme import, or named constant in the project. Examples: \`var(--brand-500)\`, \`theme.colors.primary\`, a Tailwind class like \`bg-primary-500\`, an imported constant like \`SPACING.md\`. The decision was made elsewhere; this code uses it. These are observations, not judgments. List every meaningful one.
- interpreted — a hard-coded value that builds on or substitutes for a system value. Examples: a literal \`#FFC400\` that's clearly the brand warning yellow used elsewhere; a magic \`24px\` that matches the project's spacing scale even though it's not a token reference. The value is concrete; the human's judgment is the mapping/substitution.
- ai — an opinionated decision with no apparent design-system origin or justification. The AI made a call; the designer hasn't ratified it. This is Decision Debt — the human will see it and ratify, revise, or revert.

CATEGORIES — use exactly one of:
states · accessibility · responsiveness · tokens · structure · content · motion

VOICE
- summary: one short sentence in plain language, speaking intent. "The hero headline is 48px semibold." NOT "applied font-size: 48px; font-weight: 600;".
- whyItMatters: one sentence on the human stake. "Without semantic heading levels, screen readers can't tell what's top-level on the page." Required on every 'ai' item. Helpful on 'interpreted' items too.

REGIONS — every item carries a region pointer that anchors it to the code. Use a short line reference like \`L42\` or a range like \`L42-L48\`. The region value is the line reference itself. Make ids predictable from the summary and origin: ai-a11y-focus-ring, sourced-tokens-bg-color, interpreted-tokens-radius, ai-states-hover-lift. Lowercase, hyphens, no spaces. One id is used by exactly one item.

SOURCE REFS — for sourced and interpreted items, set sourceRef to a concrete reference: the variable/token name, the literal value, or \`L<line>:<identifier>\`. For ai items, omit sourceRef.

REQUIREMENTS
- Cover the basics, even when obvious — fill, stroke, radius, padding, gap, font, layout, copy. The ledger's job is to tell the whole story so the human can ratify or revise.
- Never invent sourced values. If you don't see a token or variable in the code, it's ai (or interpreted, if a literal clearly maps to one).
- Output via the submit_review tool. Do not respond with prose.`;

const SCHEMA = {
  type: 'object',
  required: ['decisions'],
  additionalProperties: false,
  properties: {
    decisions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'origin', 'category', 'summary', 'whyItMatters', 'region'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          origin: { type: 'string', enum: ['sourced', 'interpreted', 'ai'] },
          category: {
            type: 'string',
            enum: [
              'states',
              'accessibility',
              'responsiveness',
              'tokens',
              'structure',
              'content',
              'motion',
            ],
          },
          summary: { type: 'string', minLength: 1 },
          whyItMatters: { type: 'string' },
          region: { type: 'string', minLength: 1 },
          sourceRef: { type: 'string' },
        },
      },
    },
  },
} as const;

export interface CodeReviewInput {
  fileName: string;
  source: string;
}

export async function runCodeReview(
  provider: Provider,
  model: string,
  input: CodeReviewInput,
): Promise<PassOneResponse> {
  const numbered = numberLines(input.source);
  const userContent: UserContent[] = [
    {
      type: 'text',
      text: [
        `File: ${input.fileName}`,
        '',
        '<source>',
        numbered,
        '</source>',
      ].join('\n'),
    },
  ];

  const result = await provider.generateStructured<unknown>({
    system: SYSTEM,
    user: userContent,
    model,
    toolName: 'submit_review',
    toolDescription: 'Submit the design-decision ledger for this code file.',
    toolSchema: SCHEMA,
    maxTokens: 16384,
  });
  return PassOneResponse.parse(normalizeToolInput(result, ['decisions']));
}

function numberLines(src: string): string {
  return src
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`)
    .join('\n');
}

type ParseAttempt = { strategy: string; error: string };

function tryParseArray(s: string): { value: unknown[] | null; attempts: ParseAttempt[] } {
  const attempts: ParseAttempt[] = [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return { value: parsed, attempts };
    attempts.push({ strategy: 'JSON.parse', error: `parsed but was ${typeof parsed}` });
  } catch (e) {
    attempts.push({ strategy: 'JSON.parse', error: (e as Error).message });
  }
  try {
    const repaired = JSON.parse(jsonrepair(s));
    if (Array.isArray(repaired)) return { value: repaired, attempts };
    attempts.push({ strategy: 'jsonrepair', error: `parsed but was ${typeof repaired}` });
  } catch (e) {
    attempts.push({ strategy: 'jsonrepair', error: (e as Error).message });
  }
  // Last-ditch: extract the largest [...] substring and try again.
  const first = s.indexOf('[');
  const last = s.lastIndexOf(']');
  if (first >= 0 && last > first) {
    const slice = s.slice(first, last + 1);
    try {
      const parsed = JSON.parse(jsonrepair(slice));
      if (Array.isArray(parsed)) return { value: parsed, attempts };
      attempts.push({ strategy: 'bracket-extract', error: `parsed but was ${typeof parsed}` });
    } catch (e) {
      attempts.push({ strategy: 'bracket-extract', error: (e as Error).message });
    }
  } else {
    attempts.push({ strategy: 'bracket-extract', error: 'no [...] found' });
  }
  return { value: null, attempts };
}

function normalizeToolInput<T>(input: T, arrayFields: string[]): T {
  if (!input || typeof input !== 'object') return input;
  const obj = input as Record<string, unknown>;
  for (const field of arrayFields) {
    const v = obj[field];
    if (typeof v !== 'string') continue;
    const { value, attempts } = tryParseArray(v);
    if (value) {
      obj[field] = value;
      continue;
    }
    const dumpPath = join(tmpdir(), `cosign-parse-failure-${field}-${Date.now()}.txt`);
    try {
      writeFileSync(dumpPath, v);
    } catch {
      // best-effort dump
    }
    console.error(
      `[cosign] could not parse model output for "${field}" even after repair. length=${v.length}`,
    );
    console.error(`[cosign] raw output written to ${dumpPath}`);
    console.error(`[cosign] head: ${JSON.stringify(v.slice(0, 200))}`);
    console.error(`[cosign] tail: ${JSON.stringify(v.slice(-200))}`);
    for (const a of attempts) {
      console.error(`[cosign]   ${a.strategy}: ${a.error}`);
    }
  }
  return input;
}
