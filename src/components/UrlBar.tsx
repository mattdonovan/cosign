import { type FormEvent, useState } from 'react';

interface Props {
  disabled: boolean;
  initialValue?: string;
  onSubmit: (url: string) => void;
}

export function UrlBar({ disabled, initialValue = '', onSubmit }: Props) {
  const [value, setValue] = useState(initialValue);
  function handle(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }
  return (
    <form className="cosign-urlbar" onSubmit={handle}>
      <input
        type="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="https://www.figma.com/design/…?node-id=…"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <button type="submit" disabled={disabled || !value.trim()}>
        {disabled ? 'Analyzing…' : 'Analyze'}
      </button>
    </form>
  );
}
