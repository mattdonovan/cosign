import { transform } from 'esbuild';

export async function transformComponent(tsx: string): Promise<string> {
  const result = await transform(tsx, {
    loader: 'tsx',
    jsx: 'transform',
    jsxFactory: 'window.cosignReact.createElement',
    jsxFragment: 'window.cosignReact.Fragment',
    target: 'es2020',
    format: 'cjs',
    sourcemap: false,
  });
  return result.code;
}
