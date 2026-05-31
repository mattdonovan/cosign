import { config, ConfigError, requireAnthropicKey } from '../config.ts';
import { classifyFigmaUrl } from '../figma/url.ts';
import { figmaClient, FigmaUnavailableError } from '../figma/client.ts';
import { gatePresentational } from '../figma/gate.ts';
import { saveAnalysis } from '../store.ts';
import { transformComponent } from '../transform/tsx-to-js.ts';
import { AnthropicProvider } from './anthropic.ts';
import { runPassOne } from './passOne.ts';
import { runPassTwo } from './passTwo.ts';
import { validateCodeAgainstLedger } from './validate.ts';
import type {
  AnalyzeError,
  AnalyzeResponse,
  AnalyzeWarning,
  LedgerItem,
  PassOneResponse,
  PassTwoResponse,
} from './schemas.ts';

export async function analyze(rawUrl: string): Promise<AnalyzeResponse> {
  // 1. URL
  const classified = classifyFigmaUrl(rawUrl);
  if (classified.kind === 'unknown') {
    return fail(
      'url_invalid',
      classified.reason,
      'Open the component in Figma → right-click → Copy link to selection.',
    );
  }
  if (classified.kind === 'file' || classified.kind === 'page') {
    return fail(
      'url_too_broad',
      `This points to a ${classified.kind === 'file' ? 'file' : 'page'}, not a single component.`,
      'In Figma, right-click the component → Copy link to selection.',
    );
  }
  if (classified.kind === 'make') {
    return fail(
      'url_make_unsupported',
      'Figma Make files are not supported in v1.',
      'Use a regular Figma design file component instead.',
    );
  }

  // 2. API key
  let apiKey: string;
  try {
    apiKey = requireAnthropicKey();
  } catch (e) {
    if (e instanceof ConfigError) return fail('config_error', e.message);
    throw e;
  }

  // 3. Pull from Figma
  const { fileKey, nodeId } = classified;
  const warnings: AnalyzeWarning[] = [];

  let metadataXml: string;
  let variables: Record<string, unknown>;
  let screenshot: Awaited<ReturnType<typeof figmaClient.getScreenshot>>;

  try {
    [metadataXml, variables, screenshot] = await Promise.all([
      figmaClient.getMetadata({ fileKey, nodeId }),
      figmaClient.getVariableDefs({ fileKey, nodeId }),
      figmaClient.getScreenshot({ fileKey, nodeId }),
    ]);
  } catch (e) {
    if (e instanceof FigmaUnavailableError) {
      return fail(
        'mcp_unreachable',
        e.message,
        `Open Figma desktop → Preferences → enable the Dev Mode MCP server. Cosign reaches it at ${config.figmaMcpUrl}.`,
      );
    }
    return fail('mcp_error', e instanceof Error ? e.message : String(e));
  }

  // 4. Presentational gate (strict)
  const gate = gatePresentational(metadataXml);
  if (!gate.ok) {
    return fail('needs_context', gate.reason ?? 'This node is not presentational.');
  }
  if (gate.isComponentSet) {
    warnings.push({
      kind: 'variants_in_set',
      message: 'This is a variant set. Showing the default variant for now.',
    });
    if (gate.defaultVariantId && gate.defaultVariantId !== nodeId) {
      try {
        const inner = gate.defaultVariantId;
        const [m, v, s] = await Promise.all([
          figmaClient.getMetadata({ fileKey, nodeId: inner }),
          figmaClient.getVariableDefs({ fileKey, nodeId: inner }),
          figmaClient.getScreenshot({ fileKey, nodeId: inner }),
        ]);
        metadataXml = m;
        variables = v;
        screenshot = s;
      } catch {
        // fall through with the set-level data
      }
    }
  }

  // 5. Generate
  const provider = new AnthropicProvider(apiKey);

  let passOne: PassOneResponse;
  try {
    passOne = await runPassOne(provider, config.modelPassOne, {
      metadataXml,
      variables,
      screenshot: screenshot
        ? { base64: screenshot.base64, mediaType: screenshot.mediaType }
        : null,
      nodeName: gate.nodeName,
      nodeType: gate.nodeType,
    });
  } catch (e) {
    return fail(
      'generation_failed',
      `Pass one failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const seen = new Set<string>();
  const ledger: LedgerItem[] = [];
  for (const d of passOne.decisions) {
    const id = uniqueId(d.id, seen);
    ledger.push({ ...d, id, status: 'unreviewed' });
  }

  let passTwo: PassTwoResponse;
  try {
    passTwo = await runPassTwo(provider, config.modelPassTwo, {
      ledger,
      nodeName: gate.nodeName,
    });
  } catch (e) {
    return fail(
      'generation_failed',
      `Pass two failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  mergeDelta(passTwo.ledgerDelta, ledger, seen);

  let tsx = passTwo.tsx;
  let v = validateCodeAgainstLedger(tsx, ledger);

  if (!v.ok) {
    try {
      const repair = await runPassTwo(provider, config.modelPassTwo, {
        ledger,
        nodeName: gate.nodeName,
        repairHint: { missingIds: v.missingIds, previousTsx: tsx },
      });
      mergeDelta(repair.ledgerDelta, ledger, seen);
      tsx = repair.tsx;
      v = validateCodeAgainstLedger(tsx, ledger);
    } catch {
      // ignore repair failure; surface below
    }
  }
  if (!v.ok) {
    warnings.push({
      kind: 'validation_repaired',
      message: `${v.missingIds.length} ledger item${v.missingIds.length === 1 ? '' : 's'} could not be tagged in the code. Highlight for those items will not work.`,
    });
  }

  // 6. Transform TSX → JS for the iframe
  let js: string;
  try {
    js = await transformComponent(tsx);
  } catch (e) {
    return fail(
      'generation_failed',
      `Code transform failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 7. Persist + respond
  const stored = saveAnalysis({
    tsx,
    js,
    ledger,
    nodeName: gate.nodeName,
    sourceImageUrl: screenshot?.dataUrl ?? null,
  });

  return {
    ok: true,
    id: stored.id,
    classification: classified.kind,
    warnings,
    ledger,
    bundleUrl: `/iframe/${stored.id}`,
    sourceImage: screenshot
      ? { url: screenshot.dataUrl, width: screenshot.width, height: screenshot.height }
      : null,
    nodeName: gate.nodeName,
  };
}

function mergeDelta(
  delta: PassTwoResponse['ledgerDelta'],
  ledger: LedgerItem[],
  seen: Set<string>,
): void {
  for (const d of delta) {
    const id = uniqueId(d.id, seen);
    ledger.push({ ...d, id, status: 'unreviewed' });
  }
}

function uniqueId(base: string, seen: Set<string>): string {
  let id = base;
  let i = 1;
  while (seen.has(id)) {
    i += 1;
    id = `${base}-${i}`;
  }
  seen.add(id);
  return id;
}

function fail(kind: AnalyzeError['kind'], message: string, hint?: string): AnalyzeResponse {
  return { ok: false, error: { kind, message, hint } };
}
