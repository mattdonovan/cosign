import type { AnalyzeError } from '../types';
import { cn } from '../utils/cn';

interface Props {
  error: AnalyzeError;
  onReset: () => void;
}

const KIND_LABEL: Record<AnalyzeError['kind'], string> = {
  url_invalid: 'Link',
  url_too_broad: 'Link too broad',
  url_make_unsupported: 'Link',
  mcp_unreachable: 'Setup',
  mcp_error: 'Figma error',
  needs_context: 'Component',
  generation_failed: 'Generation error',
  config_error: 'Setup',
};

const DANGER: AnalyzeError['kind'][] = ['mcp_error', 'generation_failed'];

const TITLE: Record<AnalyzeError['kind'], string> = {
  url_invalid: "That doesn't look like a Figma link.",
  url_too_broad: 'This points to a file or page, not a component.',
  url_make_unsupported: 'Figma Make files are not supported in v1.',
  mcp_unreachable: 'Cosign cannot reach the Figma MCP.',
  mcp_error: 'Figma MCP returned an error.',
  needs_context: 'This component needs context to render.',
  generation_failed: 'Generation failed.',
  config_error: 'Cosign is not fully configured.',
};

export function FailureCard({ error, onReset }: Props) {
  const danger = DANGER.includes(error.kind);
  return (
    <div className={cn('cosign-failure', danger && 'cosign-failure--danger')}>
      <div className="cosign-failure-card">
        <div className="cosign-failure-kind">{KIND_LABEL[error.kind]}</div>
        <h1>{TITLE[error.kind]}</h1>
        <p>{error.message}</p>
        {error.hint && <div className="cosign-hint">{error.hint}</div>}
        <div style={{ marginTop: 24 }}>
          <button className="cosign-ledger-action" onClick={onReset}>
            Try another link
          </button>
        </div>
      </div>
    </div>
  );
}
