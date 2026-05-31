import type { Provider, UserContent } from './provider.ts';
import { PassTwoResponse, type LedgerItem } from './schemas.ts';

const SYSTEM = `You are Cosign's code generator. You produce a single React function component from a ledger of decisions. The ledger is the source of truth: code is built FROM it, not annotated TO it.

CONTRACT

- Output one default-exported React function component in TSX.
- Every ledger item maps to a region of the rendered component. The element that represents that region MUST carry data-cosign-id="<ledger.id>". Use the id verbatim — do not modify, shorten, or normalize ids.
- Every styling, structural, and behavioral choice must trace to a ledger item. If you need to add something that is not in the ledger, STOP and add it to ledgerDelta with origin 'ai' or 'interpreted', a clear summary, and a whyItMatters, then tag the corresponding element with that new id.
- Use sourced values exactly. Do not round, invent, or substitute colors, sizes, or copy.
- Self-contained: import only from 'react'. No external libraries, no CSS files, no Tailwind.
- Inline styles via a style prop or a single <style> tag scoped via a unique class on the root are both fine.
- Functional component. Use hooks only when needed (e.g., useState for hover/focus/loading if the ledger has those state items).
- Default export. Accept no required props in v1.

ACCESSIBILITY

- Implement accessibility ledger items literally. If the ledger says "visible focus ring", the element must show one on :focus-visible. If it says "button role", use a <button>.
- Keyboard operable if the component category involves interaction.

OUTPUT

Call the submit_code tool with { tsx, ledgerDelta }. ledgerDelta may be empty. Do not respond with prose.`;

const SCHEMA = {
  type: 'object',
  required: ['tsx'],
  additionalProperties: false,
  properties: {
    tsx: { type: 'string', minLength: 1 },
    ledgerDelta: {
      type: 'array',
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

export interface PassTwoInput {
  ledger: LedgerItem[];
  nodeName: string;
  repairHint?: { missingIds: string[]; previousTsx: string };
}

export async function runPassTwo(
  provider: Provider,
  model: string,
  input: PassTwoInput,
): Promise<PassTwoResponse> {
  const parts: string[] = [
    `Component name: ${input.nodeName || '(unnamed)'}`,
    '',
    '<ledger>',
    JSON.stringify(input.ledger, null, 2),
    '</ledger>',
  ];
  if (input.repairHint) {
    parts.push(
      '',
      'PREVIOUS ATTEMPT was missing these data-cosign-id values on rendered elements:',
      input.repairHint.missingIds.map((id) => `- ${id}`).join('\n'),
      '',
      'Re-emit the component with every ledger id present as data-cosign-id on the corresponding region.',
      '',
      '<previous_tsx>',
      input.repairHint.previousTsx,
      '</previous_tsx>',
    );
  }

  const userContent: UserContent[] = [{ type: 'text', text: parts.join('\n') }];

  const result = await provider.generateStructured<unknown>({
    system: SYSTEM,
    user: userContent,
    model,
    toolName: 'submit_code',
    toolDescription: 'Submit the React component code with ledger-traceable regions.',
    toolSchema: SCHEMA,
    maxTokens: 16384,
  });
  return PassTwoResponse.parse(normalizeToolInput(result, ['ledgerDelta']));
}

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
