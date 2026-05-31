import { Hono } from 'hono';
import { z } from 'zod';
import { classifyFigmaUrl } from '../figma/url.ts';
import { figmaClient, FigmaUnavailableError } from '../figma/client.ts';
import { extractFonts, googleFontImport, type DetectedFont } from '../figma/fonts.ts';

export const fontsRoute = new Hono();

const Body = z.object({ url: z.string().min(1) });

interface FontResponseItem extends DetectedFont {
  importCss?: string;
}

fontsRoute.post('/fonts', async (c) => {
  let payload: { url: string };
  try {
    payload = Body.parse(await c.req.json());
  } catch {
    return c.json({ ok: false, error: 'Body must be { url: string }', fonts: [] }, 400);
  }

  const classified = classifyFigmaUrl(payload.url);
  if (classified.kind !== 'node' && classified.kind !== 'page') {
    return c.json({ ok: true, fonts: [], reason: 'url_not_node' });
  }

  try {
    const ctx = await figmaClient.getDesignContext({
      fileKey: classified.fileKey,
      nodeId: classified.nodeId,
    });
    const fonts = extractFonts(ctx);
    const enriched: FontResponseItem[] = fonts.map((f) =>
      f.isGoogle ? { ...f, importCss: googleFontImport(f) } : f,
    );
    return c.json({ ok: true, fonts: enriched });
  } catch (e) {
    if (e instanceof FigmaUnavailableError) {
      return c.json({ ok: false, fonts: [], error: e.message }, 503);
    }
    return c.json(
      { ok: false, fonts: [], error: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
