import { useCallback, useEffect, useMemo, useState } from 'react';
import { Analyzing } from './components/Analyzing';
import { FailureCard } from './components/FailureCard';
import { HealthBanner } from './components/HealthBanner';
import { IdleHero } from './components/IdleHero';
import { Ledger } from './components/Ledger';
import { Render } from './components/Render';
import { UrlBar } from './components/UrlBar';
import type {
  AnalyzeError,
  AnalyzeResponse,
  AnalyzeWarning,
  HealthSnapshot,
  LedgerItem,
  Status,
} from './types';
import { cn } from './utils/cn';

interface ReadyData {
  id: string;
  bundleUrl: string;
  nodeName: string;
  ledger: LedgerItem[];
  warnings: AnalyzeWarning[];
  sourceImage: { url: string; width: number; height: number } | null;
  url: string;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'analyzing'; url: string }
  | { kind: 'ready'; data: ReadyData }
  | { kind: 'error'; error: AnalyzeError; url: string };

export function App() {
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState<string>('');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => {
        setHealth({
          anthropic: Boolean(h.config?.anthropic),
          figmaReachable: Boolean(h.figma?.reachable),
          figmaMessage: h.figma?.message,
          figmaEndpoint: h.figma?.endpoint || h.config?.figmaMcpUrl || '',
          modelPassOne: h.config?.modelPassOne || '',
          modelPassTwo: h.config?.modelPassTwo || '',
        });
      })
      .catch(() => {
        // sidecar may not be up yet; leave health null
      });
  }, []);

  const analyze = useCallback(async (url: string) => {
    setLastUrl(url);
    setSelectedId(null);
    setMode({ kind: 'analyzing', url });
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data: AnalyzeResponse = await res.json();
      if (data.ok) {
        setMode({
          kind: 'ready',
          data: {
            id: data.id,
            bundleUrl: data.bundleUrl,
            nodeName: data.nodeName,
            ledger: data.ledger,
            warnings: data.warnings,
            sourceImage: data.sourceImage,
            url,
          },
        });
      } else {
        setMode({ kind: 'error', error: data.error, url });
      }
    } catch (e) {
      setMode({
        kind: 'error',
        url,
        error: {
          kind: 'generation_failed',
          message: e instanceof Error ? e.message : String(e),
        },
      });
    }
  }, []);

  const onStatus = useCallback((id: string, status: Status) => {
    setMode((m) => {
      if (m.kind !== 'ready') return m;
      return {
        ...m,
        data: {
          ...m.data,
          ledger: m.data.ledger.map((i) => (i.id === id ? { ...i, status } : i)),
        },
      };
    });
  }, []);

  const onSummary = useCallback((id: string, summary: string) => {
    setMode((m) => {
      if (m.kind !== 'ready') return m;
      return {
        ...m,
        data: {
          ...m.data,
          ledger: m.data.ledger.map((i) =>
            i.id === id ? { ...i, summary, status: 'revised' as Status } : i,
          ),
        },
      };
    });
  }, []);

  const selected = useMemo<LedgerItem | null>(() => {
    if (mode.kind !== 'ready' || !selectedId) return null;
    return mode.data.ledger.find((i) => i.id === selectedId) ?? null;
  }, [mode, selectedId]);

  return (
    <div className="cosign-app">
      <header className="cosign-header">
        <div className="cosign-brand">cosign</div>
        <div className="cosign-subtitle">paste a figma component link</div>
      </header>
      <main className="cosign-main">
        <UrlBar
          disabled={mode.kind === 'analyzing'}
          initialValue={lastUrl}
          onSubmit={analyze}
        />
        {health && <HealthBanner health={health} />}
        <section
          className={cn('cosign-stage', mode.kind !== 'ready' && 'cosign-stage--full')}
        >
          {mode.kind === 'idle' && <IdleHero />}
          {mode.kind === 'analyzing' && <Analyzing url={mode.url} />}
          {mode.kind === 'error' && (
            <FailureCard error={mode.error} onReset={() => setMode({ kind: 'idle' })} />
          )}
          {mode.kind === 'ready' && (
            <>
              <Ledger
                nodeName={mode.data.nodeName}
                ledger={mode.data.ledger}
                warnings={mode.data.warnings}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
                onStatus={onStatus}
                onSummary={onSummary}
              />
              <Render
                bundleUrl={mode.data.bundleUrl}
                nodeName={mode.data.nodeName}
                selected={selected}
                sourceImage={mode.data.sourceImage}
                analysisId={mode.data.id}
                figmaKey={mode.data.url}
              />
            </>
          )}
        </section>
      </main>
    </div>
  );
}
