import 'dotenv/config';

export interface Config {
  anthropicKey: string | null;
  argosToken: string | null;
  figmaMcpUrl: string;
  modelPassOne: string;
  modelPassTwo: string;
  port: number;
}

export const config: Config = {
  anthropicKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
  argosToken: process.env.ARGOS_TOKEN?.trim() || null,
  figmaMcpUrl: process.env.FIGMA_MCP_URL?.trim() || 'http://127.0.0.1:3845/sse',
  modelPassOne:
    process.env.COSIGN_MODEL_PASS_ONE?.trim() ||
    process.env.COSIGN_MODEL?.trim() ||
    'claude-sonnet-4-6',
  modelPassTwo:
    process.env.COSIGN_MODEL_PASS_TWO?.trim() ||
    process.env.COSIGN_MODEL?.trim() ||
    'claude-sonnet-4-6',
  port: Number(process.env.PORT) || 5174,
};

export function requireAnthropicKey(): string {
  if (!config.anthropicKey) {
    throw new ConfigError(
      'ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.',
    );
  }
  return config.anthropicKey;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
