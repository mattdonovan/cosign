import type { AnalyzeWarning, Category, LedgerItem as Item, Status } from '../types';
import { LedgerItem } from './LedgerItem';

interface Props {
  nodeName: string;
  ledger: Item[];
  warnings: AnalyzeWarning[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStatus: (id: string, status: Status) => void;
  onSummary: (id: string, summary: string) => void;
}

const CATEGORY_ORDER: Category[] = [
  'states',
  'accessibility',
  'responsiveness',
  'tokens',
  'structure',
  'content',
  'motion',
];

export function Ledger({
  nodeName,
  ledger,
  warnings,
  selectedId,
  onSelect,
  onStatus,
  onSummary,
}: Props) {
  const debt = ledger.filter(isDebt);
  const decided = ledger.filter((i) => !isDebt(i));

  return (
    <aside className="cosign-ledger" aria-label="Decision ledger">
      <div className="cosign-ledger-meta">
        <div className="cosign-ledger-name">{nodeName || 'Component'}</div>
        <div className="cosign-ledger-count">
          <span className="num--debt">{debt.length}</span> debt ·{' '}
          <span className="num--decided">{decided.length}</span> decided
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="cosign-banners" style={{ marginBottom: 12 }}>
          {warnings.map((w, i) => (
            <div key={i} className="cosign-banner cosign-banner--decided">
              <p>{w.message}</p>
            </div>
          ))}
        </div>
      )}

      {debt.length > 0 && (
        <Section
          title="Decision Debt"
          count={debt.length}
          tone="debt"
          items={debt}
          selectedId={selectedId}
          onSelect={onSelect}
          onStatus={onStatus}
          onSummary={onSummary}
        />
      )}
      {decided.length > 0 && (
        <Section
          title="Decided"
          count={decided.length}
          tone="decided"
          items={decided}
          selectedId={selectedId}
          onSelect={onSelect}
          onStatus={onStatus}
          onSummary={onSummary}
        />
      )}

      {ledger.length === 0 && (
        <div className="cosign-ledger-category-label" style={{ padding: 8 }}>
          The model returned no ledger items. Try another component.
        </div>
      )}
    </aside>
  );
}

interface SectionProps {
  title: string;
  count: number;
  tone: 'debt' | 'decided';
  items: Item[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStatus: (id: string, status: Status) => void;
  onSummary: (id: string, summary: string) => void;
}

function Section({
  title,
  count,
  tone,
  items,
  selectedId,
  onSelect,
  onStatus,
  onSummary,
}: SectionProps) {
  const groups = groupByCategory(items);
  return (
    <section className="cosign-ledger-section">
      <div className="cosign-ledger-section-header">
        <div className={`cosign-ledger-rail cosign-ledger-rail--${tone}`} aria-hidden />
        <div className="cosign-ledger-section-title">{title}</div>
        <div className="cosign-ledger-section-count">{count}</div>
      </div>
      {CATEGORY_ORDER.filter((c) => groups.has(c)).map((category) => {
        const list = groups.get(category)!;
        return (
          <div key={category} className="cosign-ledger-category">
            <div className="cosign-ledger-category-label">
              {category} ({list.length})
            </div>
            <ul className="cosign-ledger-list">
              {list.map((item) => (
                <LedgerItem
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  onSelect={() => onSelect(item.id)}
                  onStatus={(s) => onStatus(item.id, s)}
                  onSummary={(s) => onSummary(item.id, s)}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function isDebt(item: Item): boolean {
  return item.origin !== 'sourced' && item.status === 'unreviewed';
}

function groupByCategory(items: Item[]): Map<Category, Item[]> {
  const out = new Map<Category, Item[]>();
  for (const item of items) {
    const list = out.get(item.category) ?? [];
    list.push(item);
    out.set(item.category, list);
  }
  return out;
}
