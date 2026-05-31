import { useCallback, useEffect, useRef, useState } from 'react';
import type { LedgerItem } from '../types';
import { cn } from '../utils/cn';

interface Props {
  bundleUrl: string;
  nodeName: string;
  selected: LedgerItem | null;
  sourceImage: { url: string; width: number; height: number } | null;
  analysisId: string;
  figmaKey: string;
}

interface ArgosResult {
  buildUrl: string | null;
  branch: string;
  commit: string;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'capturing' }
  | { kind: 'uploading' }
  | { kind: 'ready'; result: ArgosResult }
  | { kind: 'error'; message: string };

export function Render({
  bundleUrl,
  nodeName,
  selected,
  sourceImage,
  analysisId,
  figmaKey,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const pendingRequestId = useRef<string | null>(null);

  useEffect(() => {
    setReady(false);
    setStatus({ kind: 'idle' });
    pendingRequestId.current = null;
  }, [bundleUrl]);

  // Auto-trigger the snapshot once the iframe reports it's painted. We wait a
  // beat so fonts and any first-paint layout settle before html-to-image runs.
  useEffect(() => {
    if (!ready) return;
    if (status.kind !== 'idle') return;
    const t = setTimeout(() => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      pendingRequestId.current = requestId;
      setStatus({ kind: 'capturing' });
      win.postMessage({ type: 'cosign:capture', requestId }, '*');
    }, 600);
    return () => clearTimeout(t);
  }, [ready, status.kind]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as
        | {
            type?: string;
            requestId?: string;
            dataUrl?: string;
            message?: string;
          }
        | null;
      if (!data) return;
      if (data.type === 'cosign:rendered') setReady(true);
      if (data.type === 'cosign:captured' && data.requestId === pendingRequestId.current) {
        const dataUrl = data.dataUrl;
        if (!dataUrl) {
          setStatus({ kind: 'error', message: 'Capture returned empty image.' });
          return;
        }
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        setStatus({ kind: 'uploading' });
        void fetch('/api/argos/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            analysisId,
            componentName: nodeName,
            figmaKey,
            pngBase64: base64,
          }),
        })
          .then(async (r) => {
            const json = await r.json();
            if (!json.ok) {
              setStatus({
                kind: 'error',
                message: json.error || `Upload failed (HTTP ${r.status})`,
              });
              return;
            }
            setStatus({
              kind: 'ready',
              result: {
                buildUrl: json.buildUrl ?? null,
                branch: json.branch,
                commit: json.commit,
              },
            });
          })
          .catch((err: unknown) =>
            setStatus({
              kind: 'error',
              message: err instanceof Error ? err.message : String(err),
            }),
          );
      }
      if (
        data.type === 'cosign:capture-error' &&
        data.requestId === pendingRequestId.current
      ) {
        setStatus({ kind: 'error', message: data.message || 'Capture failed.' });
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [analysisId, figmaKey, nodeName]);

  useEffect(() => {
    if (!ready) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    if (!selected) {
      win.postMessage({ type: 'cosign:clear' }, '*');
      return;
    }
    const tone = toneFor(selected);
    win.postMessage({ type: 'cosign:highlight', id: selected.id, tone }, '*');
  }, [ready, selected]);

  const snapshot = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingRequestId.current = requestId;
    setStatus({ kind: 'capturing' });
    win.postMessage({ type: 'cosign:capture', requestId }, '*');
  }, []);

  const decided = selected ? toneFor(selected) === 'decided' : false;
  const busy = status.kind === 'capturing' || status.kind === 'uploading';

  return (
    <div className="cosign-render">
      <div className="cosign-render-meta">
        <span>render</span>
        <span>{nodeName || '(unnamed component)'}</span>
      </div>
      <div className="cosign-render-frame">
        <iframe
          ref={iframeRef}
          className="cosign-render-iframe"
          src={bundleUrl}
          sandbox="allow-scripts"
          title={`cosign render of ${nodeName || 'component'}`}
        />
      </div>

      <div className="cosign-argos">
        <div className="cosign-argos-head">
          <div className="cosign-argos-status">
            {status.kind === 'idle' && !ready && (
              <span className="cosign-argos-meta">Waiting for render…</span>
            )}
            {status.kind === 'idle' && ready && (
              <span className="cosign-argos-meta">Ready. Snapshot will auto-trigger.</span>
            )}
            {status.kind === 'capturing' && (
              <span className="cosign-argos-meta">Capturing render…</span>
            )}
            {status.kind === 'uploading' && (
              <span className="cosign-argos-meta">Uploading to Argos…</span>
            )}
            {status.kind === 'ready' && (
              <div className="cosign-argos-result">
                {status.result.buildUrl ? (
                  <a
                    href={status.result.buildUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cosign-persona-link"
                  >
                    Open build in Argos ↗
                  </a>
                ) : (
                  <span className="cosign-argos-meta">
                    Build uploaded. Couldn't auto-detect the URL — open argos-ci.com to review.
                  </span>
                )}
                <span className="cosign-argos-meta">
                  branch <code>{status.result.branch}</code> · commit{' '}
                  <code>{status.result.commit.slice(0, 12)}</code>
                </span>
              </div>
            )}
            {status.kind === 'error' && (
              <div className="cosign-argos-error">{status.message}</div>
            )}
          </div>
          <button
            className="cosign-ledger-action"
            onClick={snapshot}
            disabled={busy || !ready}
            title="Capture another snapshot of the current render"
          >
            {status.kind === 'capturing' || status.kind === 'uploading'
              ? '…'
              : status.kind === 'ready' || status.kind === 'error'
                ? 'Re-snapshot'
                : 'Snapshot'}
          </button>
        </div>

        {status.kind === 'ready' && status.result.buildUrl && (
          <div className="cosign-argos-embed">
            <iframe
              key={status.result.buildUrl}
              src={status.result.buildUrl}
              className="cosign-argos-iframe"
              title="Argos build"
            />
            <p className="cosign-argos-help">
              If the embed is blank, you're likely not signed into Argos in this browser.
              Use the link above to open the build directly.
            </p>
          </div>
        )}

        {status.kind !== 'ready' && (
          <p className="cosign-argos-help">
            Each snapshot is a build on a stable branch derived from this Figma node.
            The first snapshot is a baseline; later snapshots after regeneration will
            show the visual diff against it.
          </p>
        )}
      </div>

      {sourceImage && (
        <div className="cosign-source">
          <div className="cosign-source-label">source · figma</div>
          <img
            className={cn(
              'cosign-source-img',
              selected && 'cosign-source-img--selected',
              decided && 'cosign-source-img--decided',
            )}
            src={sourceImage.url}
            alt="Figma source"
            draggable={false}
          />
        </div>
      )}
    </div>
  );
}

function toneFor(item: LedgerItem): 'debt' | 'decided' {
  if (item.origin === 'sourced') return 'decided';
  if (item.status !== 'unreviewed') return 'decided';
  return 'debt';
}
