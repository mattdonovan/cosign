import { useEffect, useMemo, useState } from 'react';
import { cn } from '../utils/cn';

const STEPS = [
  'Reading your Figma component.',
  'Enumerating the decisions required to ship it.',
  'Writing code that traces back to each one.',
];

interface DetectedFont {
  family: string;
  weights: number[];
  isGoogle: boolean;
  importCss?: string;
}

interface FontsResponse {
  ok: boolean;
  fonts: DetectedFont[];
  reason?: string;
  error?: string;
}

export function Analyzing({ url }: { url: string }) {
  const [step, setStep] = useState(0);
  const [fonts, setFonts] = useState<DetectedFont[] | null>(null);
  const [fontsError, setFontsError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFonts(null);
    setFontsError(null);
    fetch('/api/fonts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    })
      .then((r) => r.json() as Promise<FontsResponse>)
      .then((data) => {
        if (cancelled) return;
        if (data.ok) setFonts(data.fonts);
        else setFontsError(data.error ?? 'Could not detect fonts.');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setFontsError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="cosign-analyzing-stage">
      <div className="cosign-analyzing">
        <div className="cosign-analyzing-dot" aria-hidden />
        <div className="cosign-analyzing-text">{STEPS[step]}</div>
        <div className="cosign-analyzing-mono">{shortenUrl(url)}</div>
      </div>

      <div className="cosign-analyzing-side">
        <FontsPanel fonts={fonts} error={fontsError} />
        <PersonaPanel />
      </div>
    </div>
  );
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const node = u.searchParams.get('node-id');
    return `${u.pathname}${node ? ` · node-id=${node}` : ''}`;
  } catch {
    return url;
  }
}

function FontsPanel({
  fonts,
  error,
}: {
  fonts: DetectedFont[] | null;
  error: string | null;
}) {
  return (
    <section className="cosign-side-card">
      <header className="cosign-side-card-head">
        <span className="cosign-side-card-kind">Fonts in this component</span>
      </header>
      {fonts === null && !error && (
        <p className="cosign-side-card-empty">Scanning the design…</p>
      )}
      {error && <p className="cosign-side-card-empty">Font scan failed: {error}</p>}
      {fonts && fonts.length === 0 && (
        <p className="cosign-side-card-empty">No specific fonts detected.</p>
      )}
      {fonts && fonts.length > 0 && (
        <ul className="cosign-font-list">
          {fonts.map((f) => (
            <FontRow key={f.family} font={f} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FontRow({ font }: { font: DetectedFont }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const previewUrl = useMemo(() => {
    if (!font.isGoogle) return null;
    const family = font.family.replace(/ /g, '+');
    const weights = font.weights.length > 0 ? font.weights : [400];
    return `https://fonts.googleapis.com/css2?family=${family}:wght@${weights.join(';')}&display=swap`;
  }, [font]);

  // Live-preview the font name in its own typeface (Google Fonts only).
  useEffect(() => {
    if (!previewUrl) return;
    const id = `cosign-font-preview-${font.family.replace(/\s+/g, '-')}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = previewUrl;
    document.head.appendChild(link);
  }, [previewUrl, font.family]);

  const copy = async () => {
    if (!font.importCss) return;
    try {
      await navigator.clipboard.writeText(font.importCss);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignored
    }
  };

  return (
    <li className={cn('cosign-font-row', expanded && 'cosign-font-row--open')}>
      <div className="cosign-font-row-head">
        <div className="cosign-font-name" style={{ fontFamily: `'${font.family}', sans-serif` }}>
          {font.family}
        </div>
        <div className="cosign-font-meta">
          {font.isGoogle ? 'Google Font' : 'Custom font'}
          {font.weights.length > 0 && ` · ${font.weights.join(', ')}`}
        </div>
        <button
          className={cn(
            'cosign-ledger-action',
            font.isGoogle && 'cosign-ledger-action--primary',
          )}
          onClick={() => setExpanded((v) => !v)}
        >
          {font.isGoogle ? (expanded ? 'Hide install' : 'Install') : 'How to add'}
        </button>
      </div>

      {expanded && font.isGoogle && font.importCss && (
        <div className="cosign-font-detail">
          <p className="cosign-font-help">
            Paste this into your global CSS to load {font.family}:
          </p>
          <pre className="cosign-code">{font.importCss}</pre>
          <button className="cosign-ledger-action" onClick={copy}>
            {copied ? 'Copied' : 'Copy @import'}
          </button>
        </div>
      )}

      {expanded && !font.isGoogle && (
        <div className="cosign-font-detail">
          <p className="cosign-font-help">
            <strong>{font.family}</strong> isn't on the Google Fonts CDN. Drop a{' '}
            <code>.woff2</code> into your project (e.g. <code>/public/fonts/</code>) and
            add a <code>@font-face</code> declaration:
          </p>
          <pre className="cosign-code">{nonGoogleSnippet(font)}</pre>
          <p className="cosign-font-help cosign-font-help--muted">
            Font upload-to-render is on the roadmap. For now, add the file to your project
            manually.
          </p>
        </div>
      )}
    </li>
  );
}

function nonGoogleSnippet(font: DetectedFont): string {
  const weight = font.weights[0] ?? 400;
  const safeFamily = font.family.replace(/'/g, "\\'");
  return [
    `@font-face {`,
    `  font-family: '${safeFamily}';`,
    `  src: url('/fonts/${font.family.toLowerCase().replace(/\s+/g, '-')}.woff2') format('woff2');`,
    `  font-weight: ${weight};`,
    `  font-display: swap;`,
    `}`,
  ].join('\n');
}

// ----- Persona quiz -----

interface Persona {
  id: string;
  label: string;
  body: string;
  resources: { title: string; url: string; why: string }[];
}

const PERSONAS: Persona[] = [
  {
    id: 'new',
    label: "I'm new to design",
    body:
      "Welcome — design has rules and they're learnable. Start with the fundamentals; the rest compounds.",
    resources: [
      {
        title: 'Refactoring UI (free articles)',
        url: 'https://www.refactoringui.com/previews/building-your-color-palette',
        why: 'Why your default colors look wrong, and how to fix them.',
      },
      {
        title: 'Practical Typography',
        url: 'https://practicaltypography.com/',
        why: 'Matthew Butterick. The shortest path to text that reads well.',
      },
      {
        title: 'Smashing Magazine — UX Basics',
        url: 'https://www.smashingmagazine.com/category/ux/',
        why: 'Long-running publication of approachable, opinionated UX writing.',
      },
    ],
  },
  {
    id: 'engineer',
    label: "I'm an engineer who designs",
    body:
      "You already know how to ship. The leap is internalizing visual hierarchy and rhythm — most of which is just consistency you decide on once.",
    resources: [
      {
        title: 'shadcn/ui',
        url: 'https://ui.shadcn.com/',
        why: 'Code-first component library. Read the source — it teaches good defaults.',
      },
      {
        title: 'Refactoring UI (book)',
        url: 'https://www.refactoringui.com/book',
        why: 'Steve Schoger & Adam Wathan. Best $99 an engineer-designer can spend.',
      },
      {
        title: 'Untitled UI — free Figma kit',
        url: 'https://www.untitledui.com/products/figma-ui-kit',
        why: 'A real design system to study and steal from.',
      },
    ],
  },
  {
    id: 'designer',
    label: "I'm a designer learning to ship",
    body:
      "You already see the right answer — getting it into production is the next muscle. Start small and let the code stack rebuild itself around you.",
    resources: [
      {
        title: 'react.dev — Learn React',
        url: 'https://react.dev/learn',
        why: 'The official tutorial. Pace yourself; concepts build on each other.',
      },
      {
        title: 'Frontend Mentor',
        url: 'https://www.frontendmentor.io/challenges',
        why: 'Free design files + the freedom to implement them however you want.',
      },
      {
        title: 'Josh Comeau — CSS for JS devs (free articles)',
        url: 'https://www.joshwcomeau.com/css/',
        why: 'The mental model for how CSS actually works.',
      },
    ],
  },
  {
    id: 'pro',
    label: "I do both, I'm here for the velocity",
    body:
      "You know the work. Cosign's job is to keep you the author when the AI is moving fast underneath. Skim the design-system tooling that pairs well.",
    resources: [
      {
        title: 'Tokens Studio for Figma',
        url: 'https://tokens.studio/',
        why: 'Manage design tokens in Figma → export to code with structure intact.',
      },
      {
        title: 'Figma Variables — official docs',
        url: 'https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma',
        why: 'The substrate cosign reads when it maps Figma values to your tokens.',
      },
      {
        title: 'Storybook for design systems',
        url: 'https://storybook.js.org/tutorials/design-systems-for-developers/',
        why: 'Document and test components in isolation, the way a system needs.',
      },
    ],
  },
];

function PersonaPanel() {
  const [selected, setSelected] = useState<string | null>(null);
  const persona = PERSONAS.find((p) => p.id === selected) ?? null;

  return (
    <section className="cosign-side-card">
      <header className="cosign-side-card-head">
        <span className="cosign-side-card-kind">While you wait — who are you?</span>
      </header>

      <div className="cosign-persona-grid">
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            className={cn(
              'cosign-persona-chip',
              selected === p.id && 'cosign-persona-chip--selected',
            )}
            onClick={() => setSelected((cur) => (cur === p.id ? null : p.id))}
          >
            {p.label}
          </button>
        ))}
      </div>

      {persona && (
        <div className="cosign-persona-detail">
          <p className="cosign-persona-body">{persona.body}</p>
          <ul className="cosign-persona-resources">
            {persona.resources.map((r) => (
              <li key={r.url}>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cosign-persona-link"
                >
                  {r.title} ↗
                </a>
                <span className="cosign-persona-why">{r.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
