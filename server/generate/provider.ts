export type UserContent =
  | { type: 'text'; text: string }
  | { type: 'image'; base64: string; mediaType: string };

export interface StructuredRequest {
  system: string;
  user: UserContent[];
  model: string;
  toolName: string;
  toolDescription: string;
  toolSchema: object;
  maxTokens?: number;
}

export interface Provider {
  generateStructured<T>(req: StructuredRequest): Promise<T>;
}
