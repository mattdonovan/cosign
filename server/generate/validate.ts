import type { LedgerItem } from './schemas.ts';

export interface ValidationResult {
  ok: boolean;
  presentIds: string[];
  missingIds: string[];   // ledger items whose id does not appear as data-cosign-id in code
  extraIds: string[];     // data-cosign-ids in code that have no ledger backing
}

const COSIGN_ID_PATTERN = /data-cosign-id\s*=\s*(?:["']([^"']+)["']|\{["']([^"']+)["']\}|\{`([^`]+)`\})/g;

export function validateCodeAgainstLedger(
  tsx: string,
  ledger: LedgerItem[],
): ValidationResult {
  const present = new Set<string>();
  for (const match of tsx.matchAll(COSIGN_ID_PATTERN)) {
    const id = match[1] ?? match[2] ?? match[3];
    if (id) present.add(id);
  }
  const want = new Set(ledger.map((i) => i.id));
  const missing = [...want].filter((id) => !present.has(id));
  const extra = [...present].filter((id) => !want.has(id));
  return {
    ok: missing.length === 0,
    presentIds: [...present],
    missingIds: missing,
    extraIds: extra,
  };
}
