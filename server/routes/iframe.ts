import { Hono } from 'hono';
import { getAnalysis } from '../store.ts';
import { buildIframeDoc } from '../transform/iframe-doc.ts';

export const iframeRoute = new Hono();

iframeRoute.get('/:id', async (c) => {
  const id = c.req.param('id');
  const analysis = getAnalysis(id);
  if (!analysis) {
    return c.html(notFoundDoc('Analysis expired or not found. Re-analyze the Figma link.'), 404);
  }
  try {
    const html = await buildIframeDoc(analysis.js);
    return c.html(html);
  } catch (e) {
    return c.html(
      notFoundDoc(`Failed to build iframe document: ${e instanceof Error ? e.message : String(e)}`),
      500,
    );
  }
});

function notFoundDoc(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>cosign</title></head><body style="margin:0;padding:32px;background:#121212;color:#fca5a5;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:13px;line-height:1.5;">${escapeHtml(message)}</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
