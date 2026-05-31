import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { toPng } from 'html-to-image';

declare global {
  interface Window {
    cosignReact: typeof React;
    cosignReactDOM: { createRoot: typeof createRoot };
  }
}

window.cosignReact = React;
window.cosignReactDOM = { createRoot };

function cssEscape(value: string): string {
  const w = window as unknown as { CSS?: { escape?: (s: string) => string } };
  if (w.CSS?.escape) return w.CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c.charCodeAt(0).toString(16) + ' ');
}

function clearHighlights(): void {
  document
    .querySelectorAll('.cosign-highlight, .cosign-highlight--decided')
    .forEach((el) => {
      el.classList.remove('cosign-highlight');
      el.classList.remove('cosign-highlight--decided');
    });
}

async function captureComponent(requestId: string): Promise<void> {
  try {
    // Drop highlight outlines from the capture so they don't pollute the diff.
    clearHighlights();
    const target =
      (document.querySelector('#root > *') as HTMLElement | null) ?? document.body;
    const rect = target.getBoundingClientRect();
    const dataUrl = await toPng(target, {
      pixelRatio: 1,
      cacheBust: true,
      backgroundColor: '#121212',
    });
    window.parent?.postMessage(
      {
        type: 'cosign:captured',
        requestId,
        dataUrl,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      '*',
    );
  } catch (e) {
    window.parent?.postMessage(
      {
        type: 'cosign:capture-error',
        requestId,
        message: e instanceof Error ? e.message : String(e),
      },
      '*',
    );
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as
    | { type?: string; id?: string; tone?: 'debt' | 'decided'; requestId?: string }
    | null;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'cosign:highlight' && typeof data.id === 'string') {
    clearHighlights();
    const el = document.querySelector(`[data-cosign-id="${cssEscape(data.id)}"]`);
    if (el) {
      el.classList.add('cosign-highlight');
      if (data.tone === 'decided') el.classList.add('cosign-highlight--decided');
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
  } else if (data.type === 'cosign:clear') {
    clearHighlights();
  } else if (data.type === 'cosign:capture' && typeof data.requestId === 'string') {
    void captureComponent(data.requestId);
  }
});

window.parent?.postMessage({ type: 'cosign:runtime-ready' }, '*');
