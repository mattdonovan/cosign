import { z } from 'zod';

export const Origin = z.enum(['sourced', 'interpreted', 'ai']);
export type Origin = z.infer<typeof Origin>;

export const Category = z.enum([
  'states',
  'accessibility',
  'responsiveness',
  'tokens',
  'structure',
  'content',
  'motion',
]);
export type Category = z.infer<typeof Category>;

export const Status = z.enum(['unreviewed', 'ratified', 'revised', 'reverted']);
export type Status = z.infer<typeof Status>;

export const LedgerItem = z.object({
  id: z.string().min(1),
  origin: Origin,
  category: Category,
  summary: z.string().min(1),
  whyItMatters: z.string(),
  region: z.string().min(1),
  sourceRef: z.string().optional(),
  status: Status.default('unreviewed'),
});
export type LedgerItem = z.infer<typeof LedgerItem>;

export const Ledger = z.array(LedgerItem);
export type Ledger = z.infer<typeof Ledger>;

// Pass-one model response shape (the ledger of decisions to make)
export const PassOneResponse = z.object({
  decisions: z.array(LedgerItem.omit({ status: true })),
});
export type PassOneResponse = z.infer<typeof PassOneResponse>;

// Pass-two model response shape (the code, plus any decisions discovered while coding)
export const PassTwoResponse = z.object({
  tsx: z.string().min(1),
  ledgerDelta: z.array(LedgerItem.omit({ status: true })).default([]),
});
export type PassTwoResponse = z.infer<typeof PassTwoResponse>;

export interface AnalyzeWarning {
  kind: 'variants_in_set' | 'tools_missing' | 'validation_repaired';
  message: string;
}

export interface AnalyzeError {
  kind:
    | 'url_invalid'
    | 'url_too_broad'
    | 'url_make_unsupported'
    | 'mcp_unreachable'
    | 'mcp_error'
    | 'needs_context'
    | 'generation_failed'
    | 'config_error';
  message: string;
  hint?: string;
}

export interface AnalyzeSuccess {
  ok: true;
  id: string;
  classification: 'node' | 'page' | 'file' | 'make' | 'unknown';
  warnings: AnalyzeWarning[];
  ledger: LedgerItem[];
  bundleUrl: string;
  sourceImage: { url: string; width: number; height: number } | null;
  nodeName: string;
}

export interface AnalyzeFailure {
  ok: false;
  error: AnalyzeError;
}

export type AnalyzeResponse = AnalyzeSuccess | AnalyzeFailure;
