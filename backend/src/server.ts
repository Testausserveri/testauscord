import { websocket } from '@hono/bun';
import app from './index';
import { startHeartbeat } from './realtime/connections';

const port = Number(Bun.env.PORT) || 3000;
const server = Bun.serve({
  port,
  fetch: app.fetch,
  websocket,
});

startHeartbeat();

console.log(`API listening on ${server.url}`);
