import { AnthropicProvider } from './anthropic.ts';
import { OpenAIProvider } from './openai.ts';
import type { Provider } from './provider.ts';

export type ProviderName = 'anthropic' | 'openai' | 'openrouter';

export interface ResolvedProvider {
  provider: Provider;
  name: ProviderName;
  model: string;
  // Display string for logs / UI. Includes base URL if non-default.
  label: string;
}

export interface ProviderEnv {
  COSIGN_PROVIDER?: string;
  COSIGN_MODEL_REVIEW?: string;
  COSIGN_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
}

const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  openrouter: 'anthropic/claude-sonnet-4',
};

// Pick a provider by:
// 1. Honor COSIGN_PROVIDER if set (must have its key).
// 2. Otherwise auto-detect: prefer the key the user has set, in order
//    Anthropic → OpenAI → OpenRouter. Anthropic-first is intentional —
//    image-bearing flows in this codebase (e.g. Figma analyze) only work
//    on Anthropic today.
export function resolveProvider(env: ProviderEnv): ResolvedProvider {
  const override = env.COSIGN_PROVIDER?.trim().toLowerCase();
  const candidates: ProviderName[] = override
    ? [override as ProviderName]
    : detectAvailableProviders(env);

  for (const name of candidates) {
    const built = tryBuild(name, env);
    if (built) return built;
  }

  throw new ProviderConfigError(
    override
      ? `COSIGN_PROVIDER=${override} but the matching API key is not set. ${hintFor(override as ProviderName)}`
      : `No AI provider key found. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY.`,
  );
}

function detectAvailableProviders(env: ProviderEnv): ProviderName[] {
  const out: ProviderName[] = [];
  if (env.ANTHROPIC_API_KEY?.trim()) out.push('anthropic');
  if (env.OPENAI_API_KEY?.trim()) out.push('openai');
  if (env.OPENROUTER_API_KEY?.trim()) out.push('openrouter');
  return out;
}

function tryBuild(name: ProviderName, env: ProviderEnv): ResolvedProvider | null {
  const model = env.COSIGN_MODEL_REVIEW?.trim() || DEFAULT_MODELS[name];
  if (name === 'anthropic') {
    const key = env.ANTHROPIC_API_KEY?.trim();
    if (!key) return null;
    return {
      provider: new AnthropicProvider(key),
      name,
      model,
      label: `Anthropic · ${model}`,
    };
  }
  if (name === 'openai') {
    const key = env.OPENAI_API_KEY?.trim();
    if (!key) return null;
    const baseURL = env.COSIGN_BASE_URL?.trim();
    return {
      provider: new OpenAIProvider({ apiKey: key, baseURL }),
      name,
      model,
      label: baseURL ? `OpenAI-compatible (${baseURL}) · ${model}` : `OpenAI · ${model}`,
    };
  }
  if (name === 'openrouter') {
    const key = env.OPENROUTER_API_KEY?.trim();
    if (!key) return null;
    return {
      provider: new OpenAIProvider({
        apiKey: key,
        baseURL: env.COSIGN_BASE_URL?.trim() || 'https://openrouter.ai/api/v1',
      }),
      name,
      model,
      label: `OpenRouter · ${model}`,
    };
  }
  return null;
}

function hintFor(name: ProviderName): string {
  if (name === 'anthropic') return 'Set ANTHROPIC_API_KEY.';
  if (name === 'openai') return 'Set OPENAI_API_KEY.';
  if (name === 'openrouter') return 'Set OPENROUTER_API_KEY.';
  return '';
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}
