import { Hono } from 'hono';
import { z } from 'zod';
import { analyze } from '../generate/index.ts';

export const analyzeRoute = new Hono();

const Body = z.object({ url: z.string().min(1) });

analyzeRoute.post('/analyze', async (c) => {
  let payload: { url: string };
  try {
    payload = Body.parse(await c.req.json());
  } catch {
    return c.json(
      {
        ok: false,
        error: {
          kind: 'url_invalid',
          message: 'Request body must be { url: string }.',
        },
      },
      400,
    );
  }
  try {
    const result = await analyze(payload.url);
    return c.json(result);
  } catch (e) {
    console.error('[analyze] unhandled', e);
    return c.json(
      {
        ok: false,
        error: {
          kind: 'generation_failed',
          message: e instanceof Error ? e.message : String(e),
        },
      },
      500,
    );
  }
});
