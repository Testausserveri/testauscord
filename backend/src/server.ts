import { websocket } from '@hono/bun';
import app from './index';
import { startHeartbeat } from './realtime/connections';
import { startDispatcher } from './realtime/dispatcher';

const port = Number(Bun.env.PORT) || 3000;
const server = Bun.serve({
  port,
  fetch: app.fetch,
  websocket,
});

startDispatcher();
startHeartbeat();

console.log(`API listening on ${server.url}`);
