import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_ENTRY = resolve(__dirname, '../iframe/runtime.ts');

let cached: string | null = null;
let pending: Promise<string> | null = null;

export async function getIframeRuntime(): Promise<string> {
  if (cached) return cached;
  if (pending) return pending;
  pending = (async () => {
    const result = await build({
      entryPoints: [RUNTIME_ENTRY],
      bundle: true,
      format: 'iife',
      minify: true,
      target: 'es2020',
      platform: 'browser',
      write: false,
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    cached = result.outputFiles[0].text;
    return cached;
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}
