import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.ts';

const execFileAsync = promisify(execFile);

export const argosRoute = new Hono();

const Body = z.object({
  analysisId: z.string().min(1),
  componentName: z.string().min(1).default('component'),
  // figmaKey is anything stable that identifies "the same component across
  // regenerations". We hash it to derive the Argos branch name.
  figmaKey: z.string().min(1),
  // Base64-encoded PNG of the captured render (no data: prefix).
  pngBase64: z.string().min(1),
});

argosRoute.post('/argos/upload', async (c) => {
  if (!config.argosToken) {
    return c.json(
      { ok: false, error: 'ARGOS_TOKEN is not set. Add it to .env and restart.' },
      400,
    );
  }

  let payload: z.infer<typeof Body>;
  try {
    payload = Body.parse(await c.req.json());
  } catch (e) {
    return c.json(
      { ok: false, error: e instanceof Error ? e.message : 'Invalid body' },
      400,
    );
  }

  const branch = `cosign/${shortHash(payload.figmaKey)}`;
  // Argos validates the commit identifier as a real SHA. A UUID/timestamp
  // fails the regex, so we hash the analysis id into a full 40-char hex sha1.
  const commit = fullSha(payload.analysisId);
  const buildName = `cosign-${payload.componentName}`.replace(/[^a-zA-Z0-9-_]/g, '-');
  const fileName = `${sanitize(payload.componentName) || 'render'}.png`;

  const dir = await mkdtemp(join(tmpdir(), 'cosign-argos-'));
  try {
    const pngPath = join(dir, fileName);
    await writeFile(pngPath, Buffer.from(payload.pngBase64, 'base64'));

    console.log(
      `[argos] upload start branch=${branch} commit=${commit.slice(0, 12)} build=${buildName} file=${fileName}`,
    );

    const { stdout, stderr } = await execFileAsync(
      'npx',
      ['--yes', 'argos', 'upload', dir, '--build-name', buildName],
      {
        env: {
          ...process.env,
          ARGOS_TOKEN: config.argosToken,
          // The CLI auto-detects branch/commit from git context. We override
          // here so each Figma node maps to its own stable branch and each
          // generation is a distinct commit on that branch.
          ARGOS_BRANCH: branch,
          ARGOS_COMMIT: commit,
        },
        maxBuffer: 4 * 1024 * 1024,
      },
    );

    const combined = `${stdout}\n${stderr}`;
    const buildUrl = extractBuildUrl(combined);
    console.log(
      `[argos] upload done buildUrl=${buildUrl ?? '(none)'} stdoutLen=${stdout.length}`,
    );

    return c.json({
      ok: true,
      branch,
      commit,
      buildName,
      buildUrl,
      stdout,
      stderr,
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const message = err.stderr || err.stdout || err.message || String(e);
    console.error('[argos] upload failed:', message);
    return c.json({ ok: false, error: message.slice(0, 4000) }, 500);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function shortHash(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 10);
}

function fullSha(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

function extractBuildUrl(output: string): string | null {
  const m = output.match(/https:\/\/(?:app\.)?argos-ci\.com\/[^\s"']+/);
  return m ? m[0] : null;
}
