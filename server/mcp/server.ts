import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ProviderConfigError, resolveProvider } from '../generate/factory.ts';
import { runCodeReview } from '../lens/code-review.ts';
import { resolveTarget } from '../lens/resolve.ts';
import { saveReview, type ReviewPayload } from '../lens/save.ts';

const VERSION = '0.1.0';

const REVIEW_TOOL_DESCRIPTION = `Run the cosign default review lens on a single component file.

Returns a structured ledger of every design decision in the file, classified by origin:
- sourced: the value comes from a design token / variable / system constant
- interpreted: a hard-coded value that maps to or substitutes for a system value
- ai: an opinionated AI decision with no system origin (Decision Debt)

Each ledger item includes a category (states / accessibility / responsiveness / tokens / structure / content / motion), a one-line summary, a "why it matters" note, and a region (line range in the file). The full review is also saved to .cosign/reviews/ as both .json and a self-contained .html viewer.

Use this when the user asks you to "review" a component, audit AI-generated UI, check what design decisions are present, or surface Decision Debt in a file.`;

export async function runMcpServer(): Promise<void> {
  // Resolve the provider up front so config errors fail fast and visibly,
  // before the MCP client connects and gets a silently-broken server.
  let resolved;
  try {
    resolved = resolveProvider(process.env);
  } catch (e) {
    if (e instanceof ProviderConfigError) {
      process.stderr.write(`cosign mcp: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }

  const server = new Server(
    { name: 'cosign', version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'review',
        description: REVIEW_TOOL_DESCRIPTION,
        inputSchema: {
          type: 'object',
          required: ['target'],
          properties: {
            target: {
              type: 'string',
              description:
                'A file path, a component name, or a phrase. Examples: "src/components/Hero.tsx", "Hero", "the hero on the home page". Resolved against the current working directory.',
            },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== 'review') {
      return errorResult(`Unknown tool: ${req.params.name}`);
    }

    const target = (req.params.arguments as { target?: unknown } | undefined)?.target;
    if (typeof target !== 'string' || target.trim().length === 0) {
      return errorResult('Missing or invalid "target" argument.');
    }

    const cwd = process.cwd();
    const resolveResult = await resolveTarget([target], cwd);

    if (resolveResult.kind === 'none') {
      return errorResult(
        `No component files in the current project match "${resolveResult.query}".`,
      );
    }
    if (resolveResult.kind === 'tied') {
      const list = resolveResult.matches
        .slice(0, 8)
        .map((f, i) => `  ${i + 1}. ${f}`)
        .join('\n');
      return errorResult(
        `Multiple files match "${resolveResult.query}":\n${list}\n\nNarrow it down by passing one of these paths as "target".`,
      );
    }

    const filePath = resolveResult.path;
    const fileName = basename(filePath);
    const source = await readFile(filePath, 'utf-8');

    const t0 = Date.now();
    let review;
    try {
      review = await runCodeReview(resolved.provider, resolved.model, {
        fileName,
        source,
      });
    } catch (e) {
      return errorResult(`Review failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const elapsedMs = Date.now() - t0;

    const payload: ReviewPayload = {
      version: VERSION,
      lens: 'default',
      provider: resolved.name,
      model: resolved.model,
      filePath,
      fileName,
      createdAt: new Date().toISOString(),
      elapsedMs,
      review,
    };
    const { jsonPath, htmlPath } = await saveReview(cwd, payload);

    const counts = {
      sourced: review.decisions.filter((d) => d.origin === 'sourced').length,
      interpreted: review.decisions.filter((d) => d.origin === 'interpreted').length,
      ai: review.decisions.filter((d) => d.origin === 'ai').length,
    };

    const summary = [
      `Reviewed ${fileName} — ${review.decisions.length} decisions (${counts.sourced} sourced, ${counts.interpreted} interpreted, ${counts.ai} ai). Took ${(elapsedMs / 1000).toFixed(1)}s.`,
      ``,
      `Full review (HTML): file://${htmlPath}`,
      `Raw ledger (JSON): file://${jsonPath}`,
    ].join('\n');

    return {
      content: [
        { type: 'text', text: summary },
        { type: 'text', text: JSON.stringify(payload, null, 2) },
      ],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // server.connect resolves once the transport is wired up; the process stays
  // alive until the client closes the stdio stream.
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}
