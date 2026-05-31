import { getIframeRuntime } from './runtime-bundle.ts';

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const STYLES = `
  html, body { margin: 0; padding: 0; background: #121212; color: #fafafa;
    font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased; }
  body { min-height: 100vh; padding: 56px 32px; display: grid; place-items: center; }
  #root { display: contents; }
  .cosign-highlight {
    outline: 2px solid #FFC400 !important;
    outline-offset: 4px;
    box-shadow: 0 0 0 6px rgba(255, 196, 0, 0.18);
    border-radius: inherit;
    transition: outline-color 160ms ease, box-shadow 160ms ease;
  }
  .cosign-highlight.cosign-highlight--decided {
    outline-color: #0CC2A4 !important;
    box-shadow: 0 0 0 6px rgba(12, 194, 164, 0.18);
  }
  .cosign-error {
    color: #fca5a5;
    white-space: pre-wrap;
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    padding: 24px;
    max-width: 760px;
  }
`;

export async function buildIframeDoc(componentJs: string): Promise<string> {
  const runtime = await getIframeRuntime();
  const safeRuntime = stripCloseScript(runtime);
  const safeComponent = stripCloseScript(componentJs);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>cosign render</title>
<style>${STYLES}</style>
</head>
<body>
<div id="root"></div>
<script>${safeRuntime}</script>
<script>
(function () {
  try {
    var module = { exports: {} };
    var exports = module.exports;
    var require = function (name) {
      if (name === 'react') return window.cosignReact;
      throw new Error('require("' + name + '") is not available in the cosign iframe.');
    };
    ${safeComponent}
    var mod = module.exports;
    var Component = (mod && (mod.default || mod));
    if (typeof Component !== 'function') {
      throw new Error('Component module did not export a function as default.');
    }
    var root = window.cosignReactDOM.createRoot(document.getElementById('root'));
    root.render(window.cosignReact.createElement(Component));
    if (window.parent) window.parent.postMessage({ type: 'cosign:rendered' }, '*');
  } catch (e) {
    var msg = (e && (e.stack || e.message)) || String(e);
    var pre = document.createElement('pre');
    pre.className = 'cosign-error';
    pre.textContent = msg;
    var root = document.getElementById('root');
    root.innerHTML = '';
    root.appendChild(pre);
    if (window.parent) window.parent.postMessage({ type: 'cosign:error', message: String(msg) }, '*');
  }
})();
</script>
</body>
</html>`;
}

function stripCloseScript(s: string): string {
  return s.replace(/<\/script\s*>/gi, '<\\/script>');
}
