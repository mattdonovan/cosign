import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { LedgerItem as Item, Status } from '../types';
import { cn } from '../utils/cn';

interface Props {
  item: Item;
  selected: boolean;
  onSelect: () => void;
  onStatus: (status: Status) => void;
  onSummary: (summary: string) => void;
}

const STATUS_LABEL: Record<Status, string> = {
  unreviewed: '',
  ratified: 'ratified',
  revised: 'revised',
  reverted: 'reverted',
};

export function LedgerItem({ item, selected, onSelect, onStatus, onSummary }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.summary);
  const [suppressHover, setSuppressHover] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const decided = item.origin === 'sourced' || item.status !== 'unreviewed';
  const showWhy = item.whyItMatters && item.whyItMatters.trim().length > 0;
  const expanded = selected || editing;

  const handleClick = () => {
    // Clicking an already-selected card collapses it — suppress the hover
    // popover until the cursor leaves and re-enters the card.
    if (selected && !editing) setSuppressHover(true);
    onSelect();
  };

  const head = (
    <div className="cosign-ledger-item-head">
      <span className={`cosign-ledger-item-origin cosign-ledger-item-origin--${item.origin}`}>
        {item.origin}
      </span>
      <span className="cosign-ledger-item-category">{item.category}</span>
      {item.status !== 'unreviewed' && (
        <span className={`cosign-status-pill cosign-status-pill--${item.status}`}>
          {STATUS_LABEL[item.status]}
        </span>
      )}
    </div>
  );

  const summary = (
    <p
      className={cn(
        'cosign-ledger-item-summary',
        item.status === 'reverted' && 'cosign-ledger-item-summary--reverted',
      )}
    >
      {item.summary}
    </p>
  );

  const body = editing ? (
    <div className="cosign-ledger-edit" onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
      />
      <div className="cosign-ledger-item-actions">
        <button
          className="cosign-ledger-action cosign-ledger-action--primary"
          onClick={() => {
            if (draft.trim()) {
              onSummary(draft.trim());
              setEditing(false);
            }
          }}
        >
          Save as mine
        </button>
        <button
          className="cosign-ledger-action"
          onClick={() => {
            setDraft(item.summary);
            setEditing(false);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  ) : (
    <>
      {showWhy && <p className="cosign-ledger-item-why">{item.whyItMatters}</p>}
      {item.sourceRef && <div className="cosign-ledger-item-source">{item.sourceRef}</div>}
      <div className="cosign-ledger-item-actions" onClick={(e) => e.stopPropagation()}>
        {renderActions(item, onStatus, () => {
          setDraft(item.summary);
          setEditing(true);
        })}
      </div>
    </>
  );

  return (
    <li
      className={cn(
        'cosign-ledger-item',
        decided && 'cosign-ledger-item--decided',
        expanded && 'cosign-ledger-item--expanded',
        selected && 'cosign-ledger-item--selected',
        suppressHover && 'cosign-ledger-item--no-hover',
      )}
      onClick={handleClick}
      onMouseLeave={() => setSuppressHover(false)}
    >
      {head}
      {summary}
      {expanded && <div className="cosign-ledger-item-body">{body}</div>}

      {!expanded && (
        <div className="cosign-ledger-item-hover" aria-hidden="true">
          {head}
          {summary}
          <div className="cosign-ledger-item-body">{body}</div>
        </div>
      )}
    </li>
  );
}

function renderActions(
  item: Item,
  onStatus: (s: Status) => void,
  onEdit: () => void,
): ReactNode {
  if (item.origin === 'sourced') {
    if (item.status === 'unreviewed') {
      return (
        <button
          className="cosign-ledger-action cosign-ledger-action--primary"
          onClick={() => onStatus('ratified')}
        >
          Confirm
        </button>
      );
    }
    return (
      <button className="cosign-ledger-action" onClick={() => onStatus('unreviewed')}>
        Unconfirm
      </button>
    );
  }
  if (item.status === 'unreviewed') {
    return (
      <>
        <button
          className="cosign-ledger-action cosign-ledger-action--primary"
          onClick={() => onStatus('ratified')}
        >
          Ratify
        </button>
        <button className="cosign-ledger-action" onClick={onEdit}>
          Revise
        </button>
        <button
          className="cosign-ledger-action cosign-ledger-action--danger"
          onClick={() => onStatus('reverted')}
        >
          Revert
        </button>
      </>
    );
  }
  return (
    <button className="cosign-ledger-action" onClick={() => onStatus('unreviewed')}>
      Reset
    </button>
  );
}
