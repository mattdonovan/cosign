import Anthropic from '@anthropic-ai/sdk';
import type { Provider, StructuredRequest } from './provider.ts';

export class AnthropicProvider implements Provider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generateStructured<T>(req: StructuredRequest): Promise<T> {
    const content: Anthropic.Messages.ContentBlockParam[] = req.user.map((c) => {
      if (c.type === 'text') return { type: 'text', text: c.text };
      return {
        type: 'image',
        source: { type: 'base64', media_type: c.mediaType as 'image/png', data: c.base64 },
      };
    });

    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 16384,
      system: req.system,
      tools: [
        {
          name: req.toolName,
          description: req.toolDescription,
          input_schema: req.toolSchema as Anthropic.Messages.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: req.toolName },
      messages: [{ role: 'user', content }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );
    console.log(
      `[anthropic] tool=${req.toolName} model=${req.model} stop=${response.stop_reason} ` +
        `in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
    );
    if (!toolUse) {
      throw new Error(
        `Model did not call the "${req.toolName}" tool. Stop reason: ${response.stop_reason}`,
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error(
        `Model hit max_tokens (${req.maxTokens ?? 16384}) before completing the ${req.toolName} call. Output was truncated. Used ${response.usage.output_tokens} output tokens.`,
      );
    }
    const input = toolUse.input as Record<string, unknown>;
    const shape = Object.fromEntries(
      Object.entries(input).map(([k, v]) => [
        k,
        Array.isArray(v) ? `array(${v.length})` : typeof v,
      ]),
    );
    console.log(`[anthropic] ${req.toolName} input shape:`, shape);
    return input as T;
  }
}
