export type Classification =
  | { kind: 'node'; fileKey: string; nodeId: string; branchKey?: string }
  | { kind: 'page'; fileKey: string; nodeId: string; branchKey?: string }
  | { kind: 'file'; fileKey: string; branchKey?: string }
  | { kind: 'make'; makeFileKey: string }
  | { kind: 'unknown'; reason: string };

const FIGMA_HOSTS = new Set(['figma.com', 'www.figma.com']);

export function classifyFigmaUrl(input: string): Classification {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { kind: 'unknown', reason: 'Not a valid URL.' };
  }
  if (!FIGMA_HOSTS.has(url.hostname)) {
    return { kind: 'unknown', reason: 'Not a figma.com URL.' };
  }

  const segments = url.pathname.split('/').filter(Boolean);
  // /make/:fileKey/:fileName
  if (segments[0] === 'make' && segments[1]) {
    return { kind: 'make', makeFileKey: segments[1] };
  }
  // /design/:fileKey/:fileName  OR  /design/:fileKey/branch/:branchKey/:fileName
  // /file/:fileKey/:fileName (legacy)
  if (segments[0] !== 'design' && segments[0] !== 'file') {
    return { kind: 'unknown', reason: 'Only figma.com/design URLs are supported.' };
  }
  const fileKey = segments[1];
  if (!fileKey) return { kind: 'unknown', reason: 'Missing file key in URL.' };

  let branchKey: string | undefined;
  if (segments[2] === 'branch' && segments[3]) {
    branchKey = segments[3];
  }

  const rawNodeId = url.searchParams.get('node-id');
  if (!rawNodeId) {
    return { kind: 'file', fileKey, branchKey };
  }
  const nodeId = normalizeNodeId(rawNodeId);
  if (!nodeId) {
    return { kind: 'unknown', reason: `Could not parse node-id "${rawNodeId}".` };
  }
  if (isPageRoot(nodeId)) {
    return { kind: 'page', fileKey, nodeId, branchKey };
  }
  return { kind: 'node', fileKey, nodeId, branchKey };
}

function normalizeNodeId(raw: string): string | null {
  const match = raw.match(/^(\d+)[:\-](\d+)$/);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

function isPageRoot(nodeId: string): boolean {
  // Figma page roots are always "0:N" — the canvas-level nodes.
  return /^0:\d+$/.test(nodeId);
}
