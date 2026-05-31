import type { HealthSnapshot } from '../types';

interface Props {
  health: HealthSnapshot;
}

export function HealthBanner({ health }: Props) {
  if (!health.anthropic) {
    return (
      <div className="cosign-banner cosign-banner--danger">
        <h2>Anthropic API key not set.</h2>
        <p>
          Cosign needs an API key to generate. Copy <code>.env.example</code> to <code>.env</code>{' '}
          and add <code>ANTHROPIC_API_KEY</code>, then restart <code>npm run dev</code>.
        </p>
      </div>
    );
  }
  if (!health.figmaReachable) {
    return (
      <div className="cosign-banner">
        <h2>Figma Dev Mode MCP is not running.</h2>
        <p>
          Open Figma desktop → Preferences → enable the Dev Mode MCP server. Cosign is reaching it
          at <code>{health.figmaEndpoint}</code>.
        </p>
      </div>
    );
  }
  return null;
}
