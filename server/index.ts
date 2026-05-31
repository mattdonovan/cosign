import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config.ts';
import { analyzeRoute } from './routes/analyze.ts';
import { argosRoute } from './routes/argos.ts';
import { fontsRoute } from './routes/fonts.ts';
import { healthRoute } from './routes/health.ts';
import { iframeRoute } from './routes/iframe.ts';

const app = new Hono();

app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    allowMethods: ['GET', 'POST'],
  }),
);

app.route('/api', healthRoute);
app.route('/api', analyzeRoute);
app.route('/api', fontsRoute);
app.route('/api', argosRoute);
app.route('/iframe', iframeRoute);

app.get('/', (c) =>
  c.text(
    'cosign sidecar. UI is on http://localhost:5173. Endpoints: GET /api/health, POST /api/analyze, GET /iframe/:id',
  ),
);

serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`[cosign sidecar] listening on http://127.0.0.1:${info.port}`);
  console.log(
    `[cosign sidecar] anthropic key: ${config.anthropicKey ? 'present' : 'MISSING — set ANTHROPIC_API_KEY in .env'}`,
  );
  console.log(`[cosign sidecar] figma MCP:    ${config.figmaMcpUrl}`);
  console.log(
    `[cosign sidecar] argos token:  ${config.argosToken ? 'present' : 'MISSING — diff disabled'}`,
  );
  console.log(
    `[cosign sidecar] models:       pass1=${config.modelPassOne} pass2=${config.modelPassTwo}`,
  );
});
