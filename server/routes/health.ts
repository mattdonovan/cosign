import { Hono } from 'hono';
import { config } from '../config.ts';
import { figmaClient } from '../figma/client.ts';

export const healthRoute = new Hono();

healthRoute.get('/health', async (c) => {
  const figma = await figmaClient.health();
  return c.json({
    ok: true,
    config: {
      anthropic: Boolean(config.anthropicKey),
      argos: Boolean(config.argosToken),
      figmaMcpUrl: config.figmaMcpUrl,
      modelPassOne: config.modelPassOne,
      modelPassTwo: config.modelPassTwo,
    },
    figma,
  });
});
