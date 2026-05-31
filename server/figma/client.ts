import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { config } from '../config.ts';
import type { FigmaHealth } from './types.ts';

const COMMON_ARGS = {
  clientFrameworks: 'react',
  clientLanguages: 'typescript,javascript',
} as const;

export class FigmaUnavailableError extends Error {
  constructor(public endpoint: string, public reason: string) {
    super(`Figma MCP at ${endpoint} unavailable: ${reason}`);
    this.name = 'FigmaUnavailableError';
  }
}

export interface ScreenshotResult {
  base64: string;
  mediaType: string;
  width: number;
  height: number;
  dataUrl: string;
}

export class FigmaClient {
  private client: Client | null = null;
  private transport: SSEClientTransport | null = null;
  private connecting: Promise<void> | null = null;
  private tools = new Set<string>();

  constructor(private endpoint: string = config.figmaMcpUrl) {}

  async health(): Promise<FigmaHealth> {
    try {
      await this.ensure();
      return { reachable: true, endpoint: this.endpoint, tools: [...this.tools] };
    } catch (e) {
      return {
        reachable: false,
        endpoint: this.endpoint,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async getMetadata(args: { fileKey: string; nodeId: string }): Promise<string> {
    const result = await this.callTool('get_metadata', { ...args, ...COMMON_ARGS });
    return extractText(result);
  }

  async getVariableDefs(args: {
    fileKey: string;
    nodeId: string;
  }): Promise<Record<string, unknown>> {
    if (!this.tools.has('get_variable_defs')) {
      await this.ensure();
      if (!this.tools.has('get_variable_defs')) return {};
    }
    const result = await this.callTool('get_variable_defs', { ...args, ...COMMON_ARGS });
    const text = extractText(result);
    return safeParseJson(text) ?? {};
  }

  async getDesignContext(args: { fileKey: string; nodeId: string }): Promise<string> {
    await this.ensure();
    if (!this.tools.has('get_design_context')) return '';
    const result = await this.callTool('get_design_context', {
      ...args,
      ...COMMON_ARGS,
      excludeScreenshot: true,
      disableCodeConnect: true,
    });
    return extractText(result);
  }

  async getScreenshot(args: {
    fileKey: string;
    nodeId: string;
    maxDimension?: number;
  }): Promise<ScreenshotResult | null> {
    await this.ensure();
    if (!this.tools.has('get_screenshot')) return null;
    const result = await this.callTool('get_screenshot', {
      fileKey: args.fileKey,
      nodeId: args.nodeId,
      maxDimension: args.maxDimension ?? 1024,
      enableBase64Response: true,
      ...COMMON_ARGS,
    });
    const content = (result.content ?? []) as Array<{ type: string; [k: string]: unknown }>;
    const image = content.find((c) => c.type === 'image') as
      | { type: 'image'; data?: string; mimeType?: string }
      | undefined;
    if (!image?.data) return null;
    const mediaType = image.mimeType || 'image/png';
    const meta = safeParseJson(extractText(result)) ?? {};
    return {
      base64: image.data,
      mediaType,
      width: Number(meta.width) || 0,
      height: Number(meta.height) || 0,
      dataUrl: `data:${mediaType};base64,${image.data}`,
    };
  }

  private async ensure(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.connecting) this.connecting = this.connect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
    if (!this.client) throw new FigmaUnavailableError(this.endpoint, 'connect failed');
    return this.client;
  }

  private async connect(): Promise<void> {
    try {
      const client = new Client({ name: 'cosign', version: '0.1.0' }, { capabilities: {} });
      const transport = new SSEClientTransport(new URL(this.endpoint));
      await client.connect(transport);
      const list = await client.listTools();
      this.client = client;
      this.transport = transport;
      this.tools = new Set(list.tools.map((t) => t.name));
    } catch (e) {
      this.client = null;
      this.transport = null;
      this.tools.clear();
      throw new FigmaUnavailableError(
        this.endpoint,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  private async callTool(name: string, args: Record<string, unknown>) {
    const client = await this.ensure();
    if (!this.tools.has(name)) {
      throw new FigmaUnavailableError(this.endpoint, `tool "${name}" not exposed by server`);
    }
    try {
      return await client.callTool({ name, arguments: args });
    } catch (e) {
      // Reset on error so the next attempt can reconnect.
      await this.reset().catch(() => {});
      throw e;
    }
  }

  private async reset(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // ignore
      }
    }
    this.client = null;
    this.transport = null;
    this.tools.clear();
  }
}

export const figmaClient = new FigmaClient();

function extractText(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  if (!Array.isArray(r?.content)) return '';
  return r.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n');
}

function safeParseJson(s: string): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
