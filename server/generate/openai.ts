import OpenAI from 'openai';
import type { Provider, StructuredRequest } from './provider.ts';

export interface OpenAIProviderOptions {
  apiKey: string;
  baseURL?: string;
}

export class OpenAIProvider implements Provider {
  private client: OpenAI;

  constructor(options: OpenAIProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
  }

  async generateStructured<T>(req: StructuredRequest): Promise<T> {
    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = req.user.map(
      (c) => {
        if (c.type === 'text') return { type: 'text', text: c.text };
        return {
          type: 'image_url',
          image_url: { url: `data:${c.mediaType};base64,${c.base64}` },
        };
      },
    );

    const response = await this.client.chat.completions.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 16384,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: userContent },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: req.toolName,
            description: req.toolDescription,
            parameters: req.toolSchema as Record<string, unknown>,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: req.toolName } },
    });

    const choice = response.choices[0];
    const finish = choice.finish_reason;
    const usage = response.usage;
    console.log(
      `[openai] tool=${req.toolName} model=${req.model} finish=${finish} ` +
        `in=${usage?.prompt_tokens ?? '?'} out=${usage?.completion_tokens ?? '?'}`,
    );

    if (finish === 'length') {
      throw new Error(
        `Model hit max_tokens (${req.maxTokens ?? 16384}) before completing the ${req.toolName} call. Output was truncated.`,
      );
    }

    const toolCall = choice.message.tool_calls?.[0];
    if (!toolCall || toolCall.type !== 'function') {
      throw new Error(
        `Model did not call the "${req.toolName}" tool. finish_reason: ${finish}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      throw new Error(
        `Could not parse tool arguments from OpenAI: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return parsed as T;
  }
}
