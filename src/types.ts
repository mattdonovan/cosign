import type {
  AnalyzeError,
  AnalyzeResponse,
  AnalyzeWarning,
  Category,
  LedgerItem,
  Origin,
  Status,
} from '../server/generate/schemas';

export type {
  AnalyzeError,
  AnalyzeResponse,
  AnalyzeWarning,
  Category,
  LedgerItem,
  Origin,
  Status,
};

export interface HealthSnapshot {
  anthropic: boolean;
  figmaReachable: boolean;
  figmaMessage?: string;
  figmaEndpoint: string;
  modelPassOne: string;
  modelPassTwo: string;
}
