import type { Provider, UserContent } from './provider.ts';
import { PassOneResponse } from './schemas.ts';

const SYSTEM = `You are Cosign's ledger generator. Cosign helps a human stay the author of design decisions when an AI is producing code. You read a Figma component and produce a structured ledger of every decision required to ship a working React version of that component.

The user pasted a Figma node link. You have three things from Figma:
- The node's structural metadata (XML: types, names, sizes, hierarchy)
- The node's bound design variables (JSON map of tokens)
- A rendered screenshot of the node

Your job: emit a flat ledger of decisions. Each item is one decision, categorized by where it came from.

ORIGINS — these are the heart of the product. Get them right.

- sourced — the value is in Figma and verifiable. Examples: the fill color is hex #FFC400; the corner radius is 8px; the text content is "Continue"; the layout is horizontal with 8px gap. These are observations, not judgments. List every meaningful one.
- interpreted — Figma gave you a value but you made a judgment about it. Examples: Figma had hex #FFC400 and you mapped it to the variable --warning-500; Figma had a width of 240px which you interpreted as a fixed pill width rather than a fluid container. The value is sourced; the mapping is the decision.
- ai — Figma did not specify this and you decided. Examples: there was no focus state shown so you added a visible focus ring; there was no loading state so you added a spinner pattern; you chose a button role over a link role. This is Decision Debt — the human will see it and ratify, revise, or revert.

CATEGORIES — use exactly one of:
states · accessibility · responsiveness · tokens · structure · content · motion

VOICE — you are writing for the human who pasted the link. Many of them are not designers; they are engineers, PMs, marketers who started doing design because AI let them. Your ledger is their teacher, not just a checklist.

- summary: one short sentence in plain language, speaking intent. "I added a visible focus ring." NOT "applied :focus-visible outline."
- whyItMatters: one sentence on the human stake. "Without it, keyboard users cannot tell where they are." Required on every 'ai' item. Helpful on 'interpreted' items too.

REGIONS — every item carries a region selector that pass two will use to mark the corresponding part of the component. Use stable kebab-case ids on data-cosign-id. The region value is the selector itself: \`[data-cosign-id="<your-id>"]\`.

Make ids predictable from the summary and origin: ai-a11y-focus-ring, sourced-tokens-bg-color, interpreted-tokens-radius-token, ai-states-hover-lift. Lowercase, hyphens, no spaces.

SOURCE REFS — for sourced and interpreted items, set sourceRef to a short trace like "node:123:456#fills[0]" or "variable:--color-bg-primary". For ai items, omit sourceRef.

REQUIREMENTS

- Cover the basics, even when obvious — fill, stroke, radius, padding, gap, content, font, layout. The ledger's job is to tell the whole story.
- One id is used by exactly one item.
- Never invent sourced values. If you didn't see it in Figma, it's ai (or interpreted, if it builds on something you did see).
- Output via the submit_ledger tool. Do not respond with prose.`;

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

export interface PassOneInput {
  metadataXml: string;
  variables: Record<string, unknown>;
  screenshot: { base64: string; mediaType: string } | null;
  nodeName: string;
  nodeType: string;
}

export async function runPassOne(
  provider: Provider,
  model: string,
  input: PassOneInput,
): Promise<PassOneResponse> {
  const userContent: UserContent[] = [
    {
      type: 'text',
      text: [
        `Component name: ${input.nodeName || '(unnamed)'}`,
        `Figma node type: ${input.nodeType}`,
        '',
        '<figma_metadata>',
        input.metadataXml || '(empty)',
        '</figma_metadata>',
        '',
        '<figma_variables>',
        JSON.stringify(input.variables, null, 2),
        '</figma_variables>',
        '',
        input.screenshot
          ? 'A rendered screenshot of the node is attached.'
          : '(no screenshot available)',
      ].join('\n'),
    },
  ];
  if (input.screenshot) {
    userContent.push({
      type: 'image',
      base64: input.screenshot.base64,
      mediaType: input.screenshot.mediaType,
    });
  }

  const result = await provider.generateStructured<unknown>({
    system: SYSTEM,
    user: userContent,
    model,
    toolName: 'submit_ledger',
    toolDescription: 'Submit the decision ledger for this Figma component.',
    toolSchema: SCHEMA,
    maxTokens: 16384,
  });
  return PassOneResponse.parse(normalizeToolInput(result, ['decisions']));
}

// Some models occasionally pack array-typed tool inputs as a JSON-encoded
// string (especially when the array is long). Recover those before Zod parse
// rather than failing the whole analysis on a serialization quirk.
function normalizeToolInput<T>(input: T, arrayFields: string[]): T {
  if (!input || typeof input !== 'object') return input;
  const obj = input as Record<string, unknown>;
  for (const field of arrayFields) {
    const v = obj[field];
    if (typeof v === 'string' && v.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) {
          console.warn(
            `[normalize] recovered stringified "${field}" (n=${parsed.length})`,
          );
          obj[field] = parsed;
        }
      } catch (e) {
        console.error(`[normalize] could not JSON.parse "${field}":`, e);
      }
    }
  }
  return input;
}
