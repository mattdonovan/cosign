export interface SourcedFact {
  id: string;            // stable id, used as data-cosign-id
  category: 'tokens' | 'content' | 'structure' | 'states' | 'accessibility' | 'responsiveness' | 'motion';
  summary: string;
  sourceRef: string;     // e.g. 'node:123:456#fills[0]'
  region: string;        // CSS selector for the rendered region
  raw: unknown;          // the actual sourced value
}

export interface SourcedBundle {
  fileKey: string;
  nodeId: string;
  branchKey?: string;
  nodeName: string;
  nodeType: string;
  isComponentSet: boolean;
  defaultVariantId?: string;
  unsupportedReason?: string;
  metadataXml: string;
  variables: Record<string, unknown>;
  screenshot: { url: string; width: number; height: number } | null;
  facts: SourcedFact[];
}

export interface FigmaUnavailable {
  reachable: false;
  endpoint: string;
  message: string;
}

export interface FigmaReachable {
  reachable: true;
  endpoint: string;
  tools: string[];
}

export type FigmaHealth = FigmaUnavailable | FigmaReachable;
