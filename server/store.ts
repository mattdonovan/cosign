import { randomUUID } from 'node:crypto';
import type { LedgerItem } from './generate/schemas.ts';

export interface StoredAnalysis {
  id: string;
  createdAt: number;
  tsx: string;
  js: string;
  ledger: LedgerItem[];
  nodeName: string;
  sourceImageUrl: string | null;
}

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ENTRIES = 16;

const store = new Map<string, StoredAnalysis>();

export function saveAnalysis(input: Omit<StoredAnalysis, 'id' | 'createdAt'>): StoredAnalysis {
  prune();
  const id = randomUUID();
  const entry: StoredAnalysis = { id, createdAt: Date.now(), ...input };
  store.set(id, entry);
  return entry;
}

export function getAnalysis(id: string): StoredAnalysis | undefined {
  const entry = store.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(id);
    return undefined;
  }
  return entry;
}

function prune(): void {
  const now = Date.now();
  for (const [id, entry] of store.entries()) {
    if (now - entry.createdAt > TTL_MS) store.delete(id);
  }
  if (store.size >= MAX_ENTRIES) {
    const oldest = [...store.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (oldest) store.delete(oldest[0]);
  }
}
